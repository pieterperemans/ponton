import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { cat } from '../lib/categories';
import { db } from '../lib/db';
import { money0, monthLabel } from '../lib/format';
import { budgetLines, coverage } from '../lib/insights';
import type { Budget, Transaction } from '../lib/types';
import { Progress } from '../components/ui';
import type { Nav } from './Overview';

function LimitEditor({ value, onSave }: { value: number; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  return (
    <input
      className="input num w-24 py-1 text-right"
      inputMode="decimal"
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => { const n = Number(v.replace(',', '.')); if (Number.isFinite(n) && n >= 0 && n !== value) onSave(n); else setV(String(value)); }}
      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label="Monthly budget"
    />
  );
}

export default function Budgets({ txs, budgets, month, onNav }: { txs: Transaction[]; budgets: Budget[]; month: string; onNav: (n: Nav) => void }) {
  const lines = budgetLines(txs, month, budgets);
  const partial = coverage(txs, month) < 1;
  const total = lines.reduce((a, l) => ({ limit: a.limit + l.limit, spent: a.spent + l.spent, projected: a.projected + l.projected }), { limit: 0, spent: 0, projected: 0 });

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="label">Budgeted spending · {monthLabel(month)}</div>
            <div className="num mt-1 text-2xl font-semibold">{money0(total.spent)} <span className="text-base font-normal text-slate-400">of {money0(total.limit)}</span></div>
          </div>
          {partial && <div className="text-sm text-slate-500">Expected by month end: <span className="num font-medium text-slate-800 dark:text-slate-200">{money0(total.projected)}</span></div>}
        </div>
        <div className="mt-4"><Progress value={total.spent / Math.max(1, total.limit)} marker={total.projected / Math.max(1, total.limit)} color="#6366f1" /></div>
        <p className="mt-4 text-sm text-slate-500">
          Budgets start at what you <em>usually</em> spend (median of the last 3 months), so there's nothing to set up. Change any amount to make it a target; the faint bar shows where you're expected to end up.
        </p>
      </div>

      <div className="card divide-y divide-slate-100 px-5 dark:divide-slate-800">
        {lines.map(l => {
          const c = cat(l.category);
          return (
            <div key={l.category} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
              <button onClick={() => onNav({ category: l.category })} className="flex min-w-[10rem] flex-1 items-center gap-2 text-left text-sm font-medium hover:underline">
                <span aria-hidden>{c.emoji}</span>{c.label}
                {l.auto && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-500 dark:bg-slate-800">usual</span>}
              </button>
              <div className="order-last w-full sm:order-none sm:w-auto sm:flex-[2]">
                <Progress value={l.spent / l.limit} marker={partial ? l.projected / l.limit : undefined} color={c.color} />
              </div>
              <span className="num w-20 text-right text-sm">{money0(l.spent)}</span>
              <span className="text-sm text-slate-400">/</span>
              <LimitEditor key={`${l.category}-${l.limit}`} value={l.limit} onSave={n => db.budgets.put({ category: l.category, monthly: n, auto: false })} />
              <button
                title="Back to your usual level"
                disabled={l.auto}
                onClick={() => db.budgets.delete(l.category)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:invisible dark:hover:bg-slate-800"
              ><RotateCcw className="h-4 w-4" /></button>
            </div>
          );
        })}
        {!lines.length && <p className="py-10 text-center text-sm text-slate-500">Budgets appear once you have 2 months of history.</p>}
      </div>
    </div>
  );
}
