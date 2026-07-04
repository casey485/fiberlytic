// ---------------------------------------------------------------------------
// Map Reading Phase 1 — Geometry / Line-Tracing layer. Traces the page's own
// drawn linework into a route graph (endpoints, junctions, connecting
// polylines) via classical image processing — no ML, no external CV library.
// Deliberately hand-rolled rather than opencv.js: skeletonization (Zhang-Suen
// thinning) and skeleton->graph extraction are well-established, moderate-
// complexity algorithms directly implementable on plain ImageData, and
// staying hand-rolled keeps this fully inspectable/debuggable while the
// fundamental approach is still being validated against real prints.
//
// Nothing here assumes cable type is indicated by line color — confirmed with
// the user that real prints are mostly one line color, with cable type coming
// from text callouts. That association happens in a later phase; this module
// only produces the route geometry itself.
// ---------------------------------------------------------------------------

import type { RouteGraph, RouteNode, RouteSegment } from '../../types'

/** Tracing runs at a capped working resolution — line topology doesn't need
 *  full print-DPI precision, and Zhang-Suen thinning is an iterate-to-
 *  convergence algorithm that would be far too slow across a multi-megapixel
 *  300 DPI page. Results are scaled back up to the page's natural pixel space
 *  before being returned, so they still align with the full-res display. */
const TRACE_MAX_DIM = 1400
/** Segments shorter than this many traced points are treated as thinning
 *  noise (stray specks), not real linework, and dropped. */
const MIN_SEGMENT_POINTS = 4

export interface OcrBox { x0: number; y0: number; x1: number; y1: number }

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load page image'))
    img.src = dataUrl
  })
}

function toGrayscale(imageData: ImageData): Float64Array {
  const { data, width, height } = imageData
  const gray = new Float64Array(width * height)
  for (let i = 0; i < width * height; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }
  return gray
}

/** 1 = ink, 0 = background. Darker-than-threshold pixels are ink. */
function binarize(gray: Float64Array, threshold: number): Uint8Array {
  const bitmap = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i++) bitmap[i] = gray[i] < threshold ? 1 : 0
  return bitmap
}

function maskOutTextRegions(bitmap: Uint8Array, width: number, height: number, boxes: OcrBox[], pad = 2) {
  for (const box of boxes) {
    const x0 = Math.max(0, Math.floor(box.x0) - pad)
    const y0 = Math.max(0, Math.floor(box.y0) - pad)
    const x1 = Math.min(width - 1, Math.ceil(box.x1) + pad)
    const y1 = Math.min(height - 1, Math.ceil(box.y1) + pad)
    for (let y = y0; y <= y1; y++) {
      const rowBase = y * width
      for (let x = x0; x <= x1; x++) bitmap[rowBase + x] = 0
    }
  }
}

/** Standard Zhang-Suen thinning — reduces connected ink regions to a
 *  1-pixel-wide skeleton, iterating both sub-passes to convergence. */
function zhangSuenThin(bitmap: Uint8Array, width: number, height: number): Uint8Array {
  const img = new Uint8Array(bitmap)
  const get = (x: number, y: number) => (x < 0 || x >= width || y < 0 || y >= height ? 0 : img[y * width + x])

  let changed = true
  while (changed) {
    changed = false

    for (const subIter of [1, 2] as const) {
      const toRemove: number[] = []
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (get(x, y) !== 1) continue
          const p2 = get(x, y - 1), p3 = get(x + 1, y - 1), p4 = get(x + 1, y), p5 = get(x + 1, y + 1)
          const p6 = get(x, y + 1), p7 = get(x - 1, y + 1), p8 = get(x - 1, y), p9 = get(x - 1, y - 1)
          const ring = [p2, p3, p4, p5, p6, p7, p8, p9]
          const B = ring.reduce((a, b) => a + b, 0)
          if (B < 2 || B > 6) continue
          let A = 0
          for (let i = 0; i < 8; i++) if (ring[i] === 0 && ring[(i + 1) % 8] === 1) A++
          if (A !== 1) continue
          if (subIter === 1) {
            if (p2 * p4 * p6 !== 0) continue
            if (p4 * p6 * p8 !== 0) continue
          } else {
            if (p2 * p4 * p8 !== 0) continue
            if (p2 * p6 * p8 !== 0) continue
          }
          toRemove.push(y * width + x)
        }
      }
      if (toRemove.length > 0) {
        changed = true
        for (const idx of toRemove) img[idx] = 0
      }
    }
  }
  return img
}

const RING_OFFSETS: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]

/** Walks the skeleton's node graph (endpoints = 1 skeleton neighbor, junctions
 *  = 3+) and traces the path pixels between adjacent nodes into polylines. */
function extractGraph(skeleton: Uint8Array, width: number, height: number): { nodes: RouteNode[]; segments: RouteSegment[] } {
  const isInk = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && skeleton[y * width + x] === 1
  const neighborsOf = (x: number, y: number): [number, number][] =>
    RING_OFFSETS.map(([dx, dy]) => [x + dx, y + dy] as [number, number]).filter(([nx, ny]) => isInk(nx, ny))

  const nodeAt = new Map<number, RouteNode>()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isInk(x, y)) continue
      const n = neighborsOf(x, y).length
      if (n === 1 || n >= 3) {
        nodeAt.set(y * width + x, { id: `n-${x}-${y}`, x, y, kind: n === 1 ? 'endpoint' : 'junction' })
      }
    }
  }

  const segments: RouteSegment[] = []
  const visitedDirectedEdges = new Set<string>()

  for (const startNode of nodeAt.values()) {
    for (const [nx, ny] of neighborsOf(startNode.x, startNode.y)) {
      const startKey = `${startNode.x},${startNode.y}->${nx},${ny}`
      if (visitedDirectedEdges.has(startKey)) continue
      visitedDirectedEdges.add(startKey)

      const points: [number, number][] = [[startNode.x, startNode.y]]
      let prev: [number, number] = [startNode.x, startNode.y]
      let cur: [number, number] = [nx, ny]
      let safety = 0
      let closedAt: RouteNode | null = null

      while (safety++ < width * height) {
        points.push(cur)
        const curNode = nodeAt.get(cur[1] * width + cur[0])
        if (curNode && !(cur[0] === startNode.x && cur[1] === startNode.y)) {
          closedAt = curNode
          visitedDirectedEdges.add(`${cur[0]},${cur[1]}->${prev[0]},${prev[1]}`)
          break
        }
        const nexts = neighborsOf(cur[0], cur[1]).filter(([ax, ay]) => !(ax === prev[0] && ay === prev[1]))
        if (nexts.length === 0) break
        const next = nexts[0]
        visitedDirectedEdges.add(`${cur[0]},${cur[1]}->${next[0]},${next[1]}`)
        prev = cur
        cur = next
      }

      if (closedAt) {
        segments.push({ id: `seg-${segments.length}`, nodeAId: startNode.id, nodeBId: closedAt.id, points })
      }
    }
  }

  return { nodes: Array.from(nodeAt.values()), segments }
}

export interface TraceOptions {
  ocrWordBoxes: OcrBox[]
  threshold: number
}

/** Top-level orchestrator: binarize -> mask text -> thin -> extract graph,
 *  at a capped working resolution, with results scaled back to the source
 *  image's natural pixel space. */
export function traceRoutes(image: HTMLImageElement, opts: TraceOptions): RouteGraph {
  const naturalWidth = image.naturalWidth
  const naturalHeight = image.naturalHeight
  const scale = Math.min(1, TRACE_MAX_DIM / Math.max(naturalWidth, naturalHeight))
  const workWidth = Math.max(1, Math.round(naturalWidth * scale))
  const workHeight = Math.max(1, Math.round(naturalHeight * scale))

  const workCanvas = document.createElement('canvas')
  workCanvas.width = workWidth
  workCanvas.height = workHeight
  const ctx = workCanvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(image, 0, 0, workWidth, workHeight)
  const imageData = ctx.getImageData(0, 0, workWidth, workHeight)

  const gray = toGrayscale(imageData)
  const bitmap = binarize(gray, opts.threshold)
  const scaledBoxes = opts.ocrWordBoxes.map((b) => ({
    x0: b.x0 * scale, y0: b.y0 * scale, x1: b.x1 * scale, y1: b.y1 * scale,
  }))
  maskOutTextRegions(bitmap, workWidth, workHeight, scaledBoxes)
  const skeleton = zhangSuenThin(bitmap, workWidth, workHeight)
  const { nodes, segments } = extractGraph(skeleton, workWidth, workHeight)
  const keptSegments = segments.filter((s) => s.points.length >= MIN_SEGMENT_POINTS)
  const keptNodeIds = new Set(keptSegments.flatMap((s) => [s.nodeAId, s.nodeBId]))

  const invScale = 1 / scale
  return {
    threshold: opts.threshold,
    nodes: nodes.filter((n) => keptNodeIds.has(n.id)).map((n) => ({ ...n, x: n.x * invScale, y: n.y * invScale })),
    segments: keptSegments
      .map((s) => ({ ...s, points: s.points.map(([x, y]) => [x * invScale, y * invScale] as [number, number]) })),
  }
}
