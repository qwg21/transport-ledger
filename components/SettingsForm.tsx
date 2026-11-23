'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Membership, Subscription } from '@/lib/types';
import PdfTemplatePicker from '@/components/PdfTemplatePicker';
import TeamManagementSection from '@/components/TeamManagementSection';
import { Upload, CreditCard, KeyRound, MailCheck } from 'lucide-react';

interface PlanPrice {
  plan: string;
  display_name: string;
  monthly_price_kes: number;
  promo_price_kes: number | null;
  promo_label: string | null;
  promo_ends_at: string | null;
  annual_discount_pct: number;
  is_public: boolean;
}

type Props = {
  org: Membership;
  sub?: Subscription | null;
  onOrgChange: (updated: Membership) => void;
  onSaved: () => void;
  isIntelligencePlus?: boolean;
  hasRentalsAddon?: boolean;
  currentUserId?: string;
  userEmail?: string;
  isReadOnly?: boolean;
};

export default function SettingsForm({
  org,
  sub,
  onOrgChange,
  onSaved,
  isIntelligencePlus = false,
  hasRentalsAddon = false,
  currentUserId,
  userEmail,
  isReadOnly = false
}: Props) {
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [plans, setPlans] = useState<PlanPrice[]>([]);
  const [selectedPlan, setSelectedPlan] = useState(sub?.plan || 'ESSENTIAL');

  // Password management state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [resetEmailLoading, setResetEmailLoading] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (sub?.plan) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- subscription data is loaded asynchronously and must update the billing dropdown
      setSelectedPlan(sub.plan);
    }
  }, [sub?.plan]);

  const [months, setMonths] = useState<1 | 3 | 12>(1);
  const [promoCode, setPromoCode] = useState('');
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadPricing() {
      const { data } = await supabase
        .from('plan_pricing')
        .select('plan, display_name, monthly_price_kes, promo_price_kes, promo_label, promo_ends_at, annual_discount_pct, is_public')
        .eq('is_public', true)
        .order('sort_order', { ascending: true });
      if (active && data) {
        setPlans(data as PlanPrice[]);
      }
    }
    loadPricing();
    return () => {
      active = false;
    };
  }, []);

  const isCaretaker = (org.role || '').toLowerCase() === 'caretaker';
  const rentalsEnabled =
    hasRentalsAddon || Boolean(sub?.enabled_modules?.some(m => m.toUpperCase() === 'RENTALS'));

  const activePlanRow = plans.find(p => p.plan === selectedPlan);
  const effectiveMonthly = activePlanRow
    ? activePlanRow.promo_price_kes && activePlanRow.promo_price_kes > 0
      ? Number(activePlanRow.promo_price_kes)
      : Number(activePlanRow.monthly_price_kes)
    : 0;
  const estimatedTotal =
    months === 12 && activePlanRow?.annual_discount_pct
      ? Math.round(effectiveMonthly * 12 * (1 - Number(activePlanRow.annual_discount_pct) / 100))
      : effectiveMonthly * months;

  const handlePaySubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    setBillingError(null);
    setBillingLoading(true);
    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setBillingError('Session expired. Please sign in again.');
        return;
      }

      const res = await fetch('/api/paystack/initialize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          orgId: org.id,
          plan: selectedPlan,
          months,
          promoCode: promoCode.trim() || undefined
        })
      });

      const json = (await res.json()) as { authorization_url?: string; error?: string };
      if (!res.ok || !json.authorization_url) {
        setBillingError(json.error || 'Could not start checkout.');
        return;
      }

      window.location.href = json.authorization_url;
    } finally {
      setBillingLoading(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase
      .from('organizations')
      .update({
        name: org.name,
        industry: org.industry,
        tagline: org.tagline,
        phone: org.phone,
        email: org.email,
        address: org.address,
        kra_pin: org.kra_pin,
        currency: org.currency,
        payment_instructions: org.payment_instructions,
        logo_url: org.logo_url,
        pdf_template: org.pdf_template,
        pdf_accent_color: org.pdf_accent_color,
        pdf_footer_note: org.pdf_footer_note
      })
      .eq('id', org.id);

    if (error) alert(error.message);
    else {
      alert('Settings saved.');
      onSaved();
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingLogo(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `${org.id}/logo-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('business-assets')
        .upload(path, file, { upsert: true });

      if (uploadErr) {
        alert(`Logo upload failed: ${uploadErr.message}`);
        return;
      }

      const { data: urlData } = supabase.storage.from('business-assets').getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      onOrgChange({ ...org, logo_url: publicUrl });
      await supabase.from('organizations').update({ logo_url: publicUrl }).eq('id', org.id);
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);

    if (newPassword.length < 6) {
      setPasswordFeedback({ type: 'error', text: 'Password must be at least 6 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    setPasswordLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setPasswordFeedback({ type: 'error', text: error.message });
        return;
      }
      setNewPassword('');
      setConfirmPassword('');
      setPasswordFeedback({ type: 'success', text: 'Password updated successfully.' });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSendPasswordResetEmail = async () => {
    setPasswordFeedback(null);
    setResetEmailLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const targetEmail = userEmail || user?.email;
      if (!targetEmail) {
        setPasswordFeedback({ type: 'error', text: 'No account email found.' });
        return;
      }
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/` : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, { redirectTo });
      if (error) {
        setPasswordFeedback({ type: 'error', text: error.message });
        return;
      }
      setPasswordFeedback({
        type: 'success',
        text: `Password reset link sent to ${targetEmail}.`
      });
    } finally {
      setResetEmailLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Subscription & Paystack Billing (Owners / Admins only) */}
      {!isCaretaker && (
        <form onSubmit={handlePaySubscription} className="bg-white border border-slate-200 rounded-2xl p-6 max-w-2xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-slate-900 flex items-center gap-2 text-sm">
                <CreditCard className="w-4 h-4 text-emerald-600" /> Subscription &amp; Billing (M-PESA / Card)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Current Plan: <strong>{sub?.plan || 'STARTER'}</strong> &middot; Status:{' '}
                <strong>{sub?.status || 'ACTIVE'}</strong>
                {sub?.current_period_end ? ` · Renews ${sub.current_period_end}` : ''}
              </p>
            </div>
          </div>

          {billingError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs">
              {billingError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600">Plan</label>
              <select
                value={selectedPlan}
                onChange={e => setSelectedPlan(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1 bg-white font-semibold"
              >
                {plans.map(p => (
                  <option key={p.plan} value={p.plan}>
                    {p.display_name} (KES {(p.promo_price_kes && p.promo_price_kes > 0 ? p.promo_price_kes : p.monthly_price_kes).toLocaleString()}/mo)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600">Billing Cycle</label>
              <select
                value={months}
                onChange={e => setMonths(Number(e.target.value) as 1 | 3 | 12)}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1 bg-white"
              >
                <option value={1}>1 Month</option>
                <option value={3}>3 Months</option>
                <option value={12}>
                  12 Months {activePlanRow?.annual_discount_pct ? `(-${activePlanRow.annual_discount_pct}%)` : ''}
                </option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600">Promo Code (Optional)</label>
              <input
                type="text"
                placeholder="e.g. LAUNCH30"
                value={promoCode}
                onChange={e => setPromoCode(e.target.value.toUpperCase())}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1 uppercase font-mono"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={billingLoading || plans.length === 0}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold"
          >
            {billingLoading
              ? 'Opening Paystack Checkout...'
              : `Pay KES ${estimatedTotal.toLocaleString()} with M-PESA / Card`}
          </button>
        </form>
      )}

      {/* Business Branding & Organization Details */}
      {!isCaretaker && (
        <form onSubmit={handleSaveSettings} className="bg-white border border-slate-200 rounded-2xl p-6 max-w-2xl space-y-5">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Company Logo (PNG/JPG)</label>
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL or legacy data: URL */}
              {org.logo_url && <img src={org.logo_url} alt="Logo" className="w-14 h-14 rounded-xl border border-slate-200 object-contain p-1" />}
              <label className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-semibold cursor-pointer">
                <Upload className="w-4 h-4" /> {isUploadingLogo ? 'Uploading...' : 'Upload Logo'}
                <input type="file" accept="image/png, image/jpeg" onChange={handleLogoUpload} disabled={isUploadingLogo} className="hidden" />
              </label>
            </div>
          </div>

          <PdfTemplatePicker
            value={org.pdf_template || 'MODERN'}
            accentColor={org.pdf_accent_color || '#0f172a'}
            onChange={templateId =>
              onOrgChange({ ...org, pdf_template: templateId as Membership['pdf_template'] })
            }
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-slate-600">Company Name</label><input type="text" required value={org.name || ''} onChange={e => onOrgChange({ ...org, name: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
            <div><label className="text-xs font-medium text-slate-600">Industry</label><input type="text" value={org.industry || ''} onChange={e => onOrgChange({ ...org, industry: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
            <div><label className="text-xs font-medium text-slate-600">Brand Accent Color</label><input type="color" value={org.pdf_accent_color || '#0f172a'} onChange={e => onOrgChange({ ...org, pdf_accent_color: e.target.value })} className="w-full h-10 rounded-xl border border-slate-300 mt-1 cursor-pointer" /></div>
            <div><label className="text-xs font-medium text-slate-600">Currency</label><input type="text" value={org.currency || 'KES'} onChange={e => onOrgChange({ ...org, currency: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
            <div><label className="text-xs font-medium text-slate-600">Phone</label><input type="text" value={org.phone || ''} onChange={e => onOrgChange({ ...org, phone: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
            <div><label className="text-xs font-medium text-slate-600">Email</label><input type="email" value={org.email || ''} onChange={e => onOrgChange({ ...org, email: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
            <div><label className="text-xs font-medium text-slate-600">KRA PIN</label><input type="text" value={org.kra_pin || ''} onChange={e => onOrgChange({ ...org, kra_pin: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
            <div><label className="text-xs font-medium text-slate-600">Address</label><input type="text" value={org.address || ''} onChange={e => onOrgChange({ ...org, address: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
          </div>
          <div><label className="text-xs font-medium text-slate-600">Tagline</label><input type="text" value={org.tagline || ''} onChange={e => onOrgChange({ ...org, tagline: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
          <div><label className="text-xs font-medium text-slate-600">Payment Instructions</label><input type="text" value={org.payment_instructions || ''} onChange={e => onOrgChange({ ...org, payment_instructions: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
          <div><label className="text-xs font-medium text-slate-600">Footer Note</label><input type="text" value={org.pdf_footer_note || ''} onChange={e => onOrgChange({ ...org, pdf_footer_note: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
          <button type="submit" disabled={isReadOnly} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold">Save Settings</button>
        </form>
      )}

      {/* Account Security & Password Reset (All modules & roles) */}
      <form onSubmit={handleChangePassword} className="bg-white border border-slate-200 rounded-2xl p-6 max-w-2xl space-y-4">
        <div>
          <h3 className="font-bold text-slate-900 flex items-center gap-2 text-sm">
            <KeyRound className="w-4 h-4 text-blue-600" /> Account Security &amp; Password
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Update your login password directly or send a password reset link to your email.
          </p>
        </div>

        {passwordFeedback && (
          <div
            className={`p-3 rounded-xl border text-xs font-medium ${
              passwordFeedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}
          >
            {passwordFeedback.text}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-600">New Password</label>
            <input
              type="password"
              minLength={6}
              required
              placeholder="At least 6 characters"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Confirm New Password</label>
            <input
              type="password"
              minLength={6}
              required
              placeholder="Repeat new password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="submit"
            disabled={passwordLoading}
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-sm font-semibold"
          >
            {passwordLoading ? 'Updating...' : 'Update Password'}
          </button>
          <button
            type="button"
            disabled={resetEmailLoading}
            onClick={handleSendPasswordResetEmail}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <MailCheck className="w-4 h-4" />
            {resetEmailLoading ? 'Sending email...' : 'Send Reset Link via Email'}
          </button>
        </div>
      </form>

      {!isCaretaker && (
        <TeamManagementSection
          orgId={org.id}
          userRole={org.role}
          currentUserId={currentUserId}
          isIntelligencePlus={isIntelligencePlus}
          hasRentalsAddon={rentalsEnabled}
          isReadOnly={isReadOnly}
        />
      )}
    </div>
  );
}