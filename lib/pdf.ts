import { jsPDF } from 'jspdf';
import type { DocumentItem, DocumentRecord, Organization } from './types';

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = (hex || '#0f172a').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (isNaN(num)) return [15, 23, 42];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
};

export const buildPdfDocument = (item: DocumentRecord, org: Organization, lineItems: DocumentItem[] = []): jsPDF => {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const [r, g, b] = hexToRgb(org.pdf_accent_color || '#0f172a');
  const template = org.pdf_template || 'MODERN';
  const currency = org.currency || 'KES';
  const label = item.doc_type === 'QUOTE' ? 'QUOTATION' : item.doc_type === 'INVOICE' ? 'INVOICE' : 'OFFICIAL RECEIPT';

  const items = lineItems && lineItems.length > 0 ? lineItems : (item.document_items || []);

  if (template === 'MODERN') {
    pdf.setFillColor(r, g, b);
    pdf.rect(0, 0, 210, 8, 'F');
  }

  const textStartX = org.logo_url ? 44 : 15;
  if (org.logo_url) {
    try {
      const format = org.logo_url.includes('image/png') ? 'PNG' : 'JPEG';
      pdf.addImage(org.logo_url, format, 15, 14, 24, 24);
    } catch {
      // Ignore invalid image format
    }
  }

  pdf.setFontSize(17);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(15, 23, 42);
  pdf.text(org.name || 'Business Name', textStartX, 21);

  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100);
  pdf.text(org.tagline || '', textStartX, 27);
  pdf.text(`${org.phone || ''} | ${org.email || ''}`, textStartX, 32);
  if (org.kra_pin || org.address) {
    pdf.text([org.kra_pin ? `Tax PIN: ${org.kra_pin}` : '', org.address ?? ''].filter(Boolean).join(' | '), textStartX, 37);
  }

  if (template === 'MINIMAL') {
    pdf.setTextColor(r, g, b);
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text(label, 195, 20, { align: 'right' });
  } else if (template === 'CLASSIC') {
    pdf.setDrawColor(r, g, b);
    pdf.setLineWidth(0.6);
    pdf.rect(140, 14, 55, 10);
    pdf.setTextColor(r, g, b);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text(label, 167.5, 20.5, { align: 'center' });
  } else {
    pdf.setFillColor(r, g, b);
    pdf.rect(140, 14, 55, 10, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text(label, 167.5, 20.5, { align: 'center' });
  }

  pdf.setTextColor(15, 23, 42);
  pdf.setFontSize(10);
  pdf.text(`Doc No: ${item.doc_number}`, 195, 30, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(`Issue Date: ${item.issue_date}`, 195, 35, { align: 'right' });

  let refY = 40;
  if (item.quote_ref) {
    pdf.text(`Linked Quote: ${item.quote_ref}`, 195, refY, { align: 'right' });
    refY += 5;
  }
  if (item.invoice_ref) {
    pdf.text(`Linked Invoice: ${item.invoice_ref}`, 195, refY, { align: 'right' });
    refY += 5;
  }

  const headerY = Math.max(45, refY + 2);
  pdf.setDrawColor(template === 'CLASSIC' ? r : 220, template === 'CLASSIC' ? g : 220, template === 'CLASSIC' ? b : 220);
  pdf.setLineWidth(template === 'CLASSIC' ? 0.5 : 0.2);
  pdf.line(15, headerY, 195, headerY);

  const clientY = headerY + 10;
  pdf.setFontSize(8);
  pdf.setTextColor(120);
  pdf.text('BILLED TO:', 15, clientY);
  pdf.setFontSize(11);
  pdf.setTextColor(15, 23, 42);
  pdf.setFont('helvetica', 'bold');
  pdf.text(item.customer_name, 15, clientY + 6);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  if (item.customer_phone) pdf.text(`Tel: ${item.customer_phone}`, 15, clientY + 11);
  if (item.customer_email) pdf.text(`Email: ${item.customer_email}`, 15, clientY + 16);

  pdf.setFontSize(8);
  pdf.setTextColor(120);
  pdf.text('STATUS:', 195, clientY, { align: 'right' });
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(
    item.status === 'PAID' ? 16 : item.status === 'PARTIAL' ? 79 : item.status === 'VOID' ? 225 : 180,
    item.status === 'PAID' ? 185 : item.status === 'PARTIAL' ? 70 : item.status === 'VOID' ? 29 : 83,
    item.status === 'PAID' ? 129 : item.status === 'PARTIAL' ? 229 : item.status === 'VOID' ? 72 : 9
  );
  pdf.text(item.status, 195, clientY + 6, { align: 'right' });
  if (item.payment_method && item.doc_type === 'RECEIPT') {
    pdf.setTextColor(80);
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Method: ${item.payment_method}${item.payment_ref ? ` | Ref: ${item.payment_ref}` : ''}`, 195, clientY + 11, { align: 'right' });
  }

  const tableY = clientY + 28;
  if (template === 'MINIMAL') {
    pdf.setDrawColor(r, g, b);
    pdf.line(15, tableY + 9, 195, tableY + 9);
    pdf.setTextColor(r, g, b);
  } else {
    pdf.setFillColor(r, g, b);
    pdf.rect(15, tableY, 180, 9, 'F');
    pdf.setTextColor(255, 255, 255);
  }

  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');

  let currentY = tableY + 16;

  if (items.length > 0) {
    pdf.text('ITEM / DESCRIPTION', 18, tableY + 6);
    pdf.text('QTY', 128, tableY + 6, { align: 'right' });
    pdf.text('PRICE', 158, tableY + 6, { align: 'right' });
    pdf.text(`TOTAL (${currency})`, 192, tableY + 6, { align: 'right' });

    items.forEach(row => {
      if (currentY > 240) {
        pdf.addPage();
        currentY = 20;
      }
      const splitDesc = pdf.splitTextToSize(row.description || '', 92);
      pdf.setTextColor(15, 23, 42);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9.5);
      pdf.text(splitDesc, 18, currentY);
      pdf.text(String(row.quantity ?? 1), 128, currentY, { align: 'right' });
      pdf.text(Number(row.unit_price || 0).toLocaleString(), 158, currentY, { align: 'right' });
      pdf.setFont('helvetica', 'bold');
      pdf.text(Number(row.line_total ?? (Number(row.quantity || 1) * Number(row.unit_price || 0))).toLocaleString(), 192, currentY, { align: 'right' });

      const rowHeight = Math.max(7, splitDesc.length * 4.5 + 3);
      pdf.setDrawColor(235, 235, 235);
      pdf.setLineWidth(0.2);
      pdf.line(15, currentY + rowHeight - 3, 195, currentY + rowHeight - 3);
      currentY += rowHeight + 2;
    });
  } else {
    pdf.text('DESCRIPTION / SERVICE', 18, tableY + 6);
    pdf.text(`AMOUNT (${currency})`, 192, tableY + 6, { align: 'right' });

    pdf.setTextColor(15, 23, 42);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    const splitDesc = pdf.splitTextToSize(item.description || '', 125);
    pdf.text(splitDesc, 18, currentY);
    pdf.setFont('helvetica', 'bold');
    pdf.text(`${currency} ${Number(item.amount).toLocaleString()}`, 192, currentY, { align: 'right' });
    currentY += 16 + splitDesc.length * 4;
  }

  if (currentY > 235) {
    pdf.addPage();
    currentY = 20;
  }

  const totalY = currentY + 4;
  pdf.setDrawColor(r, g, b);
  pdf.setLineWidth(0.4);
  pdf.line(120, totalY, 195, totalY);
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(r, g, b);
  pdf.text('TOTAL:', 125, totalY + 8);
  pdf.text(`${currency} ${Number(item.amount).toLocaleString()}`, 192, totalY + 8, { align: 'right' });

  let afterTotalsY = totalY + 14;
  if (item.doc_type === 'INVOICE' && Number(item.amount_paid || 0) > 0) {
    const paid = Number(item.amount_paid || 0);
    const bal = Math.max(0, Number(item.amount || 0) - paid);
    pdf.setFontSize(9.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(16, 185, 129);
    pdf.text('PAID TO DATE:', 125, afterTotalsY);
    pdf.text(`${currency} ${paid.toLocaleString()}`, 192, afterTotalsY, { align: 'right' });
    afterTotalsY += 6;
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(bal > 0 ? 180 : 16, bal > 0 ? 83 : 185, bal > 0 ? 9 : 129);
    pdf.text('BALANCE DUE:', 125, afterTotalsY);
    pdf.text(`${currency} ${bal.toLocaleString()}`, 192, afterTotalsY, { align: 'right' });
    afterTotalsY += 6;
  }

  const footerY = afterTotalsY + 12;
  pdf.setFillColor(248, 250, 252);
  pdf.rect(15, footerY, 180, 26, 'F');
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(71, 85, 105);
  pdf.text('PAYMENT INSTRUCTIONS:', 18, footerY + 7);
  pdf.setFont('helvetica', 'normal');
  pdf.text(org.payment_instructions || '', 18, footerY + 12);
  pdf.text(org.pdf_footer_note || 'Thank you for your business!', 18, footerY + 18);
  pdf.setTextColor(140);
  pdf.text(`Chain ID: ${item.chain_code} | ${org.name}`, 18, footerY + 23);

  return pdf;
};