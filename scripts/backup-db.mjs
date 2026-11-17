import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local not found in project root.');
  }
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

async function fetchAllRows(supabase, table) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + pageSize - 1);
    if (error) {
      throw new Error(`Failed reading ${table}: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local');
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const tables = {};
  const counts = {};

  for (const table of TABLES_IN_DEPENDENCY_ORDER) {
    const rows = await fetchAllRows(supabase, table);
    tables[table] = rows;
    counts[table] = rows.length;
    console.log(`  ${table}: ${rows.length} rows`);
  }

  const payload = {
    created_at: new Date().toISOString(),
    supabase_url: url,
    counts,
    tables
  };
  const json = JSON.stringify(payload, null, 2);
  const sha256 = crypto.createHash('sha256').update(json).digest('hex');

  const backupsDir = path.resolve(process.cwd(), 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = path.join(backupsDir, `backup_${stamp}.json`);
  fs.writeFileSync(outFile, json, 'utf8');
  fs.writeFileSync(`${outFile}.sha256`, `${sha256}  ${path.basename(outFile)}\n`, 'utf8');

  console.log(`\nBackup saved: ${outFile}`);
  console.log(`SHA-256:      ${sha256}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});