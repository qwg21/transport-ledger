-- =============================================================================
-- 03 - Repair existing invoice balances  (run AFTER file 02, as its own query)
-- =============================================================================
-- Sets amount_paid / status on invoices from the receipts already issued against them, so invoices
-- that were left UNPAID after a partial payment show the right balance everywhere (including any
-- report or export that reads the database directly). The app itself already shows the correct
-- figures without this, because it derives balances from receipts.
-- Idempotent: only touches invoices whose stored numbers disagree with their receipts.
-- =============================================================================

begin;

with paid as (
  select parent_id as invoice_id, sum(amount) as total_paid
  from public.documents
  where doc_type = 'RECEIPT' and status <> 'VOID' and parent_id is not null
  group by parent_id
)
update public.documents i
   set amount_paid = least(i.amount, p.total_paid),
       status = 'PAID'
  from paid p
 where i.id = p.invoice_id
   and i.doc_type = 'INVOICE'
   and i.status in ('UNPAID', 'PARTIAL')
   and p.total_paid >= i.amount;

with paid as (
  select parent_id as invoice_id, sum(amount) as total_paid
  from public.documents
  where doc_type = 'RECEIPT' and status <> 'VOID' and parent_id is not null
  group by parent_id
)
update public.documents i
   set amount_paid = p.total_paid,
       status = 'PARTIAL'
  from paid p
 where i.id = p.invoice_id
   and i.doc_type = 'INVOICE'
   and i.status in ('UNPAID', 'PARTIAL')
   and p.total_paid < i.amount
   and i.amount_paid is distinct from p.total_paid;

commit;
