import { db } from './db';
import { decode, merchantKey, parseKbcCsv, rowId, type ParsedRow } from './kbc';
import { matchRule } from './rules';
import { UNCATEGORISED } from './categories';
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

export async function importStatement(file: File): Promise<ImportSummary> {
  const text = decode(await file.arrayBuffer());
  const { rows, warnings } = parseKbcCsv(text);
  if (!rows.length) throw new Error('No transactions found in this file.');

  const existingAccounts = (await db.transactions.orderBy('account').uniqueKeys()) as string[];
  const ownAccounts = new Set([...existingAccounts, ...rows.map(r => r.account)].filter(Boolean));
  const memory = new Map((await db.memory.toArray()).map(m => [m.merchantKey, m]));

  const withIds = rows.map(r => ({ r, id: rowId(r) }));
  const existing = new Set((await db.transactions.bulkGet(withIds.map(x => x.id))).filter(Boolean).map(t => t!.id));
  const seen = new Set<string>();
  const now = Date.now();
  const fresh: Transaction[] = [];

  for (const { r, id } of withIds) {
    if (existing.has(id) || seen.has(id)) continue;
    seen.add(id);
    fresh.push({
      id,
      account: r.account,
      date: r.date,
      amount: r.amount,
      currency: r.currency,
      balance: r.balance,
      description: r.description,
      counterparty: r.counterparty,
      counterpartyAccount: r.counterpartyAccount,
      message: r.message,
      importedAt: now,
      ...categorise(r, memory, ownAccounts),
    });
  }

  await db.transactions.bulkAdd(fresh);

  // A newly seen own account can turn earlier "payments" into internal transfers.
  await db.transactions
    .filter(t => !!t.counterpartyAccount && ownAccounts.has(t.counterpartyAccount) && t.category !== 'internal' && t.source !== 'manual')
    .modify({ category: 'internal', source: 'rule', confidence: 1, needsReview: false });

  const dates = rows.map(r => r.date).sort();
  await db.imports.add({
    fileName: file.name,
    importedAt: now,
    rows: rows.length,
    added: fresh.length,
    duplicates: rows.length - fresh.length,
    from: dates[0],
    to: dates[dates.length - 1],
  });

  return {
    fileName: file.name,
    rows: rows.length,
    added: fresh.length,
    duplicates: rows.length - fresh.length,
    autoCategorised: fresh.filter(t => t.source !== 'none').length,
    pendingAi: fresh.filter(t => t.source === 'none').length,
    warnings,
  };
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
