'use client';

import { invoiceBalance } from '@/lib/documents';
import type { DocumentRecord } from '@/lib/types';
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  Download,
  Eye,
  Link2,
  Share2,
  Trash2
} from 'lucide-react';

type SalesTab = 'ALL' | 'QUOTE' | 'INVOICE' | 'RECEIPT';

type Props = {
  docs: DocumentRecord[];
  currency: string;
  salesTab: SalesTab;
  onSalesTabChange: (tab: SalesTab) => void;
  docLimit: number;
  onShowMore: () => void;
  subscriptionLocked: boolean;
  onConvertToInvoice: (quote: DocumentRecord) => void;
  onDeleteQuote: (quote: DocumentRecord) => void;
  onOpenReceipt: (invoice: DocumentRecord) => void;
  onVoidInvoice: (invoice: DocumentRecord) => void;
  onPreviewPdf: (doc: DocumentRecord) => void;
  onDownloadPdf: (doc: DocumentRecord) => void;
  onSharePdf: (doc: DocumentRecord) => void;
};

export default function SalesDocumentsTable({
  docs,
  currency,
  salesTab,
  onSalesTabChange,
  docLimit,
  onShowMore,
  subscriptionLocked,
  onConvertToInvoice,
  onDeleteQuote,
  onOpenReceipt,
  onVoidInvoice,
  onPreviewPdf,
  onDownloadPdf,
  onSharePdf
}: Props) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <h3 className="font-bold text-slate-800">Financial Documents ({docs.length})</h3>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {(['ALL', 'QUOTE', 'INVOICE', 'RECEIPT'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => onSalesTabChange(tab)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                salesTab === tab ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600'
              }`}
            >
              {tab === 'ALL' ? 'All' : tab + 'S'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-2">Code &amp; Date</th>
              <th className="py-2.5 px-2">Chain</th>
              <th className="py-2.5 px-2">Customer &amp; Description</th>
              <th className="py-2.5 px-2">Status</th>
              <th className="py-2.5 px-2 text-right">Amount ({currency})</th>
              <th className="py-2.5 px-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {docs.slice(0, docLimit).map(item => {
              const remaining = invoiceBalance(item);
              return (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="py-3 px-2 whitespace-nowrap">
                    <div className="font-mono text-xs font-bold text-slate-900">{item.doc_number}</div>
                    <div className="text-xs text-slate-400">{item.issue_date}</div>
                  </td>
                  <td className="py-3 px-2 text-xs font-mono text-blue-600 whitespace-nowrap">
                    <div className="flex items-center gap-1"><Link2 className="w-3 h-3" />#{item.chain_code}</div>
                    {item.quote_ref && <div className="text-slate-400">From: {item.quote_ref}</div>}
                    {item.invoice_ref && <div className="text-slate-400">From: {item.invoice_ref}</div>}
                  </td>
                  <td className="py-3 px-2">
                    <div className="font-medium text-slate-900">{item.customer_name}</div>
                    <div className="text-xs text-slate-500">{item.description}</div>
                    {item.payment_ref && (
                      <div className="text-xs font-mono text-emerald-600">
                        {item.payment_method}: {item.payment_ref}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-2">
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                        item.status === 'PAID'
                          ? 'bg-emerald-50 text-emerald-700'
                          : item.status === 'PARTIAL'
                            ? 'bg-indigo-50 text-indigo-700'
                            : item.status === 'UNPAID'
                              ? 'bg-amber-50 text-amber-700'
                              : item.status === 'VOID'
                                ? 'bg-rose-50 text-rose-600 line-through'
                                : item.status === 'CONVERTED'
                                  ? 'bg-slate-100 text-slate-500'
                                  : 'bg-blue-50 text-blue-700'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-right whitespace-nowrap">
                    <div className={`font-bold ${item.status === 'VOID' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                      {Number(item.amount).toLocaleString()}
                    </div>
                    {item.doc_type === 'INVOICE' && item.status === 'PARTIAL' && (
                      <div className="text-[11px] text-amber-600">Bal: {remaining.toLocaleString()}</div>
                    )}
                  </td>
                  <td className="py-3 px-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {item.doc_type === 'QUOTE' && item.status === 'ACTIVE' && (
                        <>
                          <button
                            disabled={subscriptionLocked}
                            onClick={() => onConvertToInvoice(item)}
                            className="px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg text-xs font-semibold flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Invoice <ArrowRight className="w-3 h-3" />
                          </button>
                          <button
                            disabled={subscriptionLocked}
                            onClick={() => onDeleteQuote(item)}
                            title="Delete Quotation"
                            className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {item.doc_type === 'INVOICE' && (item.status === 'UNPAID' || item.status === 'PARTIAL') && (
                        <>
                          <button
                            disabled={subscriptionLocked}
                            onClick={() => onOpenReceipt(item)}
                            className="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-semibold flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <CheckCircle2 className="w-3 h-3" /> Receipt
                          </button>
                          {item.status === 'UNPAID' && (
                            <button
                              disabled={subscriptionLocked}
                              onClick={() => onVoidInvoice(item)}
                              title="Void Invoice"
                              className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg disabled:opacity-50"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                      <button onClick={() => onPreviewPdf(item)} title="Preview" className="p-1.5 bg-slate-100 hover:bg-slate-200 text-blue-600 rounded-lg">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button onClick={() => onDownloadPdf(item)} title="Download" className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg">
                        <Download className="w-4 h-4" />
                      </button>
                      <button onClick={() => onSharePdf(item)} title="Share PDF" className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                        <Share2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {docs.length > docLimit && (
        <button
          onClick={onShowMore}
          className="w-full py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700"
        >
          Show more ({docs.length - docLimit} remaining)
        </button>
      )}
    </div>
  );
}