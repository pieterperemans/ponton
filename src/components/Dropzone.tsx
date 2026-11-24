import { useState } from 'react';
import { FileUp, Link2, Sparkles } from 'lucide-react';

export default function Dropzone({ onFiles, onSample, busy, onConnectBank, bankName }: {
  onFiles: (f: File[]) => void; onSample: () => void; busy: boolean; onConnectBank?: () => void; bankName?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <div className="mx-auto max-w-2xl py-10 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">See where your money goes.<br /><span className="text-slate-400">Without the bookkeeping.</span></h1>
      <p className="mt-4 text-slate-500 dark:text-slate-400">
        Drop in a KBC statement export. Ponton sorts every transaction into categories, learns from your corrections and tells you what's worth acting on. Your data stays in this browser.
      </p>

      <label
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]); }}
        className={`mt-8 flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-14 text-center transition ${over ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-300 bg-white hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-900'}`}
      >
        <FileUp className="h-10 w-10 text-indigo-500" />
        <span className="mt-4 font-medium">{busy ? 'Reading…' : 'Drop your KBC CSV here, or click to choose'}</span>
        <span className="mt-1 text-sm text-slate-500">You can add several files at once. Overlapping periods are de-duplicated.</span>
        <input type="file" accept=".csv,text/csv" multiple hidden onChange={e => { onFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </label>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {onConnectBank && <button className="btn-primary" onClick={onConnectBank} disabled={busy}><Link2 className="h-4 w-4" /> Connect {bankName ?? 'your bank'} directly</button>}
        <button className="btn-outline" onClick={onSample} disabled={busy}><Sparkles className="h-4 w-4" /> Try it with sample data</button>
      </div>

      <details className="mt-10 text-sm text-slate-500">
        <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-300">How do I export from KBC?</summary>
        <p className="mt-2">
          In KBC Touch on a computer, open your current account, choose the period (e.g. the last 6 months), and use the export or download option to save the
          transactions as <strong>CSV</strong>. Dutch, French and English exports all work. Exporting a longer period the first time gives better insights
          immediately; afterwards, one export a month is enough.
        </p>
      </details>
    </div>
  );
}
