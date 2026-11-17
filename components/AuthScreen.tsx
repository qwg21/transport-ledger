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
  const [isSignUp, setIsSignUp] = useState(false);
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
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

    if (isSignUp && !acceptedPolicies) {
      setMessage('Please accept the Terms of Service and Privacy Policy to create an account.');
      return;
    }

    setIsSubmitting(true);

    const result = isSignUp
      ? await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              terms_version: TERMS_VERSION,
              privacy_version: PRIVACY_VERSION
            }
          }
        })
      : await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      setIsSubmitting(false);
      setMessage(result.error.message);
      return;
    }

    if (isSignUp && !result.data.session) {
      setIsSubmitting(false);
      setMessage('Check your email to confirm your account, then sign in.');
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
          <p className="text-sm text-slate-500 mt-1">{isSignUp ? 'Create your account' : 'Sign in to your workspace'}</p>
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

        {isSignUp && (
          <label className="flex items-start gap-2.5 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={acceptedPolicies}
              onChange={event => setAcceptedPolicies(event.target.checked)}
              className="mt-0.5 rounded border-slate-300"
            />
            <span>
              I agree to the{' '}
              <Link href="/terms" target="_blank" className="text-blue-600 hover:underline font-medium">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" target="_blank" className="text-blue-600 hover:underline font-medium">
                Privacy Policy
              </Link>
              .
            </span>
          </label>
        )}

        <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5">
          {isSubmitting ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsSignUp(value => !value);
            setMessage(null);
          }}
          className="w-full text-sm text-blue-600 hover:underline"
        >
          {isSignUp ? 'Already have an account? Sign in' : 'Need an account? Create one'}
        </button>

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