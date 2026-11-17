'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Product } from '@/lib/types';
import { PackageCheck, Truck, ArrowDownUp, Lock } from 'lucide-react';

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  kra_pin: string | null;
}

interface Variant {
  id: string;
  product_id: string;
  sku: string;
  variant_name: string;
  cost_price: number;
  selling_price: number;
  stock_qty: number;
  reorder_level: number;
}

interface StockMovement {
  id: string;
  variant_id: string;
  movement_type: 'GRN_RECEIPT' | 'SALE_ISSUE' | 'ADJUSTMENT_GAIN' | 'ADJUSTMENT_LOSS' | 'RETURN_IN';
  quantity: number;
  unit_cost: number;
  notes: string | null;
  created_at: string;
}

type Props = {
  orgId: string;
  currency: string;
  products: Product[];
  isGrowthPlus: boolean;
  isReadOnly: boolean;
};

export default function InventorySection({
  orgId,
  currency,
  products,
  isGrowthPlus,
  isReadOnly
}: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Supplier form
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supEmail, setSupEmail] = useState('');

  // Variant form
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [sku, setSku] = useState('');
  const [variantName, setVariantName] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');

  // Stock movement form
  const [moveVariantId, setMoveVariantId] = useState('');
  const [moveType, setMoveType] = useState<StockMovement['movement_type']>('GRN_RECEIPT');
  const [moveQty, setMoveQty] = useState('1');
  const [moveCost, setMoveCost] = useState('0');
  const [moveNotes, setMoveNotes] = useState('');

  const loadData = useCallback(async () => {
    const [supRes, varRes, movRes] = await Promise.all([
      supabase.from('suppliers').select('id, name, phone, email, kra_pin').eq('org_id', orgId).order('name'),
      supabase.from('product_variants').select('id, product_id, sku, variant_name, cost_price, selling_price, stock_qty, reorder_level').eq('org_id', orgId).order('sku'),
      supabase.from('stock_movements').select('id, variant_id, movement_type, quantity, unit_cost, notes, created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(25)
    ]);
    if (!supRes.error) setSuppliers((supRes.data as Supplier[] | null) ?? []);
    if (!varRes.error) setVariants((varRes.data as Variant[] | null) ?? []);
    if (!movRes.error) setMovements((movRes.data as StockMovement[] | null) ?? []);
  }, [orgId]);

  useEffect(() => {
    let active = true;
    async function init() {
      const [supRes, varRes, movRes] = await Promise.all([
        supabase.from('suppliers').select('id, name, phone, email, kra_pin').eq('org_id', orgId).order('name'),
        supabase.from('product_variants').select('id, product_id, sku, variant_name, cost_price, selling_price, stock_qty, reorder_level').eq('org_id', orgId).order('sku'),
        supabase.from('stock_movements').select('id, variant_id, movement_type, quantity, unit_cost, notes, created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(25)
      ]);
      if (!active) return;
      if (!supRes.error) setSuppliers((supRes.data as Supplier[] | null) ?? []);
      if (!varRes.error) setVariants((varRes.data as Variant[] | null) ?? []);
      if (!movRes.error) setMovements((movRes.data as StockMovement[] | null) ?? []);
    }
    init();
    return () => {
      active = false;
    };
  }, [orgId]);

  const canWrite = isGrowthPlus && !isReadOnly;

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const { error } = await supabase.from('suppliers').insert({
      org_id: orgId,
      name: supName.trim(),
      phone: supPhone.trim() || null,
      email: supEmail.trim() || null
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setSupName('');
    setSupPhone('');
    setSupEmail('');
    loadData();
  };

  const handleAddVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const targetProductId = productId || products[0]?.id;
    if (!targetProductId) {
      setErrorMsg('Add a product in Catalogue first before creating variants.');
      return;
    }
    const { error } = await supabase.from('product_variants').insert({
      org_id: orgId,
      product_id: targetProductId,
      sku: sku.trim().toUpperCase(),
      variant_name: variantName.trim(),
      cost_price: Number(costPrice || 0),
      selling_price: Number(sellingPrice || 0)
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setSku('');
    setVariantName('');
    setCostPrice('');
    setSellingPrice('');
    loadData();
  };

  const handleRecordMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const targetVar = moveVariantId || variants[0]?.id;
    if (!targetVar) return;
    const { error } = await supabase.from('stock_movements').insert({
      org_id: orgId,
      variant_id: targetVar,
      movement_type: moveType,
      quantity: Number(moveQty),
      unit_cost: Number(moveCost || 0),
      notes: moveNotes.trim() || null
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setMoveNotes('');
    loadData();
  };

  return (
    <div className="space-y-6">
      {!isGrowthPlus && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-800 flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          <span>
            <strong>GROWTH+ Feature:</strong> Suppliers, product variants/SKUs, and stock movements require the Growth plan or higher. Existing records remain readable.
          </span>
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700">{errorMsg}</div>
      )}

      {/* Variants & Stock On Hand */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <PackageCheck className="w-4 h-4 text-blue-600" /> Product Variants &amp; Stock ({variants.length})
        </h3>
        {canWrite && (
          <form onSubmit={handleAddVariant} className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
            <select
              value={productId || products[0]?.id || ''}
              onChange={e => setProductId(e.target.value)}
              className="border border-slate-300 rounded-xl p-2 text-xs bg-white"
            >
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input type="text" required placeholder="SKU (e.g. SHIRT-BLK-M)" value={sku} onChange={e => setSku(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs uppercase" />
            <input type="text" required placeholder="Variant (e.g. Black / M)" value={variantName} onChange={e => setVariantName(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
            <input type="number" step="0.01" min="0" placeholder="Cost" value={costPrice} onChange={e => setCostPrice(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
            <input type="number" step="0.01" min="0" placeholder="Sell Price" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
            <button type="submit" className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold">Add Variant</button>
          </form>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2 px-2">SKU</th>
                <th className="py-2 px-2">Variant</th>
                <th className="py-2 px-2">Cost ({currency})</th>
                <th className="py-2 px-2">Sell ({currency})</th>
                <th className="py-2 px-2">Stock Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {variants.map(v => (
                <tr key={v.id}>
                  <td className="py-2 px-2 font-mono font-semibold">{v.sku}</td>
                  <td className="py-2 px-2">{v.variant_name}</td>
                  <td className="py-2 px-2">{Number(v.cost_price).toLocaleString()}</td>
                  <td className="py-2 px-2">{Number(v.selling_price).toLocaleString()}</td>
                  <td className="py-2 px-2 font-bold">{Number(v.stock_qty)}</td>
                </tr>
              ))}
              {variants.length === 0 && (
                <tr><td colSpan={5} className="py-3 text-slate-400">No product variants yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Movements */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <ArrowDownUp className="w-4 h-4 text-emerald-600" /> Stock Movements (Auto-posts to GL)
        </h3>
        {canWrite && variants.length > 0 && (
          <form onSubmit={handleRecordMovement} className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
            <select value={moveVariantId || variants[0]?.id || ''} onChange={e => setMoveVariantId(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs bg-white">
              {variants.map(v => <option key={v.id} value={v.id}>{v.sku} ({v.variant_name})</option>)}
            </select>
            <select value={moveType} onChange={e => setMoveType(e.target.value as StockMovement['movement_type'])} className="border border-slate-300 rounded-xl p-2 text-xs bg-white">
              <option value="GRN_RECEIPT">GRN Receipt (+)</option>
              <option value="SALE_ISSUE">Sale Issue (-)</option>
              <option value="ADJUSTMENT_GAIN">Count Gain (+)</option>
              <option value="ADJUSTMENT_LOSS">Shrinkage / Write-off (-)</option>
              <option value="RETURN_IN">Customer Return (+)</option>
            </select>
            <input type="number" required step="0.01" min="0.01" placeholder="Qty" value={moveQty} onChange={e => setMoveQty(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
            <input type="number" required step="0.01" min="0" placeholder="Unit Cost" value={moveCost} onChange={e => setMoveCost(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
            <input type="text" placeholder="Notes / Ref" value={moveNotes} onChange={e => setMoveNotes(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
            <button type="submit" className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold">Post Movement</button>
          </form>
        )}
        <div className="divide-y divide-slate-100 text-xs">
          {movements.map(m => (
            <div key={m.id} className="py-2 flex items-center justify-between">
              <span><strong>{m.movement_type}</strong> &middot; Qty {m.quantity} @ {currency} {Number(m.unit_cost).toLocaleString()} {m.notes ? `(${m.notes})` : ''}</span>
              <span className="text-slate-400">{m.created_at.slice(0, 10)}</span>
            </div>
          ))}
          {movements.length === 0 && <p className="text-xs text-slate-400">No stock movements recorded yet.</p>}
        </div>
      </div>

      {/* Suppliers */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Truck className="w-4 h-4 text-indigo-600" /> Suppliers ({suppliers.length})
        </h3>
        {canWrite && (
          <form onSubmit={handleAddSupplier} className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
            <input type="text" required placeholder="Supplier Name" value={supName} onChange={e => setSupName(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
            <input type="text" placeholder="Phone" value={supPhone} onChange={e => setSupPhone(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
            <input type="email" placeholder="Email" value={supEmail} onChange={e => setSupEmail(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
            <button type="submit" className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold">Add Supplier</button>
          </form>
        )}
        <div className="divide-y divide-slate-100 text-xs">
          {suppliers.map(s => (
            <div key={s.id} className="py-2 flex items-center justify-between">
              <span className="font-semibold text-slate-800">{s.name}</span>
              <span className="text-slate-500">{s.phone || '-'} &middot; {s.email || '-'}</span>
            </div>
          ))}
          {suppliers.length === 0 && <p className="text-xs text-slate-400">No suppliers added yet.</p>}
        </div>
      </div>
    </div>
  );
}