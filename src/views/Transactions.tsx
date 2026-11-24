import { useMemo, useState } from 'react';
import { Check, Search, Sparkles, X } from 'lucide-react';
import { CATEGORIES, cat } from '../lib/categories';
import { money, monthKey, monthLabel, nice, shortDate, txKind } from '../lib/format';
import { confirmTransaction, setMerchantCategory, setTransactionCategory } from '../lib/pipeline';
import type { Transaction } from '../lib/types';
import { CategoryPicker, CategoryPill } from '../components/ui';
import type { Nav } from './Overview';

const SOURCE_LABEL: Record<Transaction['source'], string> = {
  manual: 'Set by you', memory: 'Learned', rule: 'Recognised', ai: 'AI', none: 'Not yet categorised',
};

function Row({ t }: { t: Transaction }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-x-3 gap-y-1 py-3 sm:grid-cols-[4rem_1fr_12rem_7rem]">
      <span className="num text-xs text-slate-400">{shortDate(t.date)}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-2 truncate text-sm font-medium">{nice(t.counterparty)}
          {t.pending && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800">pending</span>}
        </div>
        <div className="truncate text-xs text-slate-400" title={t.description}>{[txKind(t.description), t.message].filter(Boolean).join(' · ') || t.description}</div>
      </div>
      <span className={`num text-right text-sm font-semibold sm:order-last ${t.amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
        {t.amount > 0 ? '+' : ''}{money(t.amount)}
      </span>
      <div className="relative col-span-3 col-start-2 flex items-center gap-2 sm:col-span-1 sm:col-start-auto">
        <CategoryPill id={t.category} onClick={() => setOpen(o => !o)} />
        {t.needsReview ? (
          <>
            {t.source === 'ai' && <span className="text-[11px] text-amber-600 dark:text-amber-400">guess · {Math.round(t.confidence * 100)}%</span>}
            {t.source !== 'none' && (
              <button onClick={() => confirmTransaction(t.id)} title="Looks right" className="ml-auto rounded-full p-1 text-emerald-600 hover:bg-emerald-50 sm:ml-0 dark:hover:bg-emerald-500/10">
                <Check className="h-4 w-4" />
              </button>
            )}
          </>
        ) : (
          <span className="hidden text-[11px] text-slate-400 xl:inline">{SOURCE_LABEL[t.source]}</span>
        )}
        {open && (
          <CategoryPicker
            value={t.category}
            merchant={nice(t.counterparty)}
            onClose={() => setOpen(false)}
            onPick={async (c, remember) => {
              setOpen(false);
              if (remember) await setMerchantCategory(t.merchantKey, c);
              await setTransactionCategory(t.id, c);
            }}
          />
        )}
      </div>
    </li>
  );
}

function ReviewGroup({ items }: { items: Transaction[] }) {
  const [open, setOpen] = useState(false);
  const t = items[0];
  const total = items.reduce((a, x) => a + x.amount, 0);
  const months = new Set(items.map(x => monthKey(x.date))).size;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
      <div className="min-w-[12rem] flex-1">
        <div className="text-sm font-medium">{nice(t.counterparty)}</div>
        <div className="text-xs text-slate-400">
          {items.length} payment{items.length > 1 ? 's' : ''}{months > 1 ? ` across ${months} months` : ''} · {txKind(t.description) ?? 'Payment'}{t.message ? ` · ${t.message}` : ''}
        </div>
      </div>
      <span className={`num text-sm font-semibold ${total > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{money(total)}</span>
      <div className="relative flex items-center gap-2">
        <CategoryPill id={t.category} onClick={() => setOpen(o => !o)} />
        {t.source === 'ai' && <span className="text-[11px] text-amber-600 dark:text-amber-400">guess · {Math.round(t.confidence * 100)}%</span>}
        {t.source !== 'none' ? (
          <button onClick={() => setMerchantCategory(t.merchantKey, t.category)} className="btn-outline px-3 py-1 text-xs">
            <Check className="h-3.5 w-3.5 text-emerald-600" /> Correct
          </button>
        ) : (
          <button onClick={() => setOpen(true)} className="btn-primary px-3 py-1 text-xs">Choose</button>
        )}
        {open && (
          <CategoryPicker value={t.category} merchant={nice(t.counterparty)} onClose={() => setOpen(false)}
            onPick={async (c, remember) => {
              setOpen(false);
              if (remember) await setMerchantCategory(t.merchantKey, c);
              else for (const x of items) await setTransactionCategory(x.id, c);
            }} />
        )}
      </div>
    </li>
  );
}

export default function Transactions({ txs, month, nav, setNav }: { txs: Transaction[]; month: string; nav: Nav; setNav: (n: Nav) => void }) {
  const [q, setQ] = useState('');
  const [allMonths, setAllMonths] = useState(false);
  const review = !!nav.review;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return txs
      .filter(t => (review ? t.needsReview : true))
      .filter(t => review || allMonths || needle || monthKey(t.date) === month)
      .filter(t => !nav.category || t.category === nav.category)
      .filter(t => !needle || `${t.counterparty} ${t.description} ${t.message ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => (review ? a.merchantKey.localeCompare(b.merchantKey) : b.date.localeCompare(a.date)));
  }, [txs, q, allMonths, month, nav, review]);

  const total = list.reduce((a, t) => a + t.amount, 0);
  // In review mode, one decision per merchant instead of one per payment.
  const groups = useMemo(() => {
    if (!review) return [];
    const m = new Map<string, Transaction[]>();
    for (const t of list) m.set(t.merchantKey, [...(m.get(t.merchantKey) ?? []), t]);
    return [...m.values()].sort((a, b) => b.length - a.length);
  }, [list, review]);
  const reviewCount = txs.filter(t => t.needsReview).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search merchant or description…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={nav.category ?? ''} onChange={e => setNav({ ...nav, category: e.target.value || undefined })}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <button onClick={() => setNav({ ...nav, review: !review })} className={review ? 'btn-primary' : 'btn-outline'}>
          <Sparkles className="h-4 w-4" /> To review {reviewCount > 0 && <span className="num rounded-full bg-white/20 px-1.5 text-xs">{reviewCount}</span>}
        </button>
        {!review && (
          <label className="flex items-center gap-2 px-1 text-sm text-slate-500">
            <input type="checkbox" checked={allMonths} onChange={e => setAllMonths(e.target.checked)} className="accent-indigo-600" /> All months
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <span>{review ? `${groups.length} merchant${groups.length === 1 ? '' : 's'} · ${list.length} transactions` : `${list.length} transactions${!allMonths && !q ? ` in ${monthLabel(month)}` : ''}`}</span>
        {nav.category && (
          <button onClick={() => setNav({ ...nav, category: undefined })} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
            {cat(nav.category).label} <X className="h-3 w-3" />
          </button>
        )}
        <span className="num ml-auto font-medium text-slate-700 dark:text-slate-200">{money(total)}</span>
      </div>

      {review && (
        <div className="rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-200">
          One decision per merchant. Confirm the guess or pick a category; it's applied to all their payments and remembered for future imports.
        </div>
      )}

      <div className="card px-4 sm:px-5">
        {review && groups.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {groups.map(g => <ReviewGroup key={g[0].merchantKey} items={g} />)}
          </ul>
        ) : list.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.slice(0, 400).map(t => <Row key={t.id} t={t} />)}
          </ul>
        ) : (
          <p className="py-10 text-center text-sm text-slate-500">{review ? 'All caught up. Nothing to review. ✨' : 'No transactions match.'}</p>
        )}
      </div>
      {list.length > 400 && <p className="text-center text-xs text-slate-400">Showing the first 400. Narrow it down with search or filters.</p>}
    </div>
  );
}
