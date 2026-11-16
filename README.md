# Biashara Ledger (transport-ledger)

Multi-tenant business accounting for Kenyan SMEs: quotations, invoices, receipts (including partial
payments), expenses, customers, product catalogue, branded PDFs and a KRA-friendly CSV export.

Built with Next.js (App Router), React, Tailwind, Supabase (Postgres + Auth + RLS) and jsPDF.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase URL + anon key
npm run dev                  # http://localhost:3000
```

| Script          | What it does                                                    |
| --------------- | --------------------------------------------------------------- |
| `npm run dev`   | Start the dev server                                            |
| `npm run build` | Production build                                                |
| `npm run lint`  | ESLint                                                          |
| `npm test`      | Unit tests for the payment / numbering logic (needs Node 22.6+) |

## Database migrations

SQL lives in `supabase/migrations/`. Run each file **in order** in the Supabase SQL Editor
(each is safe to re-run). Run `03` as its own query, after `02` has finished.

1. `20261116_01_per_business_document_numbers.sql`: document numbers are unique **per business**
   instead of globally. Fixes `duplicate key value violates unique constraint "documents_doc_number_key"`
   when a second business creates its first quote, invoice or receipt.
2. `20261116_02_partial_payment_support.sql`: lets invoices have status `PARTIAL`.
3. `20261116_03_repair_invoice_balances.sql`: one-off repair of invoices that were left `UNPAID` after
   a partial payment.

## How payments work

A receipt row (`doc_type = 'RECEIPT'`, `parent_id = <invoice id>`) is the source of truth for money
received. Every time documents are loaded, `lib/documents.ts` recomputes each invoice's paid amount,
balance and status (`UNPAID` / `PARTIAL` / `PAID`) from its receipts. Outstanding receivables, the
invoice PDF "balance due" and the customer "Unpaid" column all use those derived figures.

## Project layout

```
app/page.tsx                    main workspace UI
app/admin/page.tsx              platform admin console (provision businesses, subscriptions)
components/                     AuthScreen, CataloguesSection (customers + products)
lib/documents.ts                pure business logic: balances, numbering, CSV (unit-tested)
lib/types.ts                    shared domain types
lib/pdf.ts                      jsPDF quotation / invoice / receipt renderer
lib/supabase.ts                 Supabase client
supabase/migrations/            SQL to run in the Supabase SQL Editor
```

## Deploying

Push to `main`; Vercel builds automatically. Set `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel → Project Settings → Environment Variables.
