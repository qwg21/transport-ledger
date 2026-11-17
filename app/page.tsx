'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { buildPdfDocument } from '@/lib/pdf';
import {
  applyPaymentTotals,
  buildDocNumber,
  csvCell,
  explainDbError,
  invoiceBalance,
  todayLocal
} from '@/lib/documents';
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
import {
  LayoutDashboard,
  FileText,
  ReceiptText,
  Settings,
  LogOut,
  PlusCircle,
  FileSpreadsheet,
  Download,
  Share2,
  Search,
  Calendar,
  X,
  Building2,
  AlertCircle,
  Users,
  Package,
  BarChart3
} from 'lucide-react';

type Section = 'OVERVIEW' | 'SALES' | 'EXPENSES' | 'CUSTOMERS' | 'CATALOGUE' | 'INTELLIGENCE' | 'SETTINGS';

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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Navigation & Filters
  const [section, setSection] = useState<Section>('OVERVIEW');
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

    setCustomers((custRes.data as Customer[] | null) ?? []);
    setProducts((prodRes.data as Product[] | null) ?? []);
    setSub((subRes.data as Subscription | null) ?? null);

    if (!docRes.error) setDocs(applyPaymentTotals((docRes.data as DocumentRecord[] | null) ?? []));
    if (!expRes.error) setExpenses((expRes.data as ExpenseWithReceipt[] | null) ?? []);

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

  const availableYears = Array.from(
    new Set([...docs.map(d => (d.issue_date || '').slice(0, 4)), ...expenses.map(e => (e.expense_date || '').slice(0, 4))].filter(Boolean))
  ).sort((a, b) => b.localeCompare(a));

  const matchesDate = (dateStr: string) => {
    if (!dateStr) return true;
    const [y, m] = dateStr.split('-');
    if (selectedYear !== 'ALL' && y !== selectedYear) return false;
    if (selectedMonth !== 'ALL' && m !== selectedMonth) return false;
    return true;
  };

  const q = searchQuery.trim().toLowerCase();
  const dateDocs = docs.filter(d => matchesDate(d.issue_date));
  const dateExpenses = expenses.filter(e => {
    if (!matchesDate(e.expense_date)) return false;
    if (!q) return true;
    return (e.category || '').toLowerCase().includes(q) || (e.vendor || '').toLowerCase().includes(q) || (e.notes || '').toLowerCase().includes(q);
  });

  const filteredDocs = dateDocs.filter(d => {
    if (salesTab !== 'ALL' && d.doc_type !== salesTab) return false;
    if (!q) return true;
    return (
      (d.doc_number || '').toLowerCase().includes(q) ||
      (d.chain_code || '').toLowerCase().includes(q) ||
      (d.customer_name || '').toLowerCase().includes(q) ||
      (d.description || '').toLowerCase().includes(q) ||
      (d.payment_ref || '').toLowerCase().includes(q)
    );
  });

  const currency = org?.currency || 'KES';
  const invoicedSales = dateDocs
    .filter(d => d.doc_type === 'INVOICE' && d.status !== 'VOID')
    .reduce((s, d) => s + Number(d.amount || 0), 0);
  const cashCollected = dateDocs
    .filter(d => d.doc_type === 'RECEIPT' && d.status !== 'VOID')
    .reduce((s, d) => s + Number(d.amount || 0), 0);
  const receivables = dateDocs.reduce((sum, d) => sum + invoiceBalance(d), 0);
  const totalExpenses = dateExpenses.reduce((s, e) => s + Number(e.amount_kes || 0), 0);
  const netCashPosition = cashCollected - totalExpenses;
  const subscriptionLocked = Boolean(
    sub &&
    (sub.status === 'SUSPENDED' ||
      sub.status === 'CANCELLED' ||
      sub.current_period_end < todayLocal())
  );
  const isGrowthPlus = Boolean(sub && sub.plan !== 'ESSENTIAL');
  const isIntelligencePlus = Boolean(sub && (sub.plan === 'INTELLIGENCE' || sub.plan === 'ENTERPRISE'));

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
    if (!window.confirm(`Void invoice ${invoice.doc_number}? This keeps the invoice number for your audit trail and removes it from receivables.`)) return;

    const { error } = await supabase
      .from('documents')
      .update({ status: 'VOID' })
      .eq('id', invoice.id)
      .eq('doc_type', 'INVOICE')
      .eq('status', 'UNPAID');

    if (error) alert(error.message);
    else loadOrgData(org.id);
  };

  const handleConvertToInvoice = async (quote: DocumentRecord) => {
    if (isSubmitting || !org) return;
    if (subscriptionLocked) {
      alert('This workspace is read-only until its subscription is renewed.');
      return;
    }
    if (docs.some(d => d.doc_type === 'INVOICE' && d.chain_code === quote.chain_code && d.status !== 'VOID')) {
      alert(`${quote.doc_number} already has an invoice.`);
      return;
    }

    setIsSubmitting(true);
    try {
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
        if (itemsErr) warnings.push(`line items were not copied (${itemsErr.message})`);
      }

      const { error: convertErr } = await supabase
        .from('documents')
        .update({ status: 'CONVERTED' })
        .eq('id', quote.id);
      if (convertErr) warnings.push(`the quotation could not be marked converted (${convertErr.message})`);

      if (warnings.length > 0) alert(`Invoice ${newInvoice.doc_number} created, but ${warnings.join(' and ')}.`);
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
        'RECEIPT', r.doc_number, r.chain_code, r.issue_date,
        `${r.customer_name} - ${r.description ?? ''}`, r.payment_method, r.payment_ref, r.amount
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
  const growthNavItems: NavItem[] = [
    { id: 'CUSTOMERS', label: 'Customers', icon: Users },
    { id: 'CATALOGUE', label: 'Products & Services', icon: Package }
  ];
  const navItems: NavItem[] = [
    { id: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard },
    { id: 'SALES', label: 'Sales & Documents', icon: FileText },
    { id: 'EXPENSES', label: 'Expenses', icon: ReceiptText },
    ...(isGrowthPlus ? growthNavItems : []),
    ...(isIntelligencePlus ? [{ id: 'INTELLIGENCE' as Section, label: 'Intelligence', icon: BarChart3 }] : []),
    { id: 'SETTINGS', label: 'Branding & Settings', icon: Settings }
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col md:flex-row font-sans">
      
      {/* LEFT SIDEBAR */}
      <aside className="w-full md:w-64 bg-white border-b md:border-b-0 md:border-r border-slate-200 p-4 flex flex-col justify-between shrink-0">
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2">
            {org?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- logo URL comes from Supabase Storage or legacy data: URL
              <img src={org.logo_url} alt="Logo" className="w-9 h-9 rounded-lg object-contain border border-slate-200" />
            ) : (
              <div className="p-2 bg-blue-600 rounded-lg text-white"><Building2 className="w-5 h-5" /></div>
            )}
            <div className="min-w-0">
              <div className="font-bold text-sm text-slate-900 truncate">{org?.name}</div>
              <div className="text-xs text-slate-500 truncate">{sub?.plan || 'ESSENTIAL'} • {org?.industry}</div>
            </div>
          </div>

          {/* Business Switcher */}
          <div className="space-y-1.5">
            {memberships.length > 1 && (
              <select
                value={org?.id || ''}
                onChange={e => {
                  const found = memberships.find(m => m.id === e.target.value);
                  if (!found) return;
                  setDocs([]);
                  setExpenses([]);
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
              <a href="/admin" className="block w-full px-2 text-xs text-blue-600 font-semibold hover:underline">
                Platform Admin Console
              </a>
            )}
          </div>

          <nav className="flex md:flex-col gap-1 overflow-x-auto">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                  section === item.id ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <item.icon className="w-4 h-4" /> {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="hidden md:block pt-4 border-t border-slate-200 space-y-2">
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
      <main className="flex-1 p-4 md:p-8 max-w-6xl space-y-6">
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

        {/* Top Bar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h2 className="text-xl font-bold text-slate-900">
            {section === 'OVERVIEW' && 'Business Overview'}
            {section === 'SALES' && 'Sales, Quotes, Invoices & Receipts'}
            {section === 'EXPENSES' && 'Purchases & Operating Expenses'}
            {section === 'CUSTOMERS' && 'Customers Directory'}
            {section === 'CATALOGUE' && 'Products & Services'}
            {section === 'INTELLIGENCE' && 'Business Intelligence & Reports'}
            {section === 'SETTINGS' && 'Company & PDF Template Settings'}
          </h2>
          <div className="flex flex-wrap gap-2">
            <button disabled={subscriptionLocked} onClick={() => setShowDocModal(true)} className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
              <PlusCircle className="w-4 h-4" /> New Quote / Invoice
            </button>
            <button disabled={subscriptionLocked} onClick={() => setShowExpenseModal(true)} className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
              <ReceiptText className="w-4 h-4" /> Log Expense
            </button>
            <button onClick={exportTaxCSV} className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Export CSV
            </button>
          </div>
        </div>

        {/* Search & Date Filter */}
        {(section === 'OVERVIEW' || section === 'SALES' || section === 'EXPENSES') && (
          <div className="bg-white border border-slate-200 p-3 rounded-2xl flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search Doc Code, Client, Vendor, or Payment Ref..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setDocLimit(PAGE_SIZE); setExpenseLimit(PAGE_SIZE); }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
              {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"><X className="w-4 h-4" /></button>}
            </div>
            <div className="flex gap-2">
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                <Calendar className="w-4 h-4 text-slate-400" />
                <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="bg-transparent text-sm">
                  <option value="ALL">All Years</option>
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* OVERVIEW KPIs */}
        {section === 'OVERVIEW' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 p-5 rounded-2xl">
              <div className="text-xs font-semibold text-slate-500 uppercase">Cash Collected (Receipts)</div>
              <div className="text-2xl font-bold text-emerald-600 mt-1">{currency} {cashCollected.toLocaleString()}</div>
              <div className="text-xs text-slate-400 mt-1">Invoiced Sales: {currency} {invoicedSales.toLocaleString()}</div>
            </div>
            <div className="bg-white border border-slate-200 p-5 rounded-2xl">
              <div className="text-xs font-semibold text-slate-500 uppercase">Outstanding Receivables</div>
              <div className="text-2xl font-bold text-amber-600 mt-1">{currency} {receivables.toLocaleString()}</div>
              <div className="text-xs text-slate-400 mt-1">Unpaid &amp; Partial Invoices</div>
            </div>
            <div className="bg-white border border-slate-200 p-5 rounded-2xl">
              <div className="text-xs font-semibold text-slate-500 uppercase">Expenses Recorded</div>
              <div className="text-2xl font-bold text-rose-600 mt-1">{currency} {totalExpenses.toLocaleString()}</div>
              <div className="text-xs text-slate-400 mt-1">{dateExpenses.length} expense entries</div>
            </div>
            <div className="bg-white border border-slate-200 p-5 rounded-2xl">
              <div className="text-xs font-semibold text-slate-500 uppercase">Net Cash Flow</div>
              <div className={`text-2xl font-bold mt-1 ${netCashPosition >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                {currency} {netCashPosition.toLocaleString()}
              </div>
              <div className="text-xs text-slate-400 mt-1">Cash Collected − Expenses</div>
            </div>
          </div>
        )}

        {/* SALES & DOCUMENTS TABLE */}
        {(section === 'OVERVIEW' || section === 'SALES') && (
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
        {(section === 'OVERVIEW' || section === 'EXPENSES') && (
          <ExpensesTable
            expenses={dateExpenses}
            currency={currency}
            expenseLimit={expenseLimit}
            onShowMore={() => setExpenseLimit(l => l + PAGE_SIZE)}
          />
        )}

        {/* CUSTOMERS & PRODUCTS/SERVICES CATALOGUES (Growth+ only) */}
        {isGrowthPlus && (section === 'CUSTOMERS' || section === 'CATALOGUE') && org && (
          <CataloguesSection
            mode={section}
            orgId={org.id}
            currency={currency}
            customers={customers}
            products={products}
            docs={docs}
            onRefresh={() => loadOrgData(org.id)}
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
            onOrgChange={setOrg}
            onSaved={loadUserAndOrgs}
            isIntelligencePlus={isIntelligencePlus}
            currentUserId={user.id}
            isReadOnly={subscriptionLocked}
          />
        )}
      </main>

      

      {/* CREATE DOCUMENT MODAL (MULTI-ITEM) */}
      {showDocModal && org && (
        <DocumentModal
          orgId={org.id}
          currency={currency}
          isGrowthPlus={isGrowthPlus}
          subscriptionLocked={subscriptionLocked}
          customers={customers}
          products={products}
          onClose={() => setShowDocModal(false)}
          onCreated={() => loadOrgData(org.id)}
        />
      )}

      {/* ISSUE RECEIPT MODAL (SUPPORTS PARTIAL / DEPOSIT PAYMENTS) */}
      {receiptTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3 shadow-xl">
            <h3 className="text-lg font-bold">Issue Receipt for {receiptTarget.doc_number}</h3>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">Invoice Total:</span><span className="font-semibold">{currency} {Number(receiptTarget.amount).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Already Paid:</span><span className="font-semibold text-emerald-600">{currency} {Number(receiptTarget.amount_paid || 0).toLocaleString()}</span></div>
              <div className="flex justify-between border-t border-slate-200 pt-1"><span className="text-slate-700 font-semibold">Balance Remaining:</span><span className="font-bold text-amber-600">{currency} {invoiceBalance(receiptTarget).toLocaleString()}</span></div>
            </div>
            <form onSubmit={handleConfirmReceipt} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600">Amount Received ({currency})</label>
                <input
                  type="number"
                  step="any"
                  min="1"
                  max={Math.max(1, invoiceBalance(receiptTarget))}
                  required
                  value={receiptAmount}
                  onChange={e => setReceiptAmount(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1 font-bold"
                />
              </div>
              <select value={receiptMethod} onChange={e => setReceiptMethod(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm">
                {PAYMENT_METHODS.map(pm => <option key={pm} value={pm}>{pm}</option>)}
              </select>
              <input type="text" placeholder="Payment / Transaction Reference" value={receiptRef} onChange={e => setReceiptRef(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm font-mono" />
              <input type="date" required value={receiptDate} onChange={e => setReceiptDate(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm" />
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setReceiptTarget(null)} className="flex-1 py-2.5 bg-slate-100 rounded-xl text-sm font-semibold">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : 'Confirm Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD EXPENSE MODAL */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3 shadow-xl">
            <h3 className="text-lg font-bold">Log Business Expense</h3>
            <form onSubmit={handleAddExpense} className="space-y-3">
              <select value={expenseCategory} onChange={e => setExpenseCategory(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm">
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" required value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
                <input type="number" required placeholder={`Amount (${currency})`} value={expenseAmount} onChange={e => setExpenseAmount(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
              </div>
              <input type="text" placeholder="Vendor / Supplier" value={vendor} onChange={e => setVendor(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm" />
              <input type="text" placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm" />
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Receipt / Bill Photo or PDF (Optional)</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={e => setExpenseReceiptFile(e.target.files?.[0] ?? null)}
                  className="w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 file:font-semibold hover:file:bg-slate-200"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => { setShowExpenseModal(false); setExpenseReceiptFile(null); }} className="flex-1 py-2.5 bg-slate-100 rounded-xl text-sm font-semibold">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PDF PREVIEW MODAL */}
      {previewPdf && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-4xl w-full h-[88vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center">
              <span className="font-mono text-sm font-bold">{previewPdf.item.doc_number}.pdf</span>
              <div className="flex items-center gap-2">
                <button onClick={() => handleDownloadPDF(previewPdf.item)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1"><Download className="w-4 h-4" /> Download</button>
                <button onClick={() => handleSharePDF(previewPdf.item)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1"><Share2 className="w-4 h-4" /> Share PDF</button>
                <button onClick={() => setPreviewPdf(null)} className="p-1 text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <iframe src={previewPdf.url} title="PDF Preview" className="w-full flex-1 bg-slate-100" />
          </div>
        </div>
      )}
    </div>
  );
}