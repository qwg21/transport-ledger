import type { PlanTier, Subscription } from '@/lib/types';

export type ModuleId =
  | 'TRANSPORT'
  | 'RENTALS'
  | 'WAREHOUSE'
  | 'PROCUREMENT'
  | 'MANUFACTURING'
  | 'PAYROLL'
  | 'CRM';

export type CapabilityKey =
  | 'core.customers'
  | 'core.catalogue'
  | 'core.sales_documents'
  | 'core.expenses'
  | 'core.basic_reports'
  | 'core.attachments'
  | 'core.branding_templates'
  | 'core.gl_statements'
  | 'core.exports'
  | 'core.team_roles'
  | 'core.suppliers_ap'
  | 'inventory.stock_control'
  | 'intelligence.bi'
  | 'intelligence.targets'
  | 'intelligence.tax_profiles'
  | 'enterprise.multi_branch'
  | 'enterprise.approvals'
  | 'transport.enquiries_bookings'
  | 'transport.vehicles'
  | 'transport.drivers'
  | 'transport.trips'
  | 'transport.fuel_maintenance'
  | 'transport.trip_profitability'
  | 'rentals.properties'
  | 'rentals.tenancies'
  | 'rentals.billing'
  | 'rentals.payments'
  | 'rentals.owners_remittances'
  | 'warehouse.operations'
  | 'procurement.advanced'
  | 'manufacturing.operations'
  | 'payroll.operations'
  | 'crm.pipeline';

export interface ResolvedEntitlements {
  plan: PlanTier;
  modules: Set<ModuleId>;
  entitled: Set<CapabilityKey>;
  enabled: Set<CapabilityKey>;
  permitted: Set<CapabilityKey>;
  isActive: boolean;
  canWrite: boolean;
}

const TIER_RANK: Record<PlanTier, number> = {
  STARTER: 1,
  ESSENTIAL: 2,
  GROWTH: 3,
  INTELLIGENCE: 4,
  ENTERPRISE: 5
};

export const MODULE_MIN_CORE: Record<ModuleId, PlanTier> = {
  TRANSPORT: 'STARTER',
  RENTALS: 'STARTER',
  PAYROLL: 'STARTER',
  CRM: 'STARTER',
  WAREHOUSE: 'GROWTH',
  PROCUREMENT: 'GROWTH',
  MANUFACTURING: 'GROWTH'
};

export function normalizePlan(plan?: string | null): PlanTier {
  const upper = (plan || 'STARTER').toUpperCase();
  if (upper in TIER_RANK) return upper as PlanTier;
  return 'STARTER';
}

export function resolveEntitlements(
  sub: (Subscription & { capability_overrides?: Record<string, boolean> | null }) | null,
  role = 'owner',
  todayIso?: string
): ResolvedEntitlements {
  const plan = normalizePlan(sub?.plan);
  const rank = TIER_RANK[plan];

  const modules = new Set<ModuleId>();
  for (const raw of sub?.enabled_modules ?? []) {
    const m = raw.toUpperCase() as ModuleId;
    if (m in MODULE_MIN_CORE) modules.add(m);
  }
  if (sub?.transport_addon) modules.add('TRANSPORT');

  const entitled = new Set<CapabilityKey>([
    'core.customers',
    'core.catalogue',
    'core.sales_documents',
    'core.expenses',
    'core.basic_reports'
  ]);

  if (rank >= TIER_RANK.ESSENTIAL) {
    entitled.add('core.attachments');
    entitled.add('core.branding_templates');
    entitled.add('core.gl_statements');
    entitled.add('core.exports');
  }

  if (rank >= TIER_RANK.GROWTH) {
    entitled.add('core.team_roles');
    entitled.add('core.suppliers_ap');
    entitled.add('inventory.stock_control');
  }

  if (rank >= TIER_RANK.INTELLIGENCE) {
    entitled.add('intelligence.bi');
    entitled.add('intelligence.targets');
    entitled.add('intelligence.tax_profiles');
  }

  if (rank >= TIER_RANK.ENTERPRISE) {
    entitled.add('enterprise.multi_branch');
    entitled.add('enterprise.approvals');
  }

  // Specialist module entitlements (respecting minimum compatible core tier)
  if (modules.has('TRANSPORT') && rank >= TIER_RANK[MODULE_MIN_CORE.TRANSPORT]) {
    entitled.add('transport.enquiries_bookings');
    entitled.add('transport.vehicles');
    entitled.add('transport.drivers');
    entitled.add('transport.trips');
    entitled.add('transport.fuel_maintenance');
    entitled.add('transport.trip_profitability');
  }
  if (modules.has('RENTALS') && rank >= TIER_RANK[MODULE_MIN_CORE.RENTALS]) {
    entitled.add('rentals.properties');
    entitled.add('rentals.tenancies');
    entitled.add('rentals.billing');
    entitled.add('rentals.payments');
    entitled.add('rentals.owners_remittances');
  }
  if (modules.has('WAREHOUSE') && rank >= TIER_RANK[MODULE_MIN_CORE.WAREHOUSE]) {
    entitled.add('warehouse.operations');
  }
  if (modules.has('PROCUREMENT') && rank >= TIER_RANK[MODULE_MIN_CORE.PROCUREMENT]) {
    entitled.add('procurement.advanced');
  }
  if (modules.has('MANUFACTURING') && rank >= TIER_RANK[MODULE_MIN_CORE.MANUFACTURING]) {
    entitled.add('manufacturing.operations');
  }
  if (modules.has('PAYROLL') && rank >= TIER_RANK[MODULE_MIN_CORE.PAYROLL]) {
    entitled.add('payroll.operations');
  }
  if (modules.has('CRM') && rank >= TIER_RANK[MODULE_MIN_CORE.CRM]) {
    entitled.add('crm.pipeline');
  }

  // Enabled state: decouple non-stock specialist orgs from inheriting retail SKU/stock screens
  const enabled = new Set<CapabilityKey>(entitled);
  const isNonStockSpecialistOnly =
    (modules.has('TRANSPORT') || modules.has('RENTALS') || modules.has('PAYROLL') || modules.has('CRM')) &&
    !modules.has('WAREHOUSE') &&
    !modules.has('MANUFACTURING');

  if (isNonStockSpecialistOnly) {
    enabled.delete('inventory.stock_control');
  }

  // Apply explicit org capability overrides (only if entitled)
  const overrides = sub?.capability_overrides ?? {};
  for (const [key, val] of Object.entries(overrides)) {
    const cap = key as CapabilityKey;
    if (val === true && entitled.has(cap)) enabled.add(cap);
    if (val === false) enabled.delete(cap);
  }

  // Permitted state (user role within the org)
  const permitted = new Set<CapabilityKey>(enabled);
  const lowerRole = (role || 'member').toLowerCase();
  if (lowerRole === 'driver') {
    for (const cap of Array.from(permitted)) {
      if (!cap.startsWith('transport.trips') && !cap.startsWith('transport.fuel_maintenance')) {
        permitted.delete(cap);
      }
    }
  }

  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  const isActive = Boolean(
    !sub ||
      (sub.status !== 'SUSPENDED' &&
        sub.status !== 'CANCELLED' &&
        sub.current_period_end >= today)
  );

  return {
    plan,
    modules,
    entitled,
    enabled,
    permitted,
    isActive,
    canWrite: isActive
  };
}

export function hasCapability(entitlements: ResolvedEntitlements, key: CapabilityKey): boolean {
  return entitlements.entitled.has(key) && entitlements.enabled.has(key) && entitlements.permitted.has(key);
}