/**
 * KMZ / KML importer for fiber-optic construction files.
 *
 * Recognizes aerial support (ADSS, lashed, strand, aerial fiber) and
 * underground support (conduit, innerduct, bore, structures) from both the
 * placemark text and the folder hierarchy that organizes the KMZ.
 */
import JSZip from 'jszip'
import type {
  DetectedObject,
  LngLat,
  PrintSession,
  ObjectType,
  ConstructionMethod,
  ObjectStatus,
} from './types'
import { OBJECT_TYPES } from './types'

let objSeq = 0
const newObjId = (sessId: string) =>
  `${sessId}-imp-${Date.now().toString(36)}-${(objSeq++).toString(36)}`

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function parseLngLat(coord: string): LngLat | null {
  const [lngStr, latStr] = coord.trim().split(',')
  const lng = parseFloat(lngStr)
  const lat = parseFloat(latStr)
  return isNaN(lng) || isNaN(lat) ? null : { lng, lat }
}

function parseCoords(text: string): LngLat[] {
  return text
    .trim()
    .split(/\s+/)
    .map(parseLngLat)
    .filter((p): p is LngLat => p !== null)
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags, decode common entities, collapse whitespace. */
function stripHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(td|th|tr|li|p|div|h\d)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse HTML table / "Key: Value" pairs from a KMZ description.
 * Returns a map of lowercased keys → raw values.
 */
function parseDescriptionKV(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  // Attempt to parse HTML table rows: <tr><td>Key</td><td>Val</td></tr>
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(raw)) !== null) {
    const cells = Array.from(rm[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((m) =>
      stripHtml(m[1]),
    )
    if (cells.length >= 2 && cells[0] && cells[1]) {
      map.set(cells[0].replace(/:$/, '').trim().toLowerCase(), cells[1].trim())
    }
  }
  // Also scan plain "Key: Value" lines in the stripped text
  const plain = stripHtml(raw)
  const lineRe = /^([A-Za-z ]+?):\s*(.+)$/gm
  let lm: RegExpExecArray | null
  while ((lm = lineRe.exec(plain)) !== null) {
    const k = lm[1].trim().toLowerCase()
    if (!map.has(k)) map.set(k, lm[2].trim())
  }
  return map
}

// ---------------------------------------------------------------------------
// Numerical data extraction from free text
// ---------------------------------------------------------------------------

/** Extract footage / length from any text blob. Returns feet. */
function extractFootage(text: string): number | undefined {
  // "250 LF", "250 ft", "250 feet", "250'"
  const m =
    text.match(/(\d[\d,.]*)\s*(?:linear\s*feet?|lf\b|ft\.?\b|feet\b|'(?!\w))/i) ??
    text.match(/length[:\s]+(\d[\d,.]*)/i)
  if (!m) return undefined
  const n = parseFloat(m[1].replace(/,/g, ''))
  return isNaN(n) ? undefined : n
}

/** Extract fiber count from any text blob. */
function extractFiberCount(text: string): number | undefined {
  // "288ct", "48-fiber", "96 count", "24f ", "144 strand"
  const m =
    text.match(/(\d+)\s*(?:ct\b|count\b|-?fiber\b|-?fibre\b|f\b(?!\w)|-?strand\b)/i) ??
    text.match(/(?:fiber|fibre|strand|count|ct)[:\s]+(\d+)/i)
  if (!m) return undefined
  const n = parseInt(m[1], 10)
  return isNaN(n) ? undefined : n
}

/** Extract span length from any text blob. Returns feet. */
function extractSpan(text: string): number | undefined {
  const m = text.match(/span[:\s]+(\d[\d,.]*)\s*(?:ft\.?|feet|')?/i)
  if (!m) return undefined
  const n = parseFloat(m[1].replace(/,/g, ''))
  return isNaN(n) ? undefined : n
}

// ---------------------------------------------------------------------------
// Extended data
// ---------------------------------------------------------------------------

function extDataMap(pm: Element): Map<string, string> {
  const map = new Map<string, string>()
  for (const data of Array.from(pm.querySelectorAll('ExtendedData Data'))) {
    const name = data.getAttribute('name')
    const value = data.querySelector('value')?.textContent?.trim()
    if (name && value != null) map.set(name, value)
  }
  // Also handle SimpleData (used by ArcGIS / QGIS exports)
  for (const sd of Array.from(pm.querySelectorAll('ExtendedData SimpleData'))) {
    const name = sd.getAttribute('name')
    const value = sd.textContent?.trim()
    if (name && value) map.set(name.toLowerCase(), value)
  }
  return map
}

// ---------------------------------------------------------------------------
// Folder hierarchy
// ---------------------------------------------------------------------------

/** Collect all ancestor Folder names, outermost first. */
function folderNames(el: Element): string[] {
  const names: string[] = []
  let p = el.parentElement
  while (p) {
    if (p.tagName === 'Folder') {
      const name = Array.from(p.children)
        .find((c) => c.tagName === 'name')
        ?.textContent?.trim()
      if (name) names.unshift(name)
    }
    p = p.parentElement
  }
  return names
}

/** True when any folder name matches the given pattern. */
function folderMatches(folders: string[], re: RegExp): boolean {
  return folders.some((f) => re.test(f))
}

// ---------------------------------------------------------------------------
// Context signals from folder names
// ---------------------------------------------------------------------------

/** Folders that strongly indicate aerial construction. */
const AERIAL_FOLDER_RE =
  /\baer(ial)?\b|\boverhead\b|\bo\.?h\.?\b|\bstrand\b|\badss\b|\blash(ed|ing)?\b|\bpole\b|\battachment\b|\babove.?ground\b/i

/** Folders that strongly indicate underground construction. */
const UG_FOLDER_RE =
  /\bunderground\b|\bu\.?g\.?\b|\bconduit\b|\bduct\b|\bburied\b|\bdirect.?bury\b|\bdirectional\b|\bbore\b/i

/** Folders that indicate splicing work. */
const SPLICE_FOLDER_RE = /\bsplic(e|ing)\b|\bclosure\b/i

/** Folders that indicate bore / directional drill. */
const BORE_FOLDER_RE = /\bbore\b|\bdirectional.?drill\b|\bhdd\b/i

// ---------------------------------------------------------------------------
// Fiber-infrastructure classification
// ---------------------------------------------------------------------------

/**
 * Classify a placemark into an ObjectType + ConstructionMethod using
 * ALL available signals: label, description, extended data, folders,
 * and whether a polyline path is present.
 */
function classify(
  label: string,
  descText: string,
  ext: Map<string, string>,
  folders: string[],
  hasLine: boolean,
): { type: ObjectType; constructionMethod: ConstructionMethod } {
  // Combine every text signal into one searchable string
  const allParts = [label, descText, ...ext.values(), ...folders]
  const t = allParts.join(' ').toLowerCase()

  // ── Folder-level context ───────────────────────────────────────────────
  const aerialCtx = folderMatches(folders, AERIAL_FOLDER_RE)
  const ugCtx = folderMatches(folders, UG_FOLDER_RE) || folderMatches(folders, BORE_FOLDER_RE)
  const spliceCtx = folderMatches(folders, SPLICE_FOLDER_RE)
  const boreCtx = folderMatches(folders, BORE_FOLDER_RE)

  // ── Point structures — match regardless of hasLine ─────────────────────

  // Handholes
  if (/\bhand[\s-]?holes?\b|\bh\.?h\b|\bhh-?\d/i.test(t))
    return { type: 'handhole', constructionMethod: 'underground' }

  // Manholes
  if (/\bman[\s-]?holes?\b|\bm\.?h\b|\bmh-?\d/i.test(t))
    return { type: 'manhole', constructionMethod: 'underground' }

  // Vaults (but "vault" can appear in linear descriptions — only treat as vault if not a clear linear)
  if (/\bvaults?\b/i.test(t) && !hasLine)
    return { type: 'vault', constructionMethod: 'underground' }

  // Pedestals / terminals / network access points / closure boxes
  if (
    /\bpedestals?\b|\bpeds?\b(?!\w)|\bterm(inal)?\b|\bnaps?\b|\bnetwork[\s-]?access[\s-]?point\b|\bsubscriber\b|\bdistrib(ution)?[\s-]?box\b/i.test(
      t,
    ) && !hasLine
  )
    return { type: 'pedestal', constructionMethod: 'aerial' }

  // Splices / closures
  if (/\bsplic(e|ing)\b|\bspl\.?\b|\bclosure\b|\bfiber[\s-]?case\b/i.test(t) && !hasLine)
    return {
      type: 'splice_point',
      constructionMethod: aerialCtx || spliceCtx ? 'aerial' : 'underground',
    }

  // D-Taps
  if (/\bd[\s-]?tap\b|\bdtap\b|\bdistribution[\s-]?tap\b/i.test(t) && !hasLine)
    return { type: 'tap', constructionMethod: 'underground' }

  // ── Linear objects ──────────────────────────────────────────────────────
  if (hasLine) {
    // Bore / HDD — highest priority for linear
    if (/\bbore\b|\bdirectional[\s-]?drill\b|\bhdd\b|\bhorizontal[\s-]?directional/i.test(t) || boreCtx)
      return { type: 'bore', constructionMethod: 'bore' }

    // Road / railroad crossings
    if (/\bcrossing\b|\bxing\b|\brd[\s-]?x\b|\broad[\s-]?cross/i.test(t))
      return { type: 'road_crossing', constructionMethod: 'bore' }

    // Conduit / innerduct — underground linear
    if (
      /\bconduit\b|\binnerduct\b|\binner[\s-]?duct\b|\bductbank\b|\bduct[\s-]?bank\b|\bpvc\b|\bhdpe\b/i.test(t) &&
      !aerialCtx
    )
      return { type: 'conduit_run', constructionMethod: 'underground' }

    // Aerial cable — ADSS, lashed, strand, messenger, aerial explicitly
    if (
      /\badss\b|\blash(ed|ing)?\b|\bstrand\b|\bmessenger\b|\baerial[\s-]?fiber\b|\baerial[\s-]?cable\b|\baerial[\s-]?plant\b/i.test(t) ||
      aerialCtx
    )
      return { type: 'aerial_strand', constructionMethod: 'aerial' }

    // Fiber in conduit — underground fiber pulled through conduit
    if (
      /\bfiber[\s-]?in[\s-]?conduit\b|\bfic\b|\bpulled[\s-]?through\b|\bpull[\s-]?through\b|\bdirect[\s-]?buried?\b|\bdirect[\s-]?bury\b/i.test(
        t,
      ) || ugCtx
    )
      return { type: 'fiber_in_conduit', constructionMethod: 'pulled_through_conduit' }

    // Generic fiber / cable — disambiguate by context
    if (/\bfibers?\b|\bfibre\b|\boptical\b|\bfo\b(?!\w)|\bcable\b|\bplant\b/i.test(t)) {
      if (aerialCtx) return { type: 'aerial_strand', constructionMethod: 'aerial' }
      if (ugCtx) return { type: 'fiber_in_conduit', constructionMethod: 'pulled_through_conduit' }
      return { type: 'fiber', constructionMethod: 'unknown' }
    }

    // Contextual fallbacks for unrecognized linear objects
    if (aerialCtx) return { type: 'aerial_strand', constructionMethod: 'aerial' }
    if (ugCtx) return { type: 'conduit_run', constructionMethod: 'underground' }
    if (boreCtx) return { type: 'bore', constructionMethod: 'bore' }
  }

  // ── Point fallbacks ─────────────────────────────────────────────────────
  if (aerialCtx) return { type: 'pedestal', constructionMethod: 'aerial' }
  if (ugCtx) return { type: 'handhole', constructionMethod: 'underground' }
  if (spliceCtx) return { type: 'splice_point', constructionMethod: 'unknown' }

  return { type: 'handhole', constructionMethod: 'unknown' }
}

// ---------------------------------------------------------------------------
// StyleUrl → ObjectType (for Fiberlytic-exported KMZs)
// ---------------------------------------------------------------------------

function styleUrlToType(styleUrl: string): ObjectType | null {
  const id = styleUrl.replace(/^#/, '').split('/').pop() ?? ''
  const found = OBJECT_TYPES.find((t) => t.type === id || id.startsWith(t.type))
  return found ? found.type : null
}

// ---------------------------------------------------------------------------
// KML file extraction
// ---------------------------------------------------------------------------

async function getKmlText(file: File): Promise<string> {
  if (/\.kml$/i.test(file.name)) return file.text()
  const zip = await JSZip.loadAsync(file.arrayBuffer())
  // Prefer doc.kml, then any .kml entry
  const entries = Object.entries(zip.files).filter(([n, e]) => n.endsWith('.kml') && !e.dir)
  const entry = entries.find(([n]) => n === 'doc.kml') ?? entries[0]
  if (!entry) throw new Error('No KML file found inside the KMZ archive.')
  return entry[1].async('string')
}

// ---------------------------------------------------------------------------
// Main import
// ---------------------------------------------------------------------------

export async function importKmz(file: File, sessionId: string): Promise<PrintSession> {
  const kmlText = await getKmlText(file)

  const xmlDoc = new DOMParser().parseFromString(kmlText, 'text/xml')
  if (xmlDoc.querySelector('parsererror')) {
    throw new Error('The KML could not be parsed — the file may be corrupt.')
  }

  const projectName =
    Array.from(xmlDoc.querySelectorAll('Document > name'))
      .map((n) => n.textContent?.trim())
      .find(Boolean) ?? file.name.replace(/\.(kmz|kml)$/i, '')

  const now = new Date().toISOString()
  const objects: DetectedObject[] = []

  // Collect unique feeders/sections/streets found during import for the extraction record
  const feedersFound = new Set<string>()
  const sectionsFound = new Set<string>()
  const streetsFound = new Set<string>()

  for (const pm of Array.from(xmlDoc.querySelectorAll('Placemark'))) {
    const label = pm.querySelector('name')?.textContent?.trim() ?? 'Object'
    const rawDesc = pm.querySelector('description')?.textContent ?? ''
    const descText = stripHtml(rawDesc)
    const descKV = parseDescriptionKV(rawDesc)
    const ext = extDataMap(pm)
    const folders = folderNames(pm)
    const styleUrl = pm.querySelector('styleUrl')?.textContent?.trim() ?? ''

    // Merge description key-value pairs into ext (ext takes precedence)
    for (const [k, v] of descKV) {
      if (!ext.has(k)) ext.set(k, v)
    }

    // ── Geometry ──────────────────────────────────────────────────────────
    const pointCoord = pm.querySelector('Point > coordinates')?.textContent
    const lineCoord = pm.querySelector('LineString > coordinates')?.textContent

    let position: LngLat | undefined
    let path: LngLat[] | undefined

    if (lineCoord) {
      path = parseCoords(lineCoord)
      if (path.length >= 2) position = path[Math.floor(path.length / 2)]
    }
    if (pointCoord) {
      position = parseLngLat(pointCoord) ?? undefined
    }
    if (!position) continue // skip placemarks with no usable geometry

    const hasLine = !!path && path.length >= 2

    // ── Classification ────────────────────────────────────────────────────
    // Fiberlytic-exported KMZ: styleUrl maps exactly to our ObjectType ids
    const typeFromStyle = styleUrlToType(styleUrl)
    let type: ObjectType
    let constructionMethod: ConstructionMethod

    if (typeFromStyle) {
      type = typeFromStyle
      const methodStr =
        ext.get('constructionMethod') ??
        ext.get('construction_method') ??
        ext.get('construction method') ??
        ''
      const METHOD_MAP: Record<string, ConstructionMethod> = {
        Underground: 'underground',
        Aerial: 'aerial',
        Bore: 'bore',
        'Pulled Through Conduit': 'pulled_through_conduit',
      }
      constructionMethod = METHOD_MAP[methodStr] ?? 'unknown'
    } else {
      const classified = classify(label, descText, ext, folders, hasLine)
      type = classified.type
      constructionMethod = classified.constructionMethod
    }

    // ── Status ────────────────────────────────────────────────────────────
    const statusRaw =
      ext.get('status') ?? ext.get('Status') ?? ext.get('feature_status') ?? 'approved'
    const status: ObjectStatus = ['pending', 'approved', 'rejected'].includes(statusRaw)
      ? (statusRaw as ObjectStatus)
      : 'approved'

    // ── Feeder / Section ─────────────────────────────────────────────────
    const feeder =
      ext.get('feeder') ??
      ext.get('Feeder') ??
      ext.get('feeder_id') ??
      ext.get('route') ??
      ext.get('Route') ??
      folders.find((f) => /^feeder\s/i.test(f))?.replace(/^feeder\s+/i, '') ??
      // Also check if a folder IS the feeder name and we're inside a section sub-folder
      (folders.length >= 2 ? folders[folders.length - 2] : undefined) ??
      undefined

    const section =
      ext.get('section') ??
      ext.get('Section') ??
      ext.get('section_id') ??
      folders.find((f) => /^section\s/i.test(f))?.replace(/^section\s+/i, '') ??
      (folders.length >= 1 ? folders[folders.length - 1] : undefined) ??
      undefined

    if (feeder) feedersFound.add(feeder)
    if (section) sectionsFound.add(section)

    // ── Road / street name ────────────────────────────────────────────────
    const roadName =
      ext.get('roadName') ??
      ext.get('road_name') ??
      ext.get('road name') ??
      ext.get('street') ??
      ext.get('Street') ??
      ext.get('road') ??
      ext.get('location') ??
      descKV.get('street') ??
      descKV.get('road') ??
      descKV.get('location') ??
      undefined
    if (roadName) streetsFound.add(roadName)

    // ── Numerical attributes ─────────────────────────────────────────────
    const allText = [label, descText, ...ext.values()].join(' ')

    const fiberCount =
      (ext.get('fiberCount') ?? ext.get('fiber_count') ?? ext.get('fiber count') ?? ext.get('count') ?? ext.get('strand count')
        ? parseInt(
            ext.get('fiberCount') ??
              ext.get('fiber_count') ??
              ext.get('fiber count') ??
              ext.get('count') ??
              ext.get('strand count') ??
              '',
            10,
          )
        : undefined) ?? extractFiberCount(allText)

    const footage =
      (ext.get('footage') ?? ext.get('length') ?? ext.get('Length') ?? ext.get('distance')
        ? parseFloat(
            ext.get('footage') ??
              ext.get('length') ??
              ext.get('Length') ??
              ext.get('distance') ??
              '',
          )
        : undefined) ?? extractFootage(allText)

    const spanLength =
      (ext.get('spanLength') ?? ext.get('span_length') ?? ext.get('span length') ?? ext.get('span')
        ? parseFloat(
            ext.get('spanLength') ??
              ext.get('span_length') ??
              ext.get('span length') ??
              ext.get('span') ??
              '',
          )
        : undefined) ?? extractSpan(allText)

    // ── Notes — preserve any description not captured elsewhere ───────────
    const notes =
      ext.get('notes') ??
      ext.get('Notes') ??
      ext.get('comment') ??
      ext.get('remarks') ??
      (descText.length > 0 && descText.length < 500 ? descText : undefined) ??
      undefined

    // ── Sheet ─────────────────────────────────────────────────────────────
    const sheet =
      ext.get('sheet') ??
      ext.get('Sheet') ??
      folders.find((f) => /^sheet\s/i.test(f))?.replace(/^sheet\s+/i, '') ??
      undefined

    objects.push({
      id: newObjId(sessionId),
      sessionId,
      type,
      label,
      status,
      position,
      ...(hasLine ? { path } : {}),
      feeder: feeder || undefined,
      section: section || undefined,
      fiberCount: fiberCount && !isNaN(fiberCount) ? fiberCount : undefined,
      footage: footage && !isNaN(footage) ? footage : undefined,
      spanLength: spanLength && !isNaN(spanLength) ? spanLength : undefined,
      constructionMethod,
      roadName: roadName || undefined,
      sheet: sheet || undefined,
      notes: notes || undefined,
      confidence: typeFromStyle ? 1 : 0.85,
      photos: [],
      redlines: [],
      productionQuantity:
        ext.get('productionQuantity') ? parseFloat(ext.get('productionQuantity')!) : undefined,
      billingQuantity:
        ext.get('billingQuantity') ? parseFloat(ext.get('billingQuantity')!) : undefined,
      crewAssignment: ext.get('crewAssignment') || ext.get('crew') || undefined,
      createdAt: now,
      updatedAt: now,
    })
  }

  // ── Session center: centroid of all object positions ──────────────────
  const center =
    objects.length > 0
      ? {
          lng: objects.reduce((s, o) => s + o.position.lng, 0) / objects.length,
          lat: objects.reduce((s, o) => s + o.position.lat, 0) / objects.length,
        }
      : { lng: -91.6656, lat: 41.9779 }

  // Unique feeder/section/street lists from all parsed objects
  const feeders = [...feedersFound]
  const sections = [...sectionsFound]
  const streets = [...streetsFound]

  return {
    id: sessionId,
    fileName: file.name,
    createdAt: now,
    pageCount: 0,
    thumbnails: [],
    extraction: {
      cover: { projectName, sheetIndex: [] },
      streets,
      sheets: [],
      stations: [],
      footageLabels: [],
      spanLengths: [],
      feeders,
      sections,
      fiberCounts: [],
      notes: [],
      legendPageIndex: null,
      rawText: '',
    },
    legend: { rules: [], legendPageIndex: null, entries: [] },
    center,
    objects,
  }
}
