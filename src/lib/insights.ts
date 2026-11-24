import { CATEGORIES, cat, isExpenseCat, isIncomeCat } from './categories';
import { daysInMonth, money, money0, monthKey, monthLabel, nice, shiftMonth } from './format';
import type { Budget, Transaction } from './types';

export interface MonthSummary {
  month: string;
  income: number;
  spend: number;
  net: number;
  savingsRate: number | null;
  byCategory: Record<string, number>;
}

export interface Insight {
  id: string;
  tone: 'bad' | 'warn' | 'info' | 'good';
  title: string;
  detail: string;
  category?: string;
  action?: 'review' | 'budget' | 'category';
}

export interface Recurring {
  merchantKey: string;
  name: string;
  category: string;
  monthly: number;
  last: number;
  previous: number;
  months: number;
  lastDate: string;
}

export interface BudgetLine {
  category: string;
  limit: number;
  auto: boolean;
  spent: number;
  projected: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Expense categories count net of refunds: a returned parcel lowers Shopping, it isn't income. */
export function summarise(txs: Transaction[], month: string): MonthSummary {
  const byCategory: Record<string, number> = {};
  let income = 0, spend = 0;
  for (const t of txs) {
    if (monthKey(t.date) !== month) continue;
    if (isExpenseCat(t.category)) {
      byCategory[t.category] = (byCategory[t.category] ?? 0) - t.amount;
      spend -= t.amount;
    } else if (isIncomeCat(t.category)) {
      income += t.amount;
    }
  }
  const net = income - spend;
  return { month, income, spend, net, savingsRate: income > 0 ? net / income : null, byCategory };
}

export function monthsWithData(txs: Transaction[]): string[] {
  return [...new Set(txs.map(t => monthKey(t.date)))].sort();
}

export function dataThrough(txs: Transaction[]): string | undefined {
  return txs.reduce<string | undefined>((m, t) => (!m || t.date > m ? t.date : m), undefined);
}

/** Fraction of the month covered by imported data (1 for past months). */
export function coverage(txs: Transaction[], month: string): number {
  const through = dataThrough(txs);
  if (!through || monthKey(through) > month) return 1;
  if (monthKey(through) < month) return 0;
  return Number(through.slice(8, 10)) / daysInMonth(month);
}

/** For a partial month: what typically still comes in/goes out after the last imported day. */
export function expectedRest(txs: Transaction[], month: string): { income: number; spend: number } {
  const cov = coverage(txs, month);
  const through = dataThrough(txs);
  if (!(cov > 0 && cov < 1) || !through) return { income: 0, spend: 0 };
  const cut = Number(through.slice(8, 10));
  const prev = [1, 2, 3].map(i => shiftMonth(month, -i)).filter(m => txs.some(t => monthKey(t.date) === m));
  if (!prev.length) return { income: 0, spend: 0 };
  const ps = new Set(prev);
  let income = 0, spend = 0;
  for (const t of txs) {
    if (!ps.has(monthKey(t.date)) || Number(t.date.slice(8, 10)) <= cut) continue;
    if (isExpenseCat(t.category)) spend -= t.amount;
    else if (isIncomeCat(t.category)) income += t.amount;
  }
  return { income: income / prev.length, spend: Math.max(0, spend / prev.length) };
}

export function trend(txs: Transaction[], endMonth: string, n = 12): MonthSummary[] {
  const first = monthsWithData(txs)[0];
  const out: MonthSummary[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = shiftMonth(endMonth, -i);
    if (first && m < first) continue;
    out.push(summarise(txs, m));
  }
  return out;
}

/** Budget = user's override, else median of the previous 3 months, rounded up to €10. */
export function budgetLines(txs: Transaction[], month: string, overrides: Budget[]): BudgetLine[] {
  const current = summarise(txs, month);
  const history = [1, 2, 3].map(i => summarise(txs, shiftMonth(month, -i)));
  const cov = coverage(txs, month);
  const through = dataThrough(txs);
  const cutDay = cov > 0 && cov < 1 && through ? Number(through.slice(8, 10)) : 31;
  // Typical spend after the cut-off day in previous months. Fixed charges early in the month
  // (mortgage, energy) are then not extrapolated, while day-to-day spending is.
  const rest: Record<string, number> = {};
  if (cutDay < 31) {
    const prev = new Set([1, 2, 3].map(i => shiftMonth(month, -i)));
    for (const t of txs) {
      if (!prev.has(monthKey(t.date)) || Number(t.date.slice(8, 10)) <= cutDay || !isExpenseCat(t.category)) continue;
      rest[t.category] = (rest[t.category] ?? 0) - t.amount / 3;
    }
  }
  const ov = new Map(overrides.map(b => [b.category, b]));
  const lines: BudgetLine[] = [];

  for (const c of CATEGORIES.filter(c => c.kind === 'expense' && c.id !== 'other')) {
    const spent = Math.max(0, current.byCategory[c.id] ?? 0);
    const past = history.map(h => Math.max(0, h.byCategory[c.id] ?? 0));
    const override = ov.get(c.id);
    let limit = override?.monthly;
    if (limit === undefined) {
      if (past.filter(v => v > 0).length < 2) continue;
      limit = Math.ceil(median(past) / 10) * 10;
    }
    if (limit <= 0) continue;
    lines.push({
      category: c.id,
      limit,
      auto: !override,
      spent,
      projected: spent + Math.max(0, rest[c.id] ?? 0),
    });
  }
  return lines.sort((a, b) => b.projected / b.limit - a.projected / a.limit);
}

// Habits, not commitments: frequent but variable spending is never a subscription.
const NOT_COMMITMENTS = new Set(['groceries', 'eating_out', 'shopping', 'cash', 'other']);

export function detectRecurring(txs: Transaction[], asOf: string): Recurring[] {
  const window = new Set([0, 1, 2, 3, 4, 5].map(i => shiftMonth(asOf, -i)));
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.amount >= 0 || !isExpenseCat(t.category) || NOT_COMMITMENTS.has(t.category) || !window.has(monthKey(t.date))) continue;
    groups.set(t.merchantKey, [...(groups.get(t.merchantKey) ?? []), t]);
  }
  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    const months = new Set(list.map(t => monthKey(t.date)));
    if (months.size < 3) continue;
    if (list.length > months.size * 1.5) continue; // frequent shop visits, not a subscription
    const amounts = list.map(t => -t.amount);
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const sd = Math.sqrt(amounts.reduce((a, b) => a + (b - avg) ** 2, 0) / amounts.length);
    if (avg < 2 || sd / avg > 0.15) continue;
    const days = list.map(t => Number(t.date.slice(8, 10)));
    if (Math.max(...days) - Math.min(...days) > 8) continue; // not on a fixed schedule
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    out.push({
      merchantKey: key,
      name: sorted[sorted.length - 1].counterparty,
      category: sorted[sorted.length - 1].category,
      monthly: avg,
      last: -sorted[sorted.length - 1].amount,
      previous: -sorted[Math.max(0, sorted.length - 2)].amount,
      months: months.size,
      lastDate: sorted[sorted.length - 1].date,
    });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

export function buildInsights(txs: Transaction[], month: string, overrides: Budget[]): Insight[] {
  const out: Insight[] = [];
  const cov = coverage(txs, month);
  const partial = cov > 0 && cov < 1;
  const cur = summarise(txs, month);
  const hist = [1, 2, 3].map(i => summarise(txs, shiftMonth(month, -i))).filter(h => h.spend > 0 || h.income > 0);

  // 1. Uncertain categorisations: cheapest action with the biggest data-quality payoff.
  const reviewTx = txs.filter(t => t.needsReview);
  const review = new Set(reviewTx.map(t => t.merchantKey)).size;
  if (review) {
    out.push({
      id: 'review', tone: 'info', action: 'review',
      title: `${review} merchant${review > 1 ? 's' : ''} to check (${reviewTx.length} payments)`,
      detail: 'One tap per merchant. Your answer is remembered, so this list shrinks every month.',
    });
  }

  // 2. Budget pace.
  const allLines = budgetLines(txs, month, overrides);
  const lines = new Map(allLines.map(l => [l.category, l]));
  const explained = new Set<string>(); // transactions already called out, so we don't repeat ourselves
  const bigOne = (c: string, spent: number) => {
    const top = txs.filter(t => t.category === c && monthKey(t.date) === month && t.amount < 0).sort((a, b) => a.amount - b.amount)[0];
    if (!top || -top.amount < spent * 0.5) return '';
    explained.add(top.id);
    return ` Mostly one ${money0(-top.amount)} payment at ${nice(top.counterparty)}.`;
  };
  for (const b of allLines) {
    const label = cat(b.category).label;
    if (!partial && b.spent > b.limit * 1.05) {
      out.push({
        id: `over-${b.category}`, tone: 'bad', category: b.category, action: 'category',
        title: `${label} went ${money0(b.spent - b.limit)} over budget`,
        detail: `${money0(b.spent)} spent against ${money0(b.limit)}${b.auto ? ' (your usual level)' : ''}.${bigOne(b.category, b.spent)}`,
      });
    } else if (partial && b.projected - b.limit >= Math.max(15, b.limit * 0.1)) {
      const daysLeft = Math.max(1, Math.round(daysInMonth(month) * (1 - cov)));
      const room = b.limit - b.spent;
      out.push({
        id: `pace-${b.category}`, tone: room > 0 ? 'warn' : 'bad', category: b.category, action: 'category',
        title: room > 0 ? `${label} is heading for ${money0(b.projected)}` : `${label} budget is used up`,
        detail: room > 0
          ? `Budget ${money0(b.limit)}. ${money0(room)} left for the next ${daysLeft} days; you usually spend ${money0(b.projected - b.spent)} in that time.`
          : `${money0(b.spent)} spent against ${money0(b.limit)}${b.auto ? ' (your usual level)' : ''}, with ${daysLeft} days to go.${bigOne(b.category, b.spent)}`,
      });
    }
  }

  // 3. Biggest movers vs. your 3-month average.
  if (hist.length >= 2) {
    const movers = CATEGORIES.filter(c => c.kind === 'expense' && c.id !== 'other').map(c => {
      const now = partial ? (lines.get(c.id)?.projected ?? cur.byCategory[c.id] ?? 0) : (cur.byCategory[c.id] ?? 0);
      const avg = hist.reduce((a, h) => a + (h.byCategory[c.id] ?? 0), 0) / hist.length;
      return { c, now, avg, diff: now - avg };
    }).filter(m => Math.abs(m.diff) >= Math.max(40, m.avg * 0.25) && (m.now > 0 || m.avg > 0))
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 2);
    for (const m of movers) {
      const up = m.diff > 0;
      if (out.some(o => o.category === m.c.id)) continue;
      out.push({
        id: `move-${m.c.id}`, tone: up ? 'warn' : 'good', category: m.c.id, action: 'category',
        title: `${m.c.label} ${up ? 'up' : 'down'} ${money0(Math.abs(m.diff))} vs. your average`,
        detail: `${partial ? 'Heading for' : 'Spent'} ${money0(m.now)} this month; you usually spend ${money0(m.avg)}.`,
      });
    }
  }

  // 4. Unusual single payments.
  const recentAbs = (c: string) =>
    txs.filter(t => t.category === c && t.amount < 0 && monthKey(t.date) < month && monthKey(t.date) >= shiftMonth(month, -6)).map(t => -t.amount);
  const unusual = txs
    .filter(t => monthKey(t.date) === month && t.amount < 0 && isExpenseCat(t.category) && t.category !== 'housing' && !explained.has(t.id))
    .filter(t => {
      const base = recentAbs(t.category);
      return base.length >= 3 && -t.amount >= Math.max(100, median(base) * 4);
    })
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 2);
  for (const t of unusual) {
    out.push({
      id: `unusual-${t.id}`, tone: 'info', category: t.category, action: 'category',
      title: `Unusual: ${money0(-t.amount)} at ${nice(t.counterparty)}`,
      detail: `Much larger than your typical ${cat(t.category).label.toLowerCase()} payment. Worth a look if you don't recognise it.`,
    });
  }

  // 5. Recurring costs: price increases are the highest-value find.
  for (const r of detectRecurring(txs, month)) {
    if (monthKey(r.lastDate) !== month) continue;
    if (r.last > r.previous * 1.05 && r.last - r.previous >= 1) {
      out.push({
        id: `price-${r.merchantKey}`, tone: 'warn', category: r.category, action: 'category',
        title: `${nice(r.name)} raised its price`,
        detail: `${money(r.previous)} → ${money(r.last)} per payment (+${money0((r.last - r.previous) * 12)}/year).`,
      });
    }
  }

  // 6. Savings rate.
  if (!partial && cur.savingsRate !== null && hist.length) {
    const prevRates = hist.filter(h => h.income > 0).map(h => h.net / h.income);
    const avg = prevRates.length ? prevRates.reduce((a, b) => a + b, 0) / prevRates.length : null;
    const r = cur.savingsRate;
    if (avg !== null && Math.abs(r - avg) >= 0.05) {
      out.push({
        id: 'savings', tone: r > avg ? 'good' : 'warn',
        title: `You kept ${Math.round(r * 100)}% of your income in ${monthLabel(month, 'long')}`,
        detail: `Your recent average is ${Math.round(avg * 100)}%: that's ${money0(Math.abs(cur.net - avg * cur.income))} ${r > avg ? 'more' : 'less'} than usual.`,
      });
    }
  }

  const rank = { bad: 0, warn: 1, info: 2, good: 3 } as const;
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, 7);
}
