import { useMemo } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronRight, Info, Repeat, Sparkles, TrendingUp } from 'lucide-react';
import { CATEGORIES, cat } from '../lib/categories';
import { money, money0, monthLabel, nice, shiftMonth } from '../lib/format';
import { buildInsights, coverage, dataThrough, detectRecurring, expectedRest, summarise, trend, type Insight } from '../lib/insights';
import type { Budget, Transaction } from '../lib/types';
import { Card } from '../components/ui';

export type Nav = { category?: string; review?: boolean };

const TONE = {
  bad:  { icon: AlertTriangle, ring: 'border-l-rose-500',    iconCls: 'text-rose-500' },
  warn: { icon: TrendingUp,    ring: 'border-l-amber-500',   iconCls: 'text-amber-500' },
  info: { icon: Info,          ring: 'border-l-indigo-500',  iconCls: 'text-indigo-500' },
  good: { icon: CheckCircle2,  ring: 'border-l-emerald-500', iconCls: 'text-emerald-500' },
};

function InsightCard({ i, onOpen }: { i: Insight; onOpen: () => void }) {
  const t = TONE[i.tone];
  const Icon = t.icon;
  return (
    <button onClick={onOpen} className={`group card flex w-full items-start gap-3 border-l-4 ${t.ring} p-4 text-left transition hover:-translate-y-px`}>
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${t.iconCls}`} />
      <div className="min-w-0 flex-1">
        <div className="font-medium leading-snug">{i.title}</div>
        <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{i.detail}</div>
      </div>
      {i.action && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />}
    </button>
  );
}

function Spark({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 60},${18 - (v / max) * 16}`).join(' ');
  return (
    <svg viewBox="0 0 60 20" className="h-5 w-16 shrink-0" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="card p-5">
      <div className="label">{label}</div>
      <div className={`num mt-2 text-2xl font-semibold tracking-tight sm:text-3xl ${tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'bad' ? 'text-rose-600 dark:text-rose-400' : ''}`}>{value}</div>
      {sub && <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  );
}

export default function Overview({
  txs, budgets, month, setMonth, onNav,
}: {
  txs: Transaction[];
  budgets: Budget[];
  month: string;
  setMonth: (m: string) => void;
  onNav: (n: Nav) => void;
}) {
  const data = useMemo(() => {
    const cur = summarise(txs, month);
    const hist = [1, 2, 3].map(i => summarise(txs, shiftMonth(month, -i))).filter(h => h.spend > 0);
    const avgSpend = hist.length ? hist.reduce((a, h) => a + h.spend, 0) / hist.length : null;
    const months = trend(txs, month, 12);
    const six = trend(txs, month, 6);

    // Stack the 5 biggest categories of the year; everything else is "Rest" to keep the chart legible.
    const totals: Record<string, number> = {};
    months.forEach(m => Object.entries(m.byCategory).forEach(([k, v]) => (totals[k] = (totals[k] ?? 0) + v)));
    const top = Object.entries(totals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
    const chart = months.map(m => {
      const row: Record<string, number | string> = { month: m.month, label: monthLabel(m.month, 'short'), income: Math.round(m.income) };
      let rest = m.spend;
      for (const k of top) { const v = Math.max(0, m.byCategory[k] ?? 0); row[k] = Math.round(v); rest -= v; }
      row.rest = Math.max(0, Math.round(rest));
      return row;
    });

    const cats = CATEGORIES.filter(c => c.kind === 'expense')
      .map(c => {
        const v = cur.byCategory[c.id] ?? 0;
        const avg = hist.length ? hist.reduce((a, h) => a + (h.byCategory[c.id] ?? 0), 0) / hist.length : 0;
        return { c, v, avg, series: six.map(s => Math.max(0, s.byCategory[c.id] ?? 0)) };
      })
      .filter(x => x.v > 0.5 || x.avg > 0.5)
      .sort((a, b) => b.v - a.v);

    const cov = coverage(txs, month);
    if (cov > 0 && cov < 1) {
      // Don't draw a misleading income dip for a month that isn't over yet.
      const last = chart[chart.length - 1];
      if (last?.month === month) delete (last as Record<string, unknown>).income;
    }
    return {
      cur, avgSpend, chart, top, cats, rest: expectedRest(txs, month),
      insights: buildInsights(txs, month, budgets),
      recurring: detectRecurring(txs, month),
      cov,
      through: dataThrough(txs),
    };
  }, [txs, budgets, month]);

  const { cur, avgSpend, chart, top, cats, insights, recurring, cov, through, rest } = data;
  const partial = cov > 0 && cov < 1;
  const spendDelta = avgSpend !== null && !partial ? cur.spend - avgSpend : null;
  const recurringTotal = recurring.reduce((a, r) => a + r.monthly, 0);
  const maxCat = Math.max(...cats.map(c => c.v), 1);

  return (
    <div className="space-y-6">
      {partial && through && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Data up to {new Date(through).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}. Import a newer statement to complete {monthLabel(month)}.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi
          label={partial ? 'Spent so far' : 'Spent'}
          value={money0(cur.spend)}
          sub={spendDelta !== null && Math.abs(spendDelta) >= 1 ? (
            <span className={`inline-flex items-center gap-1 ${spendDelta > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {spendDelta > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
              {money0(Math.abs(spendDelta))} vs. your 3-month average
            </span>
          ) : avgSpend !== null ? `Usually ${money0(avgSpend)} a month` : undefined}
        />
        <Kpi
          label={partial ? 'Income so far' : 'Income'}
          value={money0(cur.income)}
          sub={partial && rest.income >= 50 ? `≈ ${money0(rest.income)} usually still to come` : cur.income === 0 ? 'No income recorded yet' : undefined}
        />
        {partial ? (() => {
          const expIncome = cur.income + rest.income;
          const expNet = expIncome - (cur.spend + rest.spend);
          return (
            <Kpi
              label="Expected to keep"
              value={`≈ ${money0(expNet)}`}
              tone={expNet >= 0 ? 'good' : 'bad'}
              sub={expIncome > 0 ? `≈ ${Math.round((expNet / expIncome) * 100)}% of income, if the rest of the month is typical` : 'Based on your usual end of month'}
            />
          );
        })() : (
          <Kpi
            label="Kept"
            value={money0(cur.net)}
            tone={cur.net >= 0 ? 'good' : 'bad'}
            sub={cur.savingsRate !== null ? `${Math.round(cur.savingsRate * 100)}% of income` : undefined}
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Sparkles className="h-4 w-4 text-indigo-500" /> What needs your attention
          </h2>
          {insights.length ? insights.map(i => (
            <InsightCard key={i.id} i={i} onOpen={() => onNav(i.action === 'review' ? { review: true } : { category: i.category })} />
          )) : (
            <div className="card p-5 text-sm text-slate-500">Nothing stands out this month. 👌</div>
          )}
        </div>

        <Card title="Spending vs. income, last 12 months" className="lg:col-span-3">
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={chart} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}
                onClick={(e: { activePayload?: { payload: { month: string } }[] }) => e?.activePayload?.[0] && setMonth(e.activePayload[0].payload.month)}>
                <CartesianGrid vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={v => `€${Math.round(v / 100) / 10}k`} width={52} />
                <Tooltip
                  cursor={{ fill: 'rgba(99,102,241,.08)' }}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                  formatter={(v: number, k: string) => [money0(v), k === 'income' ? 'Income' : k === 'rest' ? 'Everything else' : cat(k).label]}
                />
                {[...top, 'rest'].map((k, idx, arr) => (
                  <Bar key={k} dataKey={k} stackId="s" fill={k === 'rest' ? '#cbd5e1' : cat(k).color} radius={idx === arr.length - 1 ? [6, 6, 0, 0] : 0} maxBarSize={36}>
                    {chart.map(row => <Cell key={String(row.month)} fillOpacity={row.month === month ? 1 : 0.45} cursor="pointer" />)}
                  </Bar>
                ))}
                <Line type="monotone" dataKey="income" stroke="#16a34a" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            {top.map(k => <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: cat(k).color }} />{cat(k).label}</span>)}
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-300" />Everything else</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 bg-green-600" />Income</span>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title={`Where it went in ${monthLabel(month)}`} className="lg:col-span-3">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {cats.map(({ c, v, avg, series }) => {
              const d = v - avg;
              return (
                <li key={c.id}>
                  <button onClick={() => onNav({ category: c.id })} className="flex w-full items-center gap-3 py-2.5 text-left hover:opacity-80">
                    <span className="w-6 text-center" aria-hidden>{c.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{c.label}</span>
                        <span className="num text-sm font-semibold">{money0(v)}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(2, (v / maxCat) * 100)}%`, background: c.color }} />
                        </div>
                        <span className={`num w-16 text-right text-xs ${!partial && Math.abs(d) >= Math.max(20, avg * 0.15) ? (d > 0 ? 'text-rose-500' : 'text-emerald-500') : 'text-slate-400'}`}>
                          {avg > 0 && !partial ? `${d >= 0 ? '+' : '−'}${money0(Math.abs(d))}` : ''}
                        </span>
                      </div>
                    </div>
                    <Spark values={series} color={c.color} />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-slate-400">Right column: difference vs. your 3-month average. Line: last 6 months.</p>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Repeat className="h-4 w-4 text-slate-400" /> Recurring costs</span>}
          action={<span className="num text-sm font-semibold">{money0(recurringTotal)}<span className="font-normal text-slate-400">/mo</span></span>}
          className="lg:col-span-2">
          {recurring.length ? (
            <ul className="space-y-2.5">
              {recurring.slice(0, 10).map(r => (
                <li key={r.merchantKey} className="flex items-center gap-3 text-sm">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cat(r.category).color }} />
                  <span className="min-w-0 flex-1 truncate">{nice(r.name)}</span>
                  {r.last > r.previous * 1.05 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">price ↑</span>}
                  <span className="num font-medium">{money(r.monthly)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Needs about 3 months of data to spot subscriptions and fixed costs.</p>
          )}
          {recurring.length > 0 && <p className="mt-4 text-xs text-slate-400">That's {money0(recurringTotal * 12)} a year. Payments seen in at least 3 of the last 6 months at a stable amount.</p>}
        </Card>
      </div>
    </div>
  );
}
