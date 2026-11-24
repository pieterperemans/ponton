#!/usr/bin/env node
/**
 * Ponton setup check: `npm run doctor`. Read-only; changes nothing.
 * Prints ✓ done, ! needs attention, ✗ blocking, with the fix for each.
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(server);
let blocking = 0, warnings = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m, fix) => { warnings++; console.log(`  ! ${m}${fix ? `\n      → ${fix}` : ''}`); };
const bad = (m, fix) => { blocking++; console.log(`  ✗ ${m}${fix ? `\n      → ${fix}` : ''}`); };
const head = (t) => console.log(`\n${t}`);
const sh = (c) => { try { return execSync(c, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };

head('1. Project');
const major = Number(process.versions.node.split('.')[0]);
major >= 20 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} is too old`, 'Install the LTS version from nodejs.org');
fs.existsSync(path.join(root, 'node_modules')) ? ok('Dependencies installed') : bad('Dependencies not installed', 'Run: npm install');
const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch) {
  ok(`On branch ${branch}`);
  sh('git fetch --quiet origin');
  const behind = sh(`git rev-list --count HEAD..origin/${branch}`);
  if (behind && behind !== '0') warn(`${behind} newer commit(s) on GitHub`, 'Run: git pull');
  else if (behind === '0') ok('Up to date with GitHub');
}

head('2. Enable Banking key and config');
const keyFile = path.join(server, 'private.pem');
let key;
if (!fs.existsSync(keyFile)) bad('server/private.pem not found', 'Move the key you downloaded from Enable Banking into the server folder, named private.pem');
else {
  const txt = fs.readFileSync(keyFile, 'utf8');
  try {
    key = crypto.createPrivateKey(txt);
    ok(`Private key found and valid (${key.asymmetricKeyType?.toUpperCase()}, ${key.asymmetricKeyDetails?.modulusLength ?? '?'} bits)`);
  } catch {
    bad('server/private.pem is not a valid private key', /PUBLIC KEY|CERTIFICATE/.test(txt) ? 'This is a public key/certificate. You need the PRIVATE key file.' : 'Re-download it, or register a new application');
  }
  const mode = fs.statSync(keyFile).mode & 0o777;
  if (process.platform !== 'win32' && mode & 0o077) warn('Key file is readable by other users', 'Run: chmod 600 server/private.pem');
}

const cfgFile = path.join(server, 'config.json');
let cfg;
if (!fs.existsSync(cfgFile)) bad('server/config.json not found', 'Run: cp server/config.example.json server/config.json, then fill in applicationId');
else {
  try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); ok('config.json is valid JSON'); }
  catch (e) { bad(`config.json is not valid JSON: ${e.message}`, 'Check quotes and commas, e.g. a missing comma after a line you added'); }
}
if (cfg) {
  const id = cfg.applicationId ?? '';
  if (!id || id.startsWith('paste-')) bad('applicationId not filled in', 'Copy your Production application id from the Enable Banking Control Panel');
  else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) ok(`applicationId set (${id.slice(0, 8)}…)`);
  else warn(`applicationId "${id}" doesn't look like a UUID`, 'Double-check you copied the whole id');
  ok(`Bank: ${cfg.aspsp?.name ?? 'KBC'} (${cfg.aspsp?.country ?? 'BE'}), ${cfg.psuType ?? 'personal'}`);

  const redirect = cfg.redirectUrl ?? 'http://localhost:8787/callback';
  const usesTls = !!(cfg.https?.certPath && cfg.https?.keyPath);
  if (redirect.startsWith('https') && !usesTls) bad(`redirectUrl is ${redirect} but HTTPS is not set up`, 'Either change the redirect URL in Enable Banking AND config.json to http://localhost:8787/callback, or set up mkcert (server/README.md)');
  else if (!redirect.startsWith('https') && usesTls) bad('HTTPS is configured but redirectUrl is http', 'Make redirectUrl https://localhost:8787/callback');
  else ok(`Redirect URL ${redirect} matches helper protocol`);
  if (usesTls) {
    for (const f of [cfg.https.certPath, cfg.https.keyPath]) {
      fs.existsSync(path.resolve(server, f)) ? ok(`HTTPS file ${f} found`) : bad(`HTTPS file ${f} not found`, 'Run in the server folder: mkcert localhost');
    }
  }
  console.log(`      (Make sure the Enable Banking Control Panel has exactly: ${redirect})`);
}

head('3. Secrets stay out of git');
for (const f of ['server/private.pem', 'server/config.json']) {
  if (sh(`git ls-files --error-unmatch ${f}`) !== null) bad(`${f} is tracked by git!`, `Run: git rm --cached ${f}  (and never push it)`);
  else if (sh(`git check-ignore ${f}`)) ok(`${f} is ignored by git`);
}

head('4. Enable Banking accepts the key (online check)');
if (key && cfg?.applicationId && !cfg.applicationId.startsWith('paste-')) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ typ: 'JWT', alg: 'RS256', kid: cfg.applicationId })}.${b64({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 300 })}`;
  const jwt = `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')}`;
  try {
    const res = await fetch(`${cfg.apiBase ?? 'https://api.enablebanking.com'}/application`, { headers: { Authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      ok(`Key and applicationId accepted${body.name ? ` (app "${body.name}")` : ''}`);
      if (body.active === false) warn('Application is not active yet', 'Link your own KBC account to it in the Control Panel');
      if (Array.isArray(body.redirect_urls) && cfg.redirectUrl && !body.redirect_urls.includes(cfg.redirectUrl)) {
        bad(`Enable Banking has redirect URL(s) ${body.redirect_urls.join(', ')}, config.json has ${cfg.redirectUrl}`, 'Make them identical');
      }
    } else if (res.status === 401 || res.status === 403) {
      bad(`Enable Banking rejected the key (${res.status})`, 'Key and applicationId belong to different applications (or Sandbox vs Production)');
    } else warn(`Unexpected answer ${res.status} from Enable Banking`, `Details: ${JSON.stringify(body).slice(0, 200)}`);
  } catch (e) {
    warn(`Could not reach Enable Banking (${e.name === 'TimeoutError' ? 'timeout' : e.message})`, 'Check your internet connection; this check is optional');
  }
} else console.log('  - skipped (needs a valid key and applicationId first)');

head('5. Sync helper');
const port = cfg?.port ?? 8787;
const scheme = cfg?.https?.certPath ? 'https' : 'http';
const status = await new Promise((resolve) => {
  const lib = scheme === 'https' ? https : http;
  const req = lib.get({ host: 'localhost', port, path: '/status', rejectUnauthorized: false, timeout: 3000 }, (res) => {
    let d = ''; res.on('data', c => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
  });
  req.on('error', () => resolve(null));
  req.on('timeout', () => { req.destroy(); resolve(null); });
});
if (!status) warn(`Helper not running on ${scheme}://localhost:${port}`, 'In a separate Terminal window, inside ponton: npm run sync');
else {
  ok(`Helper running on ${scheme}://localhost:${port}${status.mock ? ' (MOCK bank!)' : ''}`);
  if (status.mock) warn('Helper is in demo mode', 'Stop it (Ctrl+C) and start with: npm run sync');
  if (!status.configured) bad('Helper says it is not configured', 'Restart it after editing config.json');
  if (status.connected) {
    const days = Math.floor((Date.parse(status.validUntil) - Date.now()) / 864e5);
    ok(`Connected to ${status.bank}, ${status.accounts.length} account(s), access valid ${days} more days`);
    status.lastRefresh ? ok(`Last bank sync: ${new Date(status.lastRefresh).toLocaleString()}`) : warn('Connected but never synced', 'Open Ponton or click Sync now');
  } else if (status.configured) warn('Not connected to the bank yet', 'Open Ponton (npm run dev → http://localhost:5173) → Settings → Connect');
  if (status.lastError) bad(`Last sync error: ${status.lastError}`, 'Send this message to Claude');
}
if (scheme === 'https') console.log(`      (In Ponton → Settings, the sync helper address must be https://localhost:${port})`);

console.log(`\n${blocking ? `✗ ${blocking} blocking issue(s)` : '✓ No blocking issues'}${warnings ? `, ${warnings} warning(s)` : ''}.\n`);
process.exit(blocking ? 1 : 0);
