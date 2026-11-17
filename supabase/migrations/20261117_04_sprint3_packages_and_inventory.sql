-- 1. Auto-seed Chart of Accounts whenever a new organization is created
create or replace function public.trg_seed_org_coa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_chart_of_accounts(new.id);
  return new;
end;
$$;

drop trigger if exists trg_organizations_seed_coa on public.organizations;
create trigger trg_organizations_seed_coa
  after insert on public.organizations
  for each row execute function public.trg_seed_org_coa();

-- 2. Resolve Cash / Bank / M-PESA account by payment method
create or replace function public.resolve_cash_account_id(
  p_org_id uuid,
  p_payment_method text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_id uuid;
  v_method text := lower(coalesce(p_payment_method, ''));
begin
  if v_method like '%mpesa%' or v_method like '%m-pesa%' then
    v_code := '1020';
  elsif v_method like '%bank%' or v_method like '%eft%' or v_method like '%card%' or v_method like '%cheque%' or v_method like '%paypal%' or v_method like '%stripe%' then
    v_code := '1010';
  else
    v_code := '1001';
  end if;

  select id into v_id
  from public.chart_of_accounts
  where org_id = p_org_id and code = v_code;

  return v_id;
end;
$$;

-- 3. Controlled PostgreSQL Posting Helper (Idempotent + Period-Checked)
create or replace function public.post_two_line_journal(
  p_org_id uuid,
  p_entry_date date,
  p_entry_number text,
  p_source_type text,
  p_source_id uuid,
  p_posting_key text,
  p_description text,
  p_debit_account_id uuid,
  p_credit_account_id uuid,
  p_amount numeric,
  p_subledger_type text default null,
  p_subledger_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_existing_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    return null;
  end if;

  if exists (
    select 1 from public.accounting_periods ap
    where ap.org_id = p_org_id
      and p_entry_date between ap.period_start and ap.period_end
      and ap.status in ('LOCKED', 'CLOSED')
  ) then
    raise exception 'Accounting period for % is locked or closed', p_entry_date;
  end if;

  select id into v_existing_id
  from public.journal_entries
  where org_id = p_org_id and posting_key = p_posting_key;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  insert into public.journal_entries (
    org_id, entry_number, entry_date, source_type, source_id, posting_key,
    description, status, created_by, posted_at
  )
  values (
    p_org_id, p_entry_number, p_entry_date, p_source_type, p_source_id, p_posting_key,
    p_description, 'DRAFT', auth.uid(), now()
  )
  returning id into v_entry_id;

  insert into public.journal_lines (org_id, entry_id, line_no, account_id, debit, credit, subledger_type, subledger_id, memo)
  values
    (p_org_id, v_entry_id, 1, p_debit_account_id, p_amount, 0, p_subledger_type, p_subledger_id, p_description),
    (p_org_id, v_entry_id, 2, p_credit_account_id, 0, p_amount, p_subledger_type, p_subledger_id, p_description);

  update public.journal_entries set status = 'POSTED' where id = v_entry_id;
  return v_entry_id;
end;
$$;

-- 4. Live Posting Triggers (Invoices, Voids, Payment Allocations, Expenses)
create or replace function public.trg_post_document_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ar_id uuid;
  v_rev_id uuid;
  v_orig_entry_id uuid;
begin
  if tg_op = 'INSERT' and new.doc_type = 'INVOICE' and new.status <> 'VOID' and new.amount > 0 then
    select id into v_ar_id from public.chart_of_accounts where org_id = new.org_id and code = '1100';
    select id into v_rev_id from public.chart_of_accounts where org_id = new.org_id and code = '4000';
    perform public.post_two_line_journal(
      new.org_id, new.issue_date, new.doc_number, 'INVOICE', new.id,
      'DOC:' || new.id::text, 'Invoice ' || new.doc_number || ' - ' || new.customer_name,
      v_ar_id, v_rev_id, new.amount, 'CUSTOMER', new.customer_id
    );
  elsif tg_op = 'UPDATE' and old.status <> 'VOID' and new.status = 'VOID' and new.doc_type = 'INVOICE' then
    select id into v_orig_entry_id
    from public.journal_entries
    where org_id = new.org_id and posting_key = 'DOC:' || new.id::text and status = 'POSTED';

    if v_orig_entry_id is not null then
      perform public.reverse_journal_entry(v_orig_entry_id, 'Invoice ' || new.doc_number || ' voided');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_documents_post_journal on public.documents;
create trigger trg_documents_post_journal
  after insert or update of status on public.documents
  for each row execute function public.trg_post_document_journal();

create or replace function public.trg_post_payment_allocation_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay record;
  v_cash_id uuid;
  v_ar_id uuid;
begin
  select * into v_pay from public.payments where id = new.payment_id;
  v_cash_id := public.resolve_cash_account_id(new.org_id, v_pay.payment_method);
  select id into v_ar_id from public.chart_of_accounts where org_id = new.org_id and code = '1100';

  perform public.post_two_line_journal(
    new.org_id, v_pay.payment_date, 'PAY-' || left(v_pay.id::text, 8), 'PAYMENT_ALLOCATION', new.id,
    'ALLOC:' || new.id::text, 'Payment allocation (' || coalesce(v_pay.payment_method, 'Cash') || ')',
    v_cash_id, v_ar_id, new.amount_allocated, 'CUSTOMER', v_pay.customer_id
  );
  return new;
end;
$$;

drop trigger if exists trg_payment_allocations_post_journal on public.payment_allocations;
create trigger trg_payment_allocations_post_journal
  after insert on public.payment_allocations
  for each row execute function public.trg_post_payment_allocation_journal();

create or replace function public.trg_post_expense_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp_id uuid;
  v_cash_id uuid;
begin
  select id into v_exp_id from public.chart_of_accounts where org_id = new.org_id and code = '6010';
  select id into v_cash_id from public.chart_of_accounts where org_id = new.org_id and code = '1001';

  perform public.post_two_line_journal(
    new.org_id, new.expense_date, 'EXP-' || left(new.id::text, 8), 'EXPENSE', new.id,
    'EXP:' || new.id::text, new.category || ' - ' || new.vendor,
    v_exp_id, v_cash_id, new.amount_kes, null, null
  );
  return new;
end;
$$;

drop trigger if exists trg_expenses_post_journal on public.expenses;
create trigger trg_expenses_post_journal
  after insert on public.expenses
  for each row execute function public.trg_post_expense_journal();

-- 5. Historical Backfill (Invoices, Allocations, Unallocated Advances, Legacy Receipts, Expenses)
do $$
declare
  v_doc record;
  v_alloc record;
  v_pay record;
  v_exp record;
  v_ar_id uuid;
  v_rev_id uuid;
  v_dep_id uuid;
  v_exp_acct_id uuid;
  v_cash_id uuid;
  v_alloc_sum numeric(14, 2);
  v_diff numeric(14, 2);
begin
  -- 5a. Non-VOID Invoices
  for v_doc in
    select * from public.documents
    where doc_type = 'INVOICE' and status <> 'VOID' and amount > 0
  loop
    select id into v_ar_id from public.chart_of_accounts where org_id = v_doc.org_id and code = '1100';
    select id into v_rev_id from public.chart_of_accounts where org_id = v_doc.org_id and code = '4000';
    perform public.post_two_line_journal(
      v_doc.org_id, v_doc.issue_date, v_doc.doc_number, 'INVOICE', v_doc.id,
      'DOC:' || v_doc.id::text, 'Invoice ' || v_doc.doc_number || ' - ' || v_doc.customer_name,
      v_ar_id, v_rev_id, v_doc.amount, 'CUSTOMER', v_doc.customer_id
    );
  end loop;

  -- 5b. Payment Allocations
  for v_alloc in
    select pa.*, p.payment_date, p.payment_method, p.customer_id
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
  loop
    v_cash_id := public.resolve_cash_account_id(v_alloc.org_id, v_alloc.payment_method);
    select id into v_ar_id from public.chart_of_accounts where org_id = v_alloc.org_id and code = '1100';
    perform public.post_two_line_journal(
      v_alloc.org_id, v_alloc.payment_date, 'PAY-' || left(v_alloc.payment_id::text, 8), 'PAYMENT_ALLOCATION', v_alloc.id,
      'ALLOC:' || v_alloc.id::text, 'Payment allocation (' || coalesce(v_alloc.payment_method, 'Cash') || ')',
      v_cash_id, v_ar_id, v_alloc.amount_allocated, 'CUSTOMER', v_alloc.customer_id
    );
  end loop;

  -- 5c. Any Unallocated Customer Advances / Overpayments
  for v_pay in select * from public.payments loop
    select coalesce(sum(amount_allocated), 0) into v_alloc_sum
    from public.payment_allocations where payment_id = v_pay.id;
    v_diff := v_pay.amount - v_alloc_sum;
    if v_diff > 0 then
      v_cash_id := public.resolve_cash_account_id(v_pay.org_id, v_pay.payment_method);
      select id into v_dep_id from public.chart_of_accounts where org_id = v_pay.org_id and code = '2200';
      perform public.post_two_line_journal(
        v_pay.org_id, v_pay.payment_date, 'ADV-' || left(v_pay.id::text, 8), 'CUSTOMER_ADVANCE', v_pay.id,
        'ADV:' || v_pay.id::text, 'Unallocated customer deposit',
        v_cash_id, v_dep_id, v_diff, 'CUSTOMER', v_pay.customer_id
      );
    end if;
  end loop;

  -- 5d. Legacy Pre-Allocation Invoice Payments (e.g. Afrique Modern KES 36,600 & Wainaina Tech KES 135,000)
  for v_doc in
    select * from public.documents
    where doc_type = 'INVOICE' and status <> 'VOID' and amount_paid > 0
  loop
    select coalesce(sum(amount_allocated), 0) into v_alloc_sum
    from public.payment_allocations where document_id = v_doc.id;
    v_diff := v_doc.amount_paid - v_alloc_sum;
    if v_diff > 0 then
      select id into v_cash_id from public.chart_of_accounts where org_id = v_doc.org_id and code = '1001';
      select id into v_ar_id from public.chart_of_accounts where org_id = v_doc.org_id and code = '1100';
      perform public.post_two_line_journal(
        v_doc.org_id, v_doc.issue_date, 'LEG-' || v_doc.doc_number, 'LEGACY_RECEIPT', v_doc.id,
        'LEGACY_PAID:' || v_doc.id::text, 'Legacy receipt settlement for ' || v_doc.doc_number,
        v_cash_id, v_ar_id, v_diff, 'CUSTOMER', v_doc.customer_id
      );
    end if;
  end loop;

  -- 5e. Expenses
  for v_exp in select * from public.expenses loop
    select id into v_exp_acct_id from public.chart_of_accounts where org_id = v_exp.org_id and code = '6010';
    select id into v_cash_id from public.chart_of_accounts where org_id = v_exp.org_id and code = '1001';
    perform public.post_two_line_journal(
      v_exp.org_id, v_exp.expense_date, 'EXP-' || left(v_exp.id::text, 8), 'EXPENSE', v_exp.id,
      'EXP:' || v_exp.id::text, v_exp.category || ' - ' || v_exp.vendor,
      v_exp_acct_id, v_cash_id, v_exp.amount_kes, null, null
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';