import Link from 'next/link';

import { TERMS_VERSION } from '@/lib/legal';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-2xl p-8 space-y-6 text-sm text-slate-700 leading-relaxed">
        <div className="border-b border-slate-200 pb-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Terms of Service</h1>
            <p className="text-xs text-slate-500 mt-1">
              Biashara Ledger &middot; Version {TERMS_VERSION} &middot; Effective November 2026
            </p>
          </div>
          <Link href="/" className="text-xs font-semibold text-blue-600 hover:underline">
            Back to App
          </Link>
        </div>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">1. Service Scope</h2>
          <p>
            Biashara Ledger provides cloud-based invoicing, quotation, receipting, expense tracking, and business intelligence software for small and medium enterprises. By creating an account or accessing a workspace, you agree to these Terms on behalf of yourself and the business you represent.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">2. Subscriptions & Read-Only Mode</h2>
          <p>
            Access to workspace features depends on your active subscription tier (Essential, Growth, or Intelligence). If a subscription expires or is suspended, your workspace enters read-only mode: you can still view and export existing records, but creating or modifying documents, expenses, or team members is paused until renewal.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">3. Data Ownership & Acceptable Use</h2>
          <p>
            You retain full ownership of all business records, customer lists, invoices, and uploaded receipt files entered into your workspace. You are responsible for the accuracy of your tax settings, KRA PIN details, and financial filings, and for maintaining the confidentiality of your login credentials and invited team roles.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">4. Tax & Accounting Disclaimer</h2>
          <p>
            Biashara Ledger is a record-keeping and management tool, not a licensed accounting firm or tax advisor. Tax estimates and intelligence metrics are calculated from the records and tax profiles you configure and should be reviewed with a qualified accountant before statutory submission.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">5. Governing Law</h2>
          <p>
            These Terms are governed by the laws of the Republic of Kenya. Questions or notices may be sent to{' '}
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