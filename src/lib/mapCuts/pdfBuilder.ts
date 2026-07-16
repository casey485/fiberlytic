import type { jsPDF as JsPDFType } from 'jspdf'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { MapCutPackage } from '../../types'
import { openPdfDocument, renderViewportRegion, isRenderCancelledError, type RenderRegionOpts } from './render'
import type { Rect } from './geometry'
import { drawTitleBlock } from './titleBlock'
import { outputPageDimsPt, computeBoxRenderGeometry, computeOutputImagePlacement } from './boxTransform'

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
      const lossless = pkg.losslessOutput ?? false
      const imageFormat = lossless ? 'PNG' : 'JPEG'

      let pdf: JsPDFType | null = null

      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i]
        const [wPt, hPt] = outputPageDimsPt(pkg, box)
        const orientation = wPt >= hPt ? 'landscape' : 'portrait'

        if (i === 0) {
          pdf = new jsPDF({ unit: 'pt', format: [wPt, hPt], orientation })
        } else {
          pdf!.addPage([wPt, hPt], orientation)
        }
        const pageW = pdf!.internal.pageSize.getWidth()
        const pageH = pdf!.internal.pageSize.getHeight()

        // Render this box's axis-aligned bounding box (in PDF points) directly from the
        // vector source at outputDpi, then rotate-crop the exact box out of that —
        // every box gets its own full-DPI vector-sourced render, never a shared raster.
        // Shared with the redline-sync inverse transform (PdfPrintMode.tsx) via
        // boxTransform.ts, so the two can never drift apart.
        const geom = computeBoxRenderGeometry(pkg, box, { w: pageWidthPt, h: pageHeightPt })

        const aabbCanvas = await renderRegionOnce(page, {
          scale: geom.renderScale,
          regionXPx: geom.aabbXPt * geom.renderScale,
          regionYPx: geom.aabbYPt * geom.renderScale,
          outputWidthPx: geom.aabbWPt * geom.renderScale,
          outputHeightPx: geom.aabbHPt * geom.renderScale,
        })

        const cropCanvas = cropRotatedRegion(aabbCanvas, geom.rectPxInAabb, box.rotation)
        const cropDataUrl = lossless ? cropCanvas.toDataURL('image/png') : cropCanvas.toDataURL('image/jpeg', 0.92)

        const { imgX, imgY, imgW, imgH } = computeOutputImagePlacement(pkg, box, geom.cropWidthPx, geom.cropHeightPx)
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
            box: { ...box, ...geom.expandedFrac },
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
