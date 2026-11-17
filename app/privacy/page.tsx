import Link from 'next/link';

import { PRIVACY_VERSION } from '@/lib/legal';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-2xl p-8 space-y-6 text-sm text-slate-700 leading-relaxed">
        <div className="border-b border-slate-200 pb-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Privacy Policy</h1>
            <p className="text-xs text-slate-500 mt-1">
              Biashara Ledger &middot; Version {PRIVACY_VERSION} &middot; Effective November 2026
            </p>
          </div>
          <Link href="/" className="text-xs font-semibold text-blue-600 hover:underline">
            Back to App
          </Link>
        </div>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">1. Data We Collect</h2>
          <p>
            We collect only the information needed to operate your accounting workspace: your account email address, business profile details (company name, address, phone, KRA PIN, logo), customer and product records, sales documents, payment references, expense entries, and uploaded receipt attachments.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">2. How We Use & Protect Data</h2>
          <p>
            Your data is used strictly to deliver and secure the Biashara Ledger service. Each business workspace is isolated using PostgreSQL Row-Level Security (RLS), and uploaded expense receipts are stored in private storage buckets accessible only via short-lived signed URLs for authorized members of your organization. We never sell or rent your business or customer data to third parties.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">3. Your Rights (Kenya Data Protection Act)</h2>
          <p>
            In accordance with the Kenya Data Protection Act, you have the right to access, correct, export (via CSV and PDF tools inside the app), or request deletion of your personal and workspace data.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">4. Retention & Contact</h2>
          <p>
            We retain workspace records while your account remains active and as required for audit or legal compliance. To request data export or deletion, contact{' '}
            <a href="mailto:quentinwg2015@gmail.com" className="text-blue-600 hover:underline">
              quentinwg2015@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}