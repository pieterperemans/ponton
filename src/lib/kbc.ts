import Papa from 'papaparse';

/**
 * KBC Belgium statement parser.
 *
 * KBC (Touch / Business) exports a semicolon-separated CSV with Dutch, French or English
 * headers, dd/mm/yyyy dates and decimal commas. Rather than trusting column positions we
 * map headers by name, so a reordered or extended export still parses.
 */

export interface ParsedRow {
  account: string;
  date: string;
  amount: number;
  currency: string;
  balance?: number;
  description: string;
  counterparty: string;
  counterpartyAccount?: string;
  message?: string;
  statement?: string;
  pending?: boolean;
  externalId?: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  skipped: number;
  warnings: string[];
}

type Field =
  | 'account' | 'statement' | 'date' | 'valueDate' | 'amount' | 'credit' | 'debit'
  | 'currency' | 'balance' | 'description' | 'cpName' | 'cpAccount' | 'structured' | 'free';

const ALIASES: Record<Field, string[]> = {
  account:     ['rekeningnummer', 'numero de compte', 'n° de compte', 'account number', 'account'],
  statement:   ['afschriftnummer', "numero d'extrait", 'n° extrait', 'statement number'],
  date:        ['datum', 'date', 'uitvoeringsdatum', "date d'execution", 'boekingsdatum', 'transaction date'],
  valueDate:   ['valuta', 'valutadatum', 'date valeur', 'value date'],
  amount:      ['bedrag', 'montant', 'amount'],
  credit:      ['credit'],
  debit:       ['debet', 'debit'],
  currency:    ['munt', 'devise', 'currency'],
  balance:     ['saldo', 'solde', 'balance'],
  description: ['omschrijving', 'description', 'libelle', 'details'],
  cpName:      ['naam tegenpartij', 'nom de la contrepartie', 'nom contrepartie', 'counterparty name', 'name counterparty'],
  cpAccount:   ['rekeningnummer tegenpartij', 'compte contrepartie', 'compte de la contrepartie', 'counterparty account', 'account counterparty'],
  structured:  ['gestructureerde mededeling', 'communication structuree', 'structured communication'],
  free:        ['vrije mededeling', 'communication libre', 'free communication', 'mededeling', 'communication'],
};

export const normHeader = (h: string) =>
  h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function mapHeaders(headers: string[]): Partial<Record<Field, number>> {
  const normed = headers.map(normHeader);
  const map: Partial<Record<Field, number>> = {};
  for (const field of Object.keys(ALIASES) as Field[]) {
    const idx = normed.findIndex(h => ALIASES[field].includes(h));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

/** "1.234,56" / "-12,50" / "12.50" / "€ 3,00" → number */
export function parseAmount(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  let s = raw.replace(/[€\s ]/g, '').trim();
  if (!s) return undefined;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy or ISO → yyyy-mm-dd */
export function parseDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return undefined;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** KBC exports are often Windows-1252; fall back when the bytes aren't valid UTF-8. */
export function decode(buf: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1252').decode(buf);
  }
  return text.replace(/^﻿/, '');
}

function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [';', ',', '\t'].map(d => [d, first.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Best-effort merchant name. KBC puts the payee in "Naam tegenpartij" for transfers and
 * direct debits, but for card payments it's buried in the description:
 *   "BETALING MET DEBETKAART NUMMER 4871 04XX XXXX 1234 COLRUYT HALLE 15/03 OM 17.32 UUR ..."
 */
export function extractMerchant(description: string, cpName: string): string {
  if (cpName) return cpName;
  const d = description.toUpperCase();
  const patterns: RegExp[] = [
    /(?:DEBETKAART|KREDIETKAART|CARTE DE DEBIT|CARTE DE CREDIT|DEBIT CARD|CREDIT CARD)\s+(?:NUMMER|NUMERO|NUMBER)?\s*[\dX ]{8,}\s+(.+?)\s+\d{1,2}\/\d{1,2}/,
    /(?:SCHULDEISER|CREANCIER|CREDITOR)\s*:\s*(.+?)(?:\s+(?:REF|REFERENTIE|REFERENCE|MANDAAT|MANDAT)\b|$)/,
    /(?:APPLE PAY|GOOGLE PAY|PAYCONIQ)[^A-Z]*(.+?)\s+\d{1,2}\/\d{1,2}/,
  ];
  for (const p of patterns) {
    const m = d.match(p);
    if (m?.[1]) return clean(m[1]);
  }
  return clean(description).split(' ').slice(0, 6).join(' ');
}

const NOISE = new Set([
  'NV', 'SA', 'BV', 'BVBA', 'SRL', 'SPRL', 'VZW', 'ASBL', 'CV', 'SC', 'BELGIUM', 'BELGIE', 'BELGIQUE',
  'BE', 'BRU', 'BRUSSEL', 'BRUXELLES', 'THE', 'DE', 'LA', 'LE', 'LES', 'HET', 'EUR', 'WWW',
]);

/** Normalised key so "COLRUYT HALLE" and "Colruyt Gent 1234" learn as one merchant. */
export function merchantKey(name: string): string {
  const tokens = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9&]+/g, ' ')
    .split(' ')
    .filter(t => t && !/\d/.test(t) && !NOISE.has(t));
  if (!tokens.length) return name.toUpperCase().trim() || 'UNKNOWN';
  return tokens[0].length >= 4 || tokens.length === 1 ? tokens[0] : `${tokens[0]} ${tokens[1]}`;
}

export function parseKbcCsv(text: string): ParseResult {
  const delimiter = detectDelimiter(text);
  const parsed = Papa.parse<string[]>(text.trim(), { delimiter, skipEmptyLines: 'greedy' });
  const [header, ...data] = parsed.data;
  if (!header) throw new Error('The file is empty.');

  const map = mapHeaders(header);
  const missing = (['date', 'description'] as Field[]).filter(f => map[f] === undefined);
  if (map.amount === undefined && (map.credit === undefined || map.debit === undefined)) missing.push('amount');
  if (missing.length) {
    throw new Error(
      `This doesn't look like a KBC statement export: missing ${missing.join(', ')} column(s). ` +
      `Found: ${header.slice(0, 8).join(' | ')}`,
    );
  }

  const get = (row: string[], f: Field) => (map[f] === undefined ? undefined : row[map[f]!]);
  const rows: ParsedRow[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (const row of data) {
    const date = parseDate(get(row, 'date')) ?? parseDate(get(row, 'valueDate'));
    let amount = parseAmount(get(row, 'amount'));
    if (amount === undefined) {
      const c = parseAmount(get(row, 'credit')) ?? 0;
      const d = parseAmount(get(row, 'debit')) ?? 0;
      amount = c - Math.abs(d);
    }
    const description = clean(get(row, 'description'));
    if (!date || amount === undefined || (!description && !get(row, 'cpName'))) {
      skipped++;
      continue;
    }
    const cpName = clean(get(row, 'cpName'));
    const structured = clean(get(row, 'structured'));
    const free = clean(get(row, 'free'));
    rows.push({
      account: clean(get(row, 'account')).replace(/\s/g, ''),
      statement: clean(get(row, 'statement')) || undefined,
      date,
      amount,
      currency: clean(get(row, 'currency')) || 'EUR',
      balance: parseAmount(get(row, 'balance')),
      description,
      counterparty: extractMerchant(description, cpName),
      counterpartyAccount: clean(get(row, 'cpAccount')).replace(/\s/g, '') || undefined,
      message: [structured, free].filter(Boolean).join(' · ') || undefined,
    });
  }

  if (skipped) warnings.push(`${skipped} row(s) skipped: missing date, amount or description.`);
  const foreign = rows.filter(r => r.currency !== 'EUR').length;
  if (foreign) warnings.push(`${foreign} row(s) are not in EUR and are counted at face value.`);
  return { rows, skipped, warnings };
}

/** 53-bit FNV-1a: stable id for de-duplicating overlapping statement imports. */
export function rowId(r: ParsedRow): string {
  const key = [r.account, r.date, r.amount.toFixed(2), r.balance ?? '', r.description, r.statement ?? ''].join('|');
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822507);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
