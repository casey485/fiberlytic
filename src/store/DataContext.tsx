import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  AppData,
  AerialLashFiberRun,
  AnnotationShape,
  Client,
  ClockEntry,
  Crew,
  Employee,
  Equipment,
  FeatureProductionEntry,
  FeatureStatus,
  FieldMarkup,
  GeoreferencedOverlay,
  Invoice,
  JobExpense,
  KmzUpload,
  MapFeature,
  MarkupAttachment,
  MarkupBilling,
  MarkupHistoryEntry,
  MarkupInspection,
  MarkupPhoto,
  MarkupVideo,
  Material,
  Photo,
  ProductionEntry,
  ProductionLineItem,
  PnLEntry,
  Project,
  ProjectFile,
  RateCard,
  RateCardUnit,
  Timecard,
} from '../types'
import { generateSeedData } from '../data/seed'
import { crewLaborCost } from '../lib/laborCost'
import { daysInMonth, workTypeDivisions } from '../lib/analytics'
import { saveBlob, deleteBlob } from '../lib/fileStore'

const STORAGE_KEY = 'fiberlytic:data:v1'

/** Bring older saved data up to the current shape. */
function migrateData(raw: AppData): AppData {
  const crews = (raw.crews ?? []).map((c) => ({
    ...c,
    payType: c.payType ?? 'daily',
    payAmount: c.payAmount ?? c.dayRate ?? 0,
    members: c.members ?? [],
  }))

  // Migrate projects: promote legacy `workType` (singular) → `workTypes` (array),
  // back-fill retentionPct to 10% when unset, recompute footageComplete from production
  const footageByProject = new Map<string, number>()
  for (const pe of raw.production ?? []) {
    footageByProject.set(pe.projectId, (footageByProject.get(pe.projectId) ?? 0) + pe.footage)
  }
  const projects = (raw.projects ?? []).map((p) => {
    const pAny = p as unknown as Record<string, unknown>
    const withTypes: typeof p = Array.isArray(pAny.workTypes)
      ? p
      : { ...p, workTypes: (pAny.workType ? [pAny.workType] : []) as import('../types').WorkType[] }
    const footageComplete = withTypes.status === 'complete'
      ? withTypes.footageComplete
      : (footageByProject.get(withTypes.id) ?? 0)
    return {
      ...withTypes,
      footageComplete,
      retentionPct: withTypes.retentionPct ?? 0.10,
    }
  })
  const employees = (raw.employees ?? []).map((e) => ({
    ...e,
    isForeman: e.isForeman ?? false,
  }))
  // Build lookup sets so we can validate P&L entries against existing production
  const productionIds = new Set((raw.production ?? []).map((e) => e.id))
  const productionDateProject = new Set((raw.production ?? []).map((e) => `${e.date}|${e.projectId}`))

  // Materials are customer-provided — zero historical material costs.
  // Also drop any P&L entry whose production entry was deleted (orphan cleanup).
  // Additionally remove legacy (no productionEntryId) entries for any date+project that
  // already has a production-linked PnL entry — those are seed duplicates that inflate margin.
  const linkedDateProjects = new Set(
    (raw.pnl ?? [])
      .filter((e) => e.productionEntryId && productionIds.has(e.productionEntryId))
      .map((e) => `${e.date}|${e.projectId}`)
  )
  const pnl = (raw.pnl ?? [])
    .map((e) => ({ ...e, materialCost: 0 }))
    .filter((e) => {
      if (e.productionEntryId) return productionIds.has(e.productionEntryId)
      // Legacy entries have no productionEntryId — drop if the same date+project already
      // has a real production-linked entry (prevents double-counting revenue)
      if (linkedDateProjects.has(`${e.date}|${e.projectId}`)) return false
      // Keep only if a production entry still exists for the same date + project
      return productionDateProject.has(`${e.date}|${e.projectId}`)
    })
  // Ensure DRILL CREW 1 exists — create it if no crew with "drill" in the name is found
  let drillCrew = crews.find((c) => c.name.trim().toLowerCase().includes('drill'))
  if (!drillCrew) {
    drillCrew = {
      id: 'crew-drill-1',
      name: 'DRILL CREW 1',
      foreman: '',
      specialty: 'directional_bore' as const,
      status: 'active' as const,
      currentProjectId: (raw.projects ?? [])[0]?.id ?? null,
      payType: 'daily' as const,
      payAmount: 0,
      members: [],
    }
    crews.push(drillCrew)
  }

  // One-time seed: inject week-of-06/16/2026 expenses for Drill Crew 1
  const alreadySeeded = (raw.jobExpenses ?? []).some(
    (e) => e.vendor === 'Vermeer Heartland' && e.amount === 299.19,
  )
  let jobExpenses = raw.jobExpenses ?? []
  if (!alreadySeeded) {
    const drillProjectId =
      drillCrew.currentProjectId ??
      [...(raw.production ?? [])]
        .filter((e) => e.crewId === drillCrew!.id)
        .sort((a, b) => b.date.localeCompare(a.date))[0]?.projectId ??
      (raw.projects ?? [])[0]?.id ??
      ''
    const seedRows = [
      { date: '2026-06-16', vendor: 'Expedia',          description: 'La Quinta Inn — 2 rooms x 1 night (Smith/Seese)', amount: 227.76 },
      { date: '2026-06-16', vendor: 'Airbnb',            description: 'Oak Ridge rental — 2 nights (06/17-06/19)',       amount: 328.70 },
      { date: '2026-06-17', vendor: 'Marathon',          description: 'Fuel',                                            amount:  17.06 },
      { date: '2026-06-17', vendor: 'Marathon',          description: 'Fuel',                                            amount:  13.61 },
      { date: '2026-06-17', vendor: 'Marathon',          description: 'Fuel',                                            amount: 100.00 },
      { date: '2026-06-17', vendor: 'Marathon',          description: 'Fuel',                                            amount:  51.29 },
      { date: '2026-06-17', vendor: 'Marathon',          description: 'Fuel',                                            amount:  93.12 },
      { date: '2026-06-17', vendor: 'Home Depot',        description: 'Tools & Materials (BoA)',                         amount: 269.28 },
      { date: '2026-06-17', vendor: 'Home Depot',        description: 'Rayam Receipt (replaces $200 BoA line)',          amount: 195.68 },
      { date: '2026-06-18', vendor: 'Petros Marathon',   description: 'Fuel (prepay)',                                   amount: 100.00 },
      { date: '2026-06-19', vendor: 'RaceWay',           description: 'Fuel + supplies',                                 amount: 107.10 },
      { date: '2026-06-19', vendor: 'Vermeer Heartland', description: 'Drill parts (Sub Saver + Quicklock)',             amount: 299.19 },
    ]
    jobExpenses = [
      ...jobExpenses,
      ...seedRows.map((r, i) => ({
        id: `seed-dc1-${i}`,
        date: r.date,
        jobId: drillProjectId,
        crewId: drillCrew!.id,
        vendor: r.vendor,
        location: r.vendor,
        description: r.description,
        amount: r.amount,
      })),
    ]
  }

  // One-time seed: week of 06/20/2026 + 06/24/2026 expenses for Drill Crew 1
  const alreadySeeded2 = (raw.jobExpenses ?? []).some(
    (e) => e.vendor === 'Kent Kwik Stop' && e.amount === 160.11,
  )
  if (!alreadySeeded2) {
    const drillProjectId =
      drillCrew.currentProjectId ??
      [...(raw.production ?? [])]
        .filter((e) => e.crewId === drillCrew!.id)
        .sort((a, b) => b.date.localeCompare(a.date))[0]?.projectId ??
      (raw.projects ?? [])[0]?.id ??
      ''
    const seedRows2 = [
      { date: '2026-06-20', vendor: 'Kent Kwik Stop',     location: 'Kent Kwik Stop, Ardmore',               description: 'Diesel - 30.4 gal',                               amount: 160.11 },
      { date: '2026-06-22', vendor: 'Coldwater Chevron',  location: 'Coldwater Chevron, Anniston AL',         description: 'Fuel - Diesel prepaid',                           amount: 100.41 },
      { date: '2026-06-22', vendor: 'C&G Market',         location: 'C&G Market, Oak Ridge TN',               description: 'Fuel - Prepaid',                                  amount: 160.00 },
      { date: '2026-06-22', vendor: 'Med Center Chevron', location: 'Med Center Chevron, Birmingham AL',       description: 'Diesel - Prepaid',                                amount: 160.00 },
      { date: '2026-06-22', vendor: 'Home Depot',         location: 'Home Depot, Oak Ridge',                   description: 'Safety glasses + tinted (PPE)',                   amount:  31.76 },
      { date: '2026-06-24', vendor: 'Vermeer Heartland',  location: 'Vermeer Heartland, Knoxville TN',         description: 'HY-Power 68 HYD Chemical (2x) - Drill parts',    amount: 335.72 },
    ]
    jobExpenses = [
      ...jobExpenses,
      ...seedRows2.map((r, i) => ({
        id: `seed-dc2-${i}`,
        date: r.date,
        jobId: drillProjectId,
        crewId: drillCrew!.id,
        vendor: r.vendor,
        location: r.location,
        description: r.description,
        amount: r.amount,
      })),
    ]
  }

  // Migrate rateCards: promote legacy `division` (singular) → `divisions` (array)
  const rateCards = (raw.rateCards ?? []).map((rc) => {
    const rcAny = rc as unknown as Record<string, unknown>
    if (Array.isArray(rcAny.divisions)) return rc
    const legacy = rcAny.division as string | undefined
    const divisions = (legacy ? [legacy] : []) as import('../types').RateCardDivision[]
    return { ...rc, divisions }
  })

  // Back-fill revenue for pnl entries that were saved as $0 before rate-card-based
  // revenue calculation was in place. Uses the same priority logic as the production form.
  const productionById = new Map((raw.production ?? []).map((pe) => [pe.id, pe]))
  const rateCardUnits = raw.rateCardUnits ?? []
  const pnlWithRevenue = pnl.map((entry) => {
    if (entry.revenue !== 0) return entry
    if (!entry.productionEntryId) return entry
    const pe = productionById.get(entry.productionEntryId)
    if (!pe) return entry
    const proj = projects.find((p) => p.id === pe.projectId)
    const rate = resolveRatePerFoot(proj, rateCards, rateCardUnits)
    if (rate <= 0) return entry
    return { ...entry, revenue: Math.round(pe.footage * rate) }
  })

  return {
    ...raw,
    crews,
    employees,
    projects,
    pnl: pnlWithRevenue,
    clients: raw.clients ?? [],
    rateCards,
    rateCardUnits: raw.rateCardUnits ?? [],
    productionLineItems: raw.productionLineItems ?? [],
    timecards: raw.timecards ?? [],
    jobExpenses,
    equipment: raw.equipment ?? [],
    projectFiles: raw.projectFiles ?? [],
    annotations: raw.annotations ?? [],
    clockEntries: raw.clockEntries ?? [],
    kmzUploads: raw.kmzUploads ?? [],
    mapFeatures: raw.mapFeatures ?? [],
    featureProduction: raw.featureProduction ?? [],
    fieldMarkups: raw.fieldMarkups ?? [],
    markupPhotos: raw.markupPhotos ?? [],
    markupBilling: raw.markupBilling ?? [],
    fieldMapOverlays: raw.fieldMapOverlays ?? [],
    favoriteUnitCodes: raw.favoriteUnitCodes ?? [],
    markupVideos: raw.markupVideos ?? [],
    markupInspections: raw.markupInspections ?? [],
    markupAttachments: raw.markupAttachments ?? [],
    markupHistory: raw.markupHistory ?? [],
  }
}

function loadData(): AppData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return migrateData(JSON.parse(stored) as AppData)
  } catch {
    // corrupt storage — fall through to a fresh seed
  }
  return generateSeedData()
}

/** Minimal id generator — fine for a single-user local prototype. */
let counter = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`

// ---------------------------------------------------------------------------
// Work Object audit log — a real, field-level history entry per mutation.
// Centralized here (rather than at UI call sites) so no mutation path is missed.
// ---------------------------------------------------------------------------

function historyEntry(
  markupId: string,
  action: MarkupHistoryEntry['action'],
  actor: string | null,
  extra?: { field?: string; oldValue?: string | null; newValue?: string | null },
): MarkupHistoryEntry {
  return { id: newId('mhist'), markupId, timestamp: new Date().toISOString(), actor, action, ...extra }
}

/** Fields excluded from field-level diffing — either noise (auto-managed timestamps) or handled as their own dedicated action (lockedAt). */
const HISTORY_DIFF_SKIP = new Set<keyof FieldMarkup>(['updatedAt', 'createdAt', 'lockedAt', 'id'])

function stringifyHistoryValue(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'object') return '(updated)' // geometry and other object fields aren't usefully diffable as text
  return String(v)
}

/** Diff a markup update patch into history entries: dedicated lock/unlock entries, plus one field_changed entry per other changed field. */
function diffMarkupUpdate(markupId: string, before: FieldMarkup, patch: Partial<FieldMarkup>, actor: string | null): MarkupHistoryEntry[] {
  const entries: MarkupHistoryEntry[] = []
  if ('lockedAt' in patch && patch.lockedAt !== before.lockedAt) {
    entries.push(historyEntry(markupId, patch.lockedAt ? 'locked' : 'unlocked', actor))
  }
  for (const key of Object.keys(patch) as (keyof FieldMarkup)[]) {
    if (HISTORY_DIFF_SKIP.has(key)) continue
    const oldVal = before[key]
    const newVal = patch[key]
    if (oldVal === newVal) continue
    entries.push(historyEntry(markupId, 'field_changed', actor, {
      field: key, oldValue: stringifyHistoryValue(oldVal), newValue: stringifyHistoryValue(newVal),
    }))
  }
  return entries
}

export type LineItemInput = Omit<ProductionLineItem, 'id' | 'productionEntryId'>

interface DataContextValue {
  data: AppData
  // Projects
  addProject: (p: Omit<Project, 'id'>) => Project
  updateProject: (id: string, patch: Partial<Project>) => void
  deleteProject: (id: string) => void
  // Crews
  addCrew: (c: Omit<Crew, 'id'>) => Crew
  updateCrew: (id: string, patch: Partial<Crew>) => void
  deleteCrew: (id: string) => void
  // Production (also rolls up footage + a P&L line)
  addProduction: (e: Omit<ProductionEntry, 'id'>, lineItems?: LineItemInput[]) => string
  deleteProduction: (id: string) => void
  // Materials
  addMaterial: (m: Omit<Material, 'id'>) => void
  updateMaterial: (id: string, patch: Partial<Material>) => void
  deleteMaterial: (id: string) => void
  // Photos
  addPhoto: (p: Omit<Photo, 'id'>) => Photo
  deletePhoto: (id: string) => void
  // Invoices
  addInvoice: (i: Omit<Invoice, 'id'>) => string
  updateInvoice: (id: string, patch: Partial<Invoice>) => void
  deleteInvoice: (id: string) => void
  // Clients
  addClient: (c: Omit<Client, 'id'>) => Client
  updateClient: (id: string, patch: Partial<Client>) => void
  deleteClient: (id: string) => void
  // Rate cards
  addRateCard: (rc: Omit<RateCard, 'id'>) => RateCard
  updateRateCard: (id: string, patch: Partial<RateCard>) => void
  deleteRateCard: (id: string) => void
  // Rate card units
  addRateCardUnit: (u: Omit<RateCardUnit, 'id'>) => RateCardUnit
  updateRateCardUnit: (id: string, patch: Partial<RateCardUnit>) => void
  deleteRateCardUnit: (id: string) => void
  // Employees
  addEmployee: (e: Omit<Employee, 'id'>) => Employee
  updateEmployee: (id: string, patch: Partial<Employee>) => void
  deleteEmployee: (id: string) => void
  // Timecards
  addTimecard: (t: Omit<Timecard, 'id'>) => void
  deleteTimecard: (id: string) => void
  // Crew day entry — creates a ProductionEntry + Timecards for each employee in one shot
  addCrewDayEntry: (params: {
    date: string
    projectId: string
    crewId: string
    footage: number
    notes?: string
    employees: { employeeId: string; hours: number }[]
    equipmentIds?: string[]
    lineItems?: LineItemInput[]
  }) => string
  deleteCrewDayEntry: (productionEntryId: string) => void
  patchProductionEntry: (id: string, patch: { date?: string; projectId?: string; crewId?: string; footage?: number; notes?: string; lineItems?: LineItemInput[] }) => void
  // Job expenses
  addJobExpense: (e: Omit<JobExpense, 'id'>) => void
  deleteJobExpense: (id: string) => void
  // Equipment
  addEquipment: (e: Omit<Equipment, 'id'>) => Equipment
  updateEquipment: (id: string, patch: Partial<Equipment>) => void
  deleteEquipment: (id: string) => void
  // Project files (blob stored in IndexedDB; only metadata goes to localStorage)
  addProjectFile: (f: Omit<ProjectFile, 'id'> & { dataUrl: string }) => void
  deleteProjectFile: (id: string) => void
  // Annotations (redline markup)
  addAnnotation: (a: Omit<AnnotationShape, 'id'>) => string
  updateAnnotation: (id: string, patch: Partial<AnnotationShape>) => void
  deleteAnnotation: (id: string) => void
  clearAnnotations: (fileId: string, page: number) => void
  setAnnotationsForPage: (fileId: string, page: number, shapes: AnnotationShape[]) => void
  // Clock-in / geofence
  addClockIn: (entry: Omit<ClockEntry, 'id'>) => ClockEntry
  clockOut: (id: string) => void
  deleteClockEntry: (id: string) => void
  updateClockEntry: (id: string, patch: Partial<Omit<ClockEntry, 'id'>>) => void
  // KMZ production workflow
  addKmzUpload: (upload: Omit<KmzUpload, 'id'>, features: Omit<MapFeature, 'kmzUploadId' | 'projectId'>[]) => KmzUpload
  deleteKmzUpload: (id: string) => void
  deleteMapFeature: (id: string) => void
  setFeatureStatus: (featureId: string, status: FeatureStatus) => void
  updateMapFeature: (id: string, patch: Partial<MapFeature>) => void
  addFeatureProduction: (entry: Omit<FeatureProductionEntry, 'id'>) => string
  deleteFeatureProduction: (id: string) => void
  // Field markup system
  addMarkup: (m: Omit<FieldMarkup, 'id' | 'createdAt'>) => string
  updateMarkup: (id: string, patch: Partial<FieldMarkup>, actor?: string | null) => void
  deleteMarkup: (id: string) => void
  addMarkupPhoto: (p: Omit<MarkupPhoto, 'id'>, actor?: string | null) => string
  deleteMarkupPhoto: (id: string, actor?: string | null) => void
  addMarkupBilling: (b: Omit<MarkupBilling, 'id'>, actor?: string | null) => string
  updateMarkupBilling: (id: string, patch: Partial<MarkupBilling>) => void
  deleteMarkupBilling: (id: string, actor?: string | null) => void
  // Work Object videos
  addMarkupVideo: (v: Omit<MarkupVideo, 'id'>) => string
  deleteMarkupVideo: (id: string) => void
  // Work Object inspections
  addMarkupInspection: (i: Omit<MarkupInspection, 'id' | 'createdAt'>) => string
  updateMarkupInspection: (id: string, patch: Partial<MarkupInspection>) => void
  deleteMarkupInspection: (id: string) => void
  // Work Object attachments
  addMarkupAttachment: (a: Omit<MarkupAttachment, 'id'>) => string
  deleteMarkupAttachment: (id: string) => void
  // Aerial lash fiber runs
  addAerialLashFiberRun: (run: Omit<AerialLashFiberRun, 'id' | 'createdAt'>) => string
  updateAerialLashFiberRun: (id: string, patch: Partial<AerialLashFiberRun>) => void
  deleteAerialLashFiberRun: (id: string) => void
  // Field Map georeferenced overlays
  addFieldMapOverlay: (overlay: Omit<GeoreferencedOverlay, 'id' | 'createdAt'>) => string
  updateFieldMapOverlay: (id: string, patch: Partial<GeoreferencedOverlay>) => void
  deleteFieldMapOverlay: (id: string) => void
  // Favorite billing unit codes
  toggleFavoriteUnitCode: (unitCode: string) => void
  // Misc
  resetData: () => void
}

const DataContext = createContext<DataContextValue | null>(null)

/**
 * Resolves per-foot revenue rate using the same priority as the Production form:
 *   1. LF unit from rate card matched by clientId + work-type division
 *   2. LF unit from rate card matched by work-type division only
 *   3. LF unit from any rate card that has one
 *   4. Project contract pricing (contractValue / footageGoal) as last resort
 *   5. 0 (no rate configured)
 * Returns 12 when project is undefined (no project found at all).
 */
function resolveRatePerFoot(
  project: Project | undefined,
  rateCards: RateCard[],
  rateCardUnits: RateCardUnit[],
): number {
  if (!project) return 12

  const divs = workTypeDivisions(project.workTypes ?? [])
  const hasLF = (rcId: string) => rateCardUnits.some((u) => u.rateCardId === rcId && u.uom === 'LF' && u.rate > 0)

  let cardId: string | undefined
  if (project.clientId && divs.length > 0)
    cardId = rateCards.find((rc) => rc.clientId === project.clientId && rc.divisions.some((d) => divs.includes(d)) && hasLF(rc.id))?.id
  if (!cardId && divs.length > 0)
    cardId = rateCards.find((rc) => rc.divisions.some((d) => divs.includes(d)) && hasLF(rc.id))?.id
  if (!cardId)
    cardId = rateCards.find((rc) => hasLF(rc.id))?.id

  const rateCardRate = cardId ? (rateCardUnits.find((u) => u.rateCardId === cardId && u.uom === 'LF' && u.rate > 0)?.rate ?? 0) : 0
  if (rateCardRate > 0) return rateCardRate

  return project.footageGoal > 0 ? project.contractValue / project.footageGoal : 0
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(loadData)

  // Strip base64 blobs before writing to localStorage — blobs live in IndexedDB.
  useEffect(() => {
    try {
      const slim = {
        ...data,
        projectFiles: data.projectFiles.map(({ dataUrl: _skip, ...rest }) => rest),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim))
    } catch {
      // storage quota — non-fatal
    }
  }, [data])

  // One-time migration: if legacy data has dataUrls in localStorage, move them to IndexedDB.
  useEffect(() => {
    const legacy = data.projectFiles.filter((f) => f.dataUrl)
    if (legacy.length === 0) return
    Promise.all(legacy.map((f) => saveBlob(f.id, f.dataUrl!))).then(() => {
      setData((d) => ({
        ...d,
        projectFiles: d.projectFiles.map(({ dataUrl: _skip, ...rest }) => rest),
      }))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<DataContextValue>(() => {
    const recomputeFootage = (projects: Project[], production: ProductionEntry[]) =>
      projects.map((p) => {
        if (p.status === 'complete') return p
        const total = production
          .filter((e) => e.projectId === p.id)
          .reduce((sum, e) => sum + e.footage, 0)
        return { ...p, footageComplete: total }
      })

    return {
      data,

      addProject(p) {
        const project: Project = { ...p, id: newId('proj') }
        setData((d) => ({ ...d, projects: [...d.projects, project] }))
        return project
      },
      updateProject(id, patch) {
        setData((d) => ({ ...d, projects: d.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
      },
      deleteProject(id) {
        setData((d) => ({
          ...d,
          projects: d.projects.filter((p) => p.id !== id),
          production: d.production.filter((e) => e.projectId !== id),
          pnl: d.pnl.filter((e) => e.projectId !== id),
          timecards: d.timecards.filter((t) => t.jobId !== id),
          jobExpenses: d.jobExpenses.filter((e) => e.jobId !== id),
          crews: d.crews.map((c) => (c.currentProjectId === id ? { ...c, currentProjectId: null, status: 'idle' } : c)),
        }))
      },

      addCrew(c) {
        const crew: Crew = { ...c, id: newId('crew') }
        setData((d) => ({ ...d, crews: [...d.crews, crew] }))
        return crew
      },
      updateCrew(id, patch) {
        setData((d) => ({ ...d, crews: d.crews.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
      },
      deleteCrew(id) {
        setData((d) => ({ ...d, crews: d.crews.filter((c) => c.id !== id) }))
      },

      addProduction(e, lineItems) {
        const entryId = newId('prod')
        const entry: ProductionEntry = { ...e, id: entryId }
        setData((d) => {
          const crew = d.crews.find((c) => c.id === entry.crewId)
          const project = d.projects.find((p) => p.id === entry.projectId)
          const production = [...d.production, entry]

          // If line items provided, revenue = sum of extended totals; else use footage * rate
          const hasLineItems = lineItems && lineItems.length > 0
          const revenueFromItems = hasLineItems
            ? lineItems.reduce((s, li) => s + li.extendedTotal, 0)
            : null

          const laborCost = crewLaborCost(crew, entry.hours, entry.footage).total
          const revenue = revenueFromItems ?? entry.footage * resolveRatePerFoot(project, d.rateCards, d.rateCardUnits)

          // Sum daily cost of all active equipment assigned to this crew (monthly / actual days in that month)
          const equipmentCost = Math.round(
            d.equipment
              .filter((eq) => eq.active && eq.crewId === entry.crewId)
              .reduce((s, eq) => s + eq.monthlyCost / daysInMonth(entry.date), 0)
          )

          const pnlLine: PnLEntry = {
            id: newId('pnl'),
            date: entry.date,
            projectId: entry.projectId,
            revenue: Math.round(revenue),
            laborCost,
            materialCost: 0,
            equipmentCost,
            otherCost: 0,
            productionEntryId: entry.id,
          }

          const newLineItems: ProductionLineItem[] = hasLineItems
            ? lineItems.map((li) => ({ ...li, id: newId('pli'), productionEntryId: entry.id }))
            : []

          // Remove any legacy seed P&L entries for the same date+project that have no
          // productionEntryId — they duplicate revenue once a real entry is logged
          const pnlBase = d.pnl.filter(
            (p) => p.productionEntryId || !(p.date === entry.date && p.projectId === entry.projectId)
          )

          return {
            ...d,
            production,
            pnl: [...pnlBase, pnlLine],
            productionLineItems: [...d.productionLineItems, ...newLineItems],
            projects: recomputeFootage(d.projects, production),
          }
        })
        return entryId
      },
      deleteProduction(id) {
        for (const p of data.photos) {
          if (p.productionEntryId === id && p.url.startsWith('idb:')) deleteBlob(p.url.slice(4))
        }
        setData((d) => {
          const entry = d.production.find((e) => e.id === id)
          const production = d.production.filter((e) => e.id !== id)
          const pnl = d.pnl.filter((e) => {
            if (e.productionEntryId) return e.productionEntryId !== id
            // Legacy entries have no productionEntryId — match by date + project
            return !(entry && e.date === entry.date && e.projectId === entry.projectId)
          })
          return {
            ...d,
            production,
            pnl,
            productionLineItems: d.productionLineItems.filter((li) => li.productionEntryId !== id),
            photos: d.photos.filter((p) => p.productionEntryId !== id),
            projects: recomputeFootage(d.projects, production),
          }
        })
      },

      addMaterial(m) {
        setData((d) => ({ ...d, materials: [...d.materials, { ...m, id: newId('mat') }] }))
      },
      updateMaterial(id, patch) {
        setData((d) => ({ ...d, materials: d.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) }))
      },
      deleteMaterial(id) {
        setData((d) => ({ ...d, materials: d.materials.filter((m) => m.id !== id) }))
      },

      addPhoto(p) {
        const photo: Photo = { ...p, id: newId('photo') }
        setData((d) => ({ ...d, photos: [photo, ...d.photos] }))
        return photo
      },
      deletePhoto(id) {
        const photo = data.photos.find((p) => p.id === id)
        if (photo?.url.startsWith('idb:')) deleteBlob(photo.url.slice(4))
        setData((d) => ({ ...d, photos: d.photos.filter((p) => p.id !== id) }))
      },

      addInvoice(i) {
        const id = newId('inv')
        setData((d) => ({ ...d, invoices: [{ ...i, id }, ...d.invoices] }))
        return id
      },
      updateInvoice(id, patch) {
        setData((d) => ({ ...d, invoices: d.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))
      },
      deleteInvoice(id) {
        setData((d) => ({ ...d, invoices: d.invoices.filter((i) => i.id !== id) }))
      },

      // --- Clients ---
      addClient(c) {
        const client: Client = { ...c, id: newId('cli') }
        setData((d) => ({ ...d, clients: [...d.clients, client] }))
        return client
      },
      updateClient(id, patch) {
        setData((d) => ({ ...d, clients: d.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
      },
      deleteClient(id) {
        setData((d) => ({ ...d, clients: d.clients.filter((c) => c.id !== id) }))
      },

      // --- Rate cards ---
      addRateCard(rc) {
        const card: RateCard = { ...rc, id: newId('rc') }
        setData((d) => ({ ...d, rateCards: [...d.rateCards, card] }))
        return card
      },
      updateRateCard(id, patch) {
        setData((d) => ({ ...d, rateCards: d.rateCards.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
      },
      deleteRateCard(id) {
        setData((d) => ({
          ...d,
          rateCards: d.rateCards.filter((r) => r.id !== id),
          rateCardUnits: d.rateCardUnits.filter((u) => u.rateCardId !== id),
        }))
      },

      // --- Rate card units ---
      addRateCardUnit(u) {
        const unit: RateCardUnit = { ...u, id: newId('rcu') }
        setData((d) => ({ ...d, rateCardUnits: [...d.rateCardUnits, unit] }))
        return unit
      },
      updateRateCardUnit(id, patch) {
        setData((d) => ({ ...d, rateCardUnits: d.rateCardUnits.map((u) => (u.id === id ? { ...u, ...patch } : u)) }))
      },
      deleteRateCardUnit(id) {
        setData((d) => ({ ...d, rateCardUnits: d.rateCardUnits.filter((u) => u.id !== id) }))
      },

      // --- Employees ---
      addEmployee(e) {
        const emp: Employee = { ...e, id: newId('emp') }
        setData((d) => ({ ...d, employees: [...d.employees, emp] }))
        return emp
      },
      updateEmployee(id, patch) {
        setData((d) => ({ ...d, employees: d.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
      },
      deleteEmployee(id) {
        setData((d) => ({ ...d, employees: d.employees.filter((e) => e.id !== id) }))
      },

      // --- Timecards ---
      addTimecard(t) {
        setData((d) => ({ ...d, timecards: [...d.timecards, { ...t, id: newId('tc') }] }))
      },
      deleteTimecard(id) {
        setData((d) => ({ ...d, timecards: d.timecards.filter((t) => t.id !== id) }))
      },

      // --- Crew day entry ---
      addCrewDayEntry({ date, projectId, crewId, footage, notes, employees: empEntries, equipmentIds, lineItems }) {
        const entryId = newId('prod')
        setData((d) => {
          const totalHours = empEntries.reduce((s, e) => s + e.hours, 0)
          const hasLineItems = lineItems && lineItems.length > 0
          const revenueFromItems = hasLineItems
            ? lineItems.reduce((s, li) => s + li.extendedTotal, 0)
            : null
          // Footage from LF line items when provided, otherwise use raw footage
          const effectiveFootage = hasLineItems
            ? Math.round(lineItems.filter((li) => li.uom === 'LF').reduce((s, li) => s + li.quantity, 0))
            : footage
          const entry: ProductionEntry = {
            id: entryId,
            date,
            projectId,
            crewId,
            footage: effectiveFootage,
            hours: totalHours,
            notes,
            equipmentIds,
          }
          const production = [...d.production, entry]

          const totalLaborCost = empEntries.reduce((s, e) => {
            const emp = d.employees.find((em) => em.id === e.employeeId)
            return s + (emp ? Math.round(e.hours * emp.hourlyRate * 100) / 100 : 0)
          }, 0)

          const project = d.projects.find((p) => p.id === projectId)
          const revenue = revenueFromItems ?? effectiveFootage * resolveRatePerFoot(project, d.rateCards, d.rateCardUnits)

          const equipmentCost = Math.round(
            d.equipment
              .filter((eq) => eq.active && eq.crewId === crewId)
              .reduce((s, eq) => s + eq.monthlyCost / daysInMonth(date), 0)
          )

          const pnlLine: PnLEntry = {
            id: newId('pnl'),
            date,
            projectId,
            revenue: Math.round(revenue),
            laborCost: Math.round(totalLaborCost),
            materialCost: 0,
            equipmentCost,
            otherCost: 0,
            productionEntryId: entry.id,
          }

          const timecards: Timecard[] = empEntries.map((e) => {
            const emp = d.employees.find((em) => em.id === e.employeeId)
            const rate = emp?.hourlyRate ?? 0
            const laborCost = Math.round(e.hours * rate * 100) / 100
            const startMins = 7 * 60
            const endMins = startMins + Math.round(e.hours * 60)
            const clockIn = '07:00'
            const clockOut = `${String(Math.floor(endMins / 60) % 24).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`
            return {
              id: newId('tc'),
              employeeId: e.employeeId,
              date,
              jobId: projectId,
              clockIn,
              clockOut,
              hours: e.hours,
              rateSnapshot: rate,
              laborCost,
              productionEntryId: entry.id,
            }
          })

          const newLineItems: ProductionLineItem[] = hasLineItems
            ? lineItems.map((li) => ({ ...li, id: newId('pli'), productionEntryId: entry.id }))
            : []

          // Remove any legacy seed P&L entries for the same date+project that have no
          // productionEntryId — they duplicate revenue once a real entry is logged
          const pnlBase = d.pnl.filter(
            (p) => p.productionEntryId || !(p.date === entry.date && p.projectId === entry.projectId)
          )

          return {
            ...d,
            production,
            pnl: [...pnlBase, pnlLine],
            timecards: [...d.timecards, ...timecards],
            productionLineItems: [...d.productionLineItems, ...newLineItems],
            projects: recomputeFootage(d.projects, production),
          }
        })
        return entryId
      },
      deleteCrewDayEntry(productionEntryId) {
        for (const p of data.photos) {
          if (p.productionEntryId === productionEntryId && p.url.startsWith('idb:')) deleteBlob(p.url.slice(4))
        }
        setData((d) => {
          const production = d.production.filter((e) => e.id !== productionEntryId)
          return {
            ...d,
            production,
            pnl: d.pnl.filter((e) => e.productionEntryId !== productionEntryId),
            productionLineItems: d.productionLineItems.filter((li) => li.productionEntryId !== productionEntryId),
            timecards: d.timecards.filter((t) => t.productionEntryId !== productionEntryId),
            photos: d.photos.filter((p) => p.productionEntryId !== productionEntryId),
            projects: recomputeFootage(d.projects, production),
          }
        })
      },

      patchProductionEntry(id, patch) {
        setData((d) => {
          const { lineItems: newLineItems, ...entryPatch } = patch
          const lineItemsUpdated = newLineItems !== undefined
          const hasNewLineItems = lineItemsUpdated && newLineItems!.length > 0

          // When line items are provided, derive footage from LF quantities
          const footagePatch = hasNewLineItems
            ? { footage: Math.round(newLineItems!.filter((li) => li.uom === 'LF').reduce((s, li) => s + li.quantity, 0)) }
            : {}

          const production = d.production.map((e) =>
            e.id !== id ? e : { ...e, ...entryPatch, ...footagePatch },
          )
          // Cascade project/date changes to linked timecards, pnl, and photos
          const timecards = patch.projectId
            ? d.timecards.map((t) => t.productionEntryId === id ? { ...t, jobId: patch.projectId! } : t)
            : d.timecards
          let pnl = d.pnl.map((e) => {
            if (e.productionEntryId !== id) return e
            return {
              ...e,
              ...(patch.projectId ? { projectId: patch.projectId } : {}),
              ...(patch.date ? { date: patch.date } : {}),
            }
          })
          // Update pnl revenue when line items change (including clearing all)
          if (lineItemsUpdated) {
            const newRevenue = hasNewLineItems
              ? Math.round(newLineItems!.reduce((s, li) => s + li.extendedTotal, 0))
              : 0
            pnl = pnl.map((e) => e.productionEntryId === id ? { ...e, revenue: newRevenue } : e)
          }
          const productionLineItems = lineItemsUpdated
            ? [
                ...d.productionLineItems.filter((li) => li.productionEntryId !== id),
                ...(hasNewLineItems ? newLineItems!.map((li) => ({ ...li, id: newId('pli'), productionEntryId: id })) : []),
              ]
            : d.productionLineItems
          const photos = patch.projectId
            ? d.photos.map((p) => p.productionEntryId === id ? { ...p, projectId: patch.projectId! } : p)
            : d.photos
          return { ...d, production, timecards, pnl, productionLineItems, photos, projects: recomputeFootage(d.projects, production) }
        })
      },

      // --- Job expenses ---
      addJobExpense(e) {
        setData((d) => ({ ...d, jobExpenses: [...d.jobExpenses, { ...e, id: newId('exp') }] }))
      },
      deleteJobExpense(id) {
        setData((d) => ({ ...d, jobExpenses: d.jobExpenses.filter((e) => e.id !== id) }))
      },

      // --- Equipment ---
      addEquipment(e) {
        const eq: Equipment = { ...e, id: newId('eq') }
        setData((d) => ({ ...d, equipment: [...d.equipment, eq] }))
        return eq
      },
      updateEquipment(id, patch) {
        setData((d) => ({ ...d, equipment: d.equipment.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
      },
      deleteEquipment(id) {
        setData((d) => ({ ...d, equipment: d.equipment.filter((e) => e.id !== id) }))
      },

      addProjectFile(f) {
        const id = newId('pf')
        const { dataUrl, ...meta } = f
        saveBlob(id, dataUrl) // async — store blob in IndexedDB
        setData((d) => ({ ...d, projectFiles: [...d.projectFiles, { ...meta, id }] }))
      },
      deleteProjectFile(id) {
        deleteBlob(id) // async — clean up from IndexedDB
        setData((d) => ({
          ...d,
          projectFiles: d.projectFiles.filter((f) => f.id !== id),
          annotations: d.annotations.filter((a) => a.fileId !== id),
        }))
      },

      addAnnotation(a) {
        const id = newId('ann')
        setData((d) => ({ ...d, annotations: [...d.annotations, { ...a, id }] }))
        return id
      },
      updateAnnotation(id, patch) {
        setData((d) => ({ ...d, annotations: d.annotations.map((a) => a.id === id ? { ...a, ...patch } : a) }))
      },
      deleteAnnotation(id) {
        setData((d) => ({
          ...d,
          annotations: d.annotations.filter((a) => a.id !== id),
          markupBilling: (d.markupBilling ?? []).filter((b) => b.markupId !== id),
          markupPhotos: (d.markupPhotos ?? []).filter((p) => p.markupId !== id),
        }))
      },
      clearAnnotations(fileId, page) {
        setData((d) => ({ ...d, annotations: d.annotations.filter((a) => !(a.fileId === fileId && a.page === page)) }))
      },
      setAnnotationsForPage(fileId, page, shapes) {
        setData((d) => ({
          ...d,
          annotations: [
            ...d.annotations.filter((a) => !(a.fileId === fileId && a.page === page)),
            ...shapes,
          ],
        }))
      },

      addClockIn(entry) {
        const clock: ClockEntry = { ...entry, id: newId('clk') }
        setData((d) => ({ ...d, clockEntries: [...(d.clockEntries ?? []), clock] }))
        return clock
      },
      clockOut(id) {
        setData((d) => ({
          ...d,
          clockEntries: (d.clockEntries ?? []).map((e) =>
            e.id === id ? { ...e, clockOut: new Date().toISOString() } : e,
          ),
        }))
      },
      deleteClockEntry(id) {
        setData((d) => ({ ...d, clockEntries: (d.clockEntries ?? []).filter((e) => e.id !== id) }))
      },
      updateClockEntry(id, patch) {
        setData((d) => ({
          ...d,
          clockEntries: (d.clockEntries ?? []).map((e) => e.id !== id ? e : { ...e, ...patch }),
        }))
      },

      // --- KMZ production workflow ---
      addKmzUpload(upload, features) {
        const uploadId = newId('kmzu')
        const rec: KmzUpload = { ...upload, id: uploadId }
        const storedFeatures: MapFeature[] = features.map((f) => ({
          ...f,
          kmzUploadId: uploadId,
          projectId:   upload.projectId,
        }))
        setData((d) => ({
          ...d,
          kmzUploads:  [...(d.kmzUploads ?? []),  rec],
          mapFeatures: [...(d.mapFeatures ?? []),  ...storedFeatures],
        }))
        return rec
      },
      deleteKmzUpload(id) {
        setData((d) => ({
          ...d,
          kmzUploads:       (d.kmzUploads ?? []).filter((u) => u.id !== id),
          mapFeatures:      (d.mapFeatures ?? []).filter((f) => f.kmzUploadId !== id),
          featureProduction:(d.featureProduction ?? []).filter((e) => {
            const feature = (d.mapFeatures ?? []).find((f) => f.id === e.mapFeatureId)
            return feature?.kmzUploadId !== id
          }),
        }))
      },
      deleteMapFeature(id) {
        setData((d) => ({
          ...d,
          mapFeatures:       (d.mapFeatures ?? []).filter((f) => f.id !== id),
          featureProduction: (d.featureProduction ?? []).filter((e) => e.mapFeatureId !== id),
        }))
      },
      setFeatureStatus(featureId, status) {
        setData((d) => ({
          ...d,
          mapFeatures: (d.mapFeatures ?? []).map((f) =>
            f.id === featureId ? { ...f, status } : f,
          ),
        }))
      },
      updateMapFeature(id, patch) {
        setData((d) => ({
          ...d,
          mapFeatures: (d.mapFeatures ?? []).map((f) =>
            f.id === id ? { ...f, ...patch } : f,
          ),
        }))
      },
      addFeatureProduction(entry) {
        const id = newId('fpe')
        const rec: FeatureProductionEntry = { ...entry, id }
        setData((d) => ({
          ...d,
          featureProduction: [...(d.featureProduction ?? []), rec],
          // Bubble status up to the feature (unless entry says not_started)
          mapFeatures: entry.status !== 'not_started'
            ? (d.mapFeatures ?? []).map((f) =>
                f.id === entry.mapFeatureId ? { ...f, status: entry.status } : f,
              )
            : (d.mapFeatures ?? []),
        }))
        return id
      },
      deleteFeatureProduction(id) {
        setData((d) => ({
          ...d,
          featureProduction: (d.featureProduction ?? []).filter((e) => e.id !== id),
        }))
      },

      // ── Field markup ─────────────────────────────────────────────────────────
      addMarkup(m) {
        const id = newId('mkp')
        setData((d) => ({
          ...d,
          fieldMarkups: [...(d.fieldMarkups ?? []), { ...m, id, createdAt: new Date().toISOString() }],
          markupHistory: [...(d.markupHistory ?? []), historyEntry(id, 'created', m.createdBy ?? null)],
        }))
        return id
      },
      updateMarkup(id, patch, actor = null) {
        setData((d) => {
          const before = (d.fieldMarkups ?? []).find((m) => m.id === id)
          const newEntries = before ? diffMarkupUpdate(id, before, patch, actor) : []
          return {
            ...d,
            fieldMarkups: (d.fieldMarkups ?? []).map((m) =>
              m.id === id ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m,
            ),
            markupHistory: newEntries.length ? [...(d.markupHistory ?? []), ...newEntries] : (d.markupHistory ?? []),
          }
        })
      },
      deleteMarkup(id) {
        setData((d) => ({
          ...d,
          fieldMarkups: (d.fieldMarkups ?? []).filter((m) => m.id !== id),
          markupPhotos: (d.markupPhotos ?? []).filter((p) => p.markupId !== id),
          markupBilling: (d.markupBilling ?? []).filter((b) => b.markupId !== id),
          markupVideos: (d.markupVideos ?? []).filter((v) => v.markupId !== id),
          markupInspections: (d.markupInspections ?? []).filter((i) => i.markupId !== id),
          markupAttachments: (d.markupAttachments ?? []).filter((a) => a.markupId !== id),
          markupHistory: (d.markupHistory ?? []).filter((h) => h.markupId !== id),
        }))
        // Blobs in IndexedDB are cleaned up lazily — orphaned blobs are small and rarely accumulate
      },
      addMarkupPhoto(p, actor = null) {
        const id = newId('mkph')
        setData((d) => ({
          ...d,
          markupPhotos: [...(d.markupPhotos ?? []), { ...p, id }],
          markupHistory: [...(d.markupHistory ?? []), historyEntry(p.markupId, 'photo_added', actor)],
        }))
        return id
      },
      deleteMarkupPhoto(id, actor = null) {
        setData((d) => {
          const photo = (d.markupPhotos ?? []).find((p) => p.id === id)
          return {
            ...d,
            markupPhotos: (d.markupPhotos ?? []).filter((p) => p.id !== id),
            markupHistory: photo ? [...(d.markupHistory ?? []), historyEntry(photo.markupId, 'photo_removed', actor)] : (d.markupHistory ?? []),
          }
        })
        void deleteBlob(`mkp-${id}`)
      },
      addMarkupBilling(b, actor = null) {
        const id = newId('mkpb')
        setData((d) => ({
          ...d,
          markupBilling: [...(d.markupBilling ?? []), { ...b, id }],
          markupHistory: [...(d.markupHistory ?? []), historyEntry(b.markupId, 'billing_added', actor)],
        }))
        return id
      },
      updateMarkupBilling(id, patch) {
        setData((d) => ({
          ...d,
          markupBilling: (d.markupBilling ?? []).map((b) => b.id === id ? { ...b, ...patch } : b),
        }))
      },
      deleteMarkupBilling(id, actor = null) {
        setData((d) => {
          const billing = (d.markupBilling ?? []).find((b) => b.id === id)
          return {
            ...d,
            markupBilling: (d.markupBilling ?? []).filter((b) => b.id !== id),
            markupHistory: billing ? [...(d.markupHistory ?? []), historyEntry(billing.markupId, 'billing_removed', actor)] : (d.markupHistory ?? []),
          }
        })
      },

      // ── Work Object videos ────────────────────────────────────────────────
      addMarkupVideo(v) {
        const id = newId('mkpv')
        setData((d) => ({ ...d, markupVideos: [...(d.markupVideos ?? []), { ...v, id }] }))
        return id
      },
      deleteMarkupVideo(id) {
        setData((d) => ({ ...d, markupVideos: (d.markupVideos ?? []).filter((v) => v.id !== id) }))
        void deleteBlob(`mkp-${id}`)
      },

      // ── Work Object inspections ───────────────────────────────────────────
      addMarkupInspection(i) {
        const id = newId('mkpi')
        setData((d) => ({
          ...d,
          markupInspections: [...(d.markupInspections ?? []), { ...i, id, createdAt: new Date().toISOString() }],
          markupHistory: [...(d.markupHistory ?? []), historyEntry(i.markupId, 'inspection_added', i.createdBy ?? null)],
        }))
        return id
      },
      updateMarkupInspection(id, patch) {
        setData((d) => ({
          ...d,
          markupInspections: (d.markupInspections ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i)),
        }))
      },
      deleteMarkupInspection(id) {
        setData((d) => ({ ...d, markupInspections: (d.markupInspections ?? []).filter((i) => i.id !== id) }))
      },

      // ── Work Object attachments ───────────────────────────────────────────
      addMarkupAttachment(a) {
        const id = newId('mkpa')
        setData((d) => ({ ...d, markupAttachments: [...(d.markupAttachments ?? []), { ...a, id }] }))
        return id
      },
      deleteMarkupAttachment(id) {
        setData((d) => ({ ...d, markupAttachments: (d.markupAttachments ?? []).filter((a) => a.id !== id) }))
        void deleteBlob(`mkp-${id}`)
      },

      // ── Aerial lash fiber runs ────────────────────────────────────────────
      addAerialLashFiberRun(run) {
        const id = newId('alf')
        setData((d) => ({
          ...d,
          aerialLashFiberRuns: [...(d.aerialLashFiberRuns ?? []), { ...run, id, createdAt: new Date().toISOString() }],
        }))
        return id
      },
      updateAerialLashFiberRun(id, patch) {
        setData((d) => ({
          ...d,
          aerialLashFiberRuns: (d.aerialLashFiberRuns ?? []).map((r) =>
            r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r,
          ),
        }))
      },
      deleteAerialLashFiberRun(id) {
        setData((d) => ({
          ...d,
          aerialLashFiberRuns: (d.aerialLashFiberRuns ?? []).filter((r) => r.id !== id),
          // Cascade-delete pole photos (markupId starts with `alf:<id>:`)
          markupPhotos: (d.markupPhotos ?? []).filter((p) => !p.markupId.startsWith(`alf:${id}:`)),
        }))
      },

      // ── Field Map georeferenced overlays ──────────────────────────────────
      addFieldMapOverlay(overlay) {
        const id = newId('geo')
        setData((d) => ({
          ...d,
          fieldMapOverlays: [...(d.fieldMapOverlays ?? []), { ...overlay, id, createdAt: new Date().toISOString() }],
        }))
        return id
      },
      updateFieldMapOverlay(id, patch) {
        setData((d) => ({
          ...d,
          fieldMapOverlays: (d.fieldMapOverlays ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)),
        }))
      },
      deleteFieldMapOverlay(id) {
        setData((d) => ({
          ...d,
          fieldMapOverlays: (d.fieldMapOverlays ?? []).filter((o) => o.id !== id),
        }))
        // Blob cleanup is lazy, matching deleteMarkup's orphaned-blob convention above.
      },

      // ── Favorite billing unit codes ────────────────────────────────────────
      toggleFavoriteUnitCode(unitCode) {
        setData((d) => {
          const current = d.favoriteUnitCodes ?? []
          return {
            ...d,
            favoriteUnitCodes: current.includes(unitCode)
              ? current.filter((c) => c !== unitCode)
              : [...current, unitCode],
          }
        })
      },

      resetData() {
        setData(generateSeedData())
      },
    }
  }, [data])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within a DataProvider')
  return ctx
}
