import type { CategoryKind } from './types';

export interface CategoryDef {
  id: string;
  label: string;
  kind: CategoryKind;
  color: string;
  emoji: string;
}

// Colour order chosen so neighbouring categories in charts stay distinguishable.
export const CATEGORIES: CategoryDef[] = [
  { id: 'groceries',     label: 'Groceries',            kind: 'expense',  color: '#10b981', emoji: '🛒' },
  { id: 'eating_out',    label: 'Eating out',           kind: 'expense',  color: '#f59e0b', emoji: '🍽️' },
  { id: 'housing',       label: 'Housing',              kind: 'expense',  color: '#6366f1', emoji: '🏠' },
  { id: 'utilities',     label: 'Energy & telecom',     kind: 'expense',  color: '#0ea5e9', emoji: '💡' },
  { id: 'transport',     label: 'Transport',            kind: 'expense',  color: '#8b5cf6', emoji: '🚆' },
  { id: 'insurance',     label: 'Insurance',            kind: 'expense',  color: '#64748b', emoji: '🛡️' },
  { id: 'health',        label: 'Health',               kind: 'expense',  color: '#ef4444', emoji: '🩺' },
  { id: 'shopping',      label: 'Shopping',             kind: 'expense',  color: '#ec4899', emoji: '🛍️' },
  { id: 'subscriptions', label: 'Subscriptions',        kind: 'expense',  color: '#14b8a6', emoji: '🔁' },
  { id: 'leisure',       label: 'Leisure & sport',      kind: 'expense',  color: '#f97316', emoji: '🎟️' },
  { id: 'travel',        label: 'Travel',               kind: 'expense',  color: '#06b6d4', emoji: '✈️' },
  { id: 'kids',          label: 'Kids & education',     kind: 'expense',  color: '#a855f7', emoji: '🎒' },
  { id: 'cash',          label: 'Cash withdrawals',     kind: 'expense',  color: '#84cc16', emoji: '💶' },
  { id: 'taxes_fees',    label: 'Taxes & bank fees',    kind: 'expense',  color: '#78716c', emoji: '🏛️' },
  { id: 'gifts',         label: 'Gifts & donations',    kind: 'expense',  color: '#e11d48', emoji: '🎁' },
  { id: 'other',         label: 'Other',                kind: 'expense',  color: '#a1a1aa', emoji: '•' },
  { id: 'salary',        label: 'Salary',               kind: 'income',   color: '#22c55e', emoji: '💼' },
  { id: 'other_income',  label: 'Benefits & refunds',   kind: 'income',   color: '#4ade80', emoji: '↩️' },
  { id: 'savings',       label: 'Savings & investing',  kind: 'transfer', color: '#3b82f6', emoji: '🏦' },
  { id: 'internal',      label: 'Own-account transfer', kind: 'transfer', color: '#cbd5e1', emoji: '⇄' },
];

export const UNCATEGORISED = 'other';

const byId = new Map(CATEGORIES.map(c => [c.id, c]));
export const cat = (id: string): CategoryDef => byId.get(id) ?? byId.get(UNCATEGORISED)!;
export const isExpenseCat = (id: string) => cat(id).kind === 'expense';
export const isIncomeCat = (id: string) => cat(id).kind === 'income';
