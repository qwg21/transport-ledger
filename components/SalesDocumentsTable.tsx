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
  onVoidReceipt?: (receipt: DocumentRecord) => void;
  onPreviewPdf: (doc: DocumentRecord) => void;
  onDownloadPdf: (doc: DocumentRecord) => void;
  onSharePdf: (doc: DocumentRecord) => void;
};

function statusBadgeClass(status: string) {
  if (status === 'PAID') return 'bg-emerald-50 text-emerald-700';
  if (status === 'PARTIAL') return 'bg-indigo-50 text-indigo-700';
  if (status === 'UNPAID') return 'bg-amber-50 text-amber-700';
  if (status === 'VOID') return 'bg-rose-50 text-rose-600 line-through';
  if (status === 'CONVERTED') return 'bg-slate-100 text-slate-500';
  return 'bg-blue-50 text-blue-700';
}

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
  onVoidReceipt,
  onPreviewPdf,
  onDownloadPdf,
  onSharePdf
}: Props) {
  const visibleDocs = docs.slice(0, docLimit);

  return (
    <div className="bg-surface border border-surface-border rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5">
        <h3 className="font-bold text-ink">Financial Documents ({docs.length})</h3>
        <div className="w-full sm:w-auto grid grid-cols-4 sm:flex gap-1 bg-slate-100 p-1 rounded-xl">
          {(['ALL', 'QUOTE', 'INVOICE', 'RECEIPT'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => onSalesTabChange(tab)}
              className={`px-2.5 py-1.5 sm:py-1 rounded-lg text-xs font-semibold text-center transition ${
                salesTab === tab ? 'bg-surface text-accent shadow-xs' : 'text-muted'
              }`}
            >
              {tab === 'ALL' ? 'All' : tab + 'S'}
            </button>
          ))}
        </div>
      </div>

      {/* MOBILE CARD LIST */}
      <div className="md:hidden divide-y divide-slate-100">
        {visibleDocs.map(item => {
          const remaining = invoiceBalance(item);
          return (
            <div key={item.id} className="py-3.5 first:pt-1 last:pb-1 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-slate-900 truncate">
                    {item.customer_name}
                  </div>
                  {item.description && (
                    <div className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                      {item.description}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={`text-sm font-bold tabular-money ${
                      item.status === 'VOID' ? 'text-slate-400 line-through' : 'text-slate-900'
                    }`}
                  >
                    {currency} {Number(item.amount).toLocaleString()}
                  </div>
                  <span
                    className={`inline-block mt-0.5 px-2 py-0.5 text-[11px] font-semibold rounded-full ${statusBadgeClass(
                      item.status
                    )}`}
                  >
                    {item.status}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span className="font-mono font-semibold text-slate-700">{item.doc_number}</span>
                <span>{item.issue_date}</span>
                {item.chain_code && (
                  <span className="inline-flex items-center gap-0.5 font-mono text-blue-600">
                    <Link2 className="w-3 h-3" />#{item.chain_code}
                  </span>
                )}
                {item.doc_type === 'INVOICE' && item.status === 'PARTIAL' && (
                  <span className="font-semibold text-amber-600 tabular-money">
                    Bal: {currency} {remaining.toLocaleString()}
                  </span>
                )}
                {item.payment_ref && (
                  <span className="font-mono text-emerald-600">
                    {item.payment_method}: {item.payment_ref}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {item.doc_type === 'QUOTE' && item.status === 'ACTIVE' && (
                    <>
                      <button
                        type="button"
                        disabled={subscriptionLocked}
                        onClick={() => onConvertToInvoice(item)}
                        className="min-h-[36px] px-2.5 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-xl text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        Invoice <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={subscriptionLocked}
                        onClick={() => onDeleteQuote(item)}
                        title="Delete Quotation"
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center bg-rose-50 text-rose-600 rounded-xl disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  {item.doc_type === 'INVOICE' &&
                    (item.status === 'UNPAID' || item.status === 'PARTIAL') && (
                      <>
                        <button
                          type="button"
                          disabled={subscriptionLocked}
                          onClick={() => onOpenReceipt(item)}
                          className="min-h-[36px] px-2.5 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Receipt
                        </button>
                        {item.status === 'UNPAID' && (
                          <button
                            type="button"
                            disabled={subscriptionLocked}
                            onClick={() => onVoidInvoice(item)}
                            title="Void Invoice"
                            className="min-h-[36px] min-w-[36px] flex items-center justify-center bg-rose-50 text-rose-600 rounded-xl disabled:opacity-50"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    )}
                  {item.doc_type === 'RECEIPT' && item.status !== 'VOID' && onVoidReceipt && (
                    <button
                      type="button"
                      disabled={subscriptionLocked}
                      onClick={() => onVoidReceipt(item)}
                      className="min-h-[36px] px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-50 text-rose-700 disabled:opacity-40"
                    >
                      Void
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onPreviewPdf(item)}
                    aria-label="Preview PDF"
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center bg-slate-100 text-blue-600 rounded-xl"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDownloadPdf(item)}
                    aria-label="Download PDF"
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center bg-slate-100 text-slate-700 rounded-xl"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSharePdf(item)}
                    aria-label="Share PDF"
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center bg-blue-600 text-white rounded-xl"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* DESKTOP TABLE */}
      <div className="hidden md:block overflow-x-auto">
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
            {visibleDocs.map(item => {
              const remaining = invoiceBalance(item);
              return (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="py-3 px-2 whitespace-nowrap">
                    <div className="font-mono text-xs font-bold text-slate-900">{item.doc_number}</div>
                    <div className="text-xs text-slate-400">{item.issue_date}</div>
                  </td>
                  <td className="py-3 px-2 text-xs font-mono text-blue-600 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <Link2 className="w-3 h-3" />#{item.chain_code}
                    </div>
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
                      className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusBadgeClass(
                        item.status
                      )}`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-right whitespace-nowrap">
                    <div
                      className={`font-bold tabular-money ${
                        item.status === 'VOID' ? 'text-slate-400 line-through' : 'text-slate-900'
                      }`}
                    >
                      {Number(item.amount).toLocaleString()}
                    </div>
                    {item.doc_type === 'INVOICE' && item.status === 'PARTIAL' && (
                      <div className="text-[11px] text-amber-600">
                        Bal: {remaining.toLocaleString()}
                      </div>
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
                      {item.doc_type === 'INVOICE' &&
                        (item.status === 'UNPAID' || item.status === 'PARTIAL') && (
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
                      {item.doc_type === 'RECEIPT' && item.status !== 'VOID' && onVoidReceipt && (
                        <button
                          type="button"
                          disabled={subscriptionLocked}
                          onClick={() => onVoidReceipt(item)}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 disabled:opacity-40"
                          title="Void receipt with audit trail"
                        >
                          Void
                        </button>
                      )}
                      <button
                        onClick={() => onPreviewPdf(item)}
                        title="Preview"
                        className="p-1.5 bg-slate-100 hover:bg-slate-200 text-blue-600 rounded-lg"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onDownloadPdf(item)}
                        title="Download"
                        className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onSharePdf(item)}
                        title="Share PDF"
                        className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                      >
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
          className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700"
        >
          Show more ({docs.length - docLimit} remaining)
        </button>
      )}
    </div>
  );
}