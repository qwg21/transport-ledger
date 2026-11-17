Markdown# Biashara Ledger (transport-ledger)

Multi-tenant business accounting for Kenyan SMEs: quotations, invoices, receipts (including partial
payments), expenses with receipt attachments, customers, product catalogue, branded PDFs, and a
KRA-friendly CSV export.

Built with Next.js (App Router), React, Tailwind CSS, Supabase (Postgres + Auth + RLS + Storage), and jsPDF.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase URL + anon key
npm run dev                  # http://localhost:3000
ScriptWhat it doesnpm run devStart the dev servernpm run buildProduction buildnpm run lintESLintnpm testUnit tests for the payment / numbering logic (needs Node 22.6+)Database migrationsSQL lives in supabase/migrations/. Run each file in order in the Supabase SQL Editor(each is safe to re-run). Run 03 as its own query, after 02 has finished.20261116_01_per_business_document_numbers.sql: document numbers are unique per businessinstead of globally. Fixes duplicate key value violates unique constraint "documents_doc_number_key"when a second business creates its first quote, invoice or receipt.20261116_02_partial_payment_support.sql: lets invoices have status PARTIAL.20261116_03_repair_invoice_balances.sql: one-off repair of invoices that were left UNPAID aftera partial payment.Additional database features configured in Supabase:document_items table for multi-line Quotes, Invoices, and Receipts.payments & payment_allocations tables + atomic record_invoice_payment RPC.business-assets Storage bucket for company logos and expense receipt attachments (expenses.receipt_url).RLS policies across all public tables, including has_growth_plus_plan tier enforcement and platform_* admin RPC checks.How payments workA receipt row (doc_type = 'RECEIPT', parent_id = <invoice id>) is the source of truth for moneyreceived. Issuing a receipt calls the atomic record_invoice_payment PostgreSQL RPC, which createsthe receipt, logs payments and payment_allocations, and updates the invoice balance in onetransaction. Every time documents are loaded, lib/documents.ts also recomputes each invoice's paidamount, balance, and status (UNPAID / PARTIAL / PAID) from its receipts. Outstandingreceivables, the invoice PDF "balance due", and the customer "Unpaid" column all use those derivedfigures.Subscription tiersESSENTIAL: Overview KPIs, multi-item Quotes/Invoices/Receipts, partial payments, Expenses with receipt uploads, 5 PDF templates (MODERN, CLASSIC, MINIMAL, BOUTIQUE, CORPORATE), CSV export.GROWTH: Unlocks Customers CRM, Products & Services catalogue, click/type-to-search customer autocomplete, and automatic customer saving (enforced in UI + RLS).INTELLIGENCE (Next Up): Reports & Analytics (MoM/YoY trends, A/R aging, conversion rate, AOV, customer LTV/retention), monthly revenue/budget targets, configurable Tax Profiles, and team invites.ENTERPRISE (Planned Jan 2027+): Double-entry general ledger, KRA eTIMS (OSCU/VSCU), M-PESA Daraja auto-reconciliation, Kenyan statutory payroll, own-database deployments, and custom industry add-ons (Transport Management & other verticals).Project layoutapp/page.tsx                    main workspace UI
app/admin/page.tsx              platform admin console (provision businesses, subscriptions)
components/AuthScreen.tsx       sign-in / sign-up screen
components/CataloguesSection.tsx customers & products/services management
components/DocumentModal.tsx    multi-item quote / invoice / receipt modal
components/ExpensesTable.tsx    operating expenses table + receipt links
components/PdfTemplatePicker.tsx visual PDF template selector
components/SalesDocumentsTable.tsx documents table + quote/invoice/receipt actions
components/SettingsForm.tsx     company branding, Storage logo upload & PDF settings
lib/documents.ts                pure business logic: balances, numbering, CSV (unit-tested)
lib/types.ts                    shared domain types
lib/pdf.ts                      jsPDF multi-template quotation / invoice / receipt renderer
lib/supabase.ts                 Supabase client (env-var configured)
supabase/migrations/            SQL to run in the Supabase SQL Editor
DeployingPush to main; Vercel builds automatically. Set NEXT_PUBLIC_SUPABASE_URL andNEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel → Project Settings → Environment Variables.