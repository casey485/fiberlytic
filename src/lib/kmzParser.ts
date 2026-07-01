/**
 * KMZ / KML parser for production tracking.
 * Converts KMZ/KML files into MapFeature-ready records with geometry,
 * layer names, styles, and extended data extracted from the KML.
 */
import JSZip from 'jszip'
import type { FeatureStatus, FeatureType, MapFeature } from '../types'

let _seq = 0
function genId() { return `mf-${Date.now().toString(36)}-${(_seq++).toString(36)}` }

// Module-level cache of embedded KMZ image data URLs, keyed by path and basename.
// Reset at the start of each parseKmzOrKml call.
let _iconDataUrls: Record<string, string> = {}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/** Convert KML AABBGGRR (or 6-char RRGGBB) to CSS #rrggbb. */
function kmlColorToCss(raw: string): string | null {
  const hex = raw.replace('#', '').trim().toLowerCase()
  if (hex.length === 8) {
    const r = hex.slice(6, 8)
    const g = hex.slice(4, 6)
    const b = hex.slice(2, 4)
    return `#${r}${g}${b}`
  }
  if (hex.length === 6) return `#${hex}`
  return null
}

// ---------------------------------------------------------------------------
// Icon href helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a raw icon href from KML to a usable URL.
 * - http/https URLs are returned as-is (Google Earth built-in icons, etc.)
 * - Relative paths (e.g. "files/splice.png" from inside a KMZ) are looked up
 *   in _iconDataUrls and returned as a data URI.
 */
function resolveIconHref(href: string | null | undefined): string | null {
  if (!href) return null
  const h = href.trim()
  if (!h) return null
  if (h.startsWith('http://') || h.startsWith('https://')) return h
  if (_iconDataUrls[h]) return _iconDataUrls[h]
  const basename = h.split('/').pop() ?? h
  if (basename && _iconDataUrls[basename]) return _iconDataUrls[basename]
  return null
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

type LngLat = [number, number]

function parseCoords(text: string): LngLat[] {
  return text
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const parts = pair.split(',')
      const lng = parseFloat(parts[0])
      const lat = parseFloat(parts[1])
      return [lng, lat] as LngLat
    })
    .filter(([lng, lat]) => !isNaN(lng) && !isNaN(lat))
}

/** Haversine distance in feet between two [lng, lat] pairs. */
function distFt(a: LngLat, b: LngLat): number {
  const R = 20902231.5 // Earth radius in feet
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const aVal =
    sinLat * sinLat +
    Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * sinLng * sinLng
  return 2 * R * Math.asin(Math.sqrt(aVal))
}

function polylineLengthFt(coords: LngLat[]): number {
  let total = 0
  for (let i = 1; i < coords.length; i++) total += distFt(coords[i - 1], coords[i])
  return Math.round(total)
}

// ---------------------------------------------------------------------------
// GeoJSON geometry types (minimal, no external dep)
// ---------------------------------------------------------------------------

type GeoPoint        = { type: 'Point';            coordinates: LngLat }
type GeoLine         = { type: 'LineString';        coordinates: LngLat[] }
type GeoPolygon      = { type: 'Polygon';           coordinates: LngLat[][] }
type GeoMultiLine    = { type: 'MultiLineString';   coordinates: LngLat[][] }
type GeoMultiPolygon = { type: 'MultiPolygon';      coordinates: LngLat[][][] }
type Geometry = GeoPoint | GeoLine | GeoPolygon | GeoMultiLine | GeoMultiPolygon

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function directChild(el: Element, tag: string): Element | null {
  for (const c of Array.from(el.children)) {
    if (c.localName === tag) return c
  }
  return null
}

function directChildren(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === tag)
}

function text(el: Element, tag: string): string | null {
  const t = directChild(el, tag)?.textContent?.trim()
  return t || null  // treat empty/whitespace-only as null
}

// ---------------------------------------------------------------------------
// Style collection pass
// ---------------------------------------------------------------------------

interface StyleInfo {
  color: string | null
  iconHref: string | null
}

function collectStyles(doc: Document): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>()
  for (const styleEl of Array.from(doc.querySelectorAll('Style'))) {
    const id = styleEl.getAttribute('id')
    if (!id) continue
    const colorEl =
      styleEl.querySelector('LineStyle > color') ??
      styleEl.querySelector('PolyStyle > color') ??
      styleEl.querySelector('IconStyle > color')
    const color = colorEl?.textContent ? kmlColorToCss(colorEl.textContent) : null
    const rawIconHref = styleEl.querySelector('IconStyle > Icon > href')?.textContent ?? null
    const iconHref = resolveIconHref(rawIconHref)
    if (color !== null || iconHref !== null) {
      styles.set(id, { color, iconHref })
    }
  }
  // StyleMap — map id to normal Pair's style
  for (const smEl of Array.from(doc.querySelectorAll('StyleMap'))) {
    const id = smEl.getAttribute('id')
    if (!id) continue
    for (const pairEl of Array.from(smEl.querySelectorAll('Pair'))) {
      const key = directChild(pairEl, 'key')?.textContent?.trim()
      if (key !== 'normal') continue
      const url = directChild(pairEl, 'styleUrl')?.textContent?.trim().replace('#', '')
      if (url && styles.has(url)) styles.set(id, styles.get(url)!)
      break
    }
  }
  return styles
}

// ---------------------------------------------------------------------------
// Extended data
// ---------------------------------------------------------------------------

function parseExtendedData(pmEl: Element): Record<string, string> | null {
  const edEl = directChild(pmEl, 'ExtendedData')
  if (!edEl) return null
  const out: Record<string, string> = {}
  for (const dataEl of directChildren(edEl, 'Data')) {
    const name = dataEl.getAttribute('name')
    const val  = directChild(dataEl, 'value')?.textContent?.trim()
    if (name && val != null) out[name] = val
  }
  for (const sdEl of directChildren(edEl, 'SimpleData')) {
    const name = sdEl.getAttribute('name')
    const val  = sdEl.textContent?.trim()
    if (name && val != null) out[name] = val
  }
  return Object.keys(out).length ? out : null
}

// ---------------------------------------------------------------------------
// Geometry extraction
// ---------------------------------------------------------------------------

function coordsOf(el: Element): LngLat[] {
  const coordsEl = directChild(el, 'coordinates') ?? el.querySelector('coordinates')
  return parseCoords(coordsEl?.textContent ?? '')
}

function extractPolygon(polyEl: Element): GeoPolygon | null {
  const outerEl = directChild(polyEl, 'outerBoundaryIs') ?? polyEl.querySelector('outerBoundaryIs')
  if (!outerEl) return null
  const lrEl = directChild(outerEl, 'LinearRing') ?? outerEl.querySelector('LinearRing')
  if (!lrEl) return null
  const outer = coordsOf(lrEl)
  if (outer.length < 3) return null
  const rings: LngLat[][] = [outer]
  for (const innerEl of Array.from(polyEl.querySelectorAll('innerBoundaryIs LinearRing'))) {
    const inner = coordsOf(innerEl)
    if (inner.length >= 3) rings.push(inner)
  }
  return { type: 'Polygon', coordinates: rings }
}

function extractMultiGeometry(mgEl: Element): Geometry | null {
  const lines: LngLat[][] = []
  const polygonRings: LngLat[][][] = []
  let firstPoint: LngLat | null = null

  for (const child of Array.from(mgEl.children)) {
    switch (child.localName) {
      case 'LineString': {
        const c = coordsOf(child)
        if (c.length >= 2) lines.push(c)
        break
      }
      case 'Polygon': {
        const g = extractPolygon(child)
        if (g) polygonRings.push(g.coordinates)
        break
      }
      case 'Point': {
        if (!firstPoint) {
          const c = coordsOf(child)
          if (c.length) firstPoint = c[0]
        }
        break
      }
      case 'MultiGeometry': {
        // Recursively handle nested MultiGeometry
        const nested = extractMultiGeometry(child)
        if (nested) {
          if (nested.type === 'LineString') lines.push(nested.coordinates as LngLat[])
          else if (nested.type === 'MultiLineString') {
            for (const seg of nested.coordinates as LngLat[][]) lines.push(seg)
          } else if (nested.type === 'Polygon') polygonRings.push(nested.coordinates as LngLat[][])
          else if (nested.type === 'MultiPolygon') {
            for (const r of nested.coordinates as LngLat[][][]) polygonRings.push(r)
          }
        }
        break
      }
    }
  }

  if (lines.length > 0 && polygonRings.length === 0) {
    return lines.length === 1
      ? { type: 'LineString', coordinates: lines[0] }
      : { type: 'MultiLineString', coordinates: lines }
  }
  if (polygonRings.length > 0 && lines.length === 0) {
    return polygonRings.length === 1
      ? { type: 'Polygon', coordinates: polygonRings[0] }
      : { type: 'MultiPolygon', coordinates: polygonRings }
  }
  if (polygonRings.length > 0 && lines.length > 0) {
    // Mixed: keep polygon outlines as additional line segments so nothing is lost
    const allLines = [...lines, ...polygonRings.map((r) => r[0])]
    return allLines.length === 1
      ? { type: 'LineString', coordinates: allLines[0] }
      : { type: 'MultiLineString', coordinates: allLines }
  }
  if (firstPoint) return { type: 'Point', coordinates: firstPoint }
  return null
}

function extractGeometry(pmEl: Element): Geometry | null {
  // IMPORTANT: check MultiGeometry FIRST using directChild, not querySelector.
  // Using querySelector for LineString/Polygon would match elements nested
  // inside a MultiGeometry child, causing multi-part features to collapse to
  // only their first segment.
  const mgEl = directChild(pmEl, 'MultiGeometry')
  if (mgEl) return extractMultiGeometry(mgEl)

  // Use directChild for single-geometry types to avoid matching across nesting.
  const ptEl = directChild(pmEl, 'Point')
  if (ptEl) {
    const c = coordsOf(ptEl)
    if (c.length) return { type: 'Point', coordinates: c[0] }
  }

  const lsEl = directChild(pmEl, 'LineString')
  if (lsEl) {
    const c = coordsOf(lsEl)
    if (c.length >= 2) return { type: 'LineString', coordinates: c }
  }

  const polyEl = directChild(pmEl, 'Polygon')
  if (polyEl) return extractPolygon(polyEl)

  return null
}

// ---------------------------------------------------------------------------
// Feature type + length
// ---------------------------------------------------------------------------

function featureTypeOf(geo: Geometry): FeatureType {
  if (geo.type === 'Point') return 'point'
  if (geo.type === 'Polygon' || geo.type === 'MultiPolygon') return 'polygon'
  return 'line'
}

function calcLengthFt(geo: Geometry): number | null {
  if (geo.type === 'LineString') return polylineLengthFt(geo.coordinates as LngLat[])
  if (geo.type === 'MultiLineString') {
    const total = (geo.coordinates as LngLat[][]).reduce((s, seg) => s + polylineLengthFt(seg), 0)
    return total || null
  }
  return null
}

// ---------------------------------------------------------------------------
// Auto-detect fiber-specific fields from name / description / extended data
// ---------------------------------------------------------------------------

function detectFiberFields(
  name: string | null,
  desc: string | null,
  ext: Record<string, string> | null,
): { fiberCount: number | null; feederName: string | null } {
  const all = [name, desc, ...Object.values(ext ?? {})].filter(Boolean).join(' ')
  // Fiber count: "144-count", "288ct", "24f", "48 fiber"
  const fiberMatch = all.match(/(\d+)\s*[-]?\s*(count|ct|fiber|f)\b/i)
  const fiberCount = fiberMatch ? parseInt(fiberMatch[1]) : null
  // Feeder name: "F1", "Feeder 2", "F-3", look in ext data first
  const feederMatch =
    (ext?.['feeder'] ?? ext?.['Feeder'] ?? ext?.['feeder_name'] ?? all.match(/\bF[-\s]?(\d+)\b/i)?.[0]) ?? null
  return { fiberCount, feederName: typeof feederMatch === 'string' ? feederMatch : null }
}

// ---------------------------------------------------------------------------
// Name extraction — tries multiple sources in priority order
// ---------------------------------------------------------------------------

// Common ExtendedData field names used by fiber management software for
// the display name (OSSI, Vetro, Smallworld, GE, Comsof, etc.)
const NAME_FIELDS = [
  'Name', 'name', 'FEATURE_NAME', 'FeatureName', 'Feature Name',
  'label', 'Label', 'title', 'Title', 'LABEL', 'DESCRIPTION',
  'CableName', 'Cable Name', 'CABLE_NAME', 'SpliceName', 'Splice Name',
  'ConduitName', 'Conduit Name', 'PoleName', 'Pole Name', 'VaultName',
  'AssetName', 'Asset Name', 'ASSET_NAME', 'DisplayName', 'Display Name',
]

function extractName(pmEl: Element, ext: Record<string, string> | null): string | null {
  // 1. Standard KML <name>
  const kmlName = text(pmEl, 'name')
  if (kmlName) return kmlName

  // 2. ExtendedData — common name fields used by fiber management software
  if (ext) {
    for (const field of NAME_FIELDS) {
      const v = ext[field]
      if (v && v.trim()) return v.trim()
    }
  }

  // 3. Placemark id attribute (e.g. <Placemark id="splice_001">)
  const pmId = pmEl.getAttribute('id')
  if (pmId && pmId.trim()) return pmId.trim()

  return null
}

// ---------------------------------------------------------------------------
// Placemark parsing
// ---------------------------------------------------------------------------

interface RawFeature {
  id: string
  layerName: string
  featureType: FeatureType
  name: string | null
  description: string | null
  geometry: Geometry
  styleColor: string | null
  iconHref: string | null
  extendedData: Record<string, string> | null
  calculatedLengthFt: number | null
  fiberCount: number | null
  feederName: string | null
}

function parsePlacemark(
  pmEl: Element,
  layerName: string,
  styles: Map<string, StyleInfo>,
): RawFeature | null {
  const geo = extractGeometry(pmEl)
  if (!geo) return null

  const desc = text(pmEl, 'description')
  const ext  = parseExtendedData(pmEl)
  const name = extractName(pmEl, ext)

  // Resolve style info (color + icon) from referenced style or inline style
  const styleUrl = text(pmEl, 'styleUrl')?.replace('#', '')
  const styleInfo = styleUrl ? styles.get(styleUrl) ?? null : null

  const inlineColorEl = pmEl.querySelector('LineStyle > color, PolyStyle > color, IconStyle > color')
  const inlineColor = inlineColorEl?.textContent ? kmlColorToCss(inlineColorEl.textContent) : null

  const inlineIconHrefRaw = pmEl.querySelector('IconStyle > Icon > href')?.textContent ?? null
  const inlineIconHref = resolveIconHref(inlineIconHrefRaw)

  const styleColor = inlineColor ?? styleInfo?.color ?? null
  const iconHref   = inlineIconHref ?? styleInfo?.iconHref ?? null

  const { fiberCount, feederName } = detectFiberFields(name, desc, ext)

  return {
    id:          genId(),
    layerName,
    featureType: featureTypeOf(geo),
    name,
    description: desc,
    geometry:    geo,
    styleColor,
    iconHref,
    extendedData: ext,
    calculatedLengthFt: calcLengthFt(geo),
    fiberCount,
    feederName,
  }
}

// ---------------------------------------------------------------------------
// Recursive KML element processor
// ---------------------------------------------------------------------------

function processElement(
  el: Element,
  currentLayer: string,
  styles: Map<string, StyleInfo>,
  out: RawFeature[],
) {
  for (const child of Array.from(el.children)) {
    if (child.localName === 'Folder' || child.localName === 'Document') {
      const folderName = text(child, 'name') ?? currentLayer  // text() returns null for empty, so ?? kicks in
      processElement(child, folderName, styles, out)
    } else if (child.localName === 'Placemark') {
      const feature = parsePlacemark(child, currentLayer, styles)
      if (feature) out.push(feature)
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ParsedKmzResult {
  fileName: string
  featureCount: number
  /** Ready to bulk-insert into DataContext (no kmzUploadId / projectId — IDs pre-assigned). */
  features: Omit<MapFeature, 'kmzUploadId' | 'projectId'>[]
}

const IMAGE_EXTS = new Set(['png', 'gif', 'jpg', 'jpeg', 'svg', 'ico'])
const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', ico: 'image/x-icon',
}

export async function parseKmzOrKml(file: File): Promise<ParsedKmzResult> {
  let kmlText: string
  _iconDataUrls = {}

  if (/\.kmz$/i.test(file.name)) {
    const zip = await JSZip.loadAsync(file)

    // Extract all image files from the KMZ archive into data URIs
    for (const [path, zipFile] of Object.entries(zip.files)) {
      if (zipFile.dir) continue
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      if (!IMAGE_EXTS.has(ext)) continue
      const b64 = await zipFile.async('base64')
      const mime = MIME_MAP[ext] ?? 'image/png'
      const dataUrl = `data:${mime};base64,${b64}`
      _iconDataUrls[path] = dataUrl
      const basename = path.split('/').pop() ?? path
      if (basename !== path) _iconDataUrls[basename] = dataUrl
    }

    const kmlFile = Object.values(zip.files).find((f) => f.name.endsWith('.kml'))
    if (!kmlFile) throw new Error('No .kml file found inside KMZ')
    kmlText = await kmlFile.async('text')
  } else {
    kmlText = await file.text()
  }

  const doc = new DOMParser().parseFromString(kmlText, 'text/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error('Invalid KML/XML: ' + parseError.textContent?.slice(0, 100))

  const styles = collectStyles(doc)
  const raw: RawFeature[] = []

  // Use documentElement as root — works for both prefixed (kml:Document) and non-prefixed KML
  const root = doc.documentElement
  processElement(root, file.name.replace(/\.(kmz|kml)$/i, ''), styles, raw)

  const features: Omit<MapFeature, 'kmzUploadId' | 'projectId'>[] = raw.map((r) => ({
    id:                 r.id,
    layerName:          r.layerName,
    featureType:        r.featureType,
    name:               r.name,
    description:        r.description,
    geometryGeoJson:    JSON.stringify(r.geometry),
    styleColor:         r.styleColor,
    iconHref:           r.iconHref,
    extendedData:       r.extendedData,
    calculatedLengthFt: r.calculatedLengthFt,
    fiberCount:         r.fiberCount,
    feederName:         r.feederName,
    workType:           null,
    installType:        null,
    status:             'not_started' as FeatureStatus,
    assignedCrewId:     null,
  }))

  return { fileName: file.name, featureCount: features.length, features }
}
