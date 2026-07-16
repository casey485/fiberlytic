import { useRef, useState } from 'react'
import { ArrowUp, ArrowDown, Trash2, RotateCw } from 'lucide-react'
import type { MapCutBox } from '../../types'
import { expandRect, fracToPixelRect, pixelToFracRect, rotatePoint, computeSnap, snapRotation, type Rect } from '../../lib/mapCuts/geometry'

interface PdfPoint { x: number; y: number }

/** Another phase's finalized boxes, rendered underneath the active phase's
 *  own (interactive) boxes as a non-interactive, color-coded ghost — no
 *  resize/rotate handles, just an outline + label so the user can see what's
 *  already claimed elsewhere while drawing the current phase. */
export interface GhostPhaseBoxes {
  color: string
  label: string
  boxes: MapCutBox[]
}

interface BoxEditorProps {
  /** The source page's true physical size, in PDF points — the coordinate
   *  space every box, handle, and pointer calculation below operates in. */
  pageWidthPt: number
  pageHeightPt: number
  /** Live viewport transform from the parent PdfViewport: CSS px per PDF pt,
   *  and the PDF-point currently at the container's top-left. */
  scale: number
  panPt: PdfPoint
  containerWidthCss: number
  containerHeightCss: number
  boxes: MapCutBox[]
  onBoxesChange: (boxes: MapCutBox[]) => void
  /** 0-30. Purely a preview — draws a dashed outline of expandRect(box,
   *  overlapPct) around every box so the Overlap slider has visible
   *  on-screen feedback. The actual overlap is applied later, at generate
   *  time, by pdfBuilder.ts via this same expandRect. */
  overlapPct: number
  /** This phase's own highlight color (phaseColor(pkg.phaseNumber)) — used
   *  for its own boxes instead of a fixed green, so the active phase is
   *  visually distinct from every other phase's ghosted boxes below, which
   *  are drawn in their own phase colors. */
  activeColor: string
  /** Other phases in this print's phase family, drawn as read-only ghosts. */
  otherPhaseBoxes?: GhostPhaseBoxes[]
  /** True while the "Draw Box" tool is armed — background drag draws a new
   *  box instead of panning. Auto-disarms itself via onBoxDrawn once one box
   *  is committed, matching this app's existing draw-tool convention
   *  (KmzMap.tsx/PdfPrintMode.tsx auto-revert to Select after one shape). */
  drawArmed: boolean
  onBoxDrawn: () => void
  /** Reports incremental pan deltas (in PDF points) while dragging the
   *  background with Draw Box NOT armed — PdfViewport owns the authoritative
   *  pan state and re-renders; this component never re-renders the canvas itself. */
  onPanDelta: (dxPt: number, dyPt: number) => void
}

type Corner = 'nw' | 'ne' | 'se' | 'sw'

type DragState =
  | { kind: 'pan'; lastClient: [number, number] }
  | { kind: 'draw'; start: [number, number]; current: [number, number] }
  | { kind: 'move'; boxId: string; startPt: [number, number]; startRect: Rect }
  | { kind: 'resize'; boxId: string; corner: Corner; startRect: Rect; rotation: number }
  | { kind: 'rotate'; boxId: string; center: [number, number] }

let idCounter = 0
function newBoxId(): string {
  idCounter += 1
  return `mcb-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

/** Keeps MapCutBox.order in exact sync with array position — the single
 *  source of truth for sequencing is always "array index + 1"; `order` is a
 *  denormalized convenience field pdfBuilder.ts sorts by. */
function reindex(boxes: MapCutBox[]): MapCutBox[] {
  return boxes.map((b, i) => ({ ...b, order: i + 1 }))
}

function resizeRotatedRect(rect: Rect, rotationDeg: number, corner: Corner, pointerPt: [number, number]): Rect {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const [lx, ly] = rotatePoint(pointerPt[0], pointerPt[1], cx, cy, -rotationDeg)
  const oppX = corner.includes('w') ? rect.x + rect.width : rect.x
  const oppY = corner.includes('n') ? rect.y + rect.height : rect.y
  const newX = Math.min(lx, oppX)
  const newY = Math.min(ly, oppY)
  const newW = Math.max(8, Math.abs(lx - oppX))
  const newH = Math.max(8, Math.abs(ly - oppY))
  const [newCx, newCy] = rotatePoint(newX + newW / 2, newY + newH / 2, cx, cy, rotationDeg)
  return { x: newCx - newW / 2, y: newCy - newH / 2, width: newW, height: newH }
}

function rotationFromPointer(cx: number, cy: number, pointerPt: [number, number]): number {
  const dx = pointerPt[0] - cx
  const dy = pointerPt[1] - cy
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90
  return snapRotation(((deg % 360) + 360) % 360)
}

export function BoxEditor({
  pageWidthPt, pageHeightPt, scale, panPt, containerWidthCss, containerHeightCss,
  boxes, onBoxesChange, overlapPct, activeColor, otherPhaseBoxes, drawArmed, onBoxDrawn, onPanDelta,
}: BoxEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [, forceRender] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Sized in PDF points so they read as a CONSTANT on-screen size at every
  // zoom level (the SVG viewBox now spans a live, zoom-dependent window
  // instead of the fixed whole-page box these used to be fractions of).
  const handleR = 8 / scale
  const snapThreshold = 10 / scale
  const strokeW = 1.5 / scale
  const labelSize = 13 / scale
  const rotateHandleOffset = handleR * 4

  function toPagePt(clientX: number, clientY: number): [number, number] {
    const svg = svgRef.current
    if (!svg) return [0, 0]
    const r = svg.getBoundingClientRect()
    return [panPt.x + (clientX - r.left) / scale, panPt.y + (clientY - r.top) / scale]
  }

  function setBoxes(next: MapCutBox[]) {
    onBoxesChange(reindex(next))
  }

  function updateBox(id: string, rect: Rect, rotation?: number) {
    const frac = pixelToFracRect(rect, pageWidthPt, pageHeightPt)
    setBoxes(boxes.map((b) => (b.id === id ? { ...b, ...frac, rotation: rotation ?? b.rotation } : b)))
  }

  // --- Pointer handlers -----------------------------------------------------

  function onBackgroundPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.target !== e.currentTarget) return // clicks on a box/handle are handled by their own onPointerDown
    e.currentTarget.setPointerCapture(e.pointerId)
    if (drawArmed) {
      const pt = toPagePt(e.clientX, e.clientY)
      dragRef.current = { kind: 'draw', start: pt, current: pt }
      setSelectedId(null)
    } else {
      dragRef.current = { kind: 'pan', lastClient: [e.clientX, e.clientY] }
    }
    forceRender((n) => n + 1)
  }

  function onBoxPointerDown(e: React.PointerEvent, box: MapCutBox) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelectedId(box.id)
    const rectPx = fracToPixelRect(box, pageWidthPt, pageHeightPt)
    dragRef.current = { kind: 'move', boxId: box.id, startPt: toPagePt(e.clientX, e.clientY), startRect: rectPx }
  }

  function onCornerPointerDown(e: React.PointerEvent, box: MapCutBox, corner: Corner) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const rectPx = fracToPixelRect(box, pageWidthPt, pageHeightPt)
    dragRef.current = { kind: 'resize', boxId: box.id, corner, startRect: rectPx, rotation: box.rotation }
  }

  function onRotatePointerDown(e: React.PointerEvent, box: MapCutBox) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const rectPx = fracToPixelRect(box, pageWidthPt, pageHeightPt)
    const center: [number, number] = [rectPx.x + rectPx.width / 2, rectPx.y + rectPx.height / 2]
    dragRef.current = { kind: 'rotate', boxId: box.id, center }
  }

  function onSvgPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag) return

    if (drag.kind === 'pan') {
      const dxPt = (e.clientX - drag.lastClient[0]) / scale
      const dyPt = (e.clientY - drag.lastClient[1]) / scale
      onPanDelta(dxPt, dyPt)
      dragRef.current = { ...drag, lastClient: [e.clientX, e.clientY] }
      return
    }

    const pt = toPagePt(e.clientX, e.clientY)

    if (drag.kind === 'draw') {
      dragRef.current = { ...drag, current: pt }
      forceRender((n) => n + 1)
      return
    }
    if (drag.kind === 'move') {
      const dx = pt[0] - drag.startPt[0]
      const dy = pt[1] - drag.startPt[1]
      let next: Rect = { ...drag.startRect, x: drag.startRect.x + dx, y: drag.startRect.y + dy }
      const box = boxes.find((b) => b.id === drag.boxId)
      if (box && box.rotation === 0) {
        const others = boxes.filter((b) => b.id !== drag.boxId && b.rotation === 0).map((b) => fracToPixelRect(b, pageWidthPt, pageHeightPt))
        const snapped = computeSnap(next, others, snapThreshold)
        next = { ...next, x: snapped.x, y: snapped.y }
      }
      updateBox(drag.boxId, next)
      return
    }
    if (drag.kind === 'resize') {
      const next = resizeRotatedRect(drag.startRect, drag.rotation, drag.corner, pt)
      updateBox(drag.boxId, next)
      return
    }
    if (drag.kind === 'rotate') {
      const box = boxes.find((b) => b.id === drag.boxId)
      if (!box) return
      const rectPx = fracToPixelRect(box, pageWidthPt, pageHeightPt)
      const rotation = rotationFromPointer(drag.center[0], drag.center[1], pt)
      updateBox(drag.boxId, rectPx, rotation)
    }
  }

  function onSvgPointerUp(e: React.PointerEvent) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return

    if (drag.kind === 'draw') {
      const [sx, sy] = drag.start
      const [ex, ey] = drag.current
      const rectPx: Rect = { x: Math.min(sx, ex), y: Math.min(sy, ey), width: Math.abs(ex - sx), height: Math.abs(ey - sy) }
      const minSizePt = 12 / scale
      if (rectPx.width < minSizePt || rectPx.height < minSizePt) { forceRender((n) => n + 1); return } // too small — a stray click, not a new box
      const frac = pixelToFracRect(rectPx, pageWidthPt, pageHeightPt)
      const box: MapCutBox = { id: newBoxId(), ...frac, rotation: 0, order: boxes.length + 1 }
      setBoxes([...boxes, box])
      setSelectedId(box.id)
      onBoxDrawn()
    }
    forceRender((n) => n + 1)
  }

  // --- List actions ----------------------------------------------------------

  function deleteBox(id: string) {
    setBoxes(boxes.filter((b) => b.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  function moveInList(id: string, dir: -1 | 1) {
    const idx = boxes.findIndex((b) => b.id === id)
    const swapIdx = idx + dir
    if (idx < 0 || swapIdx < 0 || swapIdx >= boxes.length) return
    const next = [...boxes]
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    setBoxes(next)
  }

  const drawPreview = dragRef.current?.kind === 'draw' ? dragRef.current : null
  const viewBoxW = containerWidthCss / scale
  const viewBoxH = containerHeightCss / scale
  const cursor = drawArmed ? 'crosshair' : dragRef.current?.kind === 'pan' ? 'grabbing' : 'grab'

  return (
    <div className="pointer-events-none absolute inset-0">
      <svg
        ref={svgRef}
        viewBox={`${panPt.x} ${panPt.y} ${viewBoxW} ${viewBoxH}`}
        preserveAspectRatio="none"
        className="pointer-events-auto absolute inset-0 h-full w-full touch-none"
        style={{ cursor }}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onSvgPointerMove}
        onPointerUp={onSvgPointerUp}
      >
        {otherPhaseBoxes?.map((phase) => (
          <g key={phase.label} style={{ pointerEvents: 'none' }}>
            {phase.boxes.map((box) => {
              const rectPx = fracToPixelRect(box, pageWidthPt, pageHeightPt)
              const cx = rectPx.x + rectPx.width / 2
              const cy = rectPx.y + rectPx.height / 2
              return (
                <g key={box.id} transform={box.rotation ? `rotate(${box.rotation} ${cx} ${cy})` : undefined}>
                  <rect
                    x={rectPx.x} y={rectPx.y} width={rectPx.width} height={rectPx.height}
                    fill={phase.color} fillOpacity={0.1} stroke={phase.color} strokeWidth={strokeW}
                  />
                  <text
                    x={rectPx.x + handleR * 0.6} y={rectPx.y + labelSize * 1.1}
                    fontSize={labelSize * 0.85} fontWeight={700} fill={phase.color}
                    style={{ paintOrder: 'stroke', stroke: '#0a0a0a', strokeWidth: strokeW * 2 }}
                  >
                    {phase.label}
                  </text>
                </g>
              )
            })}
          </g>
        ))}
        {boxes.map((box) => {
          const rectPx = fracToPixelRect(box, pageWidthPt, pageHeightPt)
          const cx = rectPx.x + rectPx.width / 2
          const cy = rectPx.y + rectPx.height / 2
          const isSelected = box.id === selectedId
          const corners: { key: Corner; x: number; y: number }[] = [
            { key: 'nw', x: rectPx.x, y: rectPx.y },
            { key: 'ne', x: rectPx.x + rectPx.width, y: rectPx.y },
            { key: 'se', x: rectPx.x + rectPx.width, y: rectPx.y + rectPx.height },
            { key: 'sw', x: rectPx.x, y: rectPx.y + rectPx.height },
          ]
          return (
            <g key={box.id} transform={box.rotation ? `rotate(${box.rotation} ${cx} ${cy})` : undefined}>
              {overlapPct > 0 && (() => {
                const expandedPx = fracToPixelRect(expandRect(box, overlapPct), pageWidthPt, pageHeightPt)
                return (
                  <rect
                    x={expandedPx.x} y={expandedPx.y} width={expandedPx.width} height={expandedPx.height}
                    fill="none" stroke="#e2e8f0" strokeOpacity={0.6} strokeDasharray={`${5 / scale} ${4 / scale}`}
                    strokeWidth={strokeW} style={{ pointerEvents: 'none' }}
                  />
                )
              })()}
              <rect
                x={rectPx.x} y={rectPx.y} width={rectPx.width} height={rectPx.height}
                fill={isSelected ? 'rgba(59,130,246,0.15)' : activeColor}
                fillOpacity={isSelected ? undefined : 0.1}
                stroke={isSelected ? '#3b82f6' : activeColor}
                strokeWidth={strokeW}
                style={{ cursor: 'move' }}
                onPointerDown={(e) => onBoxPointerDown(e, box)}
                onPointerMove={onSvgPointerMove}
                onPointerUp={onSvgPointerUp}
              />
              <text
                x={rectPx.x + handleR * 0.6} y={rectPx.y + labelSize * 1.1}
                fontSize={labelSize}
                fontWeight={700}
                fill={isSelected ? '#3b82f6' : activeColor}
                style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: '#0a0a0a', strokeWidth: strokeW * 2 }}
              >
                {box.order}
              </text>
              {isSelected && (
                <>
                  {corners.map((c) => (
                    <circle
                      key={c.key} cx={c.x} cy={c.y} r={handleR}
                      fill="#fff" stroke="#3b82f6" strokeWidth={strokeW * 1.3}
                      style={{ cursor: `${c.key}-resize` }}
                      onPointerDown={(e) => onCornerPointerDown(e, box, c.key)}
                      onPointerMove={onSvgPointerMove}
                      onPointerUp={onSvgPointerUp}
                    />
                  ))}
                  <line x1={cx} y1={rectPx.y} x2={cx} y2={rectPx.y - rotateHandleOffset} stroke="#3b82f6" strokeWidth={strokeW} />
                  <circle
                    cx={cx} cy={rectPx.y - rotateHandleOffset} r={handleR}
                    fill="#3b82f6" stroke="#fff" strokeWidth={strokeW * 1.3}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => onRotatePointerDown(e, box)}
                    onPointerMove={onSvgPointerMove}
                    onPointerUp={onSvgPointerUp}
                  />
                </>
              )}
            </g>
          )
        })}
        {drawPreview && (
          <rect
            x={Math.min(drawPreview.start[0], drawPreview.current[0])}
            y={Math.min(drawPreview.start[1], drawPreview.current[1])}
            width={Math.abs(drawPreview.current[0] - drawPreview.start[0])}
            height={Math.abs(drawPreview.current[1] - drawPreview.start[1])}
            fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeDasharray={`${6 / scale} ${4 / scale}`} strokeWidth={strokeW}
          />
        )}
      </svg>

      <div className="pointer-events-auto absolute right-2 top-2 max-h-[calc(100%-1rem)] w-52 overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#141414]/95 p-2 shadow-lg backdrop-blur">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Cut pages ({boxes.length})
        </p>
        {boxes.length === 0 ? (
          <p className="rounded border border-dashed border-[#2a2a2a] px-2 py-3 text-center text-[11px] text-slate-600">
            Use Draw Box, then drag on the page.
          </p>
        ) : (
          <ul className="space-y-1">
            {boxes.map((box, i) => (
              <li
                key={box.id}
                onClick={() => setSelectedId(box.id)}
                className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] transition ${
                  box.id === selectedId ? 'border-brand-500 bg-brand-900/20 text-slate-100' : 'border-[#2a2a2a] text-slate-400 hover:border-[#3a3a3a]'
                }`}
              >
                <span className="w-5 shrink-0 text-center font-bold">{box.order}</span>
                <span className="min-w-0 flex-1 truncate">
                  {Math.round(box.width * pageWidthPt / 72 * 100) / 100}&quot;×{Math.round(box.height * pageHeightPt / 72 * 100) / 100}&quot;
                  {box.rotation ? ` · ${Math.round(box.rotation)}°` : ''}
                </span>
                <button onClick={(e) => { e.stopPropagation(); moveInList(box.id, -1) }} disabled={i === 0}
                  className="rounded p-0.5 text-slate-500 hover:text-slate-200 disabled:opacity-25">
                  <ArrowUp size={12} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); moveInList(box.id, 1) }} disabled={i === boxes.length - 1}
                  className="rounded p-0.5 text-slate-500 hover:text-slate-200 disabled:opacity-25">
                  <ArrowDown size={12} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); deleteBox(box.id) }}
                  className="rounded p-0.5 text-slate-500 hover:text-rose-400">
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {selectedId && (
          <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-600">
            <RotateCw size={10} /> Drag the blue handle above the selected box to rotate.
          </p>
        )}
      </div>
    </div>
  )
}
