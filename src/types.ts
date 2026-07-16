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
  /** FK → Organization.id. Optional because pre-migration/local-only data
   *  predates the multi-tenant backend (Phase 1) — undefined there means
   *  "not yet backed by Supabase," not "belongs to no organization." */
  organizationId?: string | null
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
  /** Ids of subcontractors assigned to this project — the moment they're
   *  assigned here, it shows up in their Subcontractor Dashboard's "Your
   *  Projects", same as crewIds does for in-house crews. Optional (new
   *  field; existing/seed projects predate it). */
  subcontractorIds?: string[]
  /** FK → Employee.id — the supervisor overseeing this job. Drives the
   *  Supervisor Dashboard's "your projects" scope and the Field Map's
   *  full-visibility-minus-revenue view for that role; unset means no
   *  supervisor has been assigned yet. */
  supervisorId?: string | null
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
  /** FK → Subcontractor.id — set when this entry is a subcontractor's work,
   *  in which case crewId is '' (a subcontractor isn't further subdivided by
   *  internal crew). Mutually exclusive with a real crewId, mirroring
   *  FieldMarkup/MarkupBilling.assignedSubcontractorId's nullable-FK
   *  convention. See src/lib/crewOrSub.ts for the shared display/lookup
   *  helper that resolves either id to a name. */
  subcontractorId?: string | null
  /** Footage placed/spliced that day (LF total; auto-computed from line items when present). */
  footage: number
  /** Hours worked by the crew that day (drives utilization + cost). */
  hours: number
  notes?: string
  /** Equipment explicitly selected by the crew when logging this day — used for cost calculation. */
  equipmentIds?: string[]
  /** FK → FieldMarkup.id — set when auto-generated from a Field Map Work Object's billing; lets softDeleteMarkup cascade-remove this entry (and its PnLEntry) when the source markup is deleted. */
  sourceMarkupId?: string
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

// Material check-out requests — a field employee/subcontractor/supervisor
// selects materials + quantities from the master list and submits one batch
// request; it routes to the project's supervisor, who uses it to go pick the
// material up (e.g. from the customer) and marks it fulfilled once done.
export type MaterialRequestStatus = 'pending' | 'fulfilled'

export interface MaterialRequestItem {
  materialId: string
  quantity: number
}

export interface MaterialRequest {
  id: string
  projectId: string
  /** Mutually exclusive with requestedBySubcontractorId, same convention as Notification. */
  requestedByEmployeeId?: string | null
  requestedBySubcontractorId?: string | null
  /** Denormalized snapshot so the requester's name still displays even if the
   *  employee/subcontractor record is later deactivated or deleted. */
  requestedByName: string
  items: MaterialRequestItem[]
  notes?: string | null
  status: MaterialRequestStatus
  createdAt: string
  fulfilledAt?: string | null
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
  /** Full ISO datetime, when known — `date` stays the source of truth for
   *  legacy/manual entries; this adds time-of-day precision where captured. */
  capturedAt?: string | null
  /** FK → FieldMarkup.id — the redline (Work Object) this photo documents,
   *  when auto-generated from Field Map production. Mirrors the `markupId`
   *  convention used by MarkupPhoto/MarkupVideo/etc. */
  markupId?: string | null
  crewId?: string | null
  /** Who captured/uploaded it, when known — distinct from the free-text `uploadedBy`. */
  employeeId?: string | null
  subcontractorId?: string | null
  /** Snapshot of FieldMarkup.workId at capture time. */
  workOrderId?: string | null
  workType?: 'underground' | 'aerial' | 'splicing' | 'general' | null
  /** "Production Item" — snapshot of the source markup's workObjectType. */
  workObjectType?: WorkObjectTypeId | null
  lat?: number | null
  lng?: number | null
  /** Which specific splice-proof slot this photo satisfies, when captured for
   *  a SpliceEnclosure or FiberTapReport — see those types below. Distinct
   *  from `workObjectType`/PhotoProofType's phase tagging: this ties a photo
   *  to one exact required slot (a specific tray number, a specific tap
   *  port) so count-based enforcement can tell "tray 2 has a photo" from
   *  "tray 3 doesn't," not just "some tray photo exists." */
  spliceProofSlot?:
    | { kind: 'enclosure_mounted' }
    | { kind: 'tray'; trayNumber: number }
    | { kind: 'tap_port'; tapEntryId: string; portNumber: number }
    | null
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue'

export interface InvoiceLineItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  /** Display only, snapshot of MarkupBilling.unitType. */
  uom?: string | null
}

export interface Invoice {
  id: string
  number: string
  projectId: string
  /** Real FK, when known — `client` (below) stays the display/back-compat string. */
  clientId?: string | null
  client: string
  issueDate: string
  dueDate: string
  billingPeriodStart?: string | null
  billingPeriodEnd?: string | null
  status: InvoiceStatus
  /** Set when status flips to 'paid'. */
  paidDate?: string | null
  lineItems: InvoiceLineItem[]
  /** Raw MarkupBilling ids locked into this invoice — lets PDF/Excel/CSV
   *  export re-fetch the exact source rows after the fact, and lets
   *  "previously invoiced" filtering / history drill-down work without
   *  re-deriving anything. Optional/absent for invoices created before this
   *  field existed, or a purely manual (non-production) invoice from
   *  NewInvoiceModal — treat as `?? []` everywhere it's read. */
  sourceBillingIds?: string[]
  /** Header fields used only by the splicing invoice-matrix export
   *  (exportSplicingInvoiceMatrixExcel) — optional/absent for non-splicing
   *  invoices. */
  oltNumber?: string | null
  prismId?: string | null
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
  /** Billing/mailing address — printed as the "Bill To" block on a Field Map
   *  invoice export (see fieldMapExport.ts's drawInvoicePage). All optional;
   *  omitted lines just don't print. */
  billingAddress?: string
  billingCity?: string
  billingState?: string
  billingZip?: string
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
  /** FK → Organization.id. See Project.organizationId for why this is optional. */
  organizationId?: string | null
  /** FK → Subcontractor.id — null/unset means an in-house employee; set means
   *  this is that subcontractor's own employee, not the prime's. Mirrors the
   *  FieldMarkup.assignedSubcontractorId nullable-FK pattern used throughout
   *  this file. */
  subcontractorId?: string | null
  name: string
  role: string
  /** Hourly rate — admin/office-only field; never expose on field-facing views. */
  hourlyRate: number
  /** Default crew this employee typically works on. */
  defaultCrewId: string | null
  active: boolean
  /** Marks this employee as a foreman — shown in crew overview and crew day entry. */
  isForeman?: boolean
  /** Marks this employee as a supervisor — narrows the Project Detail page's
   *  "Supervisor Assignment" picker to just these employees instead of every
   *  active employee, and is the intended (though not enforced) set of
   *  people who'd actually use the Supervisor Dashboard/role. */
  isSupervisor?: boolean
}

// ---------------------------------------------------------------------------
// Subcontractors — third-party companies distinct from internal Employees.
// A redline/billing line is attributed to either an Employee OR a
// Subcontractor, never both (see FieldMarkup.assignedSubcontractorId /
// MarkupBilling.assignedSubcontractorId).
// ---------------------------------------------------------------------------

export interface Subcontractor {
  id: string
  /** FK → Organization.id. See Project.organizationId for why this is optional. */
  organizationId?: string | null
  companyName: string
  contactName?: string | null
  phone?: string | null
  email?: string | null
  /** Per-project rate card overrides — a subcontractor working multiple
   *  projects at once can have a different negotiated rate on each. Keyed by
   *  Project.id; when an entry exists for the project a redline is being
   *  billed on, it wins over the project's own Project.rateCardId — it's the
   *  most specific configuration available for "this company, on this job."
   *  No single company-wide fallback rate card exists — a subcontractor's
   *  pricing is always either project-specific here or inherited from
   *  whatever rate card the project itself is assigned. */
  projectRateCards?: { projectId: string; rateCardId: string }[]
  /** What percentage of the rate card's price this subcontractor is actually
   *  paid, e.g. 80 = they're paid 80% of each billing line's customer total.
   *  This is the ONLY dollar figure a subcontractor session ever sees — the
   *  full rate card amount is what we bill the client, never shown to them.
   *  Null/unset means no pay rate has been configured yet (their dashboard
   *  shows nothing until an admin sets one, rather than guessing 100%). */
  payRatePercent?: number | null
  insuranceExpiresAt?: string | null
  insuranceNotes?: string | null
  active: boolean
  notes?: string | null
}

// ---------------------------------------------------------------------------
// Employee Production Pay Rates — entirely separate from RateCard/RateCardUnit
// above. RateCardUnit.rate is what we bill the CLIENT for a unit code;
// EmployeeProductionRate.rate is what we PAY a specific employee for that same
// unit code. Same unitCode vocabulary for convenience, never the same number,
// never read from one another.
// ---------------------------------------------------------------------------

export type ProductionPayType = 'per_foot' | 'per_unit' | 'per_handhole' | 'per_bore' | 'per_tie_in' | 'per_box' | 'custom'

/** Admin-managed. One employee can have at most one ACTIVE rate per unitCode
 *  at a time in practice, but nothing enforces that — the pay calculation
 *  picks the active rate with the latest effectiveDate on or before the work
 *  date when more than one exists. */
export interface EmployeeProductionRate {
  id: string
  employeeId: string
  unitCode: string
  unitDescription: string
  rate: number
  payType: ProductionPayType
  effectiveDate: string
  active: boolean
  notes?: string
}

/** The manual admin step that attributes part (or all) of a crew production
 *  line item's quantity to one specific employee — nothing today ties
 *  quantity to an individual automatically, so this is deliberately explicit,
 *  not computed. A line item can have several allocations (split across
 *  people); any unallocated remainder simply contributes no production pay
 *  to anyone. */
export interface ProductionPayAllocation {
  id: string
  productionEntryId: string
  productionLineItemId: string
  employeeId: string
  quantity: number
  createdAt: string
  createdBy: string | null
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
  /** FK → MarkupBilling.id — set when this line item was generated from a Field
   *  Map billing line. Lets updateMarkupBilling find and update this line item
   *  (and its entry's footage / the linked PnLEntry's revenue) in place when the
   *  billing line's quantity/rate is edited after submission, instead of the two
   *  silently drifting apart. */
  sourceMarkupBillingId?: string
  /** QA/QC status inherited from the source MarkupBilling line at creation time,
   *  and kept in sync on every review action (see DataContext's approveQaLine/
   *  rejectQaLine/markRejectionFixedQa). undefined for line items with no
   *  sourceMarkupBillingId — outside the QA workflow entirely, always treated
   *  as finalized, exactly like today. This is what computeQaRevenueBreakdown
   *  buckets by (walking productionLineItems, not PnLEntry directly, since one
   *  PnLEntry can aggregate several line items each with independent status). */
  qaStatus?: QaStatus
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
  /** Set once, when this file is generated by "Save to Project Documents" in
   *  Map Cuts — FK -> MapCutPackage.id. Lets PdfPrintMode.tsx detect in O(1)
   *  that a given file is a cut-output piece (not an ordinary upload) and
   *  find the package/box that produced it, to sync redlines back to the
   *  master print instead of storing them independently on this file. Unset
   *  for every ordinary uploaded PDF. */
  sourceMapCutPackageId?: string | null
  /** Which in-house crew this specific print/piece is earmarked for — mutually
   *  exclusive with assignedSubcontractorId, same convention as
   *  FieldMarkup.assignedSubcontractorId. When both this and
   *  assignedSubcontractorId are unset, falls back to the originating
   *  MapCutPackage's default (see MapCutPackage.defaultAssignedCrewId) if this
   *  file has one, else unassigned. See src/lib/printAssignment.ts. */
  assignedCrewId?: string | null
  /** Which subcontractor this specific print/piece is earmarked for — see
   *  assignedCrewId above for the override/inherit rule. */
  assignedSubcontractorId?: string | null
}

// ---------------------------------------------------------------------------
// Map Cuts — slice one oversized plan-sheet page into a field-readable,
// multi-page PDF (grid tiles or hand-drawn boxes), with a generated title
// block per output page.
// ---------------------------------------------------------------------------

/** 'assistedRoute' is reserved for a later phase (user clicks along the route
 *  to seed boxes) — not implemented yet, kept here so the type is stable. */
export type MapCutStyle = 'grid' | 'manual' | 'assistedRoute'
/** '11x17' doubles as "ANSI B" — same physical size, kept as one key to avoid
 *  a breaking rename of already-saved packages. */
export type MapCutPageSize = '11x17' | '8.5x11' | 'legal' | 'ansiC' | 'ansiD' | 'custom'

/** One output page's source region, in NORMALIZED (0-1) fractions of the
 *  source page's full natural size — resolution-independent, so boxes drawn
 *  against a lower-res preview still land correctly when the source page is
 *  re-rendered at high resolution for Generate. */
export interface MapCutBox {
  id: string
  /** Top-left corner, pre-rotation, 0-1 fraction of source page width. */
  x: number
  /** Top-left corner, pre-rotation, 0-1 fraction of source page height. */
  y: number
  /** 0-1 fraction of source page width. */
  width: number
  /** 0-1 fraction of source page height. */
  height: number
  /** Degrees, rotation applied around the box's own center. */
  rotation: number
  /** 1-based output order — also the "Sheet N" number. */
  order: number
}

/** Grid Cut's own selection state — entirely separate from Manual Cut's `boxes`
 *  editing. A cell is identified as `${row}-${col}`; selecting/merging cells here
 *  doesn't touch `MapCutPackage.boxes` at all until "Create Cuts" converts the
 *  finalized selection into boxes via `gridSelectionToBoxes` (geometry.ts). */
export interface GridCellSelection {
  rows: number
  cols: number
  /** cellId -> click order. A monotonically increasing counter — re-selecting a
   *  previously-deselected cell gets a new, higher number rather than its old one,
   *  so numbers never shift around when a cell is deselected. */
  selectedOrder: Record<string, number>
  /** Each inner array is a set of cellIds merged into one output box. A cell not
   *  listed in any group here remains its own individual box. */
  merges: string[][]
}

/** A saved, reopenable Map Cuts session. Autosaves as the user edits (same
 *  reactive-store approach as the rest of the app), so "reopen and edit"
 *  needs no separate save step for the configuration itself — only the
 *  generated output PDF is an explicit save (into project documents). */
export interface MapCutPackage {
  id: string
  /** Editable; defaults to "<source file name> cuts". Also the output filename base. */
  name: string
  projectId: string
  /** Set when cut from a PDF already attached to the project. */
  sourceProjectFileId: string | null
  /** Kept even for ad-hoc uploads never attached as a ProjectFile. */
  sourceFileName: string
  sourcePageIndex: number
  cutStyle: MapCutStyle
  pageSize: MapCutPageSize
  /** Only when pageSize === 'custom', in inches. */
  customWidthIn?: number
  customHeightIn?: number
  gridRows?: number
  gridCols?: number
  /** 0-30. Applied to every box (grid or manual) at generate time via expandRect — not baked into stored box geometry. */
  overlapPct: number
  boxes: MapCutBox[]
  /** True once the user hand-edits a grid-seeded box; stops the rows/cols/overlap sliders from silently regenerating (and discarding) boxes. */
  gridDirty: boolean
  /** Grid Cut's in-progress cell selection — set only in Grid Cut mode via the
   *  new grid overlay workflow; untouched by, and irrelevant to, Manual Cut. */
  gridSelection?: GridCellSelection
  /** Feet-per-inch. Unset = no scale bar drawn (no auto-detection exists). */
  scaleFeetPerInch?: number
  /** Overrides the project's own name on the title block, when set. */
  projectNameOverride?: string
  notes?: string
  productionNotes?: string
  /** OCR best-effort page title / road name, user-editable. */
  detectedTitle?: string
  /** Set once "Save to Project Documents" succeeds — links to the generated output PDF. */
  outputProjectFileId?: string | null
  outputFileName: string
  /** Render DPI for each output page's crop, rendered directly from the vector PDF
   *  (not cropped from a shared low-res raster). Unset on packages saved before this
   *  field existed — treat as 300 (`pkg.outputDpi ?? 300`). */
  outputDpi?: 300 | 600 | 1200
  /** PNG (true lossless) instead of JPEG for each output page's image. Unset on older
   *  packages — treat as false (`pkg.losslessOutput ?? false`). */
  losslessOutput?: boolean
  /** Phase-level default crew/subcontractor for every output piece this package
   *  generates — inherited by a piece (ProjectFile) that has no assignment of
   *  its own. Set from the Project tab's Project Files table, not from Map
   *  Cuts itself. Mutually exclusive, same convention as ProjectFile's pair
   *  above. See src/lib/printAssignment.ts. */
  defaultAssignedCrewId?: string | null
  defaultAssignedSubcontractorId?: string | null
  /** 1-10. Which "Phase N" button this package occupies in its phase family
   *  (all packages sharing sourceProjectFileId + projectId). Unset on
   *  packages created before this existed, or via any other route than the
   *  Phase strip in MapCuts.tsx. */
  phaseNumber?: number
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Map Reading — a wholly separate tool from Map Cuts above. Map Cut produces
// readable individual cut pages; Map Reading is where a user uploads those
// (or any PDF/image) and gets OCR-based, per-page detection + editable notes.
// Shares no code, no components, and no data with MapCutPackage/MapCutBox.
// ---------------------------------------------------------------------------

export type MapReadingDetectionType =
  | 'tie_point' | 'olt_mux' | 'fe_label' | 'ft_label'
  | 'construction_24ct' | 'construction_48ct' | 'construction_96ct'
  | 'overlash' | 'fiber_only' | 'strand_only'
  | 'footage' | 'coil' | 'snowshoe' | 'splice' | 'branch' | 'dead_end'
  | 'road_name' | 'run_number' | 'total_summary' | 'needs_review'

/** One OCR-based detection on a page — position is in the page raster's own
 *  pixel space (naturalWidth/naturalHeight on MapReadingPage below), used both
 *  to draw its highlight box and to resolve click-to-highlight in either
 *  direction (detection list <-> page canvas). */
export interface MapReadingDetection {
  id: string
  type: MapReadingDetectionType
  text: string
  x: number
  y: number
  width: number
  height: number
  /** True once the user has looked at and approved it. */
  confirmed: boolean
  /** True once the user has changed its type or text from what detection
   *  originally produced — the persisted "correction" for this page. */
  corrected?: boolean
}

/** The editable notes template auto-populated from confirmed detections —
 *  every field stays free text so the user's own wording always wins. */
export interface MapReadingNotes {
  pageName: string
  strand24ct: string
  strand48ct: string
  strand96ct: string
  overlash: string
  coils: string
  snowshoes: string
  feLabels: string
  ftLabels: string
  roadNames: string
  tiePoint: string
  oltMux: string
  needsReview: string
}

// ---------------------------------------------------------------------------
// Geometry / Line-Tracing layer (Map Reading Phase 1) — a route graph
// extracted from the page's own linework via classical skeletonization, not
// OCR. Nodes are skeleton pixels with 1 neighbor (endpoint) or 3+ neighbors
// (junction/branch); segments are the traced polylines between them.
// ---------------------------------------------------------------------------

export interface RouteNode {
  id: string
  x: number
  y: number
  kind: 'endpoint' | 'junction'
}

/** One traced polyline connecting two graph nodes, in the page raster's own
 *  pixel space (same space as MapReadingDetection's x/y/width/height). */
export interface RouteSegment {
  id: string
  nodeAId: string
  nodeBId: string
  points: [number, number][]
  /** Set by the Route Association step (routeClassify.ts) — the nearest
   *  cable-type/construction-type detection to this segment, within a
   *  distance cap. Undefined means no nearby label was found; the segment
   *  stays a neutral trace color rather than guessing. */
  classification?: MapReadingDetectionType
  associatedDetectionIds?: string[]
}

export interface RouteGraph {
  nodes: RouteNode[]
  segments: RouteSegment[]
  /** The binarization threshold (0-255) used to produce this trace — kept so
   *  the UI's slider can show/resume from the value that produced what's on
   *  screen, and so re-tracing with the same value is a no-op. */
  threshold: number
}

export interface MapReadingPage {
  id: string
  fileName: string
  /** Which page of a multi-page PDF this came from (0 for a plain image upload). */
  pageIndexInFile: number
  /** FK into the IndexedDB blob store (src/lib/fileStore.ts) — the rendered
   *  raster used for both OCR and on-screen display, a data URL string. */
  imageBlobKey: string
  naturalWidth: number
  naturalHeight: number
  detections: MapReadingDetection[]
  /** Raw OCR word boxes (not just the curated `detections` subset) — kept so
   *  the line-tracing layer can mask out every bit of recognized text before
   *  tracing, not only text that happened to match a detection keyword. */
  ocrWordBoxes?: { x0: number; y0: number; x1: number; y1: number }[]
  /** Set once the user runs "Trace Lines" on this page — undefined until then. */
  routeGraph?: RouteGraph
  notes: MapReadingNotes
  /** 'not_read' = uploaded but not yet auto-processed; 'reading' = pipeline in
   *  progress; 'complete' = processed with at least one classified route or no
   *  ambiguity flags; 'needs_review' = processed but something's ambiguous
   *  (an explicit needs_review detection, or traced routes with zero
   *  successful classifications); 'error' = the pipeline itself failed. */
  status: 'not_read' | 'reading' | 'complete' | 'needs_review' | 'error'
  error?: string
}

export interface MapReadingSession {
  id: string
  projectId: string
  name: string
  pages: MapReadingPage[]
  createdAt: string
  updatedAt: string
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
  /** A plain reference line with no workObjectType, ever — deliberately excluded from
   *  the Add Work wizard, billing, production, payroll, and reports. See Add Work's
   *  "Non-Billable Item" option (AddWorkTypeGrid.tsx / startNonBillableLine). */
  | 'non_billable_line'
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
  // Engineering symbols — Directional Drill (see src/lib/engineeringSymbols.ts)
  | 'directional_bore' | 'road_bore' | 'railroad_bore' | 'bridge_bore'
  | 'bore_start' | 'bore_end' | 'conduit_run' | 'direction_arrow'
  | 'riser' | 'handhole_connection'
  // Engineering symbols — Aerial Strand
  | 'new_strand' | 'existing_strand' | 'pole_attachment' | 'dead_end'
  | 'anchor' | 'guy_attachment' | 'riser_guard' | 'pole_marker'
  // Engineering symbols — Handhole / Vault
  | 'hh17' | 'hh24' | 'hh30' | 'hh36' | 'existing_handhole' | 'proposed_handhole'
  | 'concrete_pad' | 'lid_label' | 'storage_loop' | 'conduit_entry'
  // Engineering symbols — Distribution Fiber
  | 'distribution_fiber_route' | 'fiber_tick_marks' | 'slack_storage' | 'fiber_label'
  // Engineering symbols — Feeder Fiber
  | 'feeder_fiber_route' | 'fiber_count_label'
  // Engineering symbols — Drop
  | 'drop_line' | 'house_drop' | 'service_point' | 'ont_location'
  // Engineering symbols — Pole
  | 'existing_pole' | 'new_pole' | 'pole_number' | 'transformer'
  | 'street_light' | 'comm_attachment' | 'anchor_attachment'
  // Engineering symbols — Anchor / Down Guy
  | 'existing_anchor' | 'new_anchor' | 'down_guy' | 'sidewalk_guy'
  | 'stub_pole_guy' | 'anchor_label'
  // Engineering symbols — Splicing
  | 'splice_case' | 'mst' | 'terminal' | 'closure' | 'fiber_storage' | 'splice_label'
  // Engineering symbols — Trenching
  | 'open_trench' | 'road_cut' | 'driveway_crossing' | 'concrete_cut' | 'saw_cut'
  // Engineering symbols — Plowing
  | 'plow_route' | 'depth_marker'
  // Engineering symbols — Sub-Ducting
  | 'duct_1way' | 'duct_2way' | 'duct_3way' | 'duct_4way' | 'innerduct'

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
  /** Snapshot of the parent markup's crew/employee/subcontractor at capture
   *  time — workType/workObjectType/workId/qaStatus are always derivable
   *  live via markupId → FieldMarkup, since that markup always exists for a
   *  MarkupPhoto, so they aren't duplicated here. */
  crewId?: string | null
  employeeId?: string | null
  subcontractorId?: string | null
  /** Which specific splice-proof slot this photo satisfies, when captured
   *  for the enclosure/tray checklist in the Add Work splicing flow — see
   *  Photo.spliceProofSlot below for the full shape (same discriminator,
   *  duplicated here because markup-attached photos are MarkupPhoto records,
   *  not Photo records). */
  spliceProofSlot?:
    | { kind: 'enclosure_mounted' }
    | { kind: 'tray'; trayNumber: number }
    | null
}

/** One billing line tied to a markup item. */
// ---------------------------------------------------------------------------
// Redline QA/QC Approval Workflow — reviewed per billing line item (the
// "redline item" granularity), not per whole markup/shape. undefined means
// "never submitted for review" / predates this feature — always treated as a
// pass-through, never gated, everywhere this is read (P&L breakdown,
// invoicing eligibility) so legacy data behaves exactly as it did before.
// ---------------------------------------------------------------------------

export type QaStatus = 'pending_review' | 'approved' | 'rejected' | 'rejection_fixed' | 'approved_after_correction'

export const QA_STATUS_META: Record<QaStatus, { label: string; color: string; tone: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'cyan' }> = {
  pending_review:            { label: 'Pending Review',            color: '#f59e0b', tone: 'amber' },
  approved:                  { label: 'Approved',                  color: '#22c55e', tone: 'green' },
  rejected:                  { label: 'Rejected',                  color: '#ef4444', tone: 'red'   },
  rejection_fixed:           { label: 'Rejection Fixed',           color: '#3b82f6', tone: 'blue'  },
  approved_after_correction: { label: 'Approved After Correction', color: '#22c55e', tone: 'green' },
}

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
  /** FK → Subcontractor.id — set when this billing line is attributed to a
   *  third-party subcontractor rather than an internal Employee (see the
   *  parent FieldMarkup.createdBy, which stays Employee-only). */
  assignedSubcontractorId?: string | null

  // QA/QC Approval Workflow — see QaStatus doc comment above.
  qaStatus?: QaStatus
  qaApprovedBy?: string | null
  qaApprovedAt?: string | null
  qaRejectedBy?: string | null
  qaRejectedAt?: string | null
  /** Current/live rejection note — overwritten in place on re-rejection, never
   *  duplicated. The full history of every rejection (including superseded
   *  notes) lives permanently in markupHistory, which is append-only. */
  qaRejectionNote?: string | null
  qaCorrectedBy?: string | null
  qaCorrectedAt?: string | null
  /** Last admin to take ANY review action (approve or reject) on this line. */
  qaReviewedBy?: string | null
  qaReviewedAt?: string | null
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
  | 'flower_pot' | 'tie_in' | 'riser_guard' | 'tick_mark' | 'fiber_loop' | 'snow_shoe'
  | 'road_crossing' | 'sidewalk_crossing' | 'driveway_crossing' | 'other'

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

// ---------------------------------------------------------------------------
// Splicing — digital replacement for the paper "BLANK SPLICING TEMPLATE" and
// "Fiber Tap Report" a splicing subcontractor fills out per enclosure/node.
// ---------------------------------------------------------------------------

/** The standard 12-color tube/fiber code, repeated to number up to 288 fibers
 *  (12 tube colors x 12 fiber colors per tube). */
export type FiberColorCode =
  | 'blue' | 'orange' | 'green' | 'brown' | 'slate' | 'white'
  | 'red' | 'black' | 'yellow' | 'violet' | 'rose' | 'aqua'

export type SpliceEnclosureType = 'Can' | 'D Can' | 'OTE' | 'MST' | 'Splitter' | 'Other'

export type FiberSpliceStatus =
  | 'spliced' | 'pass_through' | 'express' | 'splitter' | 'reserved' | 'dead_fiber' | 'slack'

export interface SpliceFiberEntry {
  id: string
  fiberNumber: number       // 1-864
  tubeColor: FiberColorCode
  fiberColor: FiberColorCode
  /** Free-text fiber reference on each side of the splice (often just the
   *  fiber number, but real paperwork sometimes references a cable/fiber
   *  label instead) — defaults to the fiber number, fully editable. */
  inputFiber: string
  outputFiber: string
  status: FiberSpliceStatus
  /** Input span (spanIndex 0) fibers only: which Output span (1-7) this
   *  fiber is cut over to — a single input cable's fibers routinely fan out
   *  to different splitters/terminals within the same enclosure. Purely an
   *  in-app reference so a tech can tell at a glance "which of my 144
   *  fibers go to Output 3" while filling in each Output span's own fiber
   *  table separately; not read by the spreadsheet export. Always null on
   *  Output span fibers. */
  routedToSpanIndex?: number | null
}

export interface SpliceSpan {
  /** 0 = the single input span; 1-7 = output spans, in the same order as the
   *  paper form's 7 "Output Ftg" rows. */
  spanIndex: number
  /** Free-text span label, e.g. "KENLA07D008" or "KENLA07D008 TO KENLA070023"
   *  — mirrors the real form's "<this enclosure> TO <next enclosure>" convention. */
  label: string
  fibers: SpliceFiberEntry[]
}

/** One physical enclosure worked by a splicing crew — a 1:1 extension record
 *  keyed by markupId, same pattern as MarkupPhoto/MarkupBilling/MarkupVideo
 *  below. Created/edited from a dedicated step inside the Add Work wizard
 *  when workObjectType === 'splicing'. GPS is not duplicated here — it comes
 *  from the parent FieldMarkup's capturedLat/capturedLng. */
export interface SpliceEnclosure {
  id: string
  markupId: string          // FK -> FieldMarkup.id (1:1)
  projectId: string         // denormalized, for cascade-delete + filtering
  jobNumber: string
  jobName: string
  spliceId: string          // e.g. "KENSO413D001" — the enclosure's own identifier
  enclosureType: SpliceEnclosureType
  mapNumber: string
  trayCount: number
  location: string
  spans: SpliceSpan[]       // spans[0] = input, spans[1..7] = outputs
  notes: string | null      // "notes and/or concerns"
  noc: {
    ticketNumber: string | null
    timeIn: string | null
    twRep: string | null
    clear: boolean
    timeOut: string | null
    auditor: string | null
  }
  /** Name of this enclosure's tab in its SpliceReportTemplate's master
   *  workbook (see SpliceReportTemplate.masterWorkbookData), once it's been
   *  saved there at least once. Re-saving reuses this exact tab instead of
   *  cloning a new one, so edits update the existing record rather than
   *  duplicating it — same intent as "next available row" logic, adapted to
   *  a one-tab-per-enclosure workbook instead of one-row-per-record. */
  exportedSheetName?: string | null
  createdAt: string
  updatedAt: string | null
}

export interface FiberTapPort {
  portNumber: number
  dbm: number | null
  linkLossDb: number | null
  /** FK -> Photo.id — the required power-meter-reading photo for this port. */
  photoId?: string | null
}

export interface FiberTapEntry {
  id: string
  tapName: string            // e.g. "KENBG370001"
  tapType: 'MST' | 'OTE'
  portCount: number
  portsSpliced: number
  bufferFiberColorToPort1: string   // free text, e.g. "BL-BL" or "SPLITTER F1"
  ports: FiberTapPort[]
}

/** One report per node/OLT — independent of SpliceEnclosure (a node's taps
 *  aren't 1:1 with any single enclosure). Captured from a standalone form,
 *  not the map wizard — see MaterialRequestForm's precedent: a plain
 *  structured form tied to a project, no geometry/drawing involved. */
export interface FiberTapReport {
  id: string
  projectId: string
  prismId: string
  nodeNumber: string
  nodeLocation: string
  contractorCompany: string
  splicerName: string
  opticalSourceLabel: string
  opticalPowerDbm: number | null
  wavelengthNm: number | null
  taps: FiberTapEntry[]
  createdBySubcontractorId?: string | null
  createdByEmployeeId?: string | null
  createdAt: string
  updatedAt: string | null
}

/** Cell-address field mapping for the per-enclosure splice sheet, filled into
 *  a user-uploaded workbook instead of the hardcoded exportSpliceEnclosureExcel
 *  layout. Every value is an A1-style address (e.g. "C4") or null/unmapped. */
export interface SpliceEnclosureTemplateMapping {
  jobNumber: string | null
  jobName: string | null
  date: string | null
  spliceId: string | null
  enclosureType: string | null
  mapNumber: string | null
  trayCount: string | null
  location: string | null
  latitude: string | null
  longitude: string | null
  notes: string | null
  nocTicketNumber: string | null
  nocTimeIn: string | null
  nocTwRep: string | null
  nocClear: string | null
  nocTimeOut: string | null
  nocAuditor: string | null
  /** Top-left cell for the tiled photo collage (enclosure-mounted + tray
   *  photos) — independent of `notes` so a photo grid and free-text notes
   *  can land in different parts of the sheet. Null skips photo export. */
  photosAnchor: string | null
  /** spanIndex (0 = input, 1-7 = outputs) -> the cell holding fiber #1's row
   *  for that span. Tube color is written 1 column right of the anchor,
   *  fiber color 2 columns right, one row per fiber going downward. */
  spanAnchors: Partial<Record<number, string>>
  /** spanIndex -> cell to write that span's free-text label into (optional). */
  spanLabelCells: Partial<Record<number, string>>
}

/** Cell-address field mapping for the Fiber Tap Report. `tapsAnchor` is the
 *  top-left cell of the first tap's row (tap name column); fixed column
 *  offsets from it hold tap type (+1), port count (+2), ports spliced (+3),
 *  buffer/fiber color to port 1 (+4), port 1-8 dBm (+5..+12), and computed
 *  link loss 1-8 (+13..+20) — one row per tap, downward. */
export interface FiberTapTemplateMapping {
  prismId: string | null
  opticalSourceLabel: string | null
  nodeNumber: string | null
  opticalPowerDbm: string | null
  nodeLocation: string | null
  wavelengthNm: string | null
  contractorCompany: string | null
  splicerName: string | null
  tapsAnchor: string | null
}

export type SpliceReportKind = 'spliceEnclosure' | 'fiberTap'

/** A user-uploaded spreadsheet ("upload your own template") plus the cell
 *  addresses that say where each field goes in it. One active template per
 *  SpliceReportKind — uploading a new one replaces the old. The workbook
 *  itself is stored as base64-encoded .xlsx bytes so export can re-open the
 *  exact file (fonts, colors, other sheets, formulas — everything the user
 *  already has) and only write values into the mapped cells. */
export interface SpliceReportTemplate {
  id: string
  kind: SpliceReportKind
  fileName: string
  sheetName: string
  fileData: string // base64 .xlsx bytes — the originally uploaded blank template, never mutated
  mapping: SpliceEnclosureTemplateMapping | FiberTapTemplateMapping
  /** True once at least one enclosure has been saved into this template's
   *  accumulating multi-tab workbook (`fileData` plus one cloned-and-filled
   *  tab per saved enclosure — see SpliceEnclosure.exportedSheetName). The
   *  bytes themselves live in IndexedDB (src/lib/fileStore.ts, key
   *  `spltpl-<id>`), not here — they can grow into the multi-MB range as
   *  photo-laden sheets accumulate, well past what's safe to keep in the
   *  localStorage-persisted AppData blob. False until the first save, and
   *  reset to false whenever `fileData` itself is replaced (a genuinely new
   *  upload), since tabs cloned from the old template no longer match. */
  hasMasterWorkbook: boolean
  createdAt: string
  updatedAt: string | null
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
  /** User explicitly confirmed GPS could not be captured (no signal/permission/hardware) —
   *  satisfies the Add Work wizard's mandatory-GPS requirement without a real fix. Cleared
   *  automatically if a real capture later succeeds. */
  gpsUnavailableConfirmed?: boolean

  /** Short human-readable identifier (e.g. "WO-TRN-014"), generated once when the Add Work
   *  wizard's final Save completes — null/unset until then (including for markups created
   *  outside that wizard, e.g. plain hand-drawn shapes with no workObjectType). */
  workId?: string | null

  // Content
  label: string | null
  fontSize: number
  /** User-set size multiplier for this markup's auto-generated (or manual)
   *  callout box specifically — dragged via the box's own resize handle
   *  (see PdfCalloutOverlay.tsx / KmzMap.tsx's renderCallout), independent
   *  of fontSize and independent of the page's current zoom (which already
   *  scales the box proportionally on its own — see PdfCalloutOverlay's doc
   *  comment). 1 = default size. Unset/undefined = 1, same as every record
   *  predating this field. */
  calloutScale?: number
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

  /** User-editable "date this work was performed," ISO YYYY-MM-DD — distinct from
   *  createdAt (audit trail of when the redline was entered into Fiberlytic, which
   *  may be days after the work itself). Falls back to createdAt's date when unset
   *  (older records). Editing this cascades into any already-submitted Production/
   *  P&L entries — see updateMarkup in DataContext.tsx. */
  workDate?: string

  // Audit
  createdBy: string | null
  createdAt: string          // ISO datetime
  updatedAt: string | null
  lockedAt: string | null
  /** Soft-delete marker — set instead of removing the record, so photos/billing/history survive for audit. Every reader that renders/aggregates active work must filter deletedAt == null. */
  deletedAt?: string | null
  deletedBy?: string | null
  /** FK → Subcontractor.id — set when this redline is attributed to a
   *  third-party subcontractor rather than (or in addition to) the internal
   *  Employee in createdBy. Individual MarkupBilling lines carry their own
   *  copy for the case where a single markup mixes internal + subcontractor
   *  billing lines. */
  assignedSubcontractorId?: string | null
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
  | 'deleted'
  // Redline QA/QC Approval Workflow — one entry per review action, permanent
  // and never overwritten (unlike the live qaRejectionNote etc. fields on
  // MarkupBilling, which do get overwritten on re-review).
  | 'qa_submitted' | 'qa_approved' | 'qa_rejected'
  | 'qa_rejection_fixed' | 'qa_approved_after_correction'

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
  /** Free-text note — rejection comments, approval notes, correction notes.
   *  Currently only written by qa_* actions, but usable by any future action. */
  note?: string
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
// ---------------------------------------------------------------------------
// Notification Center — Redline QA/QC Approval Workflow. No prior notification
// system existed anywhere in the app; this is in-app only (localStorage-backed,
// no push/email capability, matching this app's frontend-only architecture).
// Since RoleContext's admin/field is a device-wide "who am I" toggle rather
// than real multi-user auth, 'admin' notifications surface to whoever is
// currently browsing in Admin view on this device.
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'redline_submitted' | 'redline_approved' | 'redline_rejected'
  | 'redline_rejection_fixed' | 'redline_approved_after_correction'
  | 'redline_edited_after_approval'

export interface Notification {
  id: string
  type: NotificationType
  markupId: string
  markupBillingId: string
  projectId: string
  recipientRole: 'admin' | 'field'
  /** Set when recipientRole === 'field' AND the work is in-house (no assigned
   *  subcontractor) — mutually exclusive with recipientSubcontractorId. */
  recipientEmployeeId?: string | null
  /** Set when recipientRole === 'field' AND the work belongs to a
   *  subcontractor — mutually exclusive with recipientEmployeeId. Lets the
   *  Subcontractor view's notification bell filter to just that company's
   *  notifications, same pattern as recipientEmployeeId for a field session. */
  recipientSubcontractorId?: string | null
  title: string
  body: string
  createdAt: string
  readAt: string | null
  meta: { projectName: string; location: string; fieldUserName: string; isSubcontractor: boolean }
}

// ---------------------------------------------------------------------------
// Multi-tenant backend (Phase 1 — see supabase/migrations/0001_multi_tenant_
// foundation.sql). Organization is the SaaS-tenant root; Subcontractor is a
// company *within* one organization with its own restricted login. These
// types are read from/written to Supabase directly by DataContext's
// strangler-fig internals for these tables — they do NOT live in AppData's
// localStorage blob the way every other collection below still does.
// ---------------------------------------------------------------------------

export interface Organization {
  id: string
  name: string
  active: boolean
}

export type AppUserRole =
  | 'system_administrator' | 'company_administrator' | 'project_manager' | 'supervisor'
  | 'in_house_crew' | 'field_employee'
  | 'subcontractor_administrator' | 'subcontractor_crew_leader' | 'subcontractor_employee'
  | 'customer' | 'qa_qc_inspector'

/** 1:1 with the authenticated Supabase user. organizationId/role are null for
 *  a brand-new signup until an admin assigns them (no self-serve onboarding
 *  yet — see the migration file's bootstrapping comment). */
export interface UserProfile {
  id: string
  organizationId: string | null
  role: AppUserRole | null
  subcontractorId: string | null
  employeeId: string | null
  displayName: string | null
}

/** "Their assigned projects" (spec) — a project can involve several
 *  subcontractors at once, so visibility is many-to-many, not a single FK
 *  column on Project. */
export interface ProjectSubcontractorAssignment {
  id: string
  projectId: string
  subcontractorId: string
  assignedAt: string
  assignedBy: string | null
}

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
  // Map Cuts — saved cut-package sessions
  mapCutPackages: MapCutPackage[]
  // Map Reading — saved OCR-detection review sessions (separate tool, see above)
  mapReadingSessions: MapReadingSession[]
  // Employee Production Pay Rates — separate from RateCard/RateCardUnit (customer billing)
  employeeProductionRates: EmployeeProductionRate[]
  productionPayAllocations: ProductionPayAllocation[]
  // Redline QA/QC Approval Workflow
  subcontractors: Subcontractor[]
  notifications: Notification[]
  // Material check-out requests
  materialRequests: MaterialRequest[]
  // Splicing — digital splice records + fiber tap light-level reports
  spliceEnclosures: SpliceEnclosure[]
  fiberTapReports: FiberTapReport[]
  // Upload-your-own spreadsheet templates for the splice exports above
  spliceReportTemplates: SpliceReportTemplate[]
}
