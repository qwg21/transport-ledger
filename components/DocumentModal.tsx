'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { buildDocNumber, explainDbError, todayLocal } from '@/lib/documents';
import {
  deductStockForDocument,
  getStockShortfalls,
  topUpStockShortfalls,
  type StockShortfall
} from '@/lib/inventorySync';
import type { Customer, DocType, LineItem, Product, ProductVariant } from '@/lib/types';
import { PlusCircle, X } from 'lucide-react';

const EMPTY_LINE_ITEM: LineItem = { product_id: null, description: '', quantity: 1, unit_price: 0 };

const PAYMENT_METHODS = [
  'M-PESA',
  'Bank Transfer / EFT',
  'Card / POS',
  'Cash',
  'Cheque',
  'Online (PayPal / Stripe)'
];

type ShortfallDraft = StockShortfall & {
  receiveQty: string;
  receiveCost: string;
};

type Props = {
  orgId: string;
  currency: string;
  isGrowthPlus: boolean;
  subscriptionLocked: boolean;
  customers: Customer[];
  products: Product[];
  initialDocType?: DocType;
  onClose: () => void;
  onCreated: () => void;
};

export default function DocumentModal({
  orgId,
  currency,
  isGrowthPlus,
  subscriptionLocked,
  customers,
  products,
  initialDocType = 'QUOTE',
  onClose,
  onCreated
}: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [docType, setDocType] = useState<DocType>(initialDocType);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [issueDate, setIssueDate] = useState(todayLocal);
  const [lineItems, setLineItems] = useState<LineItem[]>([{ ...EMPTY_LINE_ITEM }]);
  const [payMethod, setPayMethod] = useState('M-PESA');
  const [paymentRef, setPaymentRef] = useState('');
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [shortfalls, setShortfalls] = useState<ShortfallDraft[]>([]);

  useEffect(() => {
    let active = true;
    supabase
      .from('product_variants')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('sku')
      .then(({ data }) => {
        if (active && data) setVariants(data as ProductVariant[]);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  const variantsByProduct = useMemo(() => {
    const map = new Map<string, ProductVariant[]>();
    for (const v of variants) {
      const list = map.get(v.product_id) || [];
      list.push(v);
      map.set(v.product_id, list);
    }
    return map;
  }, [variants]);

  const getProductStockInfo = (productId: string | null) => {
    if (!productId) return { isTracked: false, available: Infinity };
    const prod = products.find(p => p.id === productId);
    const prodVars = variantsByProduct.get(productId) || [];
    if (!prod || prod.item_type !== 'PRODUCT' || prodVars.length === 0) {
      return { isTracked: false, available: Infinity };
    }
    const available = prodVars.reduce((sum, v) => sum + Number(v.stock_qty || 0), 0);
    return { isTracked: true, available };
  };

  const matchedCustomers =
    isGrowthPlus && showCustomerDropdown && !selectedCustomerId
      ? customers
          .filter(c => {
            if (!customerName.trim()) return true;
            return `${c.name} ${c.company_name || ''} ${c.phone || ''}`
              .toLowerCase()
              .includes(customerName.toLowerCase());
          })
          .slice(0, 6)
      : [];

  const computedDocTotal = lineItems.reduce(
    (sum, li) => sum + (Number(li.quantity) || 0) * (Number(li.unit_price) || 0),
    0
  );

  const handleAddCatalogueProduct = (productId: string) => {
    const p = products.find(x => x.id === productId);
    if (!p) return;

    setShortfalls([]);
    setLineItems(prev => {
      const existingIdx = prev.findIndex(li => li.product_id === p.id);
      if (existingIdx !== -1) {
        const nextQty = Number(prev[existingIdx].quantity || 0) + 1;
        return prev.map((li, i) =>
          i === existingIdx ? { ...li, quantity: nextQty } : li
        );
      }

      const newItem: LineItem = {
        product_id: p.id,
        description: p.name,
        quantity: 1,
        unit_price: Number(p.unit_price || 0)
      };

      if (prev.length === 1 && !prev[0].description.trim() && Number(prev[0].unit_price) === 0) {
        return [newItem];
      }
      return [...prev, newItem];
    });
  };

  const updateLineItem = (idx: number, patch: Partial<LineItem>) => {
    setShortfalls([]);
    setLineItems(prev => prev.map((li, i) => (i === idx ? { ...li, ...patch } : li)));
  };

  const addEmptyLineItem = () => {
    setShortfalls([]);
    setLineItems(prev => [...prev, { ...EMPTY_LINE_ITEM }]);
  };

  const removeLineItem = (idx: number) => {
    setShortfalls([]);
    setLineItems(prev => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (subscriptionLocked) {
      alert('This workspace is read-only until its subscription is renewed.');
      return;
    }

    const validItems = lineItems.filter(li => li.description.trim() && Number(li.quantity) > 0);
    if (validItems.length === 0 || computedDocTotal <= 0 || !customerName.trim()) {
      alert('Please enter a customer name and at least one item with a valid price.');
      return;
    }

    // Check for stock shortfalls on Invoices / Receipts before creating the document
    if (docType !== 'QUOTE' && shortfalls.length === 0) {
      const { shortfalls: gaps, error: gapErr } = await getStockShortfalls(orgId, validItems);
      if (gapErr) {
        alert(gapErr);
        return;
      }
      if (gaps.length > 0) {
        setShortfalls(
          gaps.map(g => ({
            ...g,
            receiveQty: String(g.shortfall),
            receiveCost: String(g.defaultCostPrice || 0)
          }))
        );
        return;
      }
    }

    // Validate confirmed top-up quantities meet at least the exact shortfall
    if (docType !== 'QUOTE' && shortfalls.length > 0) {
      for (const s of shortfalls) {
        const addQty = Number(s.receiveQty || 0);
        if (isNaN(addQty) || addQty < s.shortfall) {
          alert(`Add at least ${s.shortfall} unit(s) for "${s.productName}" to fulfill this order.`);
          return;
        }
      }
    }

    setIsSubmitting(true);
    try {
      // 1. Receive top-up / restock units into inventory first if confirmed
      if (docType !== 'QUOTE' && shortfalls.length > 0) {
        const topUpRes = await topUpStockShortfalls(
          orgId,
          shortfalls.map(s => ({
            variantId: s.defaultVariantId,
            addQty: Number(s.receiveQty || 0),
            unitCost: Number(s.receiveCost || 0),
            note:
              Number(s.receiveQty) === s.shortfall
                ? `Order top-up (+${s.shortfall}) to fulfill order`
                : `Restock (+${s.receiveQty}) during order`
          }))
        );
        if (!topUpRes.ok) {
          alert(`Stock restock failed: ${topUpRes.error}`);
          return;
        }
        setShortfalls([]);
      }

      const effectiveDate = issueDate || todayLocal();
      const yearNum = parseInt(effectiveDate.split('-')[0], 10);

      const { data: chainCode, error: seqError } = await supabase.rpc('next_chain_code', {
        p_org_id: orgId,
        p_year: yearNum
      });

      if (seqError || !chainCode) {
        alert(`Numbering error: ${seqError?.message ?? 'no number returned'}`);
        return;
      }

      let resolvedCustomerId: string | null = selectedCustomerId || null;

      if (isGrowthPlus && !resolvedCustomerId) {
        const cleanName = customerName.trim();
        const cleanPhone = customerPhone.trim();
        const cleanEmail = customerEmail.trim();

        const existing = customers.find(c => {
          const samePhone =
            cleanPhone &&
            c.phone &&
            c.phone.replace(/\s+/g, '') === cleanPhone.replace(/\s+/g, '');
          const sameName =
            c.name && c.name.trim().toLowerCase() === cleanName.toLowerCase();
          return samePhone || sameName;
        });

        if (existing) {
          resolvedCustomerId = existing.id;
        } else if (cleanName) {
          const { data: newCust, error: custErr } = await supabase
            .from('customers')
            .insert([{
              org_id: orgId,
              name: cleanName,
              phone: cleanPhone || null,
              email: cleanEmail || null
            }])
            .select()
            .single();

          if (custErr) {
            alert(`Customer auto-save failed: ${custErr.message}`);
          } else if (newCust) {
            resolvedCustomerId = newCust.id;
          }
        }
      }

      const docNumber = buildDocNumber(docType, chainCode);
      const summaryDescription = validItems
        .map(li => (li.quantity > 1 ? `${li.quantity}x ${li.description.trim()}` : li.description.trim()))
        .join(', ');

      const { data: newDoc, error } = await supabase
        .from('documents')
        .insert([{
          org_id: orgId,
          customer_id: resolvedCustomerId,
          doc_type: docType,
          chain_code: chainCode,
          doc_number: docNumber,
          issue_date: effectiveDate,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          customer_email: customerEmail.trim(),
          description: summaryDescription,
          amount: computedDocTotal,
          amount_paid: docType === 'RECEIPT' ? computedDocTotal : 0,
          payment_method: payMethod,
          payment_ref: docType === 'RECEIPT' ? paymentRef : null,
          status: docType === 'QUOTE' ? 'ACTIVE' : docType === 'INVOICE' ? 'UNPAID' : 'PAID'
        }])
        .select()
        .single();

      if (error || !newDoc) {
        alert(error ? explainDbError(error) : 'Could not create document.');
        return;
      }

      const itemRows = validItems.map(li => ({
        org_id: orgId,
        document_id: newDoc.id,
        product_id: li.product_id,
        description: li.description.trim(),
        quantity: Number(li.quantity),
        unit_price: Number(li.unit_price),
        line_total: Number(li.quantity) * Number(li.unit_price)
      }));

      const { error: itemsErr } = await supabase.from('document_items').insert(itemRows);
      if (itemsErr) {
        alert(`Document saved, but line items failed: ${itemsErr.message}`);
      } else if (docType !== 'QUOTE') {
        const deductRes = await deductStockForDocument(orgId, newDoc.id, docNumber);
        if (!deductRes.ok) {
          alert(`Document saved, but inventory deduction failed: ${deductRes.error}`);
        }
      }

      onCreated();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-3 shadow-xl">
        <h3 className="text-lg font-bold">New Quote / Invoice / Receipt</h3>
        <form onSubmit={handleCreateDocument} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={docType}
              onChange={e => {
                setDocType(e.target.value as DocType);
                setShortfalls([]);
              }}
              className="border border-slate-300 rounded-xl p-2.5 text-sm"
            >
              <option value="QUOTE">Quotation (QT)</option>
              <option value="INVOICE">Invoice (INV)</option>
              <option value="RECEIPT">Official Receipt (RCT)</option>
            </select>
            <input type="date" required value={issueDate} onChange={e => setIssueDate(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
          </div>

          <div className="relative">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                required
                placeholder={'Customer Name'}
                value={customerName}
                onFocus={() => setShowCustomerDropdown(true)}
                onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 150)}
                onChange={e => {
                  setCustomerName(e.target.value);
                  setSelectedCustomerId('');
                  setShowCustomerDropdown(true);
                }}
                className="border border-slate-300 rounded-xl p-2.5 text-sm"
              />
              <input type="tel" placeholder="Phone" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
            </div>
            {isGrowthPlus && (
              <div className="text-[11px] text-slate-400 mt-1 px-1">
                {selectedCustomerId
                  ? 'Linked to saved customer.'
                  : customers.length > 0
                    ? `Click Customer Name to search ${customers.length} saved customer(s), or type a new name to auto-save.`
                    : 'No saved customers yet — entering a new name will auto-save them.'}
              </div>
            )}
            {matchedCustomers.length > 0 && (
              <div className="border border-slate-200 rounded-xl bg-white max-h-36 overflow-y-auto divide-y divide-slate-100 mt-1 shadow-sm">
                {matchedCustomers.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={() => {
                      setSelectedCustomerId(c.id);
                      setCustomerName(c.company_name ? `${c.name} (${c.company_name})` : c.name);
                      setCustomerPhone(c.phone || '');
                      setCustomerEmail(c.email || '');
                      setShowCustomerDropdown(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex justify-between"
                  >
                    <span className="font-semibold text-slate-800">{c.name}</span>
                    <span className="text-slate-400">{c.phone || c.company_name || ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <input type="email" placeholder="Customer Email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm" />

          {isGrowthPlus && products.length > 0 && (
            <select
              value=""
              onChange={e => {
                if (e.target.value) handleAddCatalogueProduct(e.target.value);
              }}
              className="w-full border border-blue-200 rounded-xl p-2.5 text-sm bg-blue-50 text-blue-900 font-medium"
            >
              <option value="">+ Quick Add from Catalogue...</option>
              {products.map(p => {
                const { isTracked, available } = getProductStockInfo(p.id);
                const stockLabel = !isTracked
                  ? ''
                  : available <= 0
                  ? ' — Out of Stock (top-up on save)'
                  : ` — ${available} in stock`;
                return (
                  <option key={p.id} value={p.id}>
                    {p.name} ({currency} {Number(p.unit_price).toLocaleString()}){stockLabel}
                  </option>
                );
              })}
            </select>
          )}

          <div className="space-y-2 border border-slate-200 rounded-xl p-3 bg-slate-50">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase text-slate-500">Items ({lineItems.length})</span>
              <button type="button" onClick={addEmptyLineItem} className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
                <PlusCircle className="w-3.5 h-3.5" /> Add Custom Row
              </button>
            </div>

            {lineItems.map((li, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
                <input
                  type="text"
                  required
                  placeholder="Item / Service"
                  value={li.description}
                  onChange={e => updateLineItem(idx, { description: e.target.value })}
                  className="col-span-6 border border-slate-300 bg-white rounded-lg p-2 text-xs"
                />
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  placeholder="Qty"
                  value={li.quantity}
                  onChange={e => updateLineItem(idx, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                  className="col-span-2 border border-slate-300 bg-white rounded-lg p-2 text-xs text-center"
                />
                <input
                  type="number"
                  min="0"
                  required
                  placeholder="Price"
                  value={li.unit_price || ''}
                  onChange={e => updateLineItem(idx, { unit_price: Number(e.target.value) || 0 })}
                  className="col-span-3 border border-slate-300 bg-white rounded-lg p-2 text-xs text-right"
                />
                <button
                  type="button"
                  onClick={() => removeLineItem(idx)}
                  disabled={lineItems.length === 1}
                  className="col-span-1 flex justify-center text-slate-400 hover:text-rose-600 disabled:opacity-30"
                  title="Remove item"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}

            <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-sm font-bold text-slate-900">
              <span>Total</span>
              <span>{currency} {computedDocTotal.toLocaleString()}</span>
            </div>
          </div>

          {docType === 'RECEIPT' && (
            <div className="grid grid-cols-2 gap-2">
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm">
                {PAYMENT_METHODS.map(pm => <option key={pm} value={pm}>{pm}</option>)}
              </select>
              <input type="text" placeholder="Reference Code" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm font-mono" />
            </div>
          )}

          {shortfalls.length > 0 && (
            <div className="border border-amber-300 bg-amber-50 rounded-xl p-3.5 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-amber-900">
                  Stock Shortfall — Top Up to Fulfill or Restock
                </span>
                <button
                  type="button"
                  onClick={() => setShortfalls([])}
                  className="text-slate-600 hover:underline font-semibold"
                >
                  Dismiss
                </button>
              </div>
              <p className="text-amber-800">
                Existing stock will be used first. Add the exact shortfall to match this order, or enter a higher quantity to restock extra units:
              </p>
              {shortfalls.map((s, idx) => {
                const addNum = Number(s.receiveQty || 0);
                const endingStock = Math.max(0, s.available + addNum - s.requested);
                return (
                  <div key={s.productId} className="bg-white border border-amber-200 rounded-lg p-2.5 space-y-2">
                    <div className="flex flex-wrap justify-between gap-1 font-semibold text-slate-900">
                      <span>{s.productName}</span>
                      <span className="text-amber-700">
                        On hand: {s.available} &middot; Order: {s.requested} &middot; Short: {s.shortfall}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setShortfalls(prev =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, receiveQty: String(s.shortfall) } : row
                            )
                          )
                        }
                        className={`px-2 py-1 rounded text-[11px] font-semibold border ${
                          addNum === s.shortfall
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        Exact Match (+{s.shortfall})
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setShortfalls(prev =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, receiveQty: String(s.shortfall + 10) } : row
                            )
                          )
                        }
                        className={`px-2 py-1 rounded text-[11px] font-semibold border ${
                          addNum === s.shortfall + 10
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        Full Restock (+{s.shortfall + 10})
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-slate-500">Qty to Add (min {s.shortfall})</label>
                        <input
                          type="number"
                          min={s.shortfall}
                          step="1"
                          required
                          value={s.receiveQty}
                          onChange={e =>
                            setShortfalls(prev =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, receiveQty: e.target.value } : row
                              )
                            )
                          }
                          className="w-full border border-slate-300 rounded-lg p-1.5 text-xs font-bold mt-0.5"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-500">Unit Cost ({currency})</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={s.receiveCost}
                          onChange={e =>
                            setShortfalls(prev =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, receiveCost: e.target.value } : row
                              )
                            )
                          }
                          className="w-full border border-slate-300 rounded-lg p-1.5 text-xs mt-0.5"
                        />
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Remaining stock after this order: <strong className="text-slate-800">{endingStock}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 bg-slate-100 rounded-xl text-sm font-semibold">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
              {isSubmitting
                ? 'Saving...'
                : shortfalls.length > 0
                ? `Receive Stock & Save (${currency} ${computedDocTotal.toLocaleString()})`
                : `Save (${currency} ${computedDocTotal.toLocaleString()})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}