'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { todayLocal } from '@/lib/documents';
import { Scale, TrendingUp, Landmark, CheckCircle2, AlertTriangle } from 'lucide-react';

interface AccountRow {
  id: string;
  code: string;
  name: string;
  account_type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  normal_balance: 'DEBIT' | 'CREDIT';
}

interface JournalEntryRow {
  id: string;
  entry_date: string;
  status: 'DRAFT' | 'POSTED' | 'REVERSED';
}

interface JournalLineRow {
  entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
}

type ReportTab = 'PNL' | 'BALANCE_SHEET' | 'TRIAL_BALANCE';

type Props = {
  orgId: string;
  currency: string;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function ReportsSection({ orgId, currency }: Props) {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [entries, setEntries] = useState<JournalEntryRow[]>([]);
  const [lines, setLines] = useState<JournalLineRow[]>([]);
  const [tab, setTab] = useState<ReportTab>('PNL');
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState(todayLocal);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const [coaRes, jeRes, jlRes] = await Promise.all([
        supabase
          .from('chart_of_accounts')
          .select('id, code, name, account_type, normal_balance')
          .eq('org_id', orgId)
          .order('code'),
        supabase
          .from('journal_entries')
          .select('id, entry_date, status')
          .eq('org_id', orgId)
          .in('status', ['POSTED', 'REVERSED']),
        supabase
          .from('journal_lines')
          .select('entry_id, account_id, debit, credit')
          .eq('org_id', orgId)
      ]);
      if (!active) return;
      if (!coaRes.error) setAccounts((coaRes.data as AccountRow[] | null) ?? []);
      if (!jeRes.error) setEntries((jeRes.data as JournalEntryRow[] | null) ?? []);
      if (!jlRes.error) setLines((jlRes.data as JournalLineRow[] | null) ?? []);
      setLoadedAt(new Date().toLocaleTimeString());
    }
    load();
    return () => {
      active = false;
    };
  }, [orgId]);

  const entryDateMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) map.set(e.id, e.entry_date);
    return map;
  }, [entries]);

  // Period totals (startDate..endDate) for P&L and Trial Balance
  // Cumulative totals (<= endDate) for Balance Sheet
  const computed = useMemo(() => {
    const periodDr: Record<string, number> = {};
    const periodCr: Record<string, number> = {};
    const asOfDr: Record<string, number> = {};
    const asOfCr: Record<string, number> = {};

    for (const l of lines) {
      const d = entryDateMap.get(l.entry_id);
      if (!d) continue;
      if (d <= endDate) {
        asOfDr[l.account_id] = (asOfDr[l.account_id] || 0) + Number(l.debit);
        asOfCr[l.account_id] = (asOfCr[l.account_id] || 0) + Number(l.credit);
        if (d >= startDate) {
          periodDr[l.account_id] = (periodDr[l.account_id] || 0) + Number(l.debit);
          periodCr[l.account_id] = (periodCr[l.account_id] || 0) + Number(l.credit);
        }
      }
    }

    const trialRows = accounts
      .map(a => {
        const dr = round2(periodDr[a.id] || 0);
        const cr = round2(periodCr[a.id] || 0);
        const asOfNet =
          a.normal_balance === 'DEBIT'
            ? round2((asOfDr[a.id] || 0) - (asOfCr[a.id] || 0))
            : round2((asOfCr[a.id] || 0) - (asOfDr[a.id] || 0));
        const periodNet =
          a.normal_balance === 'DEBIT' ? round2(dr - cr) : round2(cr - dr);
        return { ...a, dr, cr, periodNet, asOfNet };
      })
      .filter(r => r.dr !== 0 || r.cr !== 0 || r.asOfNet !== 0);

    const totalDr = round2(trialRows.reduce((s, r) => s + r.dr, 0));
    const totalCr = round2(trialRows.reduce((s, r) => s + r.cr, 0));

    const revenueRows = trialRows.filter(r => r.account_type === 'REVENUE');
    const cogsRows = trialRows.filter(r => r.account_type === 'EXPENSE' && r.code.startsWith('5'));
    const opexRows = trialRows.filter(r => r.account_type === 'EXPENSE' && !r.code.startsWith('5'));

    const netRevenue = round2(
      revenueRows.reduce((s, r) => s + (r.normal_balance === 'CREDIT' ? r.periodNet : -r.periodNet), 0)
    );
    const totalCogs = round2(
      cogsRows.reduce((s, r) => s + (r.normal_balance === 'DEBIT' ? r.periodNet : -r.periodNet), 0)
    );
    const grossProfit = round2(netRevenue - totalCogs);
    const totalOpex = round2(opexRows.reduce((s, r) => s + r.periodNet, 0));
    const netProfit = round2(grossProfit - totalOpex);

    // Cumulative net profit up to endDate for Balance Sheet equity reconciliation
    const cumRevenue = round2(
      trialRows
        .filter(r => r.account_type === 'REVENUE')
        .reduce((s, r) => s + (r.normal_balance === 'CREDIT' ? r.asOfNet : -r.asOfNet), 0)
    );
    const cumExpense = round2(
      trialRows
        .filter(r => r.account_type === 'EXPENSE')
        .reduce((s, r) => s + (r.normal_balance === 'DEBIT' ? r.asOfNet : -r.asOfNet), 0)
    );
    const cumNetProfit = round2(cumRevenue - cumExpense);

    const assetRows = trialRows.filter(r => r.account_type === 'ASSET');
    const liabilityRows = trialRows.filter(r => r.account_type === 'LIABILITY');
    const equityRows = trialRows.filter(r => r.account_type === 'EQUITY');

    const totalAssets = round2(assetRows.reduce((s, r) => s + r.asOfNet, 0));
    const totalLiabilities = round2(liabilityRows.reduce((s, r) => s + r.asOfNet, 0));
    const totalEquity = round2(equityRows.reduce((s, r) => s + r.asOfNet, 0) + cumNetProfit);

    return {
      trialRows,
      totalDr,
      totalCr,
      isBalanced: totalDr === totalCr,
      revenueRows,
      cogsRows,
      opexRows,
      netRevenue,
      totalCogs,
      grossProfit,
      totalOpex,
      netProfit,
      assetRows,
      liabilityRows,
      equityRows,
      cumNetProfit,
      totalAssets,
      totalLiabilities,
      totalEquity,
      bsBalanced: totalAssets === round2(totalLiabilities + totalEquity)
    };
  }, [accounts, lines, entryDateMap, startDate, endDate]);

  return (
    <div className="space-y-5">
      {/* Controls & Integrity Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'PNL', label: 'Income Statement (P&L)', icon: TrendingUp },
              { id: 'BALANCE_SHEET', label: 'Balance Sheet', icon: Landmark },
              { id: 'TRIAL_BALANCE', label: 'Trial Balance', icon: Scale }
            ] as const
          ).map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
                  tab === item.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="border border-slate-300 rounded-xl px-2.5 py-1.5"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="border border-slate-300 rounded-xl px-2.5 py-1.5"
          />
          {computed.isBalanced ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" /> Ledger Balanced
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 font-semibold">
              <AlertTriangle className="w-3.5 h-3.5" /> Out of Balance
            </span>
          )}
        </div>
      </div>

      {/* P&L */}
      {tab === 'PNL' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Income Statement (General Ledger)</h3>
              <p className="text-xs text-slate-500">
                Period: {startDate} to {endDate} &middot; Derived from posted double-entry journals
              </p>
            </div>
            {loadedAt && <span className="text-[11px] text-slate-400">Refreshed {loadedAt}</span>}
          </div>

          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-bold uppercase text-slate-500 mb-2">Revenue</p>
              {computed.revenueRows.map(r => (
                <div key={r.id} className="flex justify-between py-1 border-b border-slate-50">
                  <span>{r.code} &middot; {r.name}</span>
                  <span className="font-mono">
                    {currency} {(r.normal_balance === 'CREDIT' ? r.periodNet : -r.periodNet).toLocaleString()}
                  </span>
                </div>
              ))}
              <div className="flex justify-between pt-2 font-bold">
                <span>Net Revenue</span>
                <span>{currency} {computed.netRevenue.toLocaleString()}</span>
              </div>
            </div>

            {computed.cogsRows.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase text-slate-500 mb-2">Cost of Goods Sold &amp; Inventory</p>
                {computed.cogsRows.map(r => (
                  <div key={r.id} className="flex justify-between py-1 border-b border-slate-50">
                    <span>{r.code} &middot; {r.name}</span>
                    <span className="font-mono">
                      {currency} {(r.normal_balance === 'DEBIT' ? r.periodNet : -r.periodNet).toLocaleString()}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 font-bold text-blue-700">
                  <span>Gross Profit</span>
                  <span>{currency} {computed.grossProfit.toLocaleString()}</span>
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-bold uppercase text-slate-500 mb-2">Operating Expenses</p>
              {computed.opexRows.map(r => (
                <div key={r.id} className="flex justify-between py-1 border-b border-slate-50">
                  <span>{r.code} &middot; {r.name}</span>
                  <span className="font-mono">{currency} {r.periodNet.toLocaleString()}</span>
                </div>
              ))}
              <div className="flex justify-between pt-2 font-bold">
                <span>Total Operating Expenses</span>
                <span>{currency} {computed.totalOpex.toLocaleString()}</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 text-white flex justify-between items-center font-bold">
              <span>Net Profit / (Loss)</span>
              <span className={computed.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {currency} {computed.netProfit.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* BALANCE SHEET */}
      {tab === 'BALANCE_SHEET' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Balance Sheet</h3>
              <p className="text-xs text-slate-500">As of {endDate} &middot; Accounting equation check: {computed.bsBalanced ? 'Balanced' : 'Check entries'}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase text-slate-500">Assets</p>
              {computed.assetRows.map(r => (
                <div key={r.id} className="flex justify-between py-1 border-b border-slate-50">
                  <span>{r.code} &middot; {r.name}</span>
                  <span className="font-mono">{currency} {r.asOfNet.toLocaleString()}</span>
                </div>
              ))}
              <div className="flex justify-between pt-2 font-bold text-slate-900 border-t border-slate-200">
                <span>Total Assets</span>
                <span>{currency} {computed.totalAssets.toLocaleString()}</span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase text-slate-500">Liabilities</p>
                {computed.liabilityRows.map(r => (
                  <div key={r.id} className="flex justify-between py-1 border-b border-slate-50">
                    <span>{r.code} &middot; {r.name}</span>
                    <span className="font-mono">{currency} {r.asOfNet.toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-1 font-semibold">
                  <span>Total Liabilities</span>
                  <span>{currency} {computed.totalLiabilities.toLocaleString()}</span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold uppercase text-slate-500">Equity</p>
                {computed.equityRows.map(r => (
                  <div key={r.id} className="flex justify-between py-1 border-b border-slate-50">
                    <span>{r.code} &middot; {r.name}</span>
                    <span className="font-mono">{currency} {r.asOfNet.toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span>Current &amp; Prior Net Profit / (Loss)</span>
                  <span className="font-mono">{currency} {computed.cumNetProfit.toLocaleString()}</span>
                </div>
                <div className="flex justify-between pt-2 font-bold text-slate-900 border-t border-slate-200">
                  <span>Total Liabilities + Equity</span>
                  <span>{currency} {round2(computed.totalLiabilities + computed.totalEquity).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TRIAL BALANCE */}
      {tab === 'TRIAL_BALANCE' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-900">Trial Balance ({startDate} to {endDate})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-2">Code</th>
                  <th className="py-2 px-2">Account</th>
                  <th className="py-2 px-2">Type</th>
                  <th className="py-2 px-2 text-right">Debit ({currency})</th>
                  <th className="py-2 px-2 text-right">Credit ({currency})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {computed.trialRows.map(r => (
                  <tr key={r.id}>
                    <td className="py-2 px-2 font-mono font-semibold">{r.code}</td>
                    <td className="py-2 px-2">{r.name}</td>
                    <td className="py-2 px-2 text-slate-500">{r.account_type}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.dr.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.cr.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="font-bold bg-slate-50 border-t-2 border-slate-300">
                  <td colSpan={3} className="py-2.5 px-2">Totals</td>
                  <td className="py-2.5 px-2 text-right font-mono">{computed.totalDr.toLocaleString()}</td>
                  <td className="py-2.5 px-2 text-right font-mono">{computed.totalCr.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}