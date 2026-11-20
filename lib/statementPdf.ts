import { jsPDF } from 'jspdf';
import type { CustomerStatement } from './statements';
import type { PdfOrgInput } from './pdf';

const hexToRgb = (hex: string | null | undefined): [number, number, number] => {
  const clean = (hex || '#0f172a').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return [15, 23, 42];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
};

const fmtMoney = (currency: string, n: number): string =>
  `${currency} ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildStatementPdf(statement: CustomerStatement, org: PdfOrgInput): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const [r, g, b] = hexToRgb(org.pdf_accent_color);
  const currency = org.currency || 'KES';
  const pageWidth = 210;
  const margin = 14;
  let y = 16;

  // Header band
  pdf.setFillColor(r, g, b);
  pdf.rect(0, 0, pageWidth, 34, 'F');

  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(org.name || 'Statement of Account', margin, 14);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  const contactLine = [org.phone, org.email, org.kra_pin ? `PIN: ${org.kra_pin}` : null]
    .filter(Boolean)
    .join('  •  ');
  if (contactLine) pdf.text(contactLine, margin, 21);
  if (org.address) pdf.text(org.address, margin, 26);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.text('STATEMENT OF ACCOUNT', pageWidth - margin, 14, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(`Period: ${statement.fromDate} to ${statement.toDate}`, pageWidth - margin, 21, { align: 'right' });
  pdf.text(`Generated: ${new Date().toISOString().slice(0, 10)}`, pageWidth - margin, 26, { align: 'right' });

  y = 44;

  // Client & Summary Strip
  pdf.setTextColor(15, 23, 42);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text('STATEMENT FOR', margin, y);
  pdf.setFontSize(11);
  pdf.text(statement.client.name, margin, y + 6);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(71, 85, 105);
  const clientMeta = [
    statement.client.phone,
    statement.client.email,
    statement.client.kraPin ? `KRA PIN: ${statement.client.kraPin}` : null
  ].filter(Boolean);
  clientMeta.forEach((line, idx) => pdf.text(line as string, margin, y + 11 + idx * 4.5));

  // Balance Summary Box (Right)
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(226, 232, 240);
  pdf.roundedRect(122, y - 4, 74, 28, 2, 2, 'FD');

  const summaryRows: Array<[string, number, boolean]> = [
    ['Opening Balance', statement.openingBalance, false],
    ['Total Invoiced', statement.totalInvoiced, false],
    ['Payments Received', statement.totalPaid, false],
    ['Balance Due', statement.closingBalance, true]
  ];
  summaryRows.forEach(([label, val, bold], idx) => {
    const rowY = y + 2 + idx * 6;
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(bold ? 9.5 : 8.5);
    pdf.setTextColor(bold ? 15 : 71, bold ? 23 : 85, bold ? 42 : 105);
    pdf.text(label, 126, rowY);
    pdf.text(fmtMoney(currency, val), 192, rowY, { align: 'right' });
  });

  y += 34;

  // Table Header
  const drawTableHeader = () => {
    pdf.setFillColor(r, g, b);
    pdf.rect(margin, y, pageWidth - margin * 2, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.text('DATE', margin + 2, y + 5.3);
    pdf.text('DOC #', margin + 24, y + 5.3);
    pdf.text('DESCRIPTION', margin + 48, y + 5.3);
    pdf.text('DEBIT', 142, y + 5.3, { align: 'right' });
    pdf.text('CREDIT', 168, y + 5.3, { align: 'right' });
    pdf.text('BALANCE', 194, y + 5.3, { align: 'right' });
    y += 10;
  };

  drawTableHeader();

  // Opening Balance Row
  pdf.setFont('helvetica', 'italic');
  pdf.setFontSize(8.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text(statement.fromDate, margin + 2, y + 3);
  pdf.text('Balance Brought Forward', margin + 48, y + 3);
  pdf.setFont('helvetica', 'bold');
  pdf.text(fmtMoney(currency, statement.openingBalance), 194, y + 3, { align: 'right' });
  y += 7;

  // Ledger Rows
  pdf.setFont('helvetica', 'normal');
  for (const row of statement.entries) {
    if (y > 265) {
      pdf.addPage();
      y = 18;
      drawTableHeader();
    }
    pdf.setDrawColor(241, 245, 249);
    pdf.line(margin, y - 2, pageWidth - margin, y - 2);

    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(8);
    pdf.text(row.date, margin + 2, y + 2.5);
    pdf.text(row.docNumber, margin + 24, y + 2.5);

    const desc = row.description.length > 36 ? `${row.description.slice(0, 35)}…` : row.description;
    pdf.text(desc, margin + 48, y + 2.5);

    if (row.debit > 0) pdf.text(fmtMoney(currency, row.debit), 142, y + 2.5, { align: 'right' });
    if (row.credit > 0) {
      pdf.setTextColor(5, 150, 105);
      pdf.text(fmtMoney(currency, row.credit), 168, y + 2.5, { align: 'right' });
      pdf.setTextColor(15, 23, 42);
    }
    pdf.setFont('helvetica', 'bold');
    pdf.text(fmtMoney(currency, row.runningBalance), 194, y + 2.5, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    y += 7;
  }

  // Closing Balance Bar
  y += 2;
  pdf.setFillColor(241, 245, 249);
  pdf.rect(margin, y - 2, pageWidth - margin * 2, 9, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(15, 23, 42);
  pdf.text('CLOSING BALANCE DUE', margin + 2, y + 4);
  pdf.text(fmtMoney(currency, statement.closingBalance), 194, y + 4, { align: 'right' });
  y += 14;

  // Aging Strip
  if (statement.aging.total > 0 && y < 255) {
    pdf.setFontSize(8);
    pdf.setTextColor(71, 85, 105);
    pdf.text('AGING SUMMARY (AS OF STATEMENT END DATE)', margin, y);
    y += 5;
    const buckets: Array<[string, number]> = [
      ['0–30 Days', statement.aging.days0to30],
      ['31–60 Days', statement.aging.days31to60],
      ['61–90 Days', statement.aging.days61to90],
      ['90+ Days', statement.aging.over90]
    ];
    const colW = (pageWidth - margin * 2) / 4;
    buckets.forEach(([label, val], i) => {
      const x = margin + i * colW;
      pdf.setDrawColor(226, 232, 240);
      pdf.rect(x, y, colW - 2, 12);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.text(label, x + 2, y + 4.5);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.setTextColor(15, 23, 42);
      pdf.text(fmtMoney(currency, val), x + 2, y + 9.5);
    });
    y += 18;
  }

  // Payment Instructions & Footer
  if (org.payment_instructions && y < 272) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(15, 23, 42);
    pdf.text('PAYMENT INSTRUCTIONS', margin, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(71, 85, 105);
    const lines = pdf.splitTextToSize(org.payment_instructions, pageWidth - margin * 2);
    pdf.text(lines, margin, y + 4.5);
  }

  if (org.pdf_footer_note) {
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text(org.pdf_footer_note, pageWidth / 2, 289, { align: 'center' });
  }

  return pdf;
}