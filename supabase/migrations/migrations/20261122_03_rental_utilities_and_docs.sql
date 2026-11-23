-- ============================================================================
-- Biashara Ledger — Rental Management Part 3: Utilities (Water/Garbage) & Docs
-- Migration: 20261122_03_rental_utilities_and_docs.sql
-- ============================================================================

begin;

-- 0. Ensure legacy NOT NULL columns have safe defaults so inserts never fail
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='rental_charges' and column_name='charge_sequence') then
    alter table public.rental_charges alter column charge_sequence set default 1;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='rental_charges' and column_name='currency_code') then
    alter table public.rental_charges alter column currency_code set default 'KES';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='rental_charges' and column_name='exchange_rate_to_base') then
    alter table public.rental_charges alter column exchange_rate_to_base set default 1;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='rental_charges' and column_name='base_amount') then
    alter table public.rental_charges alter column base_amount set default 0;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='rental_collection_accounts' and column_name='account_type') then
    alter table public.rental_collection_accounts alter column account_type set default 'BANK';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='rental_collection_accounts' and column_name='account_identifier') then
    alter table public.rental_collection_accounts alter column account_identifier set default '';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='rental_collection_accounts' and column_name='currency_code') then
    alter table public.rental_collection_accounts alter column currency_code set default 'KES';
  end if;
end $$;

-- 1. Property Utility Defaults (constant garbage fee & per-unit water rate)
create table if not exists public.rental_property_utility_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.rental_properties(id) on delete cascade,
  water_rate_per_unit numeric(14,2) not null default 0 check (water_rate_per_unit >= 0),
  monthly_garbage_fee numeric(14,2) not null default 0 check (monthly_garbage_fee >= 0),
  currency text not null default 'KES',
  effective_from date not null default current_date,
  updated_at timestamptz not null default now(),
  unique (org_id, property_id)
);

alter table public.rental_property_utility_rates enable row level security;

drop policy if exists p_rental_util_rates_all on public.rental_property_utility_rates;
create policy p_rental_util_rates_all on public.rental_property_utility_rates
  for all
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

-- 2. Monthly Unit Water Meter Readings
create table if not exists public.rental_meter_readings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.rental_properties(id) on delete cascade,
  unit_id uuid not null references public.rental_units(id) on delete cascade,
  tenancy_id uuid null references public.rental_tenancies(id) on delete set null,
  billing_period text not null check (billing_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  previous_reading numeric(14,2) not null check (previous_reading >= 0),
  current_reading numeric(14,2) not null check (current_reading >= previous_reading),
  units_consumed numeric(14,2) generated always as (round(current_reading - previous_reading, 2)) stored,
  rate_per_unit numeric(14,2) not null check (rate_per_unit >= 0),
  water_amount numeric(14,2) generated always as (round((current_reading - previous_reading) * rate_per_unit, 2)) stored,
  reading_date date not null default current_date,
  notes text null,
  created_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (org_id, unit_id, billing_period)
);

alter table public.rental_meter_readings enable row level security;

drop policy if exists p_rental_meter_readings_all on public.rental_meter_readings;
create policy p_rental_meter_readings_all on public.rental_meter_readings
  for all
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

-- 3. Ensure rental_charges supports WATER, GARBAGE, and bill_number grouping
alter table public.rental_charges
  add column if not exists bill_number text null,
  add column if not exists meter_reading_id uuid null references public.rental_meter_readings(id) on delete set null,
  add column if not exists description text null;

create index if not exists idx_rental_charges_bill_number
  on public.rental_charges(org_id, bill_number)
  where bill_number is not null;

do $$
declare
  v_conname text;
begin
  select c.conname into v_conname
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'rental_charges'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%charge_type%';

  if v_conname is not null then
    execute format('alter table public.rental_charges drop constraint %I', v_conname);
  end if;

  alter table public.rental_charges
    add constraint rental_charges_charge_type_check
    check (charge_type in ('RENT', 'WATER', 'GARBAGE', 'DEPOSIT', 'LATE_FEE', 'MAINTENANCE', 'OTHER'));
end $$;

-- 4. Seed / Backfill Utility & Service Charge Revenue Accounts in Chart of Accounts
insert into public.chart_of_accounts (org_id, code, name, account_type, is_system)
select o.id, v.code, v.name, v.account_type, true
from public.organizations o
cross join (
  values
    ('4110', 'Water & Utility Recoveries', 'REVENUE'),
    ('4120', 'Garbage & Service Charge Income', 'REVENUE')
) as v(code, name, account_type)
on conflict (org_id, code) do nothing;

-- 5. RPC: Upsert Property Utility Rates (constant garbage + water unit rate)
create or replace function public.rpc_upsert_property_utility_rates(
  p_org_id uuid,
  p_property_id uuid,
  p_water_rate_per_unit numeric,
  p_monthly_garbage_fee numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'Access denied for organization %', p_org_id;
  end if;

  if coalesce(p_water_rate_per_unit, 0) < 0 or coalesce(p_monthly_garbage_fee, 0) < 0 then
    raise exception 'Utility rates cannot be negative';
  end if;

  insert into public.rental_property_utility_rates (
    org_id, property_id, water_rate_per_unit, monthly_garbage_fee, updated_at
  )
  values (
    p_org_id, p_property_id, round(p_water_rate_per_unit, 2), round(p_monthly_garbage_fee, 2), now()
  )
  on conflict (org_id, property_id) do update
    set water_rate_per_unit = excluded.water_rate_per_unit,
        monthly_garbage_fee = excluded.monthly_garbage_fee,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- 6. RPC: Generate Itemized Monthly Tenant Bill (Rent + Water Usage + Constant Garbage)
create or replace function public.rpc_generate_monthly_tenant_bill(
  p_org_id uuid,
  p_tenancy_id uuid,
  p_billing_period text,
  p_prev_water numeric default null,
  p_curr_water numeric default null,
  p_water_rate numeric default null,
  p_garbage_fee numeric default null,
  p_include_rent boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenancy record;
  v_unit record;
  v_prop record;
  v_rates record;
  v_last_reading numeric(14,2);
  v_prev numeric(14,2);
  v_curr numeric(14,2);
  v_rate numeric(14,2);
  v_garbage numeric(14,2);
  v_rent numeric(14,2) := 0;
  v_water numeric(14,2) := 0;
  v_units_used numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_due_date date;
  v_bill_no text;
  v_meter_id uuid;
  v_journal_id uuid;
  v_ar_acct uuid;
  v_rent_acct uuid;
  v_water_acct uuid;
  v_garbage_acct uuid;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'Access denied for organization %', p_org_id;
  end if;

  if p_billing_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Invalid billing period format (%). Expected YYYY-MM.', p_billing_period;
  end if;

  select * into v_tenancy
  from public.rental_tenancies
  where org_id = p_org_id and id = p_tenancy_id;

  if not found or v_tenancy.status <> 'ACTIVE' then
    raise exception 'Active tenancy not found';
  end if;

  select * into v_unit
  from public.rental_units
  where org_id = p_org_id and id = v_tenancy.unit_id;

  select * into v_prop
  from public.rental_properties
  where org_id = p_org_id and id = v_unit.property_id;

  select * into v_rates
  from public.rental_property_utility_rates
  where org_id = p_org_id and property_id = v_prop.id;

  v_due_date := (p_billing_period || '-01')::date + (coalesce(v_prop.default_due_day, 5) - 1);
  v_bill_no := 'BILL-' || replace(p_billing_period, '-', '') || '-' || upper(regexp_replace(v_unit.unit_code, '[^A-Za-z0-9]', '', 'g'));

  select current_reading into v_last_reading
  from public.rental_meter_readings
  where org_id = p_org_id
    and unit_id = v_unit.id
    and billing_period < p_billing_period
  order by billing_period desc
  limit 1;

  v_rate := round(coalesce(p_water_rate, v_rates.water_rate_per_unit, 0), 2);
  v_garbage := round(coalesce(p_garbage_fee, v_rates.monthly_garbage_fee, 0), 2);

  if p_include_rent then
    v_rent := round(coalesce(v_tenancy.monthly_rent, v_unit.monthly_rent_default, v_unit.monthly_rent, 0), 2);
  end if;

  if p_curr_water is not null then
    v_prev := round(coalesce(p_prev_water, v_last_reading, 0), 2);
    v_curr := round(p_curr_water, 2);

    if v_curr < v_prev then
      raise exception 'Current water reading (%) cannot be less than previous reading (%)', v_curr, v_prev;
    end if;

    v_units_used := round(v_curr - v_prev, 2);
    v_water := round(v_units_used * v_rate, 2);

    insert into public.rental_meter_readings (
      org_id, property_id, unit_id, tenancy_id, billing_period,
      previous_reading, current_reading, rate_per_unit, reading_date
    )
    values (
      p_org_id, v_prop.id, v_unit.id, v_tenancy.id, p_billing_period,
      v_prev, v_curr, v_rate, current_date
    )
    on conflict (org_id, unit_id, billing_period) do update
      set previous_reading = excluded.previous_reading,
          current_reading = excluded.current_reading,
          rate_per_unit = excluded.rate_per_unit,
          tenancy_id = excluded.tenancy_id,
          reading_date = current_date
    returning id into v_meter_id;
  end if;

  if v_rent > 0 and exists (
    select 1 from public.rental_charges
    where org_id = p_org_id and tenancy_id = v_tenancy.id
      and billing_period = p_billing_period and charge_type = 'RENT' and status <> 'VOID'
  ) then
    v_rent := 0;
  end if;

  if v_water > 0 and exists (
    select 1 from public.rental_charges
    where org_id = p_org_id and tenancy_id = v_tenancy.id
      and billing_period = p_billing_period and charge_type = 'WATER' and status <> 'VOID'
  ) then
    v_water := 0;
  end if;

  if v_garbage > 0 and exists (
    select 1 from public.rental_charges
    where org_id = p_org_id and tenancy_id = v_tenancy.id
      and billing_period = p_billing_period and charge_type = 'GARBAGE' and status <> 'VOID'
  ) then
    v_garbage := 0;
  end if;

  v_total := round(v_rent + v_water + v_garbage, 2);

  if v_total <= 0 then
    return jsonb_build_object(
      'bill_number', v_bill_no,
      'billing_period', p_billing_period,
      'total_billed', 0,
      'message', 'All applicable charges for this billing period were already generated.'
    );
  end if;

  select id into v_ar_acct from public.chart_of_accounts where org_id = p_org_id and code = '1120' limit 1;
  select id into v_rent_acct from public.chart_of_accounts where org_id = p_org_id and code = '4100' limit 1;
  select id into v_water_acct from public.chart_of_accounts where org_id = p_org_id and code = '4110' limit 1;
  select id into v_garbage_acct from public.chart_of_accounts where org_id = p_org_id and code = '4120' limit 1;

  insert into public.journal_entries (
    org_id, entry_date, reference, description, source_module, source_id, status
  )
  values (
    p_org_id, current_date, v_bill_no,
    format('Monthly Tenant Bill %s (%s - Unit %s)', v_bill_no, p_billing_period, v_unit.unit_code),
    'RENTALS', v_tenancy.id, 'POSTED'
  )
  returning id into v_journal_id;

  insert into public.journal_lines (org_id, journal_id, account_id, debit, credit, description)
  values (
    p_org_id, v_journal_id, v_ar_acct, v_total, 0,
    format('Tenant Receivable - %s (%s)', v_bill_no, v_tenancy.payment_reference)
  );

  if v_rent > 0 then
    insert into public.journal_lines (org_id, journal_id, account_id, debit, credit, description)
    values (p_org_id, v_journal_id, coalesce(v_rent_acct, v_ar_acct), 0, v_rent, format('Monthly Rent %s', p_billing_period));

    insert into public.rental_charges (
      org_id, tenancy_id, property_id, unit_id, charge_type, charge_sequence, billing_period,
      due_date, currency_code, amount, exchange_rate_to_base, base_amount, balance_due,
      status, bill_number, journal_entry_id, description
    )
    values (
      p_org_id, v_tenancy.id, v_prop.id, v_unit.id, 'RENT', 1, p_billing_period,
      v_due_date, 'KES', v_rent, 1, v_rent, v_rent,
      'DUE', v_bill_no, v_journal_id, format('Monthly Rent (%s)', p_billing_period)
    );
  end if;

  if v_water > 0 then
    insert into public.journal_lines (org_id, journal_id, account_id, debit, credit, description)
    values (p_org_id, v_journal_id, coalesce(v_water_acct, v_rent_acct), 0, v_water, format('Water Usage %s units @ %s', v_units_used, v_rate));

    insert into public.rental_charges (
      org_id, tenancy_id, property_id, unit_id, charge_type, charge_sequence, billing_period,
      due_date, currency_code, amount, exchange_rate_to_base, base_amount, balance_due,
      status, bill_number, meter_reading_id, journal_entry_id, description
    )
    values (
      p_org_id, v_tenancy.id, v_prop.id, v_unit.id, 'WATER', 2, p_billing_period,
      v_due_date, 'KES', v_water, 1, v_water, v_water,
      'DUE', v_bill_no, v_meter_id, v_journal_id,
      format('Water Usage (%s → %s = %s units @ %s)', v_prev, v_curr, v_units_used, v_rate)
    );
  end if;

  if v_garbage > 0 then
    insert into public.journal_lines (org_id, journal_id, account_id, debit, credit, description)
    values (p_org_id, v_journal_id, coalesce(v_garbage_acct, v_rent_acct), 0, v_garbage, format('Garbage Collection (%s)', p_billing_period));

    insert into public.rental_charges (
      org_id, tenancy_id, property_id, unit_id, charge_type, charge_sequence, billing_period,
      due_date, currency_code, amount, exchange_rate_to_base, base_amount, balance_due,
      status, bill_number, journal_entry_id, description
    )
    values (
      p_org_id, v_tenancy.id, v_prop.id, v_unit.id, 'GARBAGE', 3, p_billing_period,
      v_due_date, 'KES', v_garbage, 1, v_garbage, v_garbage,
      'DUE', v_bill_no, v_journal_id, format('Garbage Collection (%s)', p_billing_period)
    );
  end if;

  return jsonb_build_object(
    'bill_number', v_bill_no,
    'billing_period', p_billing_period,
    'due_date', v_due_date,
    'rent_amount', v_rent,
    'water_units', v_units_used,
    'water_amount', v_water,
    'garbage_amount', v_garbage,
    'total_billed', v_total,
    'journal_id', v_journal_id
  );
end;
$$;

grant execute on function public.rpc_upsert_property_utility_rates(uuid, uuid, numeric, numeric) to authenticated;
grant execute on function public.rpc_generate_monthly_tenant_bill(uuid, uuid, text, numeric, numeric, numeric, numeric, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;