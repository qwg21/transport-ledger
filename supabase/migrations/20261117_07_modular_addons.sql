-- 1. Add modular enabled_modules array to subscriptions
alter table public.subscriptions
  add column if not exists enabled_modules text[] not null default '{}';

update public.subscriptions
set enabled_modules = array_append(enabled_modules, 'TRANSPORT')
where transport_addon = true
  and not ('TRANSPORT' = any(enabled_modules));

-- 2. Update has_transport_addon to check both transport_addon and enabled_modules
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
      and (s.transport_addon = true or 'TRANSPORT' = any(s.enabled_modules))
  );
$$;

-- 3. Update platform_list_tenants to include enabled_modules
drop function if exists public.platform_list_tenants();
create or replace function public.platform_list_tenants()
returns table (
  org_id uuid,
  name text,
  industry text,
  currency text,
  plan text,
  status text,
  transport_addon boolean,
  enabled_modules text[],
  current_period_end date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'quentinwg2015@gmail.com' then
    raise exception 'Platform admin access required';
  end if;

  return query
  select
    o.id as org_id,
    o.name,
    o.industry,
    o.currency,
    s.plan,
    s.status,
    s.transport_addon,
    coalesce(s.enabled_modules, '{}') as enabled_modules,
    s.current_period_end
  from public.organizations o
  left join public.subscriptions s on s.org_id = o.id
  order by o.created_at desc;
end;
$$;

-- 4. Admin RPC to toggle any specialist module per tenant
create or replace function public.platform_set_org_modules(
  p_org_id uuid,
  p_modules text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'quentinwg2015@gmail.com' then
    raise exception 'Platform admin access required';
  end if;

  update public.subscriptions
  set enabled_modules = coalesce(p_modules, '{}'),
      transport_addon = ('TRANSPORT' = any(coalesce(p_modules, '{}')))
  where org_id = p_org_id;
end;
$$;

notify pgrst, 'reload schema';