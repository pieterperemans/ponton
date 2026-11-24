import { db } from './db';
import { decode, merchantKey, parseKbcCsv, rowId, type ParsedRow } from './kbc';
import { matchRule } from './rules';
import { UNCATEGORISED } from './categories';
import { planMerge } from './merge';
import type { MerchantSample } from './ai';
import type { MerchantMemory, Settings, Transaction } from './types';

export const REVIEW_THRESHOLD = 0.7;

/**
 * Categorisation order, cheapest and most trusted first:
 *   1. transfer between the user's own accounts
 *   2. what the user (or Claude, earlier) decided for this merchant
 *   3. built-in Belgian merchant rules
 *   4. left for Claude
 */
export function categorise(
  row: ParsedRow,
  memory: Map<string, MerchantMemory>,
  ownAccounts: Set<string>,
): Pick<Transaction, 'merchantKey' | 'category' | 'source' | 'confidence' | 'needsReview'> {
  const key = merchantKey(row.counterparty);
  if (row.counterpartyAccount && ownAccounts.has(row.counterpartyAccount)) {
    return { merchantKey: key, category: 'internal', source: 'rule', confidence: 1, needsReview: false };
  }
  const mem = memory.get(key);
  if (mem) {
    return { merchantKey: key, category: mem.category, source: 'memory', confidence: mem.source === 'manual' ? 1 : 0.85, needsReview: false };
  }
  const rule = matchRule(`${row.counterparty} ${row.description}`, row.amount);
  if (rule) return { merchantKey: key, category: rule, source: 'rule', confidence: 0.9, needsReview: false };
  return { merchantKey: key, category: UNCATEGORISED, source: 'none', confidence: 0, needsReview: true };
}

export interface ImportSummary {
  fileName: string;
  rows: number;
  added: number;
  duplicates: number;
  autoCategorised: number;
  pendingAi: number;
  warnings: string[];
}

/** Shared by CSV import and PSD2 sync: de-duplicate, categorise, store. */
export async function ingestRows(
  rows: ParsedRow[],
  origin: 'csv' | 'psd2',
  idFor: (r: ParsedRow) => string,
  syncedAccounts: Set<string> = new Set(),
) {
  const existing = await db.transactions.toArray();
  const ownAccounts = new Set([...existing.map(t => t.account), ...rows.map(r => r.account), ...syncedAccounts].filter(Boolean));
  const memory = new Map((await db.memory.toArray()).map(m => [m.merchantKey, m]));
  const plan = planMerge(existing, rows.map(r => ({ id: idFor(r), row: r })), origin, syncedAccounts);
  const now = Date.now();

  const fresh: Transaction[] = plan.add.map(({ id, row: r, inherit }) => {
    const auto = categorise(r, memory, ownAccounts);
    const keep = inherit && inherit.source === 'manual'
      ? { category: inherit.category, source: inherit.source, confidence: inherit.confidence, needsReview: false }
      : {};
    return {
      id, origin,
      account: r.account, date: r.date, amount: r.amount, currency: r.currency, balance: r.balance,
      description: r.description, counterparty: r.counterparty, counterpartyAccount: r.counterpartyAccount,
      message: r.message, pending: r.pending || undefined, importedAt: now,
      ...auto, ...keep,
    };
  });

  await db.transaction('rw', db.transactions, async () => {
    if (plan.remove.length) await db.transactions.bulkDelete(plan.remove);
    if (fresh.length) await db.transactions.bulkAdd(fresh);
    // A newly seen own account can turn earlier "payments" into internal transfers.
    await db.transactions
      .filter(t => !!t.counterpartyAccount && ownAccounts.has(t.counterpartyAccount) && t.category !== 'internal' && t.source !== 'manual')
      .modify({ category: 'internal', source: 'rule', confidence: 1, needsReview: false });
  });

  return {
    added: fresh.length,
    duplicates: plan.duplicates,
    removed: plan.remove.length,
    autoCategorised: fresh.filter(t => t.source !== 'none').length,
    pendingAi: fresh.filter(t => t.source === 'none').length,
  };
}

export async function importStatement(file: File): Promise<ImportSummary> {
  const text = decode(await file.arrayBuffer());
  const { rows, warnings } = parseKbcCsv(text);
  if (!rows.length) throw new Error('No transactions found in this file.');
  const r = await ingestRows(rows, 'csv', rowId);
  const dates = rows.map(x => x.date).sort();
  await db.imports.add({
    fileName: file.name, importedAt: Date.now(), rows: rows.length, added: r.added,
    duplicates: r.duplicates, from: dates[0], to: dates[dates.length - 1],
  });
  return { fileName: file.name, rows: rows.length, ...r, warnings };
}

/** Sends one entry per unknown merchant (not per transaction) to Claude, then learns the answer. */
export async function runAiCategorisation(settings: Settings, onProgress?: (d: number, t: number) => void) {
  const pending = await db.transactions.filter(t => t.source === 'none').toArray();
  if (!pending.length) return { merchants: 0, updated: 0 };

  const groups = new Map<string, Transaction[]>();
  for (const t of pending) groups.set(t.merchantKey, [...(groups.get(t.merchantKey) ?? []), t]);

  const samples: MerchantSample[] = [...groups.entries()].map(([key, txs]) => {
    const amounts = txs.map(t => t.amount).sort((a, b) => a - b);
    return {
      merchantKey: key,
      counterparty: txs[0].counterparty,
      examples: [...new Set(txs.map(t => `${t.description} ${t.message ?? ''}`.trim()))].slice(0, 2),
      typicalAmount: amounts[Math.floor(amounts.length / 2)],
      count: txs.length,
    };
  });

  const { categoriseWithClaude } = await import('./ai'); // SDK only loads when AI is actually used
  const verdicts = await categoriseWithClaude(samples, { apiKey: settings.apiKey, model: settings.model, onProgress });
  const now = Date.now();
  let updated = 0;

  await db.transaction('rw', [db.transactions, db.memory], async () => {
    for (const v of verdicts) {
      // Only remember confident answers; uncertain ones stay per-transaction until the user confirms.
      if (v.confidence >= REVIEW_THRESHOLD) {
        await db.memory.put({ merchantKey: v.merchantKey, category: v.category, source: 'ai', updatedAt: now });
      }
      updated += await db.transactions
        .where('merchantKey').equals(v.merchantKey)
        .filter(t => t.source === 'none')
        .modify({ category: v.category, source: 'ai', confidence: v.confidence, needsReview: v.confidence < REVIEW_THRESHOLD });
    }
  });
  return { merchants: samples.length, updated };
}

/** User correction: learn it for the merchant and apply to every non-manual transaction from it. */
export async function setMerchantCategory(key: string, category: string) {
  await db.transaction('rw', [db.transactions, db.memory], async () => {
    await db.memory.put({ merchantKey: key, category, source: 'manual', updatedAt: Date.now() });
    await db.transactions
      .where('merchantKey').equals(key)
      .filter(t => t.source !== 'manual')
      .modify({ category, source: 'memory', confidence: 1, needsReview: false });
  });
}

/** One-off override for a single transaction (e.g. a gift bought at a supermarket). */
export async function setTransactionCategory(id: string, category: string) {
  await db.transactions.update(id, { category, source: 'manual', confidence: 1, needsReview: false });
}

export async function confirmTransaction(id: string) {
  const t = await db.transactions.get(id);
  if (t) await setMerchantCategory(t.merchantKey, t.category);
}
