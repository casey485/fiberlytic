import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  AppData,
  AerialLashFiberRun,
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
  MarkupHistoryAction,
  MarkupHistoryEntry,
  MarkupInspection,
  MarkupPhoto,
  MarkupVideo,
  MapCutPackage,
  MapReadingSession,
  Material,
  MaterialRequest,
  Notification,
  NotificationType,
  Photo,
  ProductionEntry,
  ProductionLineItem,
  PnLEntry,
  Project,
  ProjectFile,
  QaStatus,
  RateCard,
  RateCardUnit,
  Subcontractor,
  Timecard,
  EmployeeProductionRate,
  ProductionPayAllocation,
  SpliceEnclosure,
  FiberTapReport,
  SpliceReportTemplate,
  SpliceReportKind,
} from '../types'
import { generateSeedData } from '../data/seed'
import { crewLaborCost } from '../lib/laborCost'
import { daysInMonth, workTypeDivisions, entryDisplayFootage } from '../lib/analytics'
import { localDateStr } from '../lib/format'
import { saveBlob, deleteBlob } from '../lib/fileStore'
import { enqueue as enqueueSyncEntry, flush as flushSyncEntries } from '../lib/syncQueue'

export const STORAGE_KEY = 'fiberlytic:data:v1'

/** Bring older saved data up to the current shape. */
function migrateData(raw: AppData): AppData {
  const crews = (raw.crews ?? []).map((c) => ({
    ...c,
    payType: c.payType ?? 'daily',
    payAmount: c.payAmount ?? c.dayRate ?? 0,
    members: c.members ?? [],
  }))

  // Migrate projects: promote legacy `workType` (singular) → `workTypes` (array),
  // back-fill retentionPct to 10% when unset, recompute footageComplete from production.
  // Runs on every load (not gated by a version check), so this has to use the
  // same LF-preferring logic as recomputeFootage below — a multi-crew redline
  // split intentionally zeroes entry.footage on non-primary crews, and a
  // raw sum here would silently re-stomp footageComplete back down to that
  // undercount on every single page refresh even after recomputeFootage had
  // it right.
  const footageByProject = new Map<string, number>()
  for (const pe of raw.production ?? []) {
    const lineItems = (raw.productionLineItems ?? []).filter((li) => li.productionEntryId === pe.id)
    const footage = entryDisplayFootage(pe, lineItems)
    footageByProject.set(pe.projectId, (footageByProject.get(pe.projectId) ?? 0) + footage)
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

  // Purge records still referencing a project that no longer exists.
  // deleteProject's cascade used to only clean production/pnl/timecards/
  // jobExpenses — it never touched fieldMarkups, markupBilling, or
  // productionLineItems, so a deleted project's redlines lived on forever as
  // still-"pending" QA data: Production/P&L correctly showed nothing for that
  // project, but SubcontractorDashboard's Pending Earnings (and any other
  // QA-revenue figure, since those read productionLineItems/markupBilling
  // directly, not production/pnl) kept counting them. deleteProject's cascade
  // is now fixed too (see below), so this becomes a no-op once any
  // already-orphaned records from before that fix are cleaned up here.
  const validProjectIds = new Set(projects.map((p) => p.id))
  const orphanedMarkupIds = new Set(
    (raw.fieldMarkups ?? []).filter((m) => !validProjectIds.has(m.projectId)).map((m) => m.id),
  )
  const validProductionEntryIds = new Set(
    (raw.production ?? []).filter((e) => validProjectIds.has(e.projectId)).map((e) => e.id),
  )

  // Retroactive repair for a separate bug (now fixed at the source — see
  // lib/actorId.ts's createdByActorId): every effectiveActorId computation
  // across the app used to fall through to activeEmployeeId for a
  // subcontractor session too, instead of treating it as its own identity —
  // stamping FieldMarkup.createdBy with whatever in-house employee this
  // device had last picked in In-House view. Any markup that's clearly
  // subcontractor-created (assignedSubcontractorId is set) can never have a
  // legitimate Employee createdBy, so this un-stamps the stale id wherever
  // it's still baked in from before that fix — the real, correct
  // attribution was always assignedSubcontractorId, set independently.
  const fieldMarkupsFixed = (raw.fieldMarkups ?? []).map((m) =>
    m.assignedSubcontractorId && m.createdBy ? { ...m, createdBy: null } : m,
  )

  return {
    ...raw,
    crews,
    employees,
    projects,
    pnl: pnlWithRevenue,
    clients: raw.clients ?? [],
    rateCards,
    rateCardUnits: raw.rateCardUnits ?? [],
    production: raw.production ?? [],
    materials: raw.materials ?? [],
    invoices: raw.invoices ?? [],
    productionLineItems: (raw.productionLineItems ?? []).filter(
      (li) => !li.productionEntryId || validProductionEntryIds.has(li.productionEntryId),
    ),
    timecards: raw.timecards ?? [],
    jobExpenses,
    equipment: raw.equipment ?? [],
    projectFiles: raw.projectFiles ?? [],
    clockEntries: raw.clockEntries ?? [],
    kmzUploads: (raw.kmzUploads ?? []).filter((k) => validProjectIds.has(k.projectId)),
    mapFeatures: (raw.mapFeatures ?? []).filter((f) => validProjectIds.has(f.projectId)),
    featureProduction: (raw.featureProduction ?? []).filter((f) => validProjectIds.has(f.projectId)),
    fieldMarkups: fieldMarkupsFixed.filter((m) => !orphanedMarkupIds.has(m.id)),
    markupPhotos: (raw.markupPhotos ?? []).filter((p) => !orphanedMarkupIds.has(p.markupId)),
    markupBilling: (raw.markupBilling ?? []).filter((b) => !orphanedMarkupIds.has(b.markupId)),
    fieldMapOverlays: (raw.fieldMapOverlays ?? []).filter((o) => validProjectIds.has(o.projectId)),
    favoriteUnitCodes: raw.favoriteUnitCodes ?? [],
    markupVideos: (raw.markupVideos ?? []).filter((v) => !orphanedMarkupIds.has(v.markupId)),
    markupInspections: (raw.markupInspections ?? []).filter((i) => !orphanedMarkupIds.has(i.markupId)),
    markupAttachments: (raw.markupAttachments ?? []).filter((a) => !orphanedMarkupIds.has(a.markupId)),
    markupHistory: (raw.markupHistory ?? []).filter((h) => !orphanedMarkupIds.has(h.markupId)),
    mapCutPackages: (raw.mapCutPackages ?? []).filter((m) => validProjectIds.has(m.projectId)),
    mapReadingSessions: (raw.mapReadingSessions ?? []).filter((m) => validProjectIds.has(m.projectId)),
    employeeProductionRates: raw.employeeProductionRates ?? [],
    productionPayAllocations: raw.productionPayAllocations ?? [],
    subcontractors: raw.subcontractors ?? [],
    notifications: (raw.notifications ?? []).filter((n) => validProjectIds.has(n.projectId)),
    materialRequests: (raw.materialRequests ?? []).filter((r) => validProjectIds.has(r.projectId)),
    photos: (raw.photos ?? []).filter((p) => validProjectIds.has(p.projectId)),
    aerialLashFiberRuns: (raw.aerialLashFiberRuns ?? []).filter((a) => validProjectIds.has(a.projectId)),
    spliceEnclosures: (raw.spliceEnclosures ?? []).filter((s) => !orphanedMarkupIds.has(s.markupId)),
    fiberTapReports: (raw.fiberTapReports ?? []).filter((r) => validProjectIds.has(r.projectId)),
    spliceReportTemplates: raw.spliceReportTemplates ?? [],
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
  extra?: { field?: string; oldValue?: string | null; newValue?: string | null; note?: string },
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

const QA_NOTIFICATION_TITLES: Record<NotificationType, string> = {
  redline_submitted: 'New redline submitted for review',
  redline_approved: 'Redline approved',
  redline_rejected: 'Redline rejected',
  redline_rejection_fixed: 'Rejection marked fixed — ready for re-review',
  redline_approved_after_correction: 'Corrected redline approved',
  redline_edited_after_approval: 'Approved redline edited — ready for re-review',
}

/** Builds a complete Notification (including id/createdAt/readAt) for a QA/QC
 *  review action — called from inside a setData updater (not through the
 *  addNotification method, since a mutation-inside-a-mutation would be an
 *  anti-pattern), so it must return a ready-to-store record, not an Omit<>. */
function buildQaNotification(
  type: NotificationType,
  markup: FieldMarkup,
  billing: MarkupBilling,
  project: Project | undefined,
  fieldEmployee: Employee | undefined,
  recipientRole: 'admin' | 'field' = 'field',
  subcontractor?: Subcontractor,
): Notification {
  const subcontractorId = billing.assignedSubcontractorId ?? markup.assignedSubcontractorId ?? null
  const isSubcontractor = !!subcontractorId
  const fieldUserName = subcontractor?.companyName ?? fieldEmployee?.name ?? (isSubcontractor ? 'Subcontractor' : 'Unknown')
  return {
    id: newId('notif'),
    type,
    markupId: markup.id,
    markupBillingId: billing.id,
    projectId: markup.projectId,
    recipientRole,
    // Mutually exclusive: a subcontractor-owned line routes to the
    // Subcontractor view's notification bell via recipientSubcontractorId,
    // never to recipientEmployeeId (and vice versa for in-house work).
    recipientEmployeeId: recipientRole === 'field' && !isSubcontractor ? markup.createdBy : null,
    recipientSubcontractorId: recipientRole === 'field' && isSubcontractor ? subcontractorId : null,
    title: QA_NOTIFICATION_TITLES[type],
    body: `${billing.description} — ${project?.name ?? 'Unknown project'}`,
    createdAt: new Date().toISOString(),
    readAt: null,
    meta: {
      projectName: project?.name ?? 'Unknown project',
      location: project?.location ?? '',
      fieldUserName,
      isSubcontractor,
    },
  }
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
  // Material check-out requests
  addMaterialRequest: (r: Omit<MaterialRequest, 'id' | 'createdAt' | 'status' | 'fulfilledAt'>) => string
  markMaterialRequestFulfilled: (id: string) => void
  // Splicing — per-enclosure splice records + per-node fiber tap reports
  addSpliceEnclosure: (e: Omit<SpliceEnclosure, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateSpliceEnclosure: (id: string, patch: Partial<SpliceEnclosure>) => void
  deleteSpliceEnclosure: (id: string) => void
  addFiberTapReport: (r: Omit<FiberTapReport, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateFiberTapReport: (id: string, patch: Partial<FiberTapReport>) => void
  deleteFiberTapReport: (id: string) => void
  /** Uploading a new template for a kind replaces any existing one of that kind. */
  upsertSpliceReportTemplate: (kind: SpliceReportKind, t: Omit<SpliceReportTemplate, 'id' | 'kind' | 'createdAt' | 'updatedAt' | 'hasMasterWorkbook'>) => Promise<void>
  deleteSpliceReportTemplate: (kind: SpliceReportKind) => Promise<void>
  /** Persists the growing multi-tab workbook produced by saveEnclosureToMasterWorkbook. */
  setSpliceMasterWorkbookData: (kind: SpliceReportKind, fileData: string) => Promise<void>
  // Photos
  addPhoto: (p: Omit<Photo, 'id'>) => Photo
  deletePhoto: (id: string) => void
  // Invoices
  addInvoice: (i: Omit<Invoice, 'id'>) => string
  updateInvoice: (id: string, patch: Partial<Invoice>) => void
  markInvoicePaid: (id: string) => void
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
  // Employee Production Pay Rates — separate from RateCard/RateCardUnit above
  addEmployeeProductionRate: (r: Omit<EmployeeProductionRate, 'id'>) => EmployeeProductionRate
  updateEmployeeProductionRate: (id: string, patch: Partial<EmployeeProductionRate>) => void
  deleteEmployeeProductionRate: (id: string) => void
  // Production Pay Allocations — the manual admin "who gets credit for how much" step
  addProductionPayAllocation: (a: Omit<ProductionPayAllocation, 'id' | 'createdAt'>) => ProductionPayAllocation
  updateProductionPayAllocation: (id: string, patch: Partial<ProductionPayAllocation>) => void
  deleteProductionPayAllocation: (id: string) => void
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
  // Map Cuts
  addMapCutPackage: (p: Omit<MapCutPackage, 'id' | 'createdAt' | 'updatedAt'>) => MapCutPackage
  updateMapCutPackage: (id: string, patch: Partial<MapCutPackage>) => void
  deleteMapCutPackage: (id: string) => void
  // Map Reading — entirely separate from Map Cuts above, own CRUD, own data
  addMapReadingSession: (s: Omit<MapReadingSession, 'id' | 'createdAt' | 'updatedAt'>) => MapReadingSession
  updateMapReadingSession: (id: string, patch: Partial<MapReadingSession>) => void
  deleteMapReadingSession: (id: string) => void
  // Project files (blob stored in IndexedDB; only metadata goes to localStorage)
  addProjectFile: (f: Omit<ProjectFile, 'id'> & { dataUrl: string }) => string
  deleteProjectFile: (id: string) => void
  updateProjectFile: (id: string, patch: Partial<ProjectFile>) => void
  // Clock-in / geofence
  addClockIn: (entry: Omit<ClockEntry, 'id'>) => ClockEntry
  clockOut: (id: string) => void
  deleteClockEntry: (id: string) => void
  /** Bulk delete — one setData call instead of looping deleteClockEntry, so
   *  selecting a whole employee's history and clearing it doesn't trigger a
   *  re-render per row. */
  deleteClockEntries: (ids: string[]) => void
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
  softDeleteMarkup: (id: string, actor?: string | null) => void
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
  // Offline sync queue — drains queued Work Object mutations, marking each rolled-up
  // FieldMarkup 'synced'. No real sync target is configured yet (see lib/syncQueue.ts).
  flushSyncQueue: () => Promise<{ ok: boolean; flushed: number }>
  // Misc
  resetData: () => void

  // --- Subcontractors ---
  addSubcontractor: (s: Omit<Subcontractor, 'id'>) => Subcontractor
  updateSubcontractor: (id: string, patch: Partial<Subcontractor>) => void
  deleteSubcontractor: (id: string) => void

  // --- Notifications ---
  addNotification: (n: Omit<Notification, 'id' | 'createdAt' | 'readAt'>) => string
  markNotificationRead: (id: string) => void
  markAllNotificationsRead: (recipientRole: 'admin' | 'field', recipientEmployeeId?: string | null, recipientSubcontractorId?: string | null) => void

  // --- Redline QA/QC Approval Workflow — reviews one MarkupBilling line at a
  // time (the "redline item" granularity), cascades the new status onto every
  // ProductionLineItem generated from that line, and writes a permanent
  // markupHistory entry. Never creates a duplicate rejection record — re-
  // rejecting overwrites the live qa* fields on the same MarkupBilling row;
  // the full history of every note (including superseded ones) survives in
  // markupHistory, which is append-only. ---
  approveQaLine: (markupBillingId: string, actor: string | null, note?: string) => void
  rejectQaLine: (markupBillingId: string, actor: string | null, note: string) => void
  markRejectionFixedQa: (markupBillingId: string, actor: string | null, note?: string) => void
  logQaSubmitted: (markupId: string, actor?: string | null) => void
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

  // One-time migration: zero out labor/equipment cost that was already saved
  // on Field-Map-sourced PnLEntry rows before addProduction stopped
  // generating it for them. Without this, every redline submitted prior to
  // that fix keeps showing its old flat-rate cost (e.g. the same $318 on
  // every "Directional Drill" row) forever — the fix only stops *new*
  // entries from getting it, it can't retroactively touch what's already in
  // localStorage.
  useEffect(() => {
    // Scoped to crew-sourced entries only (no subcontractorId) — subcontractor
    // entries are handled by the backfill migration below, which needs to set
    // a *nonzero* labor cost; if this ran unscoped it would zero that back out
    // on every subsequent load.
    const markupSourcedIds = new Set(
      data.production.filter((pe) => pe.sourceMarkupId && !pe.subcontractorId).map((pe) => pe.id),
    )
    const stale = data.pnl.filter(
      (p) => p.productionEntryId && markupSourcedIds.has(p.productionEntryId) && (p.laborCost > 0 || p.equipmentCost > 0),
    )
    if (stale.length === 0) return
    const staleIds = new Set(stale.map((p) => p.id))
    setData((d) => ({
      ...d,
      pnl: d.pnl.map((p) => (staleIds.has(p.id) ? { ...p, laborCost: 0, equipmentCost: 0 } : p)),
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One-time migration: backfill subcontractor pay cost onto existing
  // ProductionEntry/PnLEntry rows created before addProduction started
  // computing it (see the subcontractor branch above) — without this,
  // every subcontractor-sourced entry submitted before the fix keeps
  // showing $0 labor cost forever, understating cost/overstating profit
  // on every admin P&L view that already loaded that data.
  useEffect(() => {
    const subById = new Map((data.subcontractors ?? []).map((s) => [s.id, s]))
    const subProdIds = new Map(
      data.production.filter((pe) => pe.subcontractorId).map((pe) => [pe.id, pe.subcontractorId!]),
    )
    if (subProdIds.size === 0) return
    const needsBackfill = data.pnl.filter((p) => {
      if (!p.productionEntryId || p.laborCost !== 0) return false
      const subId = subProdIds.get(p.productionEntryId)
      if (!subId) return false
      const sub = subById.get(subId)
      return !!sub && sub.payRatePercent != null && sub.payRatePercent > 0 && p.revenue > 0
    })
    if (needsBackfill.length === 0) return
    setData((d) => ({
      ...d,
      pnl: d.pnl.map((p) => {
        const subId = p.productionEntryId ? subProdIds.get(p.productionEntryId) : undefined
        const sub = subId ? subById.get(subId) : undefined
        if (!sub || sub.payRatePercent == null || p.laborCost !== 0 || p.revenue <= 0) return p
        return { ...p, laborCost: Math.round(p.revenue * sub.payRatePercent / 100) }
      }),
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One-time migration: Subcontractor.rateCardId (a single company-wide
  // fallback) was removed in favor of Subcontractor.projectRateCards
  // (per-project entries only) — a subcontractor can carry a different
  // negotiated rate per project now, so one lone "default" was either
  // redundant or silently wrong for whichever other project the same
  // company also worked. For any subcontractor that still has the old field
  // in localStorage, seed a projectRateCards entry for each project they're
  // currently assigned to (skipping any project that already has its own
  // override) so their existing effective rate doesn't just disappear, then
  // drop the legacy field.
  useEffect(() => {
    const legacy = (data.subcontractors ?? []).filter(
      (s) => (s as unknown as { rateCardId?: string | null }).rateCardId,
    )
    if (legacy.length === 0) return
    setData((d) => ({
      ...d,
      subcontractors: (d.subcontractors ?? []).map(({ rateCardId: legacyRateCardId, ...rest }: { rateCardId?: string | null } & Subcontractor) => {
        if (!legacyRateCardId) return rest
        const existingProjectIds = new Set((rest.projectRateCards ?? []).map((pr) => pr.projectId))
        const assignedProjectIds = d.projects
          .filter((p) => p.subcontractorIds?.includes(rest.id) && !existingProjectIds.has(p.id))
          .map((p) => p.id)
        return {
          ...rest,
          projectRateCards: [
            ...(rest.projectRateCards ?? []),
            ...assignedProjectIds.map((projectId) => ({ projectId, rateCardId: legacyRateCardId })),
          ],
        }
      }),
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<DataContextValue>(() => {
    // Prefers each entry's LF line-item sum over its raw footage field (see
    // entryDisplayFootage's doc comment) — a multi-crew redline split
    // intentionally zeroes footage on non-primary crews, and summing that
    // raw field directly would silently undercount footageComplete for any
    // project with production that went through that path.
    const recomputeFootage = (projects: Project[], production: ProductionEntry[], productionLineItems: ProductionLineItem[]) =>
      projects.map((p) => {
        if (p.status === 'complete') return p
        const total = production
          .filter((e) => e.projectId === p.id)
          .reduce((sum, e) => sum + entryDisplayFootage(e, productionLineItems.filter((li) => li.productionEntryId === e.id)), 0)
        return { ...p, footageComplete: Math.round(total) }
      })

    // Shared by updateMarkupBilling and updateMarkup (Quantity field): given a
    // productionLineItems array that already has one line item's
    // quantity/rateSnapshot/extendedTotal updated, recomputes that line's
    // parent ProductionEntry.footage and the linked PnLEntry.revenue so a
    // billing-line edit never leaves Production/P&L holding a stale snapshot.
    const applyLineItemToProduction = (
      d: AppData,
      productionLineItems: ProductionLineItem[],
      entryId: string,
    ): Pick<AppData, 'productionLineItems' | 'production' | 'pnl' | 'projects'> => {
      const siblingItems = productionLineItems.filter((li) => li.productionEntryId === entryId)
      const newFootage = Math.round(siblingItems.filter((li) => li.uom === 'LF').reduce((s, li) => s + li.quantity, 0))
      const newRevenue = Math.round(siblingItems.reduce((s, li) => s + li.extendedTotal, 0))
      const production = d.production.map((e) => (e.id === entryId ? { ...e, footage: newFootage } : e))
      const pnl = d.pnl.map((e) => (e.productionEntryId === entryId ? { ...e, revenue: newRevenue } : e))
      return { productionLineItems, production, pnl, projects: recomputeFootage(d.projects, production, productionLineItems) }
    }

    // Shared by updateMarkup and updateMarkupBilling: a billing-relevant edit
    // (quantity, rate, etc.) landing on a line that was already 'approved' or
    // 'approved_after_correction' means the approval no longer reflects
    // what's actually billed — silently leaving it "approved" would let a
    // changed footage/dollar amount go out the door with nobody having
    // actually re-checked the new number. Reset it to 'pending_review' (same
    // status a first submission gets) and notify the supervisor, exactly
    // like markRejectionFixedQa's "ready for re-review" notification below.
    // A no-op for lines that were never reviewed or are already pending/
    // rejected — this only reopens a line QA had actively signed off on.
    const reopenQaIfAlreadyApproved = (
      d: AppData,
      markupBilling: MarkupBilling[],
      billingId: string,
    ): Pick<AppData, 'markupBilling' | 'productionLineItems' | 'notifications'> => {
      const before = markupBilling.find((b) => b.id === billingId)
      if (!before || (before.qaStatus !== 'approved' && before.qaStatus !== 'approved_after_correction')) {
        return { markupBilling, productionLineItems: d.productionLineItems, notifications: d.notifications ?? [] }
      }
      const nextBilling = markupBilling.map((b) =>
        b.id === billingId
          ? { ...b, qaStatus: 'pending_review' as const, qaApprovedBy: null, qaApprovedAt: null, qaReviewedBy: null, qaReviewedAt: null }
          : b,
      )
      const productionLineItems = (d.productionLineItems ?? []).map((li) =>
        li.sourceMarkupBillingId === billingId ? { ...li, qaStatus: 'pending_review' as const } : li,
      )
      const markup = (d.fieldMarkups ?? []).find((m) => m.id === before.markupId)
      const project = markup ? (d.projects ?? []).find((p) => p.id === markup.projectId) : undefined
      const fieldEmployee = markup?.createdBy ? (d.employees ?? []).find((e) => e.id === markup.createdBy) : undefined
      const subId = before.assignedSubcontractorId ?? markup?.assignedSubcontractorId
      const subcontractor = subId ? (d.subcontractors ?? []).find((s) => s.id === subId) : undefined
      const notifications = markup
        ? [...(d.notifications ?? []), buildQaNotification('redline_edited_after_approval', markup, before, project, fieldEmployee, 'admin', subcontractor)]
        : (d.notifications ?? [])
      return { markupBilling: nextBilling, productionLineItems, notifications }
    }

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
      // Cascades to every project-scoped table, not just production/pnl — a
      // gap here previously left a deleted project's redlines/billing lines
      // alive forever with their qaStatus intact, still counted by
      // computeQaRevenueBreakdown (SubcontractorDashboard's Pending Earnings,
      // the P&L QA cards) even though Production/P&L correctly showed
      // nothing for the project. See migrateData's orphan-purge for the
      // one-time repair of data already corrupted by that gap.
      deleteProject(id) {
        setData((d) => {
          const removedMarkupIds = new Set((d.fieldMarkups ?? []).filter((m) => m.projectId === id).map((m) => m.id))
          const removedProductionEntryIds = new Set(d.production.filter((e) => e.projectId === id).map((e) => e.id))
          return {
            ...d,
            projects: d.projects.filter((p) => p.id !== id),
            production: d.production.filter((e) => e.projectId !== id),
            pnl: d.pnl.filter((e) => e.projectId !== id),
            timecards: d.timecards.filter((t) => t.jobId !== id),
            jobExpenses: d.jobExpenses.filter((e) => e.jobId !== id),
            crews: d.crews.map((c) => (c.currentProjectId === id ? { ...c, currentProjectId: null, status: 'idle' } : c)),
            productionLineItems: (d.productionLineItems ?? []).filter((li) => !li.productionEntryId || !removedProductionEntryIds.has(li.productionEntryId)),
            photos: (d.photos ?? []).filter((p) => p.projectId !== id),
            fieldMarkups: (d.fieldMarkups ?? []).filter((m) => m.projectId !== id),
            markupPhotos: (d.markupPhotos ?? []).filter((p) => !removedMarkupIds.has(p.markupId)),
            markupBilling: (d.markupBilling ?? []).filter((b) => !removedMarkupIds.has(b.markupId)),
            markupVideos: (d.markupVideos ?? []).filter((v) => !removedMarkupIds.has(v.markupId)),
            markupInspections: (d.markupInspections ?? []).filter((i) => !removedMarkupIds.has(i.markupId)),
            markupAttachments: (d.markupAttachments ?? []).filter((a) => !removedMarkupIds.has(a.markupId)),
            markupHistory: (d.markupHistory ?? []).filter((h) => !removedMarkupIds.has(h.markupId)),
            notifications: (d.notifications ?? []).filter((n) => n.projectId !== id),
            materialRequests: (d.materialRequests ?? []).filter((r) => r.projectId !== id),
            kmzUploads: (d.kmzUploads ?? []).filter((k) => k.projectId !== id),
            mapFeatures: (d.mapFeatures ?? []).filter((f) => f.projectId !== id),
            featureProduction: (d.featureProduction ?? []).filter((f) => f.projectId !== id),
            fieldMapOverlays: (d.fieldMapOverlays ?? []).filter((o) => o.projectId !== id),
            mapCutPackages: (d.mapCutPackages ?? []).filter((m) => m.projectId !== id),
            mapReadingSessions: (d.mapReadingSessions ?? []).filter((m) => m.projectId !== id),
            aerialLashFiberRuns: (d.aerialLashFiberRuns ?? []).filter((a) => a.projectId !== id),
            spliceEnclosures: (d.spliceEnclosures ?? []).filter((s) => !removedMarkupIds.has(s.markupId)),
            fiberTapReports: (d.fiberTapReports ?? []).filter((r) => r.projectId !== id),
          }
        })
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

          const revenue = revenueFromItems ?? entry.footage * resolveRatePerFoot(project, d.rateCards, d.rateCardUnits)

          // A Field Map redline (sourceMarkupId set) never carries real tracked
          // hours or equipment usage — the Add Work wizard doesn't ask for
          // either, so entry.hours is always 0. A 'daily' pay type ignores
          // hours entirely and would otherwise charge a full flat day rate
          // per redline regardless of how much was actually done, and
          // equipment cost is a flat monthly share with the same problem —
          // neither reflects anything the crew actually logged. Rather than
          // fabricate a cost from unverified defaults, markup-sourced entries
          // get $0 here; real cost still flows in normally via Time Clock /
          // Crew Day Entry timecards, which computeMetrics already prefers
          // over this pnl fallback wherever they exist.
          const isMarkupSourced = !!entry.sourceMarkupId
          // A subcontractor entry has no crewId (see productionFromMarkup.ts /
          // Production.tsx's merged crew-or-sub selector), so it has no
          // equivalent "timecard" fallback to recover cost from later like
          // crew work does — without this branch every subcontractor entry
          // silently costs $0 forever, overstating admin-facing profit by
          // however much the subcontractor is actually owed. Their pay is a
          // percentage of what this entry billed, snapshotted here the same
          // way billing lines snapshot their rate (see MarkupBilling.rate) —
          // if the rate isn't configured yet, cost stays $0 rather than
          // guessing, matching SubcontractorDashboard's own "show nothing"
          // rule for the same unconfigured case.
          const subcontractor = entry.subcontractorId
            ? (d.subcontractors ?? []).find((s) => s.id === entry.subcontractorId)
            : null
          const laborCost = subcontractor
            ? Math.round(revenue * (subcontractor.payRatePercent ?? 0) / 100)
            : isMarkupSourced ? 0 : crewLaborCost(crew, entry.hours, entry.footage).total

          // Sum daily cost of all active equipment assigned to this crew (monthly / actual days in that month)
          const equipmentCost = isMarkupSourced ? 0 : Math.round(
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

          const productionLineItems = [...d.productionLineItems, ...newLineItems]
          return {
            ...d,
            production,
            pnl: [...pnlBase, pnlLine],
            productionLineItems,
            projects: recomputeFootage(d.projects, production, productionLineItems),
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
          const productionLineItems = d.productionLineItems.filter((li) => li.productionEntryId !== id)
          return {
            ...d,
            production,
            pnl,
            productionLineItems,
            photos: d.photos.filter((p) => p.productionEntryId !== id),
            projects: recomputeFootage(d.projects, production, productionLineItems),
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

      addMaterialRequest(r) {
        const id = newId('matreq')
        setData((d) => ({
          ...d,
          materialRequests: [
            ...(d.materialRequests ?? []),
            { ...r, id, status: 'pending', createdAt: new Date().toISOString(), fulfilledAt: null },
          ],
        }))
        return id
      },
      markMaterialRequestFulfilled(id) {
        setData((d) => ({
          ...d,
          materialRequests: (d.materialRequests ?? []).map((r) =>
            r.id === id ? { ...r, status: 'fulfilled', fulfilledAt: new Date().toISOString() } : r,
          ),
        }))
      },

      addSpliceEnclosure(e) {
        const id = newId('splice')
        setData((d) => ({
          ...d,
          spliceEnclosures: [
            ...(d.spliceEnclosures ?? []),
            { ...e, id, createdAt: new Date().toISOString(), updatedAt: null },
          ],
        }))
        return id
      },
      updateSpliceEnclosure(id, patch) {
        setData((d) => ({
          ...d,
          spliceEnclosures: (d.spliceEnclosures ?? []).map((s) =>
            s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s,
          ),
        }))
      },
      deleteSpliceEnclosure(id) {
        setData((d) => ({ ...d, spliceEnclosures: (d.spliceEnclosures ?? []).filter((s) => s.id !== id) }))
      },

      addFiberTapReport(r) {
        const id = newId('taprpt')
        setData((d) => ({
          ...d,
          fiberTapReports: [
            ...(d.fiberTapReports ?? []),
            { ...r, id, createdAt: new Date().toISOString(), updatedAt: null },
          ],
        }))
        return id
      },
      updateFiberTapReport(id, patch) {
        setData((d) => ({
          ...d,
          fiberTapReports: (d.fiberTapReports ?? []).map((r) =>
            r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r,
          ),
        }))
      },
      deleteFiberTapReport(id) {
        setData((d) => ({ ...d, fiberTapReports: (d.fiberTapReports ?? []).filter((r) => r.id !== id) }))
      },

      async upsertSpliceReportTemplate(kind, t) {
        const existing = data.spliceReportTemplates?.find((x) => x.kind === kind)
        const sameBaseFile = existing?.fileData === t.fileData
        // The master workbook was cloned from the old fileData — only keep
        // accumulating into it if this upload is the *same* base file (e.g.
        // just a mapping tweak); a genuinely new file starts fresh, so the
        // stale blob (if any) is no longer reachable and gets cleaned up.
        if (!sameBaseFile && existing?.hasMasterWorkbook) await deleteBlob(`spltpl-${existing.id}`)
        setData((d) => {
          const id = existing?.id ?? newId('rpttpl')
          const template: SpliceReportTemplate = {
            ...t,
            kind,
            id,
            hasMasterWorkbook: sameBaseFile ? (existing?.hasMasterWorkbook ?? false) : false,
            createdAt: existing?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          return {
            ...d,
            spliceReportTemplates: [...(d.spliceReportTemplates ?? []).filter((x) => x.kind !== kind), template],
          }
        })
      },
      async setSpliceMasterWorkbookData(kind, fileData) {
        const template = data.spliceReportTemplates?.find((x) => x.kind === kind)
        if (!template) return
        await saveBlob(`spltpl-${template.id}`, fileData)
        setData((d) => ({
          ...d,
          spliceReportTemplates: (d.spliceReportTemplates ?? []).map((t) =>
            t.kind === kind ? { ...t, hasMasterWorkbook: true, updatedAt: new Date().toISOString() } : t,
          ),
        }))
      },
      async deleteSpliceReportTemplate(kind) {
        const template = data.spliceReportTemplates?.find((x) => x.kind === kind)
        if (template?.hasMasterWorkbook) await deleteBlob(`spltpl-${template.id}`)
        setData((d) => ({ ...d, spliceReportTemplates: (d.spliceReportTemplates ?? []).filter((x) => x.kind !== kind) }))
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
      markInvoicePaid(id) {
        setData((d) => ({
          ...d,
          invoices: d.invoices.map((i) => (i.id === id ? { ...i, status: 'paid', paidDate: new Date().toISOString() } : i)),
        }))
      },
      deleteInvoice(id) {
        setData((d) => ({
          ...d,
          invoices: d.invoices.filter((i) => i.id !== id),
          // Un-invoicing: a deleted invoice's source billing lines must not
          // stay permanently locked out of future invoicing with a dangling
          // Invoice.id reference — clear invoiceId so they become
          // invoiceable candidates again.
          markupBilling: (d.markupBilling ?? []).map((b) => (b.invoiceId === id ? { ...b, invoiceId: null } : b)),
        }))
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

      // --- Employee Production Pay Rates (separate from RateCard/RateCardUnit above) ---
      addEmployeeProductionRate(r) {
        const rate: EmployeeProductionRate = { ...r, id: newId('epr') }
        setData((d) => ({ ...d, employeeProductionRates: [...d.employeeProductionRates, rate] }))
        return rate
      },
      updateEmployeeProductionRate(id, patch) {
        setData((d) => ({
          ...d,
          employeeProductionRates: d.employeeProductionRates.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        }))
      },
      deleteEmployeeProductionRate(id) {
        setData((d) => ({ ...d, employeeProductionRates: d.employeeProductionRates.filter((r) => r.id !== id) }))
      },

      // --- Production Pay Allocations ---
      addProductionPayAllocation(a) {
        const allocation: ProductionPayAllocation = { ...a, id: newId('ppa'), createdAt: new Date().toISOString() }
        setData((d) => ({ ...d, productionPayAllocations: [...d.productionPayAllocations, allocation] }))
        return allocation
      },
      updateProductionPayAllocation(id, patch) {
        setData((d) => ({
          ...d,
          productionPayAllocations: d.productionPayAllocations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        }))
      },
      deleteProductionPayAllocation(id) {
        setData((d) => ({ ...d, productionPayAllocations: d.productionPayAllocations.filter((a) => a.id !== id) }))
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

          const productionLineItems = [...d.productionLineItems, ...newLineItems]
          return {
            ...d,
            production,
            pnl: [...pnlBase, pnlLine],
            timecards: [...d.timecards, ...timecards],
            productionLineItems,
            projects: recomputeFootage(d.projects, production, productionLineItems),
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
          const productionLineItems = d.productionLineItems.filter((li) => li.productionEntryId !== productionEntryId)
          return {
            ...d,
            production,
            pnl: d.pnl.filter((e) => e.productionEntryId !== productionEntryId),
            productionLineItems,
            timecards: d.timecards.filter((t) => t.productionEntryId !== productionEntryId),
            photos: d.photos.filter((p) => p.productionEntryId !== productionEntryId),
            projects: recomputeFootage(d.projects, production, productionLineItems),
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
          return { ...d, production, timecards, pnl, productionLineItems, photos, projects: recomputeFootage(d.projects, production, productionLineItems) }
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

      // --- Map Cuts ---
      addMapCutPackage(p) {
        const now = new Date().toISOString()
        const pkg: MapCutPackage = { ...p, id: newId('mcp'), createdAt: now, updatedAt: now }
        setData((d) => ({ ...d, mapCutPackages: [...d.mapCutPackages, pkg] }))
        return pkg
      },
      updateMapCutPackage(id, patch) {
        setData((d) => ({
          ...d,
          mapCutPackages: d.mapCutPackages.map((p) =>
            p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p,
          ),
        }))
      },
      deleteMapCutPackage(id) {
        setData((d) => ({ ...d, mapCutPackages: d.mapCutPackages.filter((p) => p.id !== id) }))
      },

      // --- Map Reading ---
      addMapReadingSession(s) {
        const now = new Date().toISOString()
        const session: MapReadingSession = { ...s, id: newId('mrs'), createdAt: now, updatedAt: now }
        setData((d) => ({ ...d, mapReadingSessions: [...d.mapReadingSessions, session] }))
        return session
      },
      updateMapReadingSession(id, patch) {
        setData((d) => ({
          ...d,
          mapReadingSessions: d.mapReadingSessions.map((s) =>
            s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s,
          ),
        }))
      },
      deleteMapReadingSession(id) {
        setData((d) => ({ ...d, mapReadingSessions: d.mapReadingSessions.filter((s) => s.id !== id) }))
      },

      addProjectFile(f) {
        const id = newId('pf')
        const { dataUrl, ...meta } = f
        saveBlob(id, dataUrl) // async — store blob in IndexedDB
        setData((d) => ({ ...d, projectFiles: [...d.projectFiles, { ...meta, id }] }))
        return id
      },
      deleteProjectFile(id) {
        deleteBlob(id) // async — clean up from IndexedDB
        setData((d) => ({
          ...d,
          projectFiles: d.projectFiles.filter((f) => f.id !== id),
        }))
      },
      updateProjectFile(id, patch) {
        setData((d) => ({
          ...d,
          projectFiles: d.projectFiles.map((f) => (f.id === id ? { ...f, ...patch } : f)),
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
      deleteClockEntries(ids) {
        const idSet = new Set(ids)
        setData((d) => ({ ...d, clockEntries: (d.clockEntries ?? []).filter((e) => !idSet.has(e.id)) }))
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
        const nowDate = new Date()
        const now = nowDate.toISOString()
        // workDate defaults to the crew's LOCAL calendar day (see localDateStr) —
        // every markup gets one here, billable or not (Non-Billable Item,
        // comment/sequential annotations included), so a PDF export's
        // date-range filter picks up everything entered that day, not just
        // billable lines.
        setData((d) => ({
          ...d,
          fieldMarkups: [...(d.fieldMarkups ?? []), { ...m, id, createdAt: now, workDate: m.workDate ?? localDateStr(nowDate), syncStatus: 'pending' }],
          markupHistory: [...(d.markupHistory ?? []), historyEntry(id, 'created', m.createdBy ?? null)],
        }))
        enqueueSyncEntry('markup', id, id, 'create')
        return id
      },
      updateMarkup(id, patch, actor = null) {
        setData((d) => {
          const before = (d.fieldMarkups ?? []).find((m) => m.id === id)
          const newEntries = before ? diffMarkupUpdate(id, before, patch, actor) : []
          const fieldMarkups = (d.fieldMarkups ?? []).map((m) =>
            m.id === id ? { ...m, ...patch, updatedAt: new Date().toISOString(), syncStatus: 'pending' as const } : m,
          )
          let result = {
            ...d,
            fieldMarkups,
            markupHistory: newEntries.length ? [...(d.markupHistory ?? []), ...newEntries] : (d.markupHistory ?? []),
          }

          // The markup's own Quantity field only seeds a billing line's quantity
          // once, when that line is first added (see AddWorkModal's addBillingLine)
          // — after that they're independent records. When Quantity changes here,
          // carry it forward into any billing line that's still tracking the old
          // value 1:1 (hasn't been manually overridden to something else), and —
          // if that line already generated a production entry — update Production/
          // P&L too, exactly like an edit made directly on the billing line would.
          if (before && before.quantity != null && patch.quantity != null && patch.quantity !== before.quantity) {
            const oldQuantity = before.quantity
            const newQuantity = patch.quantity
            const affected = (d.markupBilling ?? []).filter((b) => b.markupId === id && b.quantity === oldQuantity)
            if (affected.length > 0) {
              const affectedIds = new Set(affected.map((b) => b.id))
              let markupBilling = (d.markupBilling ?? []).map((b) =>
                affectedIds.has(b.id) ? { ...b, quantity: newQuantity, total: newQuantity * b.rate } : b,
              )
              let productionLineItems = result.productionLineItems
              result = { ...result, markupBilling }
              for (const b of affected) {
                // The old quantity's already-approved review no longer reflects
                // what's actually billed now — reopen it for the supervisor.
                const reopened = reopenQaIfAlreadyApproved(result, markupBilling, b.id)
                markupBilling = reopened.markupBilling
                productionLineItems = reopened.productionLineItems
                result = { ...result, markupBilling, productionLineItems, notifications: reopened.notifications }

                const linkedLineItem = productionLineItems.find((li) => li.sourceMarkupBillingId === b.id)
                if (!linkedLineItem) continue
                productionLineItems = productionLineItems.map((li) =>
                  li.id === linkedLineItem.id
                    ? { ...li, quantity: newQuantity, extendedTotal: newQuantity * li.rateSnapshot }
                    : li,
                )
                result = { ...result, ...applyLineItemToProduction(result, productionLineItems, linkedLineItem.productionEntryId) }
              }
            }
          }

          // The markup's Work Date is user-editable independently of createdAt (see
          // FieldMarkup.workDate) — e.g. work done 7/3 but the redline entered 7/6.
          // Backdating/postdating it must carry through to every Production/P&L
          // entry already generated from this markup (submitMarkupToProduction can
          // create more than one ProductionEntry per markup, one per crew), so
          // Production/Daily Production/Project History/Dashboard — which all read
          // these canonical arrays directly — reflect the corrected date everywhere.
          if (before && patch.workDate != null && patch.workDate !== before.workDate) {
            const affectedEntryIds = new Set(
              result.production.filter((e) => e.sourceMarkupId === id).map((e) => e.id),
            )
            if (affectedEntryIds.size > 0) {
              const workDate = patch.workDate
              result = {
                ...result,
                production: result.production.map((e) => (affectedEntryIds.has(e.id) ? { ...e, date: workDate } : e)),
                pnl: result.pnl.map((p) => (p.productionEntryId && affectedEntryIds.has(p.productionEntryId) ? { ...p, date: workDate } : p)),
              }
            }
          }

          return result
        })
        enqueueSyncEntry('markup', id, id, 'update')
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
          notifications: (d.notifications ?? []).filter((n) => n.markupId !== id),
          spliceEnclosures: (d.spliceEnclosures ?? []).filter((s) => s.markupId !== id),
        }))
        enqueueSyncEntry('markup', id, id, 'delete')
        // Blobs in IndexedDB are cleaned up lazily — orphaned blobs are small and rarely accumulate
      },
      // User-facing "delete this Work Object" (Field Map toolbar / MarkupPanel / layer manager) —
      // unlike deleteMarkup (used only by Undo/Split/Merge/callout-removal internals), this keeps
      // the markup plus its photos/billing/history intact for audit and just flags it deletedAt,
      // while cascading a real removal of whatever production/P&L it had already generated —
      // mirrors deleteProduction's existing cascade exactly, just keyed by sourceMarkupId.
      // Also removes any notification about this markup (QA submitted/approved/rejected etc.) —
      // once the line itself is gone there's nothing left to act on, so a "Redline rejected" or
      // "Corrected redline approved" alert sitting in the bell would just be a dead link.
      softDeleteMarkup(id, actor = null) {
        const now = new Date().toISOString()
        for (const p of data.photos) {
          if (p.productionEntryId && data.production.find((e) => e.id === p.productionEntryId && e.sourceMarkupId === id) && p.url.startsWith('idb:')) {
            deleteBlob(p.url.slice(4))
          }
        }
        setData((d) => {
          const removedIds = new Set((d.production ?? []).filter((e) => e.sourceMarkupId === id).map((e) => e.id))
          const production = (d.production ?? []).filter((e) => !removedIds.has(e.id))
          const pnl = (d.pnl ?? []).filter((e) => !(e.productionEntryId && removedIds.has(e.productionEntryId)))
          const productionLineItems = (d.productionLineItems ?? []).filter((li) => !removedIds.has(li.productionEntryId))
          return {
            ...d,
            fieldMarkups: (d.fieldMarkups ?? []).map((m) => (m.id === id ? { ...m, deletedAt: now, deletedBy: actor } : m)),
            production,
            pnl,
            productionLineItems,
            photos: (d.photos ?? []).filter((p) => !p.productionEntryId || !removedIds.has(p.productionEntryId)),
            notifications: (d.notifications ?? []).filter((n) => n.markupId !== id),
            projects: recomputeFootage(d.projects, production, productionLineItems),
            markupHistory: [...(d.markupHistory ?? []), historyEntry(id, 'deleted', actor)],
          }
        })
        enqueueSyncEntry('markup', id, id, 'update')
      },
      addMarkupPhoto(p, actor = null) {
        const id = newId('mkph')
        setData((d) => ({
          ...d,
          markupPhotos: [...(d.markupPhotos ?? []), { ...p, id }],
          fieldMarkups: (d.fieldMarkups ?? []).map((m) => m.id === p.markupId ? { ...m, syncStatus: 'pending' } : m),
          markupHistory: [...(d.markupHistory ?? []), historyEntry(p.markupId, 'photo_added', actor)],
        }))
        enqueueSyncEntry('markupPhoto', id, p.markupId, 'create')
        return id
      },
      deleteMarkupPhoto(id, actor = null) {
        setData((d) => {
          const photo = (d.markupPhotos ?? []).find((p) => p.id === id)
          return {
            ...d,
            markupPhotos: (d.markupPhotos ?? []).filter((p) => p.id !== id),
            fieldMarkups: photo ? (d.fieldMarkups ?? []).map((m) => m.id === photo.markupId ? { ...m, syncStatus: 'pending' } : m) : (d.fieldMarkups ?? []),
            markupHistory: photo ? [...(d.markupHistory ?? []), historyEntry(photo.markupId, 'photo_removed', actor)] : (d.markupHistory ?? []),
          }
        })
        void deleteBlob(`mkp-${id}`)
        const photo = data.markupPhotos.find((p) => p.id === id)
        enqueueSyncEntry('markupPhoto', id, photo?.markupId ?? null, 'delete')
      },
      addMarkupBilling(b, actor = null) {
        const id = newId('mkpb')
        setData((d) => ({
          ...d,
          markupBilling: [...(d.markupBilling ?? []), { ...b, id }],
          fieldMarkups: (d.fieldMarkups ?? []).map((m) => m.id === b.markupId ? { ...m, syncStatus: 'pending' } : m),
          markupHistory: [...(d.markupHistory ?? []), historyEntry(b.markupId, 'billing_added', actor)],
        }))
        enqueueSyncEntry('markupBilling', id, b.markupId, 'create')
        return id
      },
      updateMarkupBilling(id, patch) {
        const billing = data.markupBilling.find((b) => b.id === id)
        setData((d) => {
          let markupBilling = (d.markupBilling ?? []).map((b) => (b.id === id ? { ...b, ...patch } : b))
          const fieldMarkups = billing
            ? (d.fieldMarkups ?? []).map((m) => (m.id === billing.markupId ? { ...m, syncStatus: 'pending' as const } : m))
            : (d.fieldMarkups ?? [])

          // If quantity/rate/total/rateCode/description/unitType changed on a billing
          // line that was already submitted to production, update the linked
          // ProductionLineItem (and its entry's footage + the linked PnLEntry's
          // revenue) in place — otherwise Production/P&L would silently keep the
          // stale snapshot from the original submission while the billed amount or
          // billing code moves on.
          const billingChanged = 'quantity' in patch || 'rate' in patch || 'total' in patch
            || 'rateCode' in patch || 'description' in patch || 'unitType' in patch

          let result = { ...d, markupBilling, fieldMarkups }
          if (billingChanged) {
            // The old, already-approved review no longer reflects what's
            // actually billed now — reopen it for the supervisor rather than
            // leaving a stale "approved" stamp on a number nobody re-checked.
            const reopened = reopenQaIfAlreadyApproved(result, markupBilling, id)
            markupBilling = reopened.markupBilling
            result = { ...result, markupBilling, productionLineItems: reopened.productionLineItems, notifications: reopened.notifications }
          }

          const updatedBilling = billingChanged ? markupBilling.find((b) => b.id === id) : undefined
          const linkedLineItem = updatedBilling
            ? (result.productionLineItems ?? []).find((li) => li.sourceMarkupBillingId === id)
            : undefined

          if (!linkedLineItem || !updatedBilling) {
            return result
          }

          const productionLineItems = result.productionLineItems.map((li) =>
            li.id === linkedLineItem.id
              ? {
                  ...li,
                  quantity: updatedBilling.quantity,
                  rateSnapshot: updatedBilling.rate,
                  extendedTotal: updatedBilling.total,
                  unitCode: updatedBilling.rateCode,
                  description: updatedBilling.description,
                  uom: updatedBilling.unitType,
                }
              : li,
          )

          return {
            ...result,
            ...applyLineItemToProduction(result, productionLineItems, linkedLineItem.productionEntryId),
          }
        })
        enqueueSyncEntry('markupBilling', id, billing?.markupId ?? null, 'update')
      },
      deleteMarkupBilling(id, actor = null) {
        setData((d) => {
          const billing = (d.markupBilling ?? []).find((b) => b.id === id)
          return {
            ...d,
            markupBilling: (d.markupBilling ?? []).filter((b) => b.id !== id),
            fieldMarkups: billing ? (d.fieldMarkups ?? []).map((m) => m.id === billing.markupId ? { ...m, syncStatus: 'pending' } : m) : (d.fieldMarkups ?? []),
            markupHistory: billing ? [...(d.markupHistory ?? []), historyEntry(billing.markupId, 'billing_removed', actor)] : (d.markupHistory ?? []),
          }
        })
        const billing = data.markupBilling.find((b) => b.id === id)
        enqueueSyncEntry('markupBilling', id, billing?.markupId ?? null, 'delete')
      },

      // ── Redline QA/QC Approval Workflow ─────────────────────────────────────
      // Reviews one MarkupBilling line (the "redline item" granularity — a
      // single markup can carry several independently-reviewed billing lines).
      // Cascades the new status onto every ProductionLineItem generated from
      // that line (mirrors the quantity-cascade pattern in updateMarkup/
      // updateMarkupBilling above) so computeQaRevenueBreakdown never needs a
      // live join. Never creates a duplicate rejection record — the qa* fields
      // on MarkupBilling are simply overwritten in place; the permanent trail
      // of every note (including superseded ones) lives in markupHistory.
      approveQaLine(markupBillingId, actor = null, note) {
        setData((d) => {
          const before = (d.markupBilling ?? []).find((b) => b.id === markupBillingId)
          if (!before) return d
          const markup = (d.fieldMarkups ?? []).find((m) => m.id === before.markupId)
          const newStatus: QaStatus = before.qaStatus === 'rejection_fixed' ? 'approved_after_correction' : 'approved'
          const now = new Date().toISOString()

          const markupBilling = (d.markupBilling ?? []).map((b) =>
            b.id === markupBillingId
              ? { ...b, qaStatus: newStatus, qaApprovedBy: actor, qaApprovedAt: now, qaReviewedBy: actor, qaReviewedAt: now }
              : b,
          )
          const productionLineItems = (d.productionLineItems ?? []).map((li) =>
            li.sourceMarkupBillingId === markupBillingId ? { ...li, qaStatus: newStatus } : li,
          )
          const action: MarkupHistoryAction = newStatus === 'approved_after_correction' ? 'qa_approved_after_correction' : 'qa_approved'
          const notifType: NotificationType = newStatus === 'approved_after_correction' ? 'redline_approved_after_correction' : 'redline_approved'

          const project = markup ? (d.projects ?? []).find((p) => p.id === markup.projectId) : undefined
          const fieldEmployee = markup?.createdBy ? (d.employees ?? []).find((e) => e.id === markup.createdBy) : undefined
          const subId = before.assignedSubcontractorId ?? markup?.assignedSubcontractorId
          const subcontractor = subId ? (d.subcontractors ?? []).find((s) => s.id === subId) : undefined
          const notifications = markup
            ? [...(d.notifications ?? []), buildQaNotification(notifType, markup, before, project, fieldEmployee, 'field', subcontractor)]
            : (d.notifications ?? [])

          return {
            ...d,
            markupBilling,
            productionLineItems,
            markupHistory: [...(d.markupHistory ?? []), historyEntry(before.markupId, action, actor, note ? { note } : undefined)],
            notifications,
          }
        })
      },
      rejectQaLine(markupBillingId, actor = null, note) {
        if (!note.trim()) return
        setData((d) => {
          const before = (d.markupBilling ?? []).find((b) => b.id === markupBillingId)
          if (!before) return d
          const markup = (d.fieldMarkups ?? []).find((m) => m.id === before.markupId)
          const now = new Date().toISOString()

          const markupBilling = (d.markupBilling ?? []).map((b) =>
            b.id === markupBillingId
              ? { ...b, qaStatus: 'rejected' as const, qaRejectedBy: actor, qaRejectedAt: now, qaRejectionNote: note, qaReviewedBy: actor, qaReviewedAt: now }
              : b,
          )
          const productionLineItems = (d.productionLineItems ?? []).map((li) =>
            li.sourceMarkupBillingId === markupBillingId ? { ...li, qaStatus: 'rejected' as const } : li,
          )

          const project = markup ? (d.projects ?? []).find((p) => p.id === markup.projectId) : undefined
          const fieldEmployee = markup?.createdBy ? (d.employees ?? []).find((e) => e.id === markup.createdBy) : undefined
          const subId = before.assignedSubcontractorId ?? markup?.assignedSubcontractorId
          const subcontractor = subId ? (d.subcontractors ?? []).find((s) => s.id === subId) : undefined
          const notifications = markup
            ? [...(d.notifications ?? []), buildQaNotification('redline_rejected', markup, before, project, fieldEmployee, 'field', subcontractor)]
            : (d.notifications ?? [])

          return {
            ...d,
            markupBilling,
            productionLineItems,
            markupHistory: [...(d.markupHistory ?? []), historyEntry(before.markupId, 'qa_rejected', actor, { note })],
            notifications,
          }
        })
      },
      markRejectionFixedQa(markupBillingId, actor = null, note) {
        setData((d) => {
          const before = (d.markupBilling ?? []).find((b) => b.id === markupBillingId)
          if (!before) return d
          const markup = (d.fieldMarkups ?? []).find((m) => m.id === before.markupId)
          const now = new Date().toISOString()

          const markupBilling = (d.markupBilling ?? []).map((b) =>
            b.id === markupBillingId
              ? { ...b, qaStatus: 'rejection_fixed' as const, qaCorrectedBy: actor, qaCorrectedAt: now }
              : b,
          )
          const productionLineItems = (d.productionLineItems ?? []).map((li) =>
            li.sourceMarkupBillingId === markupBillingId ? { ...li, qaStatus: 'rejection_fixed' as const } : li,
          )

          const project = markup ? (d.projects ?? []).find((p) => p.id === markup.projectId) : undefined
          const fieldEmployee = markup?.createdBy ? (d.employees ?? []).find((e) => e.id === markup.createdBy) : undefined
          const notifications = markup
            ? [...(d.notifications ?? []), buildQaNotification('redline_rejection_fixed', markup, before, project, fieldEmployee, 'admin')]
            : (d.notifications ?? [])

          return {
            ...d,
            markupBilling,
            productionLineItems,
            markupHistory: [...(d.markupHistory ?? []), historyEntry(before.markupId, 'qa_rejection_fixed', actor, note ? { note } : undefined)],
            notifications,
          }
        })
      },
      // Called once per markup (not per billing line) from submitMarkupToProduction,
      // which can't reach historyEntry()/setData directly since it lives outside
      // DataContext — this is its one hook back in, so "Submitted" shows up in the
      // permanent QA/QC audit trail alongside Reviewed/Approved/Rejected/Corrected.
      logQaSubmitted(markupId, actor = null) {
        setData((d) => ({
          ...d,
          markupHistory: [...(d.markupHistory ?? []), historyEntry(markupId, 'qa_submitted', actor)],
        }))
      },

      // --- Subcontractors ---
      addSubcontractor(s) {
        const sub: Subcontractor = { ...s, id: newId('subc') }
        setData((d) => ({ ...d, subcontractors: [...(d.subcontractors ?? []), sub] }))
        return sub
      },
      updateSubcontractor(id, patch) {
        setData((d) => ({ ...d, subcontractors: (d.subcontractors ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
      },
      deleteSubcontractor(id) {
        setData((d) => ({ ...d, subcontractors: (d.subcontractors ?? []).filter((s) => s.id !== id) }))
      },

      // --- Notifications ---
      addNotification(n) {
        const id = newId('notif')
        setData((d) => ({
          ...d,
          notifications: [...(d.notifications ?? []), { ...n, id, createdAt: new Date().toISOString(), readAt: null }],
        }))
        return id
      },
      markNotificationRead(id) {
        setData((d) => ({
          ...d,
          notifications: (d.notifications ?? []).map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)),
        }))
      },
      markAllNotificationsRead(recipientRole, recipientEmployeeId, recipientSubcontractorId) {
        setData((d) => ({
          ...d,
          notifications: (d.notifications ?? []).map((n) =>
            n.recipientRole === recipientRole
            && (recipientRole === 'admin'
              || (recipientSubcontractorId ? n.recipientSubcontractorId === recipientSubcontractorId : n.recipientEmployeeId === recipientEmployeeId))
            && !n.readAt
              ? { ...n, readAt: new Date().toISOString() }
              : n,
          ),
        }))
      },

      // ── Work Object videos ────────────────────────────────────────────────
      addMarkupVideo(v) {
        const id = newId('mkpv')
        setData((d) => ({
          ...d,
          markupVideos: [...(d.markupVideos ?? []), { ...v, id }],
          fieldMarkups: (d.fieldMarkups ?? []).map((m) => m.id === v.markupId ? { ...m, syncStatus: 'pending' } : m),
        }))
        enqueueSyncEntry('markupVideo', id, v.markupId, 'create')
        return id
      },
      deleteMarkupVideo(id) {
        const video = data.markupVideos.find((v) => v.id === id)
        setData((d) => ({
          ...d,
          markupVideos: (d.markupVideos ?? []).filter((v) => v.id !== id),
          fieldMarkups: video ? (d.fieldMarkups ?? []).map((m) => m.id === video.markupId ? { ...m, syncStatus: 'pending' } : m) : (d.fieldMarkups ?? []),
        }))
        void deleteBlob(`mkp-${id}`)
        enqueueSyncEntry('markupVideo', id, video?.markupId ?? null, 'delete')
      },

      // ── Work Object inspections ───────────────────────────────────────────
      addMarkupInspection(i) {
        const id = newId('mkpi')
        setData((d) => ({
          ...d,
          markupInspections: [...(d.markupInspections ?? []), { ...i, id, createdAt: new Date().toISOString() }],
          fieldMarkups: (d.fieldMarkups ?? []).map((m) => m.id === i.markupId ? { ...m, syncStatus: 'pending' } : m),
          markupHistory: [...(d.markupHistory ?? []), historyEntry(i.markupId, 'inspection_added', i.createdBy ?? null)],
        }))
        enqueueSyncEntry('markupInspection', id, i.markupId, 'create')
        return id
      },
      updateMarkupInspection(id, patch) {
        const inspection = data.markupInspections.find((i) => i.id === id)
        setData((d) => ({
          ...d,
          markupInspections: (d.markupInspections ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i)),
          fieldMarkups: inspection ? (d.fieldMarkups ?? []).map((m) => m.id === inspection.markupId ? { ...m, syncStatus: 'pending' } : m) : (d.fieldMarkups ?? []),
        }))
        enqueueSyncEntry('markupInspection', id, inspection?.markupId ?? null, 'update')
      },
      deleteMarkupInspection(id) {
        const inspection = data.markupInspections.find((i) => i.id === id)
        setData((d) => ({ ...d, markupInspections: (d.markupInspections ?? []).filter((i) => i.id !== id) }))
        enqueueSyncEntry('markupInspection', id, inspection?.markupId ?? null, 'delete')
      },

      // ── Work Object attachments ───────────────────────────────────────────
      addMarkupAttachment(a) {
        const id = newId('mkpa')
        setData((d) => ({
          ...d,
          markupAttachments: [...(d.markupAttachments ?? []), { ...a, id }],
          fieldMarkups: (d.fieldMarkups ?? []).map((m) => m.id === a.markupId ? { ...m, syncStatus: 'pending' } : m),
        }))
        enqueueSyncEntry('markupAttachment', id, a.markupId, 'create')
        return id
      },
      deleteMarkupAttachment(id) {
        const attachment = data.markupAttachments.find((a) => a.id === id)
        setData((d) => ({
          ...d,
          markupAttachments: (d.markupAttachments ?? []).filter((a) => a.id !== id),
          fieldMarkups: attachment ? (d.fieldMarkups ?? []).map((m) => m.id === attachment.markupId ? { ...m, syncStatus: 'pending' } : m) : (d.fieldMarkups ?? []),
        }))
        void deleteBlob(`mkp-${id}`)
        enqueueSyncEntry('markupAttachment', id, attachment?.markupId ?? null, 'delete')
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
        enqueueSyncEntry('fieldMapOverlay', id, null, 'create')
        return id
      },
      updateFieldMapOverlay(id, patch) {
        setData((d) => ({
          ...d,
          fieldMapOverlays: (d.fieldMapOverlays ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)),
        }))
        enqueueSyncEntry('fieldMapOverlay', id, null, 'update')
      },
      deleteFieldMapOverlay(id) {
        setData((d) => ({
          ...d,
          fieldMapOverlays: (d.fieldMapOverlays ?? []).filter((o) => o.id !== id),
        }))
        enqueueSyncEntry('fieldMapOverlay', id, null, 'delete')
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

      async flushSyncQueue() {
        return flushSyncEntries((entry) => {
          if (!entry.markupId) return // fieldMapOverlay entries have no syncStatus field to update
          setData((d) => ({
            ...d,
            fieldMarkups: (d.fieldMarkups ?? []).map((m) => m.id === entry.markupId ? { ...m, syncStatus: 'synced' } : m),
          }))
        })
      },

      resetData() {
        setData(generateSeedData())
      },
    }
  }, [data])

  // Drain the offline sync queue whenever the browser regains connectivity.
  useEffect(() => {
    const onOnline = () => { void value.flushSyncQueue() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [value])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within a DataProvider')
  return ctx
}
