import { useLiveQuery } from 'dexie-react-hooks';
import { Download, KeyRound, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { db, exportBackup, restoreBackup, wipeAll } from '../lib/db';
import { DEFAULT_MODEL } from '../lib/config';
import type { Settings as S } from '../lib/types';
import { Card } from '../components/ui';
import BankCard from '../components/BankCard';
import type { SyncStatus } from '../lib/psd2';

export interface BankProps {
  status: SyncStatus | null; error: string | null; busy: boolean;
  onConnect: () => void; onSync: () => void; onDisconnect: () => void;
}

export default function Settings({ settings, setSettings, onRunAi, aiBusy, notify, bank }: {
  settings: S; setSettings: (s: S) => void; onRunAi: () => void; aiBusy: boolean; notify: (m: string) => void; bank: BankProps;
}) {
  const imports = useLiveQuery(() => db.imports.orderBy('importedAt').reverse().toArray(), []) ?? [];
  const pending = useLiveQuery(() => db.transactions.filter(t => t.source === 'none').count(), []) ?? 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <BankCard {...bank} syncUrl={settings.syncUrl} setSyncUrl={u => setSettings({ ...settings, syncUrl: u })} />
      <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-slate-400" /> AI categorisation</span>}>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>Use Claude for merchants the app doesn't recognise</span>
          <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={settings.aiEnabled} onChange={e => setSettings({ ...settings, aiEnabled: e.target.checked })} />
        </label>
        <div className="mt-4 space-y-1.5">
          <div className="label">Claude API key</div>
          <input className="input font-mono" type="password" placeholder="sk-ant-…" autoComplete="off" value={settings.apiKey}
            onChange={e => setSettings({ ...settings, apiKey: e.target.value.trim() })} />
          <p className="text-xs text-slate-500">Stored only in this browser. Get one at console.anthropic.com.</p>
        </div>
        <div className="mt-4 space-y-1.5">
          <div className="label">Model</div>
          <input className="input font-mono" value={settings.model} onChange={e => setSettings({ ...settings, model: e.target.value.trim() || DEFAULT_MODEL })} />
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button className="btn-primary" disabled={!settings.apiKey || !pending || aiBusy} onClick={onRunAi}>
            {aiBusy ? 'Categorising…' : `Categorise ${pending} pending`}
          </button>
          {!pending && <span className="text-sm text-slate-500">Nothing pending.</span>}
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-slate-400" /> Privacy</span>}>
        <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <li>• All transactions are stored in this browser only (IndexedDB). With a bank connection, the sync helper on your computer also keeps the last ~90 days of raw bank data in server/data/.</li>
          <li>• The bank connection goes through Enable Banking, a licensed PSD2 provider, which can see your transactions while passing them on. It is read-only.</li>
          <li>• Most transactions are categorised on your device by built-in rules and what you taught it.</li>
          <li>• Only <strong>unknown merchants</strong> go to Claude: one entry per merchant with its name, up to two example descriptions and a typical amount. That name can be a person you transfer money to. IBANs, card numbers and long reference numbers are removed first. Your balance, your account number and your own name are never sent.</li>
          <li>• Clearing your browser data deletes everything. Export a backup now and then.</li>
        </ul>
      </Card>

      <Card title="Backup">
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" onClick={async () => {
            const url = URL.createObjectURL(await exportBackup());
            const a = Object.assign(document.createElement('a'), { href: url, download: `ponton-backup-${new Date().toISOString().slice(0, 10)}.json` });
            a.click(); URL.revokeObjectURL(url);
          }}><Download className="h-4 w-4" /> Export backup</button>
          <label className="btn-outline cursor-pointer"><Upload className="h-4 w-4" /> Restore backup
            <input type="file" accept=".json" hidden onChange={async e => {
              const f = e.target.files?.[0]; if (!f) return;
              try { await restoreBackup(f); notify('Backup restored.'); } catch (err) { notify((err as Error).message); }
              e.target.value = '';
            }} />
          </label>
          <button className="btn-ghost text-rose-600 dark:text-rose-400" onClick={async () => {
            if (confirm('Delete all transactions, learned categories and budgets from this browser?')) { await wipeAll(); notify('All data deleted.'); }
          }}><Trash2 className="h-4 w-4" /> Delete all data</button>
        </div>
      </Card>

      <Card title="Import history">
        {imports.length ? (
          <ul className="space-y-2 text-sm">
            {imports.map(i => (
              <li key={i.id} className="flex flex-wrap justify-between gap-2">
                <span className="truncate">{i.fileName}</span>
                <span className="num text-slate-500">{i.from} → {i.to} · {i.added} new{i.duplicates ? `, ${i.duplicates} already there` : ''}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">No imports yet.</p>}
      </Card>
    </div>
  );
}
