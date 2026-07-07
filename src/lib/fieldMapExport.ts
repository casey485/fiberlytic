// ---------------------------------------------------------------------------
// Field Map export/report — snapshots the map (html2canvas) and generates a
// PDF (jsPDF, dynamically imported to keep it out of the main bundle) whose
// second page summarizes this project's Work Objects: type/status/quantity/
// billing total.
// ---------------------------------------------------------------------------

import type { FieldMarkup, MarkupBilling, WorkObjectTypeId } from '../types'
import { WORK_OBJECT_TYPE_MAP } from './workObjectTypes'
import type { FieldMapExportOptions } from './fieldMapExportOptions'

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

/** Fetches a static asset and returns it as a data URI, or null if unavailable —
 *  used for the company logo, which is optional (some deployments may not have
 *  replaced the placeholder). Never throws; a missing/broken logo just omits it. */
async function loadImageDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export async function exportFieldMapReport(
  mapEl: HTMLElement,
  project: { name: string; id: string },
  rows: FieldMapReportRow[],
  options: FieldMapExportOptions,
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }, logoDataUrl] = await Promise.all([
    import('html2canvas'), import('jspdf'), loadImageDataUrl('/logo.jpg'),
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
  if (logoDataUrl) {
    try { pdf.addImage(logoDataUrl, margin + 0, margin - 4, 32, 32); headerRight = margin + 40 } catch { /* corrupt/unsupported image data — skip */ }
  }

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
      const qty = options.includeQuantities && markup.quantity != null
        ? `${markup.quantity.toLocaleString()} ${markup.unit ?? typeDef?.defaultUnit ?? ''}`
        : null
      const detailParts = [
        typeDef?.label ?? markup.tool,
        qty,
        options.includeBillingCodes ? `$${billingTotal.toFixed(2)}` : null,
      ].filter(Boolean)
      pdf.setFont('helvetica', 'bold')
      pdf.text(`${i + 1}. ${name}`, margin, y)
      pdf.setFont('helvetica', 'normal')
      pdf.text(detailParts.join(' · '), margin + 12, y + 11)
      y += 22
      if (options.includeNotes && markup.notes) {
        pdf.setFont('helvetica', 'italic'); pdf.setFontSize(7)
        pdf.text(markup.notes, margin + 12, y)
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
        y += 11
      }
      y += 4
      if (y > pageH - margin) { pdf.addPage(); y = margin + 14 }
    })

    if (options.includeBillingCodes) {
      pdf.setFont('helvetica', 'bold')
      pdf.text(`Total billed: $${total.toFixed(2)}`, margin, Math.min(y + 10, pageH - margin))
    }
  }

  pdf.save(`${project.name.replace(/[^a-z0-9]+/gi, '_')}_field_map_report.pdf`)
}
