import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
// Vite resolves this to a hashed URL for the worker bundle.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/** Cheap page-count probe — doesn't render anything. */
export async function getPdfPageCount(file: File): Promise<number> {
  const buffer = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise
  try {
    return doc.numPages
  } finally {
    await doc.destroy()
  }
}

export async function openPdfDocument(file: File): Promise<PDFDocumentProxy> {
  const buffer = await file.arrayBuffer()
  return pdfjsLib.getDocument({ data: buffer }).promise
}

export interface RenderRegionOpts {
  /** Output device-pixels per PDF point (72/inch). */
  scale: number
  /** Top-left of the region to render, in the SAME already-scaled pixel space as `scale`. */
  regionXPx: number
  regionYPx: number
  outputWidthPx: number
  outputHeightPx: number
}

export interface RegionRenderHandle {
  canvas: HTMLCanvasElement
  renderTask: RenderTask
  promise: Promise<void>
}

/** The one rendering primitive Map Cuts needs: render an arbitrary rectangular
 *  region of a page at an arbitrary scale, straight from the vector PDF — never
 *  a fixed-resolution whole-page raster. Confirmed via pdfjs-dist's own
 *  PageViewport constructor that offsetX/offsetY are applied in the same
 *  already-scaled pixel space as the rest of the transform, so this is a
 *  direct capability, not a workaround. Reused for the interactive viewport,
 *  the locator thumbnail, and full-DPI per-box Generate renders alike — none
 *  of them need more than "this rectangle, at this scale."
 *
 *  Callers own cancellation: keep the returned `renderTask`, call `.cancel()`
 *  on it before starting a replacement render. A canceled render's `promise`
 *  rejects with `pdfjsLib.RenderingCancelledException` — callers should catch
 *  and silently ignore that specific error, never surface it as a failure. */
export function renderViewportRegion(page: PDFPageProxy, opts: RenderRegionOpts): RegionRenderHandle {
  const viewport = page.getViewport({ scale: opts.scale, offsetX: -opts.regionXPx, offsetY: -opts.regionYPx })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(opts.outputWidthPx))
  canvas.height = Math.max(1, Math.round(opts.outputHeightPx))
  const ctx = canvas.getContext('2d')!
  const renderTask = page.render({ canvasContext: ctx, viewport })
  return { canvas, renderTask, promise: renderTask.promise }
}

export function isRenderCancelledError(err: unknown): boolean {
  return err instanceof pdfjsLib.RenderingCancelledException
}
