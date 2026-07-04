import * as pdfjsLib from 'pdfjs-dist'
// Vite resolves this to a hashed URL for the worker bundle.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const MAX_PAGES = 15

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
 * Render up to MAX_PAGES of a PDF to images.
 * @param onProgress called with (pageRendered, totalPages)
 */
export async function renderPdf(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<RenderedPdf> {
  const buffer = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise
  const pageCount = Math.min(doc.numPages, MAX_PAGES)

  const images: string[] = []
  const thumbnails: string[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    // Scale ~2x for legible OCR; clamp very large sheets so we don't blow memory.
    const baseViewport = page.getViewport({ scale: 1 })
    const targetWidth = 2000
    const scale = Math.min(2.5, targetWidth / baseViewport.width)
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
