-- 1. Add org-level capability overrides (Enabled state) without breaking existing subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS capability_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Central 3-state capability evaluator (Entitled -> Enabled -> Permitted)
CREATE OR REPLACE FUNCTION public.has_capability(p_org_id uuid, p_capability text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_role text;
  v_rank int;
  v_modules text[];
  v_entitled boolean := false;
  v_enabled boolean := false;
  v_override jsonb;
  v_is_non_stock_only boolean;
BEGIN
  IF NOT public.is_org_member(p_org_id) THEN
    RETURN false;
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE org_id = p_org_id;
  SELECT role INTO v_role
  FROM public.organization_members
  WHERE org_id = p_org_id AND user_id = auth.uid();

  v_rank := CASE upper(coalesce(v_sub.plan, 'STARTER'))
    WHEN 'STARTER' THEN 1
    WHEN 'ESSENTIAL' THEN 2
    WHEN 'GROWTH' THEN 3
    WHEN 'INTELLIGENCE' THEN 4
    WHEN 'ENTERPRISE' THEN 5
    ELSE 1
  END;

  v_modules := coalesce(v_sub.enabled_modules, ARRAY[]::text[]);
  IF coalesce(v_sub.transport_addon, false) AND NOT ('TRANSPORT' = ANY(v_modules)) THEN
    v_modules := array_append(v_modules, 'TRANSPORT');
  END IF;

  -- 1. Entitled check
  v_entitled := CASE p_capability
    WHEN 'core.customers' THEN true
    WHEN 'core.catalogue' THEN true
    WHEN 'core.sales_documents' THEN true
    WHEN 'core.expenses' THEN true
    WHEN 'core.basic_reports' THEN true
    WHEN 'core.attachments' THEN v_rank >= 2
    WHEN 'core.branding_templates' THEN v_rank >= 2
    WHEN 'core.gl_statements' THEN v_rank >= 2
    WHEN 'core.exports' THEN v_rank >= 2
    WHEN 'core.team_roles' THEN v_rank >= 3
    WHEN 'core.suppliers_ap' THEN v_rank >= 3
    WHEN 'inventory.stock_control' THEN v_rank >= 3
    WHEN 'intelligence.bi' THEN v_rank >= 4
    WHEN 'intelligence.targets' THEN v_rank >= 4
    WHEN 'intelligence.tax_profiles' THEN v_rank >= 4
    WHEN 'enterprise.multi_branch' THEN v_rank >= 5
    WHEN 'enterprise.approvals' THEN v_rank >= 5
    WHEN 'transport.enquiries_bookings' THEN 'TRANSPORT' = ANY(v_modules) AND v_rank >= 1
    WHEN 'transport.vehicles' THEN 'TRANSPORT' = ANY(v_modules) AND v_rank >= 1
    WHEN 'transport.drivers' THEN 'TRANSPORT' = ANY(v_modules) AND v_rank >= 1
    WHEN 'transport.trips' THEN 'TRANSPORT' = ANY(v_modules) AND v_rank >= 1
    WHEN 'transport.fuel_maintenance' THEN 'TRANSPORT' = ANY(v_modules) AND v_rank >= 1
    WHEN 'transport.trip_profitability' THEN 'TRANSPORT' = ANY(v_modules) AND v_rank >= 1
    WHEN 'warehouse.operations' THEN 'WAREHOUSE' = ANY(v_modules) AND v_rank >= 3
    WHEN 'procurement.advanced' THEN 'PROCUREMENT' = ANY(v_modules) AND v_rank >= 3
    WHEN 'manufacturing.operations' THEN 'MANUFACTURING' = ANY(v_modules) AND v_rank >= 3
    WHEN 'payroll.operations' THEN 'PAYROLL' = ANY(v_modules) AND v_rank >= 1
    WHEN 'crm.pipeline' THEN 'CRM' = ANY(v_modules) AND v_rank >= 1
    ELSE false
  END;

  IF NOT v_entitled THEN
    RETURN false;
  END IF;

  -- 2. Enabled check (suppress retail stock_control for non-stock specialist orgs unless overridden)
  v_enabled := true;
  v_is_non_stock_only :=
    ('TRANSPORT' = ANY(v_modules) OR 'PAYROLL' = ANY(v_modules) OR 'CRM' = ANY(v_modules))
    AND NOT ('WAREHOUSE' = ANY(v_modules))
    AND NOT ('MANUFACTURING' = ANY(v_modules));

  IF p_capability = 'inventory.stock_control' AND v_is_non_stock_only THEN
    v_enabled := false;
  END IF;

  v_override := coalesce(v_sub.capability_overrides, '{}'::jsonb) -> p_capability;
  IF v_override IS NOT NULL THEN
    IF v_override = 'true'::jsonb THEN v_enabled := true;
    ELSIF v_override = 'false'::jsonb THEN v_enabled := false;
    END IF;
  END IF;

  IF NOT v_enabled THEN
    RETURN false;
  END IF;

  -- 3. Permitted check (user role)
  IF lower(coalesce(v_role, 'member')) = 'driver' THEN
    RETURN p_capability IN ('transport.trips', 'transport.fuel_maintenance');
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.has_capability(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_capability(uuid, text) TO authenticated;

-- 3. Gate retail stock_control writes by capability (SELECT stays readable to preserve history)
DROP POLICY IF EXISTS product_variants_write ON public.product_variants;
CREATE POLICY product_variants_write ON public.product_variants
  FOR ALL TO authenticated
  USING (
    public.is_org_member(org_id)
    AND public.has_active_subscription(org_id)
    AND public.has_capability(org_id, 'inventory.stock_control')
  )
  WITH CHECK (
    public.is_org_member(org_id)
    AND public.has_active_subscription(org_id)
    AND public.has_capability(org_id, 'inventory.stock_control')
  );

DROP POLICY IF EXISTS stock_movements_insert ON public.stock_movements;
CREATE POLICY stock_movements_insert ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(org_id)
    AND public.has_active_subscription(org_id)
    AND public.has_capability(org_id, 'inventory.stock_control')
  );

NOTIFY pgrst, 'reload schema';