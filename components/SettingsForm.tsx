'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Membership } from '@/lib/types';
import { Upload } from 'lucide-react';

type Props = {
  org: Membership;
  onOrgChange: (updated: Membership) => void;
  onSaved: () => void;
};

export default function SettingsForm({ org, onOrgChange, onSaved }: Props) {
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

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

  return (
    <form onSubmit={handleSaveSettings} className="bg-white border border-slate-200 rounded-2xl p-6 max-w-2xl space-y-4">
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
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs font-medium text-slate-600">Company Name</label><input type="text" required value={org.name || ''} onChange={e => onOrgChange({ ...org, name: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
        <div><label className="text-xs font-medium text-slate-600">Industry</label><input type="text" value={org.industry || ''} onChange={e => onOrgChange({ ...org, industry: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
        <div><label className="text-xs font-medium text-slate-600">PDF Template</label>
          <select value={org.pdf_template || 'MODERN'} onChange={e => onOrgChange({ ...org, pdf_template: e.target.value as Membership['pdf_template'] })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1">
            <option value="MODERN">Modern Executive</option>
            <option value="CLASSIC">Classic Formal</option>
            <option value="MINIMAL">Minimalist Clean</option>
          </select>
        </div>
        <div><label className="text-xs font-medium text-slate-600">Brand Accent Color</label><input type="color" value={org.pdf_accent_color || '#0f172a'} onChange={e => onOrgChange({ ...org, pdf_accent_color: e.target.value })} className="w-full h-10 rounded-xl border border-slate-300 mt-1 cursor-pointer" /></div>
        <div><label className="text-xs font-medium text-slate-600">Phone</label><input type="text" value={org.phone || ''} onChange={e => onOrgChange({ ...org, phone: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
        <div><label className="text-xs font-medium text-slate-600">Email</label><input type="email" value={org.email || ''} onChange={e => onOrgChange({ ...org, email: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
        <div><label className="text-xs font-medium text-slate-600">KRA PIN</label><input type="text" value={org.kra_pin || ''} onChange={e => onOrgChange({ ...org, kra_pin: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
        <div><label className="text-xs font-medium text-slate-600">Currency</label><input type="text" value={org.currency || 'KES'} onChange={e => onOrgChange({ ...org, currency: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
      </div>
      <div><label className="text-xs font-medium text-slate-600">Tagline</label><input type="text" value={org.tagline || ''} onChange={e => onOrgChange({ ...org, tagline: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
      <div><label className="text-xs font-medium text-slate-600">Payment Instructions</label><input type="text" value={org.payment_instructions || ''} onChange={e => onOrgChange({ ...org, payment_instructions: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
      <div><label className="text-xs font-medium text-slate-600">Footer Note</label><input type="text" value={org.pdf_footer_note || ''} onChange={e => onOrgChange({ ...org, pdf_footer_note: e.target.value })} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm mt-1" /></div>
      <button type="submit" className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold">Save Settings</button>
    </form>
  );
}