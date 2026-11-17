-- 1. Fix search_path on SECURITY DEFINER plan helpers
alter function public.has_growth_plus_plan(uuid) set search_path = public;
alter function public.has_intelligence_plus_plan(uuid) set search_path = public;

-- 2. Lock down service-only RPCs from anon/authenticated/PUBLIC
revoke all on function public.apply_paystack_subscription_payment(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_paystack_subscription_payment(text, text, jsonb) to service_role;

-- 3. Preserve audit_logs even if an organization is deleted
alter table public.audit_logs alter column org_id drop not null;
alter table public.audit_logs drop constraint if exists audit_logs_org_id_fkey;
alter table public.audit_logs
  add constraint audit_logs_org_id_fkey
  foreign key (org_id) references public.organizations(id) on delete set null;

-- 4. Add composite unique keys (org_id, id) for tenant-aware foreign keys
alter table public.customers drop constraint if exists customers_org_id_id_key;
alter table public.customers add constraint customers_org_id_id_key unique (org_id, id);

alter table public.products_services drop constraint if exists products_services_org_id_id_key;
alter table public.products_services add constraint products_services_org_id_id_key unique (org_id, id);

alter table public.documents drop constraint if exists documents_org_id_id_key;
alter table public.documents add constraint documents_org_id_id_key unique (org_id, id);

alter table public.payments drop constraint if exists payments_org_id_id_key;
alter table public.payments add constraint payments_org_id_id_key unique (org_id, id);

-- 5. Replace single-column FKs with tenant-aware composite FKs (org_id, ref_id)
alter table public.documents drop constraint if exists documents_customer_id_fkey;
alter table public.documents
  add constraint documents_org_customer_fkey
  foreign key (org_id, customer_id) references public.customers(org_id, id) on delete set null (customer_id);

alter table public.documents drop constraint if exists documents_parent_id_fkey;
alter table public.documents
  add constraint documents_org_parent_fkey
  foreign key (org_id, parent_id) references public.documents(org_id, id) on delete set null (parent_id);

alter table public.document_items drop constraint if exists document_items_document_id_fkey;
alter table public.document_items
  add constraint document_items_org_document_fkey
  foreign key (org_id, document_id) references public.documents(org_id, id) on delete cascade;

alter table public.document_items drop constraint if exists document_items_product_id_fkey;
alter table public.document_items
  add constraint document_items_org_product_fkey
  foreign key (org_id, product_id) references public.products_services(org_id, id) on delete set null (product_id);

alter table public.payments drop constraint if exists payments_customer_id_fkey;
alter table public.payments
  add constraint payments_org_customer_fkey
  foreign key (org_id, customer_id) references public.customers(org_id, id) on delete set null (customer_id);

alter table public.payment_allocations drop constraint if exists payment_allocations_payment_id_fkey;
alter table public.payment_allocations
  add constraint payment_allocations_org_payment_fkey
  foreign key (org_id, payment_id) references public.payments(org_id, id) on delete cascade;

alter table public.payment_allocations drop constraint if exists payment_allocations_document_id_fkey;
alter table public.payment_allocations
  add constraint payment_allocations_org_document_fkey
  foreign key (org_id, document_id) references public.documents(org_id, id) on delete cascade;

-- 6. Tighten organizations UPDATE & documents UPDATE policies
drop policy if exists "Members can update their organizations" on public.organizations;
create policy "Owners and admins can update active organizations"
  on public.organizations
  for update
  to authenticated
  using (
    public.is_org_member(id)
    and public.has_active_subscription(id)
    and exists (
      select 1 from public.organization_members m
      where m.org_id = organizations.id
        and m.user_id = auth.uid()
        and lower(m.role) in ('owner', 'admin')
    )
  )
  with check (
    public.is_org_member(id)
    and public.has_active_subscription(id)
  );

drop policy if exists "Active subscribers can update org documents" on public.documents;
create policy "Active subscribers can update org documents"
  on public.documents
  for update
  to authenticated
  using (public.is_org_member(org_id) and public.has_active_subscription(org_id))
  with check (public.is_org_member(org_id) and public.has_active_subscription(org_id));

notify pgrst, 'reload schema';
