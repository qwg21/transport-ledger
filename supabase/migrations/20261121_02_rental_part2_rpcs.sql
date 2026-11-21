-- ============================================================================
-- BIASHARA LEDGER — RENTAL MANAGEMENT: SQL SPECIFICATION — PART 2 OF 2
-- Contents: Section 5 (9 transactional RPCs + tenant payment summary RPC)
-- Depends on all objects created in Part 1.
-- Status: Pre-Migration Review Artifact (DO NOT EXECUTE IN PRODUCTION YET)
-- Changes vs. original:
--   (A) rpc_record_and_allocate_rental_payment:
--       - unmatched path no longer reads unassigned record v_t
--       - duplicate provider callbacks return the existing transaction (idempotent)
--       - RAISE format fixed (100%% (got %))
--   (B) rpc_calculate_and_post_owner_remittance:
--       - removed FOR UPDATE from aggregate query (invalid in Postgres);
--         concurrency is still serialised by the owner-row lock above it
-- ============================================================================

begin;

-- (1) Activate Tenancy
create or replace function public.rpc_activate_tenancy(p_org_id uuid, p_tenancy_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_t record;
begin
  if not public.is_org_member(p_org_id) or not public.has_active_subscription(p_org_id) then raise exception 'Unauthorized or inactive subscription'; end if;
  select * into v_t from public.rental_tenancies where id = p_tenancy_id and org_id = p_org_id for update;
  if not found then raise exception 'Tenancy not found'; end if;
  if not public.is_property_authorized(p_org_id, v_t.property_id, 'TENANCY_MANAGE') then raise exception 'Not authorized'; end if;
  if v_t.status not in ('DRAFT', 'PENDING_APPROVAL') then raise exception 'Invalid status %', v_t.status; end if;
  update public.rental_tenancies set status = 'ACTIVE' where id = p_tenancy_id;
  update public.rental_units set status = 'OCCUPIED' where id = v_t.unit_id and org_id = p_org_id;
  insert into public.audit_logs (org_id, actor_user_id, action, entity_type, entity_id, details)
  values (p_org_id, auth.uid(), 'TENANCY_ACTIVATED', 'rental_tenancies', p_tenancy_id, jsonb_build_object('unit_id', v_t.unit_id));
end; $$;
revoke all on function public.rpc_activate_tenancy(uuid, uuid) from public;
grant execute on function public.rpc_activate_tenancy(uuid, uuid) to authenticated;

-- (2) Terminate Tenancy
create or replace function public.rpc_terminate_tenancy(p_org_id uuid, p_tenancy_id uuid, p_end_date date)
returns void language plpgsql security definer set search_path = public as $$
declare v_t record;
begin
  if not public.is_org_member(p_org_id) or not public.has_active_subscription(p_org_id) then raise exception 'Unauthorized or inactive subscription'; end if;
  select * into v_t from public.rental_tenancies where id = p_tenancy_id and org_id = p_org_id for update;
  if not found then raise exception 'Tenancy not found'; end if;
  if not public.is_property_authorized(p_org_id, v_t.property_id, 'TENANCY_MANAGE') then raise exception 'Not authorized'; end if;
  if p_end_date <= v_t.start_date then raise exception 'End date must be after start date'; end if;
  update public.rental_tenancies set status = 'TERMINATED', end_date = p_end_date where id = p_tenancy_id;
  if not exists (select 1 from public.rental_tenancies where unit_id = v_t.unit_id and status = 'ACTIVE') then
    update public.rental_units set status = 'VACANT' where id = v_t.unit_id and org_id = p_org_id;
  end if;
  insert into public.audit_logs (org_id, actor_user_id, action, entity_type, entity_id, details)
  values (p_org_id, auth.uid(), 'TENANCY_TERMINATED', 'rental_tenancies', p_tenancy_id, jsonb_build_object('end_date', p_end_date));
end; $$;
revoke all on function public.rpc_terminate_tenancy(uuid, uuid, date) from public;
grant execute on function public.rpc_terminate_tenancy(uuid, uuid, date) to authenticated;

-- (3) Generate Monthly Rent
create or replace function public.rpc_generate_monthly_rent(p_org_id uuid, p_billing_period char(7), p_run_key text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_job_id uuid; v_t record; v_term record; v_prop record; v_charge_id uuid;
  v_due_date date; v_ar_id uuid; v_rev_id uuid; v_def_id uuid; v_je_id uuid; v_count integer := 0;
begin
  if p_billing_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid billing period %', p_billing_period; end if;
  if not public.is_org_admin_or_finance(p_org_id) or not public.has_active_subscription(p_org_id) then raise exception 'Unauthorized or inactive subscription'; end if;
  insert into public.background_job_runs (org_id, job_type, run_key, status, attempts, worker_id)
  values (p_org_id, 'MONTHLY_RENT_GEN', p_run_key, 'RUNNING', 1, 'rpc')
  on conflict (org_id, job_type, run_key) where org_id is not null do nothing
  returning id into v_job_id;
  if v_job_id is null then return 0; end if;

  v_ar_id := public.get_coa_id(p_org_id, '1100');
  v_rev_id := public.get_coa_id(p_org_id, '4050');
  v_def_id := public.get_coa_id(p_org_id, '2240');

  for v_t in select * from public.rental_tenancies where org_id = p_org_id and status = 'ACTIVE' order by id loop
    select * into v_prop from public.rental_properties where id = v_t.property_id;
    select * into v_term from public.rental_tenancy_terms
    where tenancy_id = v_t.id and effective_from <= (p_billing_period || '-01')::date
      and (effective_to is null or effective_to > (p_billing_period || '-01')::date)
    order by effective_from desc limit 1;
    if not found or v_term.monthly_rent <= 0 then continue; end if;
    v_due_date := (p_billing_period || '-' || lpad(coalesce(v_t.due_day_override, v_prop.default_due_day)::text, 2, '0'))::date;

    insert into public.rental_charges (org_id, property_id, tenancy_id, billing_period, charge_type, charge_sequence, due_date, currency_code, amount, exchange_rate_to_base, base_amount, status)
    values (p_org_id, v_t.property_id, v_t.id, p_billing_period, 'RENT', 1, v_due_date, v_t.currency_code, v_term.monthly_rent, 1.0, v_term.monthly_rent, 'DUE')
    on conflict (tenancy_id, billing_period, charge_type, charge_sequence) do nothing returning id into v_charge_id;

    if v_charge_id is not null then
      v_je_id := public.post_two_line_journal(
        p_org_id, v_due_date, 'RNT-' || p_billing_period || '-' || left(v_charge_id::text, 6),
        'RENTAL_CHARGE', v_charge_id, 'RENTAL_CHARGE:' || v_charge_id::text, 'Monthly Rent ' || p_billing_period,
        v_ar_id, case when v_prop.operating_model = 'AGENCY_MANAGED' then v_def_id else v_rev_id end,
        v_term.monthly_rent, 'CUSTOMER', v_t.customer_id
      );
      update public.rental_charges set journal_entry_id = v_je_id where id = v_charge_id;
      v_count := v_count + 1;
    end if;
  end loop;

  update public.background_job_runs set status = 'SUCCEEDED', finished_at = now() where id = v_job_id;
  return v_count;
end; $$;
revoke all on function public.rpc_generate_monthly_rent(uuid, char, text) from public;
grant execute on function public.rpc_generate_monthly_rent(uuid, char, text) to authenticated;

-- (4) Record & Allocate Rental Payment (with Ownership 100% Gate + Agency Management Fee Engine)
create or replace function public.rpc_record_and_allocate_rental_payment(
  p_org_id uuid, p_collection_account_id uuid, p_provider text, p_provider_tx_id text,
  p_amount numeric(14,2), p_paid_at timestamptz, p_tenancy_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tx_id uuid; v_alloc_id uuid; v_t record; v_prop record; v_acct record; v_charge record; v_mandate record;
  v_remaining numeric(14,2) := p_amount; v_already_alloc numeric(14,2); v_apply numeric(14,2);
  v_cash_id uuid; v_ar_id uuid; v_susp_id uuid; v_cred_id uuid; v_def_id uuid; v_own_liab_id uuid; v_fee_rev_id uuid;
  v_je_id uuid; v_own record; v_total_pct numeric(7,2); v_ent_share numeric(14,2); v_fee numeric(14,2); v_fee_share numeric(14,2);
  v_property_id uuid := null;   -- FIX: null-safe holders (v_t is unassigned on the unmatched path)
  v_customer_id uuid := null;
begin
  if p_amount <= 0 then raise exception 'Payment amount must be positive'; end if;
  if not public.is_org_member(p_org_id) or not public.has_active_subscription(p_org_id) then raise exception 'Unauthorized or inactive subscription'; end if;

  select * into v_acct from public.rental_collection_accounts where id = p_collection_account_id and org_id = p_org_id and is_active = true;
  if not found then raise exception 'Active collection account not found'; end if;
  if v_acct.provider <> p_provider then raise exception 'Provider mismatch with collection account'; end if;

  if p_tenancy_id is null then
    if not public.is_org_admin_or_finance(p_org_id) then raise exception 'Not authorized to post unmatched suspense'; end if;
  else
    select * into v_t from public.rental_tenancies where id = p_tenancy_id and org_id = p_org_id for update;
    if not found then raise exception 'Tenancy not found'; end if;
    if not public.is_property_authorized(p_org_id, v_t.property_id, 'RENT_COLLECT') then raise exception 'Not authorized for property'; end if;
    if v_acct.currency_code <> v_t.currency_code then raise exception 'Currency mismatch'; end if;
    select * into v_prop from public.rental_properties where id = v_t.property_id;
    if v_prop.operating_model = 'DIRECT_LANDLORD' and v_acct.account_scope <> 'LANDLORD_DIRECT' then raise exception 'Collection account scope incompatible with DIRECT_LANDLORD'; end if;
    if v_prop.operating_model = 'AGENCY_MANAGED' and v_acct.account_scope <> 'AGENCY_CLIENT' then raise exception 'Collection account scope incompatible with AGENCY_MANAGED'; end if;
    v_property_id := v_t.property_id;
    v_customer_id := v_t.customer_id;
  end if;

  -- FIX: idempotent insert; duplicate provider callbacks return the existing transaction
  insert into public.rental_payment_transactions (org_id, collection_account_id, property_id, customer_id, tenancy_id, provider, provider_tx_id, currency_code, amount, exchange_rate_to_base, base_amount, paid_at, status)
  values (p_org_id, p_collection_account_id, v_property_id, v_customer_id, p_tenancy_id, p_provider, p_provider_tx_id, v_acct.currency_code, p_amount, 1.0, p_amount, p_paid_at, case when p_tenancy_id is null then 'UNMATCHED' else 'RECEIVED' end)
  on conflict (org_id, collection_account_id, provider_tx_id) do nothing
  returning id into v_tx_id;

  if v_tx_id is null then
    declare v_existing record;
    begin
      select * into v_existing from public.rental_payment_transactions
      where org_id = p_org_id and collection_account_id = p_collection_account_id and provider_tx_id = p_provider_tx_id;
      if v_existing.amount <> p_amount or v_existing.currency_code <> v_acct.currency_code
         or coalesce(v_existing.tenancy_id, '00000000-0000-0000-0000-000000000000'::uuid) <> coalesce(p_tenancy_id, '00000000-0000-0000-0000-000000000000'::uuid) then
        insert into public.audit_logs (org_id, actor_user_id, action, entity_type, entity_id, details)
        values (p_org_id, auth.uid(), 'PAYMENT_DUPLICATE_CONFLICT', 'rental_payment_transactions', v_existing.id, jsonb_build_object('provider_tx_id', p_provider_tx_id, 'existing_amount', v_existing.amount, 'incoming_amount', p_amount));
        raise exception 'Conflicting duplicate provider_tx_id %', p_provider_tx_id;
      end if;
      return v_existing.id;
    end;
  end if;

  v_cash_id := public.resolve_cash_account_id(p_org_id, v_acct.account_type);
  v_ar_id := public.get_coa_id(p_org_id, '1100');
  v_susp_id := public.get_coa_id(p_org_id, '2230');
  v_cred_id := public.get_coa_id(p_org_id, '2215');
  v_def_id := public.get_coa_id(p_org_id, '2240');
  v_own_liab_id := public.get_coa_id(p_org_id, '2220');
  v_fee_rev_id := public.get_coa_id(p_org_id, '4060');

  if p_tenancy_id is null then
    v_je_id := public.post_two_line_journal(p_org_id, p_paid_at::date, 'SUSP-' || left(v_tx_id::text, 6), 'RENTAL_TX', v_tx_id, 'RENTAL_TX_SUSP:' || v_tx_id::text, 'Unmatched Receipt ' || p_provider_tx_id, v_cash_id, v_susp_id, p_amount, null, null);
    insert into public.rental_credit_suspense_ledger (org_id, bucket_type, transaction_id, currency_code, signed_amount, reason, journal_entry_id) values (p_org_id, 'UNALLOCATED_SUSPENSE', v_tx_id, v_acct.currency_code, p_amount, 'Unmatched ' || p_provider_tx_id, v_je_id);
    insert into public.rental_journal_links (org_id, transaction_id, link_role, journal_entry_id) values (p_org_id, v_tx_id, 'SUSPENSE_OR_CREDIT', v_je_id);
    update public.rental_payment_transactions set journal_entry_id = v_je_id where id = v_tx_id;
    return v_tx_id;
  end if;

  for v_charge in select * from public.rental_charges where tenancy_id = p_tenancy_id and org_id = p_org_id and status in ('DUE','PARTIAL','OVERDUE') order by due_date asc, id asc for update loop
    exit when v_remaining <= 0;
    select coalesce(sum(signed_amount), 0) into v_already_alloc from public.rental_payment_allocations where charge_id = v_charge.id;
    v_apply := least(v_remaining, v_charge.amount - v_already_alloc);
    if v_apply <= 0 then continue; end if;

    v_je_id := public.post_two_line_journal(p_org_id, p_paid_at::date, 'RCP-' || left(v_tx_id::text, 6), 'RENTAL_ALLOC', v_charge.id, 'RENTAL_ALLOC:' || v_tx_id::text || ':' || v_charge.id::text, 'Rent Payment ' || p_provider_tx_id, v_cash_id, v_ar_id, v_apply, 'CUSTOMER', v_t.customer_id);
    insert into public.rental_payment_allocations (org_id, transaction_id, charge_id, event_type, currency_code, signed_amount, journal_entry_id, created_by)
    values (p_org_id, v_tx_id, v_charge.id, 'ALLOCATION', v_acct.currency_code, v_apply, v_je_id, auth.uid()) returning id into v_alloc_id;
    insert into public.rental_journal_links (org_id, transaction_id, link_role, journal_entry_id) values (p_org_id, v_tx_id, 'RECEIPT', v_je_id);
    update public.rental_charges set status = case when (v_already_alloc + v_apply) >= amount then 'PAID' else 'PARTIAL' end where id = v_charge.id;

    if v_prop.operating_model = 'AGENCY_MANAGED' then
      select coalesce(sum(ownership_pct), 0) into v_total_pct from public.rental_property_ownerships where property_id = v_prop.id and effective_from <= p_paid_at::date and (effective_to is null or effective_to > p_paid_at::date);
      if v_total_pct <> 100.00 then raise exception 'Property ownership shares must total 100%% (got %)', v_total_pct; end if;

      v_je_id := public.post_two_line_journal(p_org_id, p_paid_at::date, 'OWN-' || left(v_alloc_id::text, 6), 'OWNER_ENTITLEMENT', v_alloc_id, 'OWNER_ENT:' || v_alloc_id::text, 'Owner Entitlement', v_def_id, v_own_liab_id, v_apply, null, null);
      insert into public.rental_journal_links (org_id, transaction_id, link_role, journal_entry_id) values (p_org_id, v_tx_id, 'OWNER_ENTITLEMENT', v_je_id);
      for v_own in select owner_id, ownership_pct from public.rental_property_ownerships where property_id = v_prop.id and effective_from <= p_paid_at::date and (effective_to is null or effective_to > p_paid_at::date) loop
        v_ent_share := round(v_apply * (v_own.ownership_pct / 100.0), 2);
        if v_ent_share > 0 then
          insert into public.rental_owner_ledger_entries (org_id, owner_id, property_id, transaction_id, entry_type, source_type, source_id, currency_code, signed_amount, journal_entry_id)
          values (p_org_id, v_own.owner_id, v_prop.id, v_tx_id, 'RENT_ENTITLEMENT', 'RENTAL_ALLOC_LINE', v_alloc_id, v_acct.currency_code, v_ent_share, v_je_id);
        end if;
      end loop;

      -- Agency Management Fee Engine
      select * into v_mandate from public.rental_management_mandates where property_id = v_prop.id and status = 'ACTIVE' and effective_from <= p_paid_at::date and (effective_to is null or effective_to > p_paid_at::date) limit 1;
      if found and v_mandate.fee_type = 'PERCENTAGE' and v_mandate.fee_value > 0 and (v_mandate.fee_base = 'GROSS_COLLECTED' or v_charge.charge_type = 'RENT') then
        v_fee := round(v_apply * (v_mandate.fee_value / 100.0), 2);
        if v_fee > 0 then
          v_je_id := public.post_two_line_journal(p_org_id, p_paid_at::date, 'FEE-' || left(v_alloc_id::text, 6), 'MANAGEMENT_FEE', v_alloc_id, 'MGMT_FEE:' || v_alloc_id::text, 'Management Fee', v_own_liab_id, v_fee_rev_id, v_fee, null, null);
          insert into public.rental_journal_links (org_id, transaction_id, link_role, journal_entry_id) values (p_org_id, v_tx_id, 'MANAGEMENT_FEE', v_je_id);
          for v_own in select owner_id, ownership_pct from public.rental_property_ownerships where property_id = v_prop.id and effective_from <= p_paid_at::date and (effective_to is null or effective_to > p_paid_at::date) loop
            v_fee_share := round(v_fee * (v_own.ownership_pct / 100.0), 2);
            if v_fee_share > 0 then
              insert into public.rental_owner_ledger_entries (org_id, owner_id, property_id, transaction_id, entry_type, source_type, source_id, currency_code, signed_amount, journal_entry_id)
              values (p_org_id, v_own.owner_id, v_prop.id, v_tx_id, 'MANAGEMENT_FEE', 'RENTAL_ALLOC_LINE', v_alloc_id, v_acct.currency_code, -v_fee_share, v_je_id);
            end if;
          end loop;
        end if;
      end if;
    end if;
    v_remaining := v_remaining - v_apply;
  end loop;

  if v_remaining > 0 then
    v_je_id := public.post_two_line_journal(p_org_id, p_paid_at::date, 'CRD-' || left(v_tx_id::text, 6), 'TENANT_CREDIT', v_tx_id, 'TENANT_CRD:' || v_tx_id::text, 'Tenant Advance Credit', v_cash_id, v_cred_id, v_remaining, 'CUSTOMER', v_t.customer_id);
    insert into public.rental_credit_suspense_ledger (org_id, bucket_type, transaction_id, tenancy_id, currency_code, signed_amount, reason, journal_entry_id) values (p_org_id, 'TENANT_ADVANCE_CREDIT', v_tx_id, p_tenancy_id, v_acct.currency_code, v_remaining, 'Advance Credit', v_je_id);
    insert into public.rental_journal_links (org_id, transaction_id, link_role, journal_entry_id) values (p_org_id, v_tx_id, 'SUSPENSE_OR_CREDIT', v_je_id);
  end if;

  update public.rental_payment_transactions set status = 'MATCHED' where id = v_tx_id;
  return v_tx_id;
end; $$;
revoke all on function public.rpc_record_and_allocate_rental_payment(uuid, uuid, text, text, numeric, timestamptz, uuid) from public;
grant execute on function public.rpc_record_and_allocate_rental_payment(uuid, uuid, text, text, numeric, timestamptz, uuid) to authenticated;

-- (5) Reverse Rental Payment (Full Multi-Journal + Owner Subledger Reversal)
create or replace function public.rpc_reverse_rental_payment(p_org_id uuid, p_transaction_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tx record; v_link record; v_alloc record; v_rev_je_id uuid; v_first_rev_id uuid;
begin
  if not public.is_org_member(p_org_id) or not public.has_active_subscription(p_org_id) then raise exception 'Unauthorized or inactive subscription'; end if;
  select * into v_tx from public.rental_payment_transactions where id = p_transaction_id and org_id = p_org_id for update;
  if not found then raise exception 'Transaction not found'; end if;
  if v_tx.status = 'REVERSED' then raise exception 'Already reversed'; end if;
  if v_tx.property_id is not null and not public.is_property_authorized(p_org_id, v_tx.property_id, 'FINANCE_POST') then raise exception 'Not authorized'; end if;
  if v_tx.property_id is null and not public.is_org_admin_or_finance(p_org_id) then raise exception 'Not authorized'; end if;

  for v_link in select * from public.rental_journal_links where transaction_id = p_transaction_id and org_id = p_org_id order by id loop
    v_rev_je_id := public.reverse_journal_entry(v_link.journal_entry_id, p_reason);
    update public.rental_journal_links set reversal_journal_entry_id = v_rev_je_id where id = v_link.id;
    if v_first_rev_id is null then v_first_rev_id := v_rev_je_id; end if;
  end loop;

  for v_alloc in select * from public.rental_payment_allocations where transaction_id = p_transaction_id and event_type = 'ALLOCATION' loop
    insert into public.rental_payment_allocations (org_id, transaction_id, charge_id, event_type, reversed_allocation_id, currency_code, signed_amount, journal_entry_id, created_by)
    values (p_org_id, p_transaction_id, v_alloc.charge_id, 'REVERSAL', v_alloc.id, v_alloc.currency_code, -v_alloc.signed_amount, v_first_rev_id, auth.uid());
    update public.rental_charges set status = case when (select coalesce(sum(signed_amount), 0) from public.rental_payment_allocations where charge_id = v_alloc.charge_id) <= 0 then 'DUE' else 'PARTIAL' end where id = v_alloc.charge_id;
  end loop;

  insert into public.rental_credit_suspense_ledger (org_id, bucket_type, transaction_id, tenancy_id, currency_code, signed_amount, reason, journal_entry_id)
  select org_id, bucket_type, transaction_id, tenancy_id, currency_code, -signed_amount, 'Reversal: ' || p_reason, v_first_rev_id
  from public.rental_credit_suspense_ledger where transaction_id = p_transaction_id;

  insert into public.rental_owner_ledger_entries (org_id, owner_id, property_id, transaction_id, entry_type, source_type, source_id, currency_code, signed_amount, journal_entry_id)
  select org_id, owner_id, property_id, transaction_id, 'REVERSAL', 'TX_REVERSAL', id, currency_code, -signed_amount, v_first_rev_id
  from public.rental_owner_ledger_entries where transaction_id = p_transaction_id and org_id = p_org_id;

  insert into public.rental_payment_reversals (org_id, transaction_id, reason, reversed_by) values (p_org_id, p_transaction_id, p_reason, auth.uid());
  update public.rental_payment_transactions set status = 'REVERSED' where id = p_transaction_id;
  return v_first_rev_id;
end; $$;
revoke all on function public.rpc_reverse_rental_payment(uuid, uuid, text) from public;
grant execute on function public.rpc_reverse_rental_payment(uuid, uuid, text) to authenticated;

-- (6) Record Security Deposit
create or replace function public.rpc_record_security_deposit(p_org_id uuid, p_tenancy_id uuid, p_collection_account_id uuid, p_amount numeric(14,2), p_ref text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_t record; v_acct record; v_je_id uuid;
begin
  if p_amount <= 0 then raise exception 'Deposit must be positive'; end if;
  if not public.is_org_member(p_org_id) or not public.has_active_subscription(p_org_id) then raise exception 'Unauthorized'; end if;
  select * into v_t from public.rental_tenancies where id = p_tenancy_id and org_id = p_org_id for update;
  if not found or v_t.status not in ('DRAFT','PENDING_APPROVAL','ACTIVE','EXPIRING') then raise exception 'Invalid tenancy for deposit'; end if;
  if not public.is_property_authorized(p_org_id, v_t.property_id, 'RENT_COLLECT') then raise exception 'Not authorized'; end if;
  select * into v_acct from public.rental_collection_accounts where id = p_collection_account_id and org_id = p_org_id and is_active = true;
  if not found or v_acct.currency_code <> v_t.currency_code then raise exception 'Invalid or mismatched collection account'; end if;
  v_je_id := public.post_two_line_journal(p_org_id, current_date, 'DEP-' || left(p_tenancy_id::text, 6), 'RENTAL_DEPOSIT', p_tenancy_id, 'DEP_REC:' || p_tenancy_id::text || ':' || p_ref, 'Security Deposit ' || p_ref, public.resolve_cash_account_id(p_org_id, v_acct.account_type), public.get_coa_id(p_org_id, '2210'), p_amount, 'CUSTOMER', v_t.customer_id);
  insert into public.rental_deposit_ledger (org_id, tenancy_id, tx_type, currency_code, signed_amount, reason, journal_entry_id) values (p_org_id, p_tenancy_id, 'RECEIVED', v_t.currency_code, p_amount, 'Deposit ' || p_ref, v_je_id);
  return v_je_id;
end; $$;
revoke all on function public.rpc_record_security_deposit(uuid, uuid, uuid, numeric, text) from public;
grant execute on function public.rpc_record_security_deposit(uuid, uuid, uuid, numeric, text) to authenticated;

-- (7) Refund or Deduct Security Deposit
create or replace function public.rpc_refund_or_deduct_deposit(p_org_id uuid, p_tenancy_id uuid, p_tx_type text, p_amount numeric(14,2), p_reason text, p_deduction_target text default 'REPAIRS')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_t record; v_held numeric(14,2); v_je_id uuid;
begin
  if p_tx_type not in ('DEDUCTION','REFUND') or p_amount <= 0 then raise exception 'Invalid deposit operation'; end if;
  if not public.is_org_member(p_org_id) or not public.has_active_subscription(p_org_id) then raise exception 'Unauthorized'; end if;
  select * into v_t from public.rental_tenancies where id = p_tenancy_id and org_id = p_org_id for update;
  if not found then raise exception 'Tenancy not found'; end if;
  if not public.is_property_authorized(p_org_id, v_t.property_id, 'FINANCE_POST') then raise exception 'Not authorized'; end if;
  select coalesce(sum(signed_amount), 0) into v_held from public.rental_deposit_ledger where tenancy_id = p_tenancy_id;
  if p_amount > v_held then raise exception 'Insufficient deposit held (%)', v_held; end if;
  declare v_target_code text := case when p_tx_type = 'REFUND' then '1020' when p_deduction_target = 'ARREARS' then '1100' else '4070' end;
  begin
  v_je_id := public.post_two_line_journal(p_org_id, current_date, 'DEPOUT-' || left(p_tenancy_id::text, 6), 'RENTAL_DEPOSIT_OUT', p_tenancy_id, 'DEP_OUT:' || gen_random_uuid()::text, p_reason, public.get_coa_id(p_org_id, '2210'), public.get_coa_id(p_org_id, v_target_code), p_amount, 'CUSTOMER', v_t.customer_id);
  end;
  insert into public.rental_deposit_ledger (org_id, tenancy_id, tx_type, currency_code, signed_amount, reason, journal_entry_id) values (p_org_id, p_tenancy_id, p_tx_type, v_t.currency_code, -p_amount, p_reason, v_je_id);
  return v_je_id;
end; $$;
revoke all on function public.rpc_refund_or_deduct_deposit(uuid, uuid, text, numeric, text, text) from public;
grant execute on function public.rpc_refund_or_deduct_deposit(uuid, uuid, text, numeric, text, text) to authenticated;

-- (8) Server-Computed Owner Remittance (Ignores caller amounts)
create or replace function public.rpc_calculate_and_post_owner_remittance(p_org_id uuid, p_owner_id uuid, p_property_id uuid, p_start date, p_end date, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_gross numeric(14,2); v_fees numeric(14,2); v_exp numeric(14,2); v_avail numeric(14,2); v_je_id uuid; v_remit_id uuid;
begin
  if not public.is_org_member(p_org_id) or not public.has_active_subscription(p_org_id) then raise exception 'Unauthorized'; end if;
  if not public.is_property_authorized(p_org_id, p_property_id, 'FINANCE_POST') then raise exception 'Not authorized'; end if;
  -- Owner-row lock serialises concurrent remittances for the same owner
  perform 1 from public.rental_owners where id = p_owner_id and org_id = p_org_id for update;
  if not found then raise exception 'Owner not found'; end if;

  select id into v_remit_id from public.rental_owner_remittances where org_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then return v_remit_id; end if;

  -- FIX: removed "for update" (not allowed with aggregate functions)
  select
    coalesce(sum(case when entry_type = 'RENT_ENTITLEMENT' then signed_amount else 0 end), 0),
    coalesce(sum(case when entry_type = 'MANAGEMENT_FEE' then -signed_amount else 0 end), 0),
    coalesce(sum(case when entry_type = 'OWNER_EXPENSE' then -signed_amount else 0 end), 0),
    coalesce(sum(signed_amount), 0)
  into v_gross, v_fees, v_exp, v_avail
  from public.rental_owner_ledger_entries
  where org_id = p_org_id and owner_id = p_owner_id and property_id = p_property_id
    and remittance_id is null and created_at::date <= p_end;

  if v_avail <= 0 then raise exception 'No payable owner balance available (%)', v_avail; end if;

  v_remit_id := gen_random_uuid();
  v_je_id := public.post_two_line_journal(p_org_id, current_date, 'REM-' || left(v_remit_id::text, 6), 'OWNER_REMITTANCE', v_remit_id, 'REM:' || p_idempotency_key, 'Owner Remittance', public.get_coa_id(p_org_id, '2220'), public.get_coa_id(p_org_id, '1010'), v_avail, 'CUSTOMER', null);
  insert into public.rental_owner_remittances (id, org_id, owner_id, property_id, idempotency_key, period_start, period_end, currency_code, gross_collected, management_fee, expenses_deducted, net_paid, journal_entry_id)
  values (v_remit_id, p_org_id, p_owner_id, p_property_id, p_idempotency_key, p_start, p_end, 'KES', v_gross, v_fees, v_exp, v_avail, v_je_id);
  update public.rental_owner_ledger_entries set remittance_id = v_remit_id
  where org_id = p_org_id and owner_id = p_owner_id and property_id = p_property_id
    and remittance_id is null and created_at::date <= p_end;
  insert into public.rental_owner_ledger_entries (org_id, owner_id, property_id, remittance_id, entry_type, source_type, source_id, currency_code, signed_amount, journal_entry_id)
  values (p_org_id, p_owner_id, p_property_id, v_remit_id, 'REMITTANCE', 'OWNER_REMITTANCE', v_remit_id, 'KES', -v_avail, v_je_id);
  return v_remit_id;
end; $$;
revoke all on function public.rpc_calculate_and_post_owner_remittance(uuid, uuid, uuid, date, date, text) from public;
grant execute on function public.rpc_calculate_and_post_owner_remittance(uuid, uuid, uuid, date, date, text) to authenticated;

-- (9) Replay Failed Rental Job
create or replace function public.rpc_replay_rental_job(p_job_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_j record;
begin
  select * into v_j from public.background_job_runs where id = p_job_id for update;
  if not found or not public.is_org_admin_or_finance(v_j.org_id, array['owner','admin','accountant']) then raise exception 'Unauthorized'; end if;
  update public.background_job_runs set status = 'PENDING', next_retry_at = now(), last_error = null where id = p_job_id and status in ('FAILED', 'DEAD_LETTER');
end; $$;
revoke all on function public.rpc_replay_rental_job(uuid) from public;
grant execute on function public.rpc_replay_rental_job(uuid) to authenticated;

-- Tenant-safe payment summary RPC (hides raw_payload & collection_account_id)
create or replace function public.rpc_get_tenant_payments(p_org_id uuid, p_tenancy_id uuid)
returns table (id uuid, paid_at timestamptz, amount numeric, currency_code char(3), provider text, provider_tx_id text, status text)
language sql stable security definer set search_path = public as $$
  select t.id, t.paid_at, t.amount, t.currency_code, t.provider, t.provider_tx_id, t.status
  from public.rental_payment_transactions t
  where t.org_id = p_org_id and t.tenancy_id = p_tenancy_id
    and public.is_portal_tenant(p_org_id, p_tenancy_id)
  order by t.paid_at desc;
$$;
revoke all on function public.rpc_get_tenant_payments(uuid, uuid) from public;
grant execute on function public.rpc_get_tenant_payments(uuid, uuid) to authenticated;

commit; -- STAGING ONLY: commits rental schema/RPCs to your staging branchs