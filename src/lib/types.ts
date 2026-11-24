export type CategoryKind = 'expense' | 'income' | 'transfer';

/** Where a transaction's category came from — drives trust and the review queue. */
export type CategorySource = 'manual' | 'memory' | 'rule' | 'ai' | 'none';

export interface Transaction {
  id: string;               // stable hash, used for de-duplication across imports
  account: string;          // own IBAN
  date: string;             // ISO yyyy-mm-dd (execution date)
  amount: number;           // signed, EUR; negative = money out
  currency: string;
  balance?: number;
  description: string;      // KBC "Omschrijving"
  counterparty: string;     // best-effort merchant / payee name
  counterpartyAccount?: string;
  message?: string;         // structured or free communication
  merchantKey: string;      // normalised key for learning ("COLRUYT")
  category: string;         // category id
  source: CategorySource;
  confidence: number;       // 0..1
  needsReview: boolean;
  importedAt: number;
  origin: 'csv' | 'psd2';   // where the row came from; both can describe the same payment
  pending?: boolean;        // PSD2 only: authorised but not yet booked (e.g. a fresh card payment)
}

export interface MerchantMemory {
  merchantKey: string;
  category: string;
  source: 'manual' | 'ai';
  updatedAt: number;
}

export interface Budget {
  category: string;
  monthly: number;          // positive EUR limit
  auto: boolean;            // true = suggested from history, false = set by user
}

export interface ImportRecord {
  id?: number;
  fileName: string;
  importedAt: number;
  rows: number;
  added: number;
  duplicates: number;
  from: string;
  to: string;
}

export interface Settings {
  apiKey: string;
  model: string;
  aiEnabled: boolean;
  syncUrl: string;          // local Ponton sync helper; empty = PSD2 off
}
