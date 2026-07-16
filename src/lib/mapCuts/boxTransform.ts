import type { MapCutBox, MapCutPackage, MarkupGeometry } from '../../types'
import { expandRect, rectCorners, rotatePoint, type Rect } from './geometry'
import { mapImageArea } from './titleBlock'
import { legacyScale } from '../../features/printkmz/pdf'

/** Mirrors pdfBuilder.ts's own constant — browsers cap canvas dimensions
 *  around this. Kept as the single source of truth here; pdfBuilder.ts
 *  imports it rather than redeclaring it. */
export const MAX_CANVAS_DIM = 16384

/** Picks this output page's physical size in points. Moved here (from
 *  pdfBuilder.ts's private pageDimsPt) so both the generator and the sync
 *  transform below use the exact same page-size decision — sync needs it to
 *  compute an output page's legacyScale without ever having to open the
 *  actual generated PDF file. */
export function outputPageDimsPt(pkg: MapCutPackage, box: MapCutBox): [number, number] {
  if (pkg.pageSize === 'custom') {
    const wIn = pkg.customWidthIn ?? 11
    const hIn = pkg.customHeightIn ?? 8.5
    return [wIn * 72, hIn * 72]
  }
  const longShortIn: Record<'11x17' | '8.5x11' | 'legal' | 'ansiC' | 'ansiD', [number, number]> = {
    '11x17': [17, 11], // = ANSI B
    '8.5x11': [11, 8.5],
    legal: [14, 8.5],
    ansiC: [22, 17],
    ansiD: [34, 22],
  }
  const [longIn, shortIn] = longShortIn[pkg.pageSize]
  const landscape = box.width >= box.height
  const [wIn, hIn] = landscape ? [longIn, shortIn] : [shortIn, longIn]
  return [wIn * 72, hIn * 72]
}

export interface PagePointSize { w: number; h: number }

export interface BoxRenderGeometry {
  /** box's x/y/width/height grown by pkg.overlapPct (see expandRect) — this,
   *  not the raw stored box, is what's actually rendered/cropped. */
  expandedFrac: Rect
  aabbXPt: number
  aabbYPt: number
  aabbWPt: number
  aabbHPt: number
  /** pixels-per-PDF-point, already clamped for MAX_CANVAS_DIM — matches what
   *  pdfBuilder.ts actually rendered at, which can be less than
   *  pkg.outputDpi/72 for a very large box at high DPI. */
  renderScale: number
  /** The (overlap-expanded) box's rect within the AABB canvas's own pixel
   *  space — exactly what cropRotatedRegion is called with. */
  rectPxInAabb: Rect
  cropWidthPx: number
  cropHeightPx: number
}

/** Everything pdfBuilder.ts computes between "expand the box" and "render the
 *  AABB," extracted so the forward generator and the new inverse sync
 *  transform can never drift apart — both call this. */
export function computeBoxRenderGeometry(pkg: MapCutPackage, box: MapCutBox, masterPagePt: PagePointSize): BoxRenderGeometry {
  const expandedFrac = expandRect({ x: box.x, y: box.y, width: box.width, height: box.height }, pkg.overlapPct)
  const cornersPt = rectCorners(expandedFrac, box.rotation).map(([fx, fy]) => [fx * masterPagePt.w, fy * masterPagePt.h])
  const xs = cornersPt.map(([x]) => x)
  const ys = cornersPt.map(([, y]) => y)
  const aabbXPt = Math.min(...xs)
  const aabbYPt = Math.min(...ys)
  const aabbWPt = Math.max(...xs) - aabbXPt
  const aabbHPt = Math.max(...ys) - aabbYPt

  const outputDpi = pkg.outputDpi ?? 300
  let renderScale = outputDpi / 72
  const maxDim = Math.max(aabbWPt, aabbHPt) * renderScale
  if (maxDim > MAX_CANVAS_DIM) renderScale *= MAX_CANVAS_DIM / maxDim

  const rectPxInAabb: Rect = {
    x: (expandedFrac.x * masterPagePt.w - aabbXPt) * renderScale,
    y: (expandedFrac.y * masterPagePt.h - aabbYPt) * renderScale,
    width: expandedFrac.width * masterPagePt.w * renderScale,
    height: expandedFrac.height * masterPagePt.h * renderScale,
  }
  return {
    expandedFrac, aabbXPt, aabbYPt, aabbWPt, aabbHPt, renderScale, rectPxInAabb,
    cropWidthPx: Math.max(1, Math.round(rectPxInAabb.width)),
    cropHeightPx: Math.max(1, Math.round(rectPxInAabb.height)),
  }
}

export interface OutputImagePlacement { imgX: number; imgY: number; imgW: number; imgH: number }

/** Where the (aspect-preserving, centered) crop image lands within the
 *  output page's printable area, in output-page PDF points — extracted from
 *  pdfBuilder.ts's inline letterbox-fit math. */
export function computeOutputImagePlacement(pkg: MapCutPackage, box: MapCutBox, cropWidthPx: number, cropHeightPx: number): OutputImagePlacement {
  const [wPt, hPt] = outputPageDimsPt(pkg, box)
  const area = mapImageArea(wPt, hPt)
  const cropRatio = cropWidthPx / cropHeightPx
  const areaRatio = area.width / area.height
  let imgW: number, imgH: number
  if (cropRatio > areaRatio) {
    imgW = area.width
    imgH = area.width / cropRatio
  } else {
    imgH = area.height
    imgW = area.height * cropRatio
  }
  return { imgX: area.x + (area.width - imgW) / 2, imgY: area.y + (area.height - imgH) / 2, imgW, imgH }
}

/** Everything needed to transform points between a master page and one of
 *  its cut pieces. `outputNaturalSize` is normally just PdfPrintMode's own
 *  already-loaded `naturalSize` for the currently-open (cut) page — no need
 *  to re-derive it, since the component already has it for its own
 *  rendering. `masterPagePt`/`masterNaturalSize` require fetching the
 *  master file's page geometry once (see pdf.ts's getPdfPageGeometry). */
export interface SyncContext {
  pkg: MapCutPackage
  box: MapCutBox
  masterPagePt: PagePointSize
  masterNaturalSize: { w: number; h: number }
  outputNaturalSize: { w: number; h: number }
}

interface SyncGeometry extends BoxRenderGeometry, OutputImagePlacement {
  legacyScaleMaster: number
  legacyScaleOutput: number
  rotation: number
}

function computeSyncGeometry(ctx: SyncContext): SyncGeometry {
  const boxGeom = computeBoxRenderGeometry(ctx.pkg, ctx.box, ctx.masterPagePt)
  const placement = computeOutputImagePlacement(ctx.pkg, ctx.box, boxGeom.cropWidthPx, boxGeom.cropHeightPx)
  const [outputPageWidthPt] = outputPageDimsPt(ctx.pkg, ctx.box)
  return {
    ...boxGeom,
    ...placement,
    legacyScaleMaster: legacyScale({ width: ctx.masterPagePt.w }),
    legacyScaleOutput: legacyScale({ width: outputPageWidthPt }),
    rotation: ctx.box.rotation,
  }
}

/** master-naturalSize point -> [outputPoint, fracX, fracY] where fracX/fracY
 *  are this point's position within the crop image as a 0-1 fraction (used
 *  by the clamped wrapper below to decide "is this actually on this crop"). */
function forwardWithFrac(g: SyncGeometry, masterPt: [number, number]): { point: [number, number]; fracX: number; fracY: number } {
  const ptX = masterPt[0] / g.legacyScaleMaster
  const ptY = masterPt[1] / g.legacyScaleMaster
  const aabbPxX = (ptX - g.aabbXPt) * g.renderScale
  const aabbPxY = (ptY - g.aabbYPt) * g.renderScale
  const cx = g.rectPxInAabb.x + g.rectPxInAabb.width / 2
  const cy = g.rectPxInAabb.y + g.rectPxInAabb.height / 2
  const [rx, ry] = rotatePoint(aabbPxX - cx, aabbPxY - cy, 0, 0, -g.rotation)
  const canvasPxX = g.cropWidthPx / 2 + rx
  const canvasPxY = g.cropHeightPx / 2 + ry
  const fracX = canvasPxX / g.cropWidthPx
  const fracY = canvasPxY / g.cropHeightPx
  const outPtX = g.imgX + fracX * g.imgW
  const outPtY = g.imgY + fracY * g.imgH
  return { point: [outPtX * g.legacyScaleOutput, outPtY * g.legacyScaleOutput], fracX, fracY }
}

/** master-naturalSize point -> this cut piece's own naturalSize point.
 *  Never null — extrapolates past the crop's own edges, so a shape that
 *  partially exits this box's region still renders (clipped visually by the
 *  SVG viewBox, same as any other off-page geometry). */
export function masterPointToOutputPointUnclamped(ctx: SyncContext, masterPt: [number, number]): [number, number] {
  return forwardWithFrac(computeSyncGeometry(ctx), masterPt).point
}

/** Same as above, but returns null if the point falls outside this box's
 *  actual rendered crop region (fracX/fracY outside [0,1]) — use this to
 *  decide whether a master markup is "on" this cut piece at all. */
export function masterPointToOutputPoint(ctx: SyncContext, masterPt: [number, number]): [number, number] | null {
  const { point, fracX, fracY } = forwardWithFrac(computeSyncGeometry(ctx), masterPt)
  if (fracX < 0 || fracX > 1 || fracY < 0 || fracY > 1) return null
  return point
}

/** Exact algebraic inverse of masterPointToOutputPointUnclamped. Every write
 *  path (new markup, vertex/move edits, split/merge/union) uses this to turn
 *  a drawn/edited point back into master-page coordinates before saving. */
export function outputPointToMasterPoint(ctx: SyncContext, outputPt: [number, number]): [number, number] {
  const g = computeSyncGeometry(ctx)
  const outPtX = outputPt[0] / g.legacyScaleOutput
  const outPtY = outputPt[1] / g.legacyScaleOutput
  const fracX = (outPtX - g.imgX) / g.imgW
  const fracY = (outPtY - g.imgY) / g.imgH
  const canvasPxX = fracX * g.cropWidthPx
  const canvasPxY = fracY * g.cropHeightPx
  const cx = g.rectPxInAabb.x + g.rectPxInAabb.width / 2
  const cy = g.rectPxInAabb.y + g.rectPxInAabb.height / 2
  const [rx, ry] = rotatePoint(canvasPxX - g.cropWidthPx / 2, canvasPxY - g.cropHeightPx / 2, 0, 0, g.rotation)
  const aabbPxX = cx + rx
  const aabbPxY = cy + ry
  const ptX = aabbPxX / g.renderScale + g.aabbXPt
  const ptY = aabbPxY / g.renderScale + g.aabbYPt
  return [ptX * g.legacyScaleMaster, ptY * g.legacyScaleMaster]
}

/** The single scalar that scales a LENGTH (e.g. a circle's radius) from
 *  master-naturalSize units to this cut piece's naturalSize units. Sound
 *  because every step of the transform is either a uniform scale or a pure
 *  rotation (both length-preserving up to that one scalar) — see
 *  boxTransform's module doc / plan for the derivation. */
function lengthScaleToOutput(g: SyncGeometry): number {
  const fitScale = g.imgW / g.cropWidthPx // === g.imgH / g.cropHeightPx by the aspect-preserving fit
  return (1 / g.legacyScaleMaster) * g.renderScale * fitScale * g.legacyScaleOutput
}

export function transformGeometryToOutput(ctx: SyncContext, geo: MarkupGeometry): MarkupGeometry {
  const g = computeSyncGeometry(ctx)
  const tp = (p: [number, number]): [number, number] => forwardWithFrac(g, p).point
  const out: MarkupGeometry = {}
  if (geo.latlngs) out.latlngs = geo.latlngs.map(tp)
  if (geo.bounds) out.bounds = [tp(geo.bounds[0]), tp(geo.bounds[1])]
  if (geo.center) out.center = tp(geo.center)
  if (geo.radius != null) out.radius = geo.radius * lengthScaleToOutput(g)
  return out
}

export function transformGeometryToMaster(ctx: SyncContext, geo: MarkupGeometry): MarkupGeometry {
  const g = computeSyncGeometry(ctx)
  const tp = (p: [number, number]) => outputPointToMasterPoint(ctx, p)
  const out: MarkupGeometry = {}
  if (geo.latlngs) out.latlngs = geo.latlngs.map(tp)
  if (geo.bounds) out.bounds = [tp(geo.bounds[0]), tp(geo.bounds[1])]
  if (geo.center) out.center = tp(geo.center)
  if (geo.radius != null) out.radius = geo.radius / lengthScaleToOutput(g)
  return out
}

/** True if any defining point of geo (in master-naturalSize units) falls
 *  within this box's rendered crop region — the read-side filter deciding
 *  whether a master markup shows up on this cut piece at all. */
export function geometryIntersectsBox(ctx: SyncContext, geo: MarkupGeometry): boolean {
  const pts: [number, number][] = [
    ...(geo.latlngs ?? []),
    ...(geo.bounds ?? []),
    ...(geo.center ? [geo.center] : []),
  ]
  return pts.some((p) => masterPointToOutputPoint(ctx, p) !== null)
}
