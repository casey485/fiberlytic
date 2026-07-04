// ---------------------------------------------------------------------------
// Map Reading's four export formats. Follows src/lib/mapCuts/pdfBuilder.ts's
// dynamic-import + unit:'pt' jsPDF pattern for the two PDF outputs; the CSV/
// JSON builders are plain string builders (no existing CSV helper anywhere
// in this codebase to reuse, confirmed via search — not worth a library for
// a flat summary table).
// ---------------------------------------------------------------------------

import type { jsPDF as JsPDFType } from 'jspdf'
import type { MapReadingSession, MapReadingDetectionType } from '../../types'
import { loadBlob } from '../fileStore'
import { MAP_READING_COLORS, MAP_READING_TYPE_LABELS } from './colors'

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** One page per source page: the raster plus colored detection boxes, at the
 *  same fixed 300 DPI the pages were rendered at (pageRender.ts). */
export async function buildMarkedUpPdf(session: MapReadingSession): Promise<JsPDFType> {
  const { jsPDF } = await import('jspdf')
  const DPI = 300
  let pdf: JsPDFType | null = null

  for (let i = 0; i < session.pages.length; i++) {
    const page = session.pages[i]
    const dataUrl = await loadBlob(page.imageBlobKey)
    const wPt = (page.naturalWidth / DPI) * 72
    const hPt = (page.naturalHeight / DPI) * 72
    const orientation = wPt >= hPt ? 'landscape' : 'portrait'

    if (i === 0) {
      pdf = new jsPDF({ unit: 'pt', format: [wPt, hPt], orientation })
    } else {
      pdf!.addPage([wPt, hPt], orientation)
    }
    if (dataUrl) {
      pdf!.addImage(dataUrl, 'JPEG', 0, 0, wPt, hPt)
    }
    const pxToPt = 72 / DPI
    for (const d of page.detections) {
      const [r, g, b] = hexToRgb(MAP_READING_COLORS[d.type])
      pdf!.setDrawColor(r, g, b)
      pdf!.setLineWidth(1.5)
      pdf!.rect(d.x * pxToPt, d.y * pxToPt, d.width * pxToPt, d.height * pxToPt)
    }
    // Small legend in the corner
    pdf!.setFontSize(7)
    pdf!.setTextColor(80, 80, 80)
    pdf!.text(`${page.fileName} — page ${page.pageIndexInFile + 1}`, 8, hPt - 6)
  }

  if (!pdf) pdf = new jsPDF({ unit: 'pt' })
  return pdf
}

/** A readable text dump of every page's editable notes template. */
export async function buildNotesReportPdf(session: MapReadingSession): Promise<JsPDFType> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
  const marginX = 48
  const pageH = pdf.internal.pageSize.getHeight()
  const lineH = 14

  session.pages.forEach((page, i) => {
    if (i > 0) pdf.addPage()
    let y = 56
    pdf.setFontSize(14)
    pdf.setTextColor(20, 20, 20)
    pdf.text(page.notes.pageName || page.fileName, marginX, y)
    y += lineH * 1.5

    const rows: [string, string][] = [
      ['Strand + Fiber 24ct', page.notes.strand24ct],
      ['Strand + Fiber 48ct', page.notes.strand48ct],
      ['Strand + Fiber 96ct', page.notes.strand96ct],
      ['Overlash Fiber', page.notes.overlash],
      ['Coils', page.notes.coils],
      ['Snowshoes', page.notes.snowshoes],
      ['FE Labels', page.notes.feLabels],
      ['FT Labels', page.notes.ftLabels],
      ['Road Names', page.notes.roadNames],
      ['Tie Point', page.notes.tiePoint],
      ['OLT/MUX', page.notes.oltMux],
      ['Questions / Needs Review', page.notes.needsReview],
    ]
    pdf.setFontSize(10)
    for (const [label, value] of rows) {
      if (y > pageH - 40) { pdf.addPage(); y = 56 }
      pdf.setTextColor(90, 90, 90)
      pdf.text(`${label}:`, marginX, y)
      pdf.setTextColor(20, 20, 20)
      const wrapped = pdf.splitTextToSize(value || '—', 460)
      pdf.text(wrapped, marginX + 160, y)
      y += lineH * Math.max(1, wrapped.length)
    }
  })

  return pdf
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** Per-type detection counts across the whole session. */
export function buildCsvSummary(session: MapReadingSession): string {
  const counts = new Map<MapReadingDetectionType, number>()
  for (const page of session.pages) {
    for (const d of page.detections) counts.set(d.type, (counts.get(d.type) ?? 0) + 1)
  }
  const rows = [['Detection Type', 'Count'].join(',')]
  for (const [type, label] of Object.entries(MAP_READING_TYPE_LABELS) as [MapReadingDetectionType, string][]) {
    const n = counts.get(type) ?? 0
    if (n === 0) continue
    rows.push([csvEscape(label), String(n)].join(','))
  }
  return rows.join('\n')
}

/** Raw detection + notes data for the whole session. */
export function buildJsonExport(session: MapReadingSession): string {
  return JSON.stringify(
    {
      session: session.name,
      exportedAt: new Date().toISOString(),
      pages: session.pages.map((p) => ({
        fileName: p.fileName,
        pageIndexInFile: p.pageIndexInFile,
        notes: p.notes,
        detections: p.detections,
      })),
    },
    null,
    2,
  )
}
