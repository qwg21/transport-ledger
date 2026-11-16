'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Props {
  onAuthenticated: () => void | Promise<void>;
}

export default function AuthScreen({ onAuthenticated }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    const result = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    setIsSubmitting(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }

    if (isSignUp && !result.data.session) {
      setMessage('Check your email to confirm your account, then sign in.');
      return;
    }

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
        <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5">
          {isSubmitting ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
        </button>
        <button type="button" onClick={() => { setIsSignUp(value => !value); setMessage(null); }} className="w-full text-sm text-blue-600 hover:underline">
          {isSignUp ? 'Already have an account? Sign in' : 'Need an account? Create one'}
        </button>
      </form>
    </main>
  );
}