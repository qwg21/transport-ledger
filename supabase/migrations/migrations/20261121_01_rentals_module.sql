-- House Rental / Property Management Module (Phase 1)

create table if not exists public.rental_properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  property_type text not null default 'APARTMENT' check (property_type in ('APARTMENT', 'ESTATE', 'COMMERCIAL', 'OTHER')),
  location text,
  billing_day integer not null default 5 check (billing_day between 1 and 28),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.rental_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.rental_properties(id) on delete cascade,
  unit_code text not null,
  unit_type text not null default '1BR',
  monthly_rent numeric(12,2) not null default 0,
  deposit_amount numeric(12,2) not null default 0,
  status text not null default 'VACANT' check (status in ('VACANT', 'OCCUPIED', 'MAINTENANCE')),
  created_at timestamptz not null default now(),
  unique (property_id, unit_code)
);

create table if not exists public.rental_leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.rental_properties(id) on delete cascade,
  unit_id uuid not null references public.rental_units(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  tenant_name text not null,
  tenant_phone text,
  start_date date not null,
  end_date date,
  monthly_rent numeric(12,2) not null default 0,
  service_charge numeric(12,2) not null default 0,
  deposit_held numeric(12,2) not null default 0,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ENDED')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_rental_properties_org on public.rental_properties(org_id);
create index if not exists idx_rental_units_org on public.rental_units(org_id, property_id);
create index if not exists idx_rental_leases_org on public.rental_leases(org_id, status);

alter table public.rental_properties enable row level security;
alter table public.rental_units enable row level security;
alter table public.rental_leases enable row level security;

-- Read policies (members can always view)
drop policy if exists "rental_properties_select_member" on public.rental_properties;
create policy "rental_properties_select_member"
  on public.rental_properties for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "rental_units_select_member" on public.rental_units;
create policy "rental_units_select_member"
  on public.rental_units for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "rental_leases_select_member" on public.rental_leases;
create policy "rental_leases_select_member"
  on public.rental_leases for select to authenticated
  using (public.is_org_member(org_id));

-- Write policies (active subscribers only)
drop policy if exists "rental_properties_write_active" on public.rental_properties;
create policy "rental_properties_write_active"
  on public.rental_properties for all to authenticated
  using (public.is_org_member(org_id) and public.has_active_subscription(org_id))
  with check (public.is_org_member(org_id) and public.has_active_subscription(org_id));

drop policy if exists "rental_units_write_active" on public.rental_units;
create policy "rental_units_write_active"
  on public.rental_units for all to authenticated
  using (public.is_org_member(org_id) and public.has_active_subscription(org_id))
  with check (public.is_org_member(org_id) and public.has_active_subscription(org_id));

drop policy if exists "rental_leases_write_active" on public.rental_leases;
create policy "rental_leases_write_active"
  on public.rental_leases for all to authenticated
  using (public.is_org_member(org_id) and public.has_active_subscription(org_id))
  with check (public.is_org_member(org_id) and public.has_active_subscription(org_id));