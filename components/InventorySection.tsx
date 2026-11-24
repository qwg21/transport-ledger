'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { explainDbError, todayLocal } from '@/lib/documents';
import type { Product, ProductVariant, StockMovement, Supplier, SupplierBill } from '@/lib/types';
import { PackageCheck, Truck, ArrowUpDown, AlertTriangle, ReceiptText, CreditCard, PackagePlus } from 'lucide-react';

type InventoryTab = 'VARIANTS' | 'MOVEMENTS' | 'BILLS' | 'SUPPLIERS';

type Props = {
  orgId: string;
  currency: string;
  products: Product[];
  isGrowthPlus: boolean;
  isReadOnly: boolean;
  canManageSuppliersAp?: boolean;
  canManageStockControl?: boolean;
};

export default function InventorySection({
  orgId,
  currency,
  products,
  isGrowthPlus,
  isReadOnly,
  canManageSuppliersAp = isGrowthPlus,
  canManageStockControl = isGrowthPlus
}: Props) {
  const [tab, setTab] = useState<InventoryTab>(canManageStockControl ? 'VARIANTS' : 'BILLS');
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [bills, setBills] = useState<SupplierBill[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // New variant form
  const [productId, setProductId] = useState('');
  const [sku, setSku] = useState('');
  const [variantName, setVariantName] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [reorderLevel, setReorderLevel] = useState('5');

  // Stock movement form
  const [moveVariantId, setMoveVariantId] = useState('');
  const [moveType, setMoveType] = useState<StockMovement['movement_type']>('GRN_RECEIPT');
  const [moveQty, setMoveQty] = useState('1');
  const [moveCost, setMoveCost] = useState('');
  const [moveNotes, setMoveNotes] = useState('');

  // Quick restock modal state
  const [restockVariant, setRestockVariant] = useState<ProductVariant | null>(null);
  const [restockQty, setRestockQty] = useState('10');
  const [restockCost, setRestockCost] = useState('');
  const [isRestocking, setIsRestocking] = useState(false);

  // Supplier form
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [supPin, setSupPin] = useState('');

  // Supplier bill form
  const [billSupplierId, setBillSupplierId] = useState('');
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(todayLocal);
  const [billDueDate, setBillDueDate] = useState('');
  const [billNetAmount, setBillNetAmount] = useState('');
  const [billVatAmount, setBillVatAmount] = useState('0');
  const [billClearsGrn, setBillClearsGrn] = useState(true);

  // Bill payment modal state
  const [payTarget, setPayTarget] = useState<SupplierBill | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('M-PESA');
  const [payRef, setPayRef] = useState('');
  const [payDate, setPayDate] = useState(todayLocal);
  const [isPaying, setIsPaying] = useState(false);

  const loadData = useCallback(async () => {
    const [varRes, movRes, supRes, billRes] = await Promise.all([
      supabase.from('product_variants').select('*').eq('org_id', orgId).order('sku'),
      supabase
        .from('stock_movements')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('suppliers').select('*').eq('org_id', orgId).order('name'),
      supabase
        .from('supplier_bills')
        .select('*')
        .eq('org_id', orgId)
        .order('bill_date', { ascending: false })
        .limit(50)
    ]);
    if (!varRes.error) setVariants((varRes.data as ProductVariant[] | null) ?? []);
    if (!movRes.error) setMovements((movRes.data as StockMovement[] | null) ?? []);
    if (!supRes.error) setSuppliers((supRes.data as Supplier[] | null) ?? []);
    if (!billRes.error) setBills((billRes.data as SupplierBill[] | null) ?? []);
  }, [orgId]);

  useEffect(() => {
    let active = true;
    async function init() {
      const [varRes, movRes, supRes, billRes] = await Promise.all([
        supabase.from('product_variants').select('*').eq('org_id', orgId).order('sku'),
        supabase
          .from('stock_movements')
          .select('*')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('suppliers').select('*').eq('org_id', orgId).order('name'),
        supabase
          .from('supplier_bills')
          .select('*')
          .eq('org_id', orgId)
          .order('bill_date', { ascending: false })
          .limit(50)
      ]);
      if (!active) return;
      if (!varRes.error) setVariants((varRes.data as ProductVariant[] | null) ?? []);
      if (!movRes.error) setMovements((movRes.data as StockMovement[] | null) ?? []);
      if (!supRes.error) setSuppliers((supRes.data as Supplier[] | null) ?? []);
      if (!billRes.error) setBills((billRes.data as SupplierBill[] | null) ?? []);
    }
    init();
    return () => {
      active = false;
    };
  }, [orgId]);

  const supplierMap = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers]);

  const handleAddVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!productId || !sku.trim() || !variantName.trim()) return;
    const { error } = await supabase.from('product_variants').insert({
      org_id: orgId,
      product_id: productId,
      sku: sku.trim().toUpperCase(),
      variant_name: variantName.trim(),
      cost_price: Number(costPrice || 0),
      selling_price: Number(sellingPrice || 0),
      reorder_level: Number(reorderLevel || 5)
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
    if (!moveVariantId) return;
    const { error } = await supabase.from('stock_movements').insert({
      org_id: orgId,
      variant_id: moveVariantId,
      movement_type: moveType,
      quantity: Number(moveQty),
      unit_cost: Number(moveCost || 0),
      notes: moveNotes.trim() || null
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setMoveQty('1');
    setMoveNotes('');
    loadData();
  };

  const handleQuickRestock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockVariant || isRestocking) return;
    setErrorMsg(null);
    setIsRestocking(true);
    try {
      const { error } = await supabase.from('stock_movements').insert({
        org_id: orgId,
        variant_id: restockVariant.id,
        movement_type: 'GRN_RECEIPT',
        quantity: Number(restockQty),
        unit_cost: Number(restockCost || restockVariant.cost_price || 0),
        notes: 'Quick restock from Inventory'
      });
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      setRestockVariant(null);
      loadData();
    } finally {
      setIsRestocking(false);
    }
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!supName.trim()) return;
    const { error } = await supabase.from('suppliers').insert({
      org_id: orgId,
      name: supName.trim(),
      phone: supPhone.trim() || null,
      email: supEmail.trim() || null,
      kra_pin: supPin.trim() || null
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setSupName('');
    setSupPhone('');
    setSupEmail('');
    setSupPin('');
    loadData();
  };

  const handleAddBill = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const net = Number(billNetAmount || 0);
    const vat = Number(billVatAmount || 0);
    const total = net + vat;
    if (!billSupplierId || !billNumber.trim() || total <= 0) {
      setErrorMsg('Select a supplier, enter a bill number, and enter an amount greater than 0.');
      return;
    }

    const { error } = await supabase.from('supplier_bills').insert({
      org_id: orgId,
      supplier_id: billSupplierId,
      bill_number: billNumber.trim().toUpperCase(),
      bill_date: billDate || todayLocal(),
      due_date: billDueDate || null,
      net_amount: net,
      vat_amount: vat,
      total_amount: total,
      amount_paid: 0,
      clears_grn: billClearsGrn,
      status: 'UNPAID'
    });

    if (error) {
      setErrorMsg(explainDbError(error));
      return;
    }

    setBillNumber('');
    setBillDueDate('');
    setBillNetAmount('');
    setBillVatAmount('0');
    loadData();
  };

  const handleVoidBill = async (bill: SupplierBill) => {
    if (!window.confirm(`Void supplier bill ${bill.bill_number}?`)) return;
    setErrorMsg(null);
    const { error } = await supabase
      .from('supplier_bills')
      .update({ status: 'VOID' })
      .eq('id', bill.id)
      .eq('status', 'UNPAID');
    if (error) setErrorMsg(error.message);
    else loadData();
  };

  const handlePayBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget || isPaying) return;
    setErrorMsg(null);
    const amt = Number(payAmount);
    const remaining = Number(payTarget.total_amount) - Number(payTarget.amount_paid || 0);
    if (isNaN(amt) || amt <= 0 || amt > remaining) {
      setErrorMsg(`Enter a payment amount between 1 and ${remaining.toLocaleString()}.`);
      return;
    }

    setIsPaying(true);
    try {
      const { error } = await supabase.rpc('record_supplier_bill_payment', {
        p_bill_id: payTarget.id,
        p_amount: amt,
        p_payment_method: payMethod,
        p_payment_ref: payRef.trim() || null,
        p_payment_date: payDate || todayLocal()
      });
      if (error) {
        setErrorMsg(explainDbError(error));
        return;
      }
      setPayTarget(null);
      setPayRef('');
      loadData();
    } finally {
      setIsPaying(false);
    }
  };

  const lowStockCount = variants.filter(v => Number(v.stock_qty) <= Number(v.reorder_level)).length;
  const totalStockValue = variants.reduce((s, v) => s + Number(v.stock_qty) * Number(v.cost_price), 0);
  const totalPayables = bills
    .filter(b => b.status !== 'VOID')
    .reduce((s, b) => s + Math.max(0, Number(b.total_amount) - Number(b.amount_paid || 0)), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {canManageStockControl && (
          <>
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <p className="text-xs text-slate-500">Tracked SKUs</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{variants.length}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <p className="text-xs text-slate-500">Stock Valuation</p>
              <p className="text-lg font-bold text-blue-600 mt-1">{currency} {totalStockValue.toLocaleString()}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <p className="text-xs text-slate-500">Low / Out-of-Stock</p>
              <p className={`text-2xl font-bold mt-1 ${lowStockCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {lowStockCount}
              </p>
            </div>
          </>
        )}
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs text-slate-500">Unpaid Supplier Bills</p>
          <p className="text-lg font-bold text-rose-600 mt-1">{currency} {totalPayables.toLocaleString()}</p>
        </div>
        <div className="col-span-2 md:col-span-1 bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs text-slate-500">Active Suppliers</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{suppliers.length}</p>
        </div>
      </div>

      {!isGrowthPlus && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-800">
          Variant stock movements, supplier bills, and supplier management are unlocked for creating/editing on <strong>GROWTH</strong> plans and above.
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700">{errorMsg}</div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(
          [
            ...(canManageStockControl
              ? [
                  { id: 'VARIANTS' as const, label: 'SKU Variants & Stock', icon: PackageCheck },
                  { id: 'MOVEMENTS' as const, label: 'Stock Movements (GRN / Issues)', icon: ArrowUpDown }
                ]
              : []),
            ...(canManageSuppliersAp
              ? [
                  { id: 'BILLS' as const, label: 'Supplier Bills & AP', icon: ReceiptText },
                  { id: 'SUPPLIERS' as const, label: 'Suppliers', icon: Truck }
                ]
              : [])
          ]
        ).map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 ${
                tab === t.id ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: VARIANTS */}
      {tab === 'VARIANTS' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Product Variants (Size / Color / SKU)</h3>
          {isGrowthPlus && !isReadOnly && (
            <form onSubmit={handleAddVariant} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2.5">
              <select
                required
                value={productId}
                onChange={e => setProductId(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2 text-xs bg-white"
              >
                <option value="">Select Product...</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input type="text" required placeholder="SKU (e.g. SHIRT-M-BLK)" value={sku} onChange={e => setSku(e.target.value.toUpperCase())} className="w-full border border-slate-300 rounded-xl p-2 text-xs font-mono uppercase" />
              <input type="text" required placeholder="Variant (e.g. Medium / Black)" value={variantName} onChange={e => setVariantName(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2 text-xs" />
              <input type="number" min="0" step="0.01" placeholder="Cost Price" value={costPrice} onChange={e => setCostPrice(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2 text-xs" />
              <input type="number" min="0" step="0.01" placeholder="Sell Price" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2 text-xs" />
              <div className="flex gap-2">
                <input type="number" min="0" placeholder="Reorder" value={reorderLevel} onChange={e => setReorderLevel(e.target.value)} className="w-20 border border-slate-300 rounded-xl p-2 text-xs" />
                <button type="submit" className="flex-1 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold py-2">Add SKU</button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-2">SKU</th>
                  <th className="py-2 px-2">Variant</th>
                  <th className="py-2 px-2">Cost</th>
                  <th className="py-2 px-2">Sell Price</th>
                  <th className="py-2 px-2">On Hand</th>
                  <th className="py-2 px-2">Valuation</th>
                  <th className="py-2 px-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {variants.map(v => {
                  const qty = Number(v.stock_qty);
                  const outOfStock = qty <= 0;
                  const low = qty > 0 && qty <= Number(v.reorder_level);
                  return (
                    <tr key={v.id} className={outOfStock ? 'bg-rose-50/40' : ''}>
                      <td className="py-2.5 px-2 font-mono font-bold text-slate-900">{v.sku}</td>
                      <td className="py-2.5 px-2">{v.variant_name}</td>
                      <td className="py-2.5 px-2">{currency} {Number(v.cost_price).toLocaleString()}</td>
                      <td className="py-2.5 px-2 font-semibold">{currency} {Number(v.selling_price).toLocaleString()}</td>
                      <td className="py-2.5 px-2">
                        {outOfStock ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold">
                            <AlertTriangle className="w-3 h-3" /> Out of Stock (0)
                          </span>
                        ) : low ? (
                          <span className="inline-flex items-center gap-1 font-bold text-amber-600">
                            <AlertTriangle className="w-3.5 h-3.5" /> {qty} (Low)
                          </span>
                        ) : (
                          <span className="font-bold text-emerald-700">{qty}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 font-semibold text-blue-700">{currency} {(qty * Number(v.cost_price)).toLocaleString()}</td>
                      <td className="py-2.5 px-2 text-right">
                        {isGrowthPlus && !isReadOnly && (
                          <button
                            type="button"
                            onClick={() => {
                              setRestockVariant(v);
                              setRestockQty('10');
                              setRestockCost(String(v.cost_price || 0));
                            }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold ${
                              outOfStock
                                ? 'bg-rose-600 hover:bg-rose-700 text-white'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                            }`}
                          >
                            <PackagePlus className="w-3.5 h-3.5" /> Restock
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {variants.length === 0 && (
                  <tr><td colSpan={7} className="py-4 text-slate-400">No SKU variants created yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: MOVEMENTS */}
      {tab === 'MOVEMENTS' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Record Stock Movement (Posts to GL automatically)</h3>
          {isGrowthPlus && !isReadOnly && (
            <form onSubmit={handleRecordMovement} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
              <select required value={moveVariantId} onChange={e => setMoveVariantId(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2 text-xs bg-white">
                <option value="">Select SKU Variant...</option>
                {variants.map(v => <option key={v.id} value={v.id}>{v.sku} ({v.variant_name})</option>)}
              </select>
              <select value={moveType} onChange={e => setMoveType(e.target.value as StockMovement['movement_type'])} className="w-full border border-slate-300 rounded-xl p-2 text-xs bg-white">
                <option value="GRN_RECEIPT">GRN Receipt (+Stock)</option>
                <option value="SALE_ISSUE">Sale Issue (-Stock)</option>
                <option value="ADJUSTMENT_GAIN">Adjustment Gain (+)</option>
                <option value="ADJUSTMENT_LOSS">Adjustment Loss (-)</option>
                <option value="RETURN_IN">Customer Return (+)</option>
                <option value="SUPPLIER_RETURN">Supplier Return (-Stock)</option>
              </select>
              <input type="number" required min="0.01" step="0.01" placeholder="Quantity" value={moveQty} onChange={e => setMoveQty(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2 text-xs" />
              <input type="number" min="0" step="0.01" placeholder="Unit Cost" value={moveCost} onChange={e => setMoveCost(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2 text-xs" />
              <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold py-2">Record Movement</button>
            </form>
          )}
          <div className="divide-y divide-slate-100 text-xs">
            {movements.map(m => (
              <div key={m.id} className="py-2.5 flex justify-between">
                <span>
                  <strong>{m.movement_type}</strong> &middot; Qty {m.quantity} @ {currency} {Number(m.unit_cost).toLocaleString()}
                  {m.notes ? ` (${m.notes})` : ''}
                </span>
                <span className="text-slate-400">{m.created_at.slice(0, 10)}</span>
              </div>
            ))}
            {movements.length === 0 && <p className="text-slate-400">No stock movements recorded yet.</p>}
          </div>
        </div>
      )}

      {/* TAB 3: SUPPLIER BILLS & AP */}
      {tab === 'BILLS' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Supplier Bills &amp; Accounts Payable (Posts to GL)</h3>
          {isGrowthPlus && !isReadOnly && (
            <form onSubmit={handleAddBill} className="space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                <select required value={billSupplierId} onChange={e => setBillSupplierId(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2 text-xs bg-white">
                  <option value="">Select Supplier...</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input type="text" required placeholder="Bill No. (e.g. SB-001)" value={billNumber} onChange={e => setBillNumber(e.target.value.toUpperCase())} className="w-full border border-slate-300 rounded-xl p-2 text-xs font-mono uppercase" />
                <input type="date" required value={billDate} onChange={e => setBillDate(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2 text-xs" />
                <input type="date" placeholder="Due Date" value={billDueDate} onChange={e => setBillDueDate(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2 text-xs" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 items-center">
                <input type="number" required min="0.01" step="0.01" placeholder={`Net Amount (${currency})`} value={billNetAmount} onChange={e => setBillNetAmount(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2 text-xs" />
                <input type="number" min="0" step="0.01" placeholder={`VAT (${currency})`} value={billVatAmount} onChange={e => setBillVatAmount(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2 text-xs" />
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer px-1">
                  <input type="checkbox" checked={billClearsGrn} onChange={e => setBillClearsGrn(e.target.checked)} />
                  Clears GRN (Stock Purchase)
                </label>
                <button type="submit" className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold py-2.5">
                  Record Supplier Bill
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-2">Bill / Date</th>
                  <th className="py-2 px-2">Supplier</th>
                  <th className="py-2 px-2">GL Mode</th>
                  <th className="py-2 px-2">Total / Paid</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bills.map(b => {
                  const sup = supplierMap.get(b.supplier_id);
                  const balance = Math.max(0, Number(b.total_amount) - Number(b.amount_paid || 0));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {canManageStockControl && (
          <>
            <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4">
              <p className="text-xs text-slate-500">Tracked SKUs</p>
              <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 tabular-money">
                {variants.length}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4">
              <p className="text-xs text-slate-500">Stock Valuation</p>
              <p className="text-sm sm:text-lg font-bold text-blue-600 mt-1 tabular-money whitespace-nowrap">
                {currency} {totalStockValue.toLocaleString()}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4">
              <p className="text-xs text-slate-500">Low / Out-of-Stock</p>
              <p
                className={`text-xl sm:text-2xl font-bold mt-1 tabular-money ${
                  lowStockCount > 0 ? 'text-amber-600' : 'text-emerald-600'
                }`}
              >
                {lowStockCount}
              </p>
            </div>
          </>
        )}
        <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4">
          <p className="text-xs text-slate-500">Unpaid Bills</p>
          <p className="text-sm sm:text-lg font-bold text-rose-600 mt-1 tabular-money whitespace-nowrap">
            {currency} {totalPayables.toLocaleString()}
          </p>
        </div>
        <div className="col-span-2 md:col-span-1 bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4">
          <p className="text-xs text-slate-500">Active Suppliers</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 tabular-money">
            {suppliers.length}
          </p>
        </div>
      </div>

      {!isGrowthPlus && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-800">
          Variant stock movements, supplier bills, and supplier management are unlocked for
          creating/editing on <strong>GROWTH</strong> plans and above.
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700">
          {errorMsg}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {(
          [
            ...(canManageStockControl
              ? [
                  {
                    id: 'VARIANTS' as const,
                    shortLabel: 'SKU Stock',
                    label: 'SKU Variants & Stock',
                    icon: PackageCheck
                  },
                  {
                    id: 'MOVEMENTS' as const,
                    shortLabel: 'Movements',
                    label: 'Stock Movements (GRN / Issues)',
                    icon: ArrowUpDown
                  }
                ]
              : []),
            ...(canManageSuppliersAp
              ? [
                  {
                    id: 'BILLS' as const,
                    shortLabel: 'Bills & AP',
                    label: 'Supplier Bills & AP',
                    icon: ReceiptText
                  },
                  {
                    id: 'SUPPLIERS' as const,
                    shortLabel: 'Suppliers',
                    label: 'Suppliers',
                    icon: Truck
                  }
                ]
              : [])
          ]
        ).map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`min-h-[38px] flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition ${
                tab === t.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="sm:hidden">{t.shortLabel}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: VARIANTS */}
      {tab === 'VARIANTS' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Product Variants (Size / Color / SKU)</h3>
          {isGrowthPlus && !isReadOnly && (
            <form
              onSubmit={handleAddVariant}
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2.5"
            >
              <select
                required
                value={productId}
                onChange={e => setProductId(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-xs bg-white"
              >
                <option value="">Select Product...</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                placeholder="SKU (e.g. SHIRT-M-BLK)"
                value={sku}
                onChange={e => setSku(e.target.value.toUpperCase())}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-xs font-mono uppercase"
              />
              <input
                type="text"
                required
                placeholder="Variant (e.g. Medium / Black)"
                value={variantName}
                onChange={e => setVariantName(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-xs"
              />
              <div className="grid grid-cols-2 sm:contents gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Cost Price"
                  value={costPrice}
                  onChange={e => setCostPrice(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-xs"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Sell Price"
                  value={sellingPrice}
                  onChange={e => setSellingPrice(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-xs"
                />
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  placeholder="Min"
                  aria-label="Reorder level"
                  value={reorderLevel}
                  onChange={e => setReorderLevel(e.target.value)}
                  className="w-20 border border-slate-300 rounded-xl p-2.5 text-xs"
                />
                <button
                  type="submit"
                  className="flex-1 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold py-2.5"
                >
                  Add SKU
                </button>
              </div>
            </form>
          )}

          {/* MOBILE SKU CARDS */}
          <div className="md:hidden divide-y divide-slate-100">
            {variants.map(v => {
              const qty = Number(v.stock_qty);
              const outOfStock = qty <= 0;
              const low = qty > 0 && qty <= Number(v.reorder_level);
              return (
                <div
                  key={v.id}
                  className={`py-3.5 first:pt-1 last:pb-1 space-y-2.5 ${
                    outOfStock ? 'bg-rose-50/40 -mx-2 px-2 rounded-xl' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-bold text-slate-900 truncate">
                        {v.sku}
                      </div>
                      <div className="text-sm font-medium text-slate-700 truncate">
                        {v.variant_name}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {outOfStock ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[11px] font-bold">
                          <AlertTriangle className="w-3 h-3" /> Out (0)
                        </span>
                      ) : low ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-bold">
                          <AlertTriangle className="w-3 h-3" /> {qty} Low
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold">
                          {qty} in stock
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="space-y-0.5 tabular-money">
                      <div className="text-slate-500">
                        Cost: <span className="text-slate-800 font-medium">{currency} {Number(v.cost_price).toLocaleString()}</span> · Sell:{' '}
                        <span className="text-slate-900 font-semibold">{currency} {Number(v.selling_price).toLocaleString()}</span>
                      </div>
                      <div className="text-blue-700 font-semibold">
                        Valuation: {currency} {(qty * Number(v.cost_price)).toLocaleString()}
                      </div>
                    </div>

                    {isGrowthPlus && !isReadOnly && (
                      <button
                        type="button"
                        onClick={() => {
                          setRestockVariant(v);
                          setRestockQty('10');
                          setRestockCost(String(v.cost_price || 0));
                        }}
                        className={`min-h-[36px] inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 ${
                          outOfStock
                            ? 'bg-rose-600 hover:bg-rose-700 text-white'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                        }`}
                      >
                        <PackagePlus className="w-3.5 h-3.5" /> Restock
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {variants.length === 0 && (
              <p className="py-4 text-xs text-slate-400">No SKU variants created yet.</p>
            )}
          </div>

          {/* DESKTOP SKU TABLE */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-2">SKU</th>
                  <th className="py-2 px-2">Variant</th>
                  <th className="py-2 px-2">Cost</th>
                  <th className="py-2 px-2">Sell Price</th>
                  <th className="py-2 px-2">On Hand</th>
                  <th className="py-2 px-2">Valuation</th>
                  <th className="py-2 px-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {variants.map(v => {
                  const qty = Number(v.stock_qty);
                  const outOfStock = qty <= 0;
                  const low = qty > 0 && qty <= Number(v.reorder_level);
                  return (
                    <tr key={v.id} className={outOfStock ? 'bg-rose-50/40' : ''}>
                      <td className="py-2.5 px-2 font-mono font-bold text-slate-900">{v.sku}</td>
                      <td className="py-2.5 px-2">{v.variant_name}</td>
                      <td className="py-2.5 px-2 tabular-money">
                        {currency} {Number(v.cost_price).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2 font-semibold tabular-money">
                        {currency} {Number(v.selling_price).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2">
                        {outOfStock ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold">
                            <AlertTriangle className="w-3 h-3" /> Out of Stock (0)
                          </span>
                        ) : low ? (
                          <span className="inline-flex items-center gap-1 font-bold text-amber-600">
                            <AlertTriangle className="w-3.5 h-3.5" /> {qty} (Low)
                          </span>
                        ) : (
                          <span className="font-bold text-emerald-700">{qty}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 font-semibold text-blue-700 tabular-money">
                        {currency} {(qty * Number(v.cost_price)).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        {isGrowthPlus && !isReadOnly && (
                          <button
                            type="button"
                            onClick={() => {
                              setRestockVariant(v);
                              setRestockQty('10');
                              setRestockCost(String(v.cost_price || 0));
                            }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold ${
                              outOfStock
                                ? 'bg-rose-600 hover:bg-rose-700 text-white'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                            }`}
                          >
                            <PackagePlus className="w-3.5 h-3.5" /> Restock
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {variants.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-slate-400">
                      No SKU variants created yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: MOVEMENTS */}
      {tab === 'MOVEMENTS' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">
            Record Stock Movement (Posts to GL automatically)
          </h3>
          {isGrowthPlus && !isReadOnly && (
            <form
              onSubmit={handleRecordMovement}
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5"
            >
              <select
                required
                value={moveVariantId}
                onChange={e => setMoveVariantId(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-xs bg-white"
              >
                <option value="">Select SKU Variant...</option>
                {variants.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.sku} ({v.variant_name})
                  </option>
                ))}
              </select>
              <select
                value={moveType}
                onChange={e => setMoveType(e.target.value as StockMovement['movement_type'])}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-xs bg-white"
              >
                <option value="GRN_RECEIPT">GRN Receipt (+Stock)</option>
                <option value="SALE_ISSUE">Sale Issue (-Stock)</option>
                <option value="ADJUSTMENT_GAIN">Adjustment Gain (+)</option>
                <option value="ADJUSTMENT_LOSS">Adjustment Loss (-)</option>
                <option value="RETURN_IN">Customer Return (+)</option>
                <option value="SUPPLIER_RETURN">Supplier Return (-Stock)</option>
              </select>
              <div className="grid grid-cols-2 sm:contents gap-2">
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  placeholder="Quantity"
                  value={moveQty}
                  onChange={e => setMoveQty(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-xs"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Unit Cost"
                  value={moveCost}
                  onChange={e => setMoveCost(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-xs"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold py-2.5"
              >
                Record Movement
              </button>
            </form>
          )}
          <div className="divide-y divide-slate-100 text-xs">
            {movements.map(m => (
              <div key={m.id} className="py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{m.movement_type}</div>
                  <div className="text-slate-600 tabular-money">
                    Qty {m.quantity} @ {currency} {Number(m.unit_cost).toLocaleString()}
                    {m.notes ? ` · ${m.notes}` : ''}
                  </div>
                </div>
                <span className="text-slate-400 shrink-0">{m.created_at.slice(0, 10)}</span>
              </div>
            ))}
            {movements.length === 0 && (
              <p className="text-slate-400">No stock movements recorded yet.</p>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: SUPPLIER BILLS & AP */}
      {tab === 'BILLS' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">
            Supplier Bills &amp; Accounts Payable (Posts to GL)
          </h3>
          {isGrowthPlus && !isReadOnly && (
            <form onSubmit={handleAddBill} className="space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                <select
                  required
                  value={billSupplierId}
                  onChange={e => setBillSupplierId(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-xs bg-white"
                >
                  <option value="">Select Supplier...</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  required
                  placeholder="Bill No. (e.g. SB-001)"
                  value={billNumber}
                  onChange={e => setBillNumber(e.target.value.toUpperCase())}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-xs font-mono uppercase"
                />
                <div className="grid grid-cols-2 sm:contents gap-2">
                  <input
                    type="date"
                    required
                    value={billDate}
                    onChange={e => setBillDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl p-2.5 text-xs"
                  />
                  <input
                    type="date"
                    placeholder="Due Date"
                    value={billDueDate}
                    onChange={e => setBillDueDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl p-2.5 text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 items-center">
                <div className="grid grid-cols-2 sm:contents gap-2">
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    placeholder={`Net (${currency})`}
                    value={billNetAmount}
                    onChange={e => setBillNetAmount(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl p-2.5 text-xs"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={`VAT (${currency})`}
                    value={billVatAmount}
                    onChange={e => setBillVatAmount(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl p-2.5 text-xs"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer px-1">
                  <input
                    type="checkbox"
                    checked={billClearsGrn}
                    onChange={e => setBillClearsGrn(e.target.checked)}
                  />
                  Clears GRN (Stock Purchase)
                </label>
                <button
                  type="submit"
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold py-2.5"
                >
                  Record Supplier Bill
                </button>
              </div>
            </form>
          )}

          {/* MOBILE BILLS CARDS */}
          <div className="md:hidden divide-y divide-slate-100">
            {bills.map(b => {
              const sup = supplierMap.get(b.supplier_id);
              const balance = Math.max(0, Number(b.total_amount) - Number(b.amount_paid || 0));
              return (
                <div key={b.id} className="py-3.5 first:pt-1 last:pb-1 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-slate-900 truncate">
                        {sup?.name || 'Supplier'}
                      </div>
                      <div className="text-xs font-mono text-slate-500">
                        {b.bill_number} · {b.bill_date}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-slate-900 tabular-money">
                        {currency} {Number(b.total_amount).toLocaleString()}
                      </div>
                      <span
                        className={`inline-block mt-0.5 px-2 py-0.5 rounded font-bold text-[10px] ${
                          b.status === 'PAID'
                            ? 'bg-emerald-50 text-emerald-700'
                            : b.status === 'PARTIAL'
                              ? 'bg-amber-50 text-amber-700'
                              : b.status === 'VOID'
                                ? 'bg-slate-100 text-slate-400'
                                : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {b.status}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-500 tabular-money">
                      Bal: {currency} {balance.toLocaleString()}
                    </span>
                    {isGrowthPlus && !isReadOnly && b.status !== 'PAID' && b.status !== 'VOID' && (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setPayTarget(b);
                            setPayAmount(String(balance));
                            setPayMethod('M-PESA');
                            setPayRef('');
                          }}
                          className="min-h-[34px] inline-flex items-center gap-1 px-3 py-1 bg-emerald-600 text-white rounded-xl text-xs font-semibold"
                        >
                          <CreditCard className="w-3.5 h-3.5" /> Pay
                        </button>
                        {b.status === 'UNPAID' && Number(b.amount_paid || 0) === 0 && (
                          <button
                            type="button"
                            onClick={() => handleVoidBill(b)}
                            className="min-h-[34px] px-2.5 py-1 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold"
                          >
                            Void
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {bills.length === 0 && (
              <p className="py-4 text-xs text-slate-400">No supplier bills recorded yet.</p>
            )}
          </div>

          {/* DESKTOP BILLS TABLE */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-2">Bill / Date</th>
                  <th className="py-2 px-2">Supplier</th>
                  <th className="py-2 px-2">GL Mode</th>
                  <th className="py-2 px-2">Total / Paid</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bills.map(b => {
                  const sup = supplierMap.get(b.supplier_id);
                  const balance = Math.max(
                    0,
                    Number(b.total_amount) - Number(b.amount_paid || 0)
                  );
                  return (
                    <tr key={b.id}>
                      <td className="py-2.5 px-2">
                        <div className="font-mono font-bold text-slate-900">{b.bill_number}</div>
                        <div className="text-slate-400">
                          {b.bill_date}
                          {b.due_date ? ` · Due ${b.due_date}` : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 font-semibold text-slate-800">
                        {sup?.name || 'Supplier'}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600">
                        {b.clears_grn ? 'GRN Clearing (2110)' : 'Direct Expense (6010)'}
                      </td>
                      <td className="py-2.5 px-2 tabular-money">
                        <div className="font-semibold text-slate-900">
                          {currency} {Number(b.total_amount).toLocaleString()}
                        </div>
                        <div className="text-slate-500">
                          Bal: {currency} {balance.toLocaleString()}
                        </div>
                      </td>
                      <td className="py-2.5 px-2">
                        <span
                          className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                            b.status === 'PAID'
                              ? 'bg-emerald-50 text-emerald-700'
                              : b.status === 'PARTIAL'
                                ? 'bg-amber-50 text-amber-700'
                                : b.status === 'VOID'
                                  ? 'bg-slate-100 text-slate-400'
                                  : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-2">
                        {isGrowthPlus &&
                          !isReadOnly &&
                          b.status !== 'PAID' &&
                          b.status !== 'VOID' && (
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setPayTarget(b);
                                  setPayAmount(String(balance));
                                  setPayMethod('M-PESA');
                                  setPayRef('');
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-semibold"
                              >
                                <CreditCard className="w-3 h-3" /> Pay
                              </button>
                              {b.status === 'UNPAID' && Number(b.amount_paid || 0) === 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleVoidBill(b)}
                                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-semibold"
                                >
                                  Void
                                </button>
                              )}
                            </div>
                          )}
                      </td>
                    </tr>
                  );
                })}
                {bills.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-slate-400">
                      No supplier bills recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: SUPPLIERS */}
      {tab === 'SUPPLIERS' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Suppliers Directory</h3>
          {isGrowthPlus && !isReadOnly && (
            <form
              onSubmit={handleAddSupplier}
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5"
            >
              <input
                type="text"
                required
                placeholder="Supplier Name"
                value={supName}
                onChange={e => setSupName(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-xs"
              />
              <div className="grid grid-cols-2 sm:contents gap-2">
                <input
                  type="text"
                  placeholder="Phone"
                  value={supPhone}
                  onChange={e => setSupPhone(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-xs"
                />
                <input
                  type="text"
                  placeholder="KRA PIN"
                  value={supPin}
                  onChange={e => setSupPin(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-xs"
                />
              </div>
              <input
                type="email"
                placeholder="Email"
                value={supEmail}
                onChange={e => setSupEmail(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-xs"
              />
              <button
                type="submit"
                className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold py-2.5"
              >
                Add Supplier
              </button>
            </form>
          )}
          <div className="divide-y divide-slate-100 text-xs">
            {suppliers.map(s => (
              <div key={s.id} className="py-2.5 flex flex-col sm:flex-row sm:justify-between gap-1">
                <span className="font-semibold text-slate-900">{s.name}</span>
                <span className="text-slate-500">
                  {s.phone || '-'} · {s.email || '-'}
                  {s.kra_pin ? ` · PIN: ${s.kra_pin}` : ''}
                </span>
              </div>
            ))}
            {suppliers.length === 0 && (
              <p className="text-slate-400">No suppliers added yet.</p>
            )}
          </div>
        </div>
      )}

      {/* QUICK RESTOCK MODAL */}
      {restockVariant && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">
              Restock {restockVariant.sku} ({restockVariant.variant_name})
            </h3>
            <form onSubmit={handleQuickRestock} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600">Quantity Received</label>
                <input
                  type="number"
                  required
                  min="1"
                  step="1"
                  value={restockQty}
                  onChange={e => setRestockQty(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1 font-bold"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">
                  Unit Cost ({currency})
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={restockCost}
                  onChange={e => setRestockCost(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRestockVariant(null)}
                  className="flex-1 py-2.5 bg-slate-100 rounded-xl text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRestocking}
                  className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
                >
                  {isRestocking ? 'Restocking...' : 'Confirm Restock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUPPLIER PAYMENT MODAL */}
      {payTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">
              Pay Supplier Bill {payTarget.bill_number}
            </h3>
            <form onSubmit={handlePayBill} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600">Amount ({currency})</label>
                <input
                  type="number"
                  required
                  step="any"
                  min="0.01"
                  max={Math.max(
                    0.01,
                    Number(payTarget.total_amount) - Number(payTarget.amount_paid || 0)
                  )}
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1 font-bold"
                />
              </div>
              <select
                value={payMethod}
                onChange={e => setPayMethod(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-sm bg-white"
              >
                <option value="M-PESA">M-PESA</option>
                <option value="Bank Transfer / EFT">Bank Transfer / EFT</option>
                <option value="Cash">Cash</option>
                <option value="Cheque">Cheque</option>
              </select>
              <input
                type="text"
                placeholder="Payment Reference"
                value={payRef}
                onChange={e => setPayRef(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-sm font-mono"
              />
              <input
                type="date"
                required
                value={payDate}
                onChange={e => setPayDate(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-sm"
              />
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="flex-1 py-2.5 bg-slate-100 rounded-xl text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPaying}
                  className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
                >
                  {isPaying ? 'Paying...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
