import { supabase } from '@/lib/supabase';
import type { ProductVariant } from '@/lib/types';

export type StockCheckItem = {
  product_id?: string | null;
  quantity: number;
};

export interface StockShortfall {
  productId: string;
  productName: string;
  requested: number;
  available: number;
  shortfall: number;
  defaultVariantId: string;
  defaultCostPrice: number;
}

/**
 * Returns tracked PRODUCT items whose requested quantity exceeds available stock.
 * Returns an empty array if all items can be fulfilled from existing stock.
 */
export async function getStockShortfalls(
  orgId: string,
  items: StockCheckItem[]
): Promise<{ shortfalls: StockShortfall[]; error?: string }> {
  if (!items || items.length === 0) return { shortfalls: [] };

  const productIds = Array.from(
    new Set(items.map(i => i.product_id).filter((id): id is string => Boolean(id)))
  );
  if (productIds.length === 0) return { shortfalls: [] };

  const [{ data: products, error: prodErr }, { data: variants, error: varErr }] = await Promise.all([
    supabase
      .from('products_services')
      .select('id, name, item_type')
      .eq('org_id', orgId)
      .in('id', productIds),
    supabase
      .from('product_variants')
      .select('id, product_id, stock_qty, cost_price')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .in('product_id', productIds)
      .order('sku')
  ]);

  if (prodErr) return { shortfalls: [], error: prodErr.message };
  if (varErr) return { shortfalls: [], error: varErr.message };

  const prodMap = new Map((products || []).map(p => [p.id, p]));
  const varsByProd = new Map<
    string,
    Array<{ id: string; stock_qty: number; cost_price: number }>
  >();

  for (const v of variants || []) {
    const list = varsByProd.get(v.product_id) || [];
    list.push({
      id: v.id,
      stock_qty: Number(v.stock_qty || 0),
      cost_price: Number(v.cost_price || 0)
    });
    varsByProd.set(v.product_id, list);
  }

  const requestedByProduct = new Map<string, number>();
  for (const li of items) {
    if (!li.product_id) continue;
    const prod = prodMap.get(li.product_id);
    if (!prod || prod.item_type !== 'PRODUCT') continue;
    requestedByProduct.set(
      li.product_id,
      (requestedByProduct.get(li.product_id) || 0) + Number(li.quantity || 0)
    );
  }

  const shortfalls: StockShortfall[] = [];
  for (const [prodId, reqQty] of requestedByProduct.entries()) {
    const prodVars = varsByProd.get(prodId) || [];
    if (prodVars.length === 0) continue; // Untracked product
    const available = prodVars.reduce((s, v) => s + v.stock_qty, 0);
    if (reqQty > available) {
      shortfalls.push({
        productId: prodId,
        productName: prodMap.get(prodId)?.name || 'Product',
        requested: reqQty,
        available,
        shortfall: reqQty - available,
        defaultVariantId: prodVars[0].id,
        defaultCostPrice: prodVars[0].cost_price
      });
    }
  }

  return { shortfalls };
}

/**
 * Records GRN_RECEIPT movements for shortfall items (either exact shortfall
 * to match the order, or a larger restock quantity chosen by the user).
 */
export async function topUpStockShortfalls(
  orgId: string,
  topUps: Array<{
    variantId: string;
    addQty: number;
    unitCost: number;
    note?: string;
  }>
): Promise<{ ok: boolean; error?: string }> {
  const rows = topUps
    .filter(t => Number(t.addQty) > 0)
    .map(t => ({
      org_id: orgId,
      variant_id: t.variantId,
      movement_type: 'GRN_RECEIPT' as const,
      quantity: Number(t.addQty),
      unit_cost: Number(t.unitCost || 0),
      notes: t.note || 'Order top-up restock'
    }));

  if (rows.length === 0) return { ok: true };

  const { error } = await supabase.from('stock_movements').insert(rows);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Validates that all tracked PRODUCT line items have enough stock on hand.
 */
export async function checkStockForItems(
  orgId: string,
  items: StockCheckItem[]
): Promise<{ ok: boolean; error?: string }> {
  const { shortfalls, error } = await getStockShortfalls(orgId, items);
  if (error) return { ok: false, error };
  if (shortfalls.length > 0) {
    const first = shortfalls[0];
    return {
      ok: false,
      error: `Insufficient stock for "${first.productName}": needs ${first.requested}, only ${first.available} in stock.`
    };
  }
  return { ok: true };
}

/**
 * Checks whether all tracked PRODUCT line items on a document have enough stock,
 * then records SALE_ISSUE movements in stock_movements (deducting product_variants.stock_qty).
 */
export async function deductStockForDocument(
  orgId: string,
  documentId: string,
  docNumber: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: items, error: itemsErr } = await supabase
    .from('document_items')
    .select('product_id, description, quantity')
    .eq('org_id', orgId)
    .eq('document_id', documentId);

  if (itemsErr) return { ok: false, error: itemsErr.message };
  if (!items || items.length === 0) return { ok: true };

  const precheck = await checkStockForItems(orgId, items);
  if (!precheck.ok) return precheck;

  const productIds = Array.from(
    new Set(items.map(i => i.product_id).filter((id): id is string => Boolean(id)))
  );
  if (productIds.length === 0) return { ok: true };

  const [{ data: products }, { data: variants }] = await Promise.all([
    supabase
      .from('products_services')
      .select('id, name, item_type')
      .eq('org_id', orgId)
      .in('id', productIds),
    supabase
      .from('product_variants')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .in('product_id', productIds)
      .order('sku')
  ]);

  const prodMap = new Map((products || []).map(p => [p.id, p]));
  const varsByProd = new Map<string, ProductVariant[]>();
  for (const v of (variants as ProductVariant[] | null) || []) {
    const list = varsByProd.get(v.product_id) || [];
    list.push(v);
    varsByProd.set(v.product_id, list);
  }

  const requestedByProduct = new Map<string, number>();
  for (const li of items) {
    if (!li.product_id) continue;
    const prod = prodMap.get(li.product_id);
    if (!prod || prod.item_type !== 'PRODUCT') continue;
    requestedByProduct.set(
      li.product_id,
      (requestedByProduct.get(li.product_id) || 0) + Number(li.quantity || 0)
    );
  }

  const movements: Array<{
    org_id: string;
    variant_id: string;
    movement_type: 'SALE_ISSUE';
    quantity: number;
    unit_cost: number;
    source_type: string;
    source_id: string;
    notes: string;
  }> = [];

  for (const [prodId, reqQty] of requestedByProduct.entries()) {
    const prodVars = (varsByProd.get(prodId) || []).filter(v => Number(v.stock_qty || 0) > 0);
    let remaining = reqQty;
    for (const v of prodVars) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(v.stock_qty || 0));
      if (take > 0) {
        movements.push({
          org_id: orgId,
          variant_id: v.id,
          movement_type: 'SALE_ISSUE',
          quantity: take,
          unit_cost: Number(v.cost_price || 0),
          source_type: 'DOCUMENT',
          source_id: documentId,
          notes: `Sold via ${docNumber}`
        });
        remaining -= take;
      }
    }
  }

  if (movements.length > 0) {
    const { error: movErr } = await supabase.from('stock_movements').insert(movements);
    if (movErr) return { ok: false, error: movErr.message };
  }

  return { ok: true };
}

/**
 * Restores stock when an Invoice is voided by inserting matching RETURN_IN
 * movements for every SALE_ISSUE previously logged against that document.
 */
export async function restoreStockForVoidedDocument(
  orgId: string,
  documentId: string,
  docNumber: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: issued, error: fetchErr } = await supabase
    .from('stock_movements')
    .select('variant_id, quantity, unit_cost, movement_type')
    .eq('org_id', orgId)
    .eq('source_type', 'DOCUMENT')
    .eq('source_id', documentId);

  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (!issued || issued.length === 0) return { ok: true };

  // Also check if a RETURN_IN was already recorded under DOCUMENT_VOID
  const { data: existingReturns } = await supabase
    .from('stock_movements')
    .select('id')
    .eq('org_id', orgId)
    .eq('source_type', 'DOCUMENT_VOID')
    .eq('source_id', documentId)
    .eq('movement_type', 'RETURN_IN')
    .limit(1);

  if (existingReturns && existingReturns.length > 0) return { ok: true };

  const returnRows = issued
    .filter(m => m.movement_type === 'SALE_ISSUE' && Number(m.quantity) > 0)
    .map(m => ({
      org_id: orgId,
      variant_id: m.variant_id,
      movement_type: 'RETURN_IN' as const,
      quantity: Number(m.quantity),
      unit_cost: Number(m.unit_cost || 0),
      source_type: 'DOCUMENT_VOID',
      source_id: documentId,
      notes: `Voided ${docNumber} — stock restored`
    }));

  if (returnRows.length > 0) {
    const { error: insErr } = await supabase.from('stock_movements').insert(returnRows);
    if (insErr) return { ok: false, error: insErr.message };
  }

  return { ok: true };
}