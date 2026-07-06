// ---------------------------------------------------------------------------
// "Download PDF" for PDF Print Mode — the paginated, high-resolution export of
// the literal uploaded construction print with its redline overlay baked in.
// This is "the original project print in landscape orientation" the Field Map
// redline spec calls for, as distinct from KmzMap's Leaflet satellite-map
// export (fieldMapExport.ts). Reuses pageImages (already-rendered page images
// for every page, not just the one on screen) so no on-screen page navigation
// is needed — each requested page is composited off-screen, snapshotted with
// html2canvas, and added to the PDF as its own full page.
// ---------------------------------------------------------------------------

import { createRoot } from 'react-dom/client'
import type { AppData, FieldMarkup } from '../types'
import { WORK_OBJECT_TYPE_MAP } from './workObjectTypes'
import { markupToPdfElement } from './markupToPdfSvg'
import { buildWorkObjectCalloutContent, geometryAnchor } from './workObjectCallout'
import type { CalloutDisplaySettings } from './calloutDisplaySettings'
import { getSavedCalloutOffset } from './calloutPosition'
import type { FieldMapExportOptions } from './fieldMapExportOptions'
import { buildReportRows } from './fieldMapExport'

function probeImageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || 1100, h: img.naturalHeight || 850 })
    img.onerror = () => resolve({ w: 1100, h: 850 })
    img.src = dataUrl
  })
}

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

/** Mounts one page's image + redline overlay + (optionally) callout boxes into a
 *  detached, off-screen container at the page's native resolution, waits for
 *  paint, and returns the container ready for html2canvas — caller must call the
 *  returned cleanup() afterward. */
async function mountPageOffscreen(
  image: string, naturalW: number, naturalH: number, markups: FieldMarkup[],
  data: AppData, calloutSettings: CalloutDisplaySettings, includeCallouts: boolean,
): Promise<{ container: HTMLElement; cleanup: () => void }> {
  const container = document.createElement('div')
  container.style.cssText = `position:fixed;left:-100000px;top:0;width:${naturalW}px;height:${naturalH}px;background:#0a0a0a;overflow:hidden`
  document.body.appendChild(container)
  const root = createRoot(container)

  const calloutMarkups = includeCallouts ? markups.filter((m) => m.workObjectType) : []

  await new Promise<void>((resolve) => {
    root.render(
      <div style={{ position: 'relative', width: naturalW, height: naturalH }}>
        <img src={image} alt="" width={naturalW} height={naturalH} style={{ display: 'block', width: naturalW, height: naturalH }} />
        <svg viewBox={`0 0 ${naturalW} ${naturalH}`} style={{ position: 'absolute', inset: 0, width: naturalW, height: naturalH }}>
          {markups.map((m) => <g key={m.id}>{markupToPdfElement(m)}</g>)}
        </svg>
        {calloutMarkups.map((m) => {
          const anchor = geometryAnchor(m.geometry)
          if (!anchor) return null
          const [ax, ay] = anchor
          const off = getSavedCalloutOffset(m.id) ?? { offsetX: 40, offsetY: -60 }
          const content = buildWorkObjectCalloutContent(m, data, calloutSettings)
          const color = m.color || '#3b82f6'
          return (
            <div
              key={m.id}
              style={{
                position: 'absolute', left: ax + off.offsetX, top: ay + off.offsetY,
                background: 'rgba(0,0,0,0.9)', border: `1.5px solid ${color}`, borderRadius: 8,
                padding: '9px 11px', color: '#f1f5f9', fontSize: 11, minWidth: 150, maxWidth: 280,
                width: 'max-content', fontFamily: 'sans-serif',
              }}
            >
              {content.title && (
                <div style={{ fontWeight: 700, fontSize: 12, color, marginBottom: content.rows.length ? 4 : 0 }}>
                  {content.title}
                </div>
              )}
              {content.rows.map((row, i) => (
                <div key={i} style={{ display: 'flex', gap: 5, lineHeight: 1.5 }}>
                  <span style={{ color: '#94a3b8', flexShrink: 0 }}>{row.label}:</span>
                  <span style={{ color: '#f1f5f9', fontWeight: 600, wordBreak: 'break-word' }}>{row.value}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>,
    )
    // Two rAFs: one for React to commit, one for the browser to paint (data-URI
    // <img> included) before html2canvas snapshots the container.
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

  return {
    container,
    cleanup: () => { root.unmount(); container.remove() },
  }
}

export interface PdfPrintModeExportArgs {
  project: { name: string; id: string }
  pageImages: string[]
  pageIndexes: number[]
  /** All markups for this project file, in coordSpace 'pdfPage', already filtered
   *  by the export dialog's scope/criteria. */
  markups: FieldMarkup[]
  data: AppData
  calloutSettings: CalloutDisplaySettings
  options: FieldMapExportOptions
}

export async function exportPdfPrintModeReport(args: PdfPrintModeExportArgs): Promise<void> {
  const { project, pageImages, pageIndexes, markups, data, calloutSettings, options } = args
  const [{ default: html2canvas }, { jsPDF }, logoDataUrl] = await Promise.all([
    import('html2canvas'), import('jspdf'), loadImageDataUrl('/logo.jpg'),
  ])

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight(), margin = 36

  // ── Cover page: project name/id, export timestamp, logo — kept off the print
  // pages themselves so those preserve the original print's exact scale/layout. ──
  let headerRight = margin
  if (logoDataUrl) {
    try { pdf.addImage(logoDataUrl, margin, margin - 4, 40, 40); headerRight = margin + 50 } catch { /* unsupported image data — skip */ }
  }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18)
  pdf.text(project.name, headerRight, margin + 16)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(120, 120, 120)
  pdf.text(`Project ID: ${project.id}`, headerRight, margin + 34)
  pdf.text(`Exported ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}`, headerRight, margin + 50)
  pdf.setTextColor(0, 0, 0)
  pdf.setFontSize(11)
  pdf.text(`${pageIndexes.length} page${pageIndexes.length === 1 ? '' : 's'} of completed redlines included`, margin, margin + 90)

  if (options.includeLegend) {
    const legendTypes = [...new Map(markups.map((m) => [m.workObjectType, m.color] as const)).entries()]
      .filter((e): e is [NonNullable<typeof e[0]>, string] => !!e[0])
    if (legendTypes.length > 0) {
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10)
      pdf.text('Legend', margin, margin + 120)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
      let ly = margin + 136
      for (const [typeId, color] of legendTypes) {
        const rgb = /^#([0-9a-f]{6})$/i.exec(color)
        if (rgb) {
          const n = parseInt(rgb[1], 16)
          pdf.setFillColor((n >> 16) & 255, (n >> 8) & 255, n & 255)
          pdf.rect(margin, ly - 6, 8, 8, 'F')
        }
        pdf.text(WORK_OBJECT_TYPE_MAP[typeId]?.label ?? typeId, margin + 12, ly)
        ly += 13
      }
    }
  }

  // ── One full-bleed landscape page per print page, redline overlay baked in ──
  for (const pageIndex of pageIndexes) {
    const image = pageImages[pageIndex]
    if (!image) continue
    const { w: naturalW, h: naturalH } = await probeImageSize(image)
    const pageMarkups = markups.filter((m) => m.pageIndex === pageIndex)

    const { container, cleanup } = await mountPageOffscreen(
      image, naturalW, naturalH, pageMarkups, data, calloutSettings, options.includeCallouts,
    )
    try {
      const canvas = await html2canvas(container, {
        useCORS: true, allowTaint: false, logging: false, backgroundColor: '#0a0a0a',
        scale: Math.max(2, window.devicePixelRatio ?? 1),
      })
      const imgData = canvas.toDataURL('image/png')
      pdf.addPage('letter', 'landscape')
      const imgRatio = canvas.width / canvas.height, boxRatio = (pageW - margin * 2) / (pageH - margin * 2)
      let imgW: number, imgH: number
      const availW = pageW - margin * 2, availH = pageH - margin * 2
      if (imgRatio > boxRatio) { imgW = availW; imgH = availW / imgRatio } else { imgH = availH; imgW = availH * imgRatio }
      pdf.addImage(imgData, 'PNG', margin + (availW - imgW) / 2, margin + (availH - imgH) / 2, imgW, imgH)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(140, 140, 140)
      pdf.text(`Page ${pageIndex + 1}`, pageW - margin - 40, pageH - 14)
      pdf.setTextColor(0, 0, 0)
    } finally {
      cleanup()
    }
  }

  // ── Summary page — same Work Object list as KmzMap's export ──
  const rows = buildReportRows(markups, (data.markupBilling ?? []).filter((b) => markups.some((m) => m.id === b.markupId)))
  if (rows.length > 0) {
    pdf.addPage('letter', 'portrait')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11)
    pdf.text('Work Object Summary', margin, margin + 11)
    pdf.setFontSize(8)
    const summaryPageH = pdf.internal.pageSize.getHeight()
    let y = margin + 30
    const total = rows.reduce((s, r) => s + r.billingTotal, 0)
    rows.forEach(({ markup, billingTotal }, i) => {
      const typeDef = markup.workObjectType ? WORK_OBJECT_TYPE_MAP[markup.workObjectType] : null
      const name = markup.featureName ?? markup.label ?? typeDef?.label ?? markup.tool
      const qty = options.includeQuantities && markup.quantity != null
        ? `${markup.quantity.toLocaleString()} ${markup.unit ?? typeDef?.defaultUnit ?? ''}` : null
      const parts = [typeDef?.label ?? markup.tool, qty, options.includeBillingCodes ? `$${billingTotal.toFixed(2)}` : null].filter(Boolean)
      pdf.setFont('helvetica', 'bold')
      pdf.text(`${i + 1}. ${name}`, margin, y)
      pdf.setFont('helvetica', 'normal')
      pdf.text(parts.join(' · '), margin + 12, y + 11)
      y += 22
      if (options.includeNotes && markup.notes) {
        pdf.setFont('helvetica', 'italic'); pdf.setFontSize(7)
        pdf.text(markup.notes, margin + 12, y)
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
        y += 11
      }
      y += 4
      if (y > summaryPageH - margin) { pdf.addPage('letter', 'portrait'); y = margin + 14 }
    })
    if (options.includeBillingCodes) {
      pdf.setFont('helvetica', 'bold')
      pdf.text(`Total billed: $${total.toFixed(2)}`, margin, Math.min(y + 10, summaryPageH - margin))
    }
  }

  pdf.save(`${project.name.replace(/[^a-z0-9]+/gi, '_')}_field_map_print_export.pdf`)
}
