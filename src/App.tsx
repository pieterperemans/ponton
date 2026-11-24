import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, FileUp, Link2, Loader2, RefreshCw, X } from 'lucide-react';
import { db, loadSettings, saveSettings } from './lib/db';
import { importStatement, runAiCategorisation } from './lib/pipeline';
import { monthLabel } from './lib/format';
import { monthsWithData, setSyncedThrough } from './lib/insights';
import { disconnect, lastSync, startConnect, syncNow, syncStatus } from './lib/sync';
import type { SyncStatus } from './lib/psd2';
import { ago, daysLeft } from './components/BankCard';
import { sampleKbcCsv } from './lib/sample';
import type { Settings as S } from './lib/types';
import Overview, { type Nav } from './views/Overview';
import Transactions from './views/Transactions';
import Budgets from './views/Budgets';
import Settings from './views/Settings';
import Dropzone from './components/Dropzone';

type Tab = 'overview' | 'transactions' | 'budgets' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const txs = useLiveQuery(() => db.transactions.toArray(), []);
  const budgets = useLiveQuery(() => db.budgets.toArray(), []) ?? [];
  const [settings, setSettingsState] = useState<S>(loadSettings);
  const [tab, setTab] = useState<Tab>('overview');
  const [nav, setNav] = useState<Nav>({});
  const [month, setMonth] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [bank, setBank] = useState<SyncStatus | null>(null);
  const [bankError, setBankError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const setSettings = (s: S) => { setSettingsState(s); saveSettings(s); };
  const months = useMemo(() => monthsWithData(txs ?? []), [txs]);
  const latest = months[months.length - 1];
  const current = month && months.includes(month) ? month : latest;

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 7000); return () => clearTimeout(t); } }, [toast]);

  const runAi = useCallback(async (s: S = settings) => {
    setBusy('Asking Claude about new merchants…');
    try {
      const r = await runAiCategorisation(s, (d, t) => setBusy(`Asking Claude about new merchants… ${d}/${t}`));
      setToast(`Claude categorised ${r.updated} transactions from ${r.merchants} merchants. Uncertain ones are in “To review”.`);
    } catch (e) {
      setToast((await import('./lib/ai')).describeAiError(e));
    } finally {
      setBusy(null);
    }
  }, [settings]);

  const doSync = useCallback(async (refresh: boolean, quiet = false) => {
    if (!settings.syncUrl) return;
    setSyncing(true);
    try {
      const r = await syncNow(settings.syncUrl, refresh);
      setBank(r.status);
      setBankError(null);
      if (!quiet || r.added) {
        setToast(r.added
          ? `Bank sync: ${r.added} new transaction${r.added === 1 ? '' : 's'}${r.pendingCount ? `, ${r.pendingCount} still pending` : ''}.`
          : 'Bank sync: you are up to date.');
      }
      if (r.pendingAi && settings.aiEnabled && settings.apiKey) await runAi();
    } catch (e) {
      const msg = (e as Error).message;
      setBankError(msg);
      if (!quiet) setToast(msg);
    } finally {
      setSyncing(false);
    }
  }, [settings, runAi]);

  // On open: check the helper, and refresh from the bank if the last sync is older than 30 minutes.
  useEffect(() => {
    if (!settings.syncUrl) { setBank(null); setSyncedThrough(undefined); return; }
    let cancelled = false;
    (async () => {
      try {
        const st = await syncStatus(settings.syncUrl);
        if (cancelled) return;
        setBank(st);
        setBankError(null);
        if (!st.connected) { setSyncedThrough(undefined); return; }
        setSyncedThrough(lastSync()?.slice(0, 10));
        const params = new URLSearchParams(window.location.search);
        const justConnected = params.has('synced');
        if (justConnected) window.history.replaceState(null, '', window.location.pathname);
        const stale = !lastSync() || Date.now() - Date.parse(lastSync()!) > 30 * 60_000;
        if (justConnected || stale) await doSync(!justConnected, !justConnected);
      } catch (e) {
        if (!cancelled) { setBank(null); setBankError((e as Error).message); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.syncUrl]);

  const connectBank = async () => {
    try { window.location.href = (await startConnect(settings.syncUrl)).url; }
    catch (e) { setToast((e as Error).message); }
  };

  const disconnectBank = async () => {
    if (!confirm('Disconnect the bank? Transactions already imported stay in Ponton.')) return;
    try { setBank(await disconnect(settings.syncUrl)); setSyncedThrough(undefined); } catch (e) { setToast((e as Error).message); }
  };

  const handleFiles = useCallback(async (files: File[]) => {
    const csvs = files.filter(f => /\.csv$/i.test(f.name) || f.type.includes('csv'));
    if (!csvs.length) { setToast('Please choose a CSV export from KBC.'); return; }
    setBusy('Importing…');
    let added = 0, dupes = 0, pending = 0;
    const warnings: string[] = [];
    try {
      for (const f of csvs) {
        const r = await importStatement(f);
        added += r.added; dupes += r.duplicates; pending += r.pendingAi; warnings.push(...r.warnings);
      }
      setMonth(undefined);
      setTab('overview');
      const base = `Imported ${added} new transaction${added === 1 ? '' : 's'}${dupes ? ` (${dupes} were already there)` : ''}.`;
      if (pending && settings.aiEnabled && settings.apiKey) {
        setToast(base);
        await runAi();
      } else {
        setToast(pending
          ? `${base} ${pending} from unfamiliar merchants are waiting: add a Claude API key in Settings to sort them automatically, or review them yourself.`
          : `${base} ${warnings.join(' ')}`.trim());
      }
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(b => (b === 'Importing…' ? null : b));
    }
  }, [settings, runAi]);

  const loadSample = () => handleFiles([new File([sampleKbcCsv()], 'sample-kbc-export.csv', { type: 'text/csv' })]);
  const go = (n: Nav) => { setNav(n); setTab('transactions'); };

  if (txs === undefined) return null;
  const empty = txs.length === 0;
  const mIdx = current ? months.indexOf(current) : -1;

  return (
    <div
      className="min-h-screen"
      onDragOver={e => { if (!empty) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={e => { if (!empty) { e.preventDefault(); setDragging(false); handleFiles([...e.dataTransfer.files]); } }}
    >
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-slate-50/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-sm text-white">P</span>
            <span className="hidden sm:inline">Ponton</span>
          </div>
          {!empty && (
            <nav className="-mx-1 flex flex-1 gap-1 overflow-x-auto">
              {TABS.map(t => (
                <button key={t.id} onClick={() => { setTab(t.id); if (t.id !== 'transactions') setNav({}); }}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === t.id ? 'bg-white text-slate-900 shadow-card dark:bg-slate-800 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}>
                  {t.label}
                </button>
              ))}
            </nav>
          )}
          {empty && <div className="flex-1" />}
          {bank?.connected && (
            <button onClick={() => doSync(true)} disabled={syncing} title="Sync with your bank"
              className="btn-ghost hidden px-2 text-xs sm:inline-flex">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : `Updated ${ago(bank.lastRefresh)}`}
            </button>
          )}
          {!empty && (
            <label className="btn-primary cursor-pointer px-3 sm:px-4">
              <FileUp className="h-4 w-4" /><span className="hidden sm:inline">Import</span>
              <input type="file" accept=".csv,text/csv" multiple hidden onChange={e => { handleFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
            </label>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {empty ? (
          <Dropzone onFiles={handleFiles} onSample={loadSample} busy={!!busy || syncing} onConnectBank={bank?.configured && !bank.connected ? connectBank : undefined} bankName={bank?.bank} />
        ) : (
          <>
            {tab !== 'settings' && current && (
              <div className="mb-6 flex items-center gap-2">
                <button className="btn-ghost p-2" disabled={mIdx <= 0} onClick={() => setMonth(months[mIdx - 1])} aria-label="Previous month"><ChevronLeft className="h-5 w-5" /></button>
                <h1 className="min-w-[10rem] text-center text-xl font-semibold tracking-tight sm:text-2xl">{monthLabel(current)}</h1>
                <button className="btn-ghost p-2" disabled={mIdx >= months.length - 1} onClick={() => setMonth(months[mIdx + 1])} aria-label="Next month"><ChevronRight className="h-5 w-5" /></button>
              </div>
            )}
            {bank?.connected && daysLeft(bank.validUntil) <= 14 && (
              <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                <span className="flex-1">Your bank access expires in {Math.max(0, daysLeft(bank.validUntil))} days. One KBC login renews it.</span>
                <button className="btn-primary px-3 py-1.5" onClick={connectBank}><Link2 className="h-4 w-4" /> Renew</button>
              </div>
            )}
            {tab === 'overview' && current && <Overview txs={txs} budgets={budgets} month={current} setMonth={setMonth} onNav={go} />}
            {tab === 'transactions' && current && <Transactions txs={txs} month={current} nav={nav} setNav={setNav} />}
            {tab === 'budgets' && current && <Budgets txs={txs} budgets={budgets} month={current} onNav={go} />}
            {tab === 'settings' && (
              <Settings settings={settings} setSettings={setSettings} onRunAi={() => runAi()} aiBusy={!!busy} notify={setToast}
                bank={{ status: bank, error: bankError, busy: syncing, onConnect: connectBank, onSync: () => doSync(true), onDisconnect: disconnectBank }} />
            )}
          </>
        )}
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-indigo-600/10 backdrop-blur-sm">
          <div className="card px-8 py-6 text-lg font-medium">Drop to import</div>
        </div>
      )}

      {(busy || toast) && (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-lg items-start gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-2xl dark:bg-slate-800">
          {busy ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : null}
          <span className="flex-1">{busy ?? toast}</span>
          {!busy && <button onClick={() => setToast(null)} aria-label="Dismiss"><X className="h-4 w-4 opacity-60" /></button>}
        </div>
      )}
    </div>
  );
}
