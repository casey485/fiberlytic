// ---------------------------------------------------------------------------
// Split/Merge geometry operations for line and polygon Work Objects.
//
// Both are deliberately vertex-based (operating on *existing* vertices, not
// arbitrary points along an edge) — this keeps the math a plain array
// operation for lines/polygon rings, and lets polygon Merge use a real
// boolean union (via `polygon-clipping`) instead of hand-rolled edge
// intersection math.
// ---------------------------------------------------------------------------

import polygonClipping from 'polygon-clipping'
import type { Polygon as ClipPolygon } from 'polygon-clipping'

/** Split an open line at an interior vertex index into two point lists. `index` must be > 0 and < points.length - 1. */
export function splitLine(points: [number, number][], index: number): [[number, number][], [number, number][]] {
  return [points.slice(0, index + 1), points.slice(index)]
}

/** Join two lines end-to-end at whichever pair of endpoints is closest, reversing one side if needed for contiguity. */
export function mergeLines(a: [number, number][], b: [number, number][]): [number, number][] {
  const dist = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1])
  const aStart = a[0], aEnd = a[a.length - 1]
  const bStart = b[0], bEnd = b[b.length - 1]
  const options: { d: number; join: () => [number, number][] }[] = [
    { d: dist(aEnd, bStart), join: () => [...a, ...b.slice(1)] },
    { d: dist(aEnd, bEnd), join: () => [...a, ...[...b].reverse().slice(1)] },
    { d: dist(aStart, bStart), join: () => [...[...a].reverse(), ...b.slice(1)] },
    { d: dist(aStart, bEnd), join: () => [...b, ...a.slice(1)] },
  ]
  options.sort((x, y) => x.d - y.d)
  return options[0].join()
}

/**
 * Split a polygon ring at two vertex indices into two sub-rings.
 * `i` and `j` must be distinct indices into `ring` (order doesn't matter).
 */
export function splitPolygon(ring: [number, number][], i: number, j: number): [[number, number][], [number, number][]] {
  const lo = Math.min(i, j), hi = Math.max(i, j)
  const ringA = ring.slice(lo, hi + 1)
  const ringB = [...ring.slice(hi), ...ring.slice(0, lo + 1)]
  return [ringA, ringB]
}

function closeRing(pts: [number, number][]): [number, number][] {
  if (pts.length === 0) return pts
  const [x0, y0] = pts[0]
  const [xn, yn] = pts[pts.length - 1]
  return x0 === xn && y0 === yn ? pts : [...pts, pts[0]]
}

function openRing(pts: [number, number][]): [number, number][] {
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
    return pts.slice(0, -1)
  }
  return pts
}

/**
 * Real polygon union (via `polygon-clipping`) — may legally return more than
 * one ring if the inputs don't overlap/touch. Caller creates one FieldMarkup
 * per returned ring.
 */
export function unionPolygons(a: [number, number][], b: [number, number][]): [number, number][][] {
  const polyA: ClipPolygon = [closeRing(a)]
  const polyB: ClipPolygon = [closeRing(b)]
  const result = polygonClipping.union(polyA, polyB)
  return result.map((poly) => openRing(poly[0]))
}
