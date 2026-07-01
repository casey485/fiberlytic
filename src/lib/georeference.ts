// ---------------------------------------------------------------------------
// Georeferencing math for anchoring a scanned PDF page image onto the Field
// Map's Leaflet surface. A page image has its own pixel space; the user picks
// control points (pixel ↔ known lat/lng) and we solve an affine transform
// (image px → lat/lng). Rendering then composes that geo transform with
// Leaflet's own screen projection to get a CSS matrix for the <img> element —
// this stays affine because Web Mercator has no rotation at a fixed zoom, so
// two composed affine maps are still affine. See GeoreferencePanel.tsx /
// KmzMap.tsx for where this gets applied to the DOM.
// ---------------------------------------------------------------------------

export interface ControlPoint {
  px: { x: number; y: number }
  lat: number
  lng: number
}

/** lng = a*x + b*y + c; lat = d*x + e*y + f */
export interface GeoTransform {
  a: number; b: number; c: number
  d: number; e: number; f: number
}

/**
 * Solve an image-pixel → lat/lng affine transform from control points.
 * Exactly 2 points yield a similarity transform (uniform scale + rotation,
 * no skew) — usable but low-accuracy for non-square scans. 3+ points solve
 * a full affine least-squares fit (skew / non-uniform scale supported), which
 * is the supported/expected path.
 */
export function computeTransform(points: ControlPoint[]): GeoTransform {
  if (points.length < 2) throw new Error('At least 2 control points are required')
  if (points.length === 2) return similarityFromTwoPoints(points[0], points[1])
  return affineLeastSquares(points)
}

function similarityFromTwoPoints(p0: ControlPoint, p1: ControlPoint): GeoTransform {
  const dxPx = p1.px.x - p0.px.x
  const dyPx = p1.px.y - p0.px.y
  const dLng = p1.lng - p0.lng
  const dLat = p1.lat - p0.lat
  const pxDist = Math.hypot(dxPx, dyPx)
  if (pxDist === 0) throw new Error('Control points must be at different pixel positions')

  const scale = Math.hypot(dLng, dLat) / pxDist
  const rot = Math.atan2(dLat, dLng) - Math.atan2(dyPx, dxPx)
  const a = Math.cos(rot) * scale
  const b = -Math.sin(rot) * scale
  const d = Math.sin(rot) * scale
  const e = Math.cos(rot) * scale
  const c = p0.lng - (a * p0.px.x + b * p0.px.y)
  const f = p0.lat - (d * p0.px.x + e * p0.px.y)
  return { a, b, c, d, e, f }
}

function affineLeastSquares(points: ControlPoint[]): GeoTransform {
  // lng and lat are each fit independently as a plane over (x, y) via normal equations —
  // both share the same 3x3 normal-equation matrix, only the right-hand side differs.
  let Sxx = 0, Sxy = 0, Sx = 0, Syy = 0, Sy = 0
  let SxLng = 0, SyLng = 0, SLng = 0
  let SxLat = 0, SyLat = 0, SLat = 0
  for (const p of points) {
    const { x, y } = p.px
    Sxx += x * x; Sxy += x * y; Sx += x
    Syy += y * y; Sy += y
    SxLng += x * p.lng; SyLng += y * p.lng; SLng += p.lng
    SxLat += x * p.lat; SyLat += y * p.lat; SLat += p.lat
  }
  const M = [
    [Sxx, Sxy, Sx],
    [Sxy, Syy, Sy],
    [Sx, Sy, points.length],
  ]
  const [a, b, c] = solve3x3(M, [SxLng, SyLng, SLng])
  const [d, e, f] = solve3x3(M, [SxLat, SyLat, SLat])
  return { a, b, c, d, e, f }
}

function solve3x3(m: number[][], rhs: [number, number, number]): [number, number, number] {
  const det = (mm: number[][]) =>
    mm[0][0] * (mm[1][1] * mm[2][2] - mm[1][2] * mm[2][1]) -
    mm[0][1] * (mm[1][0] * mm[2][2] - mm[1][2] * mm[2][0]) +
    mm[0][2] * (mm[1][0] * mm[2][1] - mm[1][1] * mm[2][0])
  const D = det(m)
  if (Math.abs(D) < 1e-9) throw new Error('Control points are collinear or degenerate')
  const replaceCol = (col: number) => m.map((row, i) => row.map((v, j) => (j === col ? rhs[i] : v)))
  return [det(replaceCol(0)) / D, det(replaceCol(1)) / D, det(replaceCol(2)) / D]
}

export function projectPoint(t: GeoTransform, x: number, y: number): { lat: number; lng: number } {
  return { lng: t.a * x + t.b * y + t.c, lat: t.d * x + t.e * y + t.f }
}

/**
 * CSS matrix() coefficients to position/warp an <img> (rendered at its
 * natural pixel size with transform-origin 0 0) onto the map container in
 * screen space. Recompute on every map move/zoom/resize.
 */
export function computeScreenMatrix(
  t: GeoTransform,
  imgWidth: number,
  imgHeight: number,
  latLngToContainerPoint: (lat: number, lng: number) => { x: number; y: number },
): { A: number; B: number; C: number; D: number; E: number; F: number } {
  const g0 = projectPoint(t, 0, 0)
  const g1 = projectPoint(t, imgWidth, 0)
  const g2 = projectPoint(t, 0, imgHeight)
  const p0 = latLngToContainerPoint(g0.lat, g0.lng)
  const p1 = latLngToContainerPoint(g1.lat, g1.lng)
  const p2 = latLngToContainerPoint(g2.lat, g2.lng)
  return {
    A: (p1.x - p0.x) / imgWidth,
    B: (p1.y - p0.y) / imgWidth,
    C: (p2.x - p0.x) / imgHeight,
    D: (p2.y - p0.y) / imgHeight,
    E: p0.x,
    F: p0.y,
  }
}
