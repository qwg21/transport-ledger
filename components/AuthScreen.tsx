'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { TERMS_VERSION, PRIVACY_VERSION } from '@/lib/legal';

interface Props {
  onAuthenticated: () => void | Promise<void>;
}

type AuthMode = 'SIGN_IN' | 'FORGOT_PASSWORD' | 'UPDATE_PASSWORD';

export default function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<AuthMode>(() => {
    if (typeof window !== 'undefined' && window.location.hash.includes('type=recovery')) {
      return 'UPDATE_PASSWORD';
    }
    return 'SIGN_IN';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'info' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('UPDATE_PASSWORD');
        setMessage(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

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

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setIsSubmitting(true);

    const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });

    if (result.error) {
      setIsSubmitting(false);
      setMessage({ type: 'error', text: result.error.message });
      return;
    }

    if (result.data.user) {
      await recordAgreementIfNeeded(result.data.user.id);
    }

    setIsSubmitting(false);
    await onAuthenticated();
  };

  const handleSendReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setMessage({ type: 'error', text: 'Enter your account email address first.' });
      return;
    }

    setIsSubmitting(true);
    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/` : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, { redirectTo });
    setIsSubmitting(false);

    if (error) {
      setMessage({ type: 'error', text: error.message });
      return;
    }

    setMessage({
      type: 'info',
      text: `Password reset instructions sent to ${trimmedEmail}. Check your inbox (and spam folder) to set a new password.`
    });
  };

  const handleUpdatePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);

    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'New password must be at least 6 characters.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    setIsSubmitting(true);
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setIsSubmitting(false);
      setMessage({ type: 'error', text: error.message });
      return;
    }

    if (data.user) {
      await recordAgreementIfNeeded(data.user.id);
    }

    setIsSubmitting(false);
    setNewPassword('');
    setConfirmPassword('');
    await onAuthenticated();
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      {mode === 'SIGN_IN' && (
        <form onSubmit={handleSignIn} className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-lg p-6 space-y-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Biashara Ledger</h1>
            <p className="text-sm text-slate-500 mt-1">Sign in to your workspace</p>
          </div>

          {message && (
            <p className={`rounded-xl border p-3 text-sm ${
              message.type === 'info'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}>
              {message.text}
            </p>
          )}

          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              spellCheck={false}
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                Password
              </label>
              <button
                type="button"
                onClick={() => {
                  setMode('FORGOT_PASSWORD');
                  setMessage(null);
                }}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={6}
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 transition">
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
      )}

      {mode === 'FORGOT_PASSWORD' && (
        <form onSubmit={handleSendReset} className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-lg p-6 space-y-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Reset Password</h1>
            <p className="text-sm text-slate-500 mt-1">
              Enter your workspace email and we&apos;ll send you a secure reset link.
            </p>
          </div>

          {message && (
            <p className={`rounded-xl border p-3 text-sm ${
              message.type === 'info'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}>
              {message.text}
            </p>
          )}

          <label htmlFor="reset-email" className="block text-sm font-medium text-slate-700">
            Email Address
            <input
              id="reset-email"
              name="email"
              type="email"
              autoComplete="email"
              spellCheck={false}
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="owner@business.co.ke"
              className="mt-1 w-full border border-slate-300 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 transition">
            {isSubmitting ? 'Sending reset link...' : 'Send Password Reset Link'}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('SIGN_IN');
              setMessage(null);
            }}
            className="w-full rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2.5 text-sm transition"
          >
            Back to Sign In
          </button>
        </form>
      )}

      {mode === 'UPDATE_PASSWORD' && (
        <form onSubmit={handleUpdatePassword} className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-lg p-6 space-y-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Set New Password</h1>
            <p className="text-sm text-slate-500 mt-1">Choose a new password for your Biashara Ledger account.</p>
          </div>

          {message && (
            <p className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              {message.text}
            </p>
          )}

          <label htmlFor="new-password" className="block text-sm font-medium text-slate-700">
            New Password
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700">
            Confirm New Password
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={event => setConfirmPassword(event.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-2.5 transition">
            {isSubmitting ? 'Updating password...' : 'Save New Password & Continue'}
          </button>
        </form>
      )}
    </main>
  );
}