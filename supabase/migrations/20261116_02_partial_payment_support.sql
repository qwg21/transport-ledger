-- =============================================================================
-- 02 - Partial payment support  (FIXES: partial receipts not reducing outstanding receivables)
-- =============================================================================
-- The app issues a receipt, then updates the invoice to status PARTIAL / amount_paid. If the database
-- rejects that update (for example a status CHECK constraint or enum that has no 'PARTIAL' value, or a
-- row-level-security policy), the invoice stays UNPAID and the balance never moves.
--
-- The app now (a) derives every invoice balance from its receipts, so numbers are right even when the
-- update is rejected, and (b) shows the database's error message instead of hiding it.
-- This script removes the likely database-side cause. File 03 then repairs invoices that are already wrong.
--
-- HOW TO RUN: Supabase SQL Editor -> paste -> Run. Then run file 03 (repair) as a SEPARATE query:
-- a new enum value cannot be used in the same transaction that adds it.
-- =============================================================================


-- If documents.status is a Postgres ENUM, add the missing value.
do $$
declare
  enum_type text;
begin
  select format('%s.%I', t.typnamespace::regnamespace, t.typname) into enum_type
  from pg_attribute a
  join pg_type t on t.oid = a.atttypid
  where a.attrelid = 'public.documents'::regclass
    and a.attname = 'status'
    and t.typtype = 'e';

  if enum_type is not null then
    execute format('alter type %s add value if not exists %L', enum_type, 'PARTIAL');
  end if;
end $$;

-- If status is guarded by a CHECK constraint that does not list 'PARTIAL', replace it.
-- (Constraints that already allow PARTIAL are left untouched.)
do $$
declare
  c record;
  replaced boolean := false;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.documents'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) not ilike '%PARTIAL%'
  loop
    execute format('alter table public.documents drop constraint %I', c.conname);
    replaced := true;
  end loop;

  if replaced then
    alter table public.documents
      add constraint documents_status_check
      check (status in ('ACTIVE', 'CONVERTED', 'UNPAID', 'PARTIAL', 'PAID', 'VOID'));
  end if;
end $$;

-- ----------------------------- DIAGNOSTICS (read-only) -----------------------------
-- Which policies govern documents (an UPDATE policy must exist for the member's role)?
--   select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
--   from pg_policy where polrelid = 'public.documents'::regclass;
--
-- Triggers that could block or rewrite invoice updates:
--   select tgname, pg_get_triggerdef(oid) from pg_trigger
--   where tgrelid = 'public.documents'::regclass and not tgisinternal;
--
-- Invoices whose stored balance disagrees with their receipts:
--   select i.doc_number, i.amount, i.amount_paid, i.status, coalesce(sum(r.amount), 0) as receipts_total
--   from public.documents i
--   left join public.documents r on r.parent_id = i.id and r.doc_type = 'RECEIPT' and r.status <> 'VOID'
--   where i.doc_type = 'INVOICE'
--   group by i.id having coalesce(sum(r.amount), 0) is distinct from i.amount_paid;
