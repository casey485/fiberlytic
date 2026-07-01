// ---------------------------------------------------------------------------
// Fiberlytic domain model
//
// Fiberlytic tracks fiber-optic construction operations: projects (builds),
// crews doing the work, daily production (footage placed/spliced), the money
// (daily P&L + invoicing), materials inventory, and field photos.
//
// All ids are stable strings. Dates are ISO-8601 date strings ("YYYY-MM-DD")
// so they sort lexically and serialize cleanly into localStorage.
// ---------------------------------------------------------------------------

export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'complete'

/** The kind of fiber work — drives default production units and crew matching. */
export type WorkType = 'aerial' | 'underground' | 'directional_bore' | 'splicing' | 'mdu' | 'cable_plow'

export interface Project {
  id: string
  name: string
  client: string
  /** Optional FK → Client.id; links to rate cards for this project. */
  clientId?: string
  /** FK → RateCard.id — the one rate card billing draws from for this project (a client may have several). */
  rateCardId?: string | null
  /** Geofence polygon vertices as [lng, lat] pairs (Mapbox order). */
  boundary?: [number, number][]
  location: string
  status: ProjectStatus
  workTypes: WorkType[]
  startDate: string
  /** Target completion date. */
  dueDate: string
  /** Total contracted value in USD. */
  contractValue: number
  /** Internal cost budget in USD. */
  budget: number
  /** Total footage to be built (the production goal). */
  footageGoal: number
  /** Footage completed to date (kept in sync from production entries). */
  footageComplete: number
  /** Ids of crews currently assigned. */
  crewIds: string[]
  /** Retention percentage held by client (0.0–1.0). Default 0 if omitted. */
  retentionPct?: number
  notes?: string
}

export type CrewStatus = 'active' | 'idle' | 'off'

/** How labor is priced — drives the production cost calculation. */
export type PayType = 'hourly' | 'daily' | 'production'

/** An individual worker on a crew. */
export interface CrewMember {
  id: string
  /** Optional FK → Employee.id. When set, name/role/payAmount are sourced from that record. */
  employeeId?: string
  name: string
  role: string
  payType: PayType
  /** Hourly rate, daily rate, or $/production-unit depending on payType. */
  payAmount: number
  active: boolean
}

export interface Crew {
  id: string
  name: string
  /** Display name of the foreman (kept for backward compat). */
  foreman: string
  /** FK → Employee.id — links to the foreman's employee record. */
  foremanId?: string
  specialty: WorkType
  status: CrewStatus
  /** Project the crew is currently working, if any. */
  currentProjectId: string | null
  /** Crew-level default pay — used as a fallback when individual employee rates are unavailable. */
  payType: PayType
  payAmount: number
  /** Individual workers from legacy setup — no longer managed in crew setup UI. */
  members: CrewMember[]
  /** @deprecated legacy fields kept so older saved data still loads. */
  size?: number
  /** @deprecated superseded by payType/payAmount + members. */
  dayRate?: number
}

/** One crew's reported output for one day on one project. */
export interface ProductionEntry {
  id: string
  date: string
  projectId: string
  crewId: string
  /** Footage placed/spliced that day (LF total; auto-computed from line items when present). */
  footage: number
  /** Hours worked by the crew that day (drives utilization + cost). */
  hours: number
  notes?: string
  /** Equipment explicitly selected by the crew when logging this day — used for cost calculation. */
  equipmentIds?: string[]
}

/** A daily financial roll-up for a project (the Daily P&L ledger — legacy + auto-generated). */
export interface PnLEntry {
  id: string
  date: string
  projectId: string
  /** Revenue earned that day (typically footage * unit price). */
  revenue: number
  laborCost: number
  materialCost: number
  equipmentCost: number
  otherCost: number
  /** FK → ProductionEntry.id — set when auto-generated from a production entry; allows cascade delete. */
  productionEntryId?: string
}

export type MaterialCategory = 'cable' | 'conduit' | 'hardware' | 'splice' | 'drop' | 'consumable'

export interface Material {
  id: string
  name: string
  sku: string
  category: MaterialCategory
  unit: string
  quantityOnHand: number
  reorderLevel: number
  unitCost: number
  supplier: string
}

export type PhotoCategory = 'before' | 'progress' | 'after' | 'issue' | 'safety'

export interface Photo {
  id: string
  projectId: string
  caption: string
  category: PhotoCategory
  date: string
  uploadedBy: string
  /** Image URL. Use "idb:<key>" for blobs stored in IndexedDB; direct URLs otherwise. */
  url: string
  /** When set, this photo was taken during a production entry. */
  productionEntryId?: string
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue'

export interface InvoiceLineItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
}

export interface Invoice {
  id: string
  number: string
  projectId: string
  client: string
  issueDate: string
  dueDate: string
  status: InvoiceStatus
  lineItems: InvoiceLineItem[]
}

// ---------------------------------------------------------------------------
// Rate Cards — client-specific unit pricing
// ---------------------------------------------------------------------------

export type RateCardDivision = 'Underground' | 'Aerial'
export type UOM = 'LF' | 'EA' | 'SQFT'

export interface Client {
  id: string
  name: string
  /** Which divisions this client has work in — drives rate card guidance. */
  divisions?: RateCardDivision[]
}

export interface RateCard {
  id: string
  clientId: string
  divisions: RateCardDivision[]
  name: string
  effectiveDate: string
}

export interface RateCardUnit {
  id: string
  rateCardId: string
  unitCode: string
  description: string
  uom: UOM
  rate: number
  /** Optional manual work-type tag (e.g. "Directional Drill", "Trenching", "Aerial") for pre-filtering in the Add Work billing step. Falls back to keyword-matching against workObjectTypes.ts's billingKeywords when unset. */
  category?: string
}

// ---------------------------------------------------------------------------
// Employees — named workers with hourly rates (admin-visible only)
// ---------------------------------------------------------------------------

export interface Employee {
  id: string
  name: string
  role: string
  /** Hourly rate — admin/office-only field; never expose on field-facing views. */
  hourlyRate: number
  /** Default crew this employee typically works on. */
  defaultCrewId: string | null
  active: boolean
  /** Marks this employee as a foreman — shown in crew overview and crew day entry. */
  isForeman?: boolean
}

// ---------------------------------------------------------------------------
// Production line items — rate-card-driven unit pricing per production entry
// ---------------------------------------------------------------------------

export interface ProductionLineItem {
  id: string
  productionEntryId: string
  unitCode: string
  description: string
  uom: string
  quantity: number
  /** Rate copied from rate card at time of entry; never recalculates retroactively. */
  rateSnapshot: number
  /** quantity × rateSnapshot */
  extendedTotal: number
}

// ---------------------------------------------------------------------------
// Timecards — per-employee daily hours with rate snapshot
// ---------------------------------------------------------------------------

export interface Timecard {
  id: string
  employeeId: string
  date: string
  /** FK → Project.id */
  jobId: string
  clockIn: string  // "HH:MM" 24h
  clockOut: string // "HH:MM" 24h
  hours: number
  /** Copied from Employee.hourlyRate at time of entry. */
  rateSnapshot: number
  /** hours × rateSnapshot */
  laborCost: number
  /** Set when created via crew day entry — links back to the ProductionEntry. */
  productionEntryId?: string
}

// ---------------------------------------------------------------------------
// Job Expenses — manually entered costs not sourced from timecards/materials
// ---------------------------------------------------------------------------

export interface JobExpense {
  id: string
  date: string
  /** FK → Project.id */
  jobId: string
  vendor: string
  description: string
  amount: number
  /** FK → Crew.id — when set, expense is tied to this crew's daily cost */
  crewId?: string
  /** Job site location or address where the expense was incurred */
  location?: string
}

// ---------------------------------------------------------------------------
// Equipment — crew-assigned assets with monthly cost amortized to a daily rate
// ---------------------------------------------------------------------------

export type EquipmentCategory =
  | 'Bore Rig'
  | 'Bucket Truck'
  | 'Mini Excavator'
  | 'Vac Truck'
  | 'Trailer'
  | 'Trencher'
  | 'Other'

export interface Equipment {
  id: string
  name: string
  category: EquipmentCategory
  description?: string
  /** Monthly rental / lease cost in USD. */
  monthlyCost: number
  /** FK → Crew.id — null if unassigned. */
  crewId: string | null
  /** Date the equipment was deployed to this crew — daily costs auto-generate from this date forward on weekdays. */
  deployedFrom?: string
  active: boolean
}

// ---------------------------------------------------------------------------
// Project Files — PDFs and KMZ plans attached to a project
// ---------------------------------------------------------------------------

export type ProjectFileType = 'pdf' | 'kmz' | 'other'

export interface ProjectFile {
  id: string
  projectId: string
  name: string
  fileType: ProjectFileType
  /** File size in bytes (before base64 encoding). */
  size: number
  uploadedAt: string
  /**
   * Legacy field — present only in data saved before the IndexedDB migration.
   * New files store their blob in IndexedDB (see src/lib/fileStore.ts); this
   * field is auto-migrated to IndexedDB on first load and then removed.
   */
  dataUrl?: string
  /** PDF Print Mode page scale, e.g. 50 for "1 inch = 50 feet". Unset until the user sets it in Print Mode's Advanced Tools menu. */
  pdfScaleFeetPerInch?: number
}

// ---------------------------------------------------------------------------
// Clock-in / geofence entries
// ---------------------------------------------------------------------------

export interface ClockEntry {
  id: string
  employeeId: string
  projectId: string
  /** FK → Crew.id — associates this entry with a crew for cost roll-up */
  crewId?: string
  /** ISO datetime string */
  clockIn: string
  /** ISO datetime string — undefined while still clocked in */
  clockOut?: string
  /** GPS lat at clock-in (0 for manual entries) */
  lat: number
  /** GPS lng at clock-in (0 for manual entries) */
  lng: number
  /** True when the entry was typed in manually rather than captured via GPS */
  manual?: boolean
}

// ---------------------------------------------------------------------------
// KMZ Production Workflow — live job tracking from imported KMZ/KML files
// ---------------------------------------------------------------------------

export type FeatureStatus = 'not_started' | 'in_progress' | 'complete' | 'issue' | 'rework'
export type FeatureType   = 'point' | 'line' | 'polygon'

export const FEATURE_STATUS_META: Record<FeatureStatus, { label: string; color: string; tw: string }> = {
  not_started: { label: 'Not Started', color: '#6b7280', tw: 'bg-slate-500' },
  in_progress:  { label: 'In Progress', color: '#f59e0b', tw: 'bg-amber-400' },
  complete:     { label: 'Complete',    color: '#22c55e', tw: 'bg-green-500' },
  issue:        { label: 'Issue',       color: '#ef4444', tw: 'bg-red-500'   },
  rework:       { label: 'Rework',      color: '#f97316', tw: 'bg-orange-500'},
}

/** Metadata record for one KMZ/KML file imported into a project. */
export interface KmzUpload {
  id: string
  projectId: string
  fileName: string
  uploadedAt: string
  featureCount: number
}

/** One geographic feature parsed from a KMZ/KML import. */
export interface MapFeature {
  id: string
  projectId: string
  kmzUploadId: string
  layerName: string
  featureType: FeatureType
  name: string | null
  description: string | null
  /** JSON-stringified GeoJSON Geometry object (Point / LineString / Polygon). */
  geometryGeoJson: string
  styleColor: string | null
  iconHref: string | null   // resolved icon URL or data URI for Point features
  extendedData: Record<string, string> | null
  calculatedLengthFt: number | null
  fiberCount: number | null
  feederName: string | null
  workType: string | null
  installType: string | null
  status: FeatureStatus
  assignedCrewId: string | null
}

/** Production entry recorded against one map feature by a crew. */
export interface FeatureProductionEntry {
  id: string
  projectId: string
  mapFeatureId: string
  crewId: string
  crewName: string
  date: string            // YYYY-MM-DD
  workType: string | null
  unitCode: string | null
  footageCompleted: number
  rockFootage: number
  handholes: number
  quantity: number
  rate: number
  revenueAmount: number
  laborCost: number
  equipmentCost: number
  materialCost: number
  totalCost: number
  profit: number
  notes: string | null
  status: FeatureStatus
  installType: string | null
  restorationNeeded: boolean
  crewMemberIds: string[]
}

// ---------------------------------------------------------------------------
// Field Markup — crew/supervisor redlines with photos, billing, and workflow
// ---------------------------------------------------------------------------

/** Drawing and feature-drop tools available in the field markup system. */
export type MarkupTool =
  // Drawing
  | 'pen' | 'line' | 'dashed_line' | 'dotted_line'
  | 'multi_line' | 'measure' | 'point'
  | 'arrow' | 'double_arrow'
  | 'rect' | 'circle' | 'ellipse' | 'polygon' | 'cloud' | 'highlight'
  | 'text' | 'callout'
  // Feature drops (point markers)
  | 'handhole' | 'bore' | 'bore_pit' | 'aerial_cable' | 'underground_conduit'
  | 'fiber_pull' | 'splice_point' | 'dtap' | 'pole' | 'pedestal' | 'vault'
  | 'cabinet' | 'slack_loop' | 'restoration' | 'rock' | 'asphalt' | 'concrete'
  | 'traffic_control' | 'material_issue' | 'qc_issue' | 'completed_work' | 'hold'
  // Structure markers — circular labeled markers placed on the field map
  | 'struct_s' | 'struct_m' | 'struct_l' | 'struct_xl'
  | 'struct_fp' | 'struct_lv' | 'struct_xlv'
  | 'struct_ped' | 'struct_cab' | 'struct_hh'

export type MarkupStatus = 'pending' | 'in_progress' | 'complete' | 'qc_needed' | 'rejected' | 'approved' | 'billed'
export type MarkupLayer  = 'crew' | 'supervisor' | 'qc' | 'as_built' | 'production' | 'billing'

export const MARKUP_STATUS_META: Record<MarkupStatus, { label: string; color: string }> = {
  pending:     { label: 'Pending',     color: '#6b7280' },
  in_progress: { label: 'In Progress', color: '#f59e0b' },
  complete:    { label: 'Complete',    color: '#22c55e' },
  qc_needed:   { label: 'QC Needed',   color: '#a855f7' },
  rejected:    { label: 'Rejected',    color: '#ef4444' },
  approved:    { label: 'Approved',    color: '#06b6d4' },
  billed:      { label: 'Billed',      color: '#10b981' },
}

export const MARKUP_LAYER_META: Record<MarkupLayer, { label: string; color: string }> = {
  crew:        { label: 'Crew Markup',      color: '#ef4444' },
  supervisor:  { label: 'Supervisor Notes', color: '#f97316' },
  qc:          { label: 'QC Notes',         color: '#a855f7' },
  as_built:    { label: 'As-Built',         color: '#06b6d4' },
  production:  { label: 'Production',       color: '#22c55e' },
  billing:     { label: 'Billing',          color: '#10b981' },
}

/** Geometry for one markup item — varies by tool. */
export interface MarkupGeometry {
  latlngs?: [number, number][]                    // pen, line, arrow, polygon, polyline
  bounds?:  [[number, number], [number, number]]  // rect
  center?:  [number, number]                      // circle, text, callout, feature drops
  radius?:  number                                // circle (meters)
}

/** One photo attached to a markup item. Blob is stored in IndexedDB under key `mkp-<id>`. */
export interface MarkupPhoto {
  id: string
  markupId: string
  caption: string | null
  takenAt: string          // ISO datetime
  uploadedBy: string | null
  lat: number | null
  lng: number | null
  /** Which required-photo phase this satisfies (e.g. 'before', 'depth_proof') — null for free-form uploads. */
  phase?: PhotoProofType | null
}

/** One billing line tied to a markup item. */
export interface MarkupBilling {
  id: string
  markupId: string
  date?: string | null
  crewId?: string | null
  rateCode: string
  description: string
  unitType: string
  quantity: number
  rate: number
  total: number             // quantity × rate
  billable: boolean
  invoiceStatus: 'not_billed' | 'invoiced' | 'approved' | 'paid'
  notes: string | null
  /** FK → Invoice.id — set once this billing line has been pulled into an invoice's line items. */
  invoiceId?: string | null
}

/** One pole checkpoint in an aerial lash fiber run. Photos stored as MarkupPhoto with markupId = `alf:<runId>:<poleNumber>`. */
export interface AerialPole {
  poleNumber: number
  lat: number
  lng: number
  tickMark: string | null
  notes: string | null
  crewName: string | null
  dateTime: string | null    // ISO datetime
  completed: boolean
}

/** One aerial lash fiber production run — a pole-to-pole line with per-pole tick marks. */
export interface AerialLashFiberRun {
  id: string
  projectId: string
  status: 'in_progress' | 'complete'
  poles: AerialPole[]
  notes: string | null
  totalFootage: number
  totalPoles: number
  color: string
  colorCode: string
  createdAt: string
  updatedAt: string | null
}

// ---------------------------------------------------------------------------
// Work Objects — the 16-type catalog surfaced in the Add Work modal
// (defined in full in src/lib/workObjectTypes.ts; the type ids and photo
// proof enum live here alongside the rest of the domain model)
// ---------------------------------------------------------------------------

export type WorkObjectTypeId =
  | 'aerial_strand' | 'directional_drill' | 'distribution_fiber' | 'feeder_fiber'
  | 'drop' | 'plowing' | 'sub_ducting' | 'trenching'
  | 'handhole_vault' | 'pole' | 'anchor_down_guy' | 'splicing'
  | 'restoration' | 'qa_qc' | 'utility_conflict' | 'damage_report'

/** Which proof/phase a field photo documents — required set varies by WorkObjectTypeId. */
export type PhotoProofType =
  | 'before' | 'during' | 'after'
  | 'rock_proof' | 'depth_proof' | 'restoration_proof' | 'handhole_proof' | 'pole_anchor_proof'
  | 'other'

export const PHOTO_PROOF_META: Record<PhotoProofType, { label: string }> = {
  before:             { label: 'Before' },
  during:             { label: 'During' },
  after:              { label: 'After' },
  rock_proof:         { label: 'Rock Proof' },
  depth_proof:        { label: 'Depth Proof' },
  restoration_proof:  { label: 'Restoration Proof' },
  handhole_proof:     { label: 'Handhole Proof' },
  pole_anchor_proof:  { label: 'Pole / Anchor Proof' },
  other:              { label: 'Other' },
}

/** One markup item: a drawing, annotation, or feature-drop on the field map. */
export interface FieldMarkup {
  id: string
  projectId: string

  // Tool and visual style
  tool: MarkupTool
  /** Sub-category chosen from the toolbar dropdown (e.g. 'measurement_line', 'bore_arrow'). */
  subtype?: string
  /** The Add Work modal's Step 1 type selection — supersedes the coarser `workType` below for new markups. */
  workObjectType?: WorkObjectTypeId
  color: string
  weight: number
  fillColor: string | null
  fillOpacity: number
  opacity: number

  // Geometry
  geometry: MarkupGeometry
  /** Which coordinate space `geometry`'s numbers are in — defaults to 'latlng' for every existing record. 'pdfPage' means the numbers are native PDF page-point units (72/inch), scoped to sourceProjectFileId + pageIndex below, not real-world coordinates. */
  coordSpace?: 'latlng' | 'pdfPage'
  /** FK -> ProjectFile.id — which PDF this markup was drawn on, when coordSpace === 'pdfPage'. */
  sourceProjectFileId?: string | null
  /** Which page (0-indexed) of sourceProjectFileId this markup was drawn on, when coordSpace === 'pdfPage'. */
  pageIndex?: number
  /** Device GPS captured at Details-step time — distinct from the drawn geometry above. */
  capturedLat?: number | null
  capturedLng?: number | null

  // Content
  label: string | null
  fontSize: number
  /** Text/callout formatting — read by markupLayer.ts's text/callout rendering, unused by other tools. */
  fontFamily?: string
  fontBold?: boolean
  fontItalic?: boolean
  fontUnderline?: boolean
  fontStrikethrough?: boolean

  // Feature metadata (for feature-drop tools)
  featureType: string | null
  featureName: string | null
  notes: string | null

  // Measurements
  lengthFt: number | null
  quantity: number | null

  // Field color code preset (key from MARKUP_COLOR_CODES, e.g. 'backbone_fiber_overlash')
  colorCode?: string

  // Smart construction markup fields
  workType?: 'underground' | 'aerial' | 'splicing' | 'general'
  assetType?: string        // e.g. "Conduit", "Strand", "Splice Closure"
  assetCategory?: string   // e.g. "Conduit", "Bore / Trench", "Structures"
  size?: string             // e.g. "2\"", "1.25\"", "1\""
  material?: string
  unit?: string             // e.g. "Feet", "Each"
  costCode?: string
  billingCode?: string
  isBillable?: boolean
  isProductionItem?: boolean
  isQCRequired?: boolean

  // Workflow
  status: MarkupStatus
  layer: MarkupLayer
  crewId: string | null

  /** Stroke style, decoupled from `tool` — falls back to the tool-based dash lookup when unset (older records). */
  lineStyle?: 'solid' | 'dashed' | 'dotted'
  /** Offline sync state — inert placeholder until the sync queue (Phase 10) is wired; every record is 'local' today. */
  syncStatus?: 'local' | 'pending' | 'synced' | 'error'

  // Audit
  createdBy: string | null
  createdAt: string          // ISO datetime
  updatedAt: string | null
  lockedAt: string | null
}

// ---------------------------------------------------------------------------
// Work Object attachments — video, inspection forms, generic files, and a
// real field-level audit log, alongside the existing MarkupPhoto/MarkupBilling.
// ---------------------------------------------------------------------------

/** One video attached to a Work Object. Blob stored in IndexedDB under key `mkp-<id>` (same store as photos). */
export interface MarkupVideo {
  id: string
  markupId: string
  caption: string | null
  takenAt: string // ISO datetime
}

export type InspectionResult = 'pass' | 'fail' | 'na'

export interface InspectionItem {
  id: string
  label: string
  result: InspectionResult
  notes: string | null
}

/** One inspection pass over a Work Object. Multiple are allowed (e.g. re-inspection after rework). */
export interface MarkupInspection {
  id: string
  markupId: string
  items: InspectionItem[]
  overallResult: 'pass' | 'fail' | 'pending'
  notes: string | null
  createdBy: string | null
  createdAt: string // ISO datetime
}

/** A generic file attached to a Work Object (not a photo/video) — reports, permits, etc. Blob stored under key `mkp-<id>`. */
export interface MarkupAttachment {
  id: string
  markupId: string
  fileName: string
  mimeType: string
  uploadedAt: string // ISO datetime
}

export type MarkupHistoryAction =
  | 'created' | 'field_changed'
  | 'photo_added' | 'photo_removed'
  | 'billing_added' | 'billing_removed'
  | 'inspection_added'
  | 'locked' | 'unlocked'

/** A real, field-level audit log entry for a Work Object — written centrally by DataContext's mutation methods. */
export interface MarkupHistoryEntry {
  id: string
  markupId: string
  timestamp: string // ISO datetime
  actor: string | null
  action: MarkupHistoryAction
  /** Set only for 'field_changed' entries. */
  field?: string
  oldValue?: string | null
  newValue?: string | null
}

// ---------------------------------------------------------------------------
// Field Map overlays — georeferenced PDF/scanned-plan images anchored onto
// the Field Map so PDF plans render alongside KMZ features on one map.
// ---------------------------------------------------------------------------

export interface GeoreferenceControlPoint {
  /** Pixel position on the source page image. */
  px: { x: number; y: number }
  lat: number
  lng: number
}

export interface GeoreferencedOverlay {
  id: string
  projectId: string
  /** FK → ProjectFile.id — the PDF this overlay was rendered from, if any. */
  sourceProjectFileId?: string | null
  /** IndexedDB key (via src/lib/fileStore.ts) for the rendered page image. */
  imageBlobKey: string
  pageIndex: number
  naturalWidth: number
  naturalHeight: number
  controlPoints: GeoreferenceControlPoint[]
  opacity: number
  visible: boolean
  createdAt: string
}

// ---------------------------------------------------------------------------
// Top-level persisted application state
// ---------------------------------------------------------------------------

/** The full persisted application state. */
export interface AppData {
  projects: Project[]
  crews: Crew[]
  production: ProductionEntry[]
  pnl: PnLEntry[]
  materials: Material[]
  photos: Photo[]
  invoices: Invoice[]
  // Rate card system
  clients: Client[]
  rateCards: RateCard[]
  rateCardUnits: RateCardUnit[]
  // Employees
  employees: Employee[]
  // Rate-card-driven production detail
  productionLineItems: ProductionLineItem[]
  // Timecards
  timecards: Timecard[]
  // Job expenses
  jobExpenses: JobExpense[]
  // Equipment
  equipment: Equipment[]
  // Project files (PDFs, KMZ plans)
  projectFiles: ProjectFile[]
  // Clock-in / geofence records
  clockEntries: ClockEntry[]
  // KMZ production workflow
  kmzUploads: KmzUpload[]
  mapFeatures: MapFeature[]
  featureProduction: FeatureProductionEntry[]
  // Field markup system
  fieldMarkups: FieldMarkup[]
  markupPhotos: MarkupPhoto[]
  markupBilling: MarkupBilling[]
  aerialLashFiberRuns: AerialLashFiberRun[]
  // Georeferenced PDF/plan overlays on the Field Map
  fieldMapOverlays: GeoreferencedOverlay[]
  // Favorited billing unit codes (RateCardUnit.unitCode), surfaced in the Add Work billing step
  favoriteUnitCodes: string[]
  // Work Object attachments — video, inspections, generic files, audit log
  markupVideos: MarkupVideo[]
  markupInspections: MarkupInspection[]
  markupAttachments: MarkupAttachment[]
  markupHistory: MarkupHistoryEntry[]
}
