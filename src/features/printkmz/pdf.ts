import * as pdfjsLib from 'pdfjs-dist'
// Vite resolves this to a hashed URL for the worker bundle.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const DEFAULT_MAX_PAGES = 15

export interface RenderedPdf {
  pageCount: number
  /** High-res page images (JPEG data URLs) for OCR — kept in memory only. */
  images: string[]
  /** Downscaled previews for the UI / persistence. */
  thumbnails: string[]
}

function canvasToDataUrl(canvas: HTMLCanvasElement, quality: number) {
  return canvas.toDataURL('image/jpeg', quality)
}

/** The original (pre quality-DPI) render scale — width capped at 2000px,
 *  scale capped at 2.5x. Every 'pdfPage'-space FieldMarkup's geometry is raw
 *  pixel coordinates relative to a page rendered at this scale (see
 *  PdfPrintMode.tsx's toPagePt), so it must never change — see
 *  getPdfLogicalPageSizes below for why the *displayed* image can now use a
 *  different (higher) DPI without that meaning this formula also has to. */
export function legacyScale(baseViewport: { width: number }): number {
  const targetWidth = 2000
  return Math.min(2.5, targetWidth / baseViewport.width)
}

/**
 * Per-page pixel dimensions a page WOULD render at under the legacy formula
 * — computed straight from PDF viewport geometry, no canvas rasterization,
 * so it's cheap even for a big multi-sheet set. This is the fixed "logical"
 * coordinate space PdfPrintMode.tsx's SVG overlay and all markup math key
 * off of (its `naturalSize`) — kept independent of whatever DPI the actual
 * displayed/exported image uses, so raising that DPI for readability never
 * shifts where an existing redline's stored pixel coordinates land.
 */
export async function getPdfLogicalPageSizes(file: File, maxPages = DEFAULT_MAX_PAGES): Promise<{ w: number; h: number }[]> {
  const buffer = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise
  const pageCount = Math.min(doc.numPages, maxPages)
  const sizes: { w: number; h: number }[] = []
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = legacyScale(baseViewport)
    sizes.push({ w: Math.floor(baseViewport.width * scale), h: Math.floor(baseViewport.height * scale) })
    page.cleanup()
  }
  await doc.destroy()
  return sizes
}

/** One page-open, no rasterization — returns both the raw PDF-point page size
 *  and the legacy-formula naturalSize PdfPrintMode.tsx keys its markup
 *  geometry off of, for a single page. Used by the Map Cut redline-sync
 *  transform (src/lib/mapCuts/boxTransform.ts), which needs a cut piece's
 *  MASTER page's geometry without needing PdfPrintMode's own full page-array
 *  load (that page may not even be the one currently open). */
export async function getPdfPageGeometry(file: File, pageNumber1Based: number): Promise<{ pointSize: { w: number; h: number }; naturalSize: { w: number; h: number } }> {
  const buffer = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise
  try {
    const page = await doc.getPage(pageNumber1Based)
    try {
      const baseViewport = page.getViewport({ scale: 1 })
      const scale = legacyScale(baseViewport)
      return {
        pointSize: { w: baseViewport.width, h: baseViewport.height },
        naturalSize: { w: Math.floor(baseViewport.width * scale), h: Math.floor(baseViewport.height * scale) },
      }
    } finally {
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
}

export function downscale(source: HTMLCanvasElement, maxWidth: number): string {
  if (source.width <= maxWidth) return canvasToDataUrl(source, 0.6)
  const scale = maxWidth / source.width
  const c = document.createElement('canvas')
  c.width = maxWidth
  c.height = Math.round(source.height * scale)
  const ctx = c.getContext('2d')!
  ctx.drawImage(source, 0, 0, c.width, c.height)
  return canvasToDataUrl(c, 0.6)
}

/**
 * Render up to maxPages of a PDF to images, at the fixed legacy scale — cheap
 * enough to do for a whole multi-sheet set up front. PdfPrintMode.tsx layers
 * a lazy, cancelable per-page sharpen on top of this for whichever page is
 * actually on screen (see its own progressive re-render effect) rather than
 * paying a heavy render for every page here — an earlier attempt at raising
 * the DPI of *this* batch call made large multi-page print sets painfully
 * slow to open, since every page got the expensive render whether the user
 * ever looked at it or not.
 * @param onProgress called with (pageRendered, totalPages)
 * @param maxPages defaults to DEFAULT_MAX_PAGES — kept conservative for the OCR/
 *   auto-detect flow (GeoreferencePanel), which only ever uses page 1 anyway.
 *   Callers that render a whole plan set for viewing (e.g. PdfPrintMode) should
 *   pass a much higher limit since there's no OCR cost driving the cap there.
 */
export async function renderPdf(
  file: File,
  onProgress?: (page: number, total: number) => void,
  maxPages = DEFAULT_MAX_PAGES,
): Promise<RenderedPdf> {
  const buffer = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise
  const pageCount = Math.min(doc.numPages, maxPages)

  const images: string[] = []
  const thumbnails: string[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = legacyScale(baseViewport)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport }).promise

    images.push(canvasToDataUrl(canvas, 0.85))
    thumbnails.push(downscale(canvas, 480))
    onProgress?.(i, pageCount)

    // Release page resources.
    page.cleanup()
  }

  await doc.destroy()
  return { pageCount, images, thumbnails }
}
