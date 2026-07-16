import type { AppData, PnLEntry, Project, Timecard, Equipment, WorkType, RateCardDivision, QaStatus, ProductionEntry, ProductionLineItem } from '../types'
import { buildQaReviewRows, applyQaFilters, EMPTY_QA_FILTERS } from './qaReview'
import type { QaFilterState } from './qaReview'
import { localDateStr } from './format'

/** Maps project work types to the division labels used on rate cards. */
export function workTypeDivisions(wts: WorkType[]): RateCardDivision[] {
  const out = new Set<RateCardDivision>()
  for (const wt of wts) {
    if (wt === 'underground' || wt === 'directional_bore' || wt === 'cable_plow') out.add('Underground')
    if (wt === 'aerial') out.add('Aerial')
  }
  return [...out]
}

// Lower = needs more attention. Missing qaStatus (never submitted for
// review — logged before the redline QA/QC workflow existed, or via the
// plain Log Production/Log Crew Day flows) is treated as implicitly
// approved, same convention as Production.tsx/DailyPnL.tsx's badges.
const QA_STATUS_SEVERITY: Record<QaStatus, number> = {
  rejected: 0, pending_review: 1, rejection_fixed: 2, approved_after_correction: 3, approved: 4,
}
/** The most-severe QA status among a set of line items — used anywhere a
 *  single row (a production entry, a photo) needs one representative status
 *  rolled up from several underlying billing lines. */
export function worstQaStatus(items: { qaStatus?: QaStatus }[]): QaStatus {
  return items.reduce<QaStatus>((worst, li) => {
    const s = li.qaStatus ?? 'approved'
    return QA_STATUS_SEVERITY[s] < QA_STATUS_SEVERITY[worst] ? s : worst
  }, 'approved')
}

/** A production entry's real placed footage — prefers the LF-quantity sum
 *  from its own rate-card line items when present, falling back to the raw
 *  ProductionEntry.footage field otherwise. A multi-crew redline split
 *  intentionally zeroes entry.footage on non-primary crews to avoid
 *  double-counting shared footage (see productionFromMarkup.ts) — that
 *  crew's own billed quantity still lives on its line items, so trusting
 *  entry.footage directly silently shows 0 for those entries. */
export function entryDisplayFootage(entry: ProductionEntry, lineItems: ProductionLineItem[]): number {
  if (lineItems.length === 0) return entry.footage
  return Math.round(lineItems.filter((li) => li.uom === 'LF').reduce((s, li) => s + li.quantity, 0))
}

/** Same LF-preferring logic as entryDisplayFootage, but for point-type work
 *  (splices, handholes, tie-ins — billed in EA/SQFT, not LF) that genuinely
 *  has zero linear footage, this returns the real billed quantity in its own
 *  unit instead of a misleading "0 ft" — e.g. "3 EA" rather than "0 ft" for
 *  an entry with real, nonzero billed work that just isn't measured in feet.
 *  Only for per-row display; week/project footage TOTALS should keep using
 *  entryDisplayFootage's pure-LF number, since blending LF with EA/SQFT into
 *  one summed figure would be meaningless. */
export function entryFootageLabel(entry: ProductionEntry, lineItems: ProductionLineItem[]): string {
  const lfQty = lineItems.filter((li) => li.uom === 'LF').reduce((s, li) => s + li.quantity, 0)
  if (lfQty > 0) return `${Math.round(lfQty).toLocaleString()} ft`
  if (lineItems.length > 0) {
    const byUom = new Map<string, number>()
    for (const li of lineItems) byUom.set(li.uom, (byUom.get(li.uom) ?? 0) + li.quantity)
    return [...byUom.entries()].map(([uom, qty]) => `${qty.toLocaleString()} ${uom}`).join(', ')
  }
  return `${Math.round(entry.footage).toLocaleString()} ft`
}

export const pnlCost = (e: PnLEntry) => e.laborCost + e.materialCost + e.equipmentCost + e.otherCost
export const pnlProfit = (e: PnLEntry) => e.revenue - pnlCost(e)

/** Sum revenue/cost/profit (and labor) over a set of P&L entries. */
export function summarizePnl(entries: PnLEntry[]) {
  const revenue = entries.reduce((s, e) => s + e.revenue, 0)
  const cost = entries.reduce((s, e) => s + pnlCost(e), 0)
  const labor = entries.reduce((s, e) => s + e.laborCost, 0)
  const profit = revenue - cost
  const margin = revenue > 0 ? profit / revenue : 0
  return { revenue, cost, labor, profit, margin }
}

/** Contracted revenue per foot for a project (contract value ÷ footage goal). */
export const revenuePerFoot = (p: Project) => (p.footageGoal > 0 ? p.contractValue / p.footageGoal : 0)

/** Entries dated within the last `days` days (inclusive of today). */
export function withinDays<T extends { date: string }>(entries: T[], days: number): T[] {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - (days - 1))
  cutoff.setHours(0, 0, 0, 0)
  return entries.filter((e) => new Date(e.date + 'T00:00:00') >= cutoff)
}

export const projectProgress = (p: Project) =>
  p.footageGoal > 0 ? Math.min(1, p.footageComplete / p.footageGoal) : 0

/** Daily revenue/cost/profit series across all projects, oldest → newest. */
export function dailyPnlSeries(pnl: PnLEntry[]) {
  const byDate = new Map<string, { date: string; revenue: number; cost: number; profit: number }>()
  for (const e of pnl) {
    const row = byDate.get(e.date) ?? { date: e.date, revenue: 0, cost: 0, profit: 0 }
    row.revenue += e.revenue
    row.cost += pnlCost(e)
    row.profit += pnlProfit(e)
    byDate.set(e.date, row)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Footage placed per day across all projects, oldest → newest. */
export function dailyProductionSeries(data: AppData) {
  const byDate = new Map<string, number>()
  for (const e of data.production) {
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.footage)
  }
  return [...byDate.entries()]
    .map(([date, footage]) => ({ date, footage }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Footage by crew over a recent window — for ranking productivity. */
export function footageByCrew(data: AppData, days = 14) {
  const recent = withinDays(data.production, days)
  return data.crews.map((c) => ({
    crew: c,
    footage: recent.filter((e) => e.crewId === c.id).reduce((s, e) => s + e.footage, 0),
    hours: recent.filter((e) => e.crewId === c.id).reduce((s, e) => s + e.hours, 0),
  }))
}

/** Footage by subcontractor over a recent window — sibling to footageByCrew,
 *  same shape, for the Subcontractors tab's productivity display. */
export function footageBySubcontractor(data: AppData, days = 14) {
  const recent = withinDays(data.production, days)
  return (data.subcontractors ?? []).map((s) => ({
    subcontractor: s,
    footage: recent.filter((e) => e.subcontractorId === s.id).reduce((sum, e) => sum + e.footage, 0),
    hours: recent.filter((e) => e.subcontractorId === s.id).reduce((sum, e) => sum + e.hours, 0),
  }))
}

// ---------------------------------------------------------------------------
// Week utilities
// ---------------------------------------------------------------------------

/** ISO week start (Monday) for a given date string. */
export function weekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day  // shift to Monday
  d.setDate(d.getDate() + diff)
  return isoDate(d)
}

/** ISO week end (Sunday) for a given date string. */
export function weekEnd(dateStr: string): string {
  const start = new Date(weekStart(dateStr) + 'T00:00:00')
  start.setDate(start.getDate() + 6)
  return isoDate(start)
}

/** All dates (YYYY-MM-DD) in the week containing dateStr (Mon–Sun). */
export function weekDates(dateStr: string): string[] {
  const start = new Date(weekStart(dateStr) + 'T00:00:00')
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return isoDate(d)
  })
}

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ---------------------------------------------------------------------------
// Computed P&L from rate-card production + timecards + job expenses
// ---------------------------------------------------------------------------

export interface ComputedPnlRow {
  date: string
  projectId: string
  revenue: number
  labor: number
  expenses: number
  ebitda: number
  margin: number
}

/** Compute P&L rows from production line items, timecards, and job expenses.
 *  Returns one row per (date, projectId) pair with data. */
export function computeNewPnl(data: AppData, dateFilter?: (d: string) => boolean): ComputedPnlRow[] {
  const filter = dateFilter ?? (() => true)

  // Revenue: sum productionLineItems → grouped via production entry date + projectId
  const revenueMap = new Map<string, number>()
  for (const li of data.productionLineItems) {
    const entry = data.production.find((e) => e.id === li.productionEntryId)
    if (!entry || !filter(entry.date)) continue
    const key = `${entry.date}|${entry.projectId}`
    revenueMap.set(key, (revenueMap.get(key) ?? 0) + li.extendedTotal)
  }

  // Labor: sum timecards → grouped by date + jobId
  const laborMap = new Map<string, number>()
  for (const tc of data.timecards) {
    if (!filter(tc.date)) continue
    const key = `${tc.date}|${tc.jobId}`
    laborMap.set(key, (laborMap.get(key) ?? 0) + tc.laborCost)
  }

  // Expenses: sum jobExpenses → grouped by date + jobId
  const expenseMap = new Map<string, number>()
  for (const ex of data.jobExpenses) {
    if (!filter(ex.date)) continue
    const key = `${ex.date}|${ex.jobId}`
    expenseMap.set(key, (expenseMap.get(key) ?? 0) + ex.amount)
  }

  const allKeys = new Set([...revenueMap.keys(), ...laborMap.keys(), ...expenseMap.keys()])

  return [...allKeys]
    .map((key) => {
      const [date, projectId] = key.split('|')
      const revenue = revenueMap.get(key) ?? 0
      const labor = laborMap.get(key) ?? 0
      const expenses = expenseMap.get(key) ?? 0
      const ebitda = revenue - labor - expenses
      const margin = revenue > 0 ? ebitda / revenue : 0
      return { date, projectId, revenue, labor, expenses, ebitda, margin }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Weekly hours per employee from timecards. Returns map of employeeId → hours for the ISO week containing refDate. */
export function weeklyHoursByEmployee(timecards: Timecard[], refDate: string): Map<string, number> {
  const dates = new Set(weekDates(refDate))
  const map = new Map<string, number>()
  for (const tc of timecards) {
    if (!dates.has(tc.date)) continue
    map.set(tc.employeeId, (map.get(tc.employeeId) ?? 0) + tc.hours)
  }
  return map
}

// ---------------------------------------------------------------------------
// computeMetrics — single source of truth for all financial calculations
// ---------------------------------------------------------------------------
// Derives costs from authoritative sources ONLY:
//   Revenue  → data.pnl.revenue (set at production-log time, correct)
//   Labor    → data.timecards (actual) with data.pnl.laborCost fallback
//   Equipment→ data.equipment tab (daily cost computed live — never stale stored values)
//   Expenses → data.jobExpenses
// Used by Dashboard, P&L daily ledger, and Weekly P&L so all views stay in sync.

export interface MetricsRow {
  revenue: number
  labor: number
  equipment: number
  expenses: number
  profit: number
}

export interface MetricsResult {
  revenue: number
  labor: number
  equipment: number
  expenses: number
  cost: number
  profit: number
  margin: number
  byDate: Map<string, MetricsRow>
  byProject: Map<string, MetricsRow>
}

/** Returns the total calendar days in the month of a given YYYY-MM-DD date string. */
export function daysInMonth(dateStr: string): number {
  const d = new Date(dateStr.slice(0, 7) + '-01T12:00:00')
  d.setMonth(d.getMonth() + 1)
  d.setDate(0)
  return d.getDate()
}

/** Returns the daily equipment cost for a piece of equipment using actual calendar days in the given month. */
export const equipmentDailyRate = (eq: Equipment, dateStr?: string) =>
  eq.monthlyCost / daysInMonth(dateStr ?? localDateStr())

export function computeMetrics(
  data: AppData,
  options: { days?: number; startDate?: string; endDate?: string; projectId?: string } = {}
): MetricsResult {
  const todayStr = localDateStr()
  const { projectId } = options
  let startDate = options.startDate
  if (!startDate && options.days) {
    const d = new Date()
    d.setDate(d.getDate() - (options.days - 1))
    startDate = localDateStr(d)
  }
  const endDate = options.endDate ?? todayStr
  if (!startDate) startDate = '2000-01-01'

  const inRange = (date: string) => date >= startDate! && date <= endDate
  const inProj = (pid: string) => !projectId || pid === projectId

  const byDate = new Map<string, MetricsRow>()
  const byProject = new Map<string, MetricsRow>()
  const zeroRow = (): MetricsRow => ({ revenue: 0, labor: 0, equipment: 0, expenses: 0, profit: 0 })
  const getD = (d: string) => { if (!byDate.has(d)) byDate.set(d, zeroRow()); return byDate.get(d)! }
  const getP = (p: string) => { if (!byProject.has(p)) byProject.set(p, zeroRow()); return byProject.get(p)! }

  const bump = (date: string, pid: string | null, field: keyof Omit<MetricsRow, 'profit'>, amount: number) => {
    if (amount === 0) return
    getD(date)[field] += amount
    if (pid) getP(pid)[field] += amount
  }

  // Timecard entry IDs — skip pnl.laborCost when real timecards exist for the same production entry
  const tcEntryIds = new Set(data.timecards.map((tc) => tc.productionEntryId).filter(Boolean) as string[])

  // Production entry dates per crew — skip auto-equipment for days that already have a production entry
  const prodByCrewDate = new Set(data.production.map((pe) => `${pe.crewId}|${pe.date}`))

  // Revenue + pnl-derived labor (fallback for entries without real timecards)
  for (const e of data.pnl) {
    if (!inRange(e.date) || !inProj(e.projectId)) continue
    bump(e.date, e.projectId, 'revenue', e.revenue)
    if (!(e.productionEntryId && tcEntryIds.has(e.productionEntryId))) {
      bump(e.date, e.projectId, 'labor', e.laborCost)
    }
  }

  // Actual labor from timecards (crew day entries)
  for (const tc of data.timecards) {
    if (!inRange(tc.date) || !inProj(tc.jobId)) continue
    bump(tc.date, tc.jobId, 'labor', tc.laborCost)
  }

  // Job expenses
  for (const ex of data.jobExpenses) {
    if (!inRange(ex.date) || !inProj(ex.jobId)) continue
    bump(ex.date, ex.jobId, 'expenses', ex.amount)
  }

  // Equipment — always computed live from the equipment tab (never from stale pnl.equipmentCost)
  // On production days: use explicitly selected equipmentIds when set, otherwise all active crew equipment
  for (const pe of data.production) {
    if (!inRange(pe.date) || !inProj(pe.projectId)) continue
    const crewEquip = (pe.equipmentIds && pe.equipmentIds.length > 0)
      ? data.equipment.filter((eq) => pe.equipmentIds!.includes(eq.id))
      : data.equipment.filter((eq) => eq.active && eq.crewId === pe.crewId)
    const cost = Math.round(crewEquip.reduce((s, eq) => s + eq.monthlyCost / daysInMonth(pe.date), 0))
    if (cost > 0) bump(pe.date, pe.projectId, 'equipment', cost)
  }

  // On non-production weekdays: auto-generate equipment cost per crew per weekday.
  // Build crew → last known project lookup (fallback when currentProjectId is null)
  const crewLastProject = new Map<string, string>()
  for (const pe of [...data.production].sort((a, b) => a.date.localeCompare(b.date))) {
    crewLastProject.set(pe.crewId, pe.projectId)
  }

  // Group active equipment by crew so we can sum all pieces at once per day (same rounding as production path)
  const equipByCrew = new Map<string, Equipment[]>()
  for (const eq of data.equipment) {
    if (!eq.active || !eq.crewId) continue
    if (!equipByCrew.has(eq.crewId)) equipByCrew.set(eq.crewId, [])
    equipByCrew.get(eq.crewId)!.push(eq)
  }

  for (const [crewId, crewEquip] of equipByCrew) {
    const crew = data.crews.find((c) => c.id === crewId)
    const crewProjectId = crew?.currentProjectId ?? crewLastProject.get(crewId) ?? null
    // If crew has a project but it's outside the filter scope, skip entirely
    if (crewProjectId && !inProj(crewProjectId)) continue
    // If no project AND filtering to a specific project, skip (can't attribute cost to that project)
    if (!crewProjectId && projectId) continue
    // crewProjectId may be null here — equipment still counts in date totals, just not in byProject

    // Start from the earliest deployedFrom among the crew's equipment, or startDate if none set
    const deployedDates = crewEquip.map((eq) => eq.deployedFrom).filter((d): d is string => Boolean(d)).sort()
    const earliest = deployedDates.length > 0 ? deployedDates[0] : startDate!
    const rangeStart = earliest > startDate! ? earliest : startDate!

    const d = new Date(rangeStart + 'T12:00:00')
    const end = new Date(endDate + 'T12:00:00')
    while (d <= end) {
      const dow = d.getDay()
      if (dow !== 0 && dow !== 6) {
        const ds = localDateStr(d)
        if (!prodByCrewDate.has(`${crewId}|${ds}`)) {
          // Only count equipment that was deployed by this date (or has no deployedFrom)
          const eligible = crewEquip.filter((eq) => !eq.deployedFrom || eq.deployedFrom <= ds)
          const cost = Math.round(eligible.reduce((s, eq) => s + eq.monthlyCost / daysInMonth(ds), 0))
          if (cost > 0) bump(ds, crewProjectId, 'equipment', cost)
        }
      }
      d.setDate(d.getDate() + 1)
    }
  }

  // Compute profit per row and aggregate totals
  let totalRevenue = 0, totalLabor = 0, totalEquipment = 0, totalExpenses = 0
  for (const row of byDate.values()) {
    row.profit = row.revenue - row.labor - row.equipment - row.expenses
    totalRevenue += row.revenue; totalLabor += row.labor
    totalEquipment += row.equipment; totalExpenses += row.expenses
  }
  for (const row of byProject.values()) {
    row.profit = row.revenue - row.labor - row.equipment - row.expenses
  }

  const cost = totalLabor + totalEquipment + totalExpenses
  const profit = totalRevenue - cost
  return {
    revenue: totalRevenue, labor: totalLabor, equipment: totalEquipment,
    expenses: totalExpenses, cost, profit,
    margin: totalRevenue > 0 ? profit / totalRevenue : 0,
    byDate, byProject,
  }
}

/** Distinct billing unit codes most recently used across all Work Objects, most-recent first. */
export function recentUnitCodes(data: AppData, limit = 8): string[] {
  const activeMarkupIds = new Set(data.fieldMarkups.filter((m) => !m.deletedAt).map((m) => m.id))
  const seen = new Set<string>()
  const out: string[] = []
  const entries = (data.markupBilling ?? []).filter((b) => activeMarkupIds.has(b.markupId))
  for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
    const code = entries[i].rateCode
    if (code && !seen.has(code)) { seen.add(code); out.push(code) }
  }
  return out
}

export interface QaRevenueBreakdown {
  pendingReviewRevenue: number
  approvedRevenue: number
  rejectedRevenue: number
  revenueWaitingOnCorrections: number
  totalSubmittedRevenue: number
  finalApprovedRevenue: number
  /** Footage/units (not dollars) — grouped by unit of measure since a project
   *  can mix LF, EA, etc. e.g. { LF: 1200, EA: 4 }. */
  rejectedProductionValue: Record<string, number>
  pendingProductionValue: Record<string, number>
}

/** Redline QA/QC Approval Workflow — P&L breakdown by QA status, kept as a
 *  sibling selector to computeMetrics rather than folded into it: computeMetrics
 *  has zero line changes so every existing revenue/EBITDA number is provably
 *  unchanged, and this new function is purely additive. Walks
 *  data.productionLineItems (not PnLEntry directly, since one PnLEntry can
 *  aggregate several line items each with independent QA status) filtered
 *  through the same QaFilterState/applyQaFilters the /qa-review page uses, so
 *  the P&L cards and the review list can never disagree about what's "pending"
 *  vs "approved" vs "rejected" for a given filter selection. */
export function computeQaRevenueBreakdown(data: AppData, filters: QaFilterState = EMPTY_QA_FILTERS): QaRevenueBreakdown {
  const filteredBillingIds = new Set(applyQaFilters(buildQaReviewRows(data), filters).map((r) => r.billing.id))

  const out: QaRevenueBreakdown = {
    pendingReviewRevenue: 0,
    approvedRevenue: 0,
    rejectedRevenue: 0,
    revenueWaitingOnCorrections: 0,
    totalSubmittedRevenue: 0,
    finalApprovedRevenue: 0,
    rejectedProductionValue: {},
    pendingProductionValue: {},
  }

  const addQty = (bucket: Record<string, number>, uom: string, qty: number) => {
    bucket[uom] = (bucket[uom] ?? 0) + qty
  }

  for (const li of data.productionLineItems ?? []) {
    if (!li.qaStatus) continue
    if (!li.sourceMarkupBillingId || !filteredBillingIds.has(li.sourceMarkupBillingId)) continue

    out.totalSubmittedRevenue += li.extendedTotal
    switch (li.qaStatus) {
      case 'pending_review':
        out.pendingReviewRevenue += li.extendedTotal
        addQty(out.pendingProductionValue, li.uom, li.quantity)
        break
      case 'rejection_fixed':
        out.revenueWaitingOnCorrections += li.extendedTotal
        addQty(out.pendingProductionValue, li.uom, li.quantity)
        break
      case 'approved':
        out.approvedRevenue += li.extendedTotal
        out.finalApprovedRevenue += li.extendedTotal
        break
      case 'approved_after_correction':
        out.finalApprovedRevenue += li.extendedTotal
        break
      case 'rejected':
        out.rejectedRevenue += li.extendedTotal
        addQty(out.rejectedProductionValue, li.uom, li.quantity)
        break
    }
  }

  return out
}

export interface AllProductionQaTotals {
  pendingReviewRevenue: number
  rejectedRevenue: number
  revenueWaitingOnCorrections: number
  /** approved + approved_after_correction + every line item with no QA
   *  lineage at all (logged before the redline QA/QC workflow existed, or via
   *  the plain "Log production"/"Log crew day" flows, which never touch
   *  MarkupBilling). Those are implicitly treated as approved — they were
   *  never submitted for review, so there's nothing pending or rejected about
   *  them, and hiding them from this total is what made the Admin Dashboard's
   *  QA/QC Status card disagree with its own Gross Revenue card above it. */
  finalApprovedRevenue: number
  totalRevenue: number
}

/** Same "pending/rejected/waiting/approved" shape as computeQaRevenueBreakdown,
 *  but over ALL production revenue in scope — not just line items linked to a
 *  submitted redline — so the totals reconcile with Gross Revenue instead of
 *  only covering redline-submitted work. Deliberately a separate function
 *  rather than a flag on computeQaRevenueBreakdown: that one backs the QA/QC
 *  Revenue tab and SubcontractorDashboard earnings, where "only what actually
 *  went through the redline workflow" is the correct, narrower meaning.
 *
 *  Walks data.production (not productionLineItems) as the base loop: most
 *  production — anything logged before the QA/QC workflow existed, or via
 *  the plain "Log production"/"Log crew day" flows — has ZERO ProductionLineItem
 *  rows at all, with its revenue living only on the linked PnLEntry (see
 *  addProduction). Only entries that DO have rate-card line items are broken
 *  out per line, since one entry can mix two different QA statuses. */
export function computeAllProductionQaTotals(
  data: AppData,
  opts: { projectIds?: Set<string> | null; dateFrom?: string; dateTo?: string } = {},
): AllProductionQaTotals {
  const out: AllProductionQaTotals = {
    pendingReviewRevenue: 0, rejectedRevenue: 0, revenueWaitingOnCorrections: 0,
    finalApprovedRevenue: 0, totalRevenue: 0,
  }
  const bucket = (status: QaStatus | undefined, amount: number) => {
    out.totalRevenue += amount
    switch (status) {
      case 'pending_review':
        out.pendingReviewRevenue += amount
        break
      case 'rejection_fixed':
        out.revenueWaitingOnCorrections += amount
        break
      case 'rejected':
        out.rejectedRevenue += amount
        break
      case 'approved':
      case 'approved_after_correction':
      default:
        out.finalApprovedRevenue += amount
        break
    }
  }

  const inScope = (date: string, projectId: string) => {
    if (opts.dateFrom && date < opts.dateFrom) return false
    if (opts.dateTo && date > opts.dateTo) return false
    if (opts.projectIds && !opts.projectIds.has(projectId)) return false
    return true
  }

  for (const entry of data.production ?? []) {
    if (!inScope(entry.date, entry.projectId)) continue
    const items = (data.productionLineItems ?? []).filter((li) => li.productionEntryId === entry.id)
    if (items.length > 0) {
      for (const li of items) bucket(li.qaStatus, li.extendedTotal)
    } else {
      const pnlEntry = (data.pnl ?? []).find((p) => p.productionEntryId === entry.id)
      bucket(undefined, pnlEntry?.revenue ?? 0)
    }
  }

  // PnLEntry rows not tied to any production entry (manual/other revenue) —
  // same "never submitted for review" logic applies, so they're approved too.
  const productionIds = new Set((data.production ?? []).map((e) => e.id))
  for (const p of data.pnl ?? []) {
    if (p.productionEntryId && productionIds.has(p.productionEntryId)) continue
    if (!p.projectId || !inScope(p.date, p.projectId)) continue
    bucket(undefined, p.revenue)
  }

  return out
}
