// ---------------------------------------------------------------------------
// Field Map export/report — modernized replacement for KmzViewer.tsx's
// exportToPdf(). Same html2canvas+jsPDF technique (dynamically imported to
// keep them out of the main bundle), but the second page summarizes Work
// Objects (type/status/quantity/billing) instead of a raw redline-notes list.
// ---------------------------------------------------------------------------

import type { FieldMarkup, MarkupBilling } from '../types'
import { WORK_OBJECT_TYPE_MAP } from './workObjectTypes'

export interface FieldMapReportRow {
  markup: FieldMarkup
  billingTotal: number
}

export function buildReportRows(markups: FieldMarkup[], billing: MarkupBilling[]): FieldMapReportRow[] {
  return markups.map((markup) => ({
    markup,
    billingTotal: billing.filter((b) => b.markupId === markup.id).reduce((s, b) => s + b.total, 0),
  }))
}

export async function exportFieldMapReport(
  mapEl: HTMLElement,
  projectName: string,
  rows: FieldMapReportRow[],
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  const canvas = await html2canvas(mapEl, { useCORS: true, allowTaint: false, logging: false, backgroundColor: '#0a0a0a', scale: window.devicePixelRatio ?? 1 })
  const mapImgData = canvas.toDataURL('image/png')
  const mapW = canvas.width, mapH = canvas.height
  const landscape = mapW >= mapH

  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'letter' })
  const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight(), margin = 36

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13)
  pdf.text(`${projectName} — Field Map Report`, margin, margin + 13)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(120, 120, 120)
  pdf.text(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), margin, margin + 26)
  pdf.setTextColor(0, 0, 0)

  const headerBottom = margin + 40, availW = pageW - margin * 2, availH = pageH - headerBottom - margin
  const imgRatio = mapW / mapH, boxRatio = availW / availH
  let imgW: number, imgH: number
  if (imgRatio > boxRatio) { imgW = availW; imgH = availW / imgRatio } else { imgH = availH; imgW = availH * imgRatio }
  pdf.addImage(mapImgData, 'PNG', margin + (availW - imgW) / 2, headerBottom, imgW, imgH)

  if (rows.length > 0) {
    pdf.addPage()
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11)
    pdf.text('Work Object Summary', margin, margin + 11)
    pdf.setFontSize(8)
    let y = margin + 30
    const total = rows.reduce((s, r) => s + r.billingTotal, 0)

    rows.forEach(({ markup, billingTotal }, i) => {
      const typeDef = markup.workObjectType ? WORK_OBJECT_TYPE_MAP[markup.workObjectType] : null
      const name = markup.featureName ?? markup.label ?? typeDef?.label ?? markup.tool
      const qty = markup.quantity != null ? `${markup.quantity.toLocaleString()} ${markup.unit ?? typeDef?.defaultUnit ?? ''}` : '—'
      pdf.setFont('helvetica', 'bold')
      pdf.text(`${i + 1}. ${name}`, margin, y)
      pdf.setFont('helvetica', 'normal')
      pdf.text(`${typeDef?.label ?? markup.tool} · ${markup.status} · ${qty} · $${billingTotal.toFixed(2)}`, margin + 12, y + 11)
      y += 26
      if (y > pageH - margin) { pdf.addPage(); y = margin + 14 }
    })

    pdf.setFont('helvetica', 'bold')
    pdf.text(`Total billed: $${total.toFixed(2)}`, margin, Math.min(y + 10, pageH - margin))
  }

  pdf.save(`${projectName.replace(/[^a-z0-9]+/gi, '_')}_field_map_report.pdf`)
}
