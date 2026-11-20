import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerStatement, buildStatementClients, resolveStatementPeriod } from './statements.ts';
import type { Customer, DocumentRecord } from './types.ts';

const orgId = 'org-1';
const customer: Customer = {
  id: 'cust-1',
  org_id: orgId,
  name: 'Safari Corp Ltd',
  company_name: 'Safari Corp Ltd',
  phone: '+254700111222',
  email: 'accounts@safaricorp.co.ke',
  kra_pin: 'P051234567X'
};

const makeDoc = (overrides: Partial<DocumentRecord>): DocumentRecord => ({
  id: 'doc-1',
  org_id: orgId,
  customer_id: 'cust-1',
  doc_type: 'INVOICE',
  chain_code: 'CH-1',
  doc_number: 'INV-001',
  parent_id: null,
  quote_ref: null,
  invoice_ref: null,
  issue_date: '2026-10-01',
  customer_name: 'Safari Corp Ltd',
  customer_phone: '+254700111222',
  customer_email: null,
  description: 'Airport transfer',
  amount: 10000,
  amount_paid: 0,
  payment_method: null,
  payment_ref: null,
  status: 'UNPAID',
  ...overrides
});

test('computes opening balance, running balance, and ignores void & quotes', () => {
  const docs: DocumentRecord[] = [
    makeDoc({ id: '1', doc_number: 'INV-001', issue_date: '2026-09-15', amount: 15000, amount_paid: 5000, status: 'PARTIAL' }),
    makeDoc({ id: '2', doc_type: 'RECEIPT', doc_number: 'RCP-001', parent_id: '1', invoice_ref: 'INV-001', issue_date: '2026-09-20', amount: 5000, status: 'PAID' }),
    makeDoc({ id: '3', doc_type: 'QUOTE', doc_number: 'QT-001', issue_date: '2026-10-05', amount: 99000, status: 'ACTIVE' }),
    makeDoc({ id: '4', doc_number: 'INV-002', issue_date: '2026-10-10', amount: 20000, status: 'UNPAID' }),
    makeDoc({ id: '5', doc_number: 'INV-VOID', issue_date: '2026-10-12', amount: 50000, status: 'VOID' }),
    makeDoc({ id: '6', doc_type: 'RECEIPT', doc_number: 'RCP-002', parent_id: '4', invoice_ref: 'INV-002', issue_date: '2026-10-15', amount: 12000, status: 'PAID' })
  ];

  const [client] = buildStatementClients([customer], docs);
  const stmt = buildCustomerStatement(client, docs, '2026-10-01', '2026-10-31');

  assert.equal(stmt.openingBalance, 10000);
  assert.equal(stmt.totalInvoiced, 20000);
  assert.equal(stmt.totalPaid, 12000);
  assert.equal(stmt.closingBalance, 18000);
  assert.equal(stmt.entries.length, 2);
  assert.equal(stmt.entries[0].runningBalance, 30000);
  assert.equal(stmt.entries[1].runningBalance, 18000);
  assert.equal(stmt.aging.days31to60, 10000); // Sept 15 -> Oct 31 = 46 days
  assert.equal(stmt.aging.days0to30, 8000);   // Oct 10 -> Oct 31 = 21 days
});

test('resolves period presets accurately', () => {
  assert.deepEqual(resolveStatementPeriod('THIS_MONTH', '2026-11-21'), {
    fromDate: '2026-11-01',
    toDate: '2026-11-21'
  });
  assert.deepEqual(resolveStatementPeriod('LAST_MONTH', '2026-11-21'), {
    fromDate: '2026-10-01',
    toDate: '2026-10-31'
  });
  assert.deepEqual(resolveStatementPeriod('THIS_YEAR', '2026-11-21'), {
    fromDate: '2026-01-01',
    toDate: '2026-11-21'
  });
});