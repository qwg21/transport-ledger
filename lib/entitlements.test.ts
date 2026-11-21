import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCapability, resolveEntitlements } from './entitlements.ts';

const activePeriod = '2027-12-31';

test('Starter + Transport gets transport & trip profitability without retail inventory or BI', () => {
  const ent = resolveEntitlements(
    { plan: 'STARTER', status: 'ACTIVE', current_period_end: activePeriod, enabled_modules: ['TRANSPORT'] },
    'owner',
    '2026-11-19'
  );
  assert.equal(hasCapability(ent, 'transport.trip_profitability'), true);
  assert.equal(hasCapability(ent, 'core.customers'), true);
  assert.equal(hasCapability(ent, 'core.sales_documents'), true);
  assert.equal(hasCapability(ent, 'inventory.stock_control'), false);
  assert.equal(hasCapability(ent, 'intelligence.bi'), false);
});

test('Starter + Rentals gets rental capabilities without retail inventory', () => {
  const ent = resolveEntitlements(
    { plan: 'STARTER', status: 'ACTIVE', current_period_end: activePeriod, enabled_modules: ['RENTALS'] },
    'owner',
    '2026-11-19'
  );
  assert.equal(hasCapability(ent, 'rentals.properties'), true);
  assert.equal(hasCapability(ent, 'rentals.tenancies'), true);
  assert.equal(hasCapability(ent, 'rentals.billing'), true);
  assert.equal(hasCapability(ent, 'rentals.payments'), true);
  assert.equal(hasCapability(ent, 'rentals.owners_remittances'), true);
  assert.equal(hasCapability(ent, 'inventory.stock_control'), false);
});

test('Starter + RENTALS unlocks rental operations without inheriting retail SKU/stock screens', () => {
  const ent = resolveEntitlements(
    { plan: 'STARTER', status: 'ACTIVE', current_period_end: '2099-12-31', enabled_modules: ['RENTALS'] },
    'owner',
    '2026-11-22'
  );
  assert.equal(hasCapability(ent, 'rentals.properties'), true);
  assert.equal(hasCapability(ent, 'rentals.billing'), true);
  assert.equal(hasCapability(ent, 'inventory.stock_control'), false);
});

test('Intelligence + Transport gets BI & transport without inheriting retail SKU/stock screens', () => {
  const ent = resolveEntitlements(
    { plan: 'INTELLIGENCE', status: 'ACTIVE', current_period_end: activePeriod, enabled_modules: ['TRANSPORT'] },
    'owner',
    '2026-11-19'
  );
  assert.equal(hasCapability(ent, 'transport.trips'), true);
  assert.equal(hasCapability(ent, 'intelligence.bi'), true);
  assert.equal(hasCapability(ent, 'core.suppliers_ap'), true);
  assert.equal(hasCapability(ent, 'inventory.stock_control'), false);
});

test('Intelligence + Transport + explicit inventory override unlocks stock_control for hybrid business', () => {
  const ent = resolveEntitlements(
    {
      plan: 'INTELLIGENCE',
      status: 'ACTIVE',
      current_period_end: activePeriod,
      enabled_modules: ['TRANSPORT'],
      capability_overrides: { 'inventory.stock_control': true }
    },
    'owner',
    '2026-11-19'
  );
  assert.equal(hasCapability(ent, 'inventory.stock_control'), true);
});

test('Growth Retail (no specialist modules) gets full inventory, suppliers, and team roles', () => {
  const ent = resolveEntitlements(
    { plan: 'GROWTH', status: 'ACTIVE', current_period_end: activePeriod, enabled_modules: [] },
    'owner',
    '2026-11-19'
  );
  assert.equal(hasCapability(ent, 'inventory.stock_control'), true);
  assert.equal(hasCapability(ent, 'core.suppliers_ap'), true);
  assert.equal(hasCapability(ent, 'core.team_roles'), true);
  assert.equal(hasCapability(ent, 'transport.trips'), false);
});

test('Warehouse on Starter is not entitled because minimum core tier is Growth', () => {
  const ent = resolveEntitlements(
    { plan: 'STARTER', status: 'ACTIVE', current_period_end: activePeriod, enabled_modules: ['WAREHOUSE'] },
    'owner',
    '2026-11-19'
  );
  assert.equal(hasCapability(ent, 'warehouse.operations'), false);
});

test('Suspended subscription blocks writes while preserving read entitlements', () => {
  const ent = resolveEntitlements(
    { plan: 'GROWTH', status: 'SUSPENDED', current_period_end: activePeriod, enabled_modules: ['TRANSPORT'] },
    'owner',
    '2026-11-19'
  );
  assert.equal(ent.canWrite, false);
  assert.equal(hasCapability(ent, 'transport.trips'), true);
});