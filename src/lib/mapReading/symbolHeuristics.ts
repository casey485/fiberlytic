// ---------------------------------------------------------------------------
// Best-effort, geometry-grounded symbol detection — NOT template/shape
// matching against reference icons (none exist anywhere in this app). Slack
// loops are flagged from a real signal already present in the traced route
// graph: a spiral loops back near itself repeatedly, so its traced path
// length is much longer than the straight-line distance between its
// endpoints, unlike a straight run of cable. Confirmed with the user as the
// intended best-effort approach, distinct from true icon recognition.
// ---------------------------------------------------------------------------

import type { MapReadingDetection, RouteGraph } from '../../types'

/** Endpoints closer together than this (px, in the page's natural pixel
 *  space) are "the same spot" for loop-detection purposes. */
const MAX_LOOP_ENDPOINT_DIST_PX = 60
/** Traced path must be at least this many times longer than the straight-line
 *  distance between endpoints to count as a loop, not just a slightly curved run. */
const MIN_LOOP_PATH_RATIO = 3

function pathLength(points: [number, number][]): number {
  let len = 0
  for (let i = 0; i < points.length - 1; i++) {
    len += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1])
  }
  return len
}

/** Produces synthetic `coil`-type detections at each probable slack-loop
 *  location. `confirmed: false` so they surface for review exactly like any
 *  text-derived detection — the text distinguishes them ("(geometry)") so a
 *  reviewer knows this one came from shape, not OCR. */
export function detectLoopCandidates(graph: RouteGraph): MapReadingDetection[] {
  const candidates: MapReadingDetection[] = []

  for (const seg of graph.segments) {
    if (seg.points.length < 3) continue
    const isSelfLoop = seg.nodeAId === seg.nodeBId
    const [sx, sy] = seg.points[0]
    const [ex, ey] = seg.points[seg.points.length - 1]
    const straightDist = Math.hypot(ex - sx, ey - sy)
    const ratio = pathLength(seg.points) / Math.max(straightDist, 1)

    if (!isSelfLoop && (straightDist > MAX_LOOP_ENDPOINT_DIST_PX || ratio < MIN_LOOP_PATH_RATIO)) continue

    const xs = seg.points.map((p) => p[0])
    const ys = seg.points.map((p) => p[1])
    const x0 = Math.min(...xs), x1 = Math.max(...xs)
    const y0 = Math.min(...ys), y1 = Math.max(...ys)
    candidates.push({
      id: `loop-${seg.id}`,
      type: 'coil',
      text: 'Slack loop (geometry)',
      x: x0, y: y0,
      width: Math.max(4, x1 - x0), height: Math.max(4, y1 - y0),
      confirmed: false,
    })
  }

  return candidates
}
