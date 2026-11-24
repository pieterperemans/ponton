import { Landmark, Link2, RefreshCw, Unlink } from 'lucide-react';
import type { SyncStatus } from '../lib/psd2';
import { Card } from './ui';

const ago = (iso?: string) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
export { ago };

export const daysLeft = (iso?: string) => (iso ? Math.floor((Date.parse(iso) - Date.now()) / 864e5) : 0);

export default function BankCard({
  status, syncUrl, setSyncUrl, error, busy, onConnect, onSync, onDisconnect,
}: {
  status: SyncStatus | null;
  syncUrl: string;
  setSyncUrl: (u: string) => void;
  error: string | null;
  busy: boolean;
  onConnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
}) {
  const left = daysLeft(status?.validUntil);
  return (
    <Card title={<span className="flex items-center gap-2"><Landmark className="h-4 w-4 text-slate-400" /> Live bank connection (PSD2)</span>}>
      <p className="text-sm text-slate-500">
        Keeps budgets up to date during the month without CSV exports. Runs through the Ponton sync helper on your own computer,
        which connects to KBC via Enable Banking (a licensed provider). Read-only: it cannot make payments.
      </p>

      <div className="mt-4 space-y-1.5">
        <div className="label">Sync helper address</div>
        <input className="input font-mono" value={syncUrl} onChange={e => setSyncUrl(e.target.value.trim())} placeholder="http://localhost:8787" />
      </div>

      {error && !status && (
        <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {error} <span className="block pt-1 text-xs opacity-80">Start it with <code className="font-mono">npm run sync</code>. Setup steps are in server/README.md.</span>
        </div>
      )}

      {status && (
        <div className="mt-4 space-y-3 text-sm">
          {status.mock && <div className="rounded-xl bg-indigo-50 px-3 py-2 text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-200">Demo mode: the helper is using a fake bank.</div>}
          {!status.configured && <div className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Helper is running but not configured yet: add your Enable Banking app id and key (server/README.md).</div>}
          {status.connected ? (
            <>
              <div className="flex flex-wrap justify-between gap-2">
                <span>Connected to <strong>{status.bank}</strong></span>
                <span className="text-slate-500">updated {ago(status.lastRefresh)}</span>
              </div>
              <ul className="space-y-1 text-slate-500">
                {status.accounts.map(a => <li key={a.uid} className="font-mono text-xs">{a.iban ?? a.uid}{a.name ? ` · ${a.name}` : ''}</li>)}
              </ul>
              <div className={left <= 14 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}>
                Access valid for {left} more day{left === 1 ? '' : 's'}{left <= 14 ? '. Reconnect soon (one KBC login).' : '.'}
              </div>
              {status.lastError && <div className="text-rose-600 dark:text-rose-400">Last sync failed: {status.lastError}</div>}
              <div className="flex flex-wrap gap-2 pt-1">
                <button className="btn-primary" onClick={onSync} disabled={busy}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Sync now</button>
                <button className="btn-outline" onClick={onConnect} disabled={busy}><Link2 className="h-4 w-4" /> Reconnect</button>
                <button className="btn-ghost text-rose-600 dark:text-rose-400" onClick={onDisconnect}><Unlink className="h-4 w-4" /> Disconnect</button>
              </div>
            </>
          ) : status.configured && (
            <button className="btn-primary" onClick={onConnect} disabled={busy}><Link2 className="h-4 w-4" /> Connect {status.bank}</button>
          )}
        </div>
      )}
    </Card>
  );
}
