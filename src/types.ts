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
export type WorkType = 'aerial' | 'underground' | 'directional_bore' | 'splicing' | 'mdu'

export interface Project {
  id: string
  name: string
  client: string
  /** Optional FK → Client.id; links to rate cards for this project. */
  clientId?: string
  location: string
  status: ProjectStatus
  workType: WorkType
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
  foreman: string
  specialty: WorkType
  status: CrewStatus
  /** Project the crew is currently working, if any. */
  currentProjectId: string | null
  /** Crew-level default pay — used as a fallback when no members are defined. */
  payType: PayType
  payAmount: number
  /** Individual workers; labor cost is summed across active members. */
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
  /** Image URL. Seed data uses remote placeholders; uploads use data URLs. */
  url: string
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
}

export interface RateCard {
  id: string
  clientId: string
  division: RateCardDivision
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
}
