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

async function main() {
  loadEnvLocal();
  const url = process.env.STAGING_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.STAGING_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(url && anonKey && serviceKey, 'Missing Supabase env vars in .env.local');

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const runId = `run-${Date.now()}`;
  const password = `TestPass!${Date.now()}`;
  const emailA = `sec-a-${runId}@example.com`;
  const emailB = `sec-b-${runId}@example.com`;

  let userAId = null;
  let userBId = null;
  let orgAId = null;
  let orgBId = null;

  const passed = [];
  const failures = [];
  const check = async (label, fn) => {
    try {
      await fn();
      passed.push(label);
      console.log(`PASS: ${label}`);
    } catch (err) {
      failures.push({ label, error: err?.message || String(err) });
      console.error(`FAIL: ${label} -> ${err?.message || err}`);
    }
  };

  try {
    // 1. Create two isolated test users & organizations scoped to this runId
    const uA = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
    const uB = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
    assert.ifError(uA.error);
    assert.ifError(uB.error);
    userAId = uA.data.user.id;
    userBId = uB.data.user.id;

    const oA = await admin.from('organizations').insert({ name: `SecTest A ${runId}`, currency: 'KES' }).select('id').single();
    const oB = await admin.from('organizations').insert({ name: `SecTest B ${runId}`, currency: 'KES' }).select('id').single();
    assert.ifError(oA.error);
    assert.ifError(oB.error);
    orgAId = oA.data.id;
    orgBId = oB.data.id;

    await admin.from('organization_members').insert([
      { org_id: orgAId, user_id: userAId, role: 'owner' },
      { org_id: orgBId, user_id: userBId, role: 'owner' }
    ]);
    await admin.from('subscriptions').insert([
      { org_id: orgAId, plan: 'INTELLIGENCE', status: 'ACTIVE', current_period_end: '2027-12-31' },
      { org_id: orgBId, plan: 'INTELLIGENCE', status: 'ACTIVE', current_period_end: '2027-12-31' }
    ]);

    const custB = await admin.from('customers').insert({ org_id: orgBId, name: 'Tenant B Customer' }).select('id').single();
    const prodB = await admin.from('products_services').insert({ org_id: orgBId, name: 'Tenant B Item', unit_price: 500 }).select('id').single();
    const docB = await admin.from('documents').insert({
      org_id: orgBId,
      doc_type: 'INVOICE',
      chain_code: '2026-0001',
      doc_number: `INV-${runId}-B`,
      issue_date: '2026-11-17',
      customer_name: 'Tenant B Customer',
      description: 'Security test',
      amount: 1000,
      status: 'UNPAID'
    }).select('id').single();
    assert.ifError(custB.error);
    assert.ifError(prodB.error);
    assert.ifError(docB.error);

    await admin.storage.from('expense-receipts').upload(`${orgBId}/secret-${runId}.txt`, Buffer.from('tenant-b-secret'), { upsert: true });

    const clientA = createClient(url, anonKey, { auth: { persistSession: false } });
    const signA = await clientA.auth.signInWithPassword({ email: emailA, password });
    assert.ifError(signA.error);

    // 2. PERMITTED same-tenant operations
    let docAId = null;
    await check('Permitted: Tenant A can create customer, product, and document in Org A', async () => {
      const cA = await clientA.from('customers').insert({ org_id: orgAId, name: 'Tenant A Customer' }).select('id').single();
      assert.ifError(cA.error);
      const pA = await clientA.from('products_services').insert({ org_id: orgAId, name: 'Tenant A Item', unit_price: 250 }).select('id').single();
      assert.ifError(pA.error);
      const dA = await clientA.from('documents').insert({
        org_id: orgAId,
        customer_id: cA.data.id,
        doc_type: 'INVOICE',
        chain_code: '2026-0001',
        doc_number: `INV-${runId}-A`,
        issue_date: '2026-11-17',
        customer_name: 'Tenant A Customer',
        description: 'Security test',
        amount: 250,
        status: 'UNPAID'
      }).select('id').single();
      assert.ifError(dA.error);
      docAId = dA.data.id;
    });

    await check('Permitted: Tenant A can call next_chain_code and list_org_team for Org A', async () => {
      const code = await clientA.rpc('next_chain_code', { p_org_id: orgAId, p_year: 2026 });
      assert.ifError(code.error);
      const team = await clientA.rpc('list_org_team', { p_org_id: orgAId });
      assert.ifError(team.error);
      assert.equal(team.data.length, 1);
    });

    await check('Permitted: Tenant A can upload and sign receipt in Org A folder', async () => {
      const up = await clientA.storage.from('expense-receipts').upload(`${orgAId}/ok-${runId}.txt`, Buffer.from('ok'), { upsert: true });
      assert.ifError(up.error);
      const sig = await clientA.storage.from('expense-receipts').createSignedUrl(`${orgAId}/ok-${runId}.txt`, 60);
      assert.ifError(sig.error);
      assert.ok(sig.data?.signedUrl);
    });

    // 3. DENIED cross-tenant table RLS
    await check('Denied: Tenant A cannot read Tenant B customers, documents, or organizations', async () => {
      const r1 = await clientA.from('customers').select('id').eq('org_id', orgBId);
      assert.equal((r1.data || []).length, 0);
      const r2 = await clientA.from('documents').select('id').eq('org_id', orgBId);
      assert.equal((r2.data || []).length, 0);
      const r3 = await clientA.from('organizations').select('id').eq('id', orgBId);
      assert.equal((r3.data || []).length, 0);
    });

    await check('Denied: Tenant A cannot insert or update Tenant B records', async () => {
      const ins = await clientA.from('expenses').insert({
        org_id: orgBId, category: 'Fuel', expense_date: '2026-11-17', amount_kes: 100, vendor: 'Hack'
      });
      assert.ok(ins.error, 'Cross-tenant expense insert should fail');

      const upd = await clientA.from('documents').update({ customer_name: 'Hacked' }).eq('id', docB.data.id).select('id');
      assert.equal((upd.data || []).length, 0);
    });

    // 4. DENIED cross-tenant foreign keys
    await check('Denied: Tenant A cannot attach Tenant B customer_id or product_id via composite FK', async () => {
      const badDoc = await clientA.from('documents').insert({
        org_id: orgAId,
        customer_id: custB.data.id,
        doc_type: 'QUOTE',
        chain_code: '2026-9991',
        doc_number: `QT-${runId}-X`,
        issue_date: '2026-11-17',
        customer_name: 'Cross FK',
        description: 'Security test',
        amount: 100,
        status: 'ACTIVE'
      });
      assert.ok(badDoc.error, 'Cross-tenant customer_id FK must be rejected');

      const badItem = await clientA.from('document_items').insert({
        org_id: orgAId,
        document_id: docAId,
        product_id: prodB.data.id,
        description: 'Cross product',
        quantity: 1,
        unit_price: 100,
        line_total: 100
      });
      assert.ok(badItem.error, 'Cross-tenant product_id FK must be rejected');
    });

    // 5. DENIED cross-tenant & privileged RPCs
    await check('Denied: Tenant A cannot invoke RPCs on Tenant B or call service-only RPCs', async () => {
      const r1 = await clientA.rpc('next_chain_code', { p_org_id: orgBId, p_year: 2026 });
      assert.ok(r1.error, 'Cross-tenant next_chain_code must fail');

      const r2 = await clientA.rpc('list_org_team', { p_org_id: orgBId });
      assert.ok(r2.error, 'Cross-tenant list_org_team must fail');

      const r3 = await clientA.rpc('record_invoice_payment', {
        p_invoice_id: docB.data.id, p_amount: 100, p_payment_method: 'Cash', p_payment_ref: 'X', p_payment_date: '2026-11-17'
      });
      assert.ok(r3.error, 'Cross-tenant record_invoice_payment must fail');

      const r4 = await clientA.rpc('apply_paystack_subscription_payment', {
        p_reference: 'FAKE-REF', p_channel: 'card', p_raw_payload: {}
      });
      assert.ok(r4.error, 'apply_paystack_subscription_payment must be blocked for authenticated users');

      const r5 = await clientA.rpc('platform_list_tenants');
      assert.ok(r5.error, 'platform_list_tenants must be blocked for non-admin users');
    });

    // 6. DENIED cross-tenant storage access
    await check('Denied: Tenant A cannot upload to or sign Tenant B storage files', async () => {
      const up = await clientA.storage.from('expense-receipts').upload(`${orgBId}/hack-${runId}.txt`, Buffer.from('bad'), { upsert: true });
      assert.ok(up.error, 'Cross-tenant storage upload must fail');
      const sig = await clientA.storage.from('expense-receipts').createSignedUrl(`${orgBId}/secret-${runId}.txt`, 60);
      assert.ok(sig.error || !sig.data?.signedUrl, 'Cross-tenant signed URL must fail');
    });

    // 7. DENIED writes when subscription is SUSPENDED (read-only still allowed)
    await check('Denied: Suspended Org A can read existing records but cannot insert new documents', async () => {
      await admin.from('subscriptions').update({ status: 'SUSPENDED' }).eq('org_id', orgAId);
      const readRes = await clientA.from('documents').select('id').eq('org_id', orgAId);
      assert.ok((readRes.data || []).length >= 1, 'Suspended tenant should retain read access');

      const writeRes = await clientA.from('documents').insert({
        org_id: orgAId,
        doc_type: 'INVOICE',
        chain_code: '2026-9992',
        doc_number: `INV-${runId}-LOCK`,
        issue_date: '2026-11-17',
        customer_name: 'Blocked',
        description: 'Security test',
        amount: 100,
        status: 'UNPAID'
      });
      assert.ok(writeRes.error, 'Suspended tenant write must be blocked by RLS');
    });

    if (failures.length > 0) {
      const outPath = path.resolve(process.cwd(), 'backups', `security-failure-${runId}.json`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify({ runId, orgAId, orgBId, passed, failures }, null, 2));
      throw new Error(`${failures.length} check(s) failed. Evidence saved to ${outPath}`);
    }

    console.log(`\nALL ${passed.length} ADVERSARIAL SECURITY CHECKS PASSED (${runId}).`);
  } finally {
    if (orgAId) {
      await admin.storage.from('expense-receipts').remove([`${orgAId}/ok-${runId}.txt`]);
      await admin.from('organizations').delete().eq('id', orgAId);
    }
    if (orgBId) {
      await admin.storage.from('expense-receipts').remove([`${orgBId}/secret-${runId}.txt`]);
      await admin.from('organizations').delete().eq('id', orgBId);
    }
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  }
}

main().catch(err => {
  console.error('SECURITY TEST FAILED:', err.message || err);
  process.exit(1);
});