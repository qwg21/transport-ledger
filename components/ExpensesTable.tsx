'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Expense } from '@/lib/types';
import { Eye } from 'lucide-react';

export type ExpenseWithReceipt = Expense & { receipt_url?: string | null };

type Props = {
  expenses: ExpenseWithReceipt[];
  currency: string;
  expenseLimit: number;
  onShowMore: () => void;
};

export default function ExpensesTable({
  expenses,
  currency,
  expenseLimit,
  onShowMore
}: Props) {
  const [openingId, setOpeningId] = useState<string | null>(null);

  const handleViewReceipt = async (exp: ExpenseWithReceipt) => {
    if (!exp.receipt_url) return;

    if (exp.receipt_url.startsWith('http')) {
      window.open(exp.receipt_url, '_blank', 'noopener,noreferrer');
      return;
    }

    setOpeningId(exp.id);
    try {
      const { data, error } = await supabase.storage
        .from('expense-receipts')
        .createSignedUrl(exp.receipt_url, 60);

      if (error || !data?.signedUrl) {
        alert(`Could not open receipt: ${error?.message ?? 'missing signed URL'}`);
        return;
      }

      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setOpeningId(null);
    }
  };

  const visibleExpenses = expenses.slice(0, expenseLimit);

  return (
    <div className="bg-surface border border-surface-border rounded-2xl p-4 sm:p-5 space-y-3">
      <h3 className="font-bold text-ink">Operating Expenses ({expenses.length})</h3>

      {/* MOBILE CARD LIST */}
      <div className="md:hidden divide-y divide-slate-100">
        {visibleExpenses.map(exp => (
          <div key={exp.id} className="py-3.5 first:pt-1 last:pb-1 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-sm text-slate-900 truncate">
                  {exp.vendor || 'Supplier'}
                </div>
                {exp.notes && (
                  <div className="text-xs text-slate-500 line-clamp-2 mt-0.5">
                    {exp.notes}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-bold text-rose-600 tabular-money">
                  -{currency} {Number(exp.amount_kes).toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">{exp.expense_date}</div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="px-2 py-0.5 text-[11px] font-medium rounded-lg bg-rose-50 text-rose-700 truncate max-w-[70%]">
                {exp.category}
              </span>
              {exp.receipt_url ? (
                <button
                  type="button"
                  disabled={openingId === exp.id}
                  onClick={() => handleViewReceipt(exp)}
                  className="min-h-[32px] px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {openingId === exp.id ? 'Opening...' : 'Receipt'}
                </button>
              ) : (
                <span className="text-[11px] text-slate-400">No receipt</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* DESKTOP TABLE */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-2">Date</th>
              <th className="py-2.5 px-2">Category</th>
              <th className="py-2.5 px-2">Vendor / Notes</th>
              <th className="py-2.5 px-2">Receipt</th>
              <th className="py-2.5 px-2 text-right">Amount ({currency})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleExpenses.map(exp => (
              <tr key={exp.id} className="hover:bg-slate-50">
                <td className="py-2.5 px-2 text-xs text-slate-500 whitespace-nowrap">
                  {exp.expense_date}
                </td>
                <td className="py-2.5 px-2">
                  <span className="px-2 py-0.5 text-xs font-medium rounded-lg bg-rose-50 text-rose-700">
                    {exp.category}
                  </span>
                </td>
                <td className="py-2.5 px-2 text-xs text-slate-600">
                  {exp.vendor}
                  {exp.notes ? ` — ${exp.notes}` : ''}
                </td>
                <td className="py-2.5 px-2 text-xs">
                  {exp.receipt_url ? (
                    <button
                      type="button"
                      disabled={openingId === exp.id}
                      onClick={() => handleViewReceipt(exp)}
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium disabled:opacity-50"
                    >
                      <Eye className="w-3.5 h-3.5" /> {openingId === exp.id ? 'Opening...' : 'View'}
                    </button>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="py-2.5 px-2 text-right font-bold text-rose-600 tabular-money">
                  -{Number(exp.amount_kes).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {expenses.length > expenseLimit && (
        <button
          onClick={onShowMore}
          className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700"
        >
          Show more ({expenses.length - expenseLimit} remaining)
        </button>
      )}
    </div>
  );
}