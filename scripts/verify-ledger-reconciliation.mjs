import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

async function fetchAll(supabase, table) {
  const all = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + pageSize - 1);
    if (error) throw new Error(`Error reading ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function main() {
  loadEnvLocal();
  const url = process.env.STAGING_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(url && serviceKey, 'Missing Supabase env vars in .env.local');

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const [orgs, coa, entries, lines, docs, payments, allocs, expenses, supplierBills, variants] = await Promise.all([
    fetchAll(admin, 'organizations'),
    fetchAll(admin, 'chart_of_accounts'),
    fetchAll(admin, 'journal_entries'),
    fetchAll(admin, 'journal_lines'),
    fetchAll(admin, 'documents'),
    fetchAll(admin, 'payments'),
    fetchAll(admin, 'payment_allocations'),
    fetchAll(admin, 'expenses'),
    fetchAll(admin, 'supplier_bills'),
    fetchAll(admin, 'product_variants')
  ]);

  // 1. Entry-level balance & reversal integrity check
  const linesByEntry = new Map();
  for (const l of lines) {
    if (!linesByEntry.has(l.entry_id)) linesByEntry.set(l.entry_id, []);
    linesByEntry.get(l.entry_id).push(l);
  }

  for (const je of entries) {
    const jeLines = linesByEntry.get(je.id) || [];
    const dr = round2(jeLines.reduce((s, l) => s + Number(l.debit), 0));
    const cr = round2(jeLines.reduce((s, l) => s + Number(l.credit), 0));
    assert.equal(dr, cr, `Unbalanced journal entry ${je.id} (${je.entry_number}): DR=${dr} CR=${cr}`);
    if (je.status === 'REVERSED') {
      assert.ok(je.reversed_by_entry_id, `Reversed entry ${je.id} missing reversed_by_entry_id`);
      const revLines = linesByEntry.get(je.reversed_by_entry_id) || [];
      const revDr = round2(revLines.reduce((s, l) => s + Number(l.debit), 0));
      const revCr = round2(revLines.reduce((s, l) => s + Number(l.credit), 0));
      assert.equal(revDr, cr, `Reversal mirror mismatch on ${je.id}`);
      assert.equal(revCr, dr, `Reversal mirror mismatch on ${je.id}`);
    }
  }
  console.log(`PASS: All ${entries.length} journal entries balanced and reversal-linked.`);

  // 2. Per-organization control account & subledger reconciliation
  for (const org of orgs) {
    const orgCoa = coa.filter(a => a.org_id === org.id);
    const codeById = new Map(orgCoa.map(a => [a.id, a.code]));

    const orgLines = lines.filter(l => l.org_id === org.id);
    const netByCode = {};
    let totalDr = 0;
    let totalCr = 0;

    for (const l of orgLines) {
      const code = codeById.get(l.account_id);
      totalDr += Number(l.debit);
      totalCr += Number(l.credit);
      netByCode[code] = (netByCode[code] || 0) + Number(l.debit) - Number(l.credit);
    }

    assert.equal(round2(totalDr), round2(totalCr), `${org.name}: Trial Balance mismatch`);

    const orgInvoices = docs.filter(d => d.org_id === org.id && d.doc_type === 'INVOICE' && d.status !== 'VOID');
    const expectedNetRevenue = round2(orgInvoices.reduce((s, d) => s + Number(d.amount), 0));
    const expectedAR = round2(orgInvoices.reduce((s, d) => s + (Number(d.amount) - Number(d.amount_paid)), 0));

    const orgPayments = payments.filter(p => p.org_id === org.id);
    const orgAllocs = allocs.filter(a => a.org_id === org.id);
    const allocByPay = new Map();
    for (const a of orgAllocs) {
      allocByPay.set(a.payment_id, (allocByPay.get(a.payment_id) || 0) + Number(a.amount_allocated));
    }
    const expectedDeposits = round2(
      orgPayments.reduce((s, p) => s + Math.max(0, Number(p.amount) - (allocByPay.get(p.id) || 0)), 0)
    );

    const orgExpenses = expenses.filter(e => e.org_id === org.id);
    const expectedExpenses = round2(orgExpenses.reduce((s, e) => s + Number(e.amount_kes), 0));

    const totalCashIn = round2(orgInvoices.reduce((s, d) => s + Number(d.amount_paid), 0) + expectedDeposits);
    const expectedNetCash = round2(totalCashIn - expectedExpenses);

    const actualNetRevenue = round2(-(netByCode['4000'] || 0) - (netByCode['4900'] || 0));
    const actualAR = round2(netByCode['1100'] || 0);
    const actualDeposits = round2(-(netByCode['2200'] || 0));
    const actualNetCash = round2((netByCode['1001'] || 0) + (netByCode['1010'] || 0) + (netByCode['1020'] || 0));
    const actualExpenses = round2(netByCode['6010'] || 0);

    assert.equal(actualNetRevenue, expectedNetRevenue, `${org.name} Net Revenue mismatch: GL=${actualNetRevenue} vs Subledger=${expectedNetRevenue}`);
    assert.equal(actualAR, expectedAR, `${org.name} AR (1100) mismatch: GL=${actualAR} vs Subledger=${expectedAR}`);
    assert.equal(actualDeposits, expectedDeposits, `${org.name} Deposits (2200) mismatch: GL=${actualDeposits} vs Subledger=${expectedDeposits}`);
    assert.equal(actualNetCash, expectedNetCash, `${org.name} Cash/Bank/M-PESA mismatch: GL=${actualNetCash} vs Subledger=${expectedNetCash}`);
    assert.equal(actualExpenses, expectedExpenses, `${org.name} Expenses (6010) mismatch: GL=${actualExpenses} vs Subledger=${expectedExpenses}`);

    const orgBills = supplierBills.filter(b => b.org_id === org.id && b.status !== 'VOID');
    const expectedAP = round2(orgBills.reduce((s, b) => s + (Number(b.total_amount) - Number(b.amount_paid || 0)), 0));
    const actualAP = round2(-(netByCode['2000'] || 0));
    assert.equal(actualAP, expectedAP, `${org.name} AP (2000) mismatch: GL=${actualAP} vs Subledger=${expectedAP}`);

    const orgVariants = variants.filter(v => v.org_id === org.id);
    const expectedInv = round2(orgVariants.reduce((s, v) => s + Number(v.stock_qty) * Number(v.cost_price), 0));
    const actualInv = round2(netByCode['1200'] || 0);
    assert.equal(actualInv, expectedInv, `${org.name} Inventory (1200) mismatch: GL=${actualInv} vs Valuation=${expectedInv}`);

    console.log(
      `PASS: ${org.name} | Rev=${actualNetRevenue.toFixed(2)} | AR=${actualAR.toFixed(2)} | Cash=${actualNetCash.toFixed(2)} | Exp=${actualExpenses.toFixed(2)} | Dep=${actualDeposits.toFixed(2)}`
    );
  }

  console.log('\nALL LEDGER RECONCILIATION CHECKS PASSED (0.00 VARIANCE).');
}

main().catch(err => {
  console.error('RECONCILIATION FAILED:', err.message || err);
  process.exit(1);
});