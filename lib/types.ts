import type { User } from '@supabase/supabase-js';

export type { User };

export type DocType = 'QUOTE' | 'INVOICE' | 'RECEIPT';
export type DocStatus = 'ACTIVE' | 'CONVERTED' | 'UNPAID' | 'PARTIAL' | 'PAID' | 'VOID';
export type PlanTier = 'STARTER' | 'ESSENTIAL' | 'GROWTH' | 'INTELLIGENCE' | 'ENTERPRISE';

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
  plan: PlanTier | string;
  status: string;
  current_period_end: string;
  transport_addon?: boolean;
  enabled_modules?: string[];
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

export interface Supplier {
  id: string;
  org_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  kra_pin: string | null;
}

export interface ProductVariant {
  id: string;
  org_id: string;
  product_id: string;
  sku: string;
  variant_name: string;
  cost_price: number;
  selling_price: number;
  stock_qty: number;
  reorder_level: number;
  is_active: boolean;
}

export interface StockMovement {
  id: string;
  org_id: string;
  variant_id: string;
  movement_type: 'GRN_RECEIPT' | 'SALE_ISSUE' | 'ADJUSTMENT_GAIN' | 'ADJUSTMENT_LOSS' | 'RETURN_IN';
  quantity: number;
  unit_cost: number;
  source_type?: string | null;
  source_id?: string | null;
  notes: string | null;
  created_at: string;
}

export interface SupplierBill {
  id: string;
  org_id: string;
  supplier_id: string;
  bill_number: string;
  bill_date: string;
  due_date: string | null;
  net_amount: number;
  vat_amount: number;
  total_amount: number;
  amount_paid: number;
  clears_grn: boolean;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'VOID';
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