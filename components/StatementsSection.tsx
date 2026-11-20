'use client';

import React, { useMemo, useState } from 'react';
import { Download, Eye, FileSpreadsheet, FileText, Share2 } from 'lucide-react';
import type { Customer, DocumentRecord, Organization } from '@/lib/types';
import {
  buildCustomerStatement,
  buildStatementClients,
  resolveStatementPeriod,
  type StatementPeriodPreset
} from '@/lib/statements';
import { buildStatementPdf } from '@/lib/statementPdf';

interface StatementsSectionProps {
  customers: Customer[];
  documents: DocumentRecord[];
  org: Organization;
}

const fmtCurrency = (currency: string, value: number) =>
  `${currency} ${value.toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const safeCsvCell = (val: string | number) => {
  const s = String(val ?? '');
  const defused = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${defused.replace(/"/g, '""')}"`;
};

export default function StatementsSection({
  customers,
  documents,
  org
}: StatementsSectionProps) {
  const currency = org.currency || 'KES';
  const todayIso = new Date().toISOString().slice(0, 10);
  const initialRange = useMemo(() => resolveStatementPeriod('THIS_YEAR', todayIso), [todayIso]);

  const clients = useMemo(
    () => buildStatementClients(customers, documents),
    [customers, documents]
  );

  const [selectedClientKey, setSelectedClientKey] = useState<string>('');
  const [period, setPeriod] = useState<StatementPeriodPreset>('THIS_YEAR');
  const [fromDate, setFromDate] = useState<string>(initialRange.fromDate);
  const [toDate, setToDate] = useState<string>(initialRange.toDate);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const selectedClient = useMemo(
    () => clients.find((c) => c.key === selectedClientKey) || null,
    [clients, selectedClientKey]
  );

  const statement = useMemo(() => {
    if (!selectedClient) return null;
    return buildCustomerStatement(selectedClient, documents, fromDate, toDate);
  }, [selectedClient, documents, fromDate, toDate]);

  const handlePeriodChange = (next: StatementPeriodPreset) => {
    setPeriod(next);
    if (next !== 'CUSTOM') {
      const range = resolveStatementPeriod(next, todayIso);
      setFromDate(range.fromDate);
      setToDate(range.toDate);
    }
  };

  const getPdfFilename = () => {
    if (!statement) return 'statement.pdf';
    const slug = statement.client.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `statement-${slug}-${statement.fromDate}-to-${statement.toDate}.pdf`;
  };

  const handlePreviewPdf = () => {
    if (!statement) return;
    const pdf = buildStatementPdf(statement, org);
    const blobUrl = pdf.output('bloburl');
    window.open(String(blobUrl), '_blank', 'noopener,noreferrer');
  };

  const handleDownloadPdf = () => {
    if (!statement) return;
    const pdf = buildStatementPdf(statement, org);
    pdf.save(getPdfFilename());
  };

  const handleSharePdf = async () => {
    if (!statement) return;
    setShareNote(null);
    const pdf = buildStatementPdf(statement, org);
    const filename = getPdfFilename();
    const pdfBlob = pdf.output('blob');
    const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });
    const shareTitle = `Statement of Account — ${statement.client.name}`;
    const shareText = `Statement of Account from ${org.name} (${statement.fromDate} to ${statement.toDate}). Balance Due: ${fmtCurrency(currency, statement.closingBalance)}.`;

    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.share &&
        (!navigator.canShare || navigator.canShare({ files: [pdfFile] }))
      ) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          files: [pdfFile]
        });
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    }

    // Fallback for desktop browsers that don't support file sharing
    pdf.save(filename);
    setShareNote('PDF downloaded—attach it directly in WhatsApp or email.');
  };

  const handleExportCsv = () => {
    if (!statement) return;
    const rows: Array<Array<string | number>> = [
      ['Date', 'Type', 'Document #', 'Description', 'Reference', 'Debit', 'Credit', 'Balance'],
      [statement.fromDate, 'OPENING', '', 'Balance Brought Forward', '', '', '', statement.openingBalance],
      ...statement.entries.map((e) => [
        e.date,
        e.docType,
        e.docNumber,
        e.description,
        e.reference || '',
        e.debit || '',
        e.credit || '',
        e.runningBalance
      ]),
      [statement.toDate, 'CLOSING', '', 'Closing Balance Due', '', statement.totalInvoiced, statement.totalPaid, statement.closingBalance]
    ];
    const csv = rows.map((r) => r.map(safeCsvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `statement-${statement.client.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Header Banner Card */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-white to-emerald-50/70 p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
          <FileText className="h-4 w-4" />
          Documents
        </div>
        <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900">
          Statements of Account
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Invoices, payments, aging, and running balance per client
        </p>
      </div>

      {/* Filter Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm space-y-4">
        <div>
          <label htmlFor="statement-client" className="block text-xs font-semibold text-slate-600 mb-1.5">
            Client
          </label>
          <select
            id="statement-client"
            value={selectedClientKey}
            onChange={(e) => {
              setSelectedClientKey(e.target.value);
              setShareNote(null);
            }}
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          >
            <option value="">Choose a client...</option>
            {clients.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
                {c.balance !== 0 ? ` — ${fmtCurrency(currency, c.balance)}` : ' — Settled'}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="statement-period" className="block text-xs font-semibold text-slate-600 mb-1.5">
              Period
            </label>
            <select
              id="statement-period"
              value={period}
              onChange={(e) => handlePeriodChange(e.target.value as StatementPeriodPreset)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            >
              <option value="THIS_YEAR">This year</option>
              <option value="THIS_MONTH">This month</option>
              <option value="LAST_MONTH">Last month</option>
              <option value="THIS_QUARTER">This quarter</option>
              <option value="LAST_90_DAYS">Last 90 days</option>
              <option value="ALL_TIME">All time</option>
              <option value="CUSTOM">Custom range</option>
            </select>
          </div>

          <div>
            <label htmlFor="statement-from" className="block text-xs font-semibold text-slate-600 mb-1.5">
              From
            </label>
            <input
              id="statement-from"
              type="date"
              value={fromDate}
              onChange={(e) => {
                setPeriod('CUSTOM');
                setFromDate(e.target.value);
              }}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <div>
            <label htmlFor="statement-to" className="block text-xs font-semibold text-slate-600 mb-1.5">
              To
            </label>
            <input
              id="statement-to"
              type="date"
              value={toDate}
              onChange={(e) => {
                setPeriod('CUSTOM');
                setToDate(e.target.value);
              }}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
          </div>
        </div>
      </div>

      {/* Empty Prompt */}
      {!statement ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center">
          <p className="text-sm font-medium text-slate-700">
            Select a client above to generate their Statement of Account.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Includes opening balance, invoices, receipts, overdue aging, PDF preview/share, and CSV export.
          </p>
        </div>
      ) : (
        <>
          {/* Action Buttons (matching SalesDocumentsTable & TransportSection) */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePreviewPdf}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              <Eye className="h-4 w-4" />
              Preview PDF
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 transition"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </button>
            <button
              type="button"
              onClick={handleSharePdf}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition"
            >
              <Share2 className="h-4 w-4" />
              Share PDF
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Export CSV
            </button>
          </div>

          {shareNote && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-medium text-blue-800">
              {shareNote}
            </div>
          )}

          {/* 4-Card KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-medium text-slate-500">Opening Balance</div>
              <div className="mt-1 text-lg font-bold text-slate-900">
                {fmtCurrency(currency, statement.openingBalance)}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-medium text-slate-500">Invoiced</div>
              <div className="mt-1 text-lg font-bold text-slate-900">
                {fmtCurrency(currency, statement.totalInvoiced)}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-medium text-slate-500">Payments Received</div>
              <div className="mt-1 text-lg font-bold text-emerald-700">
                {fmtCurrency(currency, statement.totalPaid)}
              </div>
            </div>
            <div
              className={`rounded-2xl border p-4 shadow-sm ${
                statement.closingBalance > 0
                  ? 'border-amber-200 bg-amber-50/70'
                  : 'border-emerald-200 bg-emerald-50/70'
              }`}
            >
              <div className="text-xs font-medium text-slate-600">Balance Due</div>
              <div
                className={`mt-1 text-lg font-bold ${
                  statement.closingBalance > 0 ? 'text-amber-900' : 'text-emerald-800'
                }`}
              >
                {fmtCurrency(currency, statement.closingBalance)}
              </div>
            </div>
          </div>

          {/* Aging Breakdown */}
          {statement.aging.total > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                Receivables Aging (as of {statement.toDate})
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  { label: '0–30 Days', val: statement.aging.days0to30 },
                  { label: '31–60 Days', val: statement.aging.days31to60 },
                  { label: '61–90 Days', val: statement.aging.days61to90 },
                  { label: '90+ Days', val: statement.aging.over90 }
                ].map((b) => (
                  <div key={b.label} className="rounded-xl bg-slate-50 px-3 py-2.5 border border-slate-100">
                    <div className="text-[11px] font-medium text-slate-500">{b.label}</div>
                    <div className="mt-0.5 text-sm font-bold text-slate-900">
                      {fmtCurrency(currency, b.val)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Running-Balance Ledger */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Document</th>
                    <th className="px-4 py-3 font-semibold">Description</th>
                    <th className="px-4 py-3 font-semibold text-right">Debit</th>
                    <th className="px-4 py-3 font-semibold text-right">Credit</th>
                    <th className="px-4 py-3 font-semibold text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="bg-slate-50/50 text-slate-600 italic">
                    <td className="px-4 py-3">{statement.fromDate}</td>
                    <td className="px-4 py-3">—</td>
                    <td className="px-4 py-3">Balance Brought Forward</td>
                    <td className="px-4 py-3 text-right">—</td>
                    <td className="px-4 py-3 text-right">—</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {fmtCurrency(currency, statement.openingBalance)}
                    </td>
                  </tr>

                  {statement.entries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                        No invoices or payments recorded in this period.
                      </td>
                    </tr>
                  ) : (
                    statement.entries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{entry.date}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                              entry.docType === 'INVOICE'
                                ? 'bg-slate-100 text-slate-800'
                                : 'bg-emerald-50 text-emerald-700'
                            }`}
                          >
                            {entry.docNumber}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-800">
                          <div>{entry.description}</div>
                          {entry.reference && (
                            <div className="text-xs text-slate-500">{entry.reference}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-900 whitespace-nowrap">
                          {entry.debit > 0 ? fmtCurrency(currency, entry.debit) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-emerald-700 whitespace-nowrap">
                          {entry.credit > 0 ? fmtCurrency(currency, entry.credit) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900 whitespace-nowrap">
                          {fmtCurrency(currency, entry.runningBalance)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              <div className="p-4 bg-slate-50/70 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600">Opening Balance ({statement.fromDate})</span>
                <span className="font-bold text-slate-900">
                  {fmtCurrency(currency, statement.openingBalance)}
                </span>
              </div>

              {statement.entries.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No invoices or payments recorded in this period.
                </div>
              ) : (
                statement.entries.map((entry) => (
                  <div key={entry.id} className="p-4 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          entry.docType === 'INVOICE'
                            ? 'bg-slate-100 text-slate-800'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {entry.docNumber}
                      </span>
                      <span className="text-xs text-slate-500">{entry.date}</span>
                    </div>
                    <div className="text-sm font-medium text-slate-900">{entry.description}</div>
                    {entry.reference && <div className="text-xs text-slate-500">{entry.reference}</div>}
                    <div className="flex items-center justify-between pt-1 text-xs">
                      <span className={entry.credit > 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-slate-800'}>
                        {entry.debit > 0
                          ? `Invoiced: ${fmtCurrency(currency, entry.debit)}`
                          : `Paid: ${fmtCurrency(currency, entry.credit)}`}
                      </span>
                      <span className="font-bold text-slate-900">
                        Bal: {fmtCurrency(currency, entry.runningBalance)}
                      </span>
                    </div>
                  </div>
                ))
              )}

              <div className="p-4 bg-slate-100/80 flex items-center justify-between text-sm">
                <span className="font-bold text-slate-800">Closing Balance</span>
                <span className="font-bold text-slate-900">
                  {fmtCurrency(currency, statement.closingBalance)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}