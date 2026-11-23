'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Users, Package, PlusCircle, Trash2, AlertTriangle, PackagePlus } from 'lucide-react';
import { invoiceBalance } from '@/lib/documents';
import { topUpStockShortfalls } from '@/lib/inventorySync';
import type { Customer, DocumentRecord, Product, ProductVariant } from '@/lib/types';

interface Props {
  mode: 'CUSTOMERS' | 'CATALOGUE';
  orgId: string;
  currency: string;
  customers: Customer[];
  products: Product[];
  docs: DocumentRecord[];
  isReadOnly?: boolean;
  onRefresh: () => void;
}

export default function CataloguesSection({
  mode,
  orgId,
  currency,
  customers,
  products,
  docs,
  isReadOnly = false,
  onRefresh
}: Props) {
  // Customer form
  const [custName, setCustName] = useState('');
  const [custCompany, setCustCompany] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custKraPin, setCustKraPin] = useState('');

  // Product/Service form
  const [itemType, setItemType] = useState<'SERVICE' | 'PRODUCT'>('SERVICE');
  const [itemName, setItemName] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [taxRate, setTaxRate] = useState('0');
  const [initialStock, setInitialStock] = useState('');
  const [initialCost, setInitialCost] = useState('');

  // Tracked inventory variants for live stock display
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [restockProduct, setRestockProduct] = useState<Product | null>(null);
  const [restockVariantId, setRestockVariantId] = useState('');
  const [restockQty, setRestockQty] = useState('10');
  const [restockCost, setRestockCost] = useState('');
  const [restockBusy, setRestockBusy] = useState(false);

  const loadVariants = useCallback(async () => {
    const { data, error } = await supabase
      .from('product_variants')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('sku');
    if (!error && data) {
      setVariants(data as ProductVariant[]);
    }
  }, [orgId]);

  useEffect(() => {
    if (mode === 'CATALOGUE') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load live variant stock levels when viewing catalogue
      loadVariants();
    }
  }, [mode, loadVariants]);

  const variantsByProduct = useMemo(() => {
    const map = new Map<string, ProductVariant[]>();
    for (const v of variants) {
      const list = map.get(v.product_id) || [];
      list.push(v);
      map.set(v.product_id, list);
    }
    return map;
  }, [variants]);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) {
      alert('This workspace is read-only until its subscription is renewed.');
      return;
    }
    const { error } = await supabase.from('customers').insert([{
      org_id: orgId,
      name: custName,
      company_name: custCompany || null,
      phone: custPhone || null,
      email: custEmail || null,
      kra_pin: custKraPin || null
    }]);
    if (error) alert(error.message);
    else {
      setCustName(''); setCustCompany(''); setCustPhone(''); setCustEmail(''); setCustKraPin('');
      onRefresh();
    }
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) {
      alert('This workspace is read-only until its subscription is renewed.');
      return;
    }
    const price = parseFloat(unitPrice || '0');
    const { data: created, error } = await supabase
      .from('products_services')
      .insert([{
        org_id: orgId,
        item_type: itemType,
        name: itemName,
        description: itemDesc || itemName,
        unit_price: price,
        tax_rate: parseFloat(taxRate || '0')
      }])
      .select()
      .single();

    if (error || !created) {
      alert(error?.message || 'Failed to save item.');
      return;
    }

    // If adding a physical PRODUCT with opening stock, auto-create default SKU & GRN receipt
    const openingQty = Number(initialStock || 0);
    if (itemType === 'PRODUCT' && openingQty > 0) {
      const autoSku = `${itemName.trim().slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'ITM')}-${Math.floor(100 + Math.random() * 900)}`;
      const cost = Number(initialCost || 0);
      const { data: newVar } = await supabase
        .from('product_variants')
        .insert({
          org_id: orgId,
          product_id: created.id,
          sku: autoSku,
          variant_name: 'Standard',
          cost_price: cost,
          selling_price: price,
          reorder_level: 5
        })
        .select('id')
        .single();

      if (newVar) {
        const res = await topUpStockShortfalls(orgId, [{
          variantId: newVar.id,
          addQty: openingQty,
          unitCost: cost,
          note: 'Opening stock from Product Catalogue'
        }]);
        if (!res.ok) alert(`Item saved, but opening stock failed: ${res.error}`);
      }
    }

    setItemName('');
    setItemDesc('');
    setUnitPrice('');
    setTaxRate('0');
    setInitialStock('');
    setInitialCost('');
    await loadVariants();
    onRefresh();
  };

  const openRestockModal = (product: Product) => {
    if (isReadOnly) {
      alert('This workspace is read-only until its subscription is renewed.');
      return;
    }
    const prodVars = variantsByProduct.get(product.id) || [];
    setRestockProduct(product);
    setRestockVariantId(prodVars[0]?.id || '');
    setRestockQty('10');
    setRestockCost(prodVars[0] ? String(prodVars[0].cost_price || 0) : '0');
  };

  const handleConfirmRestock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockProduct || restockBusy) return;
    if (isReadOnly) {
      alert('This workspace is read-only until its subscription is renewed.');
      return;
    }
    const qty = Number(restockQty);
    if (!qty || qty <= 0) {
      alert('Enter a restock quantity greater than 0.');
      return;
    }

    setRestockBusy(true);
    try {
      let targetVariantId = restockVariantId;
      const cost = Number(restockCost || 0);

      // If this product didn't have an inventory SKU yet, create one on the fly
      if (!targetVariantId) {
        const autoSku = `${restockProduct.name.trim().slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'ITM')}-${Math.floor(100 + Math.random() * 900)}`;
        const { data: createdVar, error: varErr } = await supabase
          .from('product_variants')
          .insert({
            org_id: orgId,
            product_id: restockProduct.id,
            sku: autoSku,
            variant_name: 'Standard',
            cost_price: cost,
            selling_price: Number(restockProduct.unit_price || 0),
            reorder_level: 5
          })
          .select('id')
          .single();

        if (varErr || !createdVar) {
          alert(varErr?.message || 'Could not initialize stock SKU.');
          return;
        }
        targetVariantId = createdVar.id;
      }

      const topUpRes = await topUpStockShortfalls(orgId, [{
        variantId: targetVariantId,
        addQty: qty,
        unitCost: cost,
        note: `Restocked ${restockProduct.name} from Product Catalogue`
      }]);

      if (!topUpRes.ok) {
        alert(topUpRes.error || 'Failed to record stock receipt.');
        return;
      }

      setRestockProduct(null);
      await loadVariants();
      onRefresh();
    } finally {
      setRestockBusy(false);
    }
  };

  const handleDelete = async (table: 'customers' | 'products_services', id: string, label: string) => {
    if (isReadOnly) {
      alert('This workspace is read-only until its subscription is renewed.');
      return;
    }
    if (!window.confirm(`Delete "${label}"?`)) return;

    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) alert(error.message);
    else {
      await loadVariants();
      onRefresh();
    }
  };

  if (mode === 'CUSTOMERS') {
    return (
      <div className="space-y-6">
        <form onSubmit={handleAddCustomer} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
            <PlusCircle className="w-4 h-4 text-blue-600" /> Add Customer
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input type="text" required placeholder="Contact Name" value={custName} onChange={e => setCustName(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
            <input type="text" placeholder="Company Name (Optional)" value={custCompany} onChange={e => setCustCompany(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
            <input type="tel" placeholder="Phone (e.g. 0712...)" value={custPhone} onChange={e => setCustPhone(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input type="email" placeholder="Email" value={custEmail} onChange={e => setCustEmail(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
            <input type="text" placeholder="KRA PIN (Optional)" value={custKraPin} onChange={e => setCustKraPin(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
            <button type="submit" disabled={isReadOnly} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold py-2.5 disabled:opacity-50">
              Save Customer
            </button>
          </div>
        </form>

        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-3 text-sm">
            <Users className="w-4 h-4 text-blue-600" /> Saved Customers ({customers.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-2">Customer</th>
                  <th className="py-2 px-2">Contact</th>
                  <th className="py-2 px-2 text-right">Billed</th>
                  <th className="py-2 px-2 text-right">Unpaid</th>
                  <th className="py-2 px-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers.length === 0 ? (
                  <tr><td colSpan={5} className="py-6 text-center text-slate-400">No saved customers yet.</td></tr>
                ) : customers.map(c => {
                  const custInvoices = docs.filter(d => d.doc_type === 'INVOICE' && d.status !== 'VOID' && (d.customer_id === c.id || d.customer_name?.toLowerCase() === c.name.toLowerCase()));
                  const billed = custInvoices.reduce((s, d) => s + Number(d.amount || 0), 0);
                  const unpaid = custInvoices.reduce((s, d) => s + invoiceBalance(d), 0);
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-2">
                        <div className="font-semibold text-slate-900">{c.name}</div>
                        {c.company_name && <div className="text-xs text-slate-500">{c.company_name}</div>}
                      </td>
                      <td className="py-2.5 px-2 text-xs text-slate-600">
                        {c.phone || '-'} {c.email ? `• ${c.email}` : ''}
                        {c.kra_pin && <div className="text-slate-400">PIN: {c.kra_pin}</div>}
                      </td>
                      <td className="py-2.5 px-2 text-right font-medium">{currency} {billed.toLocaleString()}</td>
                      <td className={`py-2.5 px-2 text-right font-bold ${unpaid > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                        {currency} {unpaid.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <button
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => handleDelete('customers', c.id, c.name)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 disabled:opacity-30"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleAddProduct} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
          <PlusCircle className="w-4 h-4 text-blue-600" /> Add Product or Service
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <select value={itemType} onChange={e => setItemType(e.target.value as 'SERVICE' | 'PRODUCT')} className="border border-slate-300 rounded-xl p-2.5 text-sm">
            <option value="SERVICE">Service</option>
            <option value="PRODUCT">Product</option>
          </select>
          <input type="text" required placeholder="Item / Service Name" value={itemName} onChange={e => setItemName(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm sm:col-span-2" />
          <input type="number" required placeholder={`Unit Price (${currency})`} value={unitPrice} onChange={e => setUnitPrice(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input type="text" placeholder="Default Invoice Description" value={itemDesc} onChange={e => setItemDesc(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm sm:col-span-2" />
          <select value={taxRate} onChange={e => setTaxRate(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm">
            <option value="0">0% Tax (Exempt / Non-VAT)</option>
            <option value="16">16% VAT</option>
          </select>
          <button type="submit" disabled={isReadOnly} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold py-2.5 disabled:opacity-50">
            Save Item
          </button>
        </div>
        {itemType === 'PRODUCT' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <input
              type="number"
              min="0"
              step="1"
              placeholder="Opening Stock Qty (Optional — creates tracked SKU)"
              value={initialStock}
              onChange={e => setInitialStock(e.target.value)}
              className="border border-slate-300 rounded-xl p-2.5 text-sm"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder={`Unit Cost Price (${currency}, Optional)`}
              value={initialCost}
              onChange={e => setInitialCost(e.target.value)}
              className="border border-slate-300 rounded-xl p-2.5 text-sm"
            />
          </div>
        )}
      </form>

      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-3 text-sm">
          <Package className="w-4 h-4 text-blue-600" /> Products &amp; Services ({products.length})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2 px-2">Type</th>
                <th className="py-2 px-2">Name &amp; Description</th>
                <th className="py-2 px-2">Stock Status</th>
                <th className="py-2 px-2 text-right">Price ({currency})</th>
                <th className="py-2 px-2 text-right">Tax</th>
                <th className="py-2 px-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.length === 0 ? (
                <tr><td colSpan={6} className="py-6 text-center text-slate-400">No products or services saved yet.</td></tr>
              ) : products.map(p => {
                const prodVars = variantsByProduct.get(p.id) || [];
                const isTracked = p.item_type === 'PRODUCT' && prodVars.length > 0;
                const totalQty = prodVars.reduce((sum, v) => sum + Number(v.stock_qty || 0), 0);
                const maxReorder = prodVars.reduce((m, v) => Math.max(m, Number(v.reorder_level || 0)), 0);
                const isOutOfStock = isTracked && totalQty <= 0;
                const isLowStock = isTracked && totalQty > 0 && totalQty <= maxReorder;

                return (
                  <tr key={p.id} className={isOutOfStock ? 'bg-rose-50/40' : 'hover:bg-slate-50'}>
                    <td className="py-2.5 px-2">
                      <span className="px-2 py-0.5 text-xs font-semibold rounded bg-slate-100 text-slate-700">
                        {p.item_type}
                      </span>
                    </td>
                    <td className="py-2.5 px-2">
                      <div className="font-semibold text-slate-900">{p.name}</div>
                      <div className="text-xs text-slate-500">{p.description}</div>
                    </td>
                    <td className="py-2.5 px-2">
                      {p.item_type === 'SERVICE' ? (
                        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">
                          Service
                        </span>
                      ) : !isTracked ? (
                        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-50 text-blue-700">
                          Untracked
                        </span>
                      ) : isOutOfStock ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-bold rounded-full bg-rose-100 text-rose-700">
                          <AlertTriangle className="w-3 h-3" /> Out of Stock (0)
                        </span>
                      ) : isLowStock ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-bold rounded-full bg-amber-100 text-amber-800">
                          Low Stock ({totalQty} left)
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700">
                          In Stock ({totalQty})
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right font-bold">{Number(p.unit_price).toLocaleString()}</td>
                    <td className="py-2.5 px-2 text-right text-xs text-slate-500">{p.tax_rate}%</td>
                    <td className="py-2.5 px-2 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {p.item_type === 'PRODUCT' && (
                          <button
                            type="button"
                            disabled={isReadOnly}
                            onClick={() => openRestockModal(p)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition disabled:opacity-40 ${
                              isOutOfStock
                                ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-xs'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                            }`}
                          >
                            <PackagePlus className="w-3.5 h-3.5" /> Restock
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => handleDelete('products_services', p.id, p.name)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 disabled:opacity-30"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* QUICK RESTOCK MODAL */}
      {restockProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div>
              <h3 className="text-base font-bold text-slate-900">Restock {restockProduct.name}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Records a GRN stock receipt and immediately updates availability in your catalogue &amp; sales documents.
              </p>
            </div>
            <form onSubmit={handleConfirmRestock} className="space-y-3">
              {(variantsByProduct.get(restockProduct.id) || []).length > 1 && (
                <div>
                  <label className="text-xs font-semibold text-slate-600">SKU Variant</label>
                  <select
                    value={restockVariantId}
                    onChange={e => setRestockVariantId(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1 bg-white"
                  >
                    {(variantsByProduct.get(restockProduct.id) || []).map(v => (
                      <option key={v.id} value={v.id}>
                        {v.sku} — {v.variant_name} ({Number(v.stock_qty)} in stock)
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600">Quantity to Add</label>
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
                  <label className="text-xs font-semibold text-slate-600">Unit Cost ({currency})</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={restockCost}
                    onChange={e => setRestockCost(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRestockProduct(null)}
                  className="flex-1 py-2.5 bg-slate-100 rounded-xl text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={restockBusy}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
                >
                  {restockBusy ? 'Restocking...' : 'Confirm Restock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}