// ---------------------------------------------------------------------------
// PDF Print Reader + KMZ Builder — domain model
//
// A "session" is one uploaded construction print (PDF). The pipeline:
//   1. read the COVER page    → city/county/state/project/feeder/section/sheets
//   2. read the LEGEND page    → colors, symbols, line styles (the Legend)
//   3. detect construction objects, classified via the legend
//   4. review + correct on a map
//   5. export a hierarchical KMZ (Project → Feeder → Section → Type → objects)
// ---------------------------------------------------------------------------

export type ObjectType =
  | 'handhole' // HH boxes
  | 'manhole'
  | 'vault'
  | 'pedestal'
  | 'splice_point'
  | 'tap' // D Tap
  | 'conduit_run' // dotted underground
  | 'aerial_strand' // blue lines
  | 'fiber' // brown lines
  | 'fiber_in_conduit' // green lines (pulled through conduit)
  | 'bore' // bore paths
  | 'road_crossing'

/** How the object is/was built — inferred from legend color + line style. */
export type ConstructionMethod =
  | 'underground'
  | 'aerial'
  | 'bore'
  | 'pulled_through_conduit'
  | 'unknown'

export type LineStyle = 'solid' | 'dotted' | 'dashed' | 'unknown'

export type ObjectStatus = 'pending' | 'approved' | 'rejected'

export interface LngLat {
  lng: number
  lat: number
}

export interface PhotoAttachment {
  id: string
  name: string
  dataUrl: string
  addedAt: string
}

export interface RedlineAttachment {
  id: string
  name: string
  dataUrl: string
  note?: string
  addedAt: string
}

/** Parsed from the cover sheet. */
export interface CoverInfo {
  city?: string
  county?: string
  state?: string
  projectName?: string
  feeder?: string
  section?: string
  sheetIndex: string[]
}

/** One classification rule learned from (or defaulted before) the legend. */
export interface LegendRule {
  objectType: ObjectType
  method: ConstructionMethod
  label: string
  /** OCR keywords / abbreviations that indicate this object. */
  keywords: string[]
  colorName?: string
  lineStyle?: LineStyle
  symbol?: string
  /** True when the legend page corroborated this rule. */
  confirmedByLegend: boolean
  source: 'default' | 'legend'
}

export interface Legend {
  rules: LegendRule[]
  legendPageIndex: number | null
  /** Raw legend lines captured for display. */
  entries: string[]
}

export interface DetectedObject {
  id: string
  sessionId: string
  type: ObjectType
  label: string
  status: ObjectStatus
  /** Map position (draggable). Seeded near the session center until placed. */
  position: LngLat
  /** Optional polyline for linear objects (conduit/strand/fiber/bore/crossing). */
  path?: LngLat[]

  // --- Engineering attributes (spec) ---
  feeder?: string
  section?: string
  fiberCount?: number
  footage?: number
  spanLength?: number
  constructionMethod: ConstructionMethod
  roadName?: string

  // --- Workflow / context ---
  sheet?: string
  notes?: string
  /** 0–1 detector confidence; manual adds are 1. */
  confidence: number
  photos: PhotoAttachment[]
  redlines: RedlineAttachment[]
  productionQuantity?: number
  billingQuantity?: number
  crewAssignment?: string

  createdAt: string
  updatedAt: string
}

/** Structured text pulled from the print by OCR. */
export interface PrintExtraction {
  cover: CoverInfo
  streets: string[]
  sheets: string[]
  stations: string[]
  footageLabels: string[]
  spanLengths: string[]
  feeders: string[]
  sections: string[]
  fiberCounts: string[]
  notes: string[]
  legendPageIndex: number | null
  rawText: string
}

export interface PrintSession {
  id: string
  fileName: string
  createdAt: string
  pageCount: number
  /** Downscaled page previews (persisted). Full-res lives in an in-memory cache. */
  thumbnails: string[]
  extraction: PrintExtraction
  legend: Legend
  /** Default map center used to seed object positions. */
  center: LngLat
  objects: DetectedObject[]
  /** Optional link to a Fiberlytic project so field crews can access this print. */
  projectId?: string
}

// --- Display metadata --------------------------------------------------------

export const OBJECT_TYPES: {
  type: ObjectType
  label: string
  color: string
  linear: boolean
  defaultMethod: ConstructionMethod
}[] = [
  { type: 'handhole', label: 'Handhole', color: '#0891b2', linear: false, defaultMethod: 'underground' },
  { type: 'manhole', label: 'Manhole', color: '#0e7490', linear: false, defaultMethod: 'underground' },
  { type: 'vault', label: 'Vault', color: '#0d9488', linear: false, defaultMethod: 'underground' },
  { type: 'pedestal', label: 'Pedestal', color: '#16a34a', linear: false, defaultMethod: 'aerial' },
  { type: 'splice_point', label: 'Splice Point', color: '#ea580c', linear: false, defaultMethod: 'underground' },
  { type: 'tap', label: 'D Tap', color: '#f59e0b', linear: false, defaultMethod: 'underground' },
  { type: 'conduit_run', label: 'Conduit Run', color: '#1b5cf5', linear: true, defaultMethod: 'underground' },
  { type: 'aerial_strand', label: 'Aerial Strand', color: '#2563eb', linear: true, defaultMethod: 'aerial' },
  { type: 'fiber', label: 'Fiber', color: '#92400e', linear: true, defaultMethod: 'unknown' },
  { type: 'fiber_in_conduit', label: 'Fiber in Conduit', color: '#15803d', linear: true, defaultMethod: 'pulled_through_conduit' },
  { type: 'bore', label: 'Bore Path', color: '#7c3aed', linear: true, defaultMethod: 'bore' },
  { type: 'road_crossing', label: 'Road Crossing', color: '#dc2626', linear: true, defaultMethod: 'bore' },
]

export const objectMeta = (type: ObjectType) =>
  OBJECT_TYPES.find((t) => t.type === type) ?? OBJECT_TYPES[0]

export const CONSTRUCTION_METHODS: { value: ConstructionMethod; label: string }[] = [
  { value: 'underground', label: 'Underground' },
  { value: 'aerial', label: 'Aerial' },
  { value: 'bore', label: 'Bore' },
  { value: 'pulled_through_conduit', label: 'Pulled Through Conduit' },
  { value: 'unknown', label: 'Unknown' },
]

export const methodLabel = (m: ConstructionMethod) =>
  CONSTRUCTION_METHODS.find((x) => x.value === m)?.label ?? 'Unknown'
