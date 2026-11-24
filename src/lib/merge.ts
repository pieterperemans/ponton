import type { ParsedRow } from './kbc';
import type { Transaction } from './types';

/**
 * Decides how a batch of incoming rows (from a CSV import or a PSD2 sync) lands in the store.
 *
 * The same payment can arrive twice: once from the bank feed and once from a later CSV export,
 * with different ids and slightly different dates (execution vs. booking). So besides exact id
 * matches we match across sources on account + exact amount + date within 4 days, one-to-one,
 * so two identical €3 coffees on the same day stay two coffees.
 *
 * Pending PSD2 rows are provisional: every sync replaces the account's whole pending set, and a
 * booked row that replaces a pending one inherits a category the user set by hand.
 */
export interface Incoming { id: string; row: ParsedRow }
export interface Plan {
  add: { id: string; row: ParsedRow; inherit?: Transaction }[];
  remove: string[];
  duplicates: number;
}

const MAX_DAYS = 4;
const cents = (n: number) => Math.round(n * 100);
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
const same = (t: Transaction, r: ParsedRow) =>
  t.account === r.account && cents(t.amount) === cents(r.amount) && dayDiff(t.date, r.date) <= MAX_DAYS;

export function planMerge(
  existing: Transaction[],
  incoming: Incoming[],
  origin: 'csv' | 'psd2',
  syncedAccounts: Set<string> = new Set(),
): Plan {
  const byId = new Map(existing.map(t => [t.id, t]));
  const incomingIds = new Set(incoming.map(i => i.id));
  const remove = new Set<string>();

  // PSD2: the bank's current pending list is the truth; anything else pending is gone or booked.
  const stalePending = origin === 'psd2'
    ? existing.filter(t => t.origin === 'psd2' && t.pending && syncedAccounts.has(t.account) && !incomingIds.has(t.id))
    : [];
  stalePending.forEach(t => remove.add(t.id));

  const used = new Set<string>();
  const seen = new Set<string>();
  const plan: Plan = { add: [], remove: [], duplicates: 0 };

  for (const inc of [...incoming].sort((a, b) => a.row.date.localeCompare(b.row.date))) {
    if (seen.has(inc.id)) { plan.duplicates++; continue; }
    seen.add(inc.id);
    if (byId.has(inc.id) && !remove.has(inc.id)) { plan.duplicates++; continue; }

    // Same payment already known from the other source (and booked)?
    const twin = existing.find(t =>
      !used.has(t.id) && !remove.has(t.id) && !t.pending && t.origin !== origin && same(t, inc.row));
    if (twin && !inc.row.pending) { used.add(twin.id); plan.duplicates++; continue; }
    if (twin && inc.row.pending) { plan.duplicates++; continue; } // already booked; the bank's pending copy is stale

    // A CSV row confirms a provisional PSD2 pending row: the booked CSV row wins.
    let inherit: Transaction | undefined;
    if (!inc.row.pending) {
      const pool = origin === 'csv'
        ? existing.filter(t => t.origin === 'psd2' && t.pending && !remove.has(t.id))
        : stalePending;
      inherit = pool.find(t => !used.has(t.id) && same(t, inc.row));
      if (inherit) { used.add(inherit.id); remove.add(inherit.id); }
    }
    plan.add.push({ ...inc, inherit });
  }
  plan.remove = [...remove];
  return plan;
}
