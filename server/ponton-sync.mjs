#!/usr/bin/env node
/**
 * Ponton sync helper — a tiny local service between the Ponton web app and Enable Banking (PSD2).
 *
 * Why it exists: Enable Banking authenticates apps with a private key (RS256-signed JWT). That key
 * must not live in a web page, so this helper holds it, talks to the bank API and keeps a small
 * cache of raw transactions. The web app does all parsing and categorisation.
 *
 * Zero dependencies (Node >= 20). Binds to 127.0.0.1 only.
 *
 *   node server/ponton-sync.mjs            # real mode, needs server/config.json
 *   node server/ponton-sync.mjs --mock     # fake bank, no account needed
 *   add --background to refresh 4x/day while it runs (the PSD2 limit for unattended access)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const MOCK = args.has('--mock') || process.env.PONTON_MOCK === '1';
const BACKGROUND = args.has('--background');

const DEFAULTS = {
  applicationId: '',
  privateKeyPath: './private.pem',
  apiBase: 'https://api.enablebanking.com',
  aspsp: { name: 'KBC', country: 'BE' },
  psuType: 'personal',
  port: 8787,
  redirectUrl: 'http://localhost:8787/callback',
  appUrl: 'http://localhost:5173',
  allowedOrigins: ['http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173', 'http://127.0.0.1:4173'],
  consentDays: 180,
  historyDays: 90,
};

const configPath = process.env.PONTON_CONFIG || path.join(here, 'config.json');
const config = { ...DEFAULTS, ...(fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {}) };
if (process.env.PONTON_PORT) config.port = Number(process.env.PONTON_PORT);
const dataDir = process.env.PONTON_DATA || path.join(here, 'data');
const statePath = path.join(dataDir, MOCK ? 'state.mock.json' : 'state.json');
fs.mkdirSync(dataDir, { recursive: true });

// ── state ──────────────────────────────────────────────────────────────────────────────
/** @type {{ pending?: {state:string, created:number}, session?: {id:string, validUntil:string, accounts:{uid:string, iban?:string, name?:string}[]}, cache: Record<string, any[]>, lastRefresh?: string, lastError?: string, unattended: string[] }} */
let state = { cache: {}, unattended: [] };
try { state = { ...state, ...JSON.parse(fs.readFileSync(statePath, 'utf8')) }; } catch { /* first run */ }
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 1), { mode: 0o600 });

// ── Enable Banking client ──────────────────────────────────────────────────────────────
const b64url = (buf) => Buffer.from(buf).toString('base64url');
let privateKey;
function jwt() {
  privateKey ??= fs.readFileSync(path.resolve(here, config.privateKeyPath), 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: config.applicationId }));
  const body = b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey);
  return `${head}.${body}.${b64url(sig)}`;
}

async function eb(method, url, body, psu) {
  if (MOCK) return mockBank(method, url, body);
  const headers = { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' };
  // PSU headers mark a request as user-present; without them it counts against the 4/day unattended limit.
  if (psu?.ip) headers['Psu-Ip-Address'] = psu.ip;
  if (psu?.ua) headers['Psu-User-Agent'] = psu.ua;
  const res = await fetch(config.apiBase + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Enable Banking ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
  return text ? JSON.parse(text) : {};
}

async function startAuth() {
  const st = crypto.randomUUID();
  state.pending = { state: st, created: Date.now() };
  save();
  const validUntil = new Date(Date.now() + config.consentDays * 864e5).toISOString();
  const r = await eb('POST', '/auth', {
    access: { valid_until: validUntil },
    aspsp: config.aspsp,
    state: st,
    redirect_url: config.redirectUrl,
    psu_type: config.psuType,
  });
  return r.url;
}

async function finishAuth(code, st) {
  if (!state.pending || state.pending.state !== st) throw new Error('Unknown or expired login attempt. Start again from Ponton.');
  const r = await eb('POST', '/sessions', { code });
  state.session = {
    id: r.session_id,
    validUntil: r.access?.valid_until ?? new Date(Date.now() + config.consentDays * 864e5).toISOString(),
    accounts: (r.accounts ?? []).map(a => ({
      uid: a.uid ?? a,
      iban: a.account_id?.iban,
      name: a.name ?? a.product ?? a.details,
    })),
  };
  delete state.pending;
  state.cache = {};
  save();
}

const iso = (d) => d.toISOString().slice(0, 10);

async function refresh(psu) {
  if (!state.session) throw new Error('Not connected to a bank yet.');
  if (!psu) {
    const dayAgo = Date.now() - 864e5;
    state.unattended = state.unattended.filter(t => Date.parse(t) > dayAgo);
    if (state.unattended.length >= 4) throw new Error('PSD2 allows 4 background refreshes per 24h; skipping.');
    state.unattended.push(new Date().toISOString());
  }
  const histStart = iso(new Date(Date.now() - config.historyDays * 864e5));
  for (const acc of state.session.accounts) {
    const prev = state.cache[acc.uid] ?? [];
    // Re-fetch the last 10 days on every refresh: late bookings and pending → booked transitions land there.
    const lastBooked = prev.filter(t => t.status !== 'PDNG').map(t => t.booking_date ?? t.value_date).filter(Boolean).sort().pop();
    const from = lastBooked ? iso(new Date(Date.parse(lastBooked) - 10 * 864e5)) : histStart;
    const fetched = [];
    let key;
    do {
      const q = new URLSearchParams({ date_from: from, ...(key ? { continuation_key: key } : {}) });
      const r = await eb('GET', `/accounts/${encodeURIComponent(acc.uid)}/transactions?${q}`, null, psu);
      fetched.push(...(r.transactions ?? []));
      key = r.continuation_key;
    } while (key);
    // Keep older booked history, replace everything in the refreshed window (pending included).
    const keep = prev.filter(t => t.status !== 'PDNG' && (t.booking_date ?? t.value_date ?? '') < from);
    state.cache[acc.uid] = [...keep, ...fetched];
  }
  state.lastRefresh = new Date().toISOString();
  state.lastError = undefined;
  save();
}

// ── HTTP ───────────────────────────────────────────────────────────────────────────────
function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (origin && config.allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function status() {
  const s = state.session;
  return {
    mock: MOCK,
    configured: MOCK || !!(config.applicationId && fs.existsSync(path.resolve(here, config.privateKeyPath))),
    connected: !!s && Date.parse(s.validUntil) > Date.now(),
    bank: `${config.aspsp.name} (${config.aspsp.country})`,
    validUntil: s?.validUntil,
    accounts: s?.accounts?.map(a => ({ uid: a.uid, iban: a.iban, name: a.name })) ?? [],
    lastRefresh: state.lastRefresh,
    lastError: state.lastError,
  };
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const host = (req.headers.host ?? '').split(':')[0];
  // DNS-rebinding and cross-site guard: only localhost hosts, only Ponton origins.
  if (!['localhost', '127.0.0.1'].includes(host)) return send(res, 403, { error: 'Forbidden host' });
  if (origin && !config.allowedOrigins.includes(origin)) return send(res, 403, { error: 'Origin not allowed' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin ?? '',
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    });
    return res.end();
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/status') return send(res, 200, status(), origin);

    if (req.method === 'POST' && url.pathname === '/connect') {
      if (!status().configured) return send(res, 400, { error: 'Sync helper is not configured: add applicationId and private key in server/config.json.' }, origin);
      return send(res, 200, { url: await startAuth() }, origin);
    }

    if (req.method === 'GET' && url.pathname === '/callback') {
      const err = url.searchParams.get('error');
      if (err) throw new Error(`Bank login cancelled or failed: ${err} ${url.searchParams.get('error_description') ?? ''}`);
      await finishAuth(url.searchParams.get('code'), url.searchParams.get('state'));
      await refresh({ ip: req.socket.remoteAddress, ua: req.headers['user-agent'] }).catch(e => { state.lastError = e.message; save(); });
      res.writeHead(302, { Location: `${config.appUrl}?synced=1` });
      return res.end();
    }

    if (req.method === 'GET' && url.pathname === '/transactions') {
      if (url.searchParams.get('refresh') === '1') {
        const last = state.lastRefresh ? Date.parse(state.lastRefresh) : 0;
        if (Date.now() - last > 60_000) {
          // The user is in the app and asked for fresh data: a user-present request.
          await refresh({ ip: req.socket.remoteAddress, ua: req.headers['user-agent'] }).catch(e => { state.lastError = e.message; save(); throw e; });
        }
      }
      const accounts = (state.session?.accounts ?? []).map(a => ({ ...a, transactions: state.cache[a.uid] ?? [] }));
      return send(res, 200, { ...status(), accounts }, origin);
    }

    if (req.method === 'POST' && url.pathname === '/disconnect') {
      state = { cache: {}, unattended: [] };
      save();
      return send(res, 200, status(), origin);
    }

    send(res, 404, { error: 'Not found' }, origin);
  } catch (e) {
    if (url.pathname === '/callback') {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<p style="font-family:system-ui">Could not connect: ${String(e.message).replace(/</g, '&lt;')}</p><p><a href="${config.appUrl}">Back to Ponton</a></p>`);
    }
    send(res, e.status === 401 ? 401 : 500, { error: e.message }, origin);
  }
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Ponton sync helper on http://localhost:${config.port}${MOCK ? '  [MOCK BANK]' : ''}`);
  if (!MOCK && !status().configured) console.log('Not configured yet: see server/README.md');
});

if (BACKGROUND) {
  setInterval(() => {
    if (state.session) refresh().catch(e => { state.lastError = e.message; save(); });
  }, 6 * 3600 * 1000).unref?.();
}

// ── Mock bank: same shapes as Enable Banking, generated data ───────────────────────────
function mockBank(method, url, body) {
  if (method === 'POST' && url === '/auth') {
    return { url: `${config.redirectUrl}?code=mock-code&state=${body.state}`, authorization_id: 'mock-auth' };
  }
  if (method === 'POST' && url === '/sessions') {
    return {
      session_id: 'mock-session',
      access: { valid_until: new Date(Date.now() + config.consentDays * 864e5).toISOString() },
      accounts: [{ uid: 'mock-acc-1', account_id: { iban: 'BE68539007547034' }, name: 'Zichtrekening', currency: 'EUR' }],
    };
  }
  const m = url.match(/^\/accounts\/([^/]+)\/transactions\?(.*)$/);
  if (method === 'GET' && m) {
    const from = new URLSearchParams(m[2]).get('date_from');
    return { transactions: mockTransactions().filter(t => (t.booking_date ?? t.transaction_date) >= from), continuation_key: null };
  }
  throw new Error(`Mock bank: unsupported ${method} ${url}`);
}

function mockTransactions() {
  let seed = 7;
  const r = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const out = [];
  const today = new Date();
  const day = (offset) => iso(new Date(today.getTime() - offset * 864e5));
  const card = (offset, merchant, amount, pending = false) => {
    const d = day(offset);
    out.push({
      entry_reference: pending ? null : `MOCK${d.replace(/-/g, '')}${out.length}`,
      transaction_amount: { currency: 'EUR', amount: amount.toFixed(2) },
      credit_debit_indicator: 'DBIT',
      status: pending ? 'PDNG' : 'BOOK',
      booking_date: pending ? null : d,
      value_date: d,
      transaction_date: d,
      creditor: null,
      remittance_information: [`BETALING MET DEBETKAART NUMMER 4871 04XX XXXX 1234 ${merchant} ${d.slice(8, 10)}/${d.slice(5, 7)} OM 12.${String(out.length % 60).padStart(2, '0')} UUR BANCONTACT`],
      bank_transaction_code: { description: 'Card payment' },
    });
  };
  for (let o = 2; o < 90; o += 2 + Math.floor(r() * 3)) card(o, ['COLRUYT HALLE', 'DELHAIZE GENT', 'ALDI BRUGGE'][Math.floor(r() * 3)], 30 + r() * 70);
  for (let o = 3; o < 90; o += 7) card(o, ['DELIVEROO', 'BRASSERIE DE KAAI'][Math.floor(r() * 2)], 20 + r() * 40);
  card(0, 'COLRUYT HALLE', 64.3, true);
  card(1, 'SHELL EXPRESS', 71.15, true);
  for (let o = 0; o < 90; o += 30) {
    out.push({
      entry_reference: `MOCKDD${o}`, transaction_amount: { currency: 'EUR', amount: '89.99' }, credit_debit_indicator: 'DBIT',
      status: 'BOOK', booking_date: day(o + 5), value_date: day(o + 5),
      creditor: { name: 'PROXIMUS' }, creditor_account: { iban: 'BE82210000000000' },
      remittance_information: ['EUROPESE DOMICILIERING'], bank_transaction_code: { description: 'Direct debit' },
    });
    out.push({
      entry_reference: `MOCKSAL${o}`, transaction_amount: { currency: 'EUR', amount: '3420.00' }, credit_debit_indicator: 'CRDT',
      status: 'BOOK', booking_date: day(o + 8), value_date: day(o + 8),
      debtor: { name: 'ACME LOGISTICS NV' }, debtor_account: { iban: 'BE10363012345604' },
      remittance_information: ['LOON'], bank_transaction_code: { description: 'Credit transfer' },
    });
  }
  return out;
}
