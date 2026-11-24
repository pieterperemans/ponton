import { describe, expect, it } from 'vitest';
import { extractMerchant, merchantKey, parseAmount, parseDate, parseKbcCsv, rowId } from './kbc';
import { matchRule } from './rules';
import { mask } from './ai';
import { sampleKbcCsv } from './sample';

describe('number and date parsing', () => {
  it('handles Belgian formats', () => {
    expect(parseAmount('-1.234,56')).toBe(-1234.56);
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount('12.50')).toBe(12.5);
    expect(parseAmount('')).toBeUndefined();
    expect(parseDate('03/02/2026')).toBe('2026-02-03');
    expect(parseDate('3.2.26')).toBe('2026-02-03');
    expect(parseDate('2026-02-03')).toBe('2026-02-03');
  });
});

describe('merchant extraction', () => {
  it('pulls the merchant out of a card payment', () => {
    const d = 'BETALING MET DEBETKAART NUMMER 4871 04XX XXXX 1234 COLRUYT HALLE 15/03 OM 17.32 UUR BANCONTACT';
    expect(extractMerchant(d, '')).toBe('COLRUYT HALLE');
    expect(merchantKey('COLRUYT HALLE')).toBe('COLRUYT');
    expect(merchantKey('Colruyt Gent 1234')).toBe('COLRUYT');
    expect(merchantKey('BOL.COM')).toBe('BOL COM');
  });
  it('reads the creditor of a direct debit', () => {
    expect(extractMerchant('EUROPESE DOMICILIERING SCHULDEISER : PROXIMUS REF. : 123', '')).toBe('PROXIMUS');
  });
  it('prefers the counterparty column', () => {
    expect(extractMerchant('whatever', 'ACME NV')).toBe('ACME NV');
  });
});

describe('KBC CSV', () => {
  const csv = sampleKbcCsv(new Date(2026, 10, 24));
  const res = parseKbcCsv(csv);

  it('parses every row of a KBC export', () => {
    expect(res.rows.length).toBe(csv.trim().split('\n').length - 1);
    expect(res.skipped).toBe(0);
    expect(res.rows[0].account).toBe('BE68539007547034');
  });
  it('gives stable, unique ids', () => {
    const ids = res.rows.map(rowId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rowId(res.rows[0])).toBe(rowId({ ...res.rows[0] }));
  });
  it('rejects non-KBC files with a helpful message', () => {
    expect(() => parseKbcCsv('foo,bar\n1,2')).toThrow(/KBC/);
  });
  it('accepts French headers', () => {
    const fr = 'Numéro de compte;Date;Description;Montant;Devise\nBE1;01/02/2026;PAIEMENT;-5,00;EUR';
    const r = parseKbcCsv(fr);
    expect(r.rows[0]).toMatchObject({ date: '2026-02-01', amount: -5, description: 'PAIEMENT' });
  });
});

describe('rules', () => {
  it('categorises common Belgian merchants', () => {
    expect(matchRule('COLRUYT HALLE', -50)).toBe('groceries');
    expect(matchRule('PROXIMUS', -90)).toBe('utilities');
    expect(matchRule('UBER EATS', -20)).toBe('eating_out');
    expect(matchRule('UBER', -20)).toBe('transport');
    expect(matchRule('ACME NV LOON', 3000)).toBe('salary');
    expect(matchRule('ACME NV LOON', -3000)).toBeUndefined();
    expect(matchRule('HOUTHANDEL VERMEULEN', -40)).toBeUndefined();
  });
});

describe('privacy masking', () => {
  it('removes IBANs and card numbers before sending to Claude', () => {
    const m = mask('OVERSCHRIJVING NAAR BE68 5390 0754 7034 DEBETKAART 4871 04XX XXXX 1234');
    expect(m).not.toMatch(/5390|7034|1234/);
  });
});
