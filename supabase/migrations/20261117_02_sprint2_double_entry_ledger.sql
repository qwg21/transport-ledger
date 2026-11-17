-- 1. Accounting Periods
create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'LOCKED', 'CLOSED')),
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint accounting_periods_range_chk check (period_end >= period_start),
  unique (org_id, period_start, period_end)
);

alter table public.accounting_periods enable row level security;
drop policy if exists "accounting_periods_select_member" on public.accounting_periods;
create policy "accounting_periods_select_member"
  on public.accounting_periods for select to authenticated
  using (public.is_org_member(org_id));

-- 2. Chart of Accounts (Hierarchical + Control vs. Subledger)
create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  parent_account_id uuid,
  account_type text not null check (account_type in ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  normal_balance text not null check (normal_balance in ('DEBIT', 'CREDIT')),
  is_control_account boolean not null default false,
  subledger_type text check (subledger_type in ('CUSTOMER', 'SUPPLIER', 'INVENTORY', 'GRN', 'CASHBOOK', 'BANK_ACCOUNT', 'MPESA_ACCOUNT', 'TAX', 'PREPAYMENT')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, code),
  unique (org_id, id),
  constraint coa_parent_org_fkey foreign key (org_id, parent_account_id)
    references public.chart_of_accounts(org_id, id) on delete restrict
);

alter table public.chart_of_accounts enable row level security;
drop policy if exists "coa_select_member" on public.chart_of_accounts;
create policy "coa_select_member"
  on public.chart_of_accounts for select to authenticated
  using (public.is_org_member(org_id));

-- 3. Journal Entries (Read-only to clients; controlled posting via SECURITY DEFINER RPCs)
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entry_number text not null,
  entry_date date not null,
  source_type text not null,
  source_id uuid,
  posting_key text not null,
  description text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'POSTED', 'REVERSED')),
  reverses_entry_id uuid unique references public.journal_entries(id) on delete restrict,
  reversed_by_entry_id uuid unique references public.journal_entries(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, posting_key),
  unique (org_id, id)
);

alter table public.journal_entries enable row level security;
drop policy if exists "journal_entries_select_member" on public.journal_entries;
create policy "journal_entries_select_member"
  on public.journal_entries for select to authenticated
  using (public.is_org_member(org_id));

-- 4. Journal Lines (Composite FKs to journal_entries and chart_of_accounts)
create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entry_id uuid not null,
  line_no integer not null,
  account_id uuid not null,
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  subledger_type text,
  subledger_id uuid,
  memo text,
  created_at timestamptz not null default now(),
  constraint journal_lines_one_sided_chk check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0)),
  constraint journal_lines_entry_fkey foreign key (org_id, entry_id)
    references public.journal_entries(org_id, id) on delete cascade,
  constraint journal_lines_account_fkey foreign key (org_id, account_id)
    references public.chart_of_accounts(org_id, id) on delete restrict,
  unique (entry_id, line_no)
);

create index if not exists idx_journal_lines_org_account on public.journal_lines (org_id, account_id);
create index if not exists idx_journal_entries_org_date on public.journal_entries (org_id, entry_date desc);

alter table public.journal_lines enable row level security;
drop policy if exists "journal_lines_select_member" on public.journal_lines;
create policy "journal_lines_select_member"
  on public.journal_lines for select to authenticated
  using (public.is_org_member(org_id));

-- 5. Deferred Balance Enforcement Triggers (SUM(debit) = SUM(credit) > 0 when POSTED)
create or replace function public.enforce_balanced_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid := coalesce(new.entry_id, old.entry_id);
  v_status text;
  v_debit numeric(14, 2);
  v_credit numeric(14, 2);
begin
  select status into v_status from public.journal_entries where id = v_entry_id;
  if v_status in ('POSTED', 'REVERSED') then
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_debit, v_credit
    from public.journal_lines
    where entry_id = v_entry_id;

    if v_debit <= 0 or v_debit <> v_credit then
      raise exception 'Unbalanced journal entry %: debit (%) <> credit (%)', v_entry_id, v_debit, v_credit;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_enforce_balanced_journal_lines on public.journal_lines;
create constraint trigger trg_enforce_balanced_journal_lines
  after insert or update or delete on public.journal_lines
  deferrable initially deferred
  for each row execute function public.enforce_balanced_journal();

create or replace function public.enforce_balanced_journal_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debit numeric(14, 2);
  v_credit numeric(14, 2);
begin
  if new.status in ('POSTED', 'REVERSED') then
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_debit, v_credit
    from public.journal_lines
    where entry_id = new.id;

    if v_debit <= 0 or v_debit <> v_credit then
      raise exception 'Cannot post unbalanced journal entry %: debit (%) <> credit (%)', new.id, v_debit, v_credit;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_enforce_balanced_journal_entry on public.journal_entries;
create constraint trigger trg_enforce_balanced_journal_entry
  after insert or update of status on public.journal_entries
  deferrable initially deferred
  for each row execute function public.enforce_balanced_journal_entry();

-- 6. Immutability Triggers on Posted / Reversed Journals
create or replace function public.prevent_posted_journal_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'journal_entries' then
    if tg_op = 'DELETE' and old.status in ('POSTED', 'REVERSED') then
      raise exception 'Posted journal entries cannot be deleted';
    end if;
    if tg_op = 'UPDATE' and old.status in ('POSTED', 'REVERSED') then
      if not (old.status = 'POSTED' and new.status = 'REVERSED' and new.reversed_by_entry_id is not null and old.reversed_by_entry_id is null) then
        raise exception 'Posted journal entries are immutable; use reverse_journal_entry()';
      end if;
    end if;
    return coalesce(new, old);
  end if;

  if exists (
    select 1 from public.journal_entries je
    where je.id = coalesce(new.entry_id, old.entry_id)
      and je.status in ('POSTED', 'REVERSED')
  ) then
    raise exception 'Lines of a posted journal entry are immutable';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_immutable_journal_entries on public.journal_entries;
create trigger trg_immutable_journal_entries
  before update or delete on public.journal_entries
  for each row execute function public.prevent_posted_journal_mutation();

drop trigger if exists trg_immutable_journal_lines on public.journal_lines;
create trigger trg_immutable_journal_lines
  before insert or update or delete on public.journal_lines
  for each row execute function public.prevent_posted_journal_mutation();

-- 7. Seed Default Kenyan SME Chart of Accounts
create or replace function public.seed_default_chart_of_accounts(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash_hdr uuid;
  v_rev_hdr uuid;
  v_opex_hdr uuid;
begin
  insert into public.chart_of_accounts (org_id, code, name, account_type, normal_balance, is_control_account, subledger_type)
  values
    (p_org_id, '1000', 'Cash & Equivalents', 'ASSET', 'DEBIT', false, null),
    (p_org_id, '1100', 'Accounts Receivable (AR)', 'ASSET', 'DEBIT', true, 'CUSTOMER'),
    (p_org_id, '1200', 'Inventory Asset', 'ASSET', 'DEBIT', true, 'INVENTORY'),
    (p_org_id, '1300', 'Input VAT Recoverable', 'ASSET', 'DEBIT', false, 'TAX'),
    (p_org_id, '1400', 'Prepaid Expenses', 'ASSET', 'DEBIT', false, 'PREPAYMENT'),
    (p_org_id, '2000', 'Accounts Payable (AP)', 'LIABILITY', 'CREDIT', true, 'SUPPLIER'),
    (p_org_id, '2050', 'GRN Clearing (Unbilled Stock)', 'LIABILITY', 'CREDIT', true, 'GRN'),
    (p_org_id, '2100', 'Output VAT Payable', 'LIABILITY', 'CREDIT', false, 'TAX'),
    (p_org_id, '2150', 'Accrued Expenses', 'LIABILITY', 'CREDIT', false, null),
    (p_org_id, '2200', 'Customer Deposits & Unallocated Credits', 'LIABILITY', 'CREDIT', true, 'CUSTOMER'),
    (p_org_id, '3000', 'Opening Balance Equity', 'EQUITY', 'CREDIT', false, null),
    (p_org_id, '3100', 'Retained Earnings', 'EQUITY', 'CREDIT', false, null),
    (p_org_id, '4000', 'Sales Revenue (Net)', 'REVENUE', 'CREDIT', false, null),
    (p_org_id, '4100', 'Other Operating Income', 'REVENUE', 'CREDIT', false, null),
    (p_org_id, '5000', 'Cost of Goods Sold (COGS)', 'EXPENSE', 'DEBIT', false, null),
    (p_org_id, '5100', 'Inventory Shrinkage & Write-Offs', 'EXPENSE', 'DEBIT', false, null),
    (p_org_id, '5110', 'Inventory Count Gains', 'EXPENSE', 'CREDIT', false, null),
    (p_org_id, '5150', 'Purchase Price Variance', 'EXPENSE', 'DEBIT', false, null),
    (p_org_id, '6000', 'Operating Expenses', 'EXPENSE', 'DEBIT', false, null)
  on conflict (org_id, code) do nothing;

  select id into v_cash_hdr from public.chart_of_accounts where org_id = p_org_id and code = '1000';
  select id into v_rev_hdr from public.chart_of_accounts where org_id = p_org_id and code = '4000';
  select id into v_opex_hdr from public.chart_of_accounts where org_id = p_org_id and code = '6000';

  insert into public.chart_of_accounts (org_id, code, name, parent_account_id, account_type, normal_balance, is_control_account, subledger_type)
  values
    (p_org_id, '1001', 'Cash & Till', v_cash_hdr, 'ASSET', 'DEBIT', false, 'CASHBOOK'),
    (p_org_id, '1010', 'Bank Account', v_cash_hdr, 'ASSET', 'DEBIT', false, 'BANK_ACCOUNT'),
    (p_org_id, '1020', 'M-PESA Business', v_cash_hdr, 'ASSET', 'DEBIT', false, 'MPESA_ACCOUNT'),
    (p_org_id, '4900', 'Sales Returns & Allowances', v_rev_hdr, 'REVENUE', 'DEBIT', false, null),
    (p_org_id, '6010', 'General Operating Expenses', v_opex_hdr, 'EXPENSE', 'DEBIT', false, null)
  on conflict (org_id, code) do nothing;
end;
$$;

do $$
declare
  v_org record;
begin
  for v_org in select id from public.organizations loop
    perform public.seed_default_chart_of_accounts(v_org.id);
  end loop;
end;
$$;

-- 8. Controlled Immutable Reversal RPC (Impossible to apply twice)
create or replace function public.reverse_journal_entry(
  p_entry_id uuid,
  p_reason text default 'Reversal'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig record;
  v_rev_id uuid;
  v_line record;
  v_no integer := 0;
begin
  select * into v_orig from public.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Journal entry not found';
  end if;

  if not public.is_org_member(v_orig.org_id) or not public.has_active_subscription(v_orig.org_id) then
    raise exception 'Access denied or subscription inactive';
  end if;

  if v_orig.status = 'REVERSED' or v_orig.reversed_by_entry_id is not null then
    raise exception 'Journal entry % has already been reversed', p_entry_id;
  end if;

  if v_orig.status <> 'POSTED' then
    raise exception 'Only POSTED journal entries can be reversed';
  end if;

  insert into public.journal_entries (
    org_id, entry_number, entry_date, source_type, source_id, posting_key,
    description, status, reverses_entry_id, created_by, posted_at
  )
  values (
    v_orig.org_id,
    'REV-' || v_orig.entry_number,
    current_date,
    'REVERSAL',
    v_orig.id,
    'REV:' || v_orig.id::text,
    coalesce(nullif(trim(p_reason), ''), 'Reversal') || ' (' || v_orig.entry_number || ')',
    'DRAFT',
    v_orig.id,
    auth.uid(),
    now()
  )
  returning id into v_rev_id;

  for v_line in
    select * from public.journal_lines where entry_id = v_orig.id order by line_no
  loop
    v_no := v_no + 1;
    insert into public.journal_lines (
      org_id, entry_id, line_no, account_id, debit, credit, subledger_type, subledger_id, memo
    )
    values (
      v_line.org_id, v_rev_id, v_no, v_line.account_id,
      v_line.credit, v_line.debit,
      v_line.subledger_type, v_line.subledger_id, v_line.memo
    );
  end loop;

  update public.journal_entries set status = 'POSTED' where id = v_rev_id;
  update public.journal_entries
  set status = 'REVERSED', reversed_by_entry_id = v_rev_id
  where id = v_orig.id;

  return v_rev_id;
end;
$$;

notify pgrst, 'reload schema';