// ---------------------------------------------------------------------------
// Renders an uploaded PDF or image file to one raster per page for Map
// Reading. Reuses the same low-level pdfjs-dist primitives Map Cuts already
// wraps (openPdfDocument/renderViewportRegion/isRenderCancelledError from
// src/lib/mapCuts/render.ts) — these are pure, mode-agnostic PDF rendering
// utilities with zero Map-Cut-specific business logic (no MapCutBox/cutStyle
// awareness), the same category of sharing already established as safe
// (alongside usePdfPage.ts) when Grid Cut was isolated from Manual Cut.
//
// Deliberately does NOT reuse src/features/printkmz/pdf.ts's renderPdf() —
// that's also live code (used by GeoreferencePanel.tsx), but its raster is a
// fixed ~2000px-wide/2.5x-scale cap regardless of source size, too low-
// resolution for small footage callouts like "245'". This renders at a fixed
// ~300 DPI instead.
// ---------------------------------------------------------------------------

import { openPdfDocument, renderViewportRegion, isRenderCancelledError } from '../mapCuts/render'

const OCR_DPI = 300

export interface RenderedPage {
  canvas: HTMLCanvasElement
  naturalWidth: number
  naturalHeight: number
}

/** Renders every page of a PDF file at a fixed ~300 DPI — high enough for OCR
 *  on small printed labels. A cut page from Map Cut is already a single small
 *  sheet (not an oversized plan), so this stays a reasonable canvas size. */
export async function renderPdfPages(file: File): Promise<RenderedPage[]> {
  const doc = await openPdfDocument(file)
  try {
    const pages: RenderedPage[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const baseViewport = page.getViewport({ scale: 1 })
      const scale = OCR_DPI / 72
      const outputWidthPx = baseViewport.width * scale
      const outputHeightPx = baseViewport.height * scale
      const handle = renderViewportRegion(page, { scale, regionXPx: 0, regionYPx: 0, outputWidthPx, outputHeightPx })
      try {
        await handle.promise
      } catch (e) {
        if (!isRenderCancelledError(e)) throw e
      }
      pages.push({ canvas: handle.canvas, naturalWidth: handle.canvas.width, naturalHeight: handle.canvas.height })
    }
    return pages
  } finally {
    await doc.destroy()
  }
}

/** Loads a plain image file (PNG/JPG/JPEG) onto a canvas, unchanged — treated
 *  as a single page. */
export async function renderImageFile(file: File): Promise<RenderedPage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read image file'))
    reader.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Failed to load image'))
    el.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(img, 0, 0)
  return { canvas, naturalWidth: canvas.width, naturalHeight: canvas.height }
}

export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', 0.9)
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

export function isImageFile(file: File): boolean {
  return /^image\/(png|jpe?g)$/i.test(file.type) || /\.(png|jpe?g)$/i.test(file.name)
}
