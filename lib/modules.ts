export type ModuleThemeKey = 'accounting' | 'transport' | 'rentals' | 'inventory' | 'reports';

export interface QuickActionItem {
  id: 'NEW_QUOTE' | 'NEW_INVOICE' | 'NEW_RECEIPT' | 'LOG_EXPENSE' | 'DISPATCH_TRIP' | 'RECORD_RENT';
  label: string;
  hint: string;
}

export interface ModuleConfig {
  key: ModuleThemeKey;
  title: string;
  subtitle: string;
  tone: 'light' | 'dark';
  quickActions: QuickActionItem[];
}

export const MODULE_CONFIG: Record<ModuleThemeKey, ModuleConfig> = {
  accounting: {
    key: 'accounting',
    title: 'Sales & Ledger',
    subtitle: 'Quotations, invoices, receipts & daily expenses',
    tone: 'light',
    quickActions: [
      { id: 'NEW_INVOICE', label: 'New Invoice', hint: 'Bill a customer & update stock' },
      { id: 'NEW_QUOTE', label: 'New Quotation', hint: 'Send an estimate or proforma' },
      { id: 'NEW_RECEIPT', label: 'Direct Cash Receipt', hint: 'Record an instant sale' },
      { id: 'LOG_EXPENSE', label: 'Log Expense', hint: 'Snap or upload a receipt' }
    ]
  },
  transport: {
    key: 'transport',
    title: 'Fleet & Dispatch Command',
    subtitle: 'Trips, vehicle utilization, drivers & trip billing',
    tone: 'light',
    quickActions: [
      { id: 'DISPATCH_TRIP', label: 'New Trip / Charter', hint: 'Assign vehicle & driver' },
      { id: 'NEW_INVOICE', label: 'New Transport Invoice', hint: 'Bill a client trip' },
      { id: 'LOG_EXPENSE', label: 'Log Fuel / Repair Cost', hint: 'Record vehicle expenditure' }
    ]
  },
  rentals: {
    key: 'rentals',
    title: 'Property & Rentals',
    subtitle: 'Units, tenancies, rent roll & owner remittances',
    tone: 'light',
    quickActions: [
      { id: 'RECORD_RENT', label: 'Record Rent Collection', hint: 'Log tenant rent payment' },
      { id: 'LOG_EXPENSE', label: 'Log Maintenance Cost', hint: 'Record property repair/bill' },
      { id: 'NEW_INVOICE', label: 'New Rent / Service Invoice', hint: 'Issue tenant invoice' }
    ]
  },
  inventory: {
    key: 'inventory',
    title: 'Inventory & Purchasing',
    subtitle: 'SKUs, stock valuation, GRNs & supplier bills',
    tone: 'light',
    quickActions: [
      { id: 'NEW_INVOICE', label: 'New Sales Invoice', hint: 'Deduct stock on issue' },
      { id: 'LOG_EXPENSE', label: 'Log Direct Purchase', hint: 'Record non-stock expense' }
    ]
  },
  reports: {
    key: 'reports',
    title: 'Financial Statements',
    subtitle: 'General ledger P&L, balance sheet & trial balance',
    tone: 'light',
    quickActions: [
      { id: 'NEW_INVOICE', label: 'New Invoice', hint: 'Create sales document' },
      { id: 'LOG_EXPENSE', label: 'Log Expense', hint: 'Record operating cost' }
    ]
  }
};

export function resolveModuleTheme(section: string): ModuleConfig {
  if (section === 'TRANSPORT') return MODULE_CONFIG.transport;
  if (section === 'RENTALS') return MODULE_CONFIG.rentals;
  if (section === 'INVENTORY' || section === 'CATALOGUE') return MODULE_CONFIG.inventory;
  if (section === 'REPORTS') return MODULE_CONFIG.reports;
  return MODULE_CONFIG.accounting;
}