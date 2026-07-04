import { useRef, useState } from 'react'
import { Combine, X, Check } from 'lucide-react'
import type { GridCellSelection } from '../../types'
import { computeGridCells, areCellsConnected, fracToPixelRect, gridCellId, type Rect } from '../../lib/mapCuts/geometry'

interface PdfPoint { x: number; y: number }

interface GridCellOverlayProps {
  pageWidthPt: number
  pageHeightPt: number
  scale: number
  panPt: PdfPoint
  containerWidthCss: number
  containerHeightCss: number
  rows: number
  cols: number
  selection: GridCellSelection
  onSelectionChange: (next: GridCellSelection) => void
  /** Reports incremental pan deltas (in PDF points) while dragging the grid
   *  background — same contract as BoxEditor's onPanDelta prop, just a
   *  separate implementation (a tap-vs-drag threshold here, since every pixel
   *  of this overlay is a clickable cell, unlike BoxEditor's empty background). */
  onPanDelta: (dxPt: number, dyPt: number) => void
}

const DRAG_THRESHOLD_PX = 6

/** Grid Cut's own click-to-select/number/merge overlay — completely separate
 *  from BoxEditor.tsx (Manual Cut's draw/move/resize/rotate editor). Shares
 *  only pure coordinate-math helpers from geometry.ts (fracToPixelRect,
 *  computeGridCells, areCellsConnected, gridCellId), never any interaction/
 *  editing code. */
export function GridCellOverlay({
  pageWidthPt, pageHeightPt, scale, panPt, containerWidthCss, containerHeightCss,
  rows, cols, selection, onSelectionChange, onPanDelta,
}: GridCellOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [mergeMode, setMergeMode] = useState(false)
  const [pendingMerge, setPendingMerge] = useState<string[]>([])
  const dragRef = useRef<{ startClient: [number, number]; lastClient: [number, number]; moved: boolean } | null>(null)

  const cells = computeGridCells(rows, cols)
  const mergedCellIds = new Set(selection.merges.flat())
  const strokeW = 1.25 / scale
  const labelSize = 13 / scale
  const viewBoxW = containerWidthCss / scale
  const viewBoxH = containerHeightCss / scale

  function groupForCell(id: string): string[] | null {
    return selection.merges.find((g) => g.includes(id)) ?? null
  }

  function nextOrder(): number {
    const values = Object.values(selection.selectedOrder)
    return values.length > 0 ? Math.max(...values) + 1 : 1
  }

  function onCellClick(id: string) {
    if (!cells[id]) return
    const group = groupForCell(id)

    if (mergeMode) {
      // Only already-selected, not-yet-merged cells can be gathered into a new merge group.
      if (group || !(id in selection.selectedOrder)) return
      setPendingMerge((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
      return
    }

    if (group) {
      // Clicking any cell in a merged region deselects the whole group at once —
      // simplest, most predictable un-merge behavior (no partial-unmerge UI).
      const nextSelectedOrder = { ...selection.selectedOrder }
      for (const cellId of group) delete nextSelectedOrder[cellId]
      onSelectionChange({
        ...selection,
        selectedOrder: nextSelectedOrder,
        merges: selection.merges.filter((g) => g !== group),
      })
      return
    }

    if (id in selection.selectedOrder) {
      const nextSelectedOrder = { ...selection.selectedOrder }
      delete nextSelectedOrder[id]
      onSelectionChange({ ...selection, selectedOrder: nextSelectedOrder })
      return
    }

    onSelectionChange({ ...selection, selectedOrder: { ...selection.selectedOrder, [id]: nextOrder() } })
  }

  function confirmMerge() {
    if (pendingMerge.length < 2 || !areCellsConnected(pendingMerge)) return
    onSelectionChange({ ...selection, merges: [...selection.merges, pendingMerge] })
    setPendingMerge([])
  }

  function cancelMerge() {
    setPendingMerge([])
  }

  const canConfirmMerge = pendingMerge.length >= 2 && areCellsConnected(pendingMerge)

  function cellIdAtClient(clientX: number, clientY: number): string | null {
    const svg = svgRef.current
    if (!svg) return null
    const r = svg.getBoundingClientRect()
    const pagePtX = panPt.x + (clientX - r.left) / scale
    const pagePtY = panPt.y + (clientY - r.top) / scale
    const fracX = pagePtX / pageWidthPt
    const fracY = pagePtY / pageHeightPt
    if (fracX < 0 || fracX > 1 || fracY < 0 || fracY > 1) return null
    const col = Math.min(cols - 1, Math.max(0, Math.floor(fracX * cols)))
    const row = Math.min(rows - 1, Math.max(0, Math.floor(fracY * rows)))
    return gridCellId(row, col)
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startClient: [e.clientX, e.clientY], lastClient: [e.clientX, e.clientY], moved: false }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.lastClient[0]
    const dy = e.clientY - drag.lastClient[1]
    const totalDx = e.clientX - drag.startClient[0]
    const totalDy = e.clientY - drag.startClient[1]
    if (Math.hypot(totalDx, totalDy) > DRAG_THRESHOLD_PX) drag.moved = true
    if (drag.moved) onPanDelta(dx / scale, dy / scale)
    drag.lastClient = [e.clientX, e.clientY]
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.moved) return
    const id = cellIdAtClient(e.clientX, e.clientY)
    if (id) onCellClick(id)
  }

  // Merged groups render as one combined rect (bounding box of their cells) with
  // one badge, instead of each member cell rendering separately.
  const mergedRects = selection.merges.map((group) => {
    const rects = group.map((id) => cells[id]).filter((r): r is Rect => !!r)
    const x = Math.min(...rects.map((r) => r.x))
    const y = Math.min(...rects.map((r) => r.y))
    const right = Math.max(...rects.map((r) => r.x + r.width))
    const bottom = Math.max(...rects.map((r) => r.y + r.height))
    const minOrder = Math.min(...group.map((id) => selection.selectedOrder[id] ?? Infinity))
    return { group, rect: { x, y, width: right - x, height: bottom - y }, order: minOrder }
  })

  return (
    <div className="pointer-events-none absolute inset-0">
      <svg
        ref={svgRef}
        viewBox={`${panPt.x} ${panPt.y} ${viewBoxW} ${viewBoxH}`}
        preserveAspectRatio="none"
        className="pointer-events-auto absolute inset-0 h-full w-full touch-none"
        style={{ cursor: mergeMode ? 'pointer' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: cols }).map((_, c) => {
            const id = gridCellId(r, c)
            if (mergedCellIds.has(id)) return null // rendered once as part of its merged group below
            const rectPx = fracToPixelRect(cells[id], pageWidthPt, pageHeightPt)
            const isSelected = id in selection.selectedOrder
            const isPending = pendingMerge.includes(id)
            return (
              <g key={id}>
                <rect
                  x={rectPx.x} y={rectPx.y} width={rectPx.width} height={rectPx.height}
                  fill={isSelected ? 'rgba(34,197,94,0.15)' : 'rgba(148,163,184,0.04)'}
                  stroke={isPending ? '#f97316' : isSelected ? '#22c55e' : 'rgba(148,163,184,0.35)'}
                  strokeWidth={strokeW}
                  strokeDasharray={isPending ? `${6 / scale} ${4 / scale}` : undefined}
                />
                {isSelected && (
                  <text
                    x={rectPx.x + rectPx.width / 2} y={rectPx.y + rectPx.height / 2}
                    fontSize={labelSize * 1.4} fontWeight={700} fill="#22c55e" textAnchor="middle" dominantBaseline="central"
                    style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: '#0a0a0a', strokeWidth: strokeW * 2 }}
                  >
                    {selection.selectedOrder[id]}
                  </text>
                )}
              </g>
            )
          }),
        )}
        {mergedRects.map(({ group, rect, order }) => {
          const rectPx = fracToPixelRect(rect, pageWidthPt, pageHeightPt)
          return (
            <g key={group.join(',')}>
              <rect
                x={rectPx.x} y={rectPx.y} width={rectPx.width} height={rectPx.height}
                fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeWidth={strokeW * 1.3}
              />
              <text
                x={rectPx.x + rectPx.width / 2} y={rectPx.y + rectPx.height / 2}
                fontSize={labelSize * 1.4} fontWeight={700} fill="#3b82f6" textAnchor="middle" dominantBaseline="central"
                style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: '#0a0a0a', strokeWidth: strokeW * 2 }}
              >
                {order}
              </text>
            </g>
          )
        })}
      </svg>

      <div className="pointer-events-auto absolute right-2 top-2 flex flex-col gap-1.5 rounded-lg border border-[#2a2a2a] bg-[#141414]/95 p-2 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => { setMergeMode((v) => !v); setPendingMerge([]) }}
          className={`flex items-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition ${
            mergeMode ? 'border border-brand-500 bg-brand-900/30 text-brand-300' : 'border border-[#2a2a2a] text-slate-400 hover:text-slate-200'
          }`}
        >
          <Combine size={13} /> {mergeMode ? 'Click selected cells to merge…' : 'Merge Mode'}
        </button>
        {mergeMode && (
          <div className="flex items-center gap-1.5">
            <button
              type="button" onClick={confirmMerge} disabled={!canConfirmMerge}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-30"
            >
              <Check size={12} /> Confirm
            </button>
            <button type="button" onClick={cancelMerge} className="flex items-center justify-center gap-1 rounded border border-[#2a2a2a] px-2 py-1 text-xs text-slate-400 hover:text-slate-200">
              <X size={12} />
            </button>
          </div>
        )}
        {mergeMode && pendingMerge.length > 0 && !canConfirmMerge && (
          <p className="max-w-[160px] text-[10px] text-amber-400">Selected cells must be adjacent to merge.</p>
        )}
      </div>
    </div>
  )
}
