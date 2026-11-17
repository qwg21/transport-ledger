import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const TABLES_IN_DEPENDENCY_ORDER = [
  'organizations',
  'organization_members',
  'organization_invites',
  'subscriptions',
  'plan_pricing',
  'promo_codes',
  'subscription_payments',
  'doc_counters',
  'customers',
  'products_services',
  'documents',
  'document_items',
  'payments',
  'payment_allocations',
  'expenses',
  'monthly_targets',
  'tax_profiles',
  'audit_logs',
  'user_agreements'
];

function findLatestBackup(backupsDir) {
  if (!fs.existsSync(backupsDir)) {
    throw new Error('backups/ folder does not exist. Run node scripts/backup-db.mjs first.');
  }
  const files = fs
    .readdirSync(backupsDir)
    .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) {
    throw new Error('No backup_*.json files found in backups/.');
  }
  return path.join(backupsDir, files[0]);
}

function verifyIntegrity(payload) {
  const { tables } = payload;
  const orgIds = new Set((tables.organizations || []).map(o => o.id));
  const docIds = new Set((tables.documents || []).map(d => d.id));
  const payIds = new Set((tables.payments || []).map(p => p.id));

  const issues = [];
  for (const item of tables.document_items || []) {
    if (!docIds.has(item.document_id)) {
      issues.push(`Orphan document_item ${item.id} -> missing document ${item.document_id}`);
    }
    if (!orgIds.has(item.org_id)) {
      issues.push(`Orphan document_item ${item.id} -> missing org ${item.org_id}`);
    }
  }
  for (const alloc of tables.payment_allocations || []) {
    if (!payIds.has(alloc.payment_id)) {
      issues.push(`Orphan payment_allocation ${alloc.id} -> missing payment ${alloc.payment_id}`);
    }
    if (!docIds.has(alloc.document_id)) {
      issues.push(`Orphan payment_allocation ${alloc.id} -> missing document ${alloc.document_id}`);
    }
  }

  return issues;
}

async function restoreToTarget(payload, url, key) {
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  for (const table of TABLES_IN_DEPENDENCY_ORDER) {
    const rows = payload.tables[table] || [];
    if (rows.length === 0) continue;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabase.from(table).upsert(batch);
      if (error) {
        throw new Error(`Restore failed on ${table}: ${error.message}`);
      }
    }
    console.log(`  Restored ${table}: ${rows.length} rows`);
  }
}

async function main() {
  const backupsDir = path.resolve(process.cwd(), 'backups');
  const backupFile = findLatestBackup(backupsDir);
  const raw = fs.readFileSync(backupFile, 'utf8');

  const shaFile = `${backupFile}.sha256`;
  if (!fs.existsSync(shaFile)) {
    throw new Error(`Missing checksum file: ${shaFile}`);
  }
  const expectedSha = fs.readFileSync(shaFile, 'utf8').trim().split(/\s+/)[0];
  const actualSha = crypto.createHash('sha256').update(raw).digest('hex');

  if (expectedSha !== actualSha) {
    throw new Error(`Checksum mismatch! Expected ${expectedSha}, got ${actualSha}`);
  }
  console.log(`Checksum OK: ${path.basename(backupFile)} (${actualSha})`);

  const payload = JSON.parse(raw);
  const issues = verifyIntegrity(payload);
  if (issues.length > 0) {
    throw new Error(`Referential integrity errors:\n${issues.join('\n')}`);
  }
  console.log('Referential integrity OK across all backed-up tables.');

  if (process.argv.includes('--restore')) {
    const restoreUrl = process.env.RESTORE_SUPABASE_URL;
    const restoreKey = process.env.RESTORE_SERVICE_ROLE_KEY;
    if (!restoreUrl || !restoreKey) {
      throw new Error('Set RESTORE_SUPABASE_URL and RESTORE_SERVICE_ROLE_KEY to run --restore.');
    }
    if (restoreUrl === payload.supabase_url) {
      throw new Error('Refusing --restore against the same production URL. Use a staging project.');
    }
    console.log(`\nRestoring to staging target: ${restoreUrl}`);
    await restoreToTarget(payload, restoreUrl, restoreKey);
    console.log('Staging restore completed.');
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});