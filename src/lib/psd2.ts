import { extractMerchant, rowId, type ParsedRow } from './kbc';

/**
 * Enable Banking transaction shape (Berlin Group / ISO 20022 style). Only the fields Ponton uses;
 * everything is optional because banks fill them inconsistently.
 */
export interface EbTransaction {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount?: { currency?: string; amount?: string | number };
  credit_debit_indicator?: 'CRDT' | 'DBIT';
  status?: string;                       // BOOK | PDNG | ...
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: { name?: string | null } | null;
  creditor_account?: { iban?: string | null } | null;
  debtor?: { name?: string | null } | null;
  debtor_account?: { iban?: string | null } | null;
  remittance_information?: string[] | null;
  bank_transaction_code?: { description?: string | null } | null;
  balance_after_transaction?: { balance_amount?: { amount?: string | number } } | null;
  note?: string | null;
}

export interface SyncAccount {
  uid: string;
  iban?: string;
  name?: string;
  transactions: EbTransaction[];
}

export interface SyncStatus {
  mock: boolean;
  configured: boolean;
  connected: boolean;
  bank: string;
  validUntil?: string;
  accounts: { uid: string; iban?: string; name?: string }[];
  lastRefresh?: string;
  lastError?: string;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export function normaliseEb(t: EbTransaction, account: SyncAccount): ParsedRow | undefined {
  const raw = Number(String(t.transaction_amount?.amount ?? '').replace(',', '.'));
  const date = (t.transaction_date ?? t.booking_date ?? t.value_date ?? '').slice(0, 10);
  if (!Number.isFinite(raw) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;

  const out = t.credit_debit_indicator ? t.credit_debit_indicator === 'DBIT' : raw < 0;
  const amount = out ? -Math.abs(raw) : Math.abs(raw);
  const cpName = clean(out ? t.creditor?.name : t.debtor?.name);
  const remittance = clean((t.remittance_information ?? []).join(' '));
  const description = remittance || clean(t.bank_transaction_code?.description) || clean(t.note);
  const balance = Number(t.balance_after_transaction?.balance_amount?.amount);

  return {
    account: (account.iban ?? account.uid).replace(/\s/g, ''),
    date,
    amount,
    currency: t.transaction_amount?.currency ?? 'EUR',
    balance: Number.isFinite(balance) ? balance : undefined,
    description,
    counterparty: extractMerchant(description, cpName),
    counterpartyAccount: clean(out ? t.creditor_account?.iban : t.debtor_account?.iban).replace(/\s/g, '') || undefined,
    // When the counterparty has its own field, the remittance text is the human message ("LOON", "etentje").
    message: cpName && remittance && !/DEBETKAART|DOMICILIERING/i.test(remittance) ? remittance : undefined,
    pending: t.status === 'PDNG',
    externalId: t.entry_reference ?? t.transaction_id ?? undefined,
  };
}

/** Stable id: the bank's own reference when booked, else a content hash. Pending ids are separate on purpose. */
export function psd2Id(r: ParsedRow): string {
  if (r.pending) return `eb:p:${rowId({ ...r, balance: undefined, statement: undefined })}`;
  return r.externalId ? `eb:${r.account}:${r.externalId}` : `eb:h:${rowId({ ...r, statement: undefined })}`;
}

export function normaliseSync(accounts: SyncAccount[]): ParsedRow[] {
  return accounts.flatMap(a => a.transactions.map(t => normaliseEb(t, a)).filter((r): r is ParsedRow => !!r));
}
