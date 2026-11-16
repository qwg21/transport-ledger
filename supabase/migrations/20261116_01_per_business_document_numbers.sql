-- =============================================================================
-- 01 - Per-business document numbers  (FIXES: duplicate key ... "documents_doc_number_key")
-- =============================================================================
-- WHY IT FAILED
--   Document numbers (QT-/INV-/RCT-<chain>) come from next_chain_code(org_id, year), which counts
--   separately for every business. The first quote of business B is therefore numbered exactly like
--   the first quote of business A. But documents.doc_number had a GLOBAL unique constraint, so
--   Postgres rejected B's insert as a duplicate of A's.
--
-- THE FIX
--   A document number only has to be unique INSIDE one business -> unique on (org_id, doc_number).
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste this whole file -> Run. Safe to re-run.
-- =============================================================================

begin;

-- Global constraint out ...
alter table public.documents drop constraint if exists documents_doc_number_key;
drop index if exists public.documents_doc_number_key;

-- ... per-business uniqueness in. If this fails, two documents in the SAME business share a number:
-- run the diagnostic at the bottom of this file to see them.
create unique index if not exists documents_org_doc_number_uniq
  on public.documents (org_id, doc_number);

-- Lookups the app does on every load / receipt (balances are derived from receipts via parent_id).
create index if not exists documents_parent_id_idx on public.documents (parent_id);
create index if not exists documents_org_issue_date_idx on public.documents (org_id, issue_date desc);

commit;

-- -----------------------------------------------------------------------------
-- DIAGNOSTICS (read-only). Run these separately if something above fails or you want to audit.
-- -----------------------------------------------------------------------------

-- A) Duplicate numbers inside ONE business (must return 0 rows for the new index to be created):
--   select org_id, doc_number, count(*) from public.documents
--   group by 1, 2 having count(*) > 1;

-- B) Any OTHER unique constraint that is not scoped to a business. Each row is a future
--    "duplicate key" error waiting for your second tenant:
--   select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
--   from pg_constraint
--   where contype = 'u' and connamespace = 'public'::regnamespace
--     and pg_get_constraintdef(oid) not ilike '%org_id%';
--   select schemaname, tablename, indexname, indexdef from pg_indexes
--   where schemaname = 'public' and indexdef ilike 'create unique%' and indexdef not ilike '%org_id%';
