// ---------------------------------------------------------------------------
// Route Association layer (minimal) — assigns each traced route segment the
// nearest cable-type/construction-type text detection, so a route's highlight
// color comes from a real nearby label rather than reading color off the
// source linework (confirmed with the user: real prints are mostly one line
// color; cable type comes from text callouts, not line color).
// ---------------------------------------------------------------------------

import type { MapReadingDetection, MapReadingDetectionType, RouteGraph } from '../../types'

/** Only these detection types describe a route's own construction, as
 *  opposed to equipment/location labels (FE/FT/road name/tie point/etc.),
 *  which don't classify a route's color. */
const CLASSIFIABLE_TYPES: MapReadingDetectionType[] = [
  'construction_24ct', 'construction_48ct', 'construction_96ct', 'overlash', 'fiber_only', 'strand_only',
]

/** Beyond this pixel distance (in the page's natural pixel space), a label is
 *  no longer considered "near" a route — roughly 1.3in at the 300 DPI pages
 *  are rendered at. Prevents a route being colored by a label from an
 *  unrelated, distant part of the page. */
const MAX_ASSOCIATION_DIST_PX = 400

function distPointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function minDistToPolyline(px: number, py: number, points: [number, number][]): number {
  let best = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[i + 1]
    best = Math.min(best, distPointToSegment(px, py, ax, ay, bx, by))
  }
  return best
}

/** For every segment in the graph, finds the nearest classifiable detection
 *  within MAX_ASSOCIATION_DIST_PX and assigns it as that segment's
 *  classification. Segments with no nearby label are left unclassified —
 *  they render as a neutral trace color, never a guess. */
export function classifyRoutes(graph: RouteGraph, detections: MapReadingDetection[]): RouteGraph {
  const candidates = detections.filter((d) => CLASSIFIABLE_TYPES.includes(d.type))
  if (candidates.length === 0) return { ...graph, segments: graph.segments.map((s) => ({ ...s, classification: undefined, associatedDetectionIds: [] })) }

  const segments = graph.segments.map((seg) => {
    let best: { det: MapReadingDetection; dist: number } | null = null
    for (const det of candidates) {
      const cx = det.x + det.width / 2
      const cy = det.y + det.height / 2
      const dist = minDistToPolyline(cx, cy, seg.points)
      if (dist <= MAX_ASSOCIATION_DIST_PX && (!best || dist < best.dist)) best = { det, dist }
    }
    return {
      ...seg,
      classification: best?.det.type,
      associatedDetectionIds: best ? [best.det.id] : [],
    }
  })

  return { ...graph, segments }
}
