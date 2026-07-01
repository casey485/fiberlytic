// ---------------------------------------------------------------------------
// Snap-to-vertex — when enabled, drawing/dragging operations substitute the
// cursor's position with the nearest existing vertex (from other Work
// Objects or KMZ features) within a screen-pixel tolerance.
// ---------------------------------------------------------------------------

import type L from 'leaflet'

const DEFAULT_TOLERANCE_PX = 12

/**
 * Find the nearest candidate lat/lng to `latlng` within `tolerancePx` screen
 * pixels (measured via the map's current zoom/projection). Returns the
 * snapped-to candidate, or null if nothing is within tolerance.
 */
export function findSnapPoint(
  latlng: L.LatLng,
  candidates: [number, number][],
  map: L.Map,
  tolerancePx: number = DEFAULT_TOLERANCE_PX,
): [number, number] | null {
  if (candidates.length === 0) return null
  const cursorPt = map.latLngToContainerPoint(latlng)
  let best: [number, number] | null = null
  let bestDist = tolerancePx
  for (const c of candidates) {
    const pt = map.latLngToContainerPoint(c as L.LatLngExpression)
    const dist = cursorPt.distanceTo(pt)
    if (dist <= bestDist) { bestDist = dist; best = c }
  }
  return best
}

const DEFAULT_TOLERANCE_PAGE_UNITS = 10

/**
 * PDF Print Mode's sibling to findSnapPoint — page-point space is already flat/
 * Euclidean (no projection step, unlike Leaflet's lat/lng), so this is just a
 * plain nearest-candidate check within a page-unit tolerance.
 */
export function findSnapPointFlat(
  point: [number, number],
  candidates: [number, number][],
  tolerance: number = DEFAULT_TOLERANCE_PAGE_UNITS,
): [number, number] | null {
  if (candidates.length === 0) return null
  let best: [number, number] | null = null
  let bestDist = tolerance
  for (const c of candidates) {
    const dist = Math.hypot(point[0] - c[0], point[1] - c[1])
    if (dist <= bestDist) { bestDist = dist; best = c }
  }
  return best
}

/** Flatten every vertex out of a set of markup geometries (latlngs/bounds corners/center) for use as snap candidates. */
export function collectSnapCandidates(geometries: { latlngs?: [number, number][]; bounds?: [[number, number], [number, number]]; center?: [number, number] }[]): [number, number][] {
  const out: [number, number][] = []
  for (const geo of geometries) {
    if (geo.latlngs) out.push(...geo.latlngs)
    if (geo.bounds) out.push(geo.bounds[0], geo.bounds[1])
    if (geo.center) out.push(geo.center)
  }
  return out
}
