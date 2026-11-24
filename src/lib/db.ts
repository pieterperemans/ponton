import Dexie, { type Table } from 'dexie';
import type { Budget, ImportRecord, MerchantMemory, Settings, Transaction } from './types';
import { DEFAULT_MODEL } from './config';

/** Everything lives in the browser's IndexedDB. Nothing is sent anywhere except masked merchant info to Claude. */
class PontonDB extends Dexie {
  transactions!: Table<Transaction, string>;
  memory!: Table<MerchantMemory, string>;
  budgets!: Table<Budget, string>;
  imports!: Table<ImportRecord, number>;

  constructor() {
    super('ponton');
    this.version(1).stores({
      transactions: 'id, date, merchantKey, category, needsReview, account',
      memory: 'merchantKey',
      budgets: 'category',
      imports: '++id, importedAt',
    });
    this.version(2).stores({
      transactions: 'id, date, merchantKey, category, needsReview, account, origin',
    }).upgrade(tx => tx.table('transactions').toCollection().modify(t => { t.origin ??= 'csv'; }));
  }
}

export const db = new PontonDB();

const SETTINGS_KEY = 'ponton.settings';
const defaults: Settings = { apiKey: '', model: DEFAULT_MODEL, aiEnabled: true, syncUrl: 'http://localhost:8787' };

export function loadSettings(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export async function exportBackup(): Promise<Blob> {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    transactions: await db.transactions.toArray(),
    memory: await db.memory.toArray(),
    budgets: await db.budgets.toArray(),
    imports: await db.imports.toArray(),
  };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export async function restoreBackup(file: File) {
  const data = JSON.parse(await file.text());
  if (data?.version !== 1 || !Array.isArray(data.transactions)) throw new Error('Not a Ponton backup file.');
  await db.transaction('rw', [db.transactions, db.memory, db.budgets, db.imports], async () => {
    await Promise.all([db.transactions.clear(), db.memory.clear(), db.budgets.clear(), db.imports.clear()]);
    await db.transactions.bulkPut(data.transactions);
    await db.memory.bulkPut(data.memory ?? []);
    await db.budgets.bulkPut(data.budgets ?? []);
    await db.imports.bulkPut(data.imports ?? []);
  });
}

export async function wipeAll() {
  await Promise.all([db.transactions.clear(), db.memory.clear(), db.budgets.clear(), db.imports.clear()]);
}
