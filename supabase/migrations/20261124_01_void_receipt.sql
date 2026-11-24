create or replace function public.void_receipt(
  p_receipt_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt record;
  v_invoice record;
  v_member_role text;
  v_paid numeric(14,2);
  v_alloc record;
  v_pay record;
  v_orig_entry uuid;
  v_rev_entry uuid;
  v_movement record;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void a receipt.';
  end if;

  select r.*, m.role into v_receipt
  from public.documents r
  left join public.organization_members m
    on m.org_id = r.org_id and m.user_id = auth.uid()
  where r.id = p_receipt_id
  for update;

  if not found then
    raise exception 'Receipt not found.';
  end if;
  if v_receipt.doc_type <> 'RECEIPT' then
    raise exception 'Only receipts can be voided.';
  end if;
  if v_receipt.status = 'VOID' then
    raise exception 'This receipt has already been voided.';
  end if;

  select role into v_member_role
  from public.organization_members
  where org_id = v_receipt.org_id and user_id = auth.uid();
  if lower(coalesce(v_member_role, '')) not in ('owner', 'accountant') then
    raise exception 'Only owners or accountants can void receipts.';
  end if;
  if not public.has_active_subscription(v_receipt.org_id) then
    raise exception 'Subscription is inactive.';
  end if;

  update public.documents
  set status = 'VOID'
  where id = v_receipt.id
    and org_id = v_receipt.org_id
    and doc_type = 'RECEIPT'
    and status <> 'VOID';

  if v_receipt.parent_id is not null then
    select * into v_invoice
    from public.documents
    where id = v_receipt.parent_id
      and org_id = v_receipt.org_id
      and doc_type = 'INVOICE'
    for update;

    if found then
      select coalesce(sum(amount), 0) into v_paid
      from public.documents
      where parent_id = v_invoice.id
        and org_id = v_invoice.org_id
        and doc_type = 'RECEIPT'
        and status <> 'VOID';

      update public.documents
      set amount_paid = least(v_invoice.amount, v_paid),
          status = case
            when v_paid <= 0 then 'UNPAID'
            when v_paid >= v_invoice.amount then 'PAID'
            else 'PARTIAL'
          end
      where id = v_invoice.id;
    end if;
  end if;

  for v_pay in
    select p.*
    from public.payments p
    where p.org_id = v_receipt.org_id
      and p.amount = v_receipt.amount
      and (
        (coalesce(trim(p.payment_ref), '') <> '' and p.payment_ref = coalesce(v_receipt.payment_ref, ''))
        or p.payment_date = v_receipt.issue_date
      )
  loop
    for v_alloc in
      select pa.*
      from public.payment_allocations pa
      where pa.org_id = v_receipt.org_id
        and pa.payment_id = v_pay.id
        and pa.document_id = v_receipt.parent_id
    loop
      select id into v_orig_entry
      from public.journal_entries
      where org_id = v_receipt.org_id
        and posting_key = 'ALLOC:' || v_alloc.id::text
        and status = 'POSTED';
      if v_orig_entry is not null then
        v_rev_entry := public.reverse_journal_entry(
          v_orig_entry,
          'Receipt ' || v_receipt.doc_number || ' voided: ' || p_reason
        );
      end if;
    end loop;
  end loop;

  if v_receipt.parent_id is not null then
    if not exists (
      select 1
      from public.stock_movements
      where org_id = v_receipt.org_id
        and source_type = 'DOCUMENT_VOID'
        and source_id = v_receipt.id
        and movement_type = 'RETURN_IN'
    ) then
      for v_movement in
        select variant_id, quantity, unit_cost
        from public.stock_movements
        where org_id = v_receipt.org_id
          and source_type = 'DOCUMENT'
          and source_id = v_receipt.parent_id
          and movement_type = 'SALE_ISSUE'
      loop
        insert into public.stock_movements (
          org_id, variant_id, movement_type, quantity, unit_cost,
          source_type, source_id, notes
        )
        values (
          v_receipt.org_id, v_movement.variant_id, 'RETURN_IN',
          v_movement.quantity, v_movement.unit_cost,
          'DOCUMENT_VOID', v_receipt.id,
          'Voided ' || v_receipt.doc_number || ' — stock restored: ' || p_reason
        );
      end loop;
    end if;
  end if;

  insert into public.audit_logs (
    org_id, actor_user_id, action, entity_type, entity_id, details
  )
  values (
    v_receipt.org_id,
    auth.uid(),
    'RECEIPT_VOIDED',
    'documents',
    v_receipt.id,
    jsonb_build_object(
      'receipt_id', v_receipt.id,
      'receipt_number', v_receipt.doc_number,
      'invoice_id', v_receipt.parent_id,
      'reason', p_reason,
      'amount', v_receipt.amount
    )
  );

  return v_receipt.id;
end;
$$;

revoke all on function public.void_receipt(uuid, text) from public;
grant execute on function public.void_receipt(uuid, text) to authenticated;
