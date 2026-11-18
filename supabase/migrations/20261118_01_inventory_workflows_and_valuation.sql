-- 1. Allow SUPPLIER_RETURN on stock_movements
DO $$
DECLARE
  v_con text;
BEGIN
  FOR v_con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.stock_movements'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%movement_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.stock_movements DROP CONSTRAINT %I', v_con);
  END LOOP;
END;
$$;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN ('GRN_RECEIPT', 'SALE_ISSUE', 'ADJUSTMENT_GAIN', 'ADJUSTMENT_LOSS', 'RETURN_IN', 'SUPPLIER_RETURN'));

-- 2. Replace stock movement + GL posting trigger (adds SUPPLIER_RETURN, negative-stock guard, weighted-avg cost)
CREATE OR REPLACE FUNCTION public.trg_apply_stock_movement_and_gl()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_var public.product_variants%ROWTYPE;
  v_qty numeric(12, 2);
  v_cost numeric(12, 2);
  v_delta numeric(12, 2);
  v_new_cost numeric(12, 2);
  v_amount numeric(14, 2);
  v_inv_id uuid;
  v_grn_id uuid;
  v_cogs_id uuid;
  v_shrink_id uuid;
  v_gain_id uuid;
  v_debit_id uuid;
  v_credit_id uuid;
BEGIN
  SELECT * INTO v_var FROM public.product_variants WHERE id = new.variant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product variant not found.';
  END IF;

  v_qty := new.quantity;
  v_cost := coalesce(nullif(new.unit_cost, 0), v_var.cost_price, 0);

  IF new.movement_type IN ('GRN_RECEIPT', 'ADJUSTMENT_GAIN', 'RETURN_IN') THEN
    v_delta := v_qty;
  ELSE
    v_delta := -v_qty;
  END IF;

  IF v_var.stock_qty + v_delta < 0 THEN
    RAISE EXCEPTION 'Insufficient stock for SKU %: on hand %, requested %.', v_var.sku, v_var.stock_qty, v_qty;
  END IF;

  IF new.movement_type = 'GRN_RECEIPT' AND coalesce(new.unit_cost, 0) > 0 THEN
    v_new_cost := round(((v_var.stock_qty * v_var.cost_price) + (v_qty * new.unit_cost)) / nullif(v_var.stock_qty + v_qty, 0), 2);
    UPDATE public.product_variants
    SET stock_qty = stock_qty + v_delta,
        cost_price = coalesce(v_new_cost, cost_price)
    WHERE id = v_var.id;
  ELSE
    UPDATE public.product_variants
    SET stock_qty = stock_qty + v_delta
    WHERE id = v_var.id;
  END IF;

  v_amount := round(v_qty * v_cost, 2);
  IF v_amount > 0 THEN
    SELECT id INTO v_inv_id FROM public.chart_of_accounts WHERE org_id = new.org_id AND code = '1200';
    SELECT id INTO v_grn_id FROM public.chart_of_accounts WHERE org_id = new.org_id AND code = '2050';
    SELECT id INTO v_cogs_id FROM public.chart_of_accounts WHERE org_id = new.org_id AND code = '5000';
    SELECT id INTO v_shrink_id FROM public.chart_of_accounts WHERE org_id = new.org_id AND code = '5100';
    SELECT id INTO v_gain_id FROM public.chart_of_accounts WHERE org_id = new.org_id AND code = '5110';

    IF new.movement_type = 'GRN_RECEIPT' THEN
      v_debit_id := v_inv_id; v_credit_id := v_grn_id;
    ELSIF new.movement_type = 'SALE_ISSUE' THEN
      v_debit_id := v_cogs_id; v_credit_id := v_inv_id;
    ELSIF new.movement_type = 'ADJUSTMENT_GAIN' THEN
      v_debit_id := v_inv_id; v_credit_id := v_gain_id;
    ELSIF new.movement_type = 'ADJUSTMENT_LOSS' THEN
      v_debit_id := v_shrink_id; v_credit_id := v_inv_id;
    ELSIF new.movement_type = 'RETURN_IN' THEN
      v_debit_id := v_inv_id; v_credit_id := v_cogs_id;
    ELSIF new.movement_type = 'SUPPLIER_RETURN' THEN
      v_debit_id := v_grn_id; v_credit_id := v_inv_id;
    END IF;

    PERFORM public.post_two_line_journal(
      new.org_id,
      coalesce(new.created_at::date, CURRENT_DATE),
      'STK-' || left(new.id::text, 8),
      'STOCK_MOVEMENT',
      new.id,
      'STK:' || new.id::text,
      new.movement_type || ' · ' || v_var.sku || ' (Qty ' || v_qty || ')',
      v_debit_id,
      v_credit_id,
      v_amount,
      'INVENTORY',
      v_var.id
    );
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_movements_apply ON public.stock_movements;
CREATE TRIGGER trg_stock_movements_apply
  AFTER INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.trg_apply_stock_movement_and_gl();

NOTIFY pgrst, 'reload schema';