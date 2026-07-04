import type { jsPDF } from 'jspdf'
import type { MapCutBox } from '../../types'
import { rectCorners } from './geometry'
import { buildNorthArrowDataUrl } from './northArrow'

export interface TitleBlockParams {
  projectName: string
  sourceFileName: string
  sourcePageNumber: number
  sheetNum: number
  sheetTotal: number
  /** Feet-per-inch on the ORIGINAL, uncropped source page. The title block
   *  converts this into the correct effective scale for this specific
   *  (possibly magnified) cropped page before drawing the bar. Omitted
   *  entirely (no bar drawn) when not set — there is no auto-detected scale. */
  scaleFeetPerInch?: number
  /** The source page's true physical width, in PDF points (72/inch), from
   *  page.getViewport({scale:1}).width. */
  sourcePageWidthPt: number
  /** This page's source box, in the same 0-1 fraction space as MapCutBox. */
  box: MapCutBox
  /** Small downscaled image of the FULL source page, for the locator thumbnail. */
  sourceThumbnailDataUrl: string
  detectedTitle?: string
  notes?: string
  productionNotes?: string
  legendText?: string
}

const MARGIN = 18
const BAND_H = 112

/** Reserves a bottom strip of the page for the title block and returns the
 *  remaining rect available for the cropped map image above it. Callers draw
 *  the map image into this rect, then call drawTitleBlock for the band. */
export function mapImageArea(pageW: number, pageH: number) {
  return {
    x: MARGIN,
    y: MARGIN,
    width: pageW - MARGIN * 2,
    height: pageH - MARGIN * 2 - BAND_H - 8,
  }
}

function pickNiceRoundFeet(outputFeetPerInch: number, maxBarWidthPt: number): number {
  const maxFeet = (maxBarWidthPt / 72) * outputFeetPerInch
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000]
  let chosen = steps[0]
  for (const step of steps) {
    if (step <= maxFeet) chosen = step
    else break
  }
  return chosen
}

export function drawTitleBlock(pdf: jsPDF, p: TitleBlockParams, pageW: number, pageH: number): void {
  const bandY = pageH - MARGIN - BAND_H
  const bandW = pageW - MARGIN * 2

  pdf.setDrawColor(30, 41, 59)
  pdf.setLineWidth(0.75)
  pdf.rect(MARGIN, bandY, bandW, BAND_H)

  const col1X = MARGIN + 6
  const col1W = bandW * 0.42
  const col2X = MARGIN + bandW * 0.44
  const col2W = bandW * 0.32
  const col3X = MARGIN + bandW * 0.78
  const col3W = bandW * 0.22 - 6
  pdf.setLineWidth(0.4)
  pdf.line(col2X - 6, bandY + 4, col2X - 6, bandY + BAND_H - 4)
  pdf.line(col3X - 6, bandY + 4, col3X - 6, bandY + BAND_H - 4)

  // --- Column 1: project / source / sheet number / detected title ---
  let y = bandY + 15
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11)
  pdf.text(p.projectName, col1X, y, { maxWidth: col1W })
  y += 15
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(90, 90, 90)
  pdf.text(`${p.sourceFileName} — Page ${p.sourcePageNumber}`, col1X, y, { maxWidth: col1W })
  y += 12
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(0, 0, 0)
  pdf.text(`Sheet ${p.sheetNum} of ${p.sheetTotal}`, col1X, y)
  y += 13
  if (p.detectedTitle) {
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(7.5); pdf.setTextColor(60, 60, 60)
    pdf.text(p.detectedTitle, col1X, y, { maxWidth: col1W })
  }
  pdf.setTextColor(0, 0, 0)

  // --- Column 2: notes / production notes / legend ---
  let y2 = bandY + 13
  const writeBlock = (label: string, text: string | undefined) => {
    if (!text) return
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5)
    pdf.text(label.toUpperCase(), col2X, y2)
    y2 += 8
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7)
    const lines = pdf.splitTextToSize(text, col2W) as string[]
    const clipped = lines.slice(0, 3)
    pdf.text(clipped, col2X, y2)
    y2 += clipped.length * 8 + 4
  }
  writeBlock('Notes', p.notes)
  writeBlock('Production Notes', p.productionNotes)
  writeBlock('Legend', p.legendText)

  // --- Column 3: north arrow, scale bar, locator thumbnail ---
  const arrowSize = 24
  const arrowX = col3X + col3W - arrowSize
  const arrowY = bandY + 4
  pdf.addImage(buildNorthArrowDataUrl(), 'PNG', arrowX, arrowY, arrowSize, arrowSize)

  let scaleBarBottom = arrowY + arrowSize + 4
  if (p.scaleFeetPerInch) {
    const sourcePageWidthIn = p.sourcePageWidthPt / 72
    const boxRealWidthFt = p.box.width * sourcePageWidthIn * p.scaleFeetPerInch
    const imageAreaWidthIn = mapImageArea(pageW, pageH).width / 72
    const outputFeetPerInch = boxRealWidthFt / imageAreaWidthIn
    const maxBarWidthPt = col3W
    const niceFeet = pickNiceRoundFeet(outputFeetPerInch, maxBarWidthPt)
    const barWidthPt = (niceFeet / outputFeetPerInch) * 72

    const barY = scaleBarBottom + 6
    const barX = col3X
    pdf.setLineWidth(1)
    pdf.setDrawColor(0, 0, 0)
    pdf.line(barX, barY, barX + barWidthPt, barY)
    pdf.line(barX, barY - 2, barX, barY + 2)
    pdf.line(barX + barWidthPt, barY - 2, barX + barWidthPt, barY + 2)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5)
    pdf.text(`${niceFeet.toLocaleString()} ft`, barX, barY + 9)
    scaleBarBottom = barY + 12
  }

  // Locator thumbnail — full source page, shrunk, with a highlight box for this cut.
  const locY = scaleBarBottom + 4
  const locH = Math.min(bandY + BAND_H - 4 - locY, 34)
  if (locH > 10) {
    const locW = col3W
    pdf.addImage(p.sourceThumbnailDataUrl, 'JPEG', col3X, locY, locW, locH)
    pdf.setDrawColor(220, 38, 38)
    pdf.setLineWidth(1)
    const corners = rectCorners(p.box, p.box.rotation)
    const xs = corners.map(([x]) => x)
    const ys = corners.map(([, y]) => y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const hx = col3X + minX * locW
    const hy = locY + minY * locH
    const hw = Math.max(2, (maxX - minX) * locW)
    const hh = Math.max(2, (maxY - minY) * locH)
    pdf.rect(hx, hy, hw, hh)
  }

  pdf.setTextColor(0, 0, 0)
  pdf.setDrawColor(0, 0, 0)
}
