import { db } from './db';
import { ingestRows } from './pipeline';
import { normaliseSync, psd2Id, type SyncAccount, type SyncStatus } from './psd2';
import { setSyncedThrough } from './insights';

/** Talks to the local sync helper (server/ponton-sync.mjs). The helper holds the bank key; this file never sees it. */

const LAST_KEY = 'ponton.lastSync';
export const lastSync = (): string | undefined => { try { return localStorage.getItem(LAST_KEY) ?? undefined; } catch { return undefined; } };

async function call<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base.replace(/\/$/, '') + path, init);
  } catch {
    throw new Error(`Can't reach the sync helper at ${base}. Is it running? (npm run sync)`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Sync helper error ${res.status}`);
  return body as T;
}

export const syncStatus = (base: string) => call<SyncStatus>(base, '/status');
export const startConnect = (base: string) => call<{ url: string }>(base, '/connect', { method: 'POST' });
export const disconnect = (base: string) => call<SyncStatus>(base, '/disconnect', { method: 'POST' });

export async function syncNow(base: string, refresh = true) {
  const r = await call<SyncStatus & { accounts: SyncAccount[] }>(base, `/transactions${refresh ? '?refresh=1' : ''}`);
  if (!r.connected) throw new Error('Not connected to your bank. Connect it in Settings.');
  const rows = normaliseSync(r.accounts);
  const accounts = new Set(r.accounts.map(a => (a.iban ?? a.uid).replace(/\s/g, '')));
  const result = await ingestRows(rows, 'psd2', psd2Id, accounts);
  const when = r.lastRefresh ?? new Date().toISOString();
  try { localStorage.setItem(LAST_KEY, when); } catch { /* private mode */ }
  setSyncedThrough(when.slice(0, 10));
  return { ...result, status: r as SyncStatus, pendingCount: await db.transactions.filter(t => !!t.pending).count() };
}
