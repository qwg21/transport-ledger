'use client';

import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react';
import { supabase } from '@/lib/supabase';
import { buildPdfDocument } from '@/lib/pdf';
import { ui } from '@/lib/ui';
import {
  applyPaymentTotals,
  buildDocNumber,
  csvCell,
  explainDbError,
  invoiceBalance,
  todayLocal
} from '@/lib/documents';
import { hasCapability, resolveEntitlements } from '@/lib/entitlements';
import {
  deductStockForDocument,
  getStockShortfalls,
  restoreStockForVoidedDocument,
  topUpStockShortfalls,
  type StockShortfall
} from '@/lib/inventorySync';
import type {
  Customer,
  DocumentRecord,
  Membership,
  Product,
  Subscription,
  User
} from '@/lib/types';
import AuthScreen from '@/components/AuthScreen';
import CataloguesSection from '@/components/CataloguesSection';
import SalesDocumentsTable from '@/components/SalesDocumentsTable';
import ExpensesTable, { type ExpenseWithReceipt } from '@/components/ExpensesTable';
import DocumentModal from '@/components/DocumentModal';
import SettingsForm from '@/components/SettingsForm';
import IntelligenceSection from '@/components/IntelligenceSection';
import InventorySection from '@/components/InventorySection';
import ReportsSection from '@/components/ReportsSection';
import StatementsSection from '@/components/StatementsSection';
import RentalsSection from '@/components/RentalsSection';
import TransportSection, {
  type Driver,
  type TransportTab,
  type Trip,
  type Vehicle,
  type VehicleCost
} from '@/components/TransportSection';
import {
  LayoutDashboard,
  FileText,
  ReceiptText,
  Settings,
  LogOut,
  Plus,
  PlusCircle,
  FileSpreadsheet,
  Download,
  Share2,
  Search,
  Calendar,
  X,
  Building2,
  AlertCircle,
  AlertTriangle,
  Users,
  Package,
  PackageCheck,
  Scale,
  Truck,
  Menu,
  MapPin,
  Fuel,
  BarChart3,
  Home,
  LayoutGrid,
  Landmark,
  Wallet,
  Wrench
} from 'lucide-react';

type Section =
  | 'OVERVIEW'
  | 'SALES'
  | 'STATEMENTS'
  | 'EXPENSES'
  | 'CUSTOMERS'
  | 'CATALOGUE'
  | 'INVENTORY'
  | 'REPORTS'
  | 'TRANSPORT'
  | 'RENTALS'
  | 'RENTALS_OVERVIEW'
  | 'RENTALS_PROPERTIES'
  | 'RENTALS_TENANCIES'
  | 'RENTALS_COLLECTIONS'
  | 'RENTALS_MAINTENANCE'
  | 'RENTALS_OWNERS'
  | 'INTELLIGENCE'
  | 'SETTINGS';

const PAGE_SIZE = 25;
const PLATFORM_ADMIN_EMAIL = 'quentinwg2015@gmail.com';

const EXPENSE_CATEGORIES = [
  'Stock / Inventory & Supplies',
  'Rent, Utilities & Internet',
  'Salaries, Wages & Contractors',
  'Fuel & Transport',
  'Repairs & Maintenance',
  'Software, Hosting & Subscriptions',
  'Marketing & Advertising',
  'Insurance, Licenses & Compliance',
  'Professional & Legal Fees',
  'Other Operational'
];

const PAYMENT_METHODS = [
  'M-PESA',
  'Bank Transfer / EFT',
  'Card / POS',
  'Cash',
  'Cheque',
  'Online (PayPal / Stripe)'
];

const MONTHS = [
  { value: 'ALL', label: 'All Months' },
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' }
];

export default function AccountingApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [org, setOrg] = useState<Membership | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseWithReceipt[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicleCosts, setVehicleCosts] = useState<VehicleCost[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Navigation & Filters
  const [section, setSection] = useState<Section>('OVERVIEW');
  const [transportTab, setTransportTab] = useState<TransportTab>('TRIPS');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [salesTab, setSalesTab] = useState<'ALL' | 'QUOTE' | 'INVOICE' | 'RECEIPT'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [docLimit, setDocLimit] = useState(PAGE_SIZE);
  const [expenseLimit, setExpenseLimit] = useState(PAGE_SIZE);

  // Modals
  const [showDocModal, setShowDocModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [previewPdf, setPreviewPdf] = useState<{ url: string; item: DocumentRecord } | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<DocumentRecord | null>(null);

  // Receipt Modal State
  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptMethod, setReceiptMethod] = useState('M-PESA');
  const [receiptRef, setReceiptRef] = useState('');
  const [receiptDate, setReceiptDate] = useState(todayLocal);

  // Expense Form State
  const [expenseCategory, setExpenseCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [expenseDate, setExpenseDate] = useState(todayLocal);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [vendor, setVendor] = useState('');
  const [notes, setNotes] = useState('');
  const [expenseReceiptFile, setExpenseReceiptFile] = useState<File | null>(null);

  const [quoteShortfallModal, setQuoteShortfallModal] = useState<{
    quote: DocumentRecord;
    shortfalls: Array<StockShortfall & { receiveQty: string; receiveCost: string }>;
  } | null>(null);

  const loadUserAndOrgs = useCallback(async () => {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    setUser(currentUser);
    setAuthChecked(true);

    if (!currentUser) return;

    await supabase.rpc('claim_my_invites');

    const { data: memberRows, error } = await supabase
      .from('organization_members')
      .select('org_id, role, organizations(*)')
      .eq('user_id', currentUser.id);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const list = (memberRows ?? []).map(row => {
      const joined = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
      return { ...(joined as object), role: row.role } as Membership;
    });

    setMemberships(list);
    setOrg(prev => list.find(m => m.id === prev?.id) ?? list[0] ?? null);
  }, []);

  const loadRequestId = useRef(0);

  const loadOrgData = useCallback(async (orgId: string) => {
    const requestId = ++loadRequestId.current;

    const [docRes, expRes, custRes, prodRes, subRes] = await Promise.all([
      supabase
        .from('documents')
        .select('*, document_items(*)')
        .eq('org_id', orgId)
        .order('issue_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('expenses')
        .select('*')
        .eq('org_id', orgId)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('customers').select('*').eq('org_id', orgId).order('name'),
      supabase.from('products_services').select('*').eq('org_id', orgId).order('name'),
      supabase.from('subscriptions').select('*').eq('org_id', orgId).maybeSingle()
    ]);

    if (requestId !== loadRequestId.current) return;

    const loadedSub = (subRes.data as Subscription | null) ?? null;
    setCustomers((custRes.data as Customer[] | null) ?? []);
    setProducts((prodRes.data as Product[] | null) ?? []);
    setSub(loadedSub);

    const loadedEntitlements = resolveEntitlements(loadedSub, 'owner', todayLocal());
    const loadedHasRentals =
      hasCapability(loadedEntitlements, 'rentals.properties');
    const loadedHasTransport =
      hasCapability(loadedEntitlements, 'transport.trips');
    const loadedHasStock =
      hasCapability(loadedEntitlements, 'inventory.stock_control');
    if (loadedHasRentals && !loadedHasTransport && !loadedHasStock) {
      setSection(previous =>
        previous === 'OVERVIEW' || previous === 'RENTALS'
          ? 'RENTALS_OVERVIEW'
          : previous
      );
    }

    if (!docRes.error) setDocs(applyPaymentTotals((docRes.data as DocumentRecord[] | null) ?? []));
    if (!expRes.error) setExpenses((expRes.data as ExpenseWithReceipt[] | null) ?? []);

    const transportEnabled = Boolean(
      loadedSub?.transport_addon || loadedSub?.enabled_modules?.includes('TRANSPORT')
    );

    if (transportEnabled) {
      const [vRes, dRes, tRes, cRes] = await Promise.all([
        supabase.from('vehicles').select('*').eq('org_id', orgId).order('registration_no'),
        supabase.from('drivers').select('*').eq('org_id', orgId).order('full_name'),
        supabase.from('trips').select('*').eq('org_id', orgId).order('trip_date', { ascending: false }).limit(50),
        supabase.from('vehicle_costs').select('*').eq('org_id', orgId).order('cost_date', { ascending: false }).limit(50)
      ]);
      if (requestId !== loadRequestId.current) return;
      setVehicles((vRes.data as Vehicle[] | null) ?? []);
      setDrivers((dRes.data as Driver[] | null) ?? []);
      setTrips((tRes.data as Trip[] | null) ?? []);
      setVehicleCosts((cRes.data as VehicleCost[] | null) ?? []);
    } else {
      setVehicles([]);
      setDrivers([]);
      setTrips([]);
      setVehicleCosts([]);
    }

    const messages = [docRes.error?.message, expRes.error?.message].filter(Boolean);
    setErrorMessage(messages.length > 0 ? messages.join(' | ') : null);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load: state is only set after the awaited request resolves
    loadUserAndOrgs();
  }, [loadUserAndOrgs]);

  const orgId = org?.id;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load: state is only set after the awaited request resolves
    if (orgId) loadOrgData(orgId);
  }, [orgId, loadOrgData]);

  // Pre-cache remote Storage logo as a Data URL so jsPDF can embed it synchronously.
  const orgLogoUrl = org?.logo_url;
  useEffect(() => {
    let cancelled = false;
    if (!orgLogoUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the previous business logo when the selected business changes
      setLogoDataUrl(null);
      return;
    }
    if (orgLogoUrl.startsWith('data:')) {
      setLogoDataUrl(orgLogoUrl);
      return;
    }
    fetch(orgLogoUrl)
      .then(res => res.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (!cancelled) setLogoDataUrl(reader.result as string);
        };
        reader.readAsDataURL(blob);
      })
      .catch(() => {
        if (!cancelled) setLogoDataUrl(null);
      });
    return () => { cancelled = true; };
  }, [orgLogoUrl]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (quoteShortfallModal) setQuoteShortfallModal(null);
        else if (receiptTarget) setReceiptTarget(null);
        else if (showExpenseModal) setShowExpenseModal(false);
        else if (showDocModal) setShowDocModal(false);
        else if (previewPdf) setPreviewPdf(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [quoteShortfallModal, receiptTarget, showExpenseModal, showDocModal, previewPdf]);

  const deferredSearchQuery = useDeferredValue(searchQuery);

  const availableYears = useMemo(() => {
    return Array.from(
      new Set([...docs.map(d => (d.issue_date || '').slice(0, 4)), ...expenses.map(e => (e.expense_date || '').slice(0, 4))].filter(Boolean))
    ).sort((a, b) => b.localeCompare(a));
  }, [docs, expenses]);

  const matchesDate = useCallback((dateStr: string) => {
    if (!dateStr) return true;
    const [y, m] = dateStr.split('-');
    if (selectedYear !== 'ALL' && y !== selectedYear) return false;
    if (selectedMonth !== 'ALL' && m !== selectedMonth) return false;
    return true;
  }, [selectedYear, selectedMonth]);

  const q = deferredSearchQuery.trim().toLowerCase();
  const dateDocs = useMemo(() => docs.filter(d => matchesDate(d.issue_date)), [docs, matchesDate]);
  const dateExpenses = useMemo(() => expenses.filter(e => {
    if (!matchesDate(e.expense_date)) return false;
    if (!q) return true;
    return (e.category || '').toLowerCase().includes(q) || (e.vendor || '').toLowerCase().includes(q) || (e.notes || '').toLowerCase().includes(q);
  }), [expenses, matchesDate, q]);

  const filteredDocs = useMemo(() => dateDocs.filter(d => {
    if (salesTab !== 'ALL' && d.doc_type !== salesTab) return false;
    if (!q) return true;
    return (
      (d.doc_number || '').toLowerCase().includes(q) ||
      (d.chain_code || '').toLowerCase().includes(q) ||
      (d.customer_name || '').toLowerCase().includes(q) ||
      (d.description || '').toLowerCase().includes(q) ||
      (d.payment_ref || '').toLowerCase().includes(q)
    );
  }), [dateDocs, salesTab, q]);

  const currency = org?.currency || 'KES';
  const invoicedSales = useMemo(() => dateDocs
    .filter(d => d.doc_type === 'INVOICE' && d.status !== 'VOID')
    .reduce((s, d) => s + Number(d.amount || 0), 0), [dateDocs]);
  const cashCollected = useMemo(() => dateDocs
    .filter(d => d.doc_type === 'RECEIPT' && d.status !== 'VOID')
    .reduce((s, d) => s + Number(d.amount || 0), 0), [dateDocs]);
  const receivables = useMemo(() => dateDocs.reduce((sum, d) => sum + invoiceBalance(d), 0), [dateDocs]);
  const totalExpenses = useMemo(() => dateExpenses.reduce((s, e) => s + Number(e.amount_kes || 0), 0), [dateExpenses]);
  const netCashPosition = useMemo(() => cashCollected - totalExpenses, [cashCollected, totalExpenses]);

  const entitlements = useMemo(() => resolveEntitlements(sub, org?.role ?? 'owner', todayLocal()), [sub, org?.role]);
  const subscriptionLocked = !entitlements.canWrite;
  const isGrowthPlus =
    hasCapability(entitlements, 'inventory.stock_control') ||
    hasCapability(entitlements, 'core.suppliers_ap');
  const isIntelligencePlus = hasCapability(entitlements, 'intelligence.bi');
  const canManageSuppliersAp = hasCapability(entitlements, 'core.suppliers_ap');
  const canManageStockControl = hasCapability(entitlements, 'inventory.stock_control');
  const canViewGlStatements = hasCapability(entitlements, 'core.gl_statements');
  const enabledModules = useMemo(() => Array.from(entitlements.modules), [entitlements.modules]);
  const hasTransportAddon = hasCapability(entitlements, 'transport.trips');
  const hasRentalsAddon = hasCapability(entitlements, 'rentals.properties');
  const canManageOwners = hasCapability(entitlements, 'rentals.owners_remittances');
  const isRentalsOnlySpecialist =
    hasRentalsAddon && !hasTransportAddon && !canManageStockControl;

  // Transport Command metrics (active only when hasTransportAddon is true)
  const activeVehiclesCount = useMemo(() => vehicles.filter(v => v.status === 'ACTIVE').length, [vehicles]);
  const maintenanceVehiclesCount = useMemo(() => vehicles.filter(v => v.status === 'MAINTENANCE').length, [vehicles]);
  const activeDriversCount = useMemo(() => drivers.filter(d => d.status === 'ACTIVE').length, [drivers]);
  const upcomingTrips = useMemo(() => trips.filter(t => t.status === 'SCHEDULED' || t.status === 'IN_PROGRESS'), [trips]);
  const activeTripsList = useMemo(() => trips.filter(t => t.status !== 'CANCELLED'), [trips]);
  const totalTripFares = useMemo(() => activeTripsList.reduce((s, t) => s + Number(t.agreed_fare), 0), [activeTripsList]);
  const totalFleetCosts = useMemo(() => vehicleCosts.reduce((s, c) => s + Number(c.amount_kes), 0), [vehicleCosts]);
  const netFleetMargin = useMemo(() => totalTripFares - totalFleetCosts, [totalTripFares, totalFleetCosts]);

  const today = todayLocal();
  const driverLicenseAlerts = useMemo(() => drivers.filter(d => {
    if (!d.license_expiry) return false;
    if (d.license_expiry < today) return true;
    const diffDays = (new Date(d.license_expiry).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= 30;
  }), [drivers, today]);

  const vehicleById = useMemo(() => new Map(vehicles.map(v => [v.id, v])), [vehicles]);
  const driverById = useMemo(() => new Map(drivers.map(d => [d.id, d])), [drivers]);

  const vehicleBreakdown = useMemo(() => vehicles.map(v => {
    const rev = activeTripsList
      .filter(t => t.vehicle_id === v.id)
      .reduce((s, t) => s + Number(t.agreed_fare), 0);
    const cost = vehicleCosts
      .filter(c => c.vehicle_id === v.id)
      .reduce((s, c) => s + Number(c.amount_kes), 0);
    const tripCount = activeTripsList.filter(t => t.vehicle_id === v.id).length;
    return { vehicle: v, rev, cost, margin: rev - cost, tripCount };
  }), [vehicles, activeTripsList, vehicleCosts]);

  // Early auth/workspace returns now safely sit AFTER all Hooks
  if (!authChecked) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">Loading workspace...</div>;
  }

  if (!user) {
    return <AuthScreen onAuthenticated={loadUserAndOrgs} />;
  }

  if (memberships.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-lg max-w-md w-full p-8 text-center space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Account Pending Activation</h2>
          <p className="text-sm text-slate-500">
            Your account ({user.email}) is active, but no business workspace has been assigned to it yet. Please contact your platform administrator.
          </p>
          <div className="flex flex-col gap-2 pt-2">
            {user.email?.toLowerCase() === PLATFORM_ADMIN_EMAIL && (
              <a href="/admin" className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-sm font-semibold">
                Open Platform Admin Console
              </a>
            )}
            <button
              onClick={async () => { await supabase.auth.signOut(); setUser(null); }}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const openTransportTab = (nextTab: TransportTab) => {
    setTransportTab(nextTab);
    setSection('TRANSPORT');
    setMobileNavOpen(false);
  };

  const handleDeleteQuote = async (quote: DocumentRecord) => {
    if (!org) return;
    if (subscriptionLocked) {
      alert('This workspace is read-only until its subscription is renewed.');
      return;
    }
    if (!window.confirm(`Delete quotation ${quote.doc_number}?`)) return;

    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('id', quote.id)
      .eq('doc_type', 'QUOTE')
      .eq('status', 'ACTIVE');

    if (error) alert(error.message);
    else loadOrgData(org.id);
  };

  const handleVoidInvoice = async (invoice: DocumentRecord) => {
    if (!org) return;
    if (subscriptionLocked) {
      alert('This workspace is read-only until its subscription is renewed.');
      return;
    }
    if (!window.confirm(`Void invoice ${invoice.doc_number}? This keeps the invoice number for your audit trail, removes it from receivables, and restores any deducted stock.`)) return;

    const { data: voided, error } = await supabase
      .from('documents')
      .update({ status: 'VOID' })
      .eq('id', invoice.id)
      .eq('doc_type', 'INVOICE')
      .eq('status', 'UNPAID')
      .select('id');

    if (error) {
      alert(error.message);
      return;
    }
    if (!voided || voided.length === 0) {
      alert('This invoice can no longer be voided.');
      return;
    }

    const restoreRes = await restoreStockForVoidedDocument(
      org.id,
      invoice.id,
      invoice.doc_number
    );
    if (!restoreRes.ok) {
      alert(`Invoice voided, but stock restoration failed: ${restoreRes.error}`);
    }

    await loadOrgData(org.id);
  };

  const handleConvertToInvoice = async (
    quote: DocumentRecord,
    confirmedTopUps?: Array<{ variantId: string; addQty: number; unitCost: number; note: string }>
  ) => {
    if (isSubmitting || !org) return;
    if (subscriptionLocked) {
      alert('This workspace is read-only until its subscription is renewed.');
      return;
    }
    if (docs.some(d => d.doc_type === 'INVOICE' && d.chain_code === quote.chain_code && d.status !== 'VOID')) {
      alert(`${quote.doc_number} already has an invoice.`);
      return;
    }

    if (!confirmedTopUps && quote.document_items && quote.document_items.length > 0) {
      const { shortfalls, error: gapErr } = await getStockShortfalls(org.id, quote.document_items);
      if (gapErr) {
        alert(gapErr);
        return;
      }
      if (shortfalls.length > 0) {
        setQuoteShortfallModal({
          quote,
          shortfalls: shortfalls.map(s => ({
            ...s,
            receiveQty: String(s.shortfall),
            receiveCost: String(s.defaultCostPrice || 0)
          }))
        });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (confirmedTopUps && confirmedTopUps.length > 0) {
        const topUpRes = await topUpStockShortfalls(org.id, confirmedTopUps);
        if (!topUpRes.ok) {
          alert(`Stock restock failed: ${topUpRes.error}`);
          return;
        }
      }

      const { data: newInvoice, error } = await supabase
        .from('documents')
        .insert([{
          org_id: org.id,
          customer_id: quote.customer_id || null,
          doc_type: 'INVOICE',
          chain_code: quote.chain_code,
          doc_number: buildDocNumber('INVOICE', quote.chain_code),
          parent_id: quote.id,
          quote_ref: quote.doc_number,
          issue_date: todayLocal(),
          customer_name: quote.customer_name,
          customer_phone: quote.customer_phone,
          customer_email: quote.customer_email,
          description: quote.description,
          amount: quote.amount,
          amount_paid: 0,
          status: 'UNPAID'
        }])
        .select()
        .single();

      if (error || !newInvoice) {
        alert(error ? explainDbError(error) : 'Could not convert to invoice.');
        return;
      }

      const warnings: string[] = [];

      if (quote.document_items && quote.document_items.length > 0) {
        const { error: itemsErr } = await supabase.from('document_items').insert(
          quote.document_items.map(li => ({
            org_id: org.id,
            document_id: newInvoice.id,
            product_id: li.product_id || null,
            description: li.description,
            quantity: li.quantity,
            unit_price: li.unit_price,
            line_total: li.line_total
          }))
        );
        if (itemsErr) {
          warnings.push(`line items were not copied (${itemsErr.message})`);
        } else {
          const stockRes = await deductStockForDocument(
            org.id,
            newInvoice.id,
            newInvoice.doc_number
          );
          if (!stockRes.ok) {
            warnings.push(`stock could not be deducted (${stockRes.error})`);
          }
        }
      }

      const { error: convertErr } = await supabase
        .from('documents')
        .update({ status: 'CONVERTED' })
        .eq('id', quote.id);
      if (convertErr) warnings.push(`the quotation could not be marked converted (${convertErr.message})`);

      if (warnings.length > 0) alert(`Invoice ${newInvoice.doc_number} created, but ${warnings.join(' and ')}.`);
      await supabase
        .from('trips')
        .update({ invoice_id: newInvoice.id })
        .eq('quote_id', quote.id);
      await loadOrgData(org.id);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !receiptTarget || !org) return;
    if (subscriptionLocked) {
      alert('This workspace is read-only until its subscription is renewed.');
      return;
    }

    const invoice = receiptTarget;
    const remaining = invoiceBalance(invoice);
    const paidNow = parseFloat(receiptAmount);

    if (isNaN(paidNow) || paidNow <= 0 || paidNow > remaining) {
      alert(`Enter an amount between 1 and ${remaining.toLocaleString()}.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.rpc('record_invoice_payment', {
        p_invoice_id: invoice.id,
        p_amount: paidNow,
        p_payment_method: receiptMethod,
        p_payment_ref: receiptRef || (receiptMethod === 'Cash' ? 'CASH' : ''),
        p_payment_date: receiptDate || todayLocal()
      });

      if (error) {
        alert(explainDbError(error));
        return;
      }

      setReceiptTarget(null);
      await loadOrgData(org.id);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (subscriptionLocked) {
      alert('This workspace is read-only until its subscription is renewed.');
      return;
    }
    const amount = parseFloat(expenseAmount);
    if (!org || isNaN(amount) || amount <= 0) {
      alert('Enter an expense amount greater than zero.');
      return;
    }

    setIsSubmitting(true);
    try {
      let receiptUrl: string | null = null;
      if (expenseReceiptFile) {
        const safeName = expenseReceiptFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${org.id}/expenses/${Date.now()}-${safeName}`;
        const { error: uploadErr } = await supabase.storage
          .from('expense-receipts')
          .upload(path, expenseReceiptFile, { upsert: true });

        if (uploadErr) {
          alert(`Receipt upload failed: ${uploadErr.message}`);
          return;
        }
        receiptUrl = path;
      }

      const { error } = await supabase.from('expenses').insert([{
        org_id: org.id,
        category: expenseCategory,
        expense_date: expenseDate || todayLocal(),
        amount_kes: amount,
        vendor: vendor || 'Supplier',
        notes,
        receipt_url: receiptUrl
      }]);

      if (error) alert(error.message);
      else {
        setShowExpenseModal(false);
        setExpenseAmount('');
        setVendor('');
        setNotes('');
        setExpenseReceiptFile(null);
        loadOrgData(org.id);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const orgForPdf = (): Membership => {
    if (!org) throw new Error('Cannot create a PDF without a selected business.');
    return { ...org, logo_url: logoDataUrl ?? org.logo_url };
  };

  const handlePreviewPDF = (item: DocumentRecord) => {
    if (!org) return;
    const pdf = buildPdfDocument(item, orgForPdf(), item.document_items || []);
    setPreviewPdf({ url: pdf.output('bloburl').toString(), item });
  };

  const handleDownloadPDF = (item: DocumentRecord) => {
    if (!org) return;
    buildPdfDocument(item, orgForPdf(), item.document_items || []).save(`${item.doc_number}.pdf`);
  };

  const handleSharePDF = async (item: DocumentRecord) => {
    if (!org) return;
    const pdf = buildPdfDocument(item, orgForPdf(), item.document_items || []);
    const file = new File([pdf.output('blob')], `${item.doc_number}.pdf`, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `${item.doc_number} - ${org.name}` });
        return;
      } catch {
        return;
      }
    }
    pdf.save(`${item.doc_number}.pdf`);
    alert(`Downloaded ${item.doc_number}.pdf! Attach it directly in WhatsApp or Email.`);
  };

  const exportTaxCSV = () => {
    if (!org) return;
    const receipts = dateDocs.filter(d => d.doc_type === 'RECEIPT' && d.status !== 'VOID');
    const rows: unknown[][] = [
      ['Type', 'Doc Ref', 'Chain Code', 'Date', 'Client/Vendor', 'Category/Method', 'Payment Ref', `Amount (${currency})`],
      ...receipts.map(r => [
        'RECEIPT',
        r.doc_number,
        r.chain_code,
        r.issue_date,
        `${r.customer_name}${r.description ? ` - ${r.description}` : ''}`,
        r.payment_method,
        r.payment_ref,
        r.amount
      ]),
      ...dateExpenses.map(x => [
        'EXPENSE', '', '', x.expense_date, x.vendor || 'Expense', x.category, x.notes, x.amount_kes
      ])
    ];
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(org.name || 'Ledger').replace(/\s+/g, '_')}_Records.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  type NavItem = { id: Section; label: string; icon: typeof LayoutDashboard };
  const accountingNavItems: NavItem[] = [
    ...(!hasTransportAddon ? [{ id: 'OVERVIEW' as Section, label: 'Overview', icon: LayoutDashboard }] : []),
    ...(hasRentalsAddon ? [{ id: 'RENTALS' as Section, label: 'Rentals', icon: Home }] : []),
    { id: 'SALES', label: 'Sales & Invoices', icon: FileText },
    ...(canViewGlStatements ? [{ id: 'STATEMENTS' as Section, label: 'Statements', icon: FileSpreadsheet }] : []),
    { id: 'EXPENSES', label: 'Expenses', icon: ReceiptText },
    { id: 'CUSTOMERS', label: 'Customers', icon: Users },
    ...(!hasTransportAddon ? [{ id: 'CATALOGUE' as Section, label: 'Products & Services', icon: Package }] : []),
    ...(canManageStockControl || canManageSuppliersAp
      ? [
          {
            id: 'INVENTORY' as Section,
            label: canManageStockControl ? 'Inventory & Suppliers' : 'Suppliers & Bills',
            icon: canManageStockControl ? PackageCheck : ReceiptText
          }
        ]
      : []),
    ...(canViewGlStatements ? [{ id: 'REPORTS' as Section, label: 'Financial Reports', icon: Scale }] : []),
    ...(isIntelligencePlus ? [{ id: 'INTELLIGENCE' as Section, label: 'Intelligence', icon: BarChart3 }] : []),
    { id: 'SETTINGS', label: 'Branding & Settings', icon: Settings }
  ];

  const rentalOpsNavItems: NavItem[] = [
    { id: 'RENTALS_OVERVIEW', label: 'Overview', icon: LayoutGrid },
    { id: 'RENTALS_PROPERTIES', label: 'Properties & Units', icon: Building2 },
    { id: 'RENTALS_TENANCIES', label: 'Tenancies & Deposits', icon: Users },
    { id: 'RENTALS_COLLECTIONS', label: 'Rent & Collections', icon: ReceiptText },
    { id: 'RENTALS_MAINTENANCE', label: 'Maintenance', icon: Wrench },
    ...(canManageOwners
      ? [{ id: 'RENTALS_OWNERS' as Section, label: 'Owners & Remittances', icon: Landmark }]
      : [])
  ];

  const rentalFinanceNavItems: NavItem[] = [
    { id: 'CUSTOMERS', label: 'Tenants', icon: Users },
    ...(canViewGlStatements
      ? [{ id: 'STATEMENTS' as Section, label: 'Tenant Statements', icon: FileText }]
      : []),
    { id: 'EXPENSES', label: 'Property Expenses', icon: Wallet },
    ...(canViewGlStatements
      ? [{ id: 'REPORTS' as Section, label: 'Financial Reports', icon: Scale }]
      : []),
    ...(isIntelligencePlus
      ? [{ id: 'INTELLIGENCE' as Section, label: 'Intelligence', icon: BarChart3 }]
      : []),
    { id: 'SETTINGS', label: 'Branding & Settings', icon: Settings }
  ];

  const transportNavItems: { label: string; icon: typeof Truck; active: boolean; onClick: () => void }[] = [
    {
      label: 'Transport Command',
      icon: LayoutDashboard,
      active: section === 'OVERVIEW',
      onClick: () => setSection('OVERVIEW')
    },
    {
      label: 'Trips & Charters',
      icon: MapPin,
      active: section === 'TRANSPORT' && transportTab === 'TRIPS',
      onClick: () => openTransportTab('TRIPS')
    },
    {
      label: 'Fleet Vehicles',
      icon: Truck,
      active: section === 'TRANSPORT' && transportTab === 'FLEET',
      onClick: () => openTransportTab('FLEET')
    },
    {
      label: 'Drivers',
      icon: Users,
      active: section === 'TRANSPORT' && transportTab === 'DRIVERS',
      onClick: () => openTransportTab('DRIVERS')
    },
    {
      label: 'Fuel & Fleet Costs',
      icon: Fuel,
      active: section === 'TRANSPORT' && transportTab === 'COSTS',
      onClick: () => openTransportTab('COSTS')
    }
  ];

  const sectionTitle =
    section === 'OVERVIEW'
      ? hasTransportAddon
        ? 'Transport & Fleet Command'
        : 'Business Overview'
      : section === 'SALES'
        ? 'Sales & Invoicing'
        : section === 'STATEMENTS'
          ? 'Statements'
          : section === 'RENTALS_OVERVIEW'
            ? 'Rental Operations'
            : section === 'RENTALS_PROPERTIES'
              ? 'Properties & Units'
              : section === 'RENTALS_TENANCIES'
                ? 'Tenancies & Deposits'
                : section === 'RENTALS_COLLECTIONS'
                  ? 'Rent & Collections'
                  : section === 'RENTALS_MAINTENANCE'
                    ? 'Maintenance'
                    : section === 'RENTALS_OWNERS'
                      ? 'Owners & Remittances'
          : section === 'EXPENSES'
            ? 'Purchases & Expenses'
            : section === 'CUSTOMERS'
              ? 'Customers'
              : section === 'CATALOGUE'
                ? 'Products & Services'
                : section === 'INVENTORY'
                  ? canManageStockControl
                    ? 'Inventory & Suppliers'
                    : 'Suppliers & Bills'
                  : section === 'REPORTS'
                    ? 'Financial Statements'
                    : section === 'TRANSPORT'
                      ? 'Transport Operations'
                      : section === 'RENTALS'
                        ? 'Rentals'
                        : section === 'INTELLIGENCE'
                          ? 'Business Intelligence'
                          : 'Settings';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col md:flex-row font-sans">

      {/* LEFT SIDEBAR (Collapsible on Mobile) */}
      <aside className="w-full md:w-64 bg-white border-b md:border-b-0 md:border-r border-slate-200 px-4 py-3 md:p-5 flex flex-col justify-between shrink-0">
        <div className="space-y-5">
          {/* Mobile Slim Top Bar */}
          <div className="flex md:hidden items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileNavOpen(o => !o)}
                aria-label="Toggle navigation"
                className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shrink-0"
              >
                {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              <span className="font-bold text-base text-slate-900 truncate">{sectionTitle}</span>
            </div>
            <button
              type="button"
              disabled={subscriptionLocked}
              onClick={() => {
                if (section === 'EXPENSES') setShowExpenseModal(true);
                else if (hasTransportAddon && (section === 'OVERVIEW' || section === 'TRANSPORT')) openTransportTab('TRIPS');
                else setShowDocModal(true);
              }}
              aria-label="Quick create"
              className="p-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shrink-0 disabled:opacity-50"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>

          {/* Desktop Sidebar Header */}
          <div className="hidden md:flex items-center gap-3 px-2">
            {org?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- logo URL comes from Supabase Storage or legacy data: URL
              <img src={org.logo_url} alt="Logo" className="w-9 h-9 rounded-lg object-contain border border-slate-200 shrink-0" />
            ) : (
              <div className={`p-2 rounded-lg text-white shrink-0 ${hasTransportAddon ? 'bg-slate-900' : 'bg-blue-600'}`}>
                {hasTransportAddon ? <Truck className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-bold text-sm text-slate-900 truncate">{org?.name}</div>
              <div className="text-xs text-slate-500 truncate">{sub?.plan || 'STARTER'} &middot; {org?.industry}</div>
            </div>
          </div>

          <div className={`${mobileNavOpen ? 'block' : 'hidden'} md:block space-y-5 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100`}>
            {/* Mobile Drawer Business Card */}
            <div className="flex md:hidden items-center gap-3 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200">
              {org?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- logo URL comes from Supabase Storage or legacy data: URL
                <img src={org.logo_url} alt="Logo" className="w-9 h-9 rounded-lg object-contain border border-slate-200 shrink-0" />
              ) : (
                <div className={`p-2 rounded-lg text-white shrink-0 ${hasTransportAddon ? 'bg-slate-900' : 'bg-blue-600'}`}>
                  {hasTransportAddon ? <Truck className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
                </div>
              )}
              <div className="min-w-0">
                <div className="font-bold text-sm text-slate-900 truncate">{org?.name}</div>
                <div className="text-xs text-slate-500 truncate">{sub?.plan || 'STARTER'} &middot; {org?.industry}</div>
              </div>
            </div>
            {/* Business Switcher */}
            {(memberships.length > 1 || user.email?.toLowerCase() === PLATFORM_ADMIN_EMAIL) && (
              <div className="space-y-2">
                {memberships.length > 1 && (
                  <select
                    value={org?.id || ''}
                    onChange={e => {
                      const found = memberships.find(m => m.id === e.target.value);
                      if (!found) return;
                      setDocs([]);
                      setExpenses([]);
                      setSection('OVERVIEW');
                      setMobileNavOpen(false);
                      setOrg(found);
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-700"
                  >
                    {memberships.map(m => (
                      <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                    ))}
                  </select>
                )}
                {user.email?.toLowerCase() === PLATFORM_ADMIN_EMAIL && (
                  <a href="/admin" className="block w-full px-3 text-xs text-blue-600 font-semibold hover:underline">
                    Platform Admin Console
                  </a>
                )}
              </div>
            )}

            {isRentalsOnlySpecialist ? (
              <>
                <div className="space-y-1.5">
                  <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Rental Operations
                  </div>
                  <nav className="flex flex-col gap-1">
                    {rentalOpsNavItems.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSection(item.id);
                          setMobileNavOpen(false);
                        }}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                          section === item.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <item.icon className="w-4 h-4 shrink-0" /> {item.label}
                      </button>
                    ))}
                  </nav>
                </div>

                <div className="space-y-1.5">
                  <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Finance &amp; Books
                  </div>
                  <nav className="flex flex-col gap-1">
                    {rentalFinanceNavItems.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSection(item.id);
                          setMobileNavOpen(false);
                        }}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                          section === item.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <item.icon className="w-4 h-4 shrink-0" /> {item.label}
                      </button>
                    ))}
                  </nav>
                </div>
              </>
            ) : (
              <>
                {hasTransportAddon && (
                  <div className="space-y-1.5">
                    <div className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Transport
                    </div>
                    <nav className="flex flex-col gap-1">
                      {transportNavItems.map(item => (
                        <button
                          key={item.label}
                          onClick={() => {
                            item.onClick();
                            setMobileNavOpen(false);
                          }}
                          className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                            item.active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <item.icon className="w-4 h-4 shrink-0" /> {item.label}
                        </button>
                      ))}
                    </nav>
                  </div>
                )}

                <div className="space-y-1.5">
                  {hasTransportAddon && (
                    <div className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Finance
                    </div>
                  )}
                  <nav className="flex flex-col gap-1">
                    {accountingNavItems.map(item => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setSection(item.id);
                          setMobileNavOpen(false);
                        }}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                          section === item.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <item.icon className="w-4 h-4 shrink-0" /> {item.label}
                      </button>
                    ))}
                  </nav>
                </div>
              </>
            )}

            <div className="md:hidden pt-3 border-t border-slate-200 space-y-2">
              {enabledModules.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-1">
                  {enabledModules.map(mod => (
                    <span key={mod} className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                      {mod}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-xs text-slate-500 truncate">{user.email}</span>
                <button
                  onClick={async () => {
                    await supabase.auth.signOut();
                    setUser(null);
                    setOrg(null);
                    setDocs([]);
                    setExpenses([]);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg"
                >
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="hidden md:block pt-4 border-t border-slate-200 space-y-2.5">
          {enabledModules.length > 0 && (
            <div className="flex flex-wrap gap-1 px-2">
              {enabledModules.map(mod => (
                <span key={mod} className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                  {mod}
                </span>
              ))}
            </div>
          )}
          <div className="text-xs text-slate-500 truncate px-2">{user.email}</div>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              setUser(null);
              setOrg(null);
              setDocs([]);
              setExpenses([]);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl transition"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 min-w-0 p-4 md:p-8 max-w-6xl space-y-6">
        {subscriptionLocked && sub && (
          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-medium">
            Subscription {sub.status === 'SUSPENDED' ? 'suspended' : 'expired'} (ended {sub.current_period_end}). You can still view and export your records, but creating new documents or expenses is locked until renewed.
          </div>
        )}
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl flex items-center gap-2 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" /> {errorMessage}
          </div>
        )}

        {/* Context-Aware Desktop / Page Header */}
        {section !== 'STATEMENTS' && !section.startsWith('RENTALS') && (
          <div className="hidden md:flex justify-between items-center gap-4 pb-1">
            <div>
              <h2 className={ui.pageTitle}>{sectionTitle}</h2>
              <p className="text-xs font-medium text-slate-500 mt-1">
                {org?.name} &middot; <span className="font-semibold text-slate-700">{sub?.plan || 'STARTER'}</span> workspace
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              {(section === 'OVERVIEW' || section === 'TRANSPORT') && hasTransportAddon && (
                <>
                  <button
                    disabled={subscriptionLocked}
                    onClick={() => openTransportTab('TRIPS')}
                    className={ui.btnDark}
                  >
                    <MapPin className="w-4 h-4" /> Dispatch Trip
                  </button>
                  <button
                    disabled={subscriptionLocked}
                    onClick={() => openTransportTab('COSTS')}
                    className={ui.btnSecondary}
                  >
                    <Fuel className="w-4 h-4 text-amber-600" /> Log Fuel / Cost
                  </button>
                </>
              )}
              {(section === 'SALES' || (section === 'OVERVIEW' && !hasTransportAddon)) && (
                <button
                  disabled={subscriptionLocked}
                  onClick={() => setShowDocModal(true)}
                  className={ui.btnPrimary}
                >
                  <PlusCircle className="w-4 h-4" /> New Quote / Invoice
                </button>
              )}
              {section === 'EXPENSES' && !hasTransportAddon && (
                <button
                  disabled={subscriptionLocked}
                  onClick={() => setShowExpenseModal(true)}
                  className={ui.btnDanger}
                >
                  <ReceiptText className="w-4 h-4" /> Log Expense
                </button>
              )}
              {(section === 'SALES' || section === 'EXPENSES') && (
                <button
                  onClick={exportTaxCSV}
                  className={ui.btnSecondary}
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Export CSV
                </button>
              )}
            </div>
          </div>
        )}

        {/* Search & Date Filter */}
        {((!hasTransportAddon && section === 'OVERVIEW') || section === 'SALES' || section === 'EXPENSES') && (
          <div className="bg-white border border-slate-200/90 shadow-xs p-3.5 rounded-2xl flex flex-col md:flex-row gap-3 items-stretch md:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search Doc Code, Client, Vendor, or Payment Ref..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setDocLimit(PAGE_SIZE); setExpenseLimit(PAGE_SIZE); }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-9 py-2 text-sm text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700">
                <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
                <select
                  value={selectedYear}
                  onChange={e => setSelectedYear(e.target.value)}
                  className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
                >
                  <option value="ALL">All Years</option>
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <select
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 focus:outline-none cursor-pointer"
              >
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* TRANSPORT COMMAND OVERVIEW (When TRANSPORT module is active) */}
        {section === 'OVERVIEW' && hasTransportAddon && (
          <div className="space-y-6">
            {/* Transport KPI Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="bg-white border border-slate-200 p-4 rounded-2xl">
                <div className="text-xs font-semibold text-slate-500 uppercase">Fleet Readiness</div>
                <div className="text-2xl font-bold text-slate-900 mt-1">{activeVehiclesCount} / {vehicles.length}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {maintenanceVehiclesCount > 0 ? `${maintenanceVehiclesCount} in maintenance` : `${activeDriversCount} active drivers`}
                </div>
              </div>
              <div className="bg-white border border-slate-200 p-4 rounded-2xl">
                <div className="text-xs font-semibold text-slate-500 uppercase">Upcoming / Active Trips</div>
                <div className="text-2xl font-bold text-blue-600 mt-1">{upcomingTrips.length}</div>
                <div className="text-xs text-slate-400 mt-1">{activeTripsList.length} total non-cancelled</div>
              </div>
              <div className="bg-white border border-slate-200 p-4 rounded-2xl">
                <div className="text-xs font-semibold text-slate-500 uppercase">Trip Fares</div>
                <div className="text-xl font-bold text-emerald-600 mt-1">{currency} {totalTripFares.toLocaleString()}</div>
                <div className="text-xs text-slate-400 mt-1">Cash collected: {currency} {cashCollected.toLocaleString()}</div>
              </div>
              <div className="bg-white border border-slate-200 p-4 rounded-2xl">
                <div className="text-xs font-semibold text-slate-500 uppercase">Fuel &amp; Fleet Costs</div>
                <div className="text-xl font-bold text-rose-600 mt-1">{currency} {totalFleetCosts.toLocaleString()}</div>
                <div className="text-xs text-slate-400 mt-1">Receivables: {currency} {receivables.toLocaleString()}</div>
              </div>
              <div className="col-span-2 lg:col-span-1 bg-slate-900 text-white p-4 rounded-2xl">
                <div className="text-xs font-semibold text-slate-300 uppercase">Net Fleet Margin</div>
                <div className={`text-xl font-bold mt-1 ${netFleetMargin >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {currency} {netFleetMargin.toLocaleString()}
                </div>
                <div className="text-xs text-slate-400 mt-1">Fares &minus; Direct Fleet Costs</div>
              </div>
            </div>

            {/* License Compliance Alerts */}
            {driverLicenseAlerts.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-amber-900 font-semibold">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    Driver compliance alert: {driverLicenseAlerts.map(d => `${d.full_name} (exp ${d.license_expiry})`).join(', ')}
                  </span>
                </div>
                <button
                  onClick={() => openTransportTab('DRIVERS')}
                  className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold"
                >
                  Review Drivers
                </button>
              </div>
            )}

            {/* Active Dispatch Queue + Vehicle Profitability */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">Active &amp; Upcoming Dispatch ({upcomingTrips.length})</h3>
                  <button onClick={() => openTransportTab('TRIPS')} className="text-xs font-semibold text-blue-600 hover:underline">
                    Manage Trips &rarr;
                  </button>
                </div>
                <div className="divide-y divide-slate-100 text-xs">
                  {upcomingTrips.slice(0, 6).map(t => {
                    const v = t.vehicle_id ? vehicleById.get(t.vehicle_id) : undefined;
                    const d = t.driver_id ? driverById.get(t.driver_id) : undefined;
                    return (
                      <div key={t.id} className="py-2.5 flex justify-between items-center gap-2">
                        <div>
                          <div className="font-semibold text-slate-900">
                            {t.client_name} <span className="font-mono text-slate-400 font-normal">({t.trip_code})</span>
                          </div>
                          <div className="text-slate-500">
                            {t.trip_date} &middot; {t.origin} &rarr; {t.destination}
                          </div>
                          <div className="text-slate-400">
                            {v ? v.registration_no : 'Unassigned'} &middot; {d ? d.full_name : 'No driver'}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold text-slate-900">{currency} {Number(t.agreed_fare).toLocaleString()}</div>
                          <span className="inline-block mt-0.5 px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold text-[10px]">
                            {t.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {upcomingTrips.length === 0 && (
                    <p className="py-4 text-slate-400">No upcoming or in-progress trips. Click Dispatch Trip to schedule one.</p>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">Profitability by Vehicle</h3>
                  <button onClick={() => openTransportTab('FLEET')} className="text-xs font-semibold text-blue-600 hover:underline">
                    Open Fleet &rarr;
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="uppercase text-slate-400 border-b border-slate-200">
                      <tr>
                        <th className="py-2">Vehicle</th>
                        <th className="py-2">Trips</th>
                        <th className="py-2">Revenue</th>
                        <th className="py-2">Costs</th>
                        <th className="py-2">Margin</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {vehicleBreakdown.map(row => (
                        <tr key={row.vehicle.id}>
                          <td className="py-2 font-semibold text-slate-900">
                            <span className="font-mono">{row.vehicle.registration_no}</span>
                            <div className="text-[11px] font-normal text-slate-400">{row.vehicle.make_model}</div>
                          </td>
                          <td className="py-2">{row.tripCount}</td>
                          <td className="py-2 text-blue-600 font-semibold">{currency} {row.rev.toLocaleString()}</td>
                          <td className="py-2 text-rose-600">{currency} {row.cost.toLocaleString()}</td>
                          <td className={`py-2 font-bold ${row.margin >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {currency} {row.margin.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                      {vehicleBreakdown.length === 0 && (
                        <tr><td colSpan={5} className="py-4 text-slate-400">Add vehicles in Fleet Vehicles to track per-unit margin.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CORE ACCOUNTING OVERVIEW KPIs (When no specialist module overrides overview) */}
        {section === 'OVERVIEW' && !hasTransportAddon && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={ui.kpiCard}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cash Collected</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-emerald-600 mt-2 tracking-tight">
                {currency} {cashCollected.toLocaleString()}
              </div>
              <div className="text-xs font-medium text-slate-500 mt-1">
                Invoiced: {currency} {invoicedSales.toLocaleString()}
              </div>
            </div>
            <div className={ui.kpiCard}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Receivables</span>
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-amber-600 mt-2 tracking-tight">
                {currency} {receivables.toLocaleString()}
              </div>
              <div className="text-xs font-medium text-slate-500 mt-1">Unpaid &amp; Partial Invoices</div>
            </div>
            <div className={ui.kpiCard}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Expenses</span>
                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-rose-600 mt-2 tracking-tight">
                {currency} {totalExpenses.toLocaleString()}
              </div>
              <div className="text-xs font-medium text-slate-500 mt-1">{dateExpenses.length} expense entries</div>
            </div>
            <div className={ui.kpiCard}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Net Cash Flow</span>
                <span className={`w-2 h-2 rounded-full ${netCashPosition >= 0 ? 'bg-blue-500' : 'bg-rose-500'}`}></span>
              </div>
              <div className={`text-2xl sm:text-3xl font-extrabold mt-2 tracking-tight ${netCashPosition >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                {currency} {netCashPosition.toLocaleString()}
              </div>
              <div className="text-xs font-medium text-slate-500 mt-1">Cash Collected &minus; Expenses</div>
            </div>
          </div>
        )}

        {/* SALES & DOCUMENTS TABLE */}
        {((!hasTransportAddon && section === 'OVERVIEW') || section === 'SALES') && (
          <SalesDocumentsTable
            docs={filteredDocs}
            currency={currency}
            salesTab={salesTab}
            onSalesTabChange={setSalesTab}
            docLimit={docLimit}
            onShowMore={() => setDocLimit(l => l + PAGE_SIZE)}
            subscriptionLocked={subscriptionLocked}
            onConvertToInvoice={handleConvertToInvoice}
            onDeleteQuote={handleDeleteQuote}
            onOpenReceipt={item => {
              setReceiptTarget(item);
              setReceiptAmount(String(invoiceBalance(item)));
              setReceiptMethod('M-PESA');
              setReceiptRef('');
            }}
            onVoidInvoice={handleVoidInvoice}
            onPreviewPdf={handlePreviewPDF}
            onDownloadPdf={handleDownloadPDF}
            onSharePdf={handleSharePDF}
          />
        )}

        {/* EXPENSES TABLE */}
        {((!hasTransportAddon && section === 'OVERVIEW') || section === 'EXPENSES') && (
          <ExpensesTable
            expenses={dateExpenses}
            currency={currency}
            expenseLimit={expenseLimit}
            onShowMore={() => setExpenseLimit(l => l + PAGE_SIZE)}
          />
        )}

        {/* CUSTOMERS & PRODUCTS/SERVICES CATALOGUES */}
        {(section === 'CUSTOMERS' || section === 'CATALOGUE') && org && (
          <CataloguesSection
            mode={section}
            orgId={org.id}
            currency={currency}
            customers={customers}
            products={products}
            docs={docs}
            isReadOnly={subscriptionLocked}
            onRefresh={() => loadOrgData(org.id)}
          />
        )}

        {/* INVENTORY & SUPPLIERS */}
        {section === 'INVENTORY' && org && (canManageStockControl || canManageSuppliersAp) && (
          <InventorySection
            orgId={org.id}
            currency={currency}
            products={products}
            isGrowthPlus={isGrowthPlus}
            isReadOnly={subscriptionLocked}
            canManageSuppliersAp={canManageSuppliersAp}
            canManageStockControl={canManageStockControl}
          />
        )}

        {section === 'REPORTS' && org && (
          <ReportsSection orgId={org.id} currency={currency} />
        )}

        {section === 'STATEMENTS' && org && canViewGlStatements && (
          <StatementsSection
            customers={customers}
            documents={docs}
            org={org}
          />
        )}

        {org && hasRentalsAddon && section.startsWith('RENTALS') && (
          <RentalsSection
            orgId={org.id}
            currency={org.currency || 'KES'}
            customers={customers}
            canManageOwners={canManageOwners}
            hideInnerTabs={isRentalsOnlySpecialist}
            initialTab={
              section === 'RENTALS_PROPERTIES'
                ? 'PROPERTIES'
                : section === 'RENTALS_TENANCIES'
                  ? 'TENANCIES'
                  : section === 'RENTALS_COLLECTIONS'
                    ? 'COLLECTIONS'
                    : section === 'RENTALS_MAINTENANCE'
                      ? 'MAINTENANCE'
                      : section === 'RENTALS_OWNERS'
                        ? 'OWNERS'
                        : 'OVERVIEW'
            }
            isReadOnly={subscriptionLocked}
            onDataChanged={() => loadOrgData(org.id)}
          />
        )}

        {hasTransportAddon && section === 'TRANSPORT' && org && (
          <TransportSection
            orgId={org.id}
            currency={currency}
            customers={customers}
            docs={docs}
            isReadOnly={subscriptionLocked}
            activeTab={transportTab}
            onTabChange={setTransportTab}
            onDocCreated={() => loadOrgData(org.id)}
            onPreviewPdf={handlePreviewPDF}
            onDownloadPdf={handleDownloadPDF}
            onSharePdf={handleSharePDF}
            onOpenReceipt={item => {
              setReceiptTarget(item);
              setReceiptAmount(String(invoiceBalance(item)));
              setReceiptMethod('M-PESA');
              setReceiptRef('');
            }}
          />
        )}

        {/* BUSINESS INTELLIGENCE (Intelligence+ only) */}
        {isIntelligencePlus && section === 'INTELLIGENCE' && org && (
          <IntelligenceSection
            orgId={org.id}
            currency={currency}
            docs={docs}
            expenses={expenses}
            customers={customers}
            subscriptionLocked={subscriptionLocked}
          />
        )}

        {/* SETTINGS & PDF TEMPLATE */}
        {section === 'SETTINGS' && org && (
          <SettingsForm
            org={org}
            sub={sub}
            onOrgChange={setOrg}
            onSaved={loadUserAndOrgs}
            isIntelligencePlus={isIntelligencePlus}
            hasRentalsAddon={hasRentalsAddon}
            currentUserId={user.id}
            userEmail={user.email ?? undefined}
            isReadOnly={subscriptionLocked}
          />
        )}
      </main>

      {/* CREATE DOCUMENT MODAL (MULTI-ITEM) */}
      {showDocModal && org && (
        <DocumentModal
          orgId={org.id}
          currency={currency}
          isGrowthPlus={true}
          subscriptionLocked={subscriptionLocked}
          customers={customers}
          products={products}
          onClose={() => setShowDocModal(false)}
          onCreated={() => loadOrgData(org.id)}
        />
      )}

      {/* ISSUE RECEIPT MODAL (SUPPORTS PARTIAL / DEPOSIT PAYMENTS) */}
      {receiptTarget && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setReceiptTarget(null); }}
          className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Issue Receipt</h3>
              <button
                type="button"
                onClick={() => setReceiptTarget(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs sm:text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Invoice Number:</span>
                <span className="font-mono font-bold text-slate-800">{receiptTarget.doc_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Invoice Total:</span>
                <span className="font-semibold text-slate-900">{currency} {Number(receiptTarget.amount).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Already Paid:</span>
                <span className="font-semibold text-emerald-600">{currency} {Number(receiptTarget.amount_paid || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5">
                <span className="text-slate-700 font-semibold">Balance Due:</span>
                <span className="font-bold text-amber-600">{currency} {invoiceBalance(receiptTarget).toLocaleString()}</span>
              </div>
            </div>

            <form onSubmit={handleConfirmReceipt} className="space-y-3.5">
              <div>
                <label className={ui.label}>Amount Received ({currency})</label>
                <input
                  type="number"
                  step="any"
                  min="1"
                  max={Math.max(1, invoiceBalance(receiptTarget))}
                  required
                  value={receiptAmount}
                  onChange={e => setReceiptAmount(e.target.value)}
                  className={ui.input + " font-bold text-base"}
                />
              </div>
              <div>
                <label className={ui.label}>Payment Method</label>
                <select value={receiptMethod} onChange={e => setReceiptMethod(e.target.value)} className={ui.select}>
                  {PAYMENT_METHODS.map(pm => <option key={pm} value={pm}>{pm}</option>)}
                </select>
              </div>
              <div>
                <label className={ui.label}>Reference / Code</label>
                <input
                  type="text"
                  placeholder="e.g. M-PESA Confirmation Code or Check #"
                  value={receiptRef}
                  onChange={e => setReceiptRef(e.target.value)}
                  className={ui.input + " font-mono"}
                />
              </div>
              <div>
                <label className={ui.label}>Payment Date</label>
                <input type="date" required value={receiptDate} onChange={e => setReceiptDate(e.target.value)} className={ui.input} />
              </div>

              <div className="flex gap-2.5 pt-2">
                <button type="button" onClick={() => setReceiptTarget(null)} className={ui.btnSecondary + " flex-1"}>
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className={ui.btnSuccess + " flex-1"}>
                  {isSubmitting ? 'Saving...' : 'Confirm Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD EXPENSE MODAL */}
      {showExpenseModal && (
        <div
          onClick={e => { if (e.target === e.currentTarget) { setShowExpenseModal(false); setExpenseReceiptFile(null); } }}
          className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Log Business Expense</h3>
              <button
                type="button"
                onClick={() => { setShowExpenseModal(false); setExpenseReceiptFile(null); }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddExpense} className="space-y-3.5">
              <div>
                <label className={ui.label}>Category</label>
                <select value={expenseCategory} onChange={e => setExpenseCategory(e.target.value)} className={ui.select}>
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={ui.label}>Date</label>
                  <input type="date" required value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className={ui.input} />
                </div>
                <div>
                  <label className={ui.label}>Amount ({currency})</label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="0.00"
                    value={expenseAmount}
                    onChange={e => setExpenseAmount(e.target.value)}
                    className={ui.input + " font-semibold"}
                  />
                </div>
              </div>
              <div>
                <label className={ui.label}>Vendor / Supplier</label>
                <input
                  type="text"
                  placeholder="e.g. Shell, Total, Landlord"
                  value={vendor}
                  onChange={e => setVendor(e.target.value)}
                  className={ui.input}
                />
              </div>
              <div>
                <label className={ui.label}>Notes</label>
                <input
                  type="text"
                  placeholder="Optional description"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className={ui.input}
                />
              </div>
              <div>
                <label className={ui.label}>Receipt Photo or PDF (Optional)</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={e => setExpenseReceiptFile(e.target.files?.[0] ?? null)}
                  className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3.5 file:rounded-xl file:border-0 file:bg-slate-100 file:text-slate-700 file:font-semibold hover:file:bg-slate-200 cursor-pointer"
                />
              </div>
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowExpenseModal(false); setExpenseReceiptFile(null); }}
                  className={ui.btnSecondary + " flex-1"}
                >
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className={ui.btnDanger + " flex-1"}>
                  {isSubmitting ? 'Saving...' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QUOTE CONVERSION TOP-UP MODAL */}
      {quoteShortfallModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold text-slate-900">
                Top Up Stock to Convert {quoteShortfallModal.quote.doc_number}
              </h3>
              <button
                type="button"
                onClick={() => setQuoteShortfallModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Existing stock will be used first. Confirm the top-up quantity to match this quote, or enter a higher quantity to fully restock:
            </p>

            <div className="space-y-2.5 max-h-72 overflow-y-auto">
              {quoteShortfallModal.shortfalls.map((s, idx) => (
                <div key={s.productId} className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2 text-xs">
                  <div className="flex justify-between font-semibold text-slate-900">
                    <span>{s.productName}</span>
                    <span className="text-amber-800">
                      On hand: {s.available} &middot; Quoted: {s.requested} &middot; Short: {s.shortfall}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-slate-500">Qty to Add (min {s.shortfall})</label>
                      <input
                        type="number"
                        min={s.shortfall}
                        step="1"
                        value={s.receiveQty}
                        onChange={e =>
                          setQuoteShortfallModal(prev =>
                            prev
                              ? {
                                  ...prev,
                                  shortfalls: prev.shortfalls.map((row, i) =>
                                    i === idx ? { ...row, receiveQty: e.target.value } : row
                                  )
                                }
                              : null
                          )
                        }
                        className="w-full border border-slate-300 bg-white rounded-lg p-1.5 font-bold mt-0.5"
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
                          setQuoteShortfallModal(prev =>
                            prev
                              ? {
                                  ...prev,
                                  shortfalls: prev.shortfalls.map((row, i) =>
                                    i === idx ? { ...row, receiveCost: e.target.value } : row
                                  )
                                }
                              : null
                          )
                        }
                        className="w-full border border-slate-300 bg-white rounded-lg p-1.5 mt-0.5"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setQuoteShortfallModal(prev =>
                          prev
                            ? {
                                ...prev,
                                shortfalls: prev.shortfalls.map((row, i) =>
                                  i === idx ? { ...row, receiveQty: String(row.shortfall) } : row
                                )
                              }
                            : null
                        )
                      }
                      className="px-2.5 py-1 rounded-full bg-white border border-amber-300 text-amber-800 text-[11px] font-semibold hover:bg-amber-100"
                    >
                      Exact Match (+{s.shortfall})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setQuoteShortfallModal(prev =>
                          prev
                            ? {
                                ...prev,
                                shortfalls: prev.shortfalls.map((row, i) =>
                                  i === idx ? { ...row, receiveQty: String(row.shortfall + 10) } : row
                                )
                              }
                            : null
                        )
                      }
                      className="px-2.5 py-1 rounded-full bg-white border border-amber-300 text-amber-800 text-[11px] font-semibold hover:bg-amber-100"
                    >
                      Full Restock (+{s.shortfall + 10})
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setQuoteShortfallModal(null)}
                className={ui.btnSecondary + ' flex-1'}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={async () => {
                  const current = quoteShortfallModal;
                  for (const s of current.shortfalls) {
                    if (Number(s.receiveQty || 0) < s.shortfall) {
                      alert(`Add at least ${s.shortfall} unit(s) for "${s.productName}".`);
                      return;
                    }
                  }
                  setQuoteShortfallModal(null);
                  await handleConvertToInvoice(
                    current.quote,
                    current.shortfalls.map(s => ({
                      variantId: s.defaultVariantId,
                      addQty: Number(s.receiveQty || 0),
                      unitCost: Number(s.receiveCost || 0),
                      note:
                        Number(s.receiveQty) === s.shortfall
                          ? `Top-up (+${s.shortfall}) for ${current.quote.doc_number}`
                          : `Restock (+${s.receiveQty}) converting ${current.quote.doc_number}`
                    }))
                  );
                }}
                className={ui.btnPrimary + ' flex-1'}
              >
                Receive &amp; Convert
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF PREVIEW MODAL */}
      {previewPdf && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-3 sm:p-4 z-50">
          <div className="bg-white rounded-2xl max-w-4xl w-full h-[88vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-4 sm:px-5 py-3 border-b border-slate-200 flex flex-wrap justify-between items-center gap-2">
              <span className="font-mono text-xs sm:text-sm font-bold truncate">{previewPdf.item.doc_number}.pdf</span>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button onClick={() => handleDownloadPDF(previewPdf.item)} className="px-2.5 sm:px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1">
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
                <button onClick={() => handleSharePDF(previewPdf.item)} className="px-2.5 sm:px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1">
                  <Share2 className="w-3.5 h-3.5" /> Share
                </button>
                <button onClick={() => setPreviewPdf(null)} className="p-1 text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
              </div>
            </div>

            {/* Desktop Inline PDF Viewer */}
            <iframe src={previewPdf.url} title="PDF Preview" className="hidden md:block w-full flex-1 bg-slate-100" />

            {/* Mobile Document Preview (Android/iOS browsers block inline blob PDFs in iframes) */}
            <div className="md:hidden flex-1 overflow-y-auto bg-slate-50 p-4 space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 text-xs">
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <div className="font-bold text-sm text-slate-900">{org?.name}</div>
                    <div className="text-slate-500 mt-0.5">{previewPdf.item.doc_type} &middot; {previewPdf.item.issue_date}</div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-slate-100 font-bold text-slate-700">{previewPdf.item.status}</span>
                </div>

                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400">Client</div>
                  <div className="font-semibold text-slate-900 mt-0.5">{previewPdf.item.customer_name}</div>
                  {previewPdf.item.customer_phone && <div className="text-slate-500">{previewPdf.item.customer_phone}</div>}
                  {previewPdf.item.customer_email && <div className="text-slate-500">{previewPdf.item.customer_email}</div>}
                </div>

                <div className="border-t border-slate-100 pt-3 space-y-2">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Items</div>
                  {previewPdf.item.document_items && previewPdf.item.document_items.length > 0 ? (
                    previewPdf.item.document_items.map((li, idx) => (
                      <div key={li.id ?? idx} className="flex justify-between gap-2">
                        <span className="text-slate-700">{li.quantity}x {li.description}</span>
                        <span className="font-semibold shrink-0">{currency} {Number(li.line_total).toLocaleString()}</span>
                      </div>
                    ))
                  ) : (
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-700">{previewPdf.item.description || previewPdf.item.doc_type}</span>
                      <span className="font-semibold shrink-0">{currency} {Number(previewPdf.item.amount).toLocaleString()}</span>
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-200 pt-3 space-y-1">
                  <div className="flex justify-between font-bold text-sm text-slate-900">
                    <span>Total</span>
                    <span>{currency} {Number(previewPdf.item.amount).toLocaleString()}</span>
                  </div>
                  {previewPdf.item.doc_type === 'INVOICE' && (
                    <>
                      <div className="flex justify-between text-emerald-600">
                        <span>Paid</span>
                        <span>{currency} {Number(previewPdf.item.amount_paid || 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-amber-600">
                        <span>Balance</span>
                        <span>{currency} {invoiceBalance(previewPdf.item).toLocaleString()}</span>
                      </div>
                    </>
                  )}
                  {previewPdf.item.payment_ref && (
                    <div className="text-slate-500 pt-1">
                      Ref: {previewPdf.item.payment_method} ({previewPdf.item.payment_ref})
                    </div>
                  )}
                </div>
              </div>

              <a
                href={previewPdf.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-2.5 text-center bg-slate-900 text-white rounded-xl text-xs font-semibold"
              >
                Open Raw PDF in Viewer
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
