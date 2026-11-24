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

  return (
      <div className="bg-surface border border-surface-border rounded-2xl p-5 space-y-3">
      <h3 className="font-bold text-ink">Operating Expenses ({expenses.length})</h3>
      <div className="overflow-x-auto">
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
            {expenses.slice(0, expenseLimit).map(exp => (
              <tr key={exp.id} className="hover:bg-slate-50">
                <td className="py-2.5 px-2 text-xs text-slate-500 whitespace-nowrap">{exp.expense_date}</td>
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
                <td className="py-2.5 px-2 text-right font-bold text-rose-600">
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
          className="w-full py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700"
        >
          Show more ({expenses.length - expenseLimit} remaining)
        </button>
      )}
    </div>
  );
}