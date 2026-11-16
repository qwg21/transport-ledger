import type { User } from '@supabase/supabase-js';

export type { User };

export type DocType = 'QUOTE' | 'INVOICE' | 'RECEIPT';
export type DocStatus = 'ACTIVE' | 'CONVERTED' | 'UNPAID' | 'PARTIAL' | 'PAID' | 'VOID';

export interface DocumentItem {
  id?: string;
  org_id?: string;
  document_id?: string;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface DocumentRecord {
  id: string;
  org_id: string;
  customer_id: string | null;
  doc_type: DocType;
  chain_code: string;
  doc_number: string;
  parent_id: string | null;
  quote_ref: string | null;
  invoice_ref: string | null;
  issue_date: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  description: string | null;
  amount: number;
  amount_paid: number;
  payment_method: string | null;
  payment_ref: string | null;
  status: DocStatus;
  created_at?: string;
  document_items?: DocumentItem[];
}

export interface Organization {
  id: string;
  name: string;
  industry: string | null;
  tagline: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  kra_pin: string | null;
  currency: string | null;
  payment_instructions: string | null;
  logo_url: string | null;
  pdf_template: 'MODERN' | 'CLASSIC' | 'MINIMAL' | 'BOUTIQUE' | 'CORPORATE' | null;
  pdf_accent_color: string | null;
  pdf_footer_note: string | null;
}

export type Membership = Organization & { role: string };

export interface Subscription {
  plan: string;
  status: string;
  current_period_end: string;
  transport_addon?: boolean;
}

export interface Customer {
  id: string;
  org_id: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  kra_pin: string | null;
}

export interface Product {
  id: string;
  org_id: string;
  item_type: 'SERVICE' | 'PRODUCT';
  name: string;
  description: string | null;
  unit_price: number;
  tax_rate: number;
}

export interface Expense {
  id: string;
  org_id: string;
  category: string;
  expense_date: string;
  amount_kes: number;
  vendor: string | null;
  notes: string | null;
}

export interface LineItem {
  product_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
}
