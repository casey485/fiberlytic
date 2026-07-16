// ---------------------------------------------------------------------------
// Field Map export/report — snapshots the map (html2canvas) and generates a
// PDF (jsPDF, dynamically imported to keep it out of the main bundle) whose
// last page is a branded Invoice built from this project's billing lines
// (see drawInvoicePage below).
// ---------------------------------------------------------------------------

import type { AppData, Client, FieldMarkup, MarkupBilling, WorkObjectTypeId } from '../types'
import { WORK_OBJECT_TYPE_MAP } from './workObjectTypes'
import type { FieldMapExportOptions } from './fieldMapExportOptions'
import { drawFiberLyticLogo } from './pdfLogo'
import { COMPANY_INFO } from './companyInfo'

export interface FieldMapReportRow {
  markup: FieldMarkup
  billingTotal: number
  /** Work date this markup was completed — same value shown on the map
   *  callout, just surfaced here for the summary page too. */
  workDate: string | null
  /** Crew hours logged for the day this markup's production entry was
   *  generated from (see ProductionEntry.hours) — null if it was never
   *  submitted to production (nothing to look up yet). */
  hours: number | null
  /** Labor + material + equipment + other cost from this markup's linked
   *  PnLEntry — the "what did this drill shot actually cost us" figure the
   *  admin summary page breaks out alongside the billed revenue. Internal
   *  only; never shown on a subcontractor's copy of this report. */
  cost: number | null
}

export function buildReportRows(markups: FieldMarkup[], billing: MarkupBilling[], data?: AppData): FieldMapReportRow[] {
  return markups.map((markup) => {
    const production = data?.production?.find((e) => e.sourceMarkupId === markup.id) ?? null
    const pnl = production ? data?.pnl?.find((p) => p.productionEntryId === production.id) ?? null : null
    return {
      markup,
      billingTotal: billing.filter((b) => b.markupId === markup.id).reduce((s, b) => s + b.total, 0),
      workDate: markup.workDate ?? null,
      hours: production?.hours ?? null,
      cost: pnl ? pnl.laborCost + pnl.materialCost + pnl.equipmentCost + pnl.otherCost : null,
    }
  })
}

/** Controls whether/how the invoice page renders. 'none' is a Supervisor
 *  export — they get the redline map/print pages only, no invoice at all.
 *  'admin' bills the end customer (Bill To: the project's Client, Payable
 *  To: FiberLytic) at the real rate-card amounts. 'subcontractorPay' is a
 *  completely different invoice — that company billing FiberLytic for their
 *  own reduced-rate pay (Bill To: FiberLytic, Payable To: the subcontractor),
 *  amounts scaled by payRatePercent/100, never the customer's real rate. */
export type SummaryReportMode =
  | { kind: 'none' }
  | { kind: 'admin' }
  | { kind: 'subcontractorPay'; payRatePercent: number | null; subcontractorName: string }

function formatMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Short, human-scannable, good enough for a working document — not a
 *  guaranteed-unique accounting sequence (this app has no invoice-number
 *  ledger). Deterministic per project+day, so re-downloading the same job's
 *  invoice the same day reproduces the same number. */
function generateInvoiceNumber(projectId: string, date: Date): string {
  const shortId = (projectId.replace(/[^a-z0-9]/gi, '').slice(-6) || 'PROJ').toUpperCase()
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  return `FL-${shortId}-${ymd}`
}

/** Draws the last-page Invoice — shared by both KmzMap's export
 *  (exportFieldMapReport below) and PDF Print Mode's (pdfPrintModeExport.tsx)
 *  so a fix to what this page shows only has to happen once. Mutates `pdf`
 *  in place; caller has already added whatever page(s) come before this.
 *  No-ops for a Supervisor export (mode.kind === 'none') or when there's no
 *  billing to invoice — an invoice page with a $0 total isn't useful. */
export function drawInvoicePage(
  pdf: InstanceType<typeof import('jspdf').jsPDF>,
  billing: MarkupBilling[],
  options: FieldMapExportOptions,
  mode: SummaryReportMode,
  project: { id: string; name: string; location: string },
  client: Client | null,
): void {
  if (mode.kind === 'none' || !options.includeBillingCodes) return
  const billable = billing.filter((b) => b.billable)
  if (billable.length === 0) return

  const payFactor = mode.kind === 'subcontractorPay' && mode.payRatePercent != null ? mode.payRatePercent / 100 : 1

  pdf.addPage('letter', 'portrait')
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 40
  const ink: [number, number, number] = [15, 23, 42]

  // Top bar
  pdf.setFillColor(...ink)
  pdf.rect(0, 0, pageW, 6, 'F')

  // Logo + company block
  drawFiberLyticLogo(pdf, margin, margin + 6, 46)
  let iy = margin + 66
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...ink)
  pdf.text(COMPANY_INFO.name, margin, iy); iy += 13
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(100, 100, 100)
  pdf.text(COMPANY_INFO.addressLine1, margin, iy); iy += 11
  pdf.text(COMPANY_INFO.addressLine2, margin, iy); iy += 11
  pdf.text(COMPANY_INFO.phone, margin, iy); iy += 11
  pdf.text(COMPANY_INFO.email, margin, iy)

  // "Invoice" title
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(30); pdf.setTextColor(...ink)
  pdf.text('Invoice', margin, iy + 44)
  let y = iy + 76

  // 5-column info row — a subcontractor's pay invoice inverts Bill To/Payable
  // To vs. the customer invoice admin sees: they're billing FiberLytic, not
  // the end customer, for their own reduced-rate pay.
  const invoiceDate = new Date().toLocaleDateString()
  const invoiceNumber = generateInvoiceNumber(project.id, new Date())
  const billToLines: string[] = mode.kind === 'subcontractorPay'
    ? [COMPANY_INFO.name, COMPANY_INFO.addressLine1, COMPANY_INFO.addressLine2]
    : [
        client?.name ?? project.name,
        client?.billingAddress ?? '',
        [client?.billingCity, client?.billingState].filter(Boolean).join(', ') + (client?.billingZip ? ` ${client.billingZip}` : ''),
      ].filter((l) => l.trim().length > 0)
  const payableToLines: string[] = [mode.kind === 'subcontractorPay' ? mode.subcontractorName : COMPANY_INFO.name]

  const cols: { label: string; lines: string[] }[] = [
    { label: 'Bill To', lines: billToLines },
    { label: 'Payable To', lines: payableToLines },
    { label: 'Invoice Date', lines: [invoiceDate] },
    { label: 'Invoice #', lines: [invoiceNumber] },
    { label: 'Work Location', lines: [project.location || project.name] },
  ]
  const colW = (pageW - margin * 2) / cols.length
  pdf.setFontSize(8.5)
  for (let i = 0; i < cols.length; i++) {
    const cx = margin + i * colW
    pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...ink)
    pdf.text(cols[i].label, cx, y)
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(60, 60, 60)
    let cy = y + 12
    for (const line of cols[i].lines) {
      const wrapped = pdf.splitTextToSize(line, colW - 10) as string[]
      pdf.text(wrapped, cx, cy)
      cy += 11 * wrapped.length
    }
  }
  y += 74

  // Table
  const tableCols = [
    { key: 'date', label: 'DATE', w: 0.12, align: 'left' as const },
    { key: 'code', label: 'LABOR UNIT', w: 0.13, align: 'left' as const },
    { key: 'desc', label: 'DESCRIPTION', w: 0.28, align: 'left' as const },
    { key: 'uom', label: 'UOM', w: 0.09, align: 'left' as const },
    { key: 'qty', label: 'QTY', w: 0.12, align: 'right' as const },
    { key: 'rate', label: 'RATE', w: 0.12, align: 'right' as const },
    { key: 'amount', label: 'AMOUNT', w: 0.14, align: 'right' as const },
  ]
  const tableW = pageW - margin * 2

  function drawTableHeader(atY: number): number {
    pdf.setFillColor(...ink)
    pdf.rect(margin, atY, tableW, 20, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(255, 255, 255)
    let cx = margin
    for (const c of tableCols) {
      pdf.text(c.label, c.align === 'right' ? cx + c.w * tableW - 8 : cx + 6, atY + 13, { align: c.align })
      cx += c.w * tableW
    }
    pdf.setTextColor(...ink)
    return atY + 20
  }

  y = drawTableHeader(y)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(30, 30, 30)

  let total = 0
  billable.forEach((b, i) => {
    if (y > pageH - margin - 110) {
      pdf.addPage('letter', 'portrait')
      y = drawTableHeader(margin)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(30, 30, 30)
    }
    const rate = b.rate * payFactor
    const amount = b.total * payFactor
    total += amount
    if (i % 2 === 1) { pdf.setFillColor(247, 247, 247); pdf.rect(margin, y, tableW, 22, 'F') }
    const cells = [
      b.date ? new Date(`${b.date}T00:00:00`).toLocaleDateString() : '—',
      b.rateCode,
      b.description,
      b.unitType,
      b.quantity.toLocaleString(),
      formatMoney(rate),
      formatMoney(amount),
    ]
    let cx = margin
    tableCols.forEach((c, ci) => {
      const text = pdf.splitTextToSize(cells[ci], c.w * tableW - 12) as string[]
      pdf.text(text, c.align === 'right' ? cx + c.w * tableW - 8 : cx + 6, y + 15, { align: c.align })
      cx += c.w * tableW
    })
    y += 22
  })

  // Divider + TOTAL badge
  pdf.setDrawColor(...ink); pdf.setLineWidth(1.5)
  pdf.line(margin, y + 6, pageW - margin, y + 6)
  y += 26
  pdf.setFillColor(...ink)
  pdf.rect(pageW - margin - 140, y - 14, 60, 20, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(255, 255, 255)
  pdf.text('TOTAL', pageW - margin - 110, y, { align: 'center' })
  pdf.setFontSize(13); pdf.setTextColor(...ink)
  pdf.text(formatMoney(total), pageW - margin, y, { align: 'right' })
  y += 26

  // Divider + Payment Terms / Total Production
  pdf.setDrawColor(...ink); pdf.setLineWidth(1)
  pdf.line(margin, y, pageW - margin, y)
  y += 20
  const totalProduction = billable.reduce((s, b) => s + b.quantity, 0)
  const uomSample = billable[0]?.unitType ?? ''
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(100, 100, 100)
  pdf.text('Payment Terms', margin, y)
  pdf.text('Total Production', margin, y + 14)
  pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...ink)
  pdf.text('Net 30', pageW - margin, y, { align: 'right' })
  pdf.text(`${totalProduction.toLocaleString()} ${uomSample}`, pageW - margin, y + 14, { align: 'right' })
  y += 40

  // Footer
  pdf.setDrawColor(220, 220, 220); pdf.setLineWidth(0.5)
  pdf.line(margin, y, pageW - margin, y)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(150, 150, 150)
  pdf.text(`${COMPANY_INFO.name} — Invoice ${invoiceNumber} — Thank you for your business.`, pageW / 2, y + 16, { align: 'center' })
  pdf.setTextColor(0, 0, 0)
}

export async function exportFieldMapReport(
  mapEl: HTMLElement,
  project: { name: string; id: string; location: string; clientId?: string | null },
  rows: FieldMapReportRow[],
  billing: MarkupBilling[],
  data: AppData,
  options: FieldMapExportOptions,
  mode: SummaryReportMode = { kind: 'admin' },
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'), import('jspdf'),
  ])

  // Callout boxes and their dashed leader lines are deliberately rendered as
  // position:fixed elements appended to <body> (see KmzMap.tsx's renderCallout/
  // ensureArrowSVG) rather than nested inside mapEl, so they escape mapEl's own
  // z-index stacking context. That means they live OUTSIDE mapEl's subtree —
  // querying/snapshotting mapEl alone can never see them. Query document.body
  // for the toggle, and snapshot document.body itself (cropped to mapEl's
  // on-screen rect via html2canvas's x/y/width/height) so the callouts are
  // actually captured in the export, not silently dropped.
  const calloutEls = options.includeCallouts
    ? []
    : Array.from(document.body.querySelectorAll<HTMLElement>('[data-callout-overlay], .callout-arrows'))
  for (const el of calloutEls) el.style.visibility = 'hidden'

  const mapRect = mapEl.getBoundingClientRect()
  let mapImgData: string, mapW: number, mapH: number
  try {
    const canvas = await html2canvas(document.body, {
      useCORS: true, allowTaint: false, logging: false, backgroundColor: '#0a0a0a',
      scale: Math.max(2, window.devicePixelRatio ?? 1),
      x: mapRect.left, y: mapRect.top, width: mapRect.width, height: mapRect.height,
    })
    // JPEG instead of PNG — PNG's lossless compression is enormous for map/photo
    // content (this was the main driver of file sizes too large to email); JPEG
    // at 0.9 quality looks effectively identical for this purpose at a fraction
    // of the size. Callouts/redlines are vector-ish flat colors on a photo
    // background, which JPEG handles fine at this quality without visible
    // artifacting around text.
    mapImgData = canvas.toDataURL('image/jpeg', 0.9)
    mapW = canvas.width; mapH = canvas.height
  } finally {
    for (const el of calloutEls) el.style.visibility = ''
  }
  const landscape = mapW >= mapH

  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'letter', compress: true })
  const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight(), margin = 36

  const exportedAt = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })

  let headerRight = margin
  drawFiberLyticLogo(pdf, margin, margin - 4, 32)
  headerRight = margin + 40

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13)
  pdf.text(`${project.name} — Field Map Report`, headerRight, margin + 10)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(120, 120, 120)
  pdf.text(`Project ID: ${project.id}`, headerRight, margin + 22)
  pdf.text(`Exported ${exportedAt}`, headerRight, margin + 33)
  pdf.setTextColor(0, 0, 0)

  const headerBottom = margin + 46, availW = pageW - margin * 2, availH = pageH - headerBottom - margin
  const imgRatio = mapW / mapH, boxRatio = availW / availH
  let imgW: number, imgH: number
  if (imgRatio > boxRatio) { imgW = availW; imgH = availW / imgRatio } else { imgH = availH; imgW = availH * imgRatio }
  pdf.addImage(mapImgData, 'JPEG', margin + (availW - imgW) / 2, headerBottom, imgW, imgH)

  if (options.includeLegend) {
    const legendTypes = [...new Map(rows.map((r) => [r.markup.workObjectType, r.markup.color] as const)).entries()]
      .filter((e): e is [WorkObjectTypeId, string] => !!e[0])
    if (legendTypes.length > 0) {
      let ly = headerBottom + 8
      pdf.setFontSize(7)
      for (const [typeId, color] of legendTypes.slice(0, 12)) {
        const label = WORK_OBJECT_TYPE_MAP[typeId]?.label ?? typeId
        const rgb = /^#([0-9a-f]{6})$/i.exec(color)
        if (rgb) {
          const n = parseInt(rgb[1], 16)
          pdf.setFillColor((n >> 16) & 255, (n >> 8) & 255, n & 255)
          pdf.rect(pageW - margin - 90, ly - 5, 6, 6, 'F')
        }
        pdf.setTextColor(200, 200, 200)
        pdf.text(label, pageW - margin - 80, ly)
        ly += 9
      }
      pdf.setTextColor(0, 0, 0)
    }
  }

  const client = project.clientId ? (data.clients ?? []).find((c) => c.id === project.clientId) ?? null : null
  drawInvoicePage(pdf, billing, options, mode, project, client)

  pdf.save(`${project.name.replace(/[^a-z0-9]+/gi, '_')}_field_map_report.pdf`)
}
