'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { TERMS_VERSION, PRIVACY_VERSION } from '@/lib/legal';

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [ready, setReady] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function checkSession() {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!active) return;
      setUserEmail(user?.email ?? null);
      setReady(true);
    }
    checkSession();
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    if (!acceptedPolicies) {
      setErrorMsg('Please accept the Terms of Service and Privacy Policy.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErrorMsg(error.message);
        return;
      }

      if (data.user) {
        await supabase.from('user_agreements').insert({
          user_id: data.user.id,
          terms_version: TERMS_VERSION,
          privacy_version: PRIVACY_VERSION
        });
      }

      router.replace('/');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!ready) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">
        Verifying invite link...
      </main>
    );
  }

  if (!userEmail) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 p-6 text-center space-y-3">
          <h1 className="text-lg font-bold text-slate-900">Invite Link Expired or Invalid</h1>
          <p className="text-xs text-slate-500">
            Please ask your administrator to resend your invite, or sign in if you already set a password.
          </p>
          <Link href="/" className="inline-block px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold">
            Go to Sign In
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-lg p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Complete Your Account</h1>
          <p className="text-xs text-slate-500 mt-1">Setting password for {userEmail}</p>
        </div>

        {errorMsg && (
          <p className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
            {errorMsg}
          </p>
        )}

        <label className="block text-sm font-medium text-slate-700">
          New Password
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-xl p-2.5"
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Confirm Password
          <input
            type="password"
            required
            minLength={6}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-xl p-2.5"
          />
        </label>

        <label className="flex items-start gap-2.5 text-xs text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={acceptedPolicies}
            onChange={e => setAcceptedPolicies(e.target.checked)}
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

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5"
        >
          {isSubmitting ? 'Saving...' : 'Set Password & Enter Workspace'}
        </button>
      </form>
    </main>
  );
}