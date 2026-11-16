'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import AuthScreen from '@/components/AuthScreen';
import { ShieldCheck, Building2, ArrowLeft, Layers } from 'lucide-react';
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
  current_period_end: string | null;
}

const PLATFORM_ADMIN_EMAIL = 'quentinwg2015@gmail.com';
const PLANS = ['ESSENTIAL', 'GROWTH', 'INTELLIGENCE', 'ENTERPRISE'] as const;
const STATUSES = ['ACTIVE', 'TRIAL', 'SUSPENDED', 'CANCELLED'] as const;

export default function PlatformAdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('General Business');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [kraPin, setKraPin] = useState('');
  const [currency, setCurrency] = useState('KES');
  const [plan, setPlan] = useState('ESSENTIAL');
  const [transportAddon, setTransportAddon] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTenants = useCallback(async () => {
    const { data } = await supabase.rpc('platform_list_tenants');
    if (data) setTenants(data as Tenant[]);
  }, []);

  const checkAuth = useCallback(async () => {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    setUser(currentUser);
    setChecked(true);
    if (currentUser?.email?.toLowerCase() === PLATFORM_ADMIN_EMAIL) {
      loadTenants();
    }
  }, [loadTenants]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load: state is only set after the awaited request resolves
    checkAuth();
  }, [checkAuth]);

  if (!checked) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">Loading...</div>;
  if (!user) return <AuthScreen onAuthenticated={checkAuth} />;

  if (user.email?.toLowerCase() !== PLATFORM_ADMIN_EMAIL) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md w-full text-center space-y-3">
          <h1 className="text-lg font-bold text-slate-900">Access Denied</h1>
          <Link href="/" className="inline-block px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold">Return to Workspace</Link>
        </div>
      </div>
    );
  }

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatusMsg(null);

    const { data, error } = await supabase.rpc('platform_provision_business', {
      p_name: name,
      p_industry: industry,
      p_owner_email: ownerEmail,
      p_kra_pin: kraPin || null,
      p_currency: currency,
      p_plan: plan,
      p_transport_addon: transportAddon
    });

    setLoading(false);
    if (error) {
      setStatusMsg(`Error: ${error.message}`);
      return;
    }

    setStatusMsg(
      data?.status === 'LINKED_EXISTING_USER'
        ? `Provisioned "${name}" (${plan}) and linked to ${ownerEmail}.`
        : `Provisioned "${name}" (${plan}). ${ownerEmail} will be linked automatically upon signing up.`
    );
    setName(''); setOwnerEmail(''); setKraPin('');
    loadTenants();
  };

  const handleUpdateSub = async (t: Tenant, newPlan: string, newStatus: string, newTransport: boolean) => {
    const { error } = await supabase.rpc('platform_update_subscription', {
      p_org_id: t.org_id,
      p_plan: newPlan,
      p_status: newStatus,
      p_transport_addon: newTransport
    });
    if (error) alert(error.message);
    else loadTenants();
  };

  const handleRenew = async (orgId: string, months: number) => {
    const { error } = await supabase.rpc('platform_record_subscription_payment', {
      p_org_id: orgId,
      p_months: months
    });
    if (error) alert(error.message);
    else loadTenants();
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-slate-900 text-white rounded-xl"><ShieldCheck className="w-5 h-5" /></div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Platform Admin Console</h1>
              <p className="text-xs text-slate-500">Provision businesses, tiers &amp; subscriptions</p>
            </div>
          </div>
          <Link href="/" className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline">
            <ArrowLeft className="w-4 h-4" /> My Workspace
          </Link>
        </div>

        {/* Provision New Business */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
            <Building2 className="w-4 h-4 text-blue-600" /> Onboard New Client Business
          </h2>

          {statusMsg && <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-xl">{statusMsg}</div>}

          <form onSubmit={handleProvision} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input type="text" required placeholder="Client Business Name" value={name} onChange={e => setName(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
              <input type="email" required placeholder="Client Owner Email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <input type="text" required placeholder="Industry" value={industry} onChange={e => setIndustry(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
              <input type="text" placeholder="KRA PIN (Optional)" value={kraPin} onChange={e => setKraPin(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
              <input type="text" required placeholder="Currency" value={currency} onChange={e => setCurrency(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm" />
              <select value={plan} onChange={e => setPlan(e.target.value)} className="border border-slate-300 rounded-xl p-2.5 text-sm font-medium">
                {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input type="checkbox" checked={transportAddon} onChange={e => setTransportAddon(e.target.checked)} className="rounded" />
                Enable Transport Management Add-on
              </label>
              <button type="submit" disabled={loading} className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold">
                {loading ? 'Provisioning...' : 'Provision Business'}
              </button>
            </div>
          </form>
        </div>

        {/* Active Businesses & Subscriptions Table */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
            <Layers className="w-4 h-4 text-emerald-600" /> Provisioned Businesses &amp; Subscriptions ({tenants.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-2">Business</th>
                  <th className="py-2.5 px-2">Plan Tier</th>
                  <th className="py-2.5 px-2">Status / Manual Shutdown</th>
                  <th className="py-2.5 px-2">Transport Add-on</th>
                  <th className="py-2.5 px-2">Period End</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tenants.map(t => (
                  <tr key={t.org_id} className="hover:bg-slate-50">
                    <td className="py-3 px-2">
                      <div className="font-semibold text-slate-900">{t.name}</div>
                      <div className="text-xs text-slate-500">{t.industry} • {t.currency}</div>
                    </td>
                    <td className="py-3 px-2">
                      <select
                        value={t.plan || 'ESSENTIAL'}
                        onChange={e => handleUpdateSub(t, e.target.value, t.status ?? 'ACTIVE', !!t.transport_addon)}
                        className="border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold bg-white"
                      >
                        {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td className="py-3 px-2">
                      <select
                        value={t.status || 'ACTIVE'}
                        onChange={e => handleUpdateSub(t, t.plan ?? 'ESSENTIAL', e.target.value, !!t.transport_addon)}
                        className={`border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold ${
                          t.status === 'ACTIVE' ? 'text-emerald-700 bg-emerald-50' :
                          t.status === 'SUSPENDED' ? 'text-rose-700 bg-rose-50' : 'text-slate-700 bg-slate-50'
                        }`}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="py-3 px-2">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!t.transport_addon}
                          onChange={e => handleUpdateSub(t, t.plan ?? 'ESSENTIAL', t.status ?? 'ACTIVE', e.target.checked)}
                        />
                        {t.transport_addon ? 'Enabled' : 'Off'}
                      </label>
                    </td>
                    <td className="py-3 px-2 text-xs space-y-1">
                      <div className="text-slate-700 font-mono">{t.current_period_end || '-'}</div>
                      <div className="flex gap-1">
                        <button onClick={() => handleRenew(t.org_id, 1)} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded font-semibold">+1 Mo</button>
                        <button onClick={() => handleRenew(t.org_id, 12)} className="px-2 py-0.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded font-semibold">+1 Yr</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}