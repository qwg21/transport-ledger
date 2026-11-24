'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import AuthScreen from '@/components/AuthScreen';
import {
  ShieldCheck,
  Building2,
  ArrowLeft,
  Layers,
  Tag,
  TicketPercent,
  Receipt,
  TrendingUp,
  Search,
  Trash2,
  UserPlus,
  Users,
  BookOpen,
  ExternalLink
} from 'lucide-react';
import Link from 'next/link';
import type { User } from '@/lib/types';

interface Tenant {
  org_id: string;
  name: string;
  industry: string | null;
  currency: string | null;
  plan: string | null;
  status: string | null;
  transport_addon: boolean | null;
  enabled_modules: string[] | null;
  current_period_end: string | null;
  onboarded_by_email?: string | null;
}

interface PlatformAdminRow {
  email: string;
  full_name: string;
  role: 'SUPER_ADMIN' | 'SALES_ADMIN';
  commission_rate_pct: number;
  is_active: boolean;
  created_at: string;
}

interface PlanPricingRow {
  plan: 'STARTER' | 'ESSENTIAL' | 'GROWTH' | 'INTELLIGENCE' | 'ENTERPRISE';
  display_name: string;
  monthly_price_kes: number;
  promo_price_kes: number | null;
  promo_label: string | null;
  promo_ends_at: string | null;
  annual_discount_pct: number;
  is_public: boolean;
  sort_order: number;
}

interface PromoCodeRow {
  id: string;
  code: string;
  discount_type: 'PERCENT' | 'FIXED_KES' | 'BONUS_DAYS';
  discount_value: number;
  applicable_plan: string | null;
  max_uses: number | null;
  used_count: number;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
}

interface SubscriptionPaymentRow {
  id: string;
  org_id: string;
  reference: string;
  plan: string;
  months: number;
  amount_kes: number;
  channel: string | null;
  status: string;
  created_at: string;
}

type AdminTab = 'TENANTS' | 'SALES_REPS' | 'PRICING' | 'PROMOS' | 'PAYMENTS' | 'GUIDE';

const SUPER_ADMIN_EMAIL = 'quentinwg2015@gmail.com';
const PLANS = ['STARTER', 'ESSENTIAL', 'GROWTH', 'INTELLIGENCE', 'ENTERPRISE'] as const;
const SPECIALIST_MODULES = [
  { id: 'TRANSPORT', label: 'Transport' },
  { id: 'RENTALS', label: 'Rentals' },
  { id: 'MANUFACTURING', label: 'Manufacturing' },
  { id: 'WAREHOUSE', label: 'Warehouse' },
  { id: 'PAYROLL', label: 'Payroll' },
  { id: 'PROCUREMENT', label: 'Procurement' },
  { id: 'CRM', label: 'CRM' }
] as const;
const STATUSES = ['ACTIVE', 'TRIAL', 'SUSPENDED', 'CANCELLED'] as const;

export default function PlatformAdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [adminProfile, setAdminProfile] = useState<PlatformAdminRow | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('TENANTS');

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [salesReps, setSalesReps] = useState<PlatformAdminRow[]>([]);
  const [pricing, setPricing] = useState<PlanPricingRow[]>([]);
  const [promos, setPromos] = useState<PromoCodeRow[]>([]);
  const [payments, setPayments] = useState<SubscriptionPaymentRow[]>([]);
  const [tenantSearch, setTenantSearch] = useState('');
  const [nowMs, setNowMs] = useState(0);

  // Provision form
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('General Business');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [kraPin, setKraPin] = useState('');
  const [currency, setCurrency] = useState('KES');
  const [plan, setPlan] = useState('STARTER');
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // New Sales Rep form (Super Admin)
  const [repName, setRepName] = useState('');
  const [repEmail, setRepEmail] = useState('');
  const [repCommission, setRepCommission] = useState('20');

  // Promo code form
  const [newCode, setNewCode] = useState('');
  const [newDiscountType, setNewDiscountType] = useState<'PERCENT' | 'FIXED_KES' | 'BONUS_DAYS'>('PERCENT');
  const [newDiscountValue, setNewDiscountValue] = useState('20');
  const [newApplicablePlan, setNewApplicablePlan] = useState<string>('ALL');
  const [newMaxUses, setNewMaxUses] = useState('');
  const [newValidUntil, setNewValidUntil] = useState('');

  const isSuperAdmin = adminProfile?.role === 'SUPER_ADMIN';
  const isSalesAdmin = adminProfile?.role === 'SALES_ADMIN';

  const loadAdminData = useCallback(async (role: 'SUPER_ADMIN' | 'SALES_ADMIN') => {
    const [tenantRes, priceRes, repsRes, promoRes, payRes] = await Promise.all([
      supabase.rpc('platform_list_tenants'),
      supabase.from('plan_pricing').select('*').order('sort_order', { ascending: true }),
      role === 'SUPER_ADMIN'
        ? supabase.from('platform_admins').select('*').order('created_at', { ascending: true })
        : Promise.resolve({ data: null }),
      role === 'SUPER_ADMIN'
        ? supabase.from('promo_codes').select('*').order('created_at', { ascending: false })
        : Promise.resolve({ data: null }),
      role === 'SUPER_ADMIN'
        ? supabase
            .from('subscription_payments')
            .select('id, org_id, reference, plan, months, amount_kes, channel, status, created_at')
            .order('created_at', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: null })
    ]);

    if (tenantRes.data) setTenants(tenantRes.data as Tenant[]);
    if (priceRes.data) setPricing(priceRes.data as PlanPricingRow[]);
    if (repsRes.data) setSalesReps(repsRes.data as PlatformAdminRow[]);
    if (promoRes.data) setPromos(promoRes.data as PromoCodeRow[]);
    if (payRes.data) setPayments(payRes.data as SubscriptionPaymentRow[]);
    setNowMs(Date.now());
  }, []);

  const checkAuth = useCallback(async () => {
    const {
      data: { user: currentUser }
    } = await supabase.auth.getUser();
    setUser(currentUser);

    const email = currentUser?.email?.toLowerCase();
    if (!email) {
      setChecked(true);
      return;
    }

    if (email === SUPER_ADMIN_EMAIL) {
      const ownerProfile: PlatformAdminRow = {
        email,
        full_name: 'Owner (Super Admin)',
        role: 'SUPER_ADMIN',
        commission_rate_pct: 0,
        is_active: true,
        created_at: new Date().toISOString()
      };
      setAdminProfile(ownerProfile);
      setChecked(true);
      loadAdminData('SUPER_ADMIN');
      return;
    }

    const { data: paRow } = await supabase
      .from('platform_admins')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (paRow && paRow.is_active) {
      const typed = paRow as PlatformAdminRow;
      setAdminProfile(typed);
      setChecked(true);
      loadAdminData(typed.role);
    } else {
      setChecked(true);
    }
  }, [loadAdminData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial auth & admin role check
    checkAuth();
  }, [checkAuth]);

  const effectivePriceMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of pricing) {
      const promoActive =
        p.promo_price_kes !== null &&
        p.promo_price_kes > 0 &&
        (!p.promo_ends_at || new Date(p.promo_ends_at).getTime() > nowMs);
      map[p.plan] =
        promoActive && p.promo_price_kes !== null
          ? Number(p.promo_price_kes)
          : Number(p.monthly_price_kes);
    }
    return map;
  }, [pricing, nowMs]);

  const kpis = useMemo(() => {
    const activePaid = tenants.filter(t => t.status === 'ACTIVE');
    const trial = tenants.filter(t => t.status === 'TRIAL');
    const locked = tenants.filter(t => t.status === 'SUSPENDED' || t.status === 'CANCELLED');
    const estimatedMrr = activePaid.reduce(
      (sum, t) => sum + (effectivePriceMap[t.plan || 'ESSENTIAL'] ?? 0),
      0
    );
    const commissionPct = Number(adminProfile?.commission_rate_pct || 0);
    const estimatedCommission = Math.round((estimatedMrr * commissionPct) / 100);
    return {
      total: tenants.length,
      activePaid: activePaid.length,
      trial: trial.length,
      locked: locked.length,
      estimatedMrr,
      estimatedCommission
    };
  }, [tenants, effectivePriceMap, adminProfile]);

  const repStats = useMemo(() => {
    return salesReps
      .filter(r => r.role === 'SALES_ADMIN')
      .map(rep => {
        const repTenants = tenants.filter(
          t => (t.onboarded_by_email || '').toLowerCase() === rep.email.toLowerCase()
        );
        const paid = repTenants.filter(t => t.status === 'ACTIVE');
        const trials = repTenants.filter(t => t.status === 'TRIAL');
        const mrr = paid.reduce(
          (sum, t) => sum + (effectivePriceMap[t.plan || 'ESSENTIAL'] ?? 0),
          0
        );
        const commission = Math.round((mrr * Number(rep.commission_rate_pct || 0)) / 100);
        return {
          ...rep,
          totalCount: repTenants.length,
          paidCount: paid.length,
          trialCount: trials.length,
          mrr,
          commission
        };
      });
  }, [salesReps, tenants, effectivePriceMap]);

  const filteredTenants = useMemo(() => {
    const q = tenantSearch.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      t =>
        t.name.toLowerCase().includes(q) ||
        (t.industry || '').toLowerCase().includes(q) ||
        (t.plan || '').toLowerCase().includes(q) ||
        (t.onboarded_by_email || '').toLowerCase().includes(q)
    );
  }, [tenants, tenantSearch]);

  const orgNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of tenants) map[t.org_id] = t.name;
    return map;
  }, [tenants]);

  if (!checked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">
        Loading...
      </div>
    );
  }
  if (!user) return <AuthScreen onAuthenticated={checkAuth} />;

  if (!adminProfile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md w-full text-center space-y-3">
          <h1 className="text-lg font-bold text-slate-900">Access Denied</h1>
          <p className="text-xs text-slate-500">
            Your account ({user.email}) is not registered as a Platform or Sales Admin.
          </p>
          <Link
            href="/"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold"
          >
            Return to Workspace
          </Link>
        </div>
      </div>
    );
  }

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatusMsg(null);

    const {
      data: { session }
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setLoading(false);
      setStatusMsg('Error: Session expired. Please sign in again.');
      return;
    }

    const res = await fetch('/api/admin/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        name,
        industry,
        ownerEmail,
        kraPin: kraPin || null,
        currency,
        plan,
        enabledModules: selectedModules
      })
    });

    const json = (await res.json()) as {
      error?: string;
      provision?: { status?: string };
      inviteEmailSent?: boolean;
      inviteNote?: string | null;
    };
    setLoading(false);

    if (!res.ok) {
      setStatusMsg(`Error: ${json.error || 'Provisioning failed.'}`);
      return;
    }

    if (json.provision?.status === 'LINKED_EXISTING_USER') {
      setStatusMsg(`Provisioned "${name}" (${plan}) and linked to ${ownerEmail}.`);
    } else if (json.inviteEmailSent) {
      setStatusMsg(`Provisioned "${name}" (${plan}) and emailed an invite link to ${ownerEmail}.`);
    } else {
      setStatusMsg(
        `Provisioned "${name}" (${plan}). Invite email note: ${
          json.inviteNote || 'User can sign in if already registered.'
        }`
      );
    }

    setName('');
    setOwnerEmail('');
    setKraPin('');
    setSelectedModules([]);
    loadAdminData(adminProfile.role);
  };

  const handleAddSalesRep = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedEmail = repEmail.trim().toLowerCase();
    if (!cleanedEmail || !repName.trim()) return;

    const { error } = await supabase.from('platform_admins').upsert({
      email: cleanedEmail,
      full_name: repName.trim(),
      role: 'SALES_ADMIN',
      commission_rate_pct: Number(repCommission || 20),
      is_active: true
    });

    if (error) {
      alert(error.message);
      return;
    }
    setRepName('');
    setRepEmail('');
    setRepCommission('20');
    loadAdminData('SUPER_ADMIN');
  };

  const handleToggleRepActive = async (rep: PlatformAdminRow) => {
    const { error } = await supabase
      .from('platform_admins')
      .update({ is_active: !rep.is_active })
      .eq('email', rep.email);
    if (error) alert(error.message);
    else loadAdminData('SUPER_ADMIN');
  };

  const handleUpdateSub = async (
    t: Tenant,
    newPlan: string,
    newStatus: string,
    newTransport: boolean
  ) => {
    const { error } = await supabase.rpc('platform_update_subscription', {
      p_org_id: t.org_id,
      p_plan: newPlan,
      p_status: newStatus,
      p_transport_addon: newTransport
    });
    if (error) alert(error.message);
    else loadAdminData(adminProfile.role);
  };

  const handleToggleModule = async (t: Tenant, moduleId: string) => {
    const current = new Set(t.enabled_modules ?? (t.transport_addon ? ['TRANSPORT'] : []));
    if (current.has(moduleId)) current.delete(moduleId);
    else current.add(moduleId);
    const { error } = await supabase.rpc('platform_set_org_modules', {
      p_org_id: t.org_id,
      p_modules: Array.from(current)
    });
    if (error) alert(error.message);
    else loadAdminData(adminProfile.role);
  };

  const handleRenew = async (orgId: string, months: number) => {
    const { error } = await supabase.rpc('platform_record_subscription_payment', {
      p_org_id: orgId,
      p_months: months
    });
    if (error) alert(error.message);
    else loadAdminData(adminProfile.role);
  };

  const handlePricingField = <K extends keyof PlanPricingRow>(
    planKey: PlanPricingRow['plan'],
    field: K,
    value: PlanPricingRow[K]
  ) => {
    setPricing(prev => prev.map(row => (row.plan === planKey ? { ...row, [field]: value } : row)));
  };

  const handleSavePlanPrice = async (row: PlanPricingRow) => {
    const { error } = await supabase
      .from('plan_pricing')
      .update({
        display_name: row.display_name,
        monthly_price_kes: Number(row.monthly_price_kes),
        promo_price_kes: row.promo_price_kes ? Number(row.promo_price_kes) : null,
        promo_label: row.promo_label?.trim() || null,
        promo_ends_at: row.promo_ends_at || null,
        annual_discount_pct: Number(row.annual_discount_pct),
        is_public: row.is_public,
        updated_at: new Date().toISOString()
      })
      .eq('plan', row.plan);

    if (error) alert(error.message);
    else {
      alert(`${row.display_name} pricing updated.`);
      loadAdminData(adminProfile.role);
    }
  };

  const handleCreatePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newCode.trim().toUpperCase();
    if (!cleaned) return;

    const { error } = await supabase.from('promo_codes').insert({
      code: cleaned,
      discount_type: newDiscountType,
      discount_value: Number(newDiscountValue),
      applicable_plan: newApplicablePlan === 'ALL' ? null : newApplicablePlan,
      max_uses: newMaxUses ? Number(newMaxUses) : null,
      valid_until: newValidUntil ? new Date(newValidUntil).toISOString() : null,
      is_active: true
    });

    if (error) {
      alert(error.message);
      return;
    }
    setNewCode('');
    setNewMaxUses('');
    setNewValidUntil('');
    loadAdminData(adminProfile.role);
  };

  const handleTogglePromo = async (promo: PromoCodeRow) => {
    const { error } = await supabase
      .from('promo_codes')
      .update({ is_active: !promo.is_active })
      .eq('id', promo.id);
    if (error) alert(error.message);
    else loadAdminData(adminProfile.role);
  };

  const handleDeletePromo = async (id: string) => {
    if (!confirm('Delete this promo code?')) return;
    const { error } = await supabase.from('promo_codes').delete().eq('id', id);
    if (error) alert(error.message);
    else loadAdminData(adminProfile.role);
  };

  const availableTabs: { id: AdminTab; label: string; icon: typeof Layers }[] = isSuperAdmin
    ? [
        { id: 'TENANTS', label: 'Tenants & Modules', icon: Layers },
        { id: 'SALES_REPS', label: 'Sales Reps & Commissions', icon: Users },
        { id: 'PRICING', label: 'Plan Pricing & Offers', icon: Tag },
        { id: 'PROMOS', label: 'Promo Codes', icon: TicketPercent },
        { id: 'PAYMENTS', label: 'Payment Logs', icon: Receipt },
        { id: 'GUIDE', label: 'System Walkthrough', icon: BookOpen }
      ]
    : [
        { id: 'TENANTS', label: 'My Client Onboarding', icon: Layers },
        { id: 'GUIDE', label: 'System Walkthrough & Demo', icon: BookOpen }
      ];

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-slate-900 text-white rounded-xl">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900">
                  {isSuperAdmin ? 'Biashara Ledger SaaS Admin' : 'Sales & Onboarding Partner Portal'}
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  {isSuperAdmin ? 'SUPER ADMIN' : `SALES PARTNER · ${adminProfile.commission_rate_pct}% COMM`}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {isSuperAdmin
                  ? 'Tenants, sales reps, specialist modules, live pricing & promo offers'
                  : `Signed in as ${adminProfile.full_name} (${adminProfile.email})`}
              </p>
            </div>
          </div>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline"
          >
            <ArrowLeft className="w-4 h-4" /> My Workspace
          </Link>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-xs text-slate-500">
              {isSuperAdmin ? 'Total Businesses' : 'My Onboarded Clients'}
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-1 tabular-money">{kpis.total}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-xs text-slate-500">Active Paid</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1 tabular-money">
              {kpis.activePaid}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-xs text-slate-500">On 14-Day Trial</p>
            <p className="text-2xl font-bold text-blue-600 mt-1 tabular-money">{kpis.trial}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-xs text-slate-500">
              {isSuperAdmin ? 'Suspended / Off' : 'Referred Monthly Volume'}
            </p>
            <p className="text-lg font-bold text-slate-900 mt-1 tabular-money">
              {isSuperAdmin ? kpis.locked : `KES ${kpis.estimatedMrr.toLocaleString()}`}
            </p>
          </div>
          <div className="col-span-2 md:col-span-1 bg-slate-900 text-white rounded-2xl p-4">
            <p className="text-xs text-slate-300 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              {isSuperAdmin ? 'Est. Active MRR' : `Est. Commission (${adminProfile.commission_rate_pct}%)`}
            </p>
            <p className="text-xl font-bold mt-1 tabular-money">
              KES{' '}
              {(isSuperAdmin ? kpis.estimatedMrr : kpis.estimatedCommission).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2">
          {availableTabs.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {tab.label}
              </button>
            );
          })}
        </div>

        {/* TAB 1: TENANTS */}
        {activeTab === 'TENANTS' && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
                  <Building2 className="w-4 h-4 text-blue-600" /> Onboard New Client Business
                </h2>
                {isSalesAdmin && (
                  <span className="text-[11px] text-slate-500">
                    Clients start on a 14-day trial and count toward your commission once paid.
                  </span>
                )}
              </div>
              {statusMsg && (
                <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-xl">
                  {statusMsg}
                </div>
              )}
              <form onSubmit={handleProvision} className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    placeholder="Client Business Name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="border border-slate-300 rounded-xl p-2.5 text-sm"
                  />
                  <input
                    type="email"
                    required
                    placeholder="Client Owner Email"
                    value={ownerEmail}
                    onChange={e => setOwnerEmail(e.target.value)}
                    className="border border-slate-300 rounded-xl p-2.5 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <input
                    type="text"
                    required
                    placeholder="Industry"
                    value={industry}
                    onChange={e => setIndustry(e.target.value)}
                    className="border border-slate-300 rounded-xl p-2.5 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="KRA PIN (Optional)"
                    value={kraPin}
                    onChange={e => setKraPin(e.target.value)}
                    className="border border-slate-300 rounded-xl p-2.5 text-sm"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Currency"
                    value={currency}
                    onChange={e => setCurrency(e.target.value)}
                    className="border border-slate-300 rounded-xl p-2.5 text-sm"
                  />
                  <select
                    value={plan}
                    onChange={e => setPlan(e.target.value)}
                    className="border border-slate-300 rounded-xl p-2.5 text-sm font-medium"
                  >
                    {PLANS.map(p => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-slate-600 mr-1">
                      Specialist Modules:
                    </span>
                    {SPECIALIST_MODULES.map(mod => {
                      const active = selectedModules.includes(mod.id);
                      return (
                        <button
                          key={mod.id}
                          type="button"
                          onClick={() =>
                            setSelectedModules(prev =>
                              prev.includes(mod.id)
                                ? prev.filter(m => m !== mod.id)
                                : [...prev, mod.id]
                            )
                          }
                          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition ${
                            active
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                          }`}
                        >
                          {mod.label}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold"
                  >
                    {loading ? 'Provisioning...' : 'Provision Business'}
                  </button>
                </div>
              </form>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
                  <Layers className="w-4 h-4 text-emerald-600" />
                  {isSuperAdmin
                    ? `Provisioned Businesses (${filteredTenants.length})`
                    : `My Onboarded Businesses (${filteredTenants.length})`}
                </h2>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Filter businesses..."
                    value={tenantSearch}
                    onChange={e => setTenantSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-2">Business</th>
                      <th className="py-2.5 px-2">Plan Tier</th>
                      <th className="py-2.5 px-2">Status</th>
                      <th className="py-2.5 px-2">Modules</th>
                      <th className="py-2.5 px-2">
                        {isSuperAdmin ? 'Period End & Renew' : 'Trial / Renewal End'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredTenants.map(t => (
                      <tr key={t.org_id} className="hover:bg-slate-50">
                        <td className="py-3 px-2">
                          <div className="font-semibold text-slate-900">{t.name}</div>
                          <div className="text-xs text-slate-500">
                            {t.industry || 'General'} · {t.currency || 'KES'}
                            {isSuperAdmin && t.onboarded_by_email
                              ? ` · Rep: ${t.onboarded_by_email}`
                              : ''}
                          </div>
                        </td>
                        <td className="py-3 px-2">
                          {isSuperAdmin ? (
                            <select
                              value={t.plan || 'STARTER'}
                              onChange={e =>
                                handleUpdateSub(
                                  t,
                                  e.target.value,
                                  t.status ?? 'ACTIVE',
                                  !!t.transport_addon
                                )
                              }
                              className="border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold bg-white"
                            >
                              {PLANS.map(p => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-800 text-xs font-semibold">
                              {t.plan || 'STARTER'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-2">
                          {isSuperAdmin ? (
                            <select
                              value={t.status || 'ACTIVE'}
                              onChange={e =>
                                handleUpdateSub(
                                  t,
                                  t.plan ?? 'STARTER',
                                  e.target.value,
                                  !!t.transport_addon
                                )
                              }
                              className={`border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold ${
                                t.status === 'ACTIVE'
                                  ? 'text-emerald-700 bg-emerald-50'
                                  : t.status === 'SUSPENDED'
                                    ? 'text-rose-700 bg-rose-50'
                                    : 'text-slate-700 bg-slate-50'
                              }`}
                            >
                              {STATUSES.map(s => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                t.status === 'ACTIVE'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : t.status === 'TRIAL'
                                    ? 'bg-blue-50 text-blue-700'
                                    : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {t.status || 'TRIAL'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-2">
                          <div className="flex flex-wrap gap-1 max-w-[230px]">
                            {SPECIALIST_MODULES.map(mod => {
                              const active =
                                (t.enabled_modules ?? []).includes(mod.id) ||
                                (mod.id === 'TRANSPORT' && !!t.transport_addon);
                              return isSuperAdmin ? (
                                <button
                                  key={mod.id}
                                  type="button"
                                  onClick={() => handleToggleModule(t, mod.id)}
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition ${
                                    active
                                      ? 'bg-blue-600 text-white border-blue-600'
                                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                                  }`}
                                >
                                  {mod.label}
                                </button>
                              ) : active ? (
                                <span
                                  key={mod.id}
                                  className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700"
                                >
                                  {mod.label}
                                </span>
                              ) : null;
                            })}
                          </div>
                        </td>
                        <td className="py-3 px-2 text-xs space-y-1">
                          <div className="text-slate-700 font-mono">
                            {t.current_period_end || '-'}
                          </div>
                          {isSuperAdmin && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleRenew(t.org_id, 1)}
                                className="px-2 py-0.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded font-semibold"
                              >
                                +1 Mo
                              </button>
                              <button
                                onClick={() => handleRenew(t.org_id, 3)}
                                className="px-2 py-0.5 bg-teal-50 text-teal-700 hover:bg-teal-100 rounded font-semibold"
                              >
                                +3 Mo
                              </button>
                              <button
                                onClick={() => handleRenew(t.org_id, 12)}
                                className="px-2 py-0.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded font-semibold"
                              >
                                +1 Yr
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredTenants.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-xs text-slate-400">
                          No businesses found yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB: SALES REPS & COMMISSIONS (SUPER ADMIN ONLY) */}
        {activeTab === 'SALES_REPS' && isSuperAdmin && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
              <h2 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
                <UserPlus className="w-4 h-4 text-blue-600" /> Add Sales / Onboarding Partner
              </h2>
              <form
                onSubmit={handleAddSalesRep}
                className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-center"
              >
                <input
                  type="text"
                  required
                  placeholder="Salesperson Full Name"
                  value={repName}
                  onChange={e => setRepName(e.target.value)}
                  className="border border-slate-300 rounded-xl p-2.5 text-sm"
                />
                <input
                  type="email"
                  required
                  placeholder="Salesperson Login Email"
                  value={repEmail}
                  onChange={e => setRepEmail(e.target.value)}
                  className="border border-slate-300 rounded-xl p-2.5 text-sm"
                />
                <div className="relative">
                  <input
                    type="number"
                    required
                    min="0"
                    max="100"
                    step="0.5"
                    placeholder="Commission %"
                    value={repCommission}
                    onChange={e => setRepCommission(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl p-2.5 text-sm pr-10"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-semibold">
                    %
                  </span>
                </div>
                <button
                  type="submit"
                  className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-2.5 px-4 text-sm font-semibold"
                >
                  Grant Sales Admin Access
                </button>
              </form>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
              <h2 className="font-bold text-slate-800 text-sm">
                Sales Partner Attribution &amp; Commission Tracker
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-2">Partner</th>
                      <th className="py-2.5 px-2">Rate</th>
                      <th className="py-2.5 px-2">Onboarded</th>
                      <th className="py-2.5 px-2">Paid / Trial</th>
                      <th className="py-2.5 px-2">Est. Commission</th>
                      <th className="py-2.5 px-2 text-right">Access</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {repStats.map(rep => (
                      <tr key={rep.email}>
                        <td className="py-3 px-2">
                          <div className="font-semibold text-slate-900">{rep.full_name}</div>
                          <div className="text-xs text-slate-500">{rep.email}</div>
                        </td>
                        <td className="py-3 px-2 font-semibold">{rep.commission_rate_pct}%</td>
                        <td className="py-3 px-2 font-bold">{rep.totalCount}</td>
                        <td className="py-3 px-2 text-xs">
                          <span className="text-emerald-700 font-semibold">
                            {rep.paidCount} Paid
                          </span>{' '}
                          · <span className="text-blue-600">{rep.trialCount} Trial</span>
                        </td>
                        <td className="py-3 px-2 font-bold text-emerald-700 tabular-money">
                          KES {rep.commission.toLocaleString()}
                        </td>
                        <td className="py-3 px-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleToggleRepActive(rep)}
                            className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                              rep.is_active
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-rose-50 text-rose-700'
                            }`}
                          >
                            {rep.is_active ? 'Active' : 'Suspended'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {repStats.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-xs text-slate-400">
                          No sales partners added yet. Add your salesman above to track his referrals.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB: SYSTEM WALKTHROUGH & DEMO GUIDE (BOTH SUPER & SALES ADMIN) */}
        {activeTab === 'GUIDE' && (
          <div className="space-y-6">
            <div className="bg-slate-900 text-white rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 max-w-xl">
                <h2 className="text-lg font-bold">Interactive Product Walkthrough</h2>
                <p className="text-xs text-slate-300">
                  Use your own workspace as a live sandbox to demonstrate how businesses manage
                  quotes, invoices, M-PESA receipts, transport fleets, rentals, and stock in one
                  place.
                </p>
              </div>
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold"
              >
                Open Live Workspace <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-2">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                  CORE · ALL PLANS
                </span>
                <h3 className="font-bold text-slate-900 text-sm">
                  1. Sales Flow (Quote → Invoice → Receipt PDF)
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Clients create a Quotation in seconds, convert it into an Invoice with 1 tap, and
                  record M-PESA or Bank payments into an official Receipt—all linked by a unique
                  chain code and shareable as branded PDFs on WhatsApp.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-2">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                  SPECIALIST · TRANSPORT &amp; FLEET
                </span>
                <h3 className="font-bold text-slate-900 text-sm">
                  2. Fleet, Trips, Drivers &amp; Fuel Margin
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Built for transport &amp; logistics operators: register vehicles, assign drivers,
                  dispatch trips, and log fuel/service expenses directly against each vehicle to see
                  exact net profit per vehicle.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-2">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700">
                  GROWTH+ · INVENTORY &amp; SUPPLIERS
                </span>
                <h3 className="font-bold text-slate-900 text-sm">
                  3. SKU Stock Control &amp; Supplier Bills (AP)
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Tracks product variants/SKUs, low-stock alerts, GRN restocks, and supplier bills
                  with automatic General Ledger double-entry postings.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-2">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-purple-50 text-purple-700">
                  INTELLIGENCE · REPORTS &amp; KRA
                </span>
                <h3 className="font-bold text-slate-900 text-sm">
                  4. Real-Time Cash Flow, P&amp;L &amp; Statements
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Instant Profit &amp; Loss, Balance Sheet, Trial Balance, VAT summary, and
                  downloadable customer statements—so owners know their true cash position daily.
                </p>
              </div>
            </div>

            {pricing.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <h3 className="font-bold text-slate-900 text-sm">
                  Current Plan Tiers &amp; Commission Reference
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                  {pricing.map(p => {
                    const price = effectivePriceMap[p.plan] ?? Number(p.monthly_price_kes);
                    const estComm = Math.round(
                      (price * Number(adminProfile.commission_rate_pct || 20)) / 100
                    );
                    return (
                      <div key={p.plan} className="border border-slate-200 rounded-xl p-3 space-y-1">
                        <div className="font-bold text-slate-900">{p.display_name}</div>
                        <div className="text-blue-600 font-bold tabular-money">
                          KES {price.toLocaleString()}/mo
                        </div>
                        {isSalesAdmin && (
                          <div className="text-[11px] text-emerald-700 font-semibold tabular-money">
                            Your cut: KES {estComm.toLocaleString()}/mo
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: PRICING & PROMOTIONAL OFFERS (SUPER ADMIN ONLY) */}
        {activeTab === 'PRICING' && isSuperAdmin && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pricing.map(row => (
              <div
                key={row.plan}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      {row.plan}
                    </span>
                    <h3 className="text-base font-bold text-slate-900 mt-1">{row.display_name}</h3>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={row.is_public}
                      onChange={e => handlePricingField(row.plan, 'is_public', e.target.checked)}
                    />
                    Publicly Listed
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <label className="block">
                    <span className="text-slate-500 font-medium">Standard Monthly (KES)</span>
                    <input
                      type="number"
                      min="0"
                      value={row.monthly_price_kes}
                      onChange={e =>
                        handlePricingField(row.plan, 'monthly_price_kes', Number(e.target.value))
                      }
                      className="mt-1 w-full border border-slate-300 rounded-xl p-2 text-sm font-semibold"
                    />
                  </label>
                  <label className="block">
                    <span className="text-slate-500 font-medium">Promo Price (KES, optional)</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="None"
                      value={row.promo_price_kes ?? ''}
                      onChange={e =>
                        handlePricingField(
                          row.plan,
                          'promo_price_kes',
                          e.target.value ? Number(e.target.value) : null
                        )
                      }
                      className="mt-1 w-full border border-slate-300 rounded-xl p-2 text-sm font-semibold"
                    />
                  </label>
                  <label className="block">
                    <span className="text-slate-500 font-medium">Offer Badge Label</span>
                    <input
                      type="text"
                      placeholder="e.g. Launch Offer -33%"
                      value={row.promo_label ?? ''}
                      onChange={e => handlePricingField(row.plan, 'promo_label', e.target.value)}
                      className="mt-1 w-full border border-slate-300 rounded-xl p-2 text-xs"
                    />
                  </label>
                  <label className="block">
                    <span className="text-slate-500 font-medium">Annual Discount (%)</span>
                    <input
                      type="number"
                      min="0"
                      max="80"
                      value={row.annual_discount_pct}
                      onChange={e =>
                        handlePricingField(row.plan, 'annual_discount_pct', Number(e.target.value))
                      }
                      className="mt-1 w-full border border-slate-300 rounded-xl p-2 text-sm"
                    />
                  </label>
                </div>

                <label className="block text-xs">
                  <span className="text-slate-500 font-medium">Offer Ends At (Optional)</span>
                  <input
                    type="date"
                    value={row.promo_ends_at ? row.promo_ends_at.slice(0, 10) : ''}
                    onChange={e =>
                      handlePricingField(
                        row.plan,
                        'promo_ends_at',
                        e.target.value ? `${e.target.value}T23:59:59Z` : null
                      )
                    }
                    className="mt-1 w-full border border-slate-300 rounded-xl p-2 text-xs"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => handleSavePlanPrice(row)}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold"
                >
                  Save {row.display_name} Pricing
                </button>
              </div>
            ))}
          </div>
        )}

        {/* TAB 3: PROMO CODES (SUPER ADMIN ONLY) */}
        {activeTab === 'PROMOS' && isSuperAdmin && (
          <div className="space-y-5">
            <form
              onSubmit={handleCreatePromo}
              className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-3"
            >
              <h2 className="font-bold text-slate-800 text-sm">Create Promotional Code</h2>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Code (e.g. LAUNCH30)"
                  value={newCode}
                  onChange={e => setNewCode(e.target.value.toUpperCase())}
                  className="border border-slate-300 rounded-xl p-2 text-xs font-bold uppercase"
                />
                <select
                  value={newDiscountType}
                  onChange={e =>
                    setNewDiscountType(e.target.value as PromoCodeRow['discount_type'])
                  }
                  className="border border-slate-300 rounded-xl p-2 text-xs bg-white"
                >
                  <option value="PERCENT">% Off</option>
                  <option value="FIXED_KES">KES Off</option>
                  <option value="BONUS_DAYS">+ Bonus Days</option>
                </select>
                <input
                  type="number"
                  required
                  min="1"
                  placeholder="Value"
                  value={newDiscountValue}
                  onChange={e => setNewDiscountValue(e.target.value)}
                  className="border border-slate-300 rounded-xl p-2 text-xs"
                />
                <select
                  value={newApplicablePlan}
                  onChange={e => setNewApplicablePlan(e.target.value)}
                  className="border border-slate-300 rounded-xl p-2 text-xs bg-white"
                >
                  <option value="ALL">All Plans</option>
                  {PLANS.map(p => (
                    <option key={p} value={p}>
                      {p} Only
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  placeholder="Max uses"
                  value={newMaxUses}
                  onChange={e => setNewMaxUses(e.target.value)}
                  className="border border-slate-300 rounded-xl p-2 text-xs"
                />
                <input
                  type="date"
                  value={newValidUntil}
                  onChange={e => setNewValidUntil(e.target.value)}
                  className="border border-slate-300 rounded-xl p-2 text-xs"
                />
              </div>
              <button
                type="submit"
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold"
              >
                Create Promo Code
              </button>
            </form>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h3 className="font-bold text-slate-800 text-sm mb-3">
                Active &amp; Past Codes ({promos.length})
              </h3>
              <div className="divide-y divide-slate-100">
                {promos.map(p => (
                  <div
                    key={p.id}
                    className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-slate-900 text-sm">{p.code}</span>
                      <span className="ml-2 px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">
                        {p.discount_type === 'PERCENT'
                          ? `${p.discount_value}% OFF`
                          : p.discount_type === 'FIXED_KES'
                            ? `KES ${p.discount_value.toLocaleString()} OFF`
                            : `+${p.discount_value} Days`}
                      </span>
                      <span className="ml-2 text-slate-500">
                        {p.applicable_plan || 'All Plans'} · Used {p.used_count}
                        {p.max_uses ? `/${p.max_uses}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleTogglePromo(p)}
                        className={`px-2.5 py-1 rounded-lg font-semibold ${
                          p.is_active
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {p.is_active ? 'Active' : 'Paused'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePromo(p.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {promos.length === 0 && (
                  <p className="text-xs text-slate-400 py-2">No promo codes yet.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: PAYMENT LOGS (SUPER ADMIN ONLY) */}
        {activeTab === 'PAYMENTS' && isSuperAdmin && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h2 className="font-bold text-slate-800 text-sm mb-3">
              Recent Subscription Payments ({payments.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2 px-2">Date</th>
                    <th className="py-2 px-2">Business</th>
                    <th className="py-2 px-2">Reference</th>
                    <th className="py-2 px-2">Plan &amp; Term</th>
                    <th className="py-2 px-2">Amount</th>
                    <th className="py-2 px-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map(pay => (
                    <tr key={pay.id}>
                      <td className="py-2.5 px-2 text-slate-500">{pay.created_at.slice(0, 10)}</td>
                      <td className="py-2.5 px-2 font-semibold text-slate-800">
                        {orgNameById[pay.org_id] || pay.org_id.slice(0, 8)}
                      </td>
                      <td className="py-2.5 px-2 font-mono">{pay.reference}</td>
                      <td className="py-2.5 px-2">
                        {pay.plan} ({pay.months} mo)
                      </td>
                      <td className="py-2.5 px-2 font-semibold">
                        KES {Number(pay.amount_kes).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2">
                        <span className="px-2 py-0.5 rounded bg-slate-100 font-semibold">
                          {pay.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {payments.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-slate-400">
                        No automated gateway payments recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}