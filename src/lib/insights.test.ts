import { describe, expect, it } from 'vitest';
import { parseKbcCsv, rowId } from './kbc';
import { categorise } from './pipeline';
import { buildInsights, budgetLines, detectRecurring, summarise } from './insights';
import { sampleKbcCsv } from './sample';
import type { Transaction } from './types';

const rows = parseKbcCsv(sampleKbcCsv(new Date(2026, 10, 24))).rows;
const own = new Set(['BE68539007547034', 'BE71096123456769']);
const txs: Transaction[] = rows.map(r => ({
  ...r, id: rowId(r), importedAt: 0, origin: 'csv' as const, ...categorise(r, new Map(), own),
}));

describe('pipeline + insights on sample data', () => {
  it('auto-categorises most transactions without AI', () => {
    const share = txs.filter(t => t.source !== 'none').length / txs.length;
    expect(share).toBeGreaterThan(0.8);
  });
  it('treats savings transfers as internal, not spending', () => {
    expect(txs.find(t => t.counterparty === 'SPAARREKENING')?.category).toBe('internal');
  });
  it('summarises a month', () => {
    const s = summarise(txs, '2026-10');
    expect(s.income).toBeGreaterThan(3000);
    expect(s.spend).toBeGreaterThan(1500);
  });
  it('detects subscriptions and the Spotify price rise', () => {
    const rec = detectRecurring(txs, '2026-11');
    expect(rec.map(r => r.merchantKey)).toEqual(expect.arrayContaining(['NETFLIX', 'SPOTIFY', 'PROXIMUS']));
    expect(rec.some(r => r.merchantKey === 'COLRUYT')).toBe(false);
  });
  it('suggests budgets and produces actionable insights', () => {
    expect(budgetLines(txs, '2026-11', []).length).toBeGreaterThan(4);
    const ins = buildInsights(txs, '2026-11', []);
    console.log(ins.map(i => `[${i.tone}] ${i.title} — ${i.detail}`).join('\n'));
    expect(ins.length).toBeGreaterThan(2);
  });
});
