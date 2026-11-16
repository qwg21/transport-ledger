import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPaymentTotals, buildDocNumber, csvCell, invoiceBalance, nextReceiptNumber } from './documents.ts';
import type { DocumentRecord } from './types.ts';

const invoice = (o: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id: 'inv1', org_id: 'org', customer_id: null, doc_type: 'INVOICE', chain_code: '2026-0001',
  doc_number: 'INV-2026-0001', parent_id: null, quote_ref: null, invoice_ref: null, issue_date: '2026-11-01',
  customer_name: 'Acme Ltd', customer_phone: null, customer_email: null, description: 'Haulage',
  amount: 10000, amount_paid: 0, payment_method: null, payment_ref: null, status: 'UNPAID', ...o
});

const receipt = (o: Partial<DocumentRecord> = {}): DocumentRecord =>
  invoice({ id: 'r1', doc_type: 'RECEIPT', parent_id: 'inv1', doc_number: 'RCT-2026-0001', status: 'PAID', amount: 4000, amount_paid: 4000, ...o });

const find = (docs: DocumentRecord[], id: string) => docs.find(d => d.id === id)!;

describe('applyPaymentTotals', () => {
  it('reduces receivables after a partial receipt even if the invoice row was never updated', () => {
    const inv = find(applyPaymentTotals([invoice(), receipt()]), 'inv1');
    assert.equal(inv.status, 'PARTIAL');
    assert.equal(inv.amount_paid, 4000);
    assert.equal(invoiceBalance(inv), 6000);
  });

  it('closes the invoice once the balance is paid', () => {
    const docs = applyPaymentTotals([invoice(), receipt(), receipt({ id: 'r2', doc_number: 'RCT-2026-0001-2', amount: 6000 })]);
    const inv = find(docs, 'inv1');
    assert.equal(inv.status, 'PAID');
    assert.equal(invoiceBalance(inv), 0);
  });

  it('never understates a legacy row and caps overpayment at the invoice total', () => {
    assert.equal(applyPaymentTotals([invoice({ amount_paid: 7000, status: 'PARTIAL' })])[0].amount_paid, 7000);
    const capped = applyPaymentTotals([invoice({ amount_paid: 99999 })])[0];
    assert.equal(capped.amount_paid, 10000);
    assert.equal(capped.status, 'PAID');
  });

  it('leaves void invoices alone and ignores void receipts', () => {
    assert.equal(applyPaymentTotals([invoice({ status: 'VOID' })])[0].status, 'VOID');
    const inv = find(applyPaymentTotals([invoice(), receipt({ status: 'VOID' })]), 'inv1');
    assert.equal(inv.status, 'UNPAID');
    assert.equal(inv.amount_paid, 0);
  });

  it('does not leak receipts between invoices', () => {
    assert.equal(find(applyPaymentTotals([invoice(), receipt({ parent_id: 'other' })]), 'inv1').amount_paid, 0);
  });

  it('is exact to the cent (3 x 33.33 settles 99.99)', () => {
    const docs = applyPaymentTotals([
      invoice({ amount: 99.99 }),
      receipt({ id: 'a', amount: 33.33 }), receipt({ id: 'b', amount: 33.33 }), receipt({ id: 'c', amount: 33.33 })
    ]);
    assert.equal(find(docs, 'inv1').status, 'PAID');
  });
});

describe('numbering', () => {
  it('numbers receipts without collisions', () => {
    assert.equal(nextReceiptNumber([], '2026-0001'), 'RCT-2026-0001');
    assert.equal(nextReceiptNumber([receipt()], '2026-0001'), 'RCT-2026-0001-2');
    assert.equal(nextReceiptNumber([receipt(), receipt({ id: 'x', doc_number: 'RCT-2026-0001-2' })], '2026-0001'), 'RCT-2026-0001-3');
  });

  it('builds prefixed document numbers', () => {
    assert.equal(buildDocNumber('QUOTE', '2026-0007'), 'QT-2026-0007');
    assert.equal(buildDocNumber('INVOICE', '2026-0007'), 'INV-2026-0007');
  });
});

describe('csvCell', () => {
  it('escapes commas and quotes, keeps # and negative numbers intact', () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('Job #12'), 'Job #12');
    assert.equal(csvCell(-500), '-500');
  });

  it('defuses spreadsheet formula injection in text', () => {
    assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  });
});
