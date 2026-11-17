-- 1. Transport Add-on Entitlement Helper
create or replace function public.has_transport_addon(p_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.org_id = p_org_id
      and s.transport_addon = true
  );
$$;

-- 2. Vehicles (Fleet Registry)
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  registration_no text not null,
  make_model text not null,
  vehicle_type text not null default 'MPV',
  capacity integer,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'MAINTENANCE', 'INACTIVE')),
  current_odometer_km numeric(12, 1) not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, registration_no),
  unique (org_id, id)
);

alter table public.vehicles enable row level security;
drop policy if exists "vehicles_select_transport" on public.vehicles;
create policy "vehicles_select_transport"
  on public.vehicles for select to authenticated
  using (public.is_org_member(org_id) and public.has_transport_addon(org_id));

drop policy if exists "vehicles_write_transport" on public.vehicles;
create policy "vehicles_write_transport"
  on public.vehicles for all to authenticated
  using (public.is_org_member(org_id) and public.has_active_subscription(org_id) and public.has_transport_addon(org_id))
  with check (public.is_org_member(org_id) and public.has_active_subscription(org_id) and public.has_transport_addon(org_id));

-- 3. Drivers
create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null,
  phone text,
  license_no text,
  license_expiry date,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

alter table public.drivers enable row level security;
drop policy if exists "drivers_select_transport" on public.drivers;
create policy "drivers_select_transport"
  on public.drivers for select to authenticated
  using (public.is_org_member(org_id) and public.has_transport_addon(org_id));

drop policy if exists "drivers_write_transport" on public.drivers;
create policy "drivers_write_transport"
  on public.drivers for all to authenticated
  using (public.is_org_member(org_id) and public.has_active_subscription(org_id) and public.has_transport_addon(org_id))
  with check (public.is_org_member(org_id) and public.has_active_subscription(org_id) and public.has_transport_addon(org_id));

-- 4. Trips / Charters (with tenant-aware composite FKs)
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  trip_code text not null,
  trip_date date not null default current_date,
  vehicle_id uuid,
  driver_id uuid,
  customer_id uuid,
  client_name text not null,
  origin text not null,
  destination text not null,
  distance_km numeric(10, 1),
  agreed_fare numeric(12, 2) not null default 0 check (agreed_fare >= 0),
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  linked_invoice_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  unique (org_id, trip_code),
  unique (org_id, id),
  constraint trips_org_vehicle_fkey foreign key (org_id, vehicle_id)
    references public.vehicles(org_id, id) on delete set null (vehicle_id),
  constraint trips_org_driver_fkey foreign key (org_id, driver_id)
    references public.drivers(org_id, id) on delete set null (driver_id),
  constraint trips_org_customer_fkey foreign key (org_id, customer_id)
    references public.customers(org_id, id) on delete set null (customer_id),
  constraint trips_org_invoice_fkey foreign key (org_id, linked_invoice_id)
    references public.documents(org_id, id) on delete set null (linked_invoice_id)
);

alter table public.trips enable row level security;
drop policy if exists "trips_select_transport" on public.trips;
create policy "trips_select_transport"
  on public.trips for select to authenticated
  using (public.is_org_member(org_id) and public.has_transport_addon(org_id));

drop policy if exists "trips_write_transport" on public.trips;
create policy "trips_write_transport"
  on public.trips for all to authenticated
  using (public.is_org_member(org_id) and public.has_active_subscription(org_id) and public.has_transport_addon(org_id))
  with check (public.is_org_member(org_id) and public.has_active_subscription(org_id) and public.has_transport_addon(org_id));

-- 5. Vehicle & Trip Costs (Fuel, Maintenance, Tolls, Driver Allowances -> Auto-posts to Core GL)
create table if not exists public.vehicle_costs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  cost_date date not null default current_date,
  vehicle_id uuid,
  trip_id uuid,
  cost_type text not null check (cost_type in ('FUEL', 'MAINTENANCE', 'TOLL', 'DRIVER_ALLOWANCE', 'INSURANCE', 'OTHER')),
  amount_kes numeric(12, 2) not null check (amount_kes > 0),
  vendor text,
  notes text,
  created_at timestamptz not null default now(),
  constraint vehicle_costs_org_vehicle_fkey foreign key (org_id, vehicle_id)
    references public.vehicles(org_id, id) on delete set null (vehicle_id),
  constraint vehicle_costs_org_trip_fkey foreign key (org_id, trip_id)
    references public.trips(org_id, id) on delete set null (trip_id)
);

alter table public.vehicle_costs enable row level security;
drop policy if exists "vehicle_costs_select_transport" on public.vehicle_costs;
create policy "vehicle_costs_select_transport"
  on public.vehicle_costs for select to authenticated
  using (public.is_org_member(org_id) and public.has_transport_addon(org_id));

drop policy if exists "vehicle_costs_write_transport" on public.vehicle_costs;
create policy "vehicle_costs_write_transport"
  on public.vehicle_costs for all to authenticated
  using (public.is_org_member(org_id) and public.has_active_subscription(org_id) and public.has_transport_addon(org_id))
  with check (public.is_org_member(org_id) and public.has_active_subscription(org_id) and public.has_transport_addon(org_id));

-- 6. Controlled GL Posting Trigger for Transport Costs (No duplicate ledger engine)
create or replace function public.trg_post_vehicle_cost_journal()
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
    new.org_id,
    new.cost_date,
    'TRC-' || left(new.id::text, 8),
    'TRANSPORT_COST',
    new.id,
    'TR_COST:' || new.id::text,
    'Transport ' || new.cost_type || coalesce(' - ' || new.vendor, ''),
    v_exp_id,
    v_cash_id,
    new.amount_kes,
    null,
    null
  );
  return new;
end;
$$;

drop trigger if exists trg_vehicle_costs_post_journal on public.vehicle_costs;
create trigger trg_vehicle_costs_post_journal
  after insert on public.vehicle_costs
  for each row execute function public.trg_post_vehicle_cost_journal();

notify pgrst, 'reload schema';
