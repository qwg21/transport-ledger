-- 1. Supplier Payments Table
CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  bill_id uuid NOT NULL REFERENCES public.supplier_bills(id) ON DELETE CASCADE,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'M-PESA',
  payment_ref text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_org_bill
  ON public.supplier_payments(org_id, bill_id);

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_payments_select ON public.supplier_payments;
CREATE POLICY supplier_payments_select ON public.supplier_payments
  FOR SELECT USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS supplier_payments_insert ON public.supplier_payments;
CREATE POLICY supplier_payments_insert ON public.supplier_payments
  FOR INSERT WITH CHECK (
    public.is_org_member(org_id)
    AND public.has_active_subscription(org_id)
    AND public.has_growth_plus_plan(org_id)
  );

-- 2. Supplier Bill GL Posting Trigger (GRN Clearing 2050 or Expense 6010 -> AP 2000)
CREATE OR REPLACE FUNCTION public.trg_post_supplier_bill_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap_id uuid;
  v_debit_id uuid;
  v_orig_entry_id uuid;
BEGIN
  IF tg_op = 'INSERT' AND new.status <> 'VOID' AND new.total_amount > 0 THEN
    SELECT id INTO v_ap_id FROM public.chart_of_accounts WHERE org_id = new.org_id AND code = '2000';
    IF new.clears_grn THEN
      SELECT id INTO v_debit_id FROM public.chart_of_accounts WHERE org_id = new.org_id AND code = '2050';
    ELSE
      SELECT id INTO v_debit_id FROM public.chart_of_accounts WHERE org_id = new.org_id AND code = '6010';
    END IF;

    PERFORM public.post_two_line_journal(
      new.org_id,
      new.bill_date,
      new.bill_number,
      'SUPPLIER_BILL',
      new.id,
      'SBILL:' || new.id::text,
      'Supplier Bill ' || new.bill_number,
      v_debit_id,
      v_ap_id,
      new.total_amount,
      'SUPPLIER',
      new.supplier_id
    );
  ELSIF tg_op = 'UPDATE' AND old.status <> 'VOID' AND new.status = 'VOID' THEN
    IF coalesce(old.amount_paid, 0) > 0 THEN
      RAISE EXCEPTION 'Cannot void supplier bill % with payments recorded.', new.bill_number;
    END IF;

    SELECT id INTO v_orig_entry_id
    FROM public.journal_entries
    WHERE org_id = new.org_id AND posting_key = 'SBILL:' || new.id::text AND status = 'POSTED';

    IF v_orig_entry_id IS not null THEN
      PERFORM public.reverse_journal_entry(v_orig_entry_id, 'Supplier bill ' || new.bill_number || ' voided');
    END IF;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_bills_post_journal ON public.supplier_bills;
CREATE TRIGGER trg_supplier_bills_post_journal
  AFTER INSERT OR UPDATE OF status ON public.supplier_bills
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_supplier_bill_journal();

-- 3. Atomic Supplier Bill Payment RPC (DR 2000 AP / CR Cash, Bank, or M-PESA)
CREATE OR REPLACE FUNCTION public.record_supplier_bill_payment(
  p_bill_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_ref text DEFAULT NULL,
  p_payment_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill public.supplier_bills%ROWTYPE;
  v_pay_id uuid;
  v_ap_id uuid;
  v_cash_id uuid;
  v_remaining numeric(12, 2);
  v_new_paid numeric(12, 2);
  v_new_status text;
BEGIN
  SELECT * INTO v_bill FROM public.supplier_bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier bill not found.';
  END IF;

  IF NOT public.is_org_member(v_bill.org_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization.';
  END IF;
  IF NOT public.has_active_subscription(v_bill.org_id) THEN
    RAISE EXCEPTION 'Subscription is inactive.';
  END IF;
  IF NOT public.has_growth_plus_plan(v_bill.org_id) THEN
    RAISE EXCEPTION 'Growth plan or higher required.';
  END IF;
  IF v_bill.status = 'VOID' THEN
    RAISE EXCEPTION 'Cannot pay a voided supplier bill.';
  END IF;

  v_remaining := v_bill.total_amount - coalesce(v_bill.amount_paid, 0);
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > v_remaining THEN
    RAISE EXCEPTION 'Payment amount must be between 0.01 and %.', v_remaining;
  END IF;

  INSERT INTO public.supplier_payments (
    org_id, supplier_id, bill_id, payment_date, amount, payment_method, payment_ref
  )
  VALUES (
    v_bill.org_id, v_bill.supplier_id, v_bill.id, coalesce(p_payment_date, CURRENT_DATE),
    p_amount, coalesce(nullif(trim(p_payment_method), ''), 'M-PESA'), nullif(trim(p_payment_ref), '')
  )
  RETURNING id INTO v_pay_id;

  v_new_paid := coalesce(v_bill.amount_paid, 0) + p_amount;
  v_new_status := CASE WHEN v_new_paid >= v_bill.total_amount THEN 'PAID' ELSE 'PARTIAL' END;

  UPDATE public.supplier_bills
  SET amount_paid = v_new_paid, status = v_new_status
  WHERE id = v_bill.id;

  SELECT id INTO v_ap_id FROM public.chart_of_accounts WHERE org_id = v_bill.org_id AND code = '2000';
  v_cash_id := public.resolve_cash_account_id(v_bill.org_id, p_payment_method);

  PERFORM public.post_two_line_journal(
    v_bill.org_id,
    coalesce(p_payment_date, CURRENT_DATE),
    'SPAY-' || left(v_pay_id::text, 8),
    'SUPPLIER_PAYMENT',
    v_pay_id,
    'SPAY:' || v_pay_id::text,
    'Supplier payment for ' || v_bill.bill_number || ' (' || coalesce(p_payment_method, 'M-PESA') || ')',
    v_ap_id,
    v_cash_id,
    p_amount,
    'SUPPLIER',
    v_bill.supplier_id
  );

  RETURN v_pay_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_supplier_bill_payment(uuid, numeric, text, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_supplier_bill_payment(uuid, numeric, text, text, date) TO authenticated;

NOTIFY pgrst, 'reload schema';