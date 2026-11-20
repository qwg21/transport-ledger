import type { Customer, DocumentRecord } from './types';

export type StatementPeriodPreset =
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'THIS_QUARTER'
  | 'THIS_YEAR'
  | 'LAST_90_DAYS'
  | 'ALL_TIME'
  | 'CUSTOM';

export interface StatementClientOption {
  key: string; // customer.id or `name:<normalized>`
  customerId: string | null;
  name: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  kraPin: string | null;
  balance: number;
}

export interface StatementEntry {
  id: string;
  date: string;
  docType: 'INVOICE' | 'RECEIPT';
  docNumber: string;
  reference: string | null;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface AgingBuckets {
  days0to30: number;
  days31to60: number;
  days61to90: number;
  over90: number;
  total: number;
}

export interface CustomerStatement {
  client: StatementClientOption;
  fromDate: string;
  toDate: string;
  openingBalance: number;
  totalInvoiced: number;
  totalPaid: number;
  closingBalance: number;
  entries: StatementEntry[];
  aging: AgingBuckets;
}

const roundMoney = (value: number): number =>
  Math.round((Number(value) || 0) * 100) / 100;

const normalizeName = (name: string | null | undefined): string =>
  (name || '').trim().toLowerCase().replace(/\s+/g, ' ');

const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

export function resolveStatementPeriod(
  preset: StatementPeriodPreset,
  todayIso: string = toIsoDate(new Date())
): { fromDate: string; toDate: string } {
  const [y, m, d] = todayIso.split('-').map(Number);
  const year = y || new Date().getFullYear();
  const month = (m || 1) - 1;
  const day = d || 1;
  const pad = (n: number) => String(n).padStart(2, '0');

  switch (preset) {
    case 'THIS_MONTH':
      return { fromDate: `${year}-${pad(month + 1)}-01`, toDate: todayIso };
    case 'LAST_MONTH': {
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end = new Date(Date.UTC(year, month, 0));
      return { fromDate: toIsoDate(start), toDate: toIsoDate(end) };
    }
    case 'THIS_QUARTER': {
      const qStartMonth = Math.floor(month / 3) * 3;
      return { fromDate: `${year}-${pad(qStartMonth + 1)}-01`, toDate: todayIso };
    }
    case 'LAST_90_DAYS': {
      const start = new Date(Date.UTC(year, month, day - 90));
      return { fromDate: toIsoDate(start), toDate: todayIso };
    }
    case 'ALL_TIME':
      return { fromDate: '2000-01-01', toDate: todayIso };
    case 'THIS_YEAR':
    default:
      return { fromDate: `${year}-01-01`, toDate: todayIso };
  }
}

function docMatchesClient(doc: DocumentRecord, client: StatementClientOption): boolean {
  if (client.customerId && doc.customer_id) {
    return doc.customer_id === client.customerId;
  }
  return normalizeName(doc.customer_name) === normalizeName(client.name);
}

export function buildStatementClients(
  customers: Customer[],
  documents: DocumentRecord[]
): StatementClientOption[] {
  const map = new Map<string, StatementClientOption>();
  const nameToKey = new Map<string, string>();

  for (const c of customers) {
    const key = c.id;
    const norm = normalizeName(c.name);
    map.set(key, {
      key,
      customerId: c.id,
      name: c.name,
      companyName: c.company_name,
      phone: c.phone,
      email: c.email,
      kraPin: c.kra_pin,
      balance: 0
    });
    if (norm) nameToKey.set(norm, key);
  }

  const activeDocs = documents.filter(
    (d) => d.status !== 'VOID' && (d.doc_type === 'INVOICE' || d.doc_type === 'RECEIPT')
  );

  for (const doc of activeDocs) {
    let key: string | undefined;
    if (doc.customer_id && map.has(doc.customer_id)) {
      key = doc.customer_id;
    } else {
      const norm = normalizeName(doc.customer_name);
      key = nameToKey.get(norm);
      if (!key && norm) {
        key = `name:${norm}`;
        map.set(key, {
          key,
          customerId: null,
          name: doc.customer_name.trim(),
          companyName: null,
          phone: doc.customer_phone,
          email: doc.customer_email,
          kraPin: null,
          balance: 0
        });
        nameToKey.set(norm, key);
      }
    }

    if (!key) continue;
    const entry = map.get(key)!;
    const delta = doc.doc_type === 'INVOICE' ? Number(doc.amount || 0) : -Number(doc.amount || 0);
    entry.balance = roundMoney(entry.balance + delta);
    if (!entry.phone && doc.customer_phone) entry.phone = doc.customer_phone;
    if (!entry.email && doc.customer_email) entry.email = doc.customer_email;
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function daysBetween(olderIso: string, newerIso: string): number {
  const a = Date.parse(`${olderIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${newerIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

export function buildCustomerStatement(
  client: StatementClientOption,
  documents: DocumentRecord[],
  fromDate: string,
  toDate: string
): CustomerStatement {
  const clientDocs = documents
    .filter(
      (d) =>
        d.status !== 'VOID' &&
        (d.doc_type === 'INVOICE' || d.doc_type === 'RECEIPT') &&
        docMatchesClient(d, client)
    )
    .sort((a, b) => {
      const dateCmp = a.issue_date.localeCompare(b.issue_date);
      if (dateCmp !== 0) return dateCmp;
      if (a.doc_type !== b.doc_type) return a.doc_type === 'INVOICE' ? -1 : 1;
      const createdCmp = (a.created_at || '').localeCompare(b.created_at || '');
      if (createdCmp !== 0) return createdCmp;
      return a.doc_number.localeCompare(b.doc_number);
    });

  let openingBalance = 0;
  const periodDocs: DocumentRecord[] = [];
  const docsUpToEnd: DocumentRecord[] = [];

  for (const doc of clientDocs) {
    const issue = doc.issue_date.slice(0, 10);
    if (issue <= toDate) docsUpToEnd.push(doc);
    if (issue < fromDate) {
      openingBalance = roundMoney(
        openingBalance + (doc.doc_type === 'INVOICE' ? Number(doc.amount || 0) : -Number(doc.amount || 0))
      );
    } else if (issue <= toDate) {
      periodDocs.push(doc);
    }
  }

  let runningBalance = openingBalance;
  let totalInvoiced = 0;
  let totalPaid = 0;

  const entries: StatementEntry[] = periodDocs.map((doc) => {
    const amt = roundMoney(Number(doc.amount || 0));
    const isInvoice = doc.doc_type === 'INVOICE';
    const debit = isInvoice ? amt : 0;
    const credit = isInvoice ? 0 : amt;

    if (isInvoice) totalInvoiced = roundMoney(totalInvoiced + amt);
    else totalPaid = roundMoney(totalPaid + amt);

    runningBalance = roundMoney(runningBalance + debit - credit);

    const refParts = [
      doc.invoice_ref ? `Ref ${doc.invoice_ref}` : null,
      doc.payment_method ? doc.payment_method : null,
      doc.payment_ref ? doc.payment_ref : null
    ].filter(Boolean);

    return {
      id: doc.id,
      date: doc.issue_date.slice(0, 10),
      docType: isInvoice ? 'INVOICE' : 'RECEIPT',
      docNumber: doc.doc_number,
      reference: refParts.length ? refParts.join(' · ') : null,
      description: doc.description?.trim() || (isInvoice ? 'Invoice' : 'Payment received'),
      debit,
      credit,
      runningBalance
    };
  });

  // Aging buckets as of toDate
  const receiptsUpToEnd = docsUpToEnd.filter((d) => d.doc_type === 'RECEIPT');
  const invoicesUpToEnd = docsUpToEnd.filter((d) => d.doc_type === 'INVOICE');

  const aging: AgingBuckets = { days0to30: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0 };

  for (const inv of invoicesUpToEnd) {
    const linkedPaid = receiptsUpToEnd
      .filter(
        (r) =>
          (r.parent_id && r.parent_id === inv.id) ||
          (r.invoice_ref && r.invoice_ref === inv.doc_number)
      )
      .reduce((sum, r) => roundMoney(sum + Number(r.amount || 0)), 0);

    const effectivePaid = Math.min(
      Number(inv.amount || 0),
      Math.max(Number(inv.amount_paid || 0), linkedPaid)
    );
    const outstanding = roundMoney(Math.max(0, Number(inv.amount || 0) - effectivePaid));
    if (outstanding <= 0) continue;

    const age = daysBetween(inv.issue_date, toDate);
    if (age <= 30) aging.days0to30 = roundMoney(aging.days0to30 + outstanding);
    else if (age <= 60) aging.days31to60 = roundMoney(aging.days31to60 + outstanding);
    else if (age <= 90) aging.days61to90 = roundMoney(aging.days61to90 + outstanding);
    else aging.over90 = roundMoney(aging.over90 + outstanding);
    aging.total = roundMoney(aging.total + outstanding);
  }

  return {
    client,
    fromDate,
    toDate,
    openingBalance,
    totalInvoiced,
    totalPaid,
    closingBalance: runningBalance,
    entries,
    aging
  };
}