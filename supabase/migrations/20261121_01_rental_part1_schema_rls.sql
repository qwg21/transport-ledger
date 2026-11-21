-- ============================================================================
-- BIASHARA LEDGER — RENTAL MANAGEMENT: SQL SPECIFICATION — PART 1 OF 2
-- Contents: Sections 1-4 (CoA seed, 25 tables, RLS, immutability triggers)
-- Part 2 contains Section 5 (RPCs) and depends on objects created here.
-- Status: Pre-Migration Review Artifact (DO NOT EXECUTE IN PRODUCTION YET)
-- Changes vs. original: re-runnable policies/triggers; RAISE format fix in
-- validate_ownership_shares_not_over_100.
-- ============================================================================

begin;

create extension if not exists btree_gist;

-- ============================================================================
-- 1. CORE EXTENSIONS & AUTHORITATIVE RENTAL CHART OF ACCOUNTS
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'suppliers_org_id_id_key' and conrelid = 'public.suppliers'::regclass) then
    alter table public.suppliers add constraint suppliers_org_id_id_key unique (org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_org_id_id_key' and conrelid = 'public.expenses'::regclass) then
    alter table public.expenses add constraint expenses_org_id_id_key unique (org_id, id);
  end if;
end $$;

create or replace function public.seed_rental_chart_of_accounts(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_rev_hdr uuid;
begin
  select id into v_rev_hdr from public.chart_of_accounts where org_id = p_org_id and code = '4000';
  insert into public.chart_of_accounts (org_id, code, name, parent_account_id, account_type, normal_balance, is_control_account, subledger_type)
  values
    (p_org_id, '2210', 'Tenant Security Deposit Liability', null, 'LIABILITY', 'CREDIT', true, 'CUSTOMER'),
    (p_org_id, '2215', 'Tenant Advance / Credit Liability', null, 'LIABILITY', 'CREDIT', true, 'CUSTOMER'),
    (p_org_id, '2220', 'Owner Client-Money Liability', null, 'LIABILITY', 'CREDIT', true, 'CUSTOMER'),
    (p_org_id, '2230', 'Unallocated Receipts Suspense', null, 'LIABILITY', 'CREDIT', false, null),
    (p_org_id, '2240', 'Deferred Owner Billing (Contra-AR Memo)', null, 'LIABILITY', 'CREDIT', false, null),
    (p_org_id, '4050', 'Rental Income', v_rev_hdr, 'REVENUE', 'CREDIT', false, null),
    (p_org_id, '4060', 'Property Management Fee Revenue', v_rev_hdr, 'REVENUE', 'CREDIT', false, null),
    (p_org_id, '4070', 'Recoverable Repairs & Utility Income', v_rev_hdr, 'REVENUE', 'CREDIT', false, null)
  on conflict (org_id, code) do nothing;
end;
$$;

revoke all on function public.seed_rental_chart_of_accounts(uuid) from public;
-- Internal/trigger-only: do not grant to authenticated

-- Backfill existing organizations & hook into org creation trigger
do $$
declare v_org record;
begin
  for v_org in select id from public.organizations loop
    perform public.seed_rental_chart_of_accounts(v_org.id);
  end loop;
end $$;

create or replace function public.trg_seed_org_rental_coa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_rental_chart_of_accounts(new.id);
  return new;
end; $$;
drop trigger if exists trg_org_seed_rental_coa on public.organizations;
create trigger trg_org_seed_rental_coa after insert on public.organizations
  for each row execute function public.trg_seed_org_rental_coa();

create or replace function public.get_coa_id(p_org_id uuid, p_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.chart_of_accounts where org_id = p_org_id and code = p_code limit 1;
$$;

revoke all on function public.get_coa_id(uuid, text) from public;
-- Internal-only helper for SECURITY DEFINER RPCs

-- ============================================================================
-- 2. TABLES (ALL 25 RENTAL & JOB TABLES WITH COMPOSITE FKs)
-- ============================================================================
create table if not exists public.rental_owners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  customer_id uuid,
  name text not null,
  phone text,
  email text,
  kra_pin text,
  payout_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  constraint ro_org_customer_fkey foreign key (org_id, customer_id) references public.customers(org_id, id) on delete restrict
);

create table if not exists public.rental_properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  ref_code text not null,
  name text not null,
  operating_model text not null default 'DIRECT_LANDLORD' check (operating_model in ('DIRECT_LANDLORD', 'AGENCY_MANAGED')),
  category text not null default 'RESIDENTIAL' check (category in ('RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE', 'OTHER')),
  currency_code char(3) not null default 'KES' check (currency_code = 'KES'),
  county text,
  town text,
  address text,
  default_due_day integer not null default 5 check (default_due_day between 1 and 28),
  grace_days integer not null default 0 check (grace_days >= 0),
  tax_profile_code text not null default 'MRI_RESIDENTIAL',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, ref_code)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.rental_properties'::regclass
      and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attnum) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) = array['id','org_id']
  ) then
    alter table public.rental_properties add constraint rental_properties_org_id_id_key unique (org_id, id);
  end if;
end $$;

create table if not exists public.rental_property_ownerships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  owner_id uuid not null,
  ownership_pct numeric(5,2) not null check (ownership_pct > 0 and ownership_pct <= 100),
  is_primary boolean not null default false,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  constraint rpo_valid_dates check (effective_to is null or effective_to > effective_from),
  constraint rpo_org_property_fkey foreign key (org_id, property_id) references public.rental_properties(org_id, id) on delete restrict,
  constraint rpo_org_owner_fkey foreign key (org_id, owner_id) references public.rental_owners(org_id, id) on delete restrict,
  constraint rpo_no_duplicate_owner_overlap exclude using gist (
    property_id with =, owner_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
  )
);

create table if not exists public.rental_management_mandates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  fee_type text not null default 'PERCENTAGE' check (fee_type in ('PERCENTAGE', 'FIXED')),
  fee_value numeric(12,2) not null default 0 check (
    (fee_type = 'PERCENTAGE' and fee_value >= 0 and fee_value <= 100) or
    (fee_type = 'FIXED' and fee_value >= 0)
  ),
  fee_base text not null default 'GROSS_COLLECTED' check (fee_base in ('GROSS_COLLECTED', 'RENT_ONLY')),
  effective_from date not null,
  effective_to date,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'TERMINATED')),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  constraint rmm_valid_dates check (effective_to is null or effective_to > effective_from),
  constraint rmm_org_property_fkey foreign key (org_id, property_id) references public.rental_properties(org_id, id) on delete restrict,
  constraint rmm_no_overlapping_active_mandates exclude using gist (
    property_id with =, daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
  ) where (status = 'ACTIVE')
);

create table if not exists public.rental_property_permissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  property_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_scope text not null check (role_scope in ('PROPERTY_MANAGER', 'RENT_COLLECTOR', 'MAINTENANCE')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, user_id, property_id),
  constraint rpp_org_property_fkey foreign key (org_id, property_id) references public.rental_properties(org_id, id) on delete restrict
);

create table if not exists public.rental_buildings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  name text not null,
  floors integer,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, property_id, id),
  constraint rb_org_property_fkey foreign key (org_id, property_id) references public.rental_properties(org_id, id) on delete restrict
);

create table if not exists public.rental_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  building_id uuid,
  unit_code text not null,
  category text not null default '1BR',
  currency_code char(3) not null default 'KES' check (currency_code = 'KES'),
  monthly_rent numeric(14,2) not null default 0 check (monthly_rent >= 0),
  deposit_amount numeric(14,2) not null default 0 check (deposit_amount >= 0),
  meter_ref text,
  status text not null default 'VACANT' check (status in ('VACANT', 'OCCUPIED', 'RESERVED', 'MAINTENANCE', 'UNAVAILABLE')),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, property_id, id),
  unique (property_id, unit_code),
  constraint ru_org_property_fkey foreign key (org_id, property_id) references public.rental_properties(org_id, id) on delete restrict,
  constraint ru_org_prop_building_fkey foreign key (org_id, property_id, building_id) references public.rental_buildings(org_id, property_id, id) on delete restrict
);

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.rental_units'::regclass
      and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attnum) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) = array['id','org_id']
  ) then
    alter table public.rental_units add constraint rental_units_org_id_id_key unique (org_id, id);
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.rental_units'::regclass
      and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attnum) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) = array['id','org_id','property_id']
  ) then
    alter table public.rental_units add constraint rental_units_org_prop_id_key unique (org_id, property_id, id);
  end if;
end $$;

create table if not exists public.rental_applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  unit_id uuid not null,
  applicant_name text not null,
  phone text not null,
  email text,
  screening_status text not null default 'APPLIED' check (screening_status in ('APPLIED', 'SCREENING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  converted_customer_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  constraint ra_org_prop_unit_fkey foreign key (org_id, property_id, unit_id) references public.rental_units(org_id, property_id, id) on delete restrict,
  constraint ra_org_customer_fkey foreign key (org_id, converted_customer_id) references public.customers(org_id, id) on delete restrict
);

create table if not exists public.rental_tenancies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  unit_id uuid not null,
  customer_id uuid not null,
  payment_ref text not null,
  start_date date not null,
  end_date date,
  due_day_override integer check (due_day_override between 1 and 28),
  currency_code char(3) not null default 'KES' check (currency_code = 'KES'),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'EXPIRING', 'TERMINATED', 'COMPLETED')),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, property_id, id),
  unique (org_id, payment_ref),
  constraint rt_valid_dates check (end_date is null or end_date > start_date),
  constraint rt_org_prop_unit_fkey foreign key (org_id, property_id, unit_id) references public.rental_units(org_id, property_id, id) on delete restrict,
  constraint rt_org_customer_fkey foreign key (org_id, customer_id) references public.customers(org_id, id) on delete restrict,
  constraint rt_no_overlapping_tenancies exclude using gist (
    unit_id with =, daterange(start_date, coalesce(end_date, 'infinity'::date), '[)') with &&
  ) where (status in ('PENDING_APPROVAL', 'ACTIVE', 'EXPIRING'))
);

create table if not exists public.rental_tenancy_terms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  tenancy_id uuid not null,
  currency_code char(3) not null default 'KES' check (currency_code = 'KES'),
  monthly_rent numeric(14,2) not null check (monthly_rent >= 0),
  service_charge numeric(14,2) not null default 0 check (service_charge >= 0),
  late_fee_rule jsonb not null default '{}'::jsonb,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  constraint rtt_valid_dates check (effective_to is null or effective_to > effective_from),
  constraint rtt_org_tenancy_fkey foreign key (org_id, tenancy_id) references public.rental_tenancies(org_id, id) on delete restrict,
  constraint rtt_no_overlapping_terms exclude using gist (
    tenancy_id with =, daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
  )
);

create table if not exists public.rental_charges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  tenancy_id uuid not null,
  billing_period char(7) not null check (billing_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  charge_type text not null check (charge_type in ('RENT', 'WATER', 'ELECTRICITY', 'SERVICE_CHARGE', 'LATE_FEE', 'REPAIR_RECOVERABLE')),
  charge_sequence integer not null default 1 check (charge_sequence >= 1),
  due_date date not null,
  currency_code char(3) not null default 'KES' check (currency_code = 'KES'),
  amount numeric(14,2) not null check (amount > 0),
  exchange_rate_to_base numeric(14,6) not null default 1.0 check (exchange_rate_to_base > 0),
  base_amount numeric(14,2) not null check (base_amount > 0),
  status text not null default 'DUE' check (status in ('UPCOMING', 'DUE', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED', 'CANCELLED')),
  document_id uuid,
  journal_entry_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (tenancy_id, billing_period, charge_type, charge_sequence),
  constraint rc_org_prop_tenancy_fkey foreign key (org_id, property_id, tenancy_id) references public.rental_tenancies(org_id, property_id, id) on delete restrict,
  constraint rc_org_document_fkey foreign key (org_id, document_id) references public.documents(org_id, id) on delete restrict,
  constraint rc_org_journal_fkey foreign key (org_id, journal_entry_id) references public.journal_entries(org_id, id) on delete restrict
);

create table if not exists public.rental_collection_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  owner_id uuid,
  account_scope text not null default 'AGENCY_CLIENT' check (account_scope in ('LANDLORD_DIRECT', 'AGENCY_CLIENT', 'AGENCY_OPERATING')),
  provider text not null check (provider in ('MPESA_DARAJA', 'BANK_API', 'BANK_IMPORT', 'MANUAL_CASH', 'MANUAL_BANK')),
  account_type text not null check (account_type in ('PAYBILL', 'TILL', 'BANK', 'CASH')),
  account_identifier text not null,
  currency_code char(3) not null default 'KES' check (currency_code = 'KES'),
  vault_secret_ref text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, provider, account_identifier),
  constraint rca_owner_scope_check check (
    (account_scope = 'AGENCY_OPERATING' and owner_id is null) or
    (account_scope in ('LANDLORD_DIRECT', 'AGENCY_CLIENT'))
  ),
  constraint rca_org_owner_fkey foreign key (org_id, owner_id) references public.rental_owners(org_id, id) on delete restrict
);

create table if not exists public.rental_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  collection_account_id uuid not null,
  property_id uuid,
  customer_id uuid,
  tenancy_id uuid,
  provider text not null,
  provider_tx_id text not null,
  payment_ref_raw text,
  currency_code char(3) not null default 'KES' check (currency_code = 'KES'),
  amount numeric(14,2) not null check (amount > 0),
  exchange_rate_to_base numeric(14,6) not null default 1.0 check (exchange_rate_to_base > 0),
  base_amount numeric(14,2) not null check (base_amount > 0),
  paid_at timestamptz not null,
  status text not null check (status in ('PENDING_STK', 'RECEIVED', 'MATCHED', 'PARTIALLY_ALLOCATED', 'UNMATCHED', 'REVERSED', 'FAILED')),
  raw_payload jsonb not null default '{}'::jsonb,
  journal_entry_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, collection_account_id, provider_tx_id),
  constraint rpt_match_scope_chk check (
    (status in ('PENDING_STK', 'UNMATCHED', 'FAILED') and tenancy_id is null)
    or (tenancy_id is not null and property_id is not null and customer_id is not null)
  ),
  constraint rpt_org_acct_fkey foreign key (org_id, collection_account_id) references public.rental_collection_accounts(org_id, id) on delete restrict,
  constraint rpt_org_customer_fkey foreign key (org_id, customer_id) references public.customers(org_id, id) on delete restrict,
  constraint rpt_org_prop_tenancy_fkey foreign key (org_id, property_id, tenancy_id) references public.rental_tenancies(org_id, property_id, id) on delete restrict,
  constraint rpt_org_journal_fkey foreign key (org_id, journal_entry_id) references public.journal_entries(org_id, id) on delete restrict
);

create table if not exists public.rental_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  transaction_id uuid not null,
  charge_id uuid not null,
  event_type text not null default 'ALLOCATION' check (event_type in ('ALLOCATION', 'REVERSAL')),
  reversed_allocation_id uuid,
  currency_code char(3) not null default 'KES' check (currency_code = 'KES'),
  signed_amount numeric(14,2) not null check (
    (event_type = 'ALLOCATION' and signed_amount > 0) or
    (event_type = 'REVERSAL' and signed_amount < 0)
  ),
  journal_entry_id uuid,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  constraint rpa_org_tx_fkey foreign key (org_id, transaction_id) references public.rental_payment_transactions(org_id, id) on delete restrict,
  constraint rpa_org_charge_fkey foreign key (org_id, charge_id) references public.rental_charges(org_id, id) on delete restrict,
  constraint rpa_org_rev_fkey foreign key (org_id, reversed_allocation_id) references public.rental_payment_allocations(org_id, id) on delete restrict,
  constraint rpa_org_journal_fkey foreign key (org_id, journal_entry_id) references public.journal_entries(org_id, id) on delete restrict
);

create table if not exists public.rental_payment_reversals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  transaction_id uuid not null,
  reason text not null,
  reversed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, transaction_id),
  constraint rpr_org_tx_fkey foreign key (org_id, transaction_id) references public.rental_payment_transactions(org_id, id) on delete restrict
);

create table if not exists public.rental_journal_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  transaction_id uuid not null,
  link_role text not null check (link_role in ('RECEIPT', 'OWNER_ENTITLEMENT', 'MANAGEMENT_FEE', 'SUSPENSE_OR_CREDIT')),
  journal_entry_id uuid not null,
  reversal_journal_entry_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, transaction_id, link_role, journal_entry_id),
  constraint rjl_org_tx_fkey foreign key (org_id, transaction_id) references public.rental_payment_transactions(org_id, id) on delete restrict,
  constraint rjl_org_journal_fkey foreign key (org_id, journal_entry_id) references public.journal_entries(org_id, id) on delete restrict,
  constraint rjl_org_rev_journal_fkey foreign key (org_id, reversal_journal_entry_id) references public.journal_entries(org_id, id) on delete restrict
);

create table if not exists public.rental_credit_suspense_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  bucket_type text not null check (bucket_type in ('UNALLOCATED_SUSPENSE', 'TENANT_ADVANCE_CREDIT')),
  transaction_id uuid not null,
  tenancy_id uuid,
  currency_code char(3) not null default 'KES' check (currency_code = 'KES'),
  signed_amount numeric(14,2) not null check (signed_amount <> 0),
  reason text not null,
  journal_entry_id uuid,
  created_at timestamptz not null default now(),
  constraint rcsl_org_tx_fkey foreign key (org_id, transaction_id) references public.rental_payment_transactions(org_id, id) on delete restrict,
  constraint rcsl_org_tenancy_fkey foreign key (org_id, tenancy_id) references public.rental_tenancies(org_id, id) on delete restrict,
  constraint rcsl_org_journal_fkey foreign key (org_id, journal_entry_id) references public.journal_entries(org_id, id) on delete restrict
);

create table if not exists public.rental_deposit_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  tenancy_id uuid not null,
  tx_type text not null check (tx_type in ('RECEIVED', 'DEDUCTION', 'REFUND', 'TRANSFER', 'REVERSAL')),
  currency_code char(3) not null default 'KES' check (currency_code = 'KES'),
  signed_amount numeric(14,2) not null check (signed_amount <> 0),
  reason text not null,
  journal_entry_id uuid,
  created_at timestamptz not null default now(),
  constraint rdl_org_tenancy_fkey foreign key (org_id, tenancy_id) references public.rental_tenancies(org_id, id) on delete restrict,
  constraint rdl_org_journal_fkey foreign key (org_id, journal_entry_id) references public.journal_entries(org_id, id) on delete restrict
);

create table if not exists public.rental_owner_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_id uuid not null,
  property_id uuid not null,
  transaction_id uuid,
  entry_type text not null check (entry_type in ('RENT_ENTITLEMENT', 'MANAGEMENT_FEE', 'OWNER_EXPENSE', 'REMITTANCE', 'REVERSAL')),
  source_type text not null,
  source_id uuid not null,
  currency_code char(3) not null default 'KES' check (currency_code = 'KES'),
  signed_amount numeric(14,2) not null check (signed_amount <> 0),
  remittance_id uuid,
  journal_entry_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, owner_id, source_type, source_id, entry_type),
  constraint role_org_owner_fkey foreign key (org_id, owner_id) references public.rental_owners(org_id, id) on delete restrict,
  constraint role_org_property_fkey foreign key (org_id, property_id) references public.rental_properties(org_id, id) on delete restrict,
  constraint role_org_tx_fkey foreign key (org_id, transaction_id) references public.rental_payment_transactions(org_id, id) on delete restrict,
  constraint role_org_journal_fkey foreign key (org_id, journal_entry_id) references public.journal_entries(org_id, id) on delete restrict
);

create table if not exists public.rental_inspections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  unit_id uuid not null,
  tenancy_id uuid,
  inspection_type text not null check (inspection_type in ('MOVE_IN', 'ROUTINE', 'MOVE_OUT')),
  findings jsonb not null default '{}'::jsonb,
  meter_readings jsonb not null default '{}'::jsonb,
  inspected_at timestamptz not null default now(),
  constraint ri_org_prop_unit_fkey foreign key (org_id, property_id, unit_id) references public.rental_units(org_id, property_id, id) on delete restrict,
  constraint ri_org_prop_tenancy_fkey foreign key (org_id, property_id, tenancy_id) references public.rental_tenancies(org_id, property_id, id) on delete restrict
);

create table if not exists public.rental_maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  unit_id uuid not null,
  tenancy_id uuid,
  supplier_id uuid,
  expense_id uuid,
  description text not null,
  priority text not null default 'MEDIUM' check (priority in ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  status text not null default 'SUBMITTED' check (status in ('SUBMITTED', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_PARTS', 'COMPLETED', 'CANCELLED')),
  est_cost numeric(14,2),
  actual_cost numeric(14,2),
  created_at timestamptz not null default now(),
  constraint rmr_org_prop_unit_fkey foreign key (org_id, property_id, unit_id) references public.rental_units(org_id, property_id, id) on delete restrict,
  constraint rmr_org_prop_tenancy_fkey foreign key (org_id, property_id, tenancy_id) references public.rental_tenancies(org_id, property_id, id) on delete restrict,
  constraint rmr_org_supplier_fkey foreign key (org_id, supplier_id) references public.suppliers(org_id, id) on delete restrict,
  constraint rmr_org_expense_fkey foreign key (org_id, expense_id) references public.expenses(org_id, id) on delete restrict
);

create table if not exists public.rental_property_budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  fiscal_period char(7) not null,
  category text not null,
  currency_code char(3) not null default 'KES' check (currency_code = 'KES'),
  budgeted_amount numeric(14,2) not null check (budgeted_amount >= 0),
  unique (org_id, property_id, fiscal_period, category),
  constraint rpb_org_property_fkey foreign key (org_id, property_id) references public.rental_properties(org_id, id) on delete restrict
);

create table if not exists public.rental_owner_remittances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_id uuid not null,
  property_id uuid not null,
  idempotency_key text not null,
  period_start date not null,
  period_end date not null,
  currency_code char(3) not null default 'KES' check (currency_code = 'KES'),
  gross_collected numeric(14,2) not null,
  management_fee numeric(14,2) not null,
  expenses_deducted numeric(14,2) not null,
  net_paid numeric(14,2) not null,
  journal_entry_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key),
  constraint ror_org_owner_fkey foreign key (org_id, owner_id) references public.rental_owners(org_id, id) on delete restrict,
  constraint ror_org_property_fkey foreign key (org_id, property_id) references public.rental_properties(org_id, id) on delete restrict,
  constraint ror_org_journal_fkey foreign key (org_id, journal_entry_id) references public.journal_entries(org_id, id) on delete restrict
);

create table if not exists public.rental_portal_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  grant_type text not null check (grant_type in ('TENANT', 'OWNER')),
  tenancy_id uuid,
  owner_id uuid,
  property_id uuid,
  valid_from date not null default current_date,
  valid_until date,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint rpg_valid_dates check (valid_until is null or valid_until >= valid_from),
  constraint rpg_scope_check check (
    (grant_type = 'TENANT' and tenancy_id is not null and owner_id is null and property_id is null) or
    (grant_type = 'OWNER' and owner_id is not null and tenancy_id is null)
  ),
  constraint rpg_org_tenancy_fkey foreign key (org_id, tenancy_id) references public.rental_tenancies(org_id, id) on delete restrict,
  constraint rpg_org_owner_fkey foreign key (org_id, owner_id) references public.rental_owners(org_id, id) on delete restrict,
  constraint rpg_org_property_fkey foreign key (org_id, property_id) references public.rental_properties(org_id, id) on delete restrict
);

create table if not exists public.background_job_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  job_type text not null,
  run_key text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_until timestamptz,
  worker_id text,
  next_retry_at timestamptz,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index if not exists idx_bjr_org_run_key on public.background_job_runs (org_id, job_type, run_key) where org_id is not null;
create unique index if not exists idx_bjr_sys_run_key on public.background_job_runs (job_type, run_key) where org_id is null;

-- ============================================================================
-- 3. SECURITY HELPERS & EXPLICIT 4-OPERATION RLS POLICIES (ALL 25 TABLES)
-- ============================================================================
create or replace function public.is_org_admin_or_finance(p_org_id uuid, p_roles text[] default array['owner','admin','accountant','rental_admin'])
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_org_member(p_org_id) and exists (
    select 1 from public.organization_members m
    where m.org_id = p_org_id and m.user_id = auth.uid() and lower(coalesce(m.role, '')) = any(p_roles)
  );
$$;
revoke all on function public.is_org_admin_or_finance(uuid, text[]) from public;
grant execute on function public.is_org_admin_or_finance(uuid, text[]) to authenticated;

create or replace function public.is_property_authorized(p_org_id uuid, p_property_id uuid, p_required_scope text default 'PROPERTY_VIEW')
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_org_member(p_org_id) and (
    public.is_org_admin_or_finance(p_org_id, array['owner','admin','rental_admin'])
    or (public.is_org_admin_or_finance(p_org_id, array['accountant']) and p_required_scope in ('PROPERTY_VIEW','FINANCE_VIEW','FINANCE_POST','RENT_COLLECT'))
    or exists (
      select 1 from public.rental_property_permissions pp
      where pp.org_id = p_org_id and pp.property_id = p_property_id and pp.user_id = auth.uid() and pp.revoked_at is null
        and (
          (pp.role_scope = 'PROPERTY_MANAGER' and p_required_scope in ('PROPERTY_VIEW','PROPERTY_MANAGE','TENANCY_MANAGE','FINANCE_VIEW','RENT_COLLECT','MAINTENANCE_VIEW','MAINTENANCE_MANAGE'))
          or (pp.role_scope = 'RENT_COLLECTOR' and p_required_scope in ('PROPERTY_VIEW','FINANCE_VIEW','RENT_COLLECT'))
          or (pp.role_scope = 'MAINTENANCE' and p_required_scope in ('PROPERTY_VIEW','MAINTENANCE_VIEW','MAINTENANCE_MANAGE'))
        )
    )
  );
$$;
revoke all on function public.is_property_authorized(uuid, uuid, text) from public;
grant execute on function public.is_property_authorized(uuid, uuid, text) to authenticated;

create or replace function public.is_portal_tenant(p_org_id uuid, p_tenancy_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.rental_portal_grants g
    where g.org_id = p_org_id and g.user_id = auth.uid() and g.grant_type = 'TENANT' and g.tenancy_id = p_tenancy_id
      and g.revoked_at is null and current_date >= g.valid_from and (g.valid_until is null or current_date <= g.valid_until)
  );
$$;
revoke all on function public.is_portal_tenant(uuid, uuid) from public;
grant execute on function public.is_portal_tenant(uuid, uuid) to authenticated;

create or replace function public.is_portal_owner(p_org_id uuid, p_owner_id uuid, p_property_id uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.rental_portal_grants g
    join public.rental_property_ownerships o
      on o.org_id = g.org_id and o.owner_id = g.owner_id
     and (p_property_id is null or o.property_id = p_property_id)
     and (g.property_id is null or g.property_id = o.property_id)
     and o.effective_from <= current_date and (o.effective_to is null or o.effective_to > current_date)
    where g.org_id = p_org_id and g.user_id = auth.uid() and g.grant_type = 'OWNER' and g.owner_id = p_owner_id
      and g.revoked_at is null and current_date >= g.valid_from and (g.valid_until is null or current_date <= g.valid_until)
  );
$$;
revoke all on function public.is_portal_owner(uuid, uuid, uuid) from public;
grant execute on function public.is_portal_owner(uuid, uuid, uuid) to authenticated;

do $$ declare t text; begin
  for t in select unnest(array[
    'rental_owners','rental_properties','rental_property_ownerships','rental_management_mandates',
    'rental_property_permissions','rental_buildings','rental_units','rental_applications',
    'rental_tenancies','rental_tenancy_terms','rental_charges','rental_collection_accounts',
    'rental_payment_transactions','rental_payment_allocations','rental_payment_reversals',
    'rental_journal_links','rental_credit_suspense_ledger','rental_deposit_ledger',
    'rental_owner_ledger_entries','rental_inspections','rental_maintenance_requests',
    'rental_property_budgets','rental_owner_remittances','rental_portal_grants','background_job_runs'
  ]) loop execute format('alter table public.%I enable row level security;', t); end loop;
end $$;

-- Re-runnability: drop any existing policies on these 25 tables before recreating
do $$ declare r record; begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename = any(array[
      'rental_owners','rental_properties','rental_property_ownerships','rental_management_mandates',
      'rental_property_permissions','rental_buildings','rental_units','rental_applications',
      'rental_tenancies','rental_tenancy_terms','rental_charges','rental_collection_accounts',
      'rental_payment_transactions','rental_payment_allocations','rental_payment_reversals',
      'rental_journal_links','rental_credit_suspense_ledger','rental_deposit_ledger',
      'rental_owner_ledger_entries','rental_inspections','rental_maintenance_requests',
      'rental_property_budgets','rental_owner_remittances','rental_portal_grants','background_job_runs'
    ])
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Explicit SELECT / INSERT / UPDATE / DELETE policies on all 25 tables
-- 1-15: Operational & Configuration Tables
create policy "ro_sel" on public.rental_owners for select to authenticated using (public.is_org_admin_or_finance(org_id) or public.is_portal_owner(org_id, id));
create policy "ro_ins" on public.rental_owners for insert to authenticated with check (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id));
create policy "ro_upd" on public.rental_owners for update to authenticated using (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id)) with check (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id));
create policy "ro_del" on public.rental_owners for delete to authenticated using (false);

create policy "rp_sel" on public.rental_properties for select to authenticated using (public.is_property_authorized(org_id, id, 'PROPERTY_VIEW') or exists (select 1 from public.rental_property_ownerships o where o.property_id = rental_properties.id and public.is_portal_owner(o.org_id, o.owner_id, o.property_id)));
create policy "rp_ins" on public.rental_properties for insert to authenticated with check (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id));
create policy "rp_upd" on public.rental_properties for update to authenticated using (public.is_property_authorized(org_id, id, 'PROPERTY_MANAGE') and public.has_active_subscription(org_id)) with check (public.is_property_authorized(org_id, id, 'PROPERTY_MANAGE') and public.has_active_subscription(org_id));
create policy "rp_del" on public.rental_properties for delete to authenticated using (false);

create policy "rpo_sel" on public.rental_property_ownerships for select to authenticated using (public.is_org_admin_or_finance(org_id) or public.is_portal_owner(org_id, owner_id, property_id));
create policy "rpo_ins" on public.rental_property_ownerships for insert to authenticated with check (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id));
create policy "rpo_upd" on public.rental_property_ownerships for update to authenticated using (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id)) with check (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id));
create policy "rpo_del" on public.rental_property_ownerships for delete to authenticated using (false);

create policy "rmm_sel" on public.rental_management_mandates for select to authenticated using (public.is_org_admin_or_finance(org_id) or public.is_property_authorized(org_id, property_id, 'PROPERTY_VIEW'));
create policy "rmm_ins" on public.rental_management_mandates for insert to authenticated with check (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id));
create policy "rmm_upd" on public.rental_management_mandates for update to authenticated using (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id)) with check (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id));
create policy "rmm_del" on public.rental_management_mandates for delete to authenticated using (false);

create policy "rpp_sel" on public.rental_property_permissions for select to authenticated using (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) or user_id = auth.uid());
create policy "rpp_ins" on public.rental_property_permissions for insert to authenticated with check (public.is_org_admin_or_finance(org_id, array['owner','admin']) and public.has_active_subscription(org_id));
create policy "rpp_upd" on public.rental_property_permissions for update to authenticated using (public.is_org_admin_or_finance(org_id, array['owner','admin']) and public.has_active_subscription(org_id)) with check (public.is_org_admin_or_finance(org_id, array['owner','admin']) and public.has_active_subscription(org_id));
create policy "rpp_del" on public.rental_property_permissions for delete to authenticated using (false);

create policy "rb_sel" on public.rental_buildings for select to authenticated using (public.is_property_authorized(org_id, property_id, 'PROPERTY_VIEW'));
create policy "rb_ins" on public.rental_buildings for insert to authenticated with check (public.is_property_authorized(org_id, property_id, 'PROPERTY_MANAGE') and public.has_active_subscription(org_id));
create policy "rb_upd" on public.rental_buildings for update to authenticated using (public.is_property_authorized(org_id, property_id, 'PROPERTY_MANAGE') and public.has_active_subscription(org_id)) with check (public.is_property_authorized(org_id, property_id, 'PROPERTY_MANAGE') and public.has_active_subscription(org_id));
create policy "rb_del" on public.rental_buildings for delete to authenticated using (false);

create policy "ru_sel" on public.rental_units for select to authenticated using (public.is_property_authorized(org_id, property_id, 'PROPERTY_VIEW') or exists (select 1 from public.rental_tenancies t where t.unit_id = rental_units.id and public.is_portal_tenant(t.org_id, t.id)));
create policy "ru_ins" on public.rental_units for insert to authenticated with check (public.is_property_authorized(org_id, property_id, 'PROPERTY_MANAGE') and public.has_active_subscription(org_id));
create policy "ru_upd" on public.rental_units for update to authenticated using (public.is_property_authorized(org_id, property_id, 'PROPERTY_MANAGE') and public.has_active_subscription(org_id)) with check (public.is_property_authorized(org_id, property_id, 'PROPERTY_MANAGE') and public.has_active_subscription(org_id));
create policy "ru_del" on public.rental_units for delete to authenticated using (false);

create policy "ra_sel" on public.rental_applications for select to authenticated using (public.is_property_authorized(org_id, property_id, 'TENANCY_MANAGE'));
create policy "ra_ins" on public.rental_applications for insert to authenticated with check (public.is_property_authorized(org_id, property_id, 'TENANCY_MANAGE') and public.has_active_subscription(org_id));
create policy "ra_upd" on public.rental_applications for update to authenticated using (public.is_property_authorized(org_id, property_id, 'TENANCY_MANAGE') and public.has_active_subscription(org_id)) with check (public.is_property_authorized(org_id, property_id, 'TENANCY_MANAGE') and public.has_active_subscription(org_id));
create policy "ra_del" on public.rental_applications for delete to authenticated using (false);

create policy "rt_sel" on public.rental_tenancies for select to authenticated using (public.is_property_authorized(org_id, property_id, 'FINANCE_VIEW') or public.is_portal_tenant(org_id, id));
create policy "rt_ins" on public.rental_tenancies for insert to authenticated with check (public.is_property_authorized(org_id, property_id, 'TENANCY_MANAGE') and public.has_active_subscription(org_id));
create policy "rt_upd" on public.rental_tenancies for update to authenticated using (false);
create policy "rt_del" on public.rental_tenancies for delete to authenticated using (false);

create policy "rtt_sel" on public.rental_tenancy_terms for select to authenticated using (exists (select 1 from public.rental_tenancies t where t.id = rental_tenancy_terms.tenancy_id and (public.is_property_authorized(t.org_id, t.property_id, 'FINANCE_VIEW') or public.is_portal_tenant(t.org_id, t.id))));
create policy "rtt_ins" on public.rental_tenancy_terms for insert to authenticated with check (exists (select 1 from public.rental_tenancies t where t.id = rental_tenancy_terms.tenancy_id and public.is_property_authorized(t.org_id, t.property_id, 'TENANCY_MANAGE') and public.has_active_subscription(t.org_id)));
create policy "rtt_upd" on public.rental_tenancy_terms for update to authenticated using (false);
create policy "rtt_del" on public.rental_tenancy_terms for delete to authenticated using (false);

create policy "rca_sel" on public.rental_collection_accounts for select to authenticated using (public.is_org_admin_or_finance(org_id));
create policy "rca_ins" on public.rental_collection_accounts for insert to authenticated with check (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id));
create policy "rca_upd" on public.rental_collection_accounts for update to authenticated using (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id)) with check (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id));
create policy "rca_del" on public.rental_collection_accounts for delete to authenticated using (false);

create policy "ri_sel" on public.rental_inspections for select to authenticated using (public.is_property_authorized(org_id, property_id, 'PROPERTY_VIEW') or public.is_portal_tenant(org_id, tenancy_id));
create policy "ri_ins" on public.rental_inspections for insert to authenticated with check (public.is_property_authorized(org_id, property_id, 'PROPERTY_MANAGE') and public.has_active_subscription(org_id));
create policy "ri_upd" on public.rental_inspections for update to authenticated using (public.is_property_authorized(org_id, property_id, 'PROPERTY_MANAGE') and public.has_active_subscription(org_id)) with check (public.is_property_authorized(org_id, property_id, 'PROPERTY_MANAGE') and public.has_active_subscription(org_id));
create policy "ri_del" on public.rental_inspections for delete to authenticated using (false);

create policy "rmr_sel" on public.rental_maintenance_requests for select to authenticated using (public.is_property_authorized(org_id, property_id, 'MAINTENANCE_VIEW') or public.is_portal_tenant(org_id, tenancy_id));
create policy "rmr_ins" on public.rental_maintenance_requests for insert to authenticated with check ((public.is_property_authorized(org_id, property_id, 'MAINTENANCE_MANAGE') and public.has_active_subscription(org_id)) or public.is_portal_tenant(org_id, tenancy_id));
create policy "rmr_upd" on public.rental_maintenance_requests for update to authenticated using (public.is_property_authorized(org_id, property_id, 'MAINTENANCE_MANAGE') and public.has_active_subscription(org_id)) with check (public.is_property_authorized(org_id, property_id, 'MAINTENANCE_MANAGE') and public.has_active_subscription(org_id));
create policy "rmr_del" on public.rental_maintenance_requests for delete to authenticated using (false);

create policy "rpb_sel" on public.rental_property_budgets for select to authenticated using (public.is_property_authorized(org_id, property_id, 'FINANCE_VIEW'));
create policy "rpb_ins" on public.rental_property_budgets for insert to authenticated with check (public.is_property_authorized(org_id, property_id, 'PROPERTY_MANAGE') and public.has_active_subscription(org_id));
create policy "rpb_upd" on public.rental_property_budgets for update to authenticated using (public.is_property_authorized(org_id, property_id, 'PROPERTY_MANAGE') and public.has_active_subscription(org_id)) with check (public.is_property_authorized(org_id, property_id, 'PROPERTY_MANAGE') and public.has_active_subscription(org_id));
create policy "rpb_del" on public.rental_property_budgets for delete to authenticated using (false);

create policy "rpg_sel" on public.rental_portal_grants for select to authenticated using (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) or user_id = auth.uid());
create policy "rpg_ins" on public.rental_portal_grants for insert to authenticated with check (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id));
create policy "rpg_upd" on public.rental_portal_grants for update to authenticated using (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id)) with check (public.is_org_admin_or_finance(org_id, array['owner','admin','rental_admin']) and public.has_active_subscription(org_id));
create policy "rpg_del" on public.rental_portal_grants for delete to authenticated using (false);

-- 16-24: Financial Ledger Tables (Explicit SELECT + Explicit INSERT/UPDATE/DELETE Denial)
create policy "rc_sel" on public.rental_charges for select to authenticated using (public.is_property_authorized(org_id, property_id, 'FINANCE_VIEW') or public.is_portal_tenant(org_id, tenancy_id));
create policy "rc_ins" on public.rental_charges for insert to authenticated with check (false);
create policy "rc_upd" on public.rental_charges for update to authenticated using (false);
create policy "rc_del" on public.rental_charges for delete to authenticated using (false);

create policy "rpt_sel" on public.rental_payment_transactions for select to authenticated using ((property_id is not null and public.is_property_authorized(org_id, property_id, 'FINANCE_VIEW')) or (property_id is null and public.is_org_admin_or_finance(org_id)));
create policy "rpt_ins" on public.rental_payment_transactions for insert to authenticated with check (false);
create policy "rpt_upd" on public.rental_payment_transactions for update to authenticated using (false);
create policy "rpt_del" on public.rental_payment_transactions for delete to authenticated using (false);

create policy "rpa_sel" on public.rental_payment_allocations for select to authenticated using (exists (select 1 from public.rental_charges c where c.id = rental_payment_allocations.charge_id and (public.is_property_authorized(c.org_id, c.property_id, 'FINANCE_VIEW') or public.is_portal_tenant(c.org_id, c.tenancy_id))));
create policy "rpa_ins" on public.rental_payment_allocations for insert to authenticated with check (false);
create policy "rpa_upd" on public.rental_payment_allocations for update to authenticated using (false);
create policy "rpa_del" on public.rental_payment_allocations for delete to authenticated using (false);

create policy "rpr_sel" on public.rental_payment_reversals for select to authenticated using (public.is_org_admin_or_finance(org_id));
create policy "rpr_ins" on public.rental_payment_reversals for insert to authenticated with check (false);
create policy "rpr_upd" on public.rental_payment_reversals for update to authenticated using (false);
create policy "rpr_del" on public.rental_payment_reversals for delete to authenticated using (false);

create policy "rjl_sel" on public.rental_journal_links for select to authenticated using (public.is_org_admin_or_finance(org_id));
create policy "rjl_ins" on public.rental_journal_links for insert to authenticated with check (false);
create policy "rjl_upd" on public.rental_journal_links for update to authenticated using (false);
create policy "rjl_del" on public.rental_journal_links for delete to authenticated using (false);

create policy "rcsl_sel" on public.rental_credit_suspense_ledger for select to authenticated using (public.is_org_admin_or_finance(org_id) or (tenancy_id is not null and public.is_portal_tenant(org_id, tenancy_id)));
create policy "rcsl_ins" on public.rental_credit_suspense_ledger for insert to authenticated with check (false);
create policy "rcsl_upd" on public.rental_credit_suspense_ledger for update to authenticated using (false);
create policy "rcsl_del" on public.rental_credit_suspense_ledger for delete to authenticated using (false);

create policy "rdl_sel" on public.rental_deposit_ledger for select to authenticated using (exists (select 1 from public.rental_tenancies t where t.id = rental_deposit_ledger.tenancy_id and (public.is_property_authorized(t.org_id, t.property_id, 'FINANCE_VIEW') or public.is_portal_tenant(t.org_id, t.id))));
create policy "rdl_ins" on public.rental_deposit_ledger for insert to authenticated with check (false);
create policy "rdl_upd" on public.rental_deposit_ledger for update to authenticated using (false);
create policy "rdl_del" on public.rental_deposit_ledger for delete to authenticated using (false);

create policy "role_sel" on public.rental_owner_ledger_entries for select to authenticated using (public.is_property_authorized(org_id, property_id, 'FINANCE_VIEW') or public.is_portal_owner(org_id, owner_id, property_id));
create policy "role_ins" on public.rental_owner_ledger_entries for insert to authenticated with check (false);
create policy "role_upd" on public.rental_owner_ledger_entries for update to authenticated using (false);
create policy "role_del" on public.rental_owner_ledger_entries for delete to authenticated using (false);

create policy "ror_sel" on public.rental_owner_remittances for select to authenticated using (public.is_property_authorized(org_id, property_id, 'FINANCE_VIEW') or public.is_portal_owner(org_id, owner_id, property_id));
create policy "ror_ins" on public.rental_owner_remittances for insert to authenticated with check (false);
create policy "ror_upd" on public.rental_owner_remittances for update to authenticated using (false);
create policy "ror_del" on public.rental_owner_remittances for delete to authenticated using (false);

-- 25. background_job_runs
create policy "bjr_sel" on public.background_job_runs for select to authenticated using (org_id is not null and public.is_org_admin_or_finance(org_id, array['owner','admin','accountant']));
create policy "bjr_ins" on public.background_job_runs for insert to authenticated with check (false);
create policy "bjr_upd" on public.background_job_runs for update to authenticated using (false);
create policy "bjr_del" on public.background_job_runs for delete to authenticated using (false);

-- ============================================================================
-- 4. IMMUTABILITY PRIVILEGES & TRIGGERS
-- ============================================================================
revoke insert, update, delete on
  public.rental_charges, public.rental_payment_transactions, public.rental_payment_allocations,
  public.rental_payment_reversals, public.rental_journal_links, public.rental_credit_suspense_ledger,
  public.rental_deposit_ledger, public.rental_owner_ledger_entries, public.rental_owner_remittances
from authenticated, anon;

create or replace function public.prevent_rental_financial_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Deleting financial records from % is prohibited.', tg_table_name;
  end if;
  if tg_op = 'UPDATE' then
    if tg_table_name in (
      'rental_payment_allocations', 'rental_payment_reversals',
      'rental_credit_suspense_ledger', 'rental_deposit_ledger', 'rental_owner_remittances'
    ) then
      raise exception 'Table % is append-only; post a reversal instead.', tg_table_name;
    end if;
    if tg_table_name = 'rental_journal_links' and (old.reversal_journal_entry_id is not null or new.journal_entry_id <> old.journal_entry_id or new.transaction_id <> old.transaction_id) then
      raise exception 'rental_journal_links can only set reversal_journal_entry_id once.';
    end if;
    if tg_table_name = 'rental_owner_ledger_entries' and (old.remittance_id is not null or new.signed_amount <> old.signed_amount or new.owner_id <> old.owner_id) then
      raise exception 'rental_owner_ledger_entries can only claim remittance_id once.';
    end if;
    if tg_table_name = 'rental_charges' and (new.amount <> old.amount or new.currency_code <> old.currency_code or new.tenancy_id <> old.tenancy_id or new.billing_period <> old.billing_period) then
      raise exception 'Immutable charge columns cannot be modified.';
    end if;
    if tg_table_name = 'rental_payment_transactions' and (new.amount <> old.amount or new.currency_code <> old.currency_code or new.provider_tx_id <> old.provider_tx_id or new.collection_account_id <> old.collection_account_id) then
      raise exception 'Immutable payment columns cannot be modified.';
    end if;
  end if;
  return new;
end;
$$;

-- Re-runnability: drop triggers before recreating
drop trigger if exists trg_imm_charges on public.rental_charges;
drop trigger if exists trg_imm_tx on public.rental_payment_transactions;
drop trigger if exists trg_imm_alloc on public.rental_payment_allocations;
drop trigger if exists trg_imm_rev on public.rental_payment_reversals;
drop trigger if exists trg_imm_susp on public.rental_credit_suspense_ledger;
drop trigger if exists trg_imm_dep on public.rental_deposit_ledger;
drop trigger if exists trg_imm_own_ledg on public.rental_owner_ledger_entries;
drop trigger if exists trg_imm_remit on public.rental_owner_remittances;
drop trigger if exists trg_imm_jlinks on public.rental_journal_links;
drop trigger if exists trg_validate_ownership_shares on public.rental_property_ownerships;

create trigger trg_imm_charges before update or delete on public.rental_charges for each row execute function public.prevent_rental_financial_mutation();
create trigger trg_imm_tx before update or delete on public.rental_payment_transactions for each row execute function public.prevent_rental_financial_mutation();
create trigger trg_imm_alloc before update or delete on public.rental_payment_allocations for each row execute function public.prevent_rental_financial_mutation();
create trigger trg_imm_rev before update or delete on public.rental_payment_reversals for each row execute function public.prevent_rental_financial_mutation();
create trigger trg_imm_susp before update or delete on public.rental_credit_suspense_ledger for each row execute function public.prevent_rental_financial_mutation();
create trigger trg_imm_dep before update or delete on public.rental_deposit_ledger for each row execute function public.prevent_rental_financial_mutation();
create trigger trg_imm_own_ledg before update or delete on public.rental_owner_ledger_entries for each row execute function public.prevent_rental_financial_mutation();
create trigger trg_imm_remit before update or delete on public.rental_owner_remittances for each row execute function public.prevent_rental_financial_mutation();
create trigger trg_imm_jlinks before update or delete on public.rental_journal_links for each row execute function public.prevent_rental_financial_mutation();

-- Ownership-share <= 100% & max 1 primary owner trigger
create or replace function public.validate_ownership_shares_not_over_100()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_max_pct numeric(7,2); v_max_prim integer;
begin
  perform 1 from public.rental_properties where id = new.property_id and org_id = new.org_id for update;
  with boundaries as (
    select effective_from as dt from public.rental_property_ownerships where property_id = new.property_id
    union
    select effective_to as dt from public.rental_property_ownerships where property_id = new.property_id and effective_to is not null
  )
  select coalesce(max(day_sum), 0), coalesce(max(prim_cnt), 0) into v_max_pct, v_max_prim
  from (
    select sum(o.ownership_pct) as day_sum, sum(case when o.is_primary then 1 else 0 end) as prim_cnt
    from boundaries b join public.rental_property_ownerships o
      on o.property_id = new.property_id and o.effective_from <= b.dt and (o.effective_to is null or o.effective_to > b.dt)
    group by b.dt
  ) s;
  if v_max_pct > 100.00 then raise exception 'Ownership share exceeds 100%% (got %)', v_max_pct; end if;
  if v_max_prim > 1 then raise exception 'Property cannot have multiple active primary owners on the same date'; end if;
  return new;
end; $$;
create trigger trg_validate_ownership_shares after insert or update on public.rental_property_ownerships
  for each row execute function public.validate_ownership_shares_not_over_100();


-- Enforce allocation invariants (no over-allocation, no over-settlement, no cross-currency)
create or replace function public.enforce_rental_allocation_invariants()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tx record; v_charge record; v_tx_alloc numeric(14,2); v_charge_alloc numeric(14,2);
begin
  if new.event_type = 'REVERSAL' then return new; end if;
  select id, amount, currency_code, status into v_tx from public.rental_payment_transactions where id = new.transaction_id and org_id = new.org_id for update;
  select id, amount, currency_code, status into v_charge from public.rental_charges where id = new.charge_id and org_id = new.org_id for update;
  if v_tx.status in ('PENDING_STK', 'FAILED', 'REVERSED') then
    raise exception 'Cannot allocate from transaction in status %', v_tx.status;
  end if;
  if new.currency_code <> v_tx.currency_code or new.currency_code <> v_charge.currency_code then
    raise exception 'Cross-currency allocation blocked';
  end if;
  select coalesce(sum(signed_amount), 0) into v_tx_alloc from public.rental_payment_allocations where transaction_id = new.transaction_id;
  if v_tx_alloc + new.signed_amount > v_tx.amount then
    raise exception 'Over-allocation on transaction %', v_tx.id;
  end if;
  select coalesce(sum(signed_amount), 0) into v_charge_alloc from public.rental_payment_allocations where charge_id = new.charge_id;
  if v_charge_alloc + new.signed_amount > v_charge.amount then
    raise exception 'Over-settlement on charge %', v_charge.id;
  end if;
  return new;
end; $$;
drop trigger if exists trg_enforce_rental_allocation_invariants on public.rental_payment_allocations;
create trigger trg_enforce_rental_allocation_invariants before insert on public.rental_payment_allocations
  for each row execute function public.enforce_rental_allocation_invariants();

commit;