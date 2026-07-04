import type { jsPDF as JsPDFType } from 'jspdf'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { MapCutBox, MapCutPackage } from '../../types'
import { openPdfDocument, renderViewportRegion, isRenderCancelledError, type RenderRegionOpts } from './render'
import { expandRect, rectCorners, type Rect } from './geometry'
import { mapImageArea, drawTitleBlock } from './titleBlock'

/** Browsers cap canvas dimensions around this (pdf.js hard-codes the same
 *  constant internally for its own oversized-page handling). A single box's
 *  bounding box, at very high DPI, can still exceed it on a large sheet —
 *  clamped per-box below rather than thrown as an error. */
const MAX_CANVAS_DIM = 16384

async function renderRegionOnce(page: PDFPageProxy, opts: RenderRegionOpts): Promise<HTMLCanvasElement> {
  const { canvas, promise } = renderViewportRegion(page, opts)
  try {
    await promise
    return canvas
  } catch (e) {
    if (isRenderCancelledError(e)) throw new Error('Rendering was interrupted — please try generating again.')
    throw e
  }
}

/** Crops a (possibly rotated) region out of a source canvas. Standard
 *  rotate-crop trick: translate to the destination canvas's own center,
 *  counter-rotate the context, then draw the FULL source canvas offset so the
 *  box's center in source-pixel space lands exactly on that translate point. */
function cropRotatedRegion(source: HTMLCanvasElement, rectPx: Rect, rotationDeg: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rectPx.width))
  canvas.height = Math.max(1, Math.round(rectPx.height))
  const ctx = canvas.getContext('2d')!
  const cx = rectPx.x + rectPx.width / 2
  const cy = rectPx.y + rectPx.height / 2
  ctx.translate(canvas.width / 2, canvas.height / 2)
  if (rotationDeg) ctx.rotate((-rotationDeg * Math.PI) / 180)
  ctx.drawImage(source, -cx, -cy)
  return canvas
}

/** Picks this output page's physical size in points. For the named sizes,
 *  orientation is chosen per-box to match the box's own aspect ratio (a wide,
 *  short cut gets a landscape sheet; a tall, narrow cut gets portrait) rather
 *  than forcing every sheet the same way. Custom size is used exactly as
 *  entered, no auto-flip. */
function pageDimsPt(pkg: MapCutPackage, box: MapCutBox): [number, number] {
  if (pkg.pageSize === 'custom') {
    const wIn = pkg.customWidthIn ?? 11
    const hIn = pkg.customHeightIn ?? 8.5
    return [wIn * 72, hIn * 72]
  }
  const longShortIn: Record<'11x17' | '8.5x11' | 'legal' | 'ansiC' | 'ansiD', [number, number]> = {
    '11x17': [17, 11], // = ANSI B
    '8.5x11': [11, 8.5],
    legal: [14, 8.5],
    ansiC: [22, 17],
    ansiD: [34, 22],
  }
  const [longIn, shortIn] = longShortIn[pkg.pageSize]
  const landscape = box.width >= box.height
  const [wIn, hIn] = landscape ? [longIn, shortIn] : [shortIn, longIn]
  return [wIn * 72, hIn * 72]
}

export interface BuildMapCutPdfResult {
  pdf: JsPDFType
  pageCount: number
}

/** Assembles the final multi-page field-print PDF: one page per box, each
 *  rendered DIRECTLY from the vector source PDF at the chosen output DPI
 *  (never cropped from a shared low-res raster), with rotation + overlap
 *  applied and a generated title block. Follows src/lib/fieldMapExport.ts's
 *  dynamic-import + unit:'pt' jsPDF pattern. */
export async function buildMapCutPdf(
  pkg: MapCutPackage,
  sourceFile: File,
  projectName: string,
): Promise<BuildMapCutPdfResult> {
  const boxes = [...pkg.boxes].sort((a, b) => a.order - b.order)
  if (boxes.length === 0) {
    throw new Error('Add at least one cut box before generating.')
  }

  const doc = await openPdfDocument(sourceFile)
  try {
    const page = await doc.getPage(pkg.sourcePageIndex)
    try {
      const baseViewport = page.getViewport({ scale: 1 })
      const pageWidthPt = baseViewport.width
      const pageHeightPt = baseViewport.height

      const thumbScale = 320 / pageWidthPt
      const thumbCanvas = await renderRegionOnce(page, {
        scale: thumbScale, regionXPx: 0, regionYPx: 0,
        outputWidthPx: pageWidthPt * thumbScale, outputHeightPx: pageHeightPt * thumbScale,
      })
      const thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.7)

      const { jsPDF } = await import('jspdf')
      const outputDpi = pkg.outputDpi ?? 300
      const lossless = pkg.losslessOutput ?? false
      const imageFormat = lossless ? 'PNG' : 'JPEG'

      let pdf: JsPDFType | null = null

      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i]
        const [wPt, hPt] = pageDimsPt(pkg, box)
        const orientation = wPt >= hPt ? 'landscape' : 'portrait'

        if (i === 0) {
          pdf = new jsPDF({ unit: 'pt', format: [wPt, hPt], orientation })
        } else {
          pdf!.addPage([wPt, hPt], orientation)
        }
        const pageW = pdf!.internal.pageSize.getWidth()
        const pageH = pdf!.internal.pageSize.getHeight()

        const expandedFrac = expandRect({ x: box.x, y: box.y, width: box.width, height: box.height }, pkg.overlapPct)

        // Render this box's axis-aligned bounding box (in PDF points) directly from the
        // vector source at outputDpi, then rotate-crop the exact box out of that —
        // every box gets its own full-DPI vector-sourced render, never a shared raster.
        const cornersPt = rectCorners(expandedFrac, box.rotation).map(([fx, fy]) => [fx * pageWidthPt, fy * pageHeightPt])
        const xs = cornersPt.map(([x]) => x)
        const ys = cornersPt.map(([, y]) => y)
        const aabbXPt = Math.min(...xs)
        const aabbYPt = Math.min(...ys)
        const aabbWPt = Math.max(...xs) - aabbXPt
        const aabbHPt = Math.max(...ys) - aabbYPt

        let renderScale = outputDpi / 72
        const maxDim = Math.max(aabbWPt, aabbHPt) * renderScale
        if (maxDim > MAX_CANVAS_DIM) renderScale *= MAX_CANVAS_DIM / maxDim

        const aabbCanvas = await renderRegionOnce(page, {
          scale: renderScale,
          regionXPx: aabbXPt * renderScale,
          regionYPx: aabbYPt * renderScale,
          outputWidthPx: aabbWPt * renderScale,
          outputHeightPx: aabbHPt * renderScale,
        })

        const rectPxInAabb: Rect = {
          x: (expandedFrac.x * pageWidthPt - aabbXPt) * renderScale,
          y: (expandedFrac.y * pageHeightPt - aabbYPt) * renderScale,
          width: expandedFrac.width * pageWidthPt * renderScale,
          height: expandedFrac.height * pageHeightPt * renderScale,
        }
        const cropCanvas = cropRotatedRegion(aabbCanvas, rectPxInAabb, box.rotation)
        const cropDataUrl = lossless ? cropCanvas.toDataURL('image/png') : cropCanvas.toDataURL('image/jpeg', 0.92)

        const area = mapImageArea(pageW, pageH)
        const cropRatio = cropCanvas.width / cropCanvas.height
        const areaRatio = area.width / area.height
        let imgW: number, imgH: number
        if (cropRatio > areaRatio) {
          imgW = area.width
          imgH = area.width / cropRatio
        } else {
          imgH = area.height
          imgW = area.height * cropRatio
        }
        const imgX = area.x + (area.width - imgW) / 2
        const imgY = area.y + (area.height - imgH) / 2
        pdf!.addImage(cropDataUrl, imageFormat, imgX, imgY, imgW, imgH)

        drawTitleBlock(
          pdf!,
          {
            projectName,
            sourceFileName: pkg.sourceFileName,
            sourcePageNumber: pkg.sourcePageIndex,
            sheetNum: box.order,
            sheetTotal: boxes.length,
            scaleFeetPerInch: pkg.scaleFeetPerInch,
            sourcePageWidthPt: pageWidthPt,
            box: { ...box, ...expandedFrac },
            sourceThumbnailDataUrl: thumbnailDataUrl,
            detectedTitle: pkg.detectedTitle,
            notes: pkg.notes,
            productionNotes: pkg.productionNotes,
          },
          pageW,
          pageH,
        )
      }

      return { pdf: pdf!, pageCount: boxes.length }
    } finally {
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
}
