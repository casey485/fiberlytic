import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, Square, Loader2 } from 'lucide-react'
import type { MapCutBox } from '../../types'
import { usePdfPage } from '../../lib/mapCuts/usePdfPage'
import { isTypingTarget } from '../../lib/domGuards'
import { BoxEditor } from './BoxEditor'

const ZOOM_PRESETS = [25, 50, 75, 100, 125, 150, 200, 300, 400, 600, 800, 1000, 1200, 1600]
const MIN_ZOOM = 25
const MAX_ZOOM = 1600
const RENDER_DEBOUNCE_MS = 130

interface PdfViewportProps {
  file: File
  pageIndex: number
  boxes: MapCutBox[]
  onBoxesChange: (boxes: MapCutBox[]) => void
}

interface PdfPoint { x: number; y: number }
interface Transform { scale: number; panPt: PdfPoint }

/** Renders exactly the visible region of a PDF page at the exact resolution
 *  needed for the current zoom — never a fixed-size whole-page raster — so
 *  text stays crisp at any zoom from 25% to 1600%. A pan/zoom gesture first
 *  applies a cheap CSS transform to the last crisp render for instant
 *  feedback, then triggers a fresh pdf.js render of the new region once the
 *  gesture settles (~130ms), matching how real PDF viewers stay smooth
 *  without re-rendering on every pointermove. */
export function PdfViewport({ file, pageIndex, boxes, onBoxesChange }: PdfViewportProps) {
  const { page, pageWidthPt, pageHeightPt, status, error, renderRegion } = usePdfPage(file, pageIndex)

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })

  const [zoomPercent, setZoomPercent] = useState(100)
  const [panPt, setPanPt] = useState<PdfPoint>({ x: 0, y: 0 })
  const [drawArmed, setDrawArmed] = useState(false)
  const [spacePanning, setSpacePanning] = useState(false)
  const hoveringRef = useRef(false)

  const [displayCanvas, setDisplayCanvas] = useState<HTMLCanvasElement | null>(null)
  const displayTransformRef = useRef<Transform>({ scale: 1, panPt: { x: 0, y: 0 } })
  const [cssTransform, setCssTransform] = useState('none')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initializedRef = useRef(false)

  const scale = zoomPercent / 100

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) setContainerSize({ w: box.width, h: box.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A new source file/page invalidates any previous fit-to-width framing.
  useEffect(() => { initializedRef.current = false }, [file, pageIndex])

  const doRender = useCallback(
    async (targetScale: number, targetPan: PdfPoint, w: number, h: number) => {
      if (!page || w <= 0 || h <= 0) return
      const dpr = window.devicePixelRatio || 1
      const renderScale = targetScale * dpr
      const canvas = await renderRegion({
        scale: renderScale,
        regionXPx: targetPan.x * renderScale,
        regionYPx: targetPan.y * renderScale,
        outputWidthPx: w * dpr,
        outputHeightPx: h * dpr,
      })
      if (!canvas) return // superseded by a newer render — ignore, not an error
      setDisplayCanvas(canvas)
      displayTransformRef.current = { scale: targetScale, panPt: targetPan }
      setCssTransform('none')
    },
    [page, renderRegion],
  )

  // Fit the page to the container width the first time both are known, then render immediately.
  useEffect(() => {
    if (initializedRef.current || !pageWidthPt || !containerSize.w) return
    const fitScale = containerSize.w / pageWidthPt
    const fitZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitScale * 100))
    initializedRef.current = true
    setZoomPercent(fitZoom)
    setPanPt({ x: 0, y: 0 })
    doRender(fitZoom / 100, { x: 0, y: 0 }, containerSize.w, containerSize.h)
  }, [pageWidthPt, containerSize.w, containerSize.h, doRender])

  // Container resize after the initial fit — immediate re-render, not debounced.
  const prevSizeRef = useRef(containerSize)
  useEffect(() => {
    if (!initializedRef.current) return
    if (prevSizeRef.current.w === containerSize.w && prevSizeRef.current.h === containerSize.h) return
    prevSizeRef.current = containerSize
    doRender(scale, panPt, containerSize.w, containerSize.h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerSize.w, containerSize.h])

  function scheduleRender(nextScale: number, nextPan: PdfPoint) {
    const d = displayTransformRef.current
    const cssScale = nextScale / d.scale
    const tx = nextScale * (d.panPt.x - nextPan.x)
    const ty = nextScale * (d.panPt.y - nextPan.y)
    setCssTransform(`translate(${tx}px, ${ty}px) scale(${cssScale})`)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      doRender(nextScale, nextPan, containerSize.w, containerSize.h)
    }, RENDER_DEBOUNCE_MS)
  }

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function setZoom(nextPercent: number, anchorClient?: { x: number; y: number }) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextPercent))
    const nextScale = clamped / 100
    let nextPan = panPt
    if (anchorClient && containerRef.current) {
      const r = containerRef.current.getBoundingClientRect()
      const cx = anchorClient.x - r.left
      const cy = anchorClient.y - r.top
      const pdfUnderCursor = { x: panPt.x + cx / scale, y: panPt.y + cy / scale }
      nextPan = { x: pdfUnderCursor.x - cx / nextScale, y: pdfUnderCursor.y - cy / nextScale }
      setPanPt(nextPan)
    }
    setZoomPercent(clamped)
    scheduleRender(nextScale, nextPan)
  }

  function applyPanDelta(dxPt: number, dyPt: number) {
    setPanPt((prev) => {
      const next = { x: prev.x - dxPt, y: prev.y - dyPt }
      scheduleRender(scale, next)
      return next
    })
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.0015)
      setZoom(zoomPercent * factor, { x: e.clientX, y: e.clientY })
    } else {
      applyPanDelta(-e.deltaX / scale, -e.deltaY / scale)
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    const next = ZOOM_PRESETS.find((p) => p > zoomPercent + 0.01) ?? MAX_ZOOM
    setZoom(next, { x: e.clientX, y: e.clientY })
  }

  // Space-bar hold pans regardless of the Draw Box tool, scoped to while hovering the
  // viewer and never while typing elsewhere on the page (e.g. the Notes textarea).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space' || !hoveringRef.current || isTypingTarget(e.target)) return
      e.preventDefault()
      setSpacePanning(true)
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') setSpacePanning(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const effectiveDrawArmed = drawArmed && !spacePanning
  const zoomIndex = ZOOM_PRESETS.findIndex((p) => p >= Math.round(zoomPercent))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDrawArmed((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
            effectiveDrawArmed ? 'border-brand-500 bg-brand-900/30 text-brand-300' : 'border-[#2a2a2a] text-slate-400 hover:text-slate-200'
          }`}
        >
          <Square size={13} /> {effectiveDrawArmed ? 'Click + drag to draw a box…' : 'Draw Box'}
        </button>
        <p className="text-xs text-slate-500">Click + drag to pan &middot; hold Space to pan anytime</p>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setZoom(ZOOM_PRESETS[Math.max(0, zoomIndex - 1)] ?? MIN_ZOOM)} className="rounded p-1 text-slate-400 hover:text-slate-200">
            <ZoomOut size={15} />
          </button>
          <select
            value={ZOOM_PRESETS.includes(Math.round(zoomPercent)) ? Math.round(zoomPercent) : ''}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="rounded border border-[#2a2a2a] bg-[#1a1a1a] px-2 py-1 text-xs text-slate-200"
          >
            {!ZOOM_PRESETS.includes(Math.round(zoomPercent)) && <option value="">{Math.round(zoomPercent)}%</option>}
            {ZOOM_PRESETS.map((p) => (
              <option key={p} value={p}>{p}%</option>
            ))}
          </select>
          <button type="button" onClick={() => setZoom(ZOOM_PRESETS[Math.min(ZOOM_PRESETS.length - 1, zoomIndex + 1)] ?? MAX_ZOOM)} className="rounded p-1 text-slate-400 hover:text-slate-200">
            <ZoomIn size={15} />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative h-[560px] w-full overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#0a0a0a]"
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onPointerEnter={() => { hoveringRef.current = true }}
        onPointerLeave={() => { hoveringRef.current = false }}
      >
        {status === 'error' ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-rose-400">{error}</div>
        ) : status === 'loading' || !displayCanvas ? (
          <div className="flex h-full items-center justify-center text-slate-500">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : (
          <>
            <div className="absolute inset-0" style={{ transform: cssTransform, transformOrigin: '0 0' }}>
              <CanvasHost canvas={displayCanvas} />
            </div>
            <BoxEditor
              pageWidthPt={pageWidthPt}
              pageHeightPt={pageHeightPt}
              scale={scale}
              panPt={panPt}
              containerWidthCss={containerSize.w}
              containerHeightCss={containerSize.h}
              boxes={boxes}
              onBoxesChange={onBoxesChange}
              drawArmed={effectiveDrawArmed}
              onBoxDrawn={() => setDrawArmed(false)}
              onPanDelta={applyPanDelta}
            />
          </>
        )}
      </div>
    </div>
  )
}

/** Hosts a raw <canvas> element (produced by pdf.js render calls, not React)
 *  inside the React tree without React trying to own its children/attrs. */
function CanvasHost({ canvas }: { canvas: HTMLCanvasElement }) {
  const hostRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    host.replaceChildren(canvas)
  }, [canvas])
  return <div ref={hostRef} className="h-full w-full" />
}
