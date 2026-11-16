'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Users, Package, PlusCircle, Trash2 } from 'lucide-react';
import { invoiceBalance } from '@/lib/documents';
import type { Customer, DocumentRecord, Product } from '@/lib/types';

interface Props {
  mode: 'CUSTOMERS' | 'CATALOGUE';
  orgId: string;
  currency: string;
  customers: Customer[];
  products: Product[];
  docs: DocumentRecord[];
  onRefresh: () => void;
}

export default function CataloguesSection({ mode, orgId, currency, customers, products, docs, onRefresh }: Props) {
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

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
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
    const { error } = await supabase.from('products_services').insert([{
      org_id: orgId,
      item_type: itemType,
      name: itemName,
      description: itemDesc || itemName,
      unit_price: parseFloat(unitPrice || '0'),
      tax_rate: parseFloat(taxRate || '0')
    }]);
    if (error) alert(error.message);
    else {
      setItemName(''); setItemDesc(''); setUnitPrice(''); setTaxRate('0');
      onRefresh();
    }
  };

  const handleDelete = async (table: 'customers' | 'products_services', id: string) => {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) alert(error.message);
    else onRefresh();
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
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold py-2.5">
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
                        <button onClick={() => handleDelete('customers', c.id)} className="p-1.5 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
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
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold py-2.5">
            Save Item
          </button>
        </div>
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
                <th className="py-2 px-2 text-right">Price ({currency})</th>
                <th className="py-2 px-2 text-right">Tax</th>
                <th className="py-2 px-2 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.length === 0 ? (
                <tr><td colSpan={5} className="py-6 text-center text-slate-400">No products or services saved yet.</td></tr>
              ) : products.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-2"><span className="px-2 py-0.5 text-xs font-semibold rounded bg-slate-100 text-slate-700">{p.item_type}</span></td>
                  <td className="py-2.5 px-2">
                    <div className="font-semibold text-slate-900">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.description}</div>
                  </td>
                  <td className="py-2.5 px-2 text-right font-bold">{Number(p.unit_price).toLocaleString()}</td>
                  <td className="py-2.5 px-2 text-right text-xs text-slate-500">{p.tax_rate}%</td>
                  <td className="py-2.5 px-2 text-right">
                    <button onClick={() => handleDelete('products_services', p.id)} className="p-1.5 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}