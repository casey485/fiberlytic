import type { MapCutBox } from '../../types'

/** A plain axis-aligned rectangle, pre-rotation. Used as the common shape for
 *  both normalized (0-1) and pixel-space math — every function here is scale
 *  agnostic as long as the caller is consistent about units. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

let gridBoxCounter = 0
function newGridBoxId(): string {
  gridBoxCounter += 1
  return `mcb-grid-${Date.now().toString(36)}-${gridBoxCounter.toString(36)}`
}

// ---------------------------------------------------------------------------
// Grid Cut — entirely separate from Manual Cut's draw/move/resize/rotate code
// in BoxEditor.tsx (which has its own private newBoxId()). Nothing below this
// point is used by, or shared with, Manual Cut.
// ---------------------------------------------------------------------------

/** cellId format used throughout Grid Cut's selection state. */
export function gridCellId(row: number, col: number): string {
  return `${row}-${col}`
}

/** Plain, unexpanded fractional rect for every cell in a rows x cols grid —
 *  reading order left-to-right, top-to-bottom. No id/order baked in (those are
 *  only assigned once a cell is actually selected/merged into an output box),
 *  and deliberately NOT expanded by overlapPct — pdfBuilder.ts already applies
 *  expandRect at render time for every box regardless of origin. */
export function computeGridCells(rows: number, cols: number): Record<string, Rect> {
  const cellW = 1 / cols
  const cellH = 1 / rows
  const cells: Record<string, Rect> = {}
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells[gridCellId(r, c)] = { x: c * cellW, y: r * cellH, width: cellW, height: cellH }
    }
  }
  return cells
}

/** True if every cellId in the set is reachable from the others through shared
 *  edges (same row, adjacent col, or same col, adjacent row) — validates a
 *  merge group before it's allowed to be confirmed. */
export function areCellsConnected(cellIds: string[]): boolean {
  if (cellIds.length <= 1) return true
  const parse = (id: string) => id.split('-').map(Number) as [number, number]
  const remaining = new Set(cellIds)
  const start = cellIds[0]
  const seen = new Set([start])
  const stack = [start]
  remaining.delete(start)
  while (stack.length > 0) {
    const [r, c] = parse(stack.pop()!)
    for (const candidate of Array.from(remaining)) {
      const [cr, cc] = parse(candidate)
      const adjacent = (cr === r && Math.abs(cc - c) === 1) || (cc === c && Math.abs(cr - r) === 1)
      if (adjacent) {
        seen.add(candidate)
        stack.push(candidate)
        remaining.delete(candidate)
      }
    }
  }
  return remaining.size === 0
}

/** Converts a finalized Grid Cut selection into output boxes — one per merge
 *  group, or one per lone selected cell not part of any group. Each box's
 *  rect is the bounding-rect union of its member cells; `order` is assigned
 *  1..N by each group's ascending minimum click-order. Unexpanded, unrotated —
 *  same convention as computeGridCells above. */
export function gridSelectionToBoxes(
  selection: { rows: number; cols: number; selectedOrder: Record<string, number>; merges: string[][] },
): MapCutBox[] {
  const cells = computeGridCells(selection.rows, selection.cols)
  const merged = new Set(selection.merges.flat())
  const groups: string[][] = [
    ...selection.merges,
    ...Object.keys(selection.selectedOrder).filter((id) => !merged.has(id)).map((id) => [id]),
  ]

  const withOrder = groups
    .filter((group) => group.length > 0)
    .map((group) => ({
      group,
      minOrder: Math.min(...group.map((id) => selection.selectedOrder[id] ?? Infinity)),
    }))
    .sort((a, b) => a.minOrder - b.minOrder)

  return withOrder.map(({ group }, i) => {
    const rects = group.map((id) => cells[id]).filter((r): r is Rect => !!r)
    const x = Math.min(...rects.map((r) => r.x))
    const y = Math.min(...rects.map((r) => r.y))
    const right = Math.max(...rects.map((r) => r.x + r.width))
    const bottom = Math.max(...rects.map((r) => r.y + r.height))
    return { id: newGridBoxId(), x, y, width: right - x, height: bottom - y, rotation: 0, order: i + 1 }
  })
}

/** Grow a rect by overlapPct (0-30) around its own center, clamped to the
 *  unit page (0-1 on both axes). Used both for grid cells (so neighbors
 *  overlap) and for manual boxes (so hand-drawn edges get a safety margin
 *  without the user having to drag them past each other). */
export function expandRect(rect: Rect, overlapPct: number): Rect {
  const growW = rect.width * (overlapPct / 100)
  const growH = rect.height * (overlapPct / 100)
  const x = Math.max(0, rect.x - growW / 2)
  const y = Math.max(0, rect.y - growH / 2)
  const right = Math.min(1, rect.x + rect.width + growW / 2)
  const bottom = Math.min(1, rect.y + rect.height + growH / 2)
  return { x, y, width: right - x, height: bottom - y }
}

export function fracToPixelRect(rect: Rect, pageW: number, pageH: number): Rect {
  return { x: rect.x * pageW, y: rect.y * pageH, width: rect.width * pageW, height: rect.height * pageH }
}

export function pixelToFracRect(rect: Rect, pageW: number, pageH: number): Rect {
  return { x: rect.x / pageW, y: rect.y / pageH, width: rect.width / pageW, height: rect.height / pageH }
}

/** Rotate point (x,y) around center (cx,cy) by deg degrees. */
export function rotatePoint(x: number, y: number, cx: number, cy: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = x - cx
  const dy = y - cy
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
}

/** The four corners of a (possibly rotated) rect, in the same units as the rect. */
export function rectCorners(rect: Rect, rotation: number): [number, number][] {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const raw: [number, number][] = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ]
  return rotation === 0 ? raw : raw.map(([x, y]) => rotatePoint(x, y, cx, cy, rotation))
}

export interface SnapGuide {
  orientation: 'v' | 'h'
  /** Position along the axis perpendicular to the guide's orientation, in caller units. */
  position: number
}

export interface SnapResult {
  x: number
  y: number
  guides: SnapGuide[]
}

/** Snap a moving rect's edges/center to nearby edges/centers of other
 *  unrotated boxes. Only applies to axis-aligned boxes (rotation === 0) on
 *  both sides — aligning arbitrarily rotated rectangles is a much harder
 *  problem and out of scope; rotation itself snaps separately via
 *  snapRotation. `threshold` is in the same units as the rect coordinates
 *  (the caller converts its on-screen pixel threshold into page-point units
 *  before calling this). Returns the snapped x/y (width/height unchanged —
 *  this only nudges position, not size) plus any guide lines to render. */
export function computeSnap(moving: Rect, others: Rect[], threshold: number): SnapResult {
  const guides: SnapGuide[] = []
  let { x, y } = moving
  const movingEdgesX = [moving.x, moving.x + moving.width / 2, moving.x + moving.width]
  const movingEdgesY = [moving.y, moving.y + moving.height / 2, moving.y + moving.height]

  let bestDx: number | null = null
  let bestDy: number | null = null

  for (const other of others) {
    const otherEdgesX = [other.x, other.x + other.width / 2, other.x + other.width]
    const otherEdgesY = [other.y, other.y + other.height / 2, other.y + other.height]

    for (const me of movingEdgesX) {
      for (const oe of otherEdgesX) {
        const d = oe - me
        if (Math.abs(d) <= threshold && (bestDx === null || Math.abs(d) < Math.abs(bestDx))) {
          bestDx = d
          guides.push({ orientation: 'v', position: oe })
        }
      }
    }
    for (const me of movingEdgesY) {
      for (const oe of otherEdgesY) {
        const d = oe - me
        if (Math.abs(d) <= threshold && (bestDy === null || Math.abs(d) < Math.abs(bestDy))) {
          bestDy = d
          guides.push({ orientation: 'h', position: oe })
        }
      }
    }
  }

  if (bestDx !== null) x = moving.x + bestDx
  if (bestDy !== null) y = moving.y + bestDy

  return { x, y, guides }
}

/** Snap a rotation angle to the nearest 15deg increment when within
 *  thresholdDeg — lets a user get a clean 0/15/30/45/90... rotation without
 *  needing pixel-perfect dragging. */
export function snapRotation(deg: number, incrementDeg = 15, thresholdDeg = 5): number {
  const normalized = ((deg % 360) + 360) % 360
  const nearest = Math.round(normalized / incrementDeg) * incrementDeg
  return Math.abs(normalized - nearest) <= thresholdDeg ? nearest % 360 : normalized
}
