import type { DocStatus, DocType, DocumentRecord } from './types';

/** Amounts are compared in whole cents to avoid floating point drift. */
const toCents = (n: number) => Math.round((Number(n) || 0) * 100);

/** Today's date as YYYY-MM-DD in the user's LOCAL timezone (toISOString() uses UTC, which is wrong in Nairobi 00:00-03:00). */
export const todayLocal = (): string => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

export const DOC_PREFIX: Record<DocType, string> = {
  QUOTE: 'QT',
  INVOICE: 'INV',
  RECEIPT: 'RCT'
};

export const buildDocNumber = (type: DocType, chainCode: string): string =>
  `${DOC_PREFIX[type]}-${chainCode}`;

/**
 * Receipts are the source of truth for how much of an invoice has been paid.
 *
 * `documents.amount_paid` / `documents.status` on the invoice row are a cached copy that is
 * written in a separate request after the receipt is saved. If that write is rejected or never
 * happens, the cache goes stale and receivables stop reflecting payments. So whenever documents
 * are loaded we recompute every invoice's paid amount and status from its (non-void) receipts.
 * The stored value is still honoured when it is HIGHER, so legacy rows are never understated.
 */
export const applyPaymentTotals = (docs: DocumentRecord[]): DocumentRecord[] => {
  const receiptCentsByInvoice = new Map<string, number>();
  for (const d of docs) {
    if (d.doc_type === 'RECEIPT' && d.status !== 'VOID' && d.parent_id) {
      receiptCentsByInvoice.set(d.parent_id, (receiptCentsByInvoice.get(d.parent_id) ?? 0) + toCents(d.amount));
    }
  }

  return docs.map(d => {
    if (d.doc_type !== 'INVOICE' || d.status === 'VOID') return d;

    const totalCents = toCents(d.amount);
    const paidCents = Math.min(
      totalCents,
      Math.max(toCents(d.amount_paid), receiptCentsByInvoice.get(d.id) ?? 0)
    );
    const status: DocStatus =
      totalCents > 0 && paidCents >= totalCents ? 'PAID' : paidCents > 0 ? 'PARTIAL' : 'UNPAID';

    return { ...d, amount_paid: paidCents / 100, status };
  });
};

/** Outstanding balance on an invoice (0 for anything that is not an open invoice). */
export const invoiceBalance = (d: Pick<DocumentRecord, 'doc_type' | 'status' | 'amount' | 'amount_paid'>): number => {
  if (d.doc_type !== 'INVOICE' || (d.status !== 'UNPAID' && d.status !== 'PARTIAL')) return 0;
  return Math.max(0, toCents(d.amount) - toCents(d.amount_paid)) / 100;
};

/**
 * Next free receipt number for an invoice: RCT-<chain>, then RCT-<chain>-2, -3, ...
 * Looks at the receipt numbers that actually exist instead of counting them, so a gap or
 * a deleted row can never make two receipts share a number.
 */
export const nextReceiptNumber = (docs: DocumentRecord[], chainCode: string): string => {
  const taken = new Set(docs.filter(d => d.doc_type === 'RECEIPT').map(d => d.doc_number));
  const base = `RCT-${chainCode}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
};

/** Turns raw Postgres/Supabase errors into something a business owner can act on. */
export const explainDbError = (error: { code?: string; message: string }): string => {
  if (error.code === '23505') {
    return 'That document number was just taken by another request. Please try again.';
  }
  return error.message;
};

/** RFC-4180 style CSV cell, also defusing spreadsheet formula injection (=, +, -, @). */
export const csvCell = (value: unknown): string => {
  let s = value === null || value === undefined ? '' : String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
