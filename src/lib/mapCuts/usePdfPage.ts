import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { openPdfDocument, renderViewportRegion, isRenderCancelledError, type RenderRegionOpts } from './render'

export type PdfPageStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface UsePdfPageResult {
  page: PDFPageProxy | null
  pageWidthPt: number
  pageHeightPt: number
  status: PdfPageStatus
  error?: string
  /** Renders a region and resolves the fresh canvas, or null if this specific
   *  render was superseded/canceled before finishing (never surfaced as an error). */
  renderRegion: (opts: RenderRegionOpts) => Promise<HTMLCanvasElement | null>
}

/** Owns a pdf.js document+page's lifecycle for as long as a component needs to
 *  re-render arbitrary regions of it on demand (pan/zoom, Generate) — opened
 *  once per [file, pageIndex], not per render call. */
export function usePdfPage(file: File | null, pageIndex: number): UsePdfPageResult {
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 })
  const [status, setStatus] = useState<PdfPageStatus>('idle')
  const [error, setError] = useState<string | undefined>(undefined)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const taskRef = useRef<RenderTask | null>(null)

  useEffect(() => {
    if (!file) {
      setPage(null)
      setPageSize({ w: 0, h: 0 })
      setStatus('idle')
      return
    }
    let cancelled = false
    setStatus('loading')
    setError(undefined)
    setPage(null)

    openPdfDocument(file)
      .then(async (doc) => {
        if (cancelled) { await doc.destroy(); return }
        docRef.current = doc
        const p = await doc.getPage(pageIndex)
        if (cancelled) return // doc.destroy() below (via cleanup) releases this page too
        const vp = p.getViewport({ scale: 1 })
        setPageSize({ w: vp.width, h: vp.height })
        setPage(p)
        setStatus('ready')
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to open PDF page')
        setStatus('error')
      })

    return () => {
      cancelled = true
      taskRef.current?.cancel()
      taskRef.current = null
      const doc = docRef.current
      docRef.current = null
      doc?.destroy()
    }
  }, [file, pageIndex])

  const renderRegion = useCallback(
    async (opts: RenderRegionOpts): Promise<HTMLCanvasElement | null> => {
      if (!page) return null
      taskRef.current?.cancel()
      const handle = renderViewportRegion(page, opts)
      taskRef.current = handle.renderTask
      try {
        await handle.promise
        if (taskRef.current === handle.renderTask) taskRef.current = null
        return handle.canvas
      } catch (e) {
        if (isRenderCancelledError(e)) return null
        throw e
      }
    },
    [page],
  )

  return { page, pageWidthPt: pageSize.w, pageHeightPt: pageSize.h, status, error, renderRegion }
}
