'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { TERMS_VERSION, PRIVACY_VERSION } from '@/lib/legal';

interface Props {
  onAuthenticated: () => void | Promise<void>;
}

export default function AuthScreen({ onAuthenticated }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const recordAgreementIfNeeded = async (userId: string) => {
    const { data: existing } = await supabase
      .from('user_agreements')
      .select('id')
      .eq('user_id', userId)
      .eq('terms_version', TERMS_VERSION)
      .eq('privacy_version', PRIVACY_VERSION)
      .limit(1);

    if (!existing || existing.length === 0) {
      await supabase.from('user_agreements').insert({
        user_id: userId,
        terms_version: TERMS_VERSION,
        privacy_version: PRIVACY_VERSION
      });
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setIsSubmitting(true);

    const result = await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      setIsSubmitting(false);
      setMessage(result.error.message);
      return;
    }

    if (result.data.user) {
      await recordAgreementIfNeeded(result.data.user.id);
    }

    setIsSubmitting(false);
    await onAuthenticated();
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-lg p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Biashara Ledger</h1>
          <p className="text-sm text-slate-500 mt-1">Sign in to your workspace</p>
        </div>
        {message && <p className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">{message}</p>}
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input type="email" required value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full border border-slate-300 rounded-xl p-2.5" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Password
          <input type="password" required minLength={6} value={password} onChange={event => setPassword(event.target.value)} className="mt-1 w-full border border-slate-300 rounded-xl p-2.5" />
        </label>

        <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5">
          {isSubmitting ? 'Signing in...' : 'Sign In'}
        </button>

        <p className="text-xs text-center text-slate-500">
          Access is by invitation only. Check your email invite or contact your business administrator.
        </p>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-center gap-4 text-xs text-slate-400">
          <Link href="/terms" className="hover:text-slate-600 hover:underline">
            Terms
          </Link>
          <span>&middot;</span>
          <Link href="/privacy" className="hover:text-slate-600 hover:underline">
            Privacy
          </Link>
        </div>
      </form>
    </main>
  );
}