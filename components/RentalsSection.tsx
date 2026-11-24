'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  DoorOpen,
  Download,
  Droplets,
  FileCheck2,
  FileText,
  Home,
  Landmark,
  Plus,
  Printer,
  RotateCcw,
  Share2,
  ShieldCheck,
  Users,
  Wrench,
  X
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { buildPdfDocument } from '@/lib/pdf';
import { jsPDF } from 'jspdf';
import type { DocumentRecord, Membership } from '@/lib/types';
import { ui } from '@/lib/ui';

export type RentalsTab = 'OVERVIEW' | 'PROPERTIES' | 'TENANCIES' | 'COLLECTIONS' | 'OWNERS' | 'MAINTENANCE';

export interface RentalCustomer {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
}

interface Props {
  orgId: string;
  org?: Membership | null;
  userRole?: string;
  currency?: string;
  orgName?: string;
  customers: RentalCustomer[];
  canManageOwners?: boolean;
  initialTab?: RentalsTab;
  hideInnerTabs?: boolean;
  isReadOnly?: boolean;
  onDataChanged?: () => void;
}

interface BillSummary {
  billNumber: string;
  billingPeriod: string;
  tenancyId: string;
  propertyId: string;
  dueDate: string;
  items: any[];
  totalAmount: number;
  status: 'PAID' | 'PARTIAL' | 'DUE';
}

const fmtMoney = (currency: string, n: number) =>
  `${currency} ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const genPaymentRef = () => `BL-${Math.floor(100000 + Math.random() * 900000)}`;

export default function RentalsSection({
  orgId,
  org,
  userRole = 'owner',
  currency = 'KES',
  orgName = 'Property Management',
  customers,
  canManageOwners = false,
  initialTab = 'OVERVIEW',
  hideInnerTabs = false,
  isReadOnly = false,
  onDataChanged
}: Props) {
  const [tab, setTab] = useState<RentalsTab>(initialTab);
  const [agencyMode, setAgencyMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isCaretaker = (userRole || org?.role || '').toLowerCase() === 'caretaker';
  const effectiveOrgName = org?.name || orgName;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sidebar subsection routing must select the matching rental tab
    setTab(initialTab);
  }, [initialTab]);

  // Core datasets
  const [owners, setOwners] = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [tenancies, setTenancies] = useState<any[]>([]);
  const [tenancyTerms, setTenancyTerms] = useState<any[]>([]);
  const [charges, setCharges] = useState<any[]>([]);
  const [utilityRates, setUtilityRates] = useState<any[]>([]);
  const [meterReadings, setMeterReadings] = useState<any[]>([]);
  const [collectionAccounts, setCollectionAccounts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [ownerLedger, setOwnerLedger] = useState<any[]>([]);
  const [maintenance, setMaintenance] = useState<any[]>([]);

  // Forms: Owner, Property, Utility Rates, Unit, Collection Account
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerCustomerId, setOwnerCustomerId] = useState('');
  const [propRef, setPropRef] = useState('');
  const [propName, setPropName] = useState('');
  const [propModel, setPropModel] = useState<'DIRECT_LANDLORD' | 'AGENCY_MANAGED'>('DIRECT_LANDLORD');
  const [propDueDay, setPropDueDay] = useState('5');

  const [ratePropId, setRatePropId] = useState('');
  const [waterRateInput, setWaterRateInput] = useState('150');
  const [garbageFeeInput, setGarbageFeeInput] = useState('300');

  const [sharePropId, setSharePropId] = useState('');
  const [shareOwnerId, setShareOwnerId] = useState('');
  const [sharePct, setSharePct] = useState('100');
  const [sharePrimary, setSharePrimary] = useState(true);

  const [unitPropId, setUnitPropId] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [unitCat, setUnitCat] = useState('1BR');
  const [unitRent, setUnitRent] = useState('');
  const [unitDeposit, setUnitDeposit] = useState('');

  const [acctScope, setAcctScope] = useState<'LANDLORD_DIRECT' | 'AGENCY_CLIENT'>('LANDLORD_DIRECT');
  const [acctProvider, setAcctProvider] = useState('MANUAL_BANK');
  const [acctType, setAcctType] = useState<'PAYBILL' | 'TILL' | 'BANK' | 'CASH'>('BANK');
  const [acctIdent, setAcctIdent] = useState('');

  // Tenancy form
  const [tenPropId, setTenPropId] = useState('');
  const [tenUnitId, setTenUnitId] = useState('');
  const [tenCustomerId, setTenCustomerId] = useState('');
  const [tenStart, setTenStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [tenRent, setTenRent] = useState('');
  const [tenDeposit, setTenDeposit] = useState('');

  // Monthly Tenant Bill Generator (Rent + Water Meter + Constant Garbage)
  const [billingMonth, setBillingMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [billTenancyId, setBillTenancyId] = useState('');
  const [includeRent, setIncludeRent] = useState(true);
  const [prevWaterReading, setPrevWaterReading] = useState('0');
  const [currWaterReading, setCurrWaterReading] = useState('0');
  const [billWaterRate, setBillWaterRate] = useState('150');
  const [billGarbageFee, setBillGarbageFee] = useState('300');

  // Document Engine Modal
  const [activeBillModal, setActiveBillModal] = useState<BillSummary | null>(null);
  const [sharedFeedback, setSharedFeedback] = useState(false);
  const [showPropertyReportModal, setShowPropertyReportModal] = useState(false);
  const [reportPropertyId, setReportPropertyId] = useState<string>('ALL');
  const [sharedReportFeedback, setSharedReportFeedback] = useState(false);

  // Payment form
  const [payTenancyId, setPayTenancyId] = useState('');
  const [payAcctId, setPayAcctId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');

  // Maintenance form
  const [maintPropId, setMaintPropId] = useState('');
  const [maintUnitId, setMaintUnitId] = useState('');
  const [maintDesc, setMaintDesc] = useState('');
  const [maintPriority, setMaintPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('MEDIUM');

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [o, p, u, t, tt, c, ur, mrRead, ca, tx, ol, mr] = await Promise.all([
      supabase.from('rental_owners').select('*').eq('org_id', orgId).order('name'),
      supabase.from('rental_properties').select('*').eq('org_id', orgId).order('name'),
      supabase.from('rental_units').select('*').eq('org_id', orgId).order('unit_code'),
      supabase.from('rental_tenancies').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
      supabase.from('rental_tenancy_terms').select('*').eq('org_id', orgId).order('effective_from', { ascending: false }),
      supabase.from('rental_charges').select('*').eq('org_id', orgId).order('due_date', { ascending: false }),
      supabase.from('rental_utility_rates').select('*').eq('org_id', orgId),
      supabase.from('rental_meter_readings').select('*').eq('org_id', orgId).order('billing_period', { ascending: false }),
      supabase.from('rental_collection_accounts').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
      supabase.from('rental_payment_transactions').select('*').eq('org_id', orgId).order('paid_at', { ascending: false }).limit(50),
      supabase.from('rental_owner_ledger_entries').select('*').eq('org_id', orgId),
      supabase.from('rental_maintenance_requests').select('*').eq('org_id', orgId).order('created_at', { ascending: false })
    ]);
    if (o.data) setOwners(o.data);
    if (p.data) setProperties(p.data);
    if (u.data) setUnits(u.data);
    if (t.data) setTenancies(t.data);
    if (tt.data) setTenancyTerms(tt.data);
    if (c.data) setCharges(c.data);
    if (ur.data) setUtilityRates(ur.data);
    if (mrRead.data) setMeterReadings(mrRead.data);
    if (ca.data) setCollectionAccounts(ca.data);
    if (tx.data) setTransactions(tx.data);
    if (ol.data) setOwnerLedger(ol.data);
    if (mr.data) setMaintenance(mr.data);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial rental data load: state is only set after awaited Supabase requests resolve
    loadAll();
  }, [loadAll]);

  const propMap = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);
  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const tenancyMap = useMemo(() => new Map(tenancies.map((t) => [t.id, t])), [tenancies]);
  const ownerMap = useMemo(() => new Map(owners.map((o) => [o.id, o])), [owners]);
  const custMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const rateByPropMap = useMemo(() => new Map(utilityRates.map((r) => [r.property_id, r])), [utilityRates]);

  const showAgencyFeatures =
    Boolean(canManageOwners) &&
    !isCaretaker &&
    (agencyMode || properties.some((p) => p.operating_model === 'AGENCY_MANAGED'));

  useEffect(() => {
    if (tab === 'OWNERS' && !showAgencyFeatures) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fallback from an unavailable agency-only tab
      setTab('OVERVIEW');
    }
  }, [tab, showAgencyFeatures]);

  // Auto-populate property utility rates when selecting property in Utility Rates card
  useEffect(() => {
    if (!ratePropId) return;
    const existing = rateByPropMap.get(ratePropId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize form defaults from the selected property's saved rates
    setWaterRateInput(existing ? String(existing.water_rate_per_unit ?? 150) : '150');
    setGarbageFeeInput(existing ? String(existing.monthly_garbage_fee ?? 300) : '300');
  }, [ratePropId, rateByPropMap]);

  // Auto-populate water meter previous reading, water rate & constant garbage fee when selecting tenancy in Monthly Bill Generator
  const selectedBillTenancy = useMemo(
    () => tenancies.find((t) => t.id === billTenancyId) || null,
    [tenancies, billTenancyId]
  );

  const selectedTenancyRent = useMemo(() => {
    if (!selectedBillTenancy) return 0;
    const term = tenancyTerms.find((tt) => tt.tenancy_id === selectedBillTenancy.id);
    if (term) return Number(term.monthly_rent || 0);
    const u = unitMap.get(selectedBillTenancy.unit_id);
    return Number(u?.monthly_rent || 0);
  }, [selectedBillTenancy, tenancyTerms, unitMap]);

  useEffect(() => {
    if (!selectedBillTenancy) return;
    const propRate = rateByPropMap.get(selectedBillTenancy.property_id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize billing form defaults from tenancy, rates, and meter history
    setBillWaterRate(propRate ? String(propRate.water_rate_per_unit ?? 150) : '150');
    setBillGarbageFee(propRate ? String(propRate.monthly_garbage_fee ?? 300) : '300');

    const priorReadings = meterReadings
      .filter((r) => r.unit_id === selectedBillTenancy.unit_id && r.billing_period < billingMonth)
      .sort((a, b) => String(b.billing_period).localeCompare(String(a.billing_period)));
    const latestPrev = priorReadings.length > 0 ? Number(priorReadings[0].current_reading || 0) : 0;
    setPrevWaterReading(String(latestPrev));
    setCurrWaterReading(String(latestPrev));
  }, [selectedBillTenancy, billingMonth, rateByPropMap, meterReadings]);

  // Live preview calculations for Monthly Tenant Bill
  const billPreview = useMemo(() => {
    const prev = Math.max(0, Number(prevWaterReading) || 0);
    const curr = Math.max(0, Number(currWaterReading) || 0);
    const unitsConsumed = Math.max(0, curr - prev);
    const rate = Math.max(0, Number(billWaterRate) || 0);
    const waterAmount = Math.round(unitsConsumed * rate * 100) / 100;
    const garbageAmount = Math.max(0, Number(billGarbageFee) || 0);
    const rentAmount = includeRent ? selectedTenancyRent : 0;
    const total = Math.round((rentAmount + waterAmount + garbageAmount) * 100) / 100;
    return {
      prev,
      curr,
      unitsConsumed,
      rate,
      waterAmount,
      garbageAmount,
      rentAmount,
      total,
      invalidReading: curr < prev
    };
  }, [prevWaterReading, currWaterReading, billWaterRate, billGarbageFee, includeRent, selectedTenancyRent]);

  // Group itemized charges into Monthly Bills for the Document Engine
  const groupedBills = useMemo<BillSummary[]>(() => {
    const map = new Map<string, BillSummary>();
    for (const c of charges) {
      const unit = tenancyMap.get(c.tenancy_id) ? unitMap.get(tenancyMap.get(c.tenancy_id).unit_id) : null;
      const fallbackBillNo = `BILL-${String(c.billing_period || '').replace('-', '')}-${unit?.unit_code || String(c.tenancy_id).slice(0, 4).toUpperCase()}`;
      const billNo = c.bill_number || fallbackBillNo;
      const existing: BillSummary = map.get(billNo) || {
        billNumber: billNo,
        billingPeriod: c.billing_period,
        tenancyId: c.tenancy_id,
        propertyId: c.property_id,
        dueDate: c.due_date,
        items: [],
        totalAmount: 0,
        status: 'DUE' as const
      };
      existing.items.push(c);
      existing.totalAmount += Number(c.amount || 0);
      map.set(billNo, existing);
    }
    return Array.from(map.values())
      .map((b) => {
        const allPaid = b.items.every((i) => i.status === 'PAID');
        const anyPaid = b.items.some((i) => i.status === 'PAID' || i.status === 'PARTIAL');
        return {
          ...b,
          status: (allPaid ? 'PAID' : anyPaid ? 'PARTIAL' : 'DUE') as 'PAID' | 'PARTIAL' | 'DUE'
        };
      })
      .sort((a, b) => String(b.billingPeriod).localeCompare(String(a.billingPeriod)));
  }, [charges, tenancyMap, unitMap]);

  const kpis = useMemo(() => {
    const totalUnits = units.length;
    const occupied = units.filter((u) => u.status === 'OCCUPIED').length;
    const vacant = units.filter((u) => u.status === 'VACANT').length;
    const unpaidCharges = charges
      .filter((c) => ['DUE', 'PARTIAL', 'OVERDUE'].includes(c.status))
      .reduce((s, c) => s + Number(c.balance_due ?? c.amount ?? 0), 0);
    const collected = transactions
      .filter((t) => t.status === 'MATCHED')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const unmatched = transactions
      .filter((t) => t.status === 'UNMATCHED')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    return { totalUnits, occupied, vacant, unpaidCharges, collected, unmatched };
  }, [units, charges, transactions]);

  // Property State & Vacancy Summary dataset (for Overview & PDF Document Engine)
  const propertyStateSummary = useMemo(() => {
    return properties.map((p) => {
      const propUnits = units.filter((u) => u.property_id === p.id);
      const occupiedUnits = propUnits.filter((u) => u.status === 'OCCUPIED');
      const vacantUnits = propUnits.filter((u) => u.status === 'VACANT');
      const maintenanceUnits = propUnits.filter((u) => u.status === 'MAINTENANCE');
      const expectedRentRoll = occupiedUnits.reduce((s, u) => s + Number(u.monthly_rent || 0), 0);
      const vacantRentPotential = vacantUnits.reduce((s, u) => s + Number(u.monthly_rent || 0), 0);
      const openArrears = charges
        .filter((c) => c.property_id === p.id && ['DUE', 'PARTIAL', 'OVERDUE'].includes(c.status))
        .reduce((s, c) => s + Number(c.balance_due ?? c.amount ?? 0), 0);
      const openTickets = maintenance.filter(
        (m) => m.property_id === p.id && m.status !== 'COMPLETED'
      ).length;

      return {
        property: p,
        totalUnits: propUnits.length,
        occupiedCount: occupiedUnits.length,
        vacantCount: vacantUnits.length,
        maintenanceCount: maintenanceUnits.length,
        vacantUnits,
        expectedRentRoll,
        vacantRentPotential,
        openArrears,
        openTickets
      };
    });
  }, [properties, units, charges, maintenance]);

  // Scoped report data (supports All Properties or a single selected property)
  const activeReportData = useMemo(() => {
    const filteredRows =
      reportPropertyId === 'ALL'
        ? propertyStateSummary
        : propertyStateSummary.filter((r) => r.property.id === reportPropertyId);

    const selectedProp =
      reportPropertyId === 'ALL' ? null : propMap.get(reportPropertyId) || null;

    const totalUnits = filteredRows.reduce((s, r) => s + r.totalUnits, 0);
    const occupiedUnits = filteredRows.reduce((s, r) => s + r.occupiedCount, 0);
    const vacantUnitsCount = filteredRows.reduce((s, r) => s + r.vacantCount, 0);
    const occupancyPct = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;
    const totalExpectedRent = filteredRows.reduce((s, r) => s + r.expectedRentRoll, 0);
    const totalVacantLoss = filteredRows.reduce((s, r) => s + r.vacantRentPotential, 0);
    const totalArrears = filteredRows.reduce((s, r) => s + r.openArrears, 0);
    const totalOpenMaint = filteredRows.reduce((s, r) => s + r.openTickets, 0);

    const vacantSchedule = filteredRows.flatMap((row) =>
      row.vacantUnits.map((u: any) => ({
        propertyName: row.property.name,
        refCode: row.property.ref_code,
        unitCode: u.unit_code,
        category: u.category || 'Unit',
        monthlyRent: Number(u.monthly_rent || 0),
        depositAmount: Number(u.deposit_amount || 0)
      }))
    );

    const scopeLabel = selectedProp
      ? `${selectedProp.name} (${selectedProp.ref_code})`
      : 'All Properties (Portfolio Summary)';

    const fileSlug = selectedProp
      ? String(selectedProp.ref_code || selectedProp.name).replace(/[^a-zA-Z0-9_-]+/g, '_')
      : 'All_Properties';

    return {
      rows: filteredRows,
      selectedProp,
      scopeLabel,
      fileSlug,
      totalUnits,
      occupiedUnits,
      vacantUnitsCount,
      occupancyPct,
      totalExpectedRent,
      totalVacantLoss,
      totalArrears,
      totalOpenMaint,
      vacantSchedule
    };
  }, [propertyStateSummary, reportPropertyId, propMap]);

  const ownerPayables = useMemo(() => {
    const map = new Map<string, { ownerId: string; propertyId: string; balance: number }>();
    for (const e of ownerLedger) {
      if (e.remittance_id) continue;
      const k = `${e.owner_id}:${e.property_id}`;
      const cur = map.get(k) || { ownerId: e.owner_id, propertyId: e.property_id, balance: 0 };
      cur.balance += Number(e.signed_amount || 0);
      map.set(k, cur);
    }
    return Array.from(map.values()).filter((x) => x.balance > 0);
  }, [ownerLedger]);

  const runAction = async (fn: () => Promise<void>, successMsg: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(successMsg);
      await loadAll();
      onDataChanged?.();
    } catch (err: any) {
      setError(err?.message || 'Operation failed');
    } finally {
      setBusy(false);
    }
  };

  const getPdfOrg = (): Membership => ({
    id: orgId,
    name: effectiveOrgName,
    role: userRole,
    currency,
    industry: org?.industry || 'Property Management',
    tagline: org?.tagline || null,
    phone: org?.phone || null,
    email: org?.email || null,
    address: org?.address || null,
    kra_pin: org?.kra_pin || null,
    payment_instructions: org?.payment_instructions || null,
    logo_url: org?.logo_url || null,
    pdf_template: org?.pdf_template || 'MODERN',
    pdf_accent_color: org?.pdf_accent_color || '#0f172a',
    pdf_footer_note: org?.pdf_footer_note || null
  });

  const buildPropertyStatePdf = () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const {
      rows,
      selectedProp,
      scopeLabel,
      totalUnits,
      occupiedUnits,
      vacantUnitsCount,
      occupancyPct,
      totalExpectedRent,
      totalVacantLoss,
      totalArrears,
      totalOpenMaint,
      vacantSchedule
    } = activeReportData;

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 40;
    const contentW = pageW - margin * 2;
    const accentHex = org?.pdf_accent_color || '#0f172a';
    const r = parseInt(accentHex.slice(1, 3), 16) || 15;
    const g = parseInt(accentHex.slice(3, 5), 16) || 23;
    const b = parseInt(accentHex.slice(5, 7), 16) || 42;
    let y = 44;

    doc.setFillColor(r, g, b);
    doc.rect(margin, y, contentW, 60, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(effectiveOrgName, margin + 14, y + 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text([org?.phone, org?.email, org?.address].filter(Boolean).join('  ·  ') || 'Property Management', margin + 14, y + 38);
    doc.setFont('helvetica', 'bold');
    doc.text(`Scope: ${scopeLabel}`, margin + 14, y + 51);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('PROPERTY STATE & VACANCY REPORT', pageW - margin - 14, y + 22, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`Generated: ${todayStr}`, pageW - margin - 14, y + 39, { align: 'right' });
    y += 76;

    const boxGap = 8;
    const boxW = (contentW - boxGap * 3) / 4;
    const kpiBoxes = [
      { label: 'OCCUPANCY', value: `${occupiedUnits}/${totalUnits} (${occupancyPct}%)`, sub: `${vacantUnitsCount} vacant unit(s)` },
      { label: 'OCCUPIED RENT ROLL', value: fmtMoney(currency, totalExpectedRent), sub: 'Active monthly roll' },
      { label: 'VACANT POTENTIAL', value: fmtMoney(currency, totalVacantLoss), sub: 'Unlet monthly value' },
      { label: 'ARREARS & MAINT.', value: fmtMoney(currency, totalArrears), sub: `${totalOpenMaint} open ticket(s)` }
    ];
    kpiBoxes.forEach((box, idx) => {
      const bx = margin + idx * (boxW + boxGap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(bx, y, boxW, 48, 4, 4, 'FD');
      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.text(box.label, bx + 8, y + 14);
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(9.5);
      doc.text(box.value, bx + 8, y + 29);
      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(box.sub, bx + 8, y + 41);
    });
    y += 66;

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('1. Property Occupancy & Financial State', margin, y);
    y += 10;
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, contentW, 22, 'F');
    doc.setTextColor(71, 85, 105);
    doc.setFontSize(8);
    doc.text('Property', margin + 6, y + 14);
    doc.text('Occupied', margin + 175, y + 14);
    doc.text('Vacant Units', margin + 230, y + 14);
    doc.text('Rent Roll', margin + 355, y + 14, { align: 'right' });
    doc.text('Arrears', margin + 445, y + 14, { align: 'right' });
    doc.text('Maint.', pageW - margin - 6, y + 14, { align: 'right' });
    y += 22;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    for (const row of rows) {
      if (y > pageH - 90) {
        doc.addPage();
        y = 44;
      }
      const vacantCodes = row.vacantCount > 0
        ? `${row.vacantCount} (${row.vacantUnits.map((v: any) => v.unit_code).join(', ')})`
        : '0 (Full)';
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y + 22, pageW - margin, y + 22);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.text(`${row.property.name} (${row.property.ref_code})`.slice(0, 32), margin + 6, y + 14);
      doc.setFont('helvetica', 'normal');
      doc.text(`${row.occupiedCount} / ${row.totalUnits}`, margin + 175, y + 14);
      doc.text(vacantCodes.slice(0, 22), margin + 230, y + 14);
      doc.text(fmtMoney(currency, row.expectedRentRoll), margin + 355, y + 14, { align: 'right' });
      doc.text(fmtMoney(currency, row.openArrears), margin + 445, y + 14, { align: 'right' });
      doc.text(String(row.openTickets), pageW - margin - 6, y + 14, { align: 'right' });
      y += 22;
    }

    if (!selectedProp) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentW, 24, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('PORTFOLIO TOTAL', margin + 6, y + 15);
      doc.text(`${occupiedUnits} / ${totalUnits}`, margin + 175, y + 15);
      doc.text(`${vacantUnitsCount} vacant`, margin + 230, y + 15);
      doc.text(fmtMoney(currency, totalExpectedRent), margin + 355, y + 15, { align: 'right' });
      doc.text(fmtMoney(currency, totalArrears), margin + 445, y + 15, { align: 'right' });
      doc.text(String(totalOpenMaint), pageW - margin - 6, y + 15, { align: 'right' });
      y += 38;
    } else {
      y += 18;
    }

    if (y > pageH - 110) {
      doc.addPage();
      y = 44;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`2. Vacant Units Schedule (${vacantSchedule.length})`, margin, y);
    y += 10;
    if (vacantSchedule.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text('All units in this scope are currently occupied (0 vacant units).', margin, y + 12);
    } else {
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, y, contentW, 22, 'F');
      doc.setTextColor(71, 85, 105);
      doc.setFontSize(8);
      doc.text('Property', margin + 6, y + 14);
      doc.text('Unit Code', margin + 190, y + 14);
      doc.text('Unit Type', margin + 270, y + 14);
      doc.text('Deposit', margin + 415, y + 14, { align: 'right' });
      doc.text('Asking Rent / Mo', pageW - margin - 6, y + 14, { align: 'right' });
      y += 22;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      for (const v of vacantSchedule) {
        if (y > pageH - 70) {
          doc.addPage();
          y = 44;
        }
        doc.setDrawColor(226, 232, 240);
        doc.line(margin, y + 22, pageW - margin, y + 22);
        doc.setTextColor(15, 23, 42);
        doc.text(`${v.propertyName} (${v.refCode})`.slice(0, 34), margin + 6, y + 14);
        doc.setFont('helvetica', 'bold');
        doc.text(v.unitCode, margin + 190, y + 14);
        doc.setFont('helvetica', 'normal');
        doc.text(v.category, margin + 270, y + 14);
        doc.text(fmtMoney(currency, v.depositAmount), margin + 415, y + 14, { align: 'right' });
        doc.setFont('helvetica', 'bold');
        doc.text(fmtMoney(currency, v.monthlyRent), pageW - margin - 6, y + 14, { align: 'right' });
        y += 22;
      }
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(org?.pdf_footer_note || `${effectiveOrgName} · Internal Property Management Report`, margin, pageH - 24);
    doc.text(`Report Date: ${todayStr}`, pageW - margin, pageH - 24, { align: 'right' });
    return doc;
  };

  const handleDownloadPropertySummaryPdf = () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    buildPropertyStatePdf().save(`Property_Report_${activeReportData.fileSlug}_${todayStr}.pdf`);
    setNotice('Property State & Vacancy Report PDF downloaded.');
  };

  const handleSharePropertySummary = async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const {
      rows,
      scopeLabel,
      fileSlug,
      totalUnits,
      occupiedUnits,
      vacantUnitsCount,
      totalExpectedRent,
      totalVacantLoss,
      totalArrears
    } = activeReportData;

    const shareText = [
      `*${effectiveOrgName} — Property State & Vacancy Report (${todayStr})*`,
      `Scope: ${scopeLabel}`,
      `• Occupancy: ${occupiedUnits}/${totalUnits} units (${vacantUnitsCount} vacant)`,
      `• Active Monthly Rent Roll: ${fmtMoney(currency, totalExpectedRent)}`,
      `• Vacant Rent Potential: ${fmtMoney(currency, totalVacantLoss)}/mo`,
      `• Open Arrears: ${fmtMoney(currency, totalArrears)}`,
      '',
      ...rows.map((r) => {
        const vacList = r.vacantUnits.length > 0
          ? `Vacant: ${r.vacantUnits.map((v: any) => v.unit_code).join(', ')}`
          : 'Fully Occupied';
        return `- ${r.property.name}: ${r.occupiedCount}/${r.totalUnits} occupied (${vacList})`;
      })
    ].join('\n');

    const pdf = buildPropertyStatePdf();
    const fileName = `Property_Report_${fileSlug}_${todayStr}.pdf`;
    const file = new File([pdf.output('blob')], fileName, { type: 'application/pdf' });
    if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Property State Report - ${scopeLabel}`, text: shareText });
        setSharedReportFeedback(true);
        setTimeout(() => setSharedReportFeedback(false), 2500);
        return;
      } catch {
        return;
      }
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: `Property State Report - ${scopeLabel}`, text: shareText });
        setSharedReportFeedback(true);
        setTimeout(() => setSharedReportFeedback(false), 2500);
        return;
      } catch {
        return;
      }
    }
    pdf.save(fileName);
    try {
      await navigator.clipboard.writeText(shareText);
    } catch {
      // Ignore clipboard denial
    }
    setSharedReportFeedback(true);
    setTimeout(() => setSharedReportFeedback(false), 3000);
    setNotice(`Downloaded ${fileName} and copied report summary.`);
  };

  const buildBillShareText = (bill: BillSummary) => {
    const ten = tenancyMap.get(bill.tenancyId);
    const tenant = ten ? custMap.get(ten.customer_id) : null;
    const prop = propMap.get(bill.propertyId);
    const unit = ten ? unitMap.get(ten.unit_id) : null;
    const acct = collectionAccounts.find((a) => a.is_active);
    const lines = bill.items.map((it) => {
      const label =
        it.description ||
        (it.charge_type === 'RENT'
          ? `Monthly Rent (${bill.billingPeriod})`
          : it.charge_type === 'WATER'
          ? 'Water Usage'
          : it.charge_type === 'GARBAGE' || it.charge_type === 'SERVICE_CHARGE'
          ? 'Garbage Collection'
          : it.charge_type);
      return `• ${label}: ${fmtMoney(currency, it.amount)}`;
    });

    return [
      `Hello ${tenant?.name || 'Tenant'},`,
      `Your monthly rent & utility statement (${bill.billNumber}) for *${prop?.name || ''} - Unit ${unit?.unit_code || ''}* (${bill.billingPeriod}) is ready:`,
      '',
      ...lines,
      `*Total Payable: ${fmtMoney(currency, bill.totalAmount)}*`,
      `Due Date: ${bill.dueDate}`,
      acct ? `Pay via ${acct.account_type} (${acct.account_identifier}) using Ref: *${ten?.payment_ref || ''}*` : `Payment Ref: *${ten?.payment_ref || ''}*`,
      '',
      `Thank you — ${effectiveOrgName}`
    ].join('\n');
  };

  const buildBillPdf = (bill: BillSummary) => {
    const ten = tenancyMap.get(bill.tenancyId);
    const tenant = ten ? custMap.get(ten.customer_id) : null;
    const prop = propMap.get(bill.propertyId);
    const unit = ten ? unitMap.get(ten.unit_id) : null;
    const activeAccounts = collectionAccounts.filter((a) => a.is_active);

    const paymentNote =
      activeAccounts.length > 0
        ? activeAccounts
            .map((acc) => `${acc.account_type} (${acc.account_identifier}) · Ref: ${ten?.payment_ref || ''}`)
            .join(' | ')
        : `Payment Ref: ${ten?.payment_ref || ''}`;

    const billDoc: DocumentRecord = {
      id: bill.billNumber,
      org_id: orgId,
      customer_id: ten?.customer_id || null,
      doc_type: 'INVOICE',
      chain_code: bill.billNumber,
      doc_number: bill.billNumber,
      parent_id: null,
      quote_ref: null,
      invoice_ref: bill.billNumber,
      issue_date: bill.dueDate,
      customer_name: `${tenant?.name || 'Tenant'} — ${prop?.name || ''} Unit ${unit?.unit_code || ''}`,
      customer_phone: tenant?.phone || '',
      customer_email: tenant?.email || '',
      description: `Period: ${bill.billingPeriod} · Due: ${bill.dueDate} · ${paymentNote}`,
      amount: bill.totalAmount,
      amount_paid: bill.status === 'PAID' ? bill.totalAmount : 0,
      payment_method: null,
      payment_ref: ten?.payment_ref || null,
      status: bill.status === 'PAID' ? 'PAID' : 'UNPAID'
    };

    const items = bill.items.map((it) => ({
      description:
        it.description ||
        (it.charge_type === 'RENT'
          ? `Monthly Rent (${bill.billingPeriod})`
          : it.charge_type === 'WATER'
          ? 'Water Usage Charge'
          : it.charge_type === 'GARBAGE' || it.charge_type === 'SERVICE_CHARGE'
          ? 'Monthly Garbage Collection'
          : it.charge_type),
      quantity: 1,
      unit_price: Number(it.amount || 0),
      line_total: Number(it.amount || 0)
    }));

    return buildPdfDocument(billDoc, getPdfOrg(), items);
  };

  // Unified native Share button (PDF attachment + formatted message on mobile; PDF download + clipboard on desktop)
  const handleShareBill = async (bill: BillSummary) => {
    const shareText = buildBillShareText(bill);
    const pdf = buildBillPdf(bill);
    const file = new File([pdf.output('blob')], `${bill.billNumber}.pdf`, { type: 'application/pdf' });

    if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: `${bill.billNumber} - ${effectiveOrgName}`,
          text: shareText
        });
        setSharedFeedback(true);
        setTimeout(() => setSharedFeedback(false), 2500);
        return;
      } catch {
        return;
      }
    }

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `${bill.billNumber} - ${effectiveOrgName}`,
          text: shareText
        });
        setSharedFeedback(true);
        setTimeout(() => setSharedFeedback(false), 2500);
        return;
      } catch {
        return;
      }
    }

    pdf.save(`${bill.billNumber}.pdf`);
    try {
      await navigator.clipboard.writeText(shareText);
    } catch {
      // Ignore clipboard permission denials
    }
    setSharedFeedback(true);
    setTimeout(() => setSharedFeedback(false), 3000);
    setNotice(`Downloaded ${bill.billNumber}.pdf and copied payment summary — ready to attach & share!`);
  };

  return (
    <div className="space-y-5">
      {/* Optional Inner Navigation (suppressed when driven directly by the specialist sidebar) */}
      {!hideInnerTabs && (
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'OVERVIEW', label: 'Overview', icon: Home },
              { id: 'PROPERTIES', label: 'Properties & Units', icon: Building2 },
              { id: 'TENANCIES', label: 'Tenancies & Deposits', icon: Users },
              { id: 'COLLECTIONS', label: 'Rent & Utilities Billing', icon: FileCheck2 },
              ...(showAgencyFeatures ? [{ id: 'OWNERS' as const, label: 'Owners & Remittances', icon: Landmark }] : []),
              { id: 'MAINTENANCE', label: 'Maintenance', icon: Wrench }
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition ${
                tab === t.id
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs sm:text-sm font-medium text-emerald-800">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs sm:text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      {/* Portfolio KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={ui.kpiCard}>
          <div className={ui.muted}>Occupancy</div>
          <div className="mt-1 text-sm sm:text-lg font-bold text-slate-900 tabular-money whitespace-nowrap">
            {kpis.occupied} / {kpis.totalUnits} units
          </div>
          <div className="mt-0.5 text-xs font-medium text-slate-500">
            {kpis.vacant} vacant
          </div>
        </div>
        <div className={ui.kpiCard}>
          <div className={ui.muted}>Open Rent &amp; Utility Charges</div>
          <div className="mt-1 text-sm sm:text-lg font-bold text-amber-700 tabular-money whitespace-nowrap">{fmtMoney(currency, kpis.unpaidCharges)}</div>
        </div>
        <div className={ui.kpiCard}>
          <div className={ui.muted}>Matched Collections</div>
          <div className="mt-1 text-sm sm:text-lg font-bold text-emerald-700 tabular-money whitespace-nowrap">{fmtMoney(currency, kpis.collected)}</div>
        </div>
        <div className={ui.kpiCard}>
          <div className={ui.muted}>Unmatched Suspense</div>
          <div className="mt-1 text-sm sm:text-lg font-bold text-slate-900 tabular-money whitespace-nowrap">{fmtMoney(currency, kpis.unmatched)}</div>
        </div>
      </div>

      {loading ? (
        <div className={ui.cardPadded}>
          <p className={ui.muted}>Loading rental portfolio...</p>
        </div>
      ) : tab === 'OVERVIEW' ? (
        <div className="space-y-5">
          {properties.length === 0 && (
            <div className={`${ui.cardPadded} border-indigo-200 bg-indigo-50/40 space-y-4`}>
              <div>
                <h3 className={ui.sectionTitle}>Quick Setup Checklist</h3>
                <p className={ui.muted}>
                  Set up your properties, utility rates, and tenants to start generating monthly bills and collecting rent.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  {
                    title: 'Register a Property & Utility Rates',
                    desc: 'Add your apartment block or building, water rate per unit, and monthly garbage fee.',
                    done: properties.length > 0,
                    actionLabel: 'Add Property',
                    targetTab: 'PROPERTIES' as RentalsTab
                  },
                  {
                    title: 'Add Units & Collection Account',
                    desc: 'Create rentable units with monthly rent and add your bank, PayBill, or Till.',
                    done: units.length > 0 && collectionAccounts.length > 0,
                    actionLabel: 'Set Up Units',
                    targetTab: 'PROPERTIES' as RentalsTab
                  },
                  {
                    title: 'Onboard Tenant & Activate Lease',
                    desc: 'Assign a tenant to a vacant unit to generate a unique BL-XXXXXX payment reference.',
                    done: tenancies.some((t) => t.status === 'ACTIVE'),
                    actionLabel: 'Create Lease',
                    targetTab: 'TENANCIES' as RentalsTab
                  },
                  {
                    title: 'Enter Water Reading & Send Monthly Bill',
                    desc: 'Record monthly water meter readings, add constant garbage + rent, and share the bill.',
                    done: charges.length > 0,
                    actionLabel: 'Open Billing',
                    targetTab: 'COLLECTIONS' as RentalsTab
                  }
                ].map((step) => (
                  <div
                    key={step.title}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5"
                  >
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2
                        className={`w-4 h-4 mt-0.5 shrink-0 ${
                          step.done ? 'text-emerald-600' : 'text-slate-300'
                        }`}
                      />
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{step.title}</div>
                        <p className="mt-0.5 text-xs text-slate-500">{step.desc}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTab(step.targetTab)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      {step.actionLabel}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Property State & Vacancy Summary + PDF Report Export */}
          {properties.length > 0 && (
            <div className={`${ui.cardPadded} space-y-4`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className={ui.sectionTitle}>Property State &amp; Vacancy Summary</h3>
                  <p className={ui.muted}>
                    Live unit occupancy, vacant houses, expected monthly rent roll, and open maintenance across properties.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReportPropertyId('ALL');
                    setShowPropertyReportModal(true);
                  }}
                  className={ui.btnPrimary}
                >
                  <FileText className="w-4 h-4" /> Preview / Export Report
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[540px] text-left border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-semibold">Property</th>
                      <th className="py-2 px-3 font-semibold">Occupied</th>
                      <th className="py-2 px-3 font-semibold">Vacant Units</th>
                      <th className="py-2 px-3 font-semibold">Occupied Rent Roll</th>
                      <th className="py-2 px-3 font-semibold">Open Arrears</th>
                      <th className="py-2 px-3 font-semibold">Maintenance</th>
                      <th className="py-2 pl-3 text-right font-semibold">Report</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {propertyStateSummary.map((row) => (
                      <tr key={row.property.id}>
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-slate-900">{row.property.name}</div>
                          <div className={ui.muted}>{row.property.ref_code} &middot; {row.totalUnits} total units</div>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-emerald-700">
                          {row.occupiedCount} / {row.totalUnits}
                        </td>
                        <td className="py-2.5 px-3">
                          {row.vacantCount > 0 ? (
                            <div>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800">
                                {row.vacantCount} vacant ({row.vacantUnits.map((v: any) => v.unit_code).join(', ')})
                              </span>
                              <div className="text-xs text-slate-500 mt-0.5">
                                Potential: {fmtMoney(currency, row.vacantRentPotential)}/mo
                              </div>
                            </div>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">
                              Full (0 vacant)
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">
                          {fmtMoney(currency, row.expectedRentRoll)}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-amber-700">
                          {fmtMoney(currency, row.openArrears)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            row.openTickets > 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {row.openTickets} open
                          </span>
                        </td>
                        <td className="py-2.5 pl-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setReportPropertyId(row.property.id);
                              setShowPropertyReportModal(true);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <FileText className="w-3.5 h-3.5" /> Report
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className={ui.cardPadded}>
              <h3 className={ui.sectionTitle}>Active Tenancies ({tenancies.filter((t) => t.status === 'ACTIVE').length})</h3>
              <div className="mt-3 divide-y divide-slate-100">
                {tenancies.filter((t) => t.status === 'ACTIVE').map((t) => (
                  <div key={t.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm text-slate-900">
                        {custMap.get(t.customer_id)?.name || 'Tenant'} &middot; {unitMap.get(t.unit_id)?.unit_code}
                      </div>
                      <div className={ui.muted}>
                        {propMap.get(t.property_id)?.name} &middot; Ref: <span className="font-mono font-semibold">{t.payment_ref}</span>
                      </div>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">
                      {t.status}
                    </span>
                  </div>
                ))}
                {tenancies.filter((t) => t.status === 'ACTIVE').length === 0 && (
                  <p className="py-3 text-sm text-slate-500">No active tenancies yet.</p>
                )}
              </div>
            </div>

            <div className={ui.cardPadded}>
              <h3 className={ui.sectionTitle}>Recent Transactions</h3>
              <div className="mt-3 divide-y divide-slate-100">
                {transactions.slice(0, 8).map((tx) => (
                  <div key={tx.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm text-slate-900">{tx.provider_tx_id}</div>
                      <div className={ui.muted}>{tx.provider} &middot; {tx.paid_at?.slice(0, 10)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-sm text-slate-900">{fmtMoney(currency, tx.amount)}</div>
                      <div className="text-xs font-semibold text-slate-500">{tx.status}</div>
                    </div>
                  </div>
                ))}
                {transactions.length === 0 && <p className="py-3 text-sm text-slate-500">No rental transactions recorded yet.</p>}
              </div>
            </div>
          </div>
        </div>
      ) : tab === 'PROPERTIES' ? (
        <div className="space-y-4">
          {canManageOwners && !isCaretaker && (
            <div className="flex items-center justify-end">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAgencyFeatures}
                  onChange={(e) => setAgencyMode(e.target.checked)}
                  className="rounded border-slate-300"
                />
                I manage properties for other owners (Agency Mode)
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {showAgencyFeatures && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  runAction(async () => {
                    const { error: err } = await supabase.from('rental_owners').insert({
                      org_id: orgId,
                      customer_id: ownerCustomerId || null,
                      name: ownerName.trim(),
                      phone: ownerPhone.trim() || null
                    });
                    if (err) throw err;
                    setOwnerName('');
                    setOwnerPhone('');
                  }, 'Owner saved.');
                }}
                className={`${ui.cardPadded} space-y-3`}
              >
                <h3 className={ui.sectionTitle}>Register Property Owner</h3>
                <div>
                  <label className={ui.label}>Owner Name</label>
                  <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required className={ui.input} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ui.label}>Phone</label>
                    <input value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} className={ui.input} />
                  </div>
                  <div>
                    <label className={ui.label}>Link Existing Contact (Optional)</label>
                    <select value={ownerCustomerId} onChange={(e) => setOwnerCustomerId(e.target.value)} className={ui.select}>
                      <option value="">None</option>
                      {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
                <button type="submit" disabled={busy || isReadOnly} className={ui.btnPrimary}><Plus className="w-4 h-4" /> Save Owner</button>
              </form>
            )}

            {/* Register Property */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runAction(async () => {
                  const effectiveModel = showAgencyFeatures ? propModel : 'DIRECT_LANDLORD';
                  const { error: err } = await supabase.from('rental_properties').insert({
                    org_id: orgId,
                    ref_code: propRef.trim().toUpperCase(),
                    name: propName.trim(),
                    operating_model: effectiveModel,
                    default_due_day: Number(propDueDay) || 5
                  });
                  if (err) throw err;
                  setPropRef('');
                  setPropName('');
                }, 'Property saved.');
              }}
              className={`${ui.cardPadded} space-y-3`}
            >
              <h3 className={ui.sectionTitle}>Register Property</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={ui.label}>Ref Code</label>
                  <input value={propRef} onChange={(e) => setPropRef(e.target.value)} required className={ui.input} placeholder="KH-01" />
                </div>
                <div>
                  <label className={ui.label}>Property Name</label>
                  <input value={propName} onChange={(e) => setPropName(e.target.value)} required className={ui.input} placeholder="Kilimani Heights" />
                </div>
              </div>
              <div className={`grid ${showAgencyFeatures ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                {showAgencyFeatures && (
                  <div>
                    <label className={ui.label}>Operating Model</label>
                    <select value={propModel} onChange={(e) => setPropModel(e.target.value as any)} className={ui.select}>
                      <option value="DIRECT_LANDLORD">Direct Landlord</option>
                      <option value="AGENCY_MANAGED">Agency Managed</option>
                    </select>
                  </div>
                )}
                <div>
                  <label className={ui.label}>Default Due Day (1–28)</label>
                  <input type="number" min={1} max={28} value={propDueDay} onChange={(e) => setPropDueDay(e.target.value)} className={ui.input} />
                </div>
              </div>
              <button type="submit" disabled={busy || isReadOnly} className={ui.btnPrimary}><Plus className="w-4 h-4" /> Save Property</button>
            </form>

            {/* Property Utility Rates (Water Rate + Constant Garbage Fee) */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runAction(async () => {
                  const { error: err } = await supabase.rpc('rpc_upsert_property_utility_rates', {
                    p_org_id: orgId,
                    p_property_id: ratePropId,
                    p_water_rate_per_unit: Number(waterRateInput) || 0,
                    p_monthly_garbage_fee: Number(garbageFeeInput) || 0
                  });
                  if (err) throw err;
                }, 'Property water & garbage rates updated.');
              }}
              className={`${ui.cardPadded} space-y-3`}
            >
              <div className="flex items-center justify-between">
                <h3 className={ui.sectionTitle}>Property Utility Rates</h3>
                <Droplets className="w-4 h-4 text-sky-600" />
              </div>
              <div>
                <label className={ui.label}>Property</label>
                <select value={ratePropId} onChange={(e) => setRatePropId(e.target.value)} required className={ui.select}>
                  <option value="">Select property...</option>
                  {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={ui.label}>Water Rate per Unit ({currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={waterRateInput}
                    onChange={(e) => setWaterRateInput(e.target.value)}
                    required
                    className={ui.input}
                    placeholder="150"
                  />
                </div>
                <div>
                  <label className={ui.label}>Monthly Garbage Fee ({currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={garbageFeeInput}
                    onChange={(e) => setGarbageFeeInput(e.target.value)}
                    required
                    className={ui.input}
                    placeholder="300"
                  />
                </div>
              </div>
              <button type="submit" disabled={busy || isReadOnly} className={ui.btnSecondary}>
                Save Utility Rates
              </button>
            </form>

            {showAgencyFeatures && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  runAction(async () => {
                    const { error: err } = await supabase.from('rental_property_ownerships').insert({
                      org_id: orgId,
                      property_id: sharePropId,
                      owner_id: shareOwnerId,
                      ownership_pct: Number(sharePct),
                      is_primary: sharePrimary,
                      effective_from: new Date().toISOString().slice(0, 10)
                    });
                    if (err) throw err;
                  }, 'Ownership share assigned.');
                }}
                className={`${ui.cardPadded} space-y-3`}
              >
                <h3 className={ui.sectionTitle}>Assign Ownership Share</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ui.label}>Property</label>
                    <select value={sharePropId} onChange={(e) => setSharePropId(e.target.value)} required className={ui.select}>
                      <option value="">Select property...</option>
                      {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={ui.label}>Owner</label>
                    <select value={shareOwnerId} onChange={(e) => setShareOwnerId(e.target.value)} required className={ui.select}>
                      <option value="">Select owner...</option>
                      {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 items-end">
                  <div>
                    <label className={ui.label}>Ownership Percentage (%)</label>
                    <input type="number" step="0.01" min={0.01} max={100} value={sharePct} onChange={(e) => setSharePct(e.target.value)} className={ui.input} placeholder="100" />
                  </div>
                  <label className="flex items-center gap-2 pb-2 text-xs font-medium text-slate-700">
                    <input type="checkbox" checked={sharePrimary} onChange={(e) => setSharePrimary(e.target.checked)} /> Primary Owner
                  </label>
                </div>
                <button type="submit" disabled={busy || isReadOnly} className={ui.btnSecondary}>Save Ownership Share</button>
              </form>
            )}

            {/* Add Rental Unit */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runAction(async () => {
                  const { error: err } = await supabase.from('rental_units').insert({
                    org_id: orgId,
                    property_id: unitPropId,
                    unit_code: unitCode.trim(),
                    category: unitCat.trim(),
                    monthly_rent: Number(unitRent) || 0,
                    deposit_amount: Number(unitDeposit) || 0
                  });
                  if (err) throw err;
                  setUnitCode('');
                  setUnitRent('');
                  setUnitDeposit('');
                }, 'Unit added.');
              }}
              className={`${ui.cardPadded} space-y-3`}
            >
              <h3 className={ui.sectionTitle}>Add Rental Unit</h3>
              <div>
                <label className={ui.label}>Property</label>
                <select value={unitPropId} onChange={(e) => setUnitPropId(e.target.value)} required className={ui.select}>
                  <option value="">Select property...</option>
                  {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={ui.label}>Unit Code</label>
                  <input value={unitCode} onChange={(e) => setUnitCode(e.target.value)} required className={ui.input} placeholder="A01" />
                </div>
                <div>
                  <label className={ui.label}>Unit Type</label>
                  <input value={unitCat} onChange={(e) => setUnitCat(e.target.value)} className={ui.input} placeholder="1BR, Bedsitter" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={ui.label}>Monthly Rent ({currency})</label>
                  <input type="number" min={0} value={unitRent} onChange={(e) => setUnitRent(e.target.value)} required className={ui.input} placeholder="25000" />
                </div>
                <div>
                  <label className={ui.label}>Security Deposit ({currency})</label>
                  <input type="number" min={0} value={unitDeposit} onChange={(e) => setUnitDeposit(e.target.value)} className={ui.input} placeholder="25000" />
                </div>
              </div>
              <button type="submit" disabled={busy || isReadOnly} className={ui.btnDark}><Plus className="w-4 h-4" /> Save Unit</button>
            </form>

            {/* Collection Accounts */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runAction(async () => {
                  const effectiveScope = showAgencyFeatures ? acctScope : 'LANDLORD_DIRECT';
                  const { error: err } = await supabase.from('rental_collection_accounts').insert({
                    org_id: orgId,
                    account_scope: effectiveScope,
                    provider: acctProvider,
                    account_type: acctType,
                    account_identifier: acctIdent.trim()
                  });
                  if (err) throw err;
                  setAcctIdent('');
                }, 'Collection account added.');
              }}
              className={`${ui.cardPadded} space-y-3`}
            >
              <h3 className={ui.sectionTitle}>Collection Accounts ({collectionAccounts.length})</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {showAgencyFeatures && (
                  <div>
                    <label className={ui.label}>Account Scope</label>
                    <select value={acctScope} onChange={(e) => setAcctScope(e.target.value as any)} className={ui.select}>
                      <option value="LANDLORD_DIRECT">Landlord Direct</option>
                      <option value="AGENCY_CLIENT">Agency Client Account</option>
                    </select>
                  </div>
                )}
                <div>
                  <label className={ui.label}>Provider</label>
                  <select value={acctProvider} onChange={(e) => setAcctProvider(e.target.value)} className={ui.select}>
                    <option value="MANUAL_BANK">Manual Bank</option>
                    <option value="MANUAL_CASH">Manual Cash</option>
                    <option value="MPESA_DARAJA">M-PESA PayBill / Till</option>
                  </select>
                </div>
                <div>
                  <label className={ui.label}>Channel Type</label>
                  <select value={acctType} onChange={(e) => setAcctType(e.target.value as any)} className={ui.select}>
                    <option value="BANK">Bank</option>
                    <option value="PAYBILL">PayBill</option>
                    <option value="TILL">Till</option>
                    <option value="CASH">Cash</option>
                  </select>
                </div>
                <div>
                  <label className={ui.label}>Account / PayBill #</label>
                  <input value={acctIdent} onChange={(e) => setAcctIdent(e.target.value)} required className={ui.input} placeholder="e.g. 01100998877" />
                </div>
              </div>
              <button type="submit" disabled={busy || isReadOnly} className={ui.btnSecondary}>Save Collection Account</button>
            </form>
          </div>
        </div>
      ) : tab === 'TENANCIES' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runAction(async () => {
                const ref = genPaymentRef();
                const { data: ten, error: tErr } = await supabase
                  .from('rental_tenancies')
                  .insert({
                    org_id: orgId,
                    property_id: tenPropId,
                    unit_id: tenUnitId,
                    customer_id: tenCustomerId,
                    payment_ref: ref,
                    start_date: tenStart,
                    status: 'DRAFT'
                  })
                  .select('id')
                  .single();
                if (tErr) throw tErr;

                const { error: termErr } = await supabase.from('rental_tenancy_terms').insert({
                  org_id: orgId,
                  tenancy_id: ten.id,
                  monthly_rent: Number(tenRent),
                  effective_from: tenStart
                });
                if (termErr) throw termErr;

                const { error: actErr } = await supabase.rpc('rpc_activate_tenancy', {
                  p_org_id: orgId,
                  p_tenancy_id: ten.id
                });
                if (actErr) throw actErr;

                const depositVal = Number(tenDeposit) || 0;
                const defaultAcct = collectionAccounts.find((a) => a.is_active);
                if (depositVal > 0 && defaultAcct) {
                  await supabase.rpc('rpc_record_security_deposit', {
                    p_org_id: orgId,
                    p_tenancy_id: ten.id,
                    p_collection_account_id: defaultAcct.id,
                    p_amount: depositVal,
                    p_ref: `DEP-${ref}`
                  });
                }
              }, 'Tenancy created and activated.');
            }}
            className={`${ui.cardPadded} space-y-3`}
          >
            <h3 className={ui.sectionTitle}>Activate Tenancy</h3>
            <div>
              <label className={ui.label}>Property</label>
              <select value={tenPropId} onChange={(e) => { setTenPropId(e.target.value); setTenUnitId(''); }} required className={ui.select}>
                <option value="">Select property...</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={ui.label}>Vacant Unit</label>
              <select
                value={tenUnitId}
                onChange={(e) => {
                  setTenUnitId(e.target.value);
                  const u = unitMap.get(e.target.value);
                  if (u) {
                    setTenRent(String(u.monthly_rent));
                    setTenDeposit(String(u.deposit_amount || 0));
                  }
                }}
                required
                className={ui.select}
              >
                <option value="">Select vacant unit...</option>
                {units.filter((u) => u.property_id === tenPropId && u.status === 'VACANT').map((u) => (
                  <option key={u.id} value={u.id}>{u.unit_code} ({fmtMoney(currency, u.monthly_rent)})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={ui.label}>Tenant</label>
              <select value={tenCustomerId} onChange={(e) => setTenCustomerId(e.target.value)} required className={ui.select}>
                <option value="">Select tenant...</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={ui.label}>Start Date</label>
                <input type="date" value={tenStart} onChange={(e) => setTenStart(e.target.value)} required className={ui.input} />
              </div>
              <div>
                <label className={ui.label}>Monthly Rent ({currency})</label>
                <input type="number" min={0} value={tenRent} onChange={(e) => setTenRent(e.target.value)} required className={ui.input} placeholder="25000" />
              </div>
              <div>
                <label className={ui.label}>Security Deposit ({currency})</label>
                <input type="number" min={0} value={tenDeposit} onChange={(e) => setTenDeposit(e.target.value)} className={ui.input} placeholder="25000" />
              </div>
            </div>
            <button type="submit" disabled={busy || isReadOnly} className={ui.btnPrimary}><DoorOpen className="w-4 h-4" /> Activate Tenancy</button>
          </form>

          <div className={`${ui.cardPadded} space-y-3`}>
            <h3 className={ui.sectionTitle}>Active &amp; Past Tenancies ({tenancies.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-semibold">Tenant &amp; Unit</th>
                    <th className="py-2 px-3 font-semibold">Payment Ref</th>
                    <th className="py-2 px-3 font-semibold">Status</th>
                    <th className="py-2 pl-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tenancies.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-slate-900">
                          {custMap.get(t.customer_id)?.name || 'Tenant'} &middot; {unitMap.get(t.unit_id)?.unit_code}
                        </div>
                        <div className={ui.muted}>{propMap.get(t.property_id)?.name}</div>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">{t.payment_ref}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            t.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        {!isReadOnly && t.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() =>
                              runAction(async () => {
                                const { error: err } = await supabase.rpc('rpc_terminate_tenancy', {
                                  p_org_id: orgId,
                                  p_tenancy_id: t.id,
                                  p_end_date: new Date().toISOString().slice(0, 10)
                                });
                                if (err) throw err;
                              }, 'Tenancy terminated.')
                            }
                            className="px-2.5 py-1 rounded-lg border border-rose-200 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                          >
                            Terminate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tenancies.length === 0 && <p className="py-3 text-sm text-slate-500">No tenancies created yet.</p>}
            </div>
          </div>
        </div>
      ) : tab === 'COLLECTIONS' ? (
        <div className="space-y-5">
          {/* Monthly Tenant Bill Generator (Rent + Water Meter + Constant Garbage) */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!billTenancyId) {
                setError('Select an active tenant lease first.');
                return;
              }
              if (billPreview.invalidReading) {
                setError('Current water reading cannot be less than previous reading.');
                return;
              }
              runAction(async () => {
                const { error: err } = await supabase.rpc('rpc_generate_monthly_tenant_bill', {
                  p_org_id: orgId,
                  p_tenancy_id: billTenancyId,
                  p_billing_period: billingMonth,
                  p_prev_water_reading: billPreview.prev,
                  p_curr_water_reading: billPreview.curr,
                  p_water_rate_per_unit: billPreview.rate,
                  p_garbage_fee: billPreview.garbageAmount,
                  p_include_rent: includeRent
                });
                if (err) throw err;
              }, `Monthly tenant bill generated for ${billingMonth}.`);
            }}
            className={`${ui.cardPadded} space-y-4`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className={ui.sectionTitle}>Monthly Tenant Bill Generator (Rent + Water + Garbage)</h3>
                <p className={ui.muted}>
                  Record monthly water usage, apply constant garbage &amp; rent, post to GL, and send the itemized bill before due date.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeRent}
                  onChange={(e) => setIncludeRent(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Include Monthly Rent ({fmtMoney(currency, selectedTenancyRent)})
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className={ui.label}>Billing Month</label>
                <input type="month" value={billingMonth} onChange={(e) => setBillingMonth(e.target.value)} required className={ui.input} />
              </div>
              <div className="lg:col-span-2">
                <label className={ui.label}>Active Tenant Lease</label>
                <select value={billTenancyId} onChange={(e) => setBillTenancyId(e.target.value)} required className={ui.select}>
                  <option value="">Select tenant &amp; unit...</option>
                  {tenancies.filter((t) => t.status === 'ACTIVE').map((t) => (
                    <option key={t.id} value={t.id}>
                      {custMap.get(t.customer_id)?.name} — {propMap.get(t.property_id)?.name} ({unitMap.get(t.unit_id)?.unit_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ui.label}>Previous Water Reading</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={prevWaterReading}
                  onChange={(e) => setPrevWaterReading(e.target.value)}
                  required
                  className={ui.input}
                />
              </div>
              <div>
                <label className={ui.label}>Current Water Reading</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={currWaterReading}
                  onChange={(e) => setCurrWaterReading(e.target.value)}
                  required
                  className={ui.input}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className={ui.label}>Water Rate / Unit ({currency})</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={billWaterRate}
                  onChange={(e) => setBillWaterRate(e.target.value)}
                  className={ui.input}
                />
              </div>
              <div>
                <label className={ui.label}>Constant Garbage Fee ({currency})</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={billGarbageFee}
                  onChange={(e) => setBillGarbageFee(e.target.value)}
                  className={ui.input}
                />
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Water ({billPreview.unitsConsumed.toFixed(2)} units &times; {billPreview.rate}):</span>
                  <span className="font-semibold text-slate-900">{fmtMoney(currency, billPreview.waterAmount)}</span>
                </div>
                <div className="flex justify-between text-slate-600 mt-0.5">
                  <span>Rent + Garbage:</span>
                  <span className="font-semibold text-slate-900">
                    {fmtMoney(currency, billPreview.rentAmount + billPreview.garbageAmount)}
                  </span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 mt-1.5 pt-1.5 text-sm">
                  <span>Total Billable:</span>
                  <span>{fmtMoney(currency, billPreview.total)}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={busy || isReadOnly || billPreview.invalidReading} className={ui.btnPrimary}>
                <FileText className="w-4 h-4" /> Generate &amp; Preview Tenant Bill
              </button>
              {billPreview.invalidReading && (
                <span className="text-xs font-medium text-rose-600">
                  Current meter reading must be greater than or equal to previous reading ({billPreview.prev}).
                </span>
              )}
            </div>
          </form>

          {/* Tenant Monthly Bills & Document Engine */}
          <div className={ui.cardPadded}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className={ui.sectionTitle}>Tenant Monthly Bills &amp; Document Engine ({groupedBills.length})</h3>
                <p className={ui.muted}>Open any statement to print PDF or share directly with your tenant.</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-semibold">Bill #</th>
                    <th className="py-2 px-3 font-semibold">Tenant &amp; Unit</th>
                    <th className="py-2 px-3 font-semibold">Period / Due</th>
                    <th className="py-2 px-3 font-semibold">Total Bill</th>
                    <th className="py-2 px-3 font-semibold">Status</th>
                    <th className="py-2 pl-3 text-right font-semibold">Document</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groupedBills.map((b) => {
                    const ten = tenancyMap.get(b.tenancyId);
                    const tenant = ten ? custMap.get(ten.customer_id) : null;
                    const unit = ten ? unitMap.get(ten.unit_id) : null;
                    return (
                      <tr key={b.billNumber}>
                        <td className="py-2.5 pr-3 font-mono font-semibold text-slate-900">{b.billNumber}</td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900">{tenant?.name || 'Tenant'}</div>
                          <div className={ui.muted}>
                            {propMap.get(b.propertyId)?.name} &middot; Unit {unit?.unit_code}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-800">{b.billingPeriod}</div>
                          <div className={ui.muted}>Due {b.dueDate}</div>
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-900">{fmtMoney(currency, b.totalAmount)}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                              b.status === 'PAID'
                                ? 'bg-emerald-50 text-emerald-700'
                                : b.status === 'PARTIAL'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="py-2.5 pl-3 text-right">
                          <button
                            type="button"
                            onClick={() => setActiveBillModal(b)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                          >
                            <FileText className="w-3.5 h-3.5" /> View / Send Bill
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {groupedBills.length === 0 && (
                <p className="py-3 text-sm text-slate-500">No tenant monthly bills generated yet.</p>
              )}
            </div>
          </div>

          {/* Record & Allocate Payment (Owners/Admins) */}
          {!isCaretaker && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runAction(async () => {
                  const acct = collectionAccounts.find((a) => a.id === payAcctId);
                  if (!acct) throw new Error('Select a collection account');
                  const { error: err } = await supabase.rpc('rpc_record_and_allocate_rental_payment', {
                    p_org_id: orgId,
                    p_collection_account_id: payAcctId,
                    p_provider: acct.provider,
                    p_provider_tx_id: payRef.trim(),
                    p_amount: Number(payAmount),
                    p_paid_at: new Date().toISOString(),
                    p_tenancy_id: payTenancyId || null
                  });
                  if (err) throw err;
                  setPayAmount('');
                  setPayRef('');
                }, 'Payment recorded, allocated, and posted to GL.');
              }}
              className={`${ui.cardPadded} space-y-3`}
            >
              <h3 className={ui.sectionTitle}>Record &amp; Allocate Payment</h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className={ui.label}>Tenant Lease</label>
                  <select value={payTenancyId} onChange={(e) => setPayTenancyId(e.target.value)} className={ui.select}>
                    <option value="">Unmatched (Suspense 2230)</option>
                    {tenancies.filter((t) => t.status === 'ACTIVE').map((t) => (
                      <option key={t.id} value={t.id}>
                        {custMap.get(t.customer_id)?.name} ({t.payment_ref})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={ui.label}>Collection Account</label>
                  <select value={payAcctId} onChange={(e) => setPayAcctId(e.target.value)} required className={ui.select}>
                    <option value="">Select account...</option>
                    {collectionAccounts.filter((a) => a.is_active).map((a) => (
                      <option key={a.id} value={a.id}>{a.account_type} · {a.account_identifier}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={ui.label}>Amount ({currency})</label>
                  <input type="number" step="0.01" min={0.01} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} required className={ui.input} placeholder="25000" />
                </div>
                <div>
                  <label className={ui.label}>M-PESA / Bank Reference</label>
                  <input value={payRef} onChange={(e) => setPayRef(e.target.value)} required className={ui.input} placeholder="e.g. SLK89X21" />
                </div>
              </div>
              <button type="submit" disabled={busy || isReadOnly} className={ui.btnPrimary}><ShieldCheck className="w-4 h-4" /> Post Payment</button>
            </form>
          )}

          {/* Transactions & Reversal */}
          <div className={ui.cardPadded}>
            <h3 className={ui.sectionTitle}>Posted Transactions ({transactions.length})</h3>
            <div className="mt-3 divide-y divide-slate-100">
              {transactions.map((tx) => (
                <div key={tx.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-sm text-slate-900">{tx.provider_tx_id} &middot; {fmtMoney(currency, tx.amount)}</div>
                    <div className={ui.muted}>{tx.status} &middot; {tx.paid_at?.slice(0, 10)}</div>
                  </div>
                  {!isReadOnly && !isCaretaker && tx.status !== 'REVERSED' && (
                    <button
                      type="button"
                      onClick={() =>
                        runAction(async () => {
                          const { error: err } = await supabase.rpc('rpc_reverse_rental_payment', {
                            p_org_id: orgId,
                            p_transaction_id: tx.id,
                            p_reason: 'Reversed from Rental Operations'
                          });
                          if (err) throw err;
                        }, `Transaction ${tx.provider_tx_id} reversed.`)
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Reverse
                    </button>
                  )}
                </div>
              ))}
              {transactions.length === 0 && <p className="py-3 text-sm text-slate-500">No payments posted yet.</p>}
            </div>
          </div>
        </div>
      ) : tab === 'OWNERS' ? (
        <div className={ui.cardPadded}>
          <h3 className={ui.sectionTitle}>Unclaimed Owner Client-Money Balances</h3>
          <div className="mt-3 divide-y divide-slate-100">
            {ownerPayables.map((row) => (
              <div key={`${row.ownerId}:${row.propertyId}`} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-sm text-slate-900">{ownerMap.get(row.ownerId)?.name || 'Owner'}</div>
                  <div className={ui.muted}>{propMap.get(row.propertyId)?.name}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-sm text-slate-900">{fmtMoney(currency, row.balance)}</span>
                  {!isReadOnly && !isCaretaker && (
                    <button
                      type="button"
                      onClick={() =>
                        runAction(async () => {
                          const today = new Date().toISOString().slice(0, 10);
                          const { error: err } = await supabase.rpc('rpc_calculate_and_post_owner_remittance', {
                            p_org_id: orgId,
                            p_owner_id: row.ownerId,
                            p_property_id: row.propertyId,
                            p_start: `${today.slice(0, 7)}-01`,
                            p_end: today,
                            p_idempotency_key: `REM-${row.ownerId}-${row.propertyId}-${Date.now()}`
                          });
                          if (err) throw err;
                        }, 'Owner remittance posted.')
                      }
                      className={ui.btnPrimary}
                    >
                      Remit Balance
                    </button>
                  )}
                </div>
              </div>
            ))}
            {ownerPayables.length === 0 && <p className="py-3 text-sm text-slate-500">No unclaimed owner balances.</p>}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runAction(async () => {
                const { error: err } = await supabase.from('rental_maintenance_requests').insert({
                  org_id: orgId,
                  property_id: maintPropId,
                  unit_id: maintUnitId,
                  description: maintDesc.trim(),
                  priority: maintPriority
                });
                if (err) throw err;
                setMaintDesc('');
              }, 'Maintenance request logged.');
            }}
            className={`${ui.cardPadded} space-y-3`}
          >
            <h3 className={ui.sectionTitle}>Log Maintenance Request</h3>
            <div>
              <label className={ui.label}>Property</label>
              <select value={maintPropId} onChange={(e) => { setMaintPropId(e.target.value); setMaintUnitId(''); }} required className={ui.select}>
                <option value="">Select property...</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={ui.label}>Unit</label>
              <select value={maintUnitId} onChange={(e) => setMaintUnitId(e.target.value)} required className={ui.select}>
                <option value="">Select unit...</option>
                {units.filter((u) => u.property_id === maintPropId).map((u) => <option key={u.id} value={u.id}>{u.unit_code}</option>)}
              </select>
            </div>
            <div>
              <label className={ui.label}>Priority</label>
              <select value={maintPriority} onChange={(e) => setMaintPriority(e.target.value as any)} className={ui.select}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
            <div>
              <label className={ui.label}>Issue Description</label>
              <input value={maintDesc} onChange={(e) => setMaintDesc(e.target.value)} required className={ui.input} placeholder="e.g. Leaking kitchen sink tap" />
            </div>
            <button type="submit" disabled={busy || isReadOnly} className={ui.btnPrimary}><Plus className="w-4 h-4" /> Submit Request</button>
          </form>

          <div className={`${ui.cardPadded} space-y-3`}>
            <h3 className={ui.sectionTitle}>Maintenance Log ({maintenance.length})</h3>
            <div className="divide-y divide-slate-100">
              {maintenance.map((m) => (
                <div key={m.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-sm text-slate-900">{m.description}</div>
                    <div className={ui.muted}>{propMap.get(m.property_id)?.name} &middot; {unitMap.get(m.unit_id)?.unit_code} &middot; {m.priority}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">{m.status}</span>
                    {!isReadOnly && m.status !== 'COMPLETED' && (
                      <button
                        type="button"
                        onClick={() =>
                          runAction(async () => {
                            const { error: err } = await supabase
                              .from('rental_maintenance_requests')
                              .update({ status: 'COMPLETED' })
                              .eq('id', m.id)
                              .eq('org_id', orgId);
                            if (err) throw err;
                          }, 'Maintenance request marked completed.')
                        }
                        className="px-2.5 py-1 rounded-lg border border-emerald-200 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {maintenance.length === 0 && <p className="py-3 text-sm text-slate-500">No maintenance requests logged yet.</p>}
            </div>
          </div>
        </div>
      )}

      {/* Tenant Monthly Bill Document Preview / Print / Share Modal */}
      {activeBillModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-slate-800" />
                <h3 className="text-base font-bold text-slate-900">Tenant Monthly Rent &amp; Utility Statement</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveBillModal(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto print:p-0">
              {(() => {
                const ten = tenancyMap.get(activeBillModal.tenancyId);
                const tenant = ten ? custMap.get(ten.customer_id) : null;
                const prop = propMap.get(activeBillModal.propertyId);
                const unit = ten ? unitMap.get(ten.unit_id) : null;
                const activeAccounts = collectionAccounts.filter((a) => a.is_active);
                return (
                  <>
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-200 pb-4">
                      <div>
                        <div className="text-lg font-bold text-slate-900">{effectiveOrgName}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{prop?.name || 'Rental Property'}</div>
                      </div>
                      <div className="sm:text-right">
                        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Statement / Bill</div>
                        <div className="font-mono text-sm font-bold text-slate-900">{activeBillModal.billNumber}</div>
                        <div className="text-xs text-slate-600 mt-0.5">
                          Billing Period: <span className="font-semibold">{activeBillModal.billingPeriod}</span>
                        </div>
                        <div className="text-xs text-rose-600 font-semibold">Due Date: {activeBillModal.dueDate}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 border border-slate-200 text-xs">
                      <div>
                        <div className="font-semibold uppercase tracking-wider text-slate-400">Billed To</div>
                        <div className="mt-1 text-sm font-bold text-slate-900">{tenant?.name || 'Tenant'}</div>
                        {tenant?.phone && <div className="text-slate-600">{tenant.phone}</div>}
                        {tenant?.email && <div className="text-slate-600">{tenant.email}</div>}
                      </div>
                      <div className="sm:text-right">
                        <div className="font-semibold uppercase tracking-wider text-slate-400">Unit &amp; Payment Ref</div>
                        <div className="mt-1 text-sm font-bold text-slate-900">
                          Unit {unit?.unit_code || '—'} ({unit?.category || 'Residential'})
                        </div>
                        <div className="text-slate-600">
                          Lease Payment Ref: <span className="font-mono font-bold text-slate-900">{ten?.payment_ref || '—'}</span>
                        </div>
                      </div>
                    </div>

                    <table className="w-full min-w-[540px] text-left border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b-2 border-slate-200 text-slate-600">
                          <th className="py-2 pr-3 font-semibold">Charge Description</th>
                          <th className="py-2 px-3 font-semibold">Type</th>
                          <th className="py-2 pl-3 text-right font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeBillModal.items.map((item) => (
                          <tr key={item.id}>
                            <td className="py-2.5 pr-3 text-slate-900 font-medium">
                              {item.description ||
                                (item.charge_type === 'RENT'
                                  ? `Monthly Rent (${activeBillModal.billingPeriod})`
                                  : item.charge_type === 'WATER'
                                  ? 'Water Usage Charge'
                                  : item.charge_type === 'GARBAGE' || item.charge_type === 'SERVICE_CHARGE'
                                  ? 'Monthly Garbage Collection'
                                  : item.charge_type)}
                            </td>
                            <td className="py-2.5 px-3 text-xs text-slate-500">{item.charge_type}</td>
                            <td className="py-2.5 pl-3 text-right font-semibold text-slate-900">
                              {fmtMoney(currency, item.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-900">
                          <td colSpan={2} className="py-3 pr-3 text-right font-bold text-slate-900">
                            Total Payable Before {activeBillModal.dueDate}
                          </td>
                          <td className="py-3 pl-3 text-right text-base font-extrabold text-slate-900">
                            {fmtMoney(currency, activeBillModal.totalAmount)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1">
                      <div className="font-bold text-slate-800">Payment Instructions</div>
                      {activeAccounts.length > 0 ? (
                        activeAccounts.map((acc) => (
                          <div key={acc.id} className="text-slate-600">
                            &bull; <span className="font-semibold text-slate-800">{acc.account_type}</span> ({acc.provider}):{' '}
                            <span className="font-mono font-bold text-slate-900">{acc.account_identifier}</span> &mdash; Account/Ref:{' '}
                            <span className="font-mono font-bold text-slate-900">{ten?.payment_ref || ''}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-slate-600">
                          Quote Payment Reference <span className="font-mono font-bold text-slate-900">{ten?.payment_ref || ''}</span> when making payment.
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3.5 print:hidden">
              <button
                type="button"
                onClick={() => handleShareBill(activeBillModal)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                {sharedFeedback ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                {sharedFeedback ? 'Shared!' : 'Share'}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className={ui.btnSecondary}
                >
                  <Printer className="w-4 h-4" /> Print / Save PDF
                </button>
                <button
                  type="button"
                  onClick={() => setActiveBillModal(null)}
                  className={ui.btnDark}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Property State & Vacancy Report Preview / Share / PDF Modal */}
      {showPropertyReportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="property-report-title"
        >
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl border border-slate-200 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-slate-800" />
                <h3 id="property-report-title" className="text-base font-bold text-slate-900">
                  Property State &amp; Vacancy Report
                </h3>
              </div>

              <div className="flex items-center gap-2">
                {properties.length > 1 && (
                  <select
                    aria-label="Select property for report"
                    value={reportPropertyId}
                    onChange={(e) => setReportPropertyId(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 print:hidden"
                  >
                    <option value="ALL">All Properties ({properties.length})</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.ref_code})
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => setShowPropertyReportModal(false)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                  aria-label="Close property report"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto print:p-0">
              {(() => {
                const todayStr = new Date().toISOString().slice(0, 10);
                const {
                  rows,
                  selectedProp,
                  scopeLabel,
                  totalUnits,
                  occupiedUnits,
                  vacantUnitsCount,
                  occupancyPct,
                  totalExpectedRent,
                  totalVacantLoss,
                  totalArrears,
                  totalOpenMaint,
                  vacantSchedule
                } = activeReportData;

                return (
                  <>
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-200 pb-4">
                      <div>
                        <div className="text-lg font-bold text-slate-900">{effectiveOrgName}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {[org?.phone, org?.email, org?.address].filter(Boolean).join(' · ') || 'Portfolio Occupancy & Vacancy Summary'}
                        </div>
                        <div className="mt-1 inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">
                          Scope: {scopeLabel}
                        </div>
                      </div>
                      <div className="sm:text-right">
                        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Management Report</div>
                        <div className="font-mono text-sm font-bold text-slate-900">
                          PROP-STATE-{todayStr.replace(/-/g, '')}
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">Report Date: {todayStr}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold uppercase text-slate-500">Occupancy</div>
                        <div className="mt-1 text-base font-bold text-slate-900">
                          {occupiedUnits} / {totalUnits} ({occupancyPct}%)
                        </div>
                        <div className="text-xs text-slate-500">{vacantUnitsCount} vacant unit(s)</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold uppercase text-slate-500">Occupied Rent Roll</div>
                        <div className="mt-1 text-base font-bold text-emerald-700">
                          {fmtMoney(currency, totalExpectedRent)}
                        </div>
                        <div className="text-xs text-slate-500">Active monthly roll</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold uppercase text-slate-500">Vacant Potential</div>
                        <div className="mt-1 text-base font-bold text-amber-700">
                          {fmtMoney(currency, totalVacantLoss)}
                        </div>
                        <div className="text-xs text-slate-500">Unlet monthly value</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold uppercase text-slate-500">Arrears &amp; Maint.</div>
                        <div className="mt-1 text-base font-bold text-slate-900">
                          {fmtMoney(currency, totalArrears)}
                        </div>
                        <div className="text-xs text-slate-500">{totalOpenMaint} open ticket(s)</div>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                        1. Property Occupancy &amp; Financial State
                      </h4>
                      <div className="overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="w-full min-w-[540px] text-left border-collapse text-xs sm:text-sm">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                              <th className="py-2 px-3 font-semibold">Property</th>
                              <th className="py-2 px-3 font-semibold">Occupied</th>
                              <th className="py-2 px-3 font-semibold">Vacant Units</th>
                              <th className="py-2 px-3 text-right font-semibold">Occupied Rent</th>
                              <th className="py-2 px-3 text-right font-semibold">Arrears</th>
                              <th className="py-2 px-3 text-right font-semibold">Maint.</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {rows.map((row) => (
                              <tr key={row.property.id}>
                                <td className="py-2 px-3 font-semibold text-slate-900">
                                  {row.property.name}{' '}
                                  <span className="text-xs font-normal text-slate-500">({row.property.ref_code})</span>
                                </td>
                                <td className="py-2 px-3 text-emerald-700 font-semibold">
                                  {row.occupiedCount} / {row.totalUnits}
                                </td>
                                <td className="py-2 px-3 text-slate-700">
                                  {row.vacantCount > 0
                                    ? `${row.vacantCount} (${row.vacantUnits.map((v: any) => v.unit_code).join(', ')})`
                                    : '0 (Full)'}
                                </td>
                                <td className="py-2 px-3 text-right font-semibold text-slate-900">
                                  {fmtMoney(currency, row.expectedRentRoll)}
                                </td>
                                <td className="py-2 px-3 text-right font-semibold text-amber-700">
                                  {fmtMoney(currency, row.openArrears)}
                                </td>
                                <td className="py-2 px-3 text-right text-slate-700">{row.openTickets}</td>
                              </tr>
                            ))}
                          </tbody>
                          {!selectedProp && (
                            <tfoot>
                              <tr className="border-t-2 border-slate-900 bg-slate-50 font-bold text-slate-900">
                                <td className="py-2.5 px-3">PORTFOLIO TOTAL</td>
                                <td className="py-2.5 px-3">{occupiedUnits} / {totalUnits}</td>
                                <td className="py-2.5 px-3">{vacantUnitsCount} vacant</td>
                                <td className="py-2.5 px-3 text-right">{fmtMoney(currency, totalExpectedRent)}</td>
                                <td className="py-2.5 px-3 text-right">{fmtMoney(currency, totalArrears)}</td>
                                <td className="py-2.5 px-3 text-right">{totalOpenMaint}</td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                        2. Vacant Units Schedule ({vacantSchedule.length})
                      </h4>
                      {vacantSchedule.length === 0 ? (
                        <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
                          All units in this scope are currently occupied (0 vacant units).
                        </p>
                      ) : (
                        <div className="overflow-x-auto border border-slate-200 rounded-xl">
                          <table className="w-full min-w-[540px] text-left border-collapse text-xs sm:text-sm">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                                <th className="py-2 px-3 font-semibold">Property</th>
                                <th className="py-2 px-3 font-semibold">Unit Code</th>
                                <th className="py-2 px-3 font-semibold">Type</th>
                                <th className="py-2 px-3 text-right font-semibold">Security Deposit</th>
                                <th className="py-2 px-3 text-right font-semibold">Asking Rent / Mo</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {vacantSchedule.map((v, idx) => (
                                <tr key={`${v.refCode}-${v.unitCode}-${idx}`}>
                                  <td className="py-2 px-3 text-slate-900">{v.propertyName}</td>
                                  <td className="py-2 px-3 font-mono font-bold text-slate-900">{v.unitCode}</td>
                                  <td className="py-2 px-3 text-slate-600">{v.category}</td>
                                  <td className="py-2 px-3 text-right text-slate-700">
                                    {fmtMoney(currency, v.depositAmount)}
                                  </td>
                                  <td className="py-2 px-3 text-right font-bold text-slate-900">
                                    {fmtMoney(currency, v.monthlyRent)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3.5 print:hidden">
              <button
                type="button"
                onClick={handleSharePropertySummary}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                {sharedReportFeedback ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                {sharedReportFeedback ? 'Shared!' : 'Share Report'}
              </button>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => window.print()} className={ui.btnSecondary}>
                  <Printer className="w-4 h-4" /> Print
                </button>
                <button type="button" onClick={handleDownloadPropertySummaryPdf} className={ui.btnSecondary}>
                  <Download className="w-4 h-4 text-blue-600" /> Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => setShowPropertyReportModal(false)}
                  className={ui.btnDark}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}