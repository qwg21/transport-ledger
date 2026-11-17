'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { invoiceBalance, todayLocal } from '@/lib/documents';
import type { Customer, DocumentRecord } from '@/lib/types';
import type { ExpenseWithReceipt } from '@/components/ExpensesTable';
import { BarChart3, Target, AlertTriangle, Calculator } from 'lucide-react';

type MonthlyTarget = {
  id: string;
  org_id: string;
  month_key: string;
  target_revenue: number;
  max_budget: number;
};

type TaxProfile = {
  id: string;
  org_id: string;
  tax_regime: 'NONE' | 'TURNOVER_TAX' | 'VAT';
  rate_percent: number;
  effective_from: string;
  notes?: string | null;
};

type Props = {
  orgId: string;
  currency: string;
  docs: DocumentRecord[];
  expenses: ExpenseWithReceipt[];
  customers: Customer[];
  subscriptionLocked: boolean;
};

export default function IntelligenceSection({
  orgId,
  currency,
  docs,
  expenses,
  customers,
  subscriptionLocked
}: Props) {
  const currentMonthKey = todayLocal().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [targets, setTargets] = useState<MonthlyTarget[]>([]);
  const [taxProfiles, setTaxProfiles] = useState<TaxProfile[]>([]);

  const [targetRevenueInput, setTargetRevenueInput] = useState('');
  const [maxBudgetInput, setMaxBudgetInput] = useState('');
  const [savingTarget, setSavingTarget] = useState(false);

  const [taxRegime, setTaxRegime] = useState<'NONE' | 'TURNOVER_TAX' | 'VAT'>('TURNOVER_TAX');
  const [taxRateInput, setTaxRateInput] = useState('1.5');
  const [taxEffectiveFrom, setTaxEffectiveFrom] = useState(todayLocal);
  const [taxNotes, setTaxNotes] = useState('');
  const [savingTax, setSavingTax] = useState(false);

  const loadIntelligenceData = useCallback(async () => {
    const [targetRes, taxRes] = await Promise.all([
      supabase.from('monthly_targets').select('*').eq('org_id', orgId).order('month_key', { ascending: false }),
      supabase.from('tax_profiles').select('*').eq('org_id', orgId).order('effective_from', { ascending: false })
    ]);

    const loadedTargets = (targetRes.data as MonthlyTarget[] | null) ?? [];
    const loadedTaxes = (taxRes.data as TaxProfile[] | null) ?? [];

    setTargets(loadedTargets);
    setTaxProfiles(loadedTaxes);

    const activeTarget = loadedTargets.find(t => t.month_key === selectedMonth);
    setTargetRevenueInput(activeTarget ? String(activeTarget.target_revenue) : '');
    setMaxBudgetInput(activeTarget ? String(activeTarget.max_budget) : '');

    if (loadedTaxes.length > 0) {
      setTaxRegime(loadedTaxes[0].tax_regime);
      setTaxRateInput(String(loadedTaxes[0].rate_percent));
      setTaxEffectiveFrom(loadedTaxes[0].effective_from);
      setTaxNotes(loadedTaxes[0].notes || '');
    }
  }, [orgId, selectedMonth]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads targets and tax rules after awaited Supabase queries
    loadIntelligenceData();
  }, [loadIntelligenceData]);

  const handleMonthChange = (monthKey: string) => {
    setSelectedMonth(monthKey);
    const match = targets.find(t => t.month_key === monthKey);
    setTargetRevenueInput(match ? String(match.target_revenue) : '');
    setMaxBudgetInput(match ? String(match.max_budget) : '');
  };

  const handleSaveTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (subscriptionLocked) return;
    setSavingTarget(true);
    try {
      const { error } = await supabase.from('monthly_targets').upsert(
        {
          org_id: orgId,
          month_key: selectedMonth,
          target_revenue: parseFloat(targetRevenueInput) || 0,
          max_budget: parseFloat(maxBudgetInput) || 0
        },
        { onConflict: 'org_id,month_key' }
      );
      if (error) alert(error.message);
      else await loadIntelligenceData();
    } finally {
      setSavingTarget(false);
    }
  };

  const handleSaveTaxProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (subscriptionLocked) return;
    setSavingTax(true);
    try {
      const { error } = await supabase.from('tax_profiles').insert([
        {
          org_id: orgId,
          tax_regime: taxRegime,
          rate_percent: taxRegime === 'NONE' ? 0 : parseFloat(taxRateInput) || 0,
          effective_from: taxEffectiveFrom || todayLocal(),
          notes: taxNotes.trim() || null
        }
      ]);
      if (error) alert(error.message);
      else await loadIntelligenceData();
    } finally {
      setSavingTax(false);
    }
  };

  const analytics = useMemo(() => {
    const quotes = docs.filter(d => d.doc_type === 'QUOTE');
    const convertedQuotes = quotes.filter(d => d.status === 'CONVERTED');
    const conversionRate = quotes.length > 0 ? Math.round((convertedQuotes.length / quotes.length) * 100) : 0;

    const validInvoices = docs.filter(d => d.doc_type === 'INVOICE' && d.status !== 'VOID');
    const totalInvoiced = validInvoices.reduce((s, d) => s + Number(d.amount || 0), 0);
    const avgOrderValue = validInvoices.length > 0 ? Math.round(totalInvoiced / validInvoices.length) : 0;

    const receipts = docs.filter(d => d.doc_type === 'RECEIPT' && d.status !== 'VOID');
    const totalCashIn = receipts.reduce((s, d) => s + Number(d.amount || 0), 0);
    const totalExp = expenses.reduce((s, e) => s + Number(e.amount_kes || 0), 0);
    const netMarginPct = totalCashIn > 0 ? Math.round(((totalCashIn - totalExp) / totalCashIn) * 100) : 0;

    // Repeat Buyer Rate & Top Customers (LTV)
    const custCounts = new Map<string, { name: string; total: number; count: number }>();
    validInvoices.forEach(inv => {
      const key = inv.customer_id || inv.customer_name;
      const prev = custCounts.get(key) ?? { name: inv.customer_name, total: 0, count: 0 };
      custCounts.set(key, { name: prev.name, total: prev.total + Number(inv.amount || 0), count: prev.count + 1 });
    });
    const buyingCustomers = Array.from(custCounts.values());
    const repeatBuyers = buyingCustomers.filter(c => c.count >= 2).length;
    const repeatRate = buyingCustomers.length > 0 ? Math.round((repeatBuyers / buyingCustomers.length) * 100) : 0;
    const topCustomers = buyingCustomers.sort((a, b) => b.total - a.total).slice(0, 5);

    // Top Products from document_items on valid invoices
    const prodMap = new Map<string, { name: string; qty: number; revenue: number }>();
    validInvoices.forEach(inv => {
      (inv.document_items || []).forEach(li => {
        const key = (li.description || 'Item').trim();
        const prev = prodMap.get(key) ?? { name: key, qty: 0, revenue: 0 };
        prodMap.set(key, {
          name: key,
          qty: prev.qty + Number(li.quantity || 0),
          revenue: prev.revenue + Number(li.line_total || 0)
        });
      });
    });
    const topProducts = Array.from(prodMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    // A/R Aging Buckets
    const todayMs = new Date(todayLocal()).getTime();
    const aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    validInvoices.forEach(inv => {
      const bal = invoiceBalance(inv);
      if (bal <= 0) return;
      const ageDays = Math.max(0, Math.floor((todayMs - new Date(inv.issue_date).getTime()) / 86400000));
      if (ageDays <= 30) aging.d0_30 += bal;
      else if (ageDays <= 60) aging.d31_60 += bal;
      else if (ageDays <= 90) aging.d61_90 += bal;
      else aging.d90_plus += bal;
    });

    // Selected Month Actuals
    const monthCash = receipts
      .filter(r => r.issue_date.startsWith(selectedMonth))
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    const monthExp = expenses
      .filter(e => e.expense_date.startsWith(selectedMonth))
      .reduce((s, e) => s + Number(e.amount_kes || 0), 0);

    // Last 6 Months Cash Flow Trend
    const monthsSet = new Set<string>();
    receipts.forEach(r => monthsSet.add(r.issue_date.slice(0, 7)));
    expenses.forEach(e => monthsSet.add(e.expense_date.slice(0, 7)));
    const trendMonths = Array.from(monthsSet).sort().slice(-6);
    const trend = trendMonths.map(m => {
      const rev = receipts.filter(r => r.issue_date.startsWith(m)).reduce((s, r) => s + Number(r.amount || 0), 0);
      const exp = expenses.filter(e => e.expense_date.startsWith(m)).reduce((s, e) => s + Number(e.amount_kes || 0), 0);
      return { month: m, rev, exp };
    });
    const maxTrendVal = Math.max(1, ...trend.flatMap(t => [t.rev, t.exp]));

    // Expense Category Breakdown
    const catMap = new Map<string, number>();
    expenses.forEach(e => {
      catMap.set(e.category, (catMap.get(e.category) ?? 0) + Number(e.amount_kes || 0));
    });
    const topCategories = Array.from(catMap.entries())
      .map(([category, amount]) => ({
        category,
        amount,
        pct: totalExp > 0 ? Math.round((amount / totalExp) * 100) : 0
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Tax Estimate using latest effective Tax Profile
    const latestTax = taxProfiles[0] ?? null;
    const taxableReceipts = latestTax
      ? receipts
          .filter(r => r.issue_date >= latestTax.effective_from)
          .reduce((s, r) => s + Number(r.amount || 0), 0)
      : 0;
    const estimatedTax = latestTax ? Math.round(taxableReceipts * (Number(latestTax.rate_percent) / 100)) : 0;

    return {
      conversionRate,
      avgOrderValue,
      repeatRate,
      netMarginPct,
      topCustomers,
      topProducts,
      aging,
      monthCash,
      monthExp,
      trend,
      maxTrendVal,
      topCategories,
      latestTax,
      taxableReceipts,
      estimatedTax
    };
  }, [docs, expenses, selectedMonth, taxProfiles]);

  const savedTarget = targets.find(t => t.month_key === selectedMonth);
  const revTargetNum = savedTarget?.target_revenue ?? (parseFloat(targetRevenueInput) || 0);
  const budgetNum = savedTarget?.max_budget ?? (parseFloat(maxBudgetInput) || 0);
  const revPct = revTargetNum > 0 ? Math.min(100, Math.round((analytics.monthCash / revTargetNum) * 100)) : 0;
  const expPct = budgetNum > 0 ? Math.min(100, Math.round((analytics.monthExp / budgetNum) * 100)) : 0;
  const overBudget = budgetNum > 0 && analytics.monthExp > budgetNum;

  return (
    <div className="space-y-6">
      {/* 1. BI KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 p-5 rounded-2xl">
          <div className="text-xs font-semibold text-slate-500 uppercase">Quote Win Rate</div>
          <div className="text-2xl font-bold text-blue-600 mt-1">{analytics.conversionRate}%</div>
          <div className="text-xs text-slate-400 mt-1">Quotes converted to invoices</div>
        </div>
        <div className="bg-white border border-slate-200 p-5 rounded-2xl">
          <div className="text-xs font-semibold text-slate-500 uppercase">Avg Order Value (AOV)</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{currency} {analytics.avgOrderValue.toLocaleString()}</div>
          <div className="text-xs text-slate-400 mt-1">Average per non-void invoice</div>
        </div>
        <div className="bg-white border border-slate-200 p-5 rounded-2xl">
          <div className="text-xs font-semibold text-slate-500 uppercase">Repeat Customer Rate</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{analytics.repeatRate}%</div>
          <div className="text-xs text-slate-400 mt-1">{customers.length} saved customers</div>
        </div>
        <div className="bg-white border border-slate-200 p-5 rounded-2xl">
          <div className="text-xs font-semibold text-slate-500 uppercase">Net Cash Margin</div>
          <div className={`text-2xl font-bold mt-1 ${analytics.netMarginPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {analytics.netMarginPct}%
          </div>
          <div className="text-xs text-slate-400 mt-1">Receipts minus expenses</div>
        </div>
      </div>

      {/* 2. Monthly Targets (Actual vs Target) + 6-Month Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-slate-800">
              <Target className="w-4 h-4 text-blue-600" /> Monthly Targets ({selectedMonth})
            </div>
            <input
              type="month"
              value={selectedMonth}
              onChange={e => handleMonthChange(e.target.value)}
              className="border border-slate-200 rounded-xl px-2.5 py-1 text-xs bg-slate-50"
            />
          </div>

          <form onSubmit={handleSaveTarget} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="number"
              min="0"
              placeholder={`Revenue Target (${currency})`}
              value={targetRevenueInput}
              onChange={e => setTargetRevenueInput(e.target.value)}
              className="border border-slate-300 rounded-xl p-2 text-xs"
            />
            <input
              type="number"
              min="0"
              placeholder={`Max Budget (${currency})`}
              value={maxBudgetInput}
              onChange={e => setMaxBudgetInput(e.target.value)}
              className="border border-slate-300 rounded-xl p-2 text-xs"
            />
            <button
              type="submit"
              disabled={subscriptionLocked || savingTarget}
              className="py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold disabled:opacity-50"
            >
              {savingTarget ? 'Saving...' : 'Save Target'}
            </button>
          </form>

          <div className="space-y-3 pt-1">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-slate-600">Cash Collected vs. Target</span>
                <span className="font-bold text-slate-900">
                  {currency} {analytics.monthCash.toLocaleString()} / {revTargetNum.toLocaleString()} ({revPct}%)
                </span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${revPct}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-slate-600">Expenses vs. Max Budget</span>
                <span className={`font-bold ${overBudget ? 'text-rose-600' : 'text-slate-900'}`}>
                  {currency} {analytics.monthExp.toLocaleString()} / {budgetNum.toLocaleString()} ({expPct}%)
                </span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${overBudget ? 'bg-rose-600' : 'bg-amber-500'}`}
                  style={{ width: `${expPct}%` }}
                />
              </div>
              {overBudget && (
                <div className="flex items-center gap-1.5 text-xs text-rose-600 font-medium mt-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> Over monthly expense budget by {currency} {(analytics.monthExp - budgetNum).toLocaleString()}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 6-Month Cash Flow Trend */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <BarChart3 className="w-4 h-4 text-blue-600" /> Monthly Cash In vs. Expenses
          </div>
          {analytics.trend.length === 0 ? (
            <p className="text-xs text-slate-400">No monthly data yet.</p>
          ) : (
            <div className="space-y-2.5">
              {analytics.trend.map(row => (
                <div key={row.month} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-mono font-semibold text-slate-700">{row.month}</span>
                    <span className="text-slate-500">
                      In: <strong className="text-emerald-600">{row.rev.toLocaleString()}</strong> | Out:{' '}
                      <strong className="text-rose-600">{row.exp.toLocaleString()}</strong>
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="h-1.5 bg-emerald-500 rounded-full" style={{ width: `${Math.round((row.rev / analytics.maxTrendVal) * 100)}%` }} />
                    <div className="h-1.5 bg-rose-400 rounded-full" style={{ width: `${Math.round((row.exp / analytics.maxTrendVal) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. A/R Aging + Expense Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <h3 className="font-bold text-slate-800 text-sm">Accounts Receivable Aging</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[11px] text-slate-500 font-semibold">0–30 Days</div>
              <div className="text-sm font-bold text-slate-900 mt-1">{currency} {analytics.aging.d0_30.toLocaleString()}</div>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
              <div className="text-[11px] text-amber-700 font-semibold">31–60 Days</div>
              <div className="text-sm font-bold text-amber-800 mt-1">{currency} {analytics.aging.d31_60.toLocaleString()}</div>
            </div>
            <div className="p-3 rounded-xl bg-orange-50 border border-orange-200">
              <div className="text-[11px] text-orange-700 font-semibold">61–90 Days</div>
              <div className="text-sm font-bold text-orange-800 mt-1">{currency} {analytics.aging.d61_90.toLocaleString()}</div>
            </div>
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
              <div className="text-[11px] text-rose-700 font-semibold">90+ Days</div>
              <div className="text-sm font-bold text-rose-800 mt-1">{currency} {analytics.aging.d90_plus.toLocaleString()}</div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <h3 className="font-bold text-slate-800 text-sm">Top Expense Categories</h3>
          <div className="space-y-2">
            {analytics.topCategories.map(cat => (
              <div key={cat.category} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-700 font-medium truncate">{cat.category}</span>
                  <span className="font-bold text-slate-900 whitespace-nowrap">{currency} {cat.amount.toLocaleString()} ({cat.pct}%)</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-rose-500 rounded-full" style={{ width: `${cat.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Top Products & Top Customers (LTV) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <h3 className="font-bold text-slate-800 text-sm">Top Products / Services by Revenue</h3>
          <div className="divide-y divide-slate-100 text-xs">
            {analytics.topProducts.map(prod => (
              <div key={prod.name} className="py-2 flex justify-between items-center">
                <div>
                  <div className="font-semibold text-slate-900">{prod.name}</div>
                  <div className="text-slate-400">{prod.qty} units billed</div>
                </div>
                <div className="font-bold text-slate-900">{currency} {prod.revenue.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <h3 className="font-bold text-slate-800 text-sm">Top Customers (Lifetime Billed)</h3>
          <div className="divide-y divide-slate-100 text-xs">
            {analytics.topCustomers.map(cust => (
              <div key={cust.name} className="py-2 flex justify-between items-center">
                <div>
                  <div className="font-semibold text-slate-900">{cust.name}</div>
                  <div className="text-slate-400">{cust.count} invoice(s)</div>
                </div>
                <div className="font-bold text-emerald-600">{currency} {cust.total.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5. Configurable Tax Profile */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 font-bold text-slate-800">
          <Calculator className="w-4 h-4 text-blue-600" /> Configurable Tax Profile (Estimate)
        </div>
        <form onSubmit={handleSaveTaxProfile} className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          <select
            value={taxRegime}
            onChange={e => setTaxRegime(e.target.value as TaxProfile['tax_regime'])}
            className="border border-slate-300 rounded-xl p-2 text-xs"
          >
            <option value="NONE">Exempt / None</option>
            <option value="TURNOVER_TAX">Turnover Tax (TOT)</option>
            <option value="VAT">VAT</option>
          </select>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            disabled={taxRegime === 'NONE'}
            placeholder="Rate %"
            value={taxRegime === 'NONE' ? '0' : taxRateInput}
            onChange={e => setTaxRateInput(e.target.value)}
            className="border border-slate-300 rounded-xl p-2 text-xs disabled:bg-slate-100"
          />
          <input
            type="date"
            value={taxEffectiveFrom}
            onChange={e => setTaxEffectiveFrom(e.target.value)}
            className="border border-slate-300 rounded-xl p-2 text-xs"
          />
          <input
            type="text"
            placeholder="Notes (e.g. KRA TOT 2026)"
            value={taxNotes}
            onChange={e => setTaxNotes(e.target.value)}
            className="border border-slate-300 rounded-xl p-2 text-xs"
          />
          <button
            type="submit"
            disabled={subscriptionLocked || savingTax}
            className="py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold disabled:opacity-50"
          >
            {savingTax ? 'Saving...' : 'Save Rule'}
          </button>
        </form>

        {analytics.latestTax && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs">
            <div>
              Active Rule: <strong>{analytics.latestTax.tax_regime}</strong> at <strong>{analytics.latestTax.rate_percent}%</strong> (effective {analytics.latestTax.effective_from}).
              Eligible receipts since then: <strong>{currency} {analytics.taxableReceipts.toLocaleString()}</strong>.
            </div>
            <div className="font-bold text-blue-700 whitespace-nowrap">
              Est. Tax Provision: {currency} {analytics.estimatedTax.toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}