// ---------------------------------------------------------------------------
// Invoice export — PDF, Excel, CSV. The PDF reuses drawInvoicePage()
// (fieldMapExport.ts) completely unchanged: that function always calls
// pdf.addPage() before drawing (it's designed to be appended after a Field
// Map snapshot page), so for a standalone invoice we let jsPDF's constructor
// create its usual page 1, let drawInvoicePage add page 2, then delete page
// 1 — zero risk to the existing Field Map/PDF Print Mode export paths that
// already depend on drawInvoicePage's exact signature.
// ---------------------------------------------------------------------------

import type { Client, Invoice, InvoiceLineItem, MarkupBilling } from '../types'
import { drawInvoicePage } from './fieldMapExport'
import { DEFAULT_EXPORT_OPTIONS } from './fieldMapExportOptions'
import { triggerDownload } from './kmzExport'
import { moneyExact } from './format'

export async function exportInvoicePdf(
  invoice: Invoice,
  project: { id: string; name: string; location: string },
  client: Client | null,
  billingRows: MarkupBilling[],
): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true })
  drawInvoicePage(pdf, billingRows, DEFAULT_EXPORT_OPTIONS, { kind: 'admin' }, project, client)
  pdf.deletePage(1) // drop the blank page jsPDF auto-creates, since drawInvoicePage added its own via addPage()
  pdf.save(`${invoice.number}.pdf`)
}

export async function exportInvoiceExcel(invoice: Invoice, project: { name: string } | undefined): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
    'Invoice #': invoice.number,
    Project: project?.name ?? '',
    Client: invoice.client,
    'Issue Date': invoice.issueDate,
    'Due Date': invoice.dueDate,
    'Billing Period': invoice.billingPeriodStart && invoice.billingPeriodEnd
      ? `${invoice.billingPeriodStart} – ${invoice.billingPeriodEnd}` : '',
    Status: invoice.status,
    'Grand Total': invoiceTotalNumber(invoice.lineItems),
  }]), 'Invoice')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invoice.lineItems.map((l) => ({
    Description: l.description, UOM: l.uom ?? '', Quantity: l.quantity, 'Unit Price ($)': l.unitPrice, 'Amount ($)': l.quantity * l.unitPrice,
  }))), 'Line Items')
  XLSX.writeFile(wb, `${invoice.number}.xlsx`)
}

function csvEscape(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportInvoiceCsv(invoice: Invoice): void {
  const header = ['Description', 'UOM', 'Quantity', 'Unit Price', 'Amount']
  const rows = invoice.lineItems.map((l) => [l.description, l.uom ?? '', l.quantity, l.unitPrice, l.quantity * l.unitPrice])
  const lines = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n')
  triggerDownload(new Blob([lines], { type: 'text/csv' }), `${invoice.number}.csv`)
}

function invoiceTotalNumber(lineItems: InvoiceLineItem[]): number {
  return lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
}

/** For display next to an export button — same money() convention as the
 *  rest of the invoice UI. */
export function invoiceTotalDisplay(lineItems: InvoiceLineItem[]): string {
  return moneyExact(invoiceTotalNumber(lineItems))
}
