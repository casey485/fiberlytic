// ---------------------------------------------------------------------------
// Closeout Package PDF — bundles whichever of a project's Work Object
// summary/photos/inspections/notes/attachments/general photos the admin
// picked (see closeoutExportOptions.ts) into one branded document, using the
// exact same jsPDF conventions as fieldMapExport.ts's drawInvoicePage
// (letter portrait, 40pt margin, FiberLytic ink color) so it looks like it
// belongs next to the existing Field Map / PDF Print Mode reports.
// Deliberately does NOT touch either of those exporters — this is a new,
// separate export path.
// ---------------------------------------------------------------------------

import type { Client, Project } from '../types'
import { drawFiberLyticLogo } from './pdfLogo'
import { COMPANY_INFO } from './companyInfo'
import { loadBlob } from './fileStore'
import { formatDate } from './format'
import { WORK_OBJECT_TYPE_MAP } from './workObjectTypes'
import { MARKUP_STATUS_META } from '../types'
import { crewOrSubName } from './crewOrSub'
import type { AppData } from '../types'
import type { WorkObjectDocBundle } from './projectDocumentation'
import type { CloseoutPackageOptions } from './closeoutExportOptions'

const INK: [number, number, number] = [15, 23, 42]
const MARGIN = 40

/** Same idb:/mkp- blob resolution PhotoImg.tsx and MarkupPanel.tsx use — see
 *  their own doc comments for why photos and Work Object photos are two
 *  differently-keyed systems. */
async function resolveGeneralPhotoUrl(url: string): Promise<string | null> {
  if (url.startsWith('idb:')) return loadBlob(url.slice(4))
  return url || null
}
async function resolveMarkupPhotoUrl(markupPhotoId: string): Promise<string | null> {
  return loadBlob(`mkp-${markupPhotoId}`)
}

function jpegOrPngFormat(dataUrl: string): 'JPEG' | 'PNG' {
  return dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG'
}

/** Draws as many photos as fit in a simple 3-column grid starting at `y`,
 *  paginating when a row would run off the page. Returns the y position
 *  after the grid. Skips any photo whose blob failed to resolve (deleted/
 *  corrupt IndexedDB entry) rather than failing the whole export. */
async function drawPhotoGrid(
  pdf: InstanceType<typeof import('jspdf').jsPDF>,
  photos: { url: string | null; caption: string | null }[],
  startY: number,
  pageW: number,
  pageH: number,
): Promise<number> {
  const cols = 3
  const gap = 8
  const cellW = (pageW - MARGIN * 2 - gap * (cols - 1)) / cols
  const cellH = cellW * 0.75
  let x = MARGIN
  let y = startY
  let col = 0

  for (const photo of photos) {
    if (!photo.url) continue
    if (y + cellH + 14 > pageH - MARGIN) {
      pdf.addPage('letter', 'portrait')
      y = MARGIN
      x = MARGIN
      col = 0
    }
    try {
      pdf.addImage(photo.url, jpegOrPngFormat(photo.url), x, y, cellW, cellH, undefined, 'FAST')
    } catch {
      // Corrupt/unreadable image data — skip it, don't fail the whole package.
    }
    if (photo.caption) {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(100, 100, 100)
      const lines = pdf.splitTextToSize(photo.caption, cellW) as string[]
      pdf.text(lines.slice(0, 2), x, y + cellH + 9)
    }
    col++
    if (col >= cols) { col = 0; x = MARGIN; y += cellH + 22 } else { x += cellW + gap }
  }
  return col === 0 ? y : y + cellH + 22
}

export interface CloseoutPackageArgs {
  project: Project
  client: Client | null
  data: AppData
  workObjects: WorkObjectDocBundle[]
  generalPhotos: { url: string; caption: string; category: string; date: string }[]
  options: CloseoutPackageOptions
}

export async function buildCloseoutPackagePdf(args: CloseoutPackageArgs): Promise<InstanceType<typeof import('jspdf').jsPDF>> {
  const { project, client, data, workObjects, generalPhotos, options } = args
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()

  // ── Cover page ──────────────────────────────────────────────────────────
  pdf.setFillColor(...INK)
  pdf.rect(0, 0, pageW, 6, 'F')
  drawFiberLyticLogo(pdf, MARGIN, MARGIN + 6, 46)
  let y = MARGIN + 90
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(28); pdf.setTextColor(...INK)
  pdf.text('Project Closeout Package', MARGIN, y)
  y += 34
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(13); pdf.setTextColor(60, 60, 60)
  pdf.text(project.name, MARGIN, y)
  y += 20
  pdf.setFontSize(10); pdf.setTextColor(100, 100, 100)
  if (project.location) { pdf.text(project.location, MARGIN, y); y += 15 }
  if (client?.name) { pdf.text(`Client: ${client.name}`, MARGIN, y); y += 15 }
  pdf.text(`Generated: ${new Date().toLocaleDateString()}`, MARGIN, y)
  y += 30

  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(140, 140, 140)
  pdf.text(`Prepared by ${COMPANY_INFO.name} · ${COMPANY_INFO.phone} · ${COMPANY_INFO.email}`, MARGIN, y)
  y += 30

  pdf.setDrawColor(220, 220, 220); pdf.setLineWidth(0.5)
  pdf.line(MARGIN, y, pageW - MARGIN, y)
  y += 24

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...INK)
  pdf.text('Included in this package', MARGIN, y)
  y += 18
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(60, 60, 60)
  const summaryLines: string[] = []
  if (options.includeWorkObjectSummary) summaryLines.push(`Work Object summary — ${workObjects.length} item${workObjects.length === 1 ? '' : 's'}`)
  if (options.includePhotos) summaryLines.push(`Work Object photos — ${workObjects.reduce((s, w) => s + w.photos.length, 0)} photo${workObjects.reduce((s, w) => s + w.photos.length, 0) === 1 ? '' : 's'}`)
  if (options.includeGeneralPhotos) summaryLines.push(`General project photos — ${generalPhotos.length} photo${generalPhotos.length === 1 ? '' : 's'}`)
  if (options.includeInspections) summaryLines.push(`Inspection results — ${workObjects.reduce((s, w) => s + w.inspections.length, 0)} report${workObjects.reduce((s, w) => s + w.inspections.length, 0) === 1 ? '' : 's'}`)
  if (options.includeAttachments) summaryLines.push(`Attachments — ${workObjects.reduce((s, w) => s + w.attachments.length, 0)} file${workObjects.reduce((s, w) => s + w.attachments.length, 0) === 1 ? '' : 's'} (listed by name)`)
  if (options.includeVideos) summaryLines.push(`Videos — ${workObjects.reduce((s, w) => s + w.videos.length, 0)} clip${workObjects.reduce((s, w) => s + w.videos.length, 0) === 1 ? '' : 's'} (listed by name — see the in-app Documentation folder to view/download)`)
  if (options.includeNotes) summaryLines.push('Work Object notes')
  for (const line of summaryLines) { pdf.text(`•  ${line}`, MARGIN, y); y += 15 }

  // ── Work Object summary table ───────────────────────────────────────────
  if (options.includeWorkObjectSummary && workObjects.length > 0) {
    pdf.addPage('letter', 'portrait')
    let ty = MARGIN
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(...INK)
    pdf.text('Work Object Summary', MARGIN, ty)
    ty += 26

    const cols = [
      { label: 'WORK ID', w: 0.16 },
      { label: 'TYPE', w: 0.22 },
      { label: 'CREW / SUB', w: 0.24 },
      { label: 'DATE', w: 0.14 },
      { label: 'STATUS', w: 0.12 },
      { label: 'QTY', w: 0.12 },
    ]
    const tableW = pageW - MARGIN * 2
    const drawHeader = (atY: number): number => {
      pdf.setFillColor(...INK)
      pdf.rect(MARGIN, atY, tableW, 20, 'F')
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(255, 255, 255)
      let cx = MARGIN
      for (const c of cols) { pdf.text(c.label, cx + 6, atY + 13); cx += c.w * tableW }
      pdf.setTextColor(...INK)
      return atY + 20
    }
    ty = drawHeader(ty)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
    workObjects.forEach((wo, i) => {
      if (ty > pageH - MARGIN - 22) { pdf.addPage('letter', 'portrait'); ty = drawHeader(MARGIN); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8) }
      if (i % 2 === 1) { pdf.setFillColor(247, 247, 247); pdf.rect(MARGIN, ty, tableW, 22, 'F') }
      const m = wo.markup
      const typeLabel = m.workObjectType ? WORK_OBJECT_TYPE_MAP[m.workObjectType]?.label ?? m.tool : m.tool
      const who = crewOrSubName(data, m.crewId, m.assignedSubcontractorId)
      const cells = [
        m.workId ?? m.id.slice(0, 10),
        typeLabel,
        who,
        m.workDate ? formatDate(m.workDate) : formatDate(m.createdAt.slice(0, 10)),
        MARKUP_STATUS_META[m.status]?.label ?? m.status,
        m.quantity != null ? `${m.quantity} ${m.unit ?? ''}`.trim() : '—',
      ]
      let cx = MARGIN
      pdf.setTextColor(30, 30, 30)
      cells.forEach((text, ci) => {
        const wrapped = pdf.splitTextToSize(text, cols[ci].w * tableW - 10) as string[]
        pdf.text(wrapped[0] ?? '', cx + 6, ty + 14)
        cx += cols[ci].w * tableW
      })
      ty += 22
    })
  }

  // ── General project photos ──────────────────────────────────────────────
  if (options.includeGeneralPhotos && generalPhotos.length > 0) {
    pdf.addPage('letter', 'portrait')
    let py = MARGIN
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(...INK)
    pdf.text('General Project Photos', MARGIN, py)
    py += 26
    const resolved = await Promise.all(generalPhotos.map(async (p) => ({
      url: await resolveGeneralPhotoUrl(p.url),
      caption: [p.category, p.caption].filter(Boolean).join(' — ') || null,
    })))
    await drawPhotoGrid(pdf, resolved, py, pageW, pageH)
  }

  // ── Per-Work-Object sections ────────────────────────────────────────────
  const needsWorkObjectSection = options.includePhotos || options.includeInspections || options.includeNotes || options.includeAttachments || options.includeVideos
  if (needsWorkObjectSection) {
    for (const wo of workObjects) {
      const hasAnything =
        (options.includePhotos && wo.photos.length > 0) ||
        (options.includeInspections && wo.inspections.length > 0) ||
        (options.includeNotes && !!wo.markup.notes) ||
        (options.includeAttachments && wo.attachments.length > 0) ||
        (options.includeVideos && wo.videos.length > 0)
      if (!hasAnything) continue

      pdf.addPage('letter', 'portrait')
      let sy = MARGIN
      const m = wo.markup
      const typeLabel = m.workObjectType ? WORK_OBJECT_TYPE_MAP[m.workObjectType]?.label ?? m.tool : m.tool
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(...INK)
      pdf.text(`${typeLabel} — ${m.workId ?? m.id.slice(0, 10)}`, MARGIN, sy)
      sy += 18
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(100, 100, 100)
      const who = crewOrSubName(data, m.crewId, m.assignedSubcontractorId)
      const dateLabel = m.workDate ? formatDate(m.workDate) : formatDate(m.createdAt.slice(0, 10))
      pdf.text(`${who}  ·  ${dateLabel}  ·  ${MARKUP_STATUS_META[m.status]?.label ?? m.status}`, MARGIN, sy)
      sy += 22
      pdf.setDrawColor(220, 220, 220); pdf.setLineWidth(0.5)
      pdf.line(MARGIN, sy, pageW - MARGIN, sy)
      sy += 18

      if (options.includeNotes && m.notes) {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...INK)
        pdf.text('Notes', MARGIN, sy); sy += 12
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(60, 60, 60)
        const wrapped = pdf.splitTextToSize(m.notes, pageW - MARGIN * 2) as string[]
        pdf.text(wrapped, MARGIN, sy)
        sy += wrapped.length * 12 + 14
      }

      if (options.includeInspections && wo.inspections.length > 0) {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...INK)
        pdf.text('Inspections', MARGIN, sy); sy += 12
        for (const insp of wo.inspections) {
          if (sy > pageH - MARGIN - 40) { pdf.addPage('letter', 'portrait'); sy = MARGIN }
          const resultColor: [number, number, number] = insp.overallResult === 'pass' ? [34, 197, 94] : insp.overallResult === 'fail' ? [239, 68, 68] : [245, 158, 11]
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...resultColor)
          pdf.text(insp.overallResult.toUpperCase(), MARGIN, sy)
          pdf.setFont('helvetica', 'normal'); pdf.setTextColor(100, 100, 100)
          pdf.text(formatDate(insp.createdAt.slice(0, 10)), MARGIN + 50, sy)
          sy += 12
          for (const item of insp.items) {
            const itemColor: [number, number, number] = item.result === 'pass' ? [34, 197, 94] : item.result === 'fail' ? [239, 68, 68] : [150, 150, 150]
            pdf.setFontSize(8); pdf.setTextColor(...itemColor)
            // jsPDF's built-in Helvetica only supports WinAnsi encoding —
            // ✓/✗ (and any other non-WinAnsi glyph) silently render as
            // garbage characters, not the intended symbol. Plain ASCII tags
            // print correctly on every jsPDF setup, not just this test.
            pdf.text(`  [${item.result.toUpperCase()}] ${item.label}`, MARGIN, sy)
            sy += 11
          }
          sy += 6
        }
        sy += 8
      }

      if (options.includeAttachments && wo.attachments.length > 0) {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...INK)
        pdf.text('Attachments', MARGIN, sy); sy += 12
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(60, 60, 60)
        for (const att of wo.attachments) {
          pdf.text(`•  ${att.fileName}`, MARGIN, sy); sy += 12
        }
        sy += 8
      }

      if (options.includeVideos && wo.videos.length > 0) {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...INK)
        pdf.text('Videos (see in-app Documentation folder to view)', MARGIN, sy); sy += 12
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(60, 60, 60)
        for (const vid of wo.videos) {
          pdf.text(`•  ${vid.caption || formatDate(vid.takenAt.slice(0, 10))}`, MARGIN, sy); sy += 12
        }
        sy += 8
      }

      if (options.includePhotos && wo.photos.length > 0) {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...INK)
        pdf.text('Photos', MARGIN, sy); sy += 10
        const resolved = await Promise.all(wo.photos.map(async (p) => ({
          url: await resolveMarkupPhotoUrl(p.id),
          caption: [p.phase, p.caption].filter(Boolean).join(' — ') || null,
        })))
        await drawPhotoGrid(pdf, resolved, sy, pageW, pageH)
      }
    }
  }

  return pdf
}
