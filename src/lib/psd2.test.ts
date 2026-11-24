import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { normaliseEb, normaliseSync, psd2Id, type EbTransaction, type SyncAccount } from './psd2';
import { planMerge } from './merge';
import { rowId, type ParsedRow } from './kbc';
import type { Transaction } from './types';

const acc: SyncAccount = { uid: 'u1', iban: 'BE68 5390 0754 7034', transactions: [] };
const IBAN = 'BE68539007547034';

const card = (date: string, amount: string, status = 'BOOK', ref: string | null = `R${date}${amount}`): EbTransaction => ({
  entry_reference: status === 'PDNG' ? null : ref,
  transaction_amount: { currency: 'EUR', amount },
  credit_debit_indicator: 'DBIT',
  status,
  booking_date: status === 'PDNG' ? null : date,
  transaction_date: date,
  remittance_information: [`BETALING MET DEBETKAART NUMMER 4871 04XX XXXX 1234 COLRUYT HALLE ${date.slice(8)}/${date.slice(5, 7)} OM 17.32 UUR`],
});

const tx = (row: ParsedRow, id: string, origin: 'csv' | 'psd2', extra: Partial<Transaction> = {}): Transaction => ({
  ...row, id, origin, merchantKey: 'COLRUYT', category: 'groceries', source: 'rule', confidence: 0.9,
  needsReview: false, importedAt: 0, pending: row.pending || undefined, ...extra,
});

describe('PSD2 normalisation', () => {
  it('maps a debit card payment like the CSV parser would', () => {
    const r = normaliseEb(card('2026-11-20', '42.10'), acc)!;
    expect(r).toMatchObject({ account: IBAN, date: '2026-11-20', amount: -42.1, counterparty: 'COLRUYT HALLE', pending: false });
  });
  it('uses debtor name for incoming money and keeps the message', () => {
    const r = normaliseEb({
      transaction_amount: { amount: '3420.00', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK',
      booking_date: '2026-11-25', debtor: { name: 'ACME NV' }, debtor_account: { iban: 'BE10 3630 1234 5604' }, remittance_information: ['LOON'],
    }, acc)!;
    expect(r).toMatchObject({ amount: 3420, counterparty: 'ACME NV', counterpartyAccount: 'BE10363012345604', message: 'LOON' });
  });
  it('skips rows without a usable date or amount', () => {
    expect(normaliseEb({ transaction_amount: { amount: 'x' }, booking_date: '2026-01-01' }, acc)).toBeUndefined();
    expect(normaliseEb({ transaction_amount: { amount: '1' } }, acc)).toBeUndefined();
  });
  it('gives booked rows the bank reference as id and pending rows a separate one', () => {
    const b = normaliseEb(card('2026-11-20', '1.00'), acc)!;
    const p = normaliseEb(card('2026-11-20', '1.00', 'PDNG'), acc)!;
    expect(psd2Id(b)).toBe(`eb:${IBAN}:R2026-11-201.00`);
    expect(psd2Id(p)).toMatch(/^eb:p:/);
  });
});

describe('merging CSV and PSD2', () => {
  const row = (date: string, amount: number, pending = false): ParsedRow =>
    ({ account: IBAN, date, amount, currency: 'EUR', description: 'x', counterparty: 'COLRUYT HALLE', pending });

  it('does not double-count a payment seen in both sources', () => {
    const fromBank = tx(row('2026-11-20', -42.1), 'eb:1', 'psd2');
    const plan = planMerge([fromBank], [{ id: 'csv1', row: row('2026-11-19', -42.1) }], 'csv');
    expect(plan.add).toHaveLength(0);
    expect(plan.duplicates).toBe(1);
  });
  it('keeps two identical payments as two (one-to-one matching)', () => {
    const one = tx(row('2026-11-20', -3), 'eb:1', 'psd2');
    const plan = planMerge([one], [{ id: 'c1', row: row('2026-11-20', -3) }, { id: 'c2', row: { ...row('2026-11-20', -3), description: 'y' } }], 'csv');
    expect(plan.add).toHaveLength(1);
  });
  it('replaces pending with booked and keeps a hand-set category', () => {
    const pend = tx(row('2026-11-23', -64.3, true), 'eb:p:abc', 'psd2', { category: 'gifts', source: 'manual' });
    const booked = row('2026-11-24', -64.3);
    const plan = planMerge([pend], [{ id: 'eb:new', row: booked }], 'psd2', new Set([IBAN]));
    expect(plan.remove).toEqual(['eb:p:abc']);
    expect(plan.add[0].inherit?.category).toBe('gifts');
  });
  it('drops a pending payment that disappeared (cancelled authorisation)', () => {
    const pend = tx(row('2026-11-23', -10, true), 'eb:p:gone', 'psd2');
    const plan = planMerge([pend], [], 'psd2', new Set([IBAN]));
    expect(plan.remove).toEqual(['eb:p:gone']);
  });
  it('a later CSV import confirms a pending PSD2 row', () => {
    const pend = tx(row('2026-11-23', -10, true), 'eb:p:1', 'psd2');
    const plan = planMerge([pend], [{ id: rowId(row('2026-11-23', -10)), row: row('2026-11-23', -10) }], 'csv');
    expect(plan.remove).toEqual(['eb:p:1']);
    expect(plan.add).toHaveLength(1);
  });
  it('does not match across accounts or beyond 4 days', () => {
    const t = tx(row('2026-11-01', -50), 'eb:1', 'psd2');
    expect(planMerge([t], [{ id: 'c', row: row('2026-11-06', -50) }], 'csv').add).toHaveLength(1);
    expect(planMerge([t], [{ id: 'c', row: { ...row('2026-11-01', -50), account: 'BE00' } }], 'csv').add).toHaveLength(1);
  });
});

describe('sync helper (mock bank)', () => {
  it('connects, syncs and serves transactions over HTTP', async () => {
    const port = 18787;
    const dir = (await import('node:os')).tmpdir() + `/ponton-test-${Date.now()}`;
    const proc = spawn(process.execPath, ['server/ponton-sync.mjs', '--mock'], {
      env: { ...process.env, PONTON_PORT: String(port), PONTON_DATA: dir, PONTON_CONFIG: '/nonexistent' },
    });
    try {
      await new Promise<void>((ok, fail) => { proc.stdout.on('data', () => ok()); proc.on('exit', c => fail(new Error(`exit ${c}`))); });
      const base = `http://localhost:${port}`;
      expect((await (await fetch(`${base}/status`)).json()).connected).toBe(false);

      const { url } = await (await fetch(`${base}/connect`, { method: 'POST' })).json();
      const cb = await fetch(url.replace('8787', String(port)), { redirect: 'manual' });
      expect(cb.status).toBe(302);

      const data = await (await fetch(`${base}/transactions?refresh=1`)).json();
      expect(data.connected).toBe(true);
      const rows = normaliseSync(data.accounts);
      expect(rows.length).toBeGreaterThan(40);
      expect(rows.filter(r => r.pending)).toHaveLength(2);

      // Cross-site requests are refused.
      expect((await fetch(`${base}/status`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    } finally {
      proc.kill();
    }
  });
});
