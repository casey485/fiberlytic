// ---------------------------------------------------------------------------
// Shared QA/QC review-row model + filters — one row per reviewed MarkupBilling
// line, joined with its parent markup and project. Used by the /qa-review
// admin page and (Phase 10) the P&L QA revenue cards' filter row, so both
// read the same filter shape and the same row-building/bucketing logic.
// ---------------------------------------------------------------------------

import type { AppData, FieldMarkup, MarkupBilling, Project, QaStatus } from '../types'

/** History/approval/correction actor fields store a raw id — either a plain
 *  Employee.id (admin or supervisor session) or a `subcontractor:<id>`-prefixed
 *  string (see Dashboard.tsx's markRejectionFixedQa call) — resolve it to a
 *  display name instead of showing the raw id. */
export function actorLabel(actor: string | null, employeeNameById: Map<string, string>, subNameById: Map<string, string>): string | null {
  if (!actor) return null
  if (actor.startsWith('subcontractor:')) {
    const id = actor.slice('subcontractor:'.length)
    return subNameById.get(id) ?? 'Unknown subcontractor'
  }
  return employeeNameById.get(actor) ?? actor
}

export interface QaReviewRow {
  billing: MarkupBilling
  markup: FieldMarkup
  project: Project | undefined
}

/** One row per MarkupBilling line that has ever entered the QA pipeline
 *  (qaStatus set by submitMarkupToProduction) — lines never submitted have no
 *  qaStatus and are excluded, same rule the map rollup callout uses.
 *  softDeleteMarkup keeps the markup and its billing lines around (flagged
 *  deletedAt, not removed) for audit, and already cascades a real removal of
 *  whatever production/P&L that markup had generated — but it can't cascade
 *  into this table since it isn't one. Excluding deletedAt here is what
 *  actually keeps a deleted redline out of the QA/QC review list, the
 *  Subcontractor Dashboard's pending/approved/rejected counts, and
 *  "Corrections Needed" — everywhere this shared row-builder feeds. */
export function buildQaReviewRows(data: AppData): QaReviewRow[] {
  const rows: QaReviewRow[] = []
  for (const b of data.markupBilling ?? []) {
    if (!b.qaStatus) continue
    const markup = (data.fieldMarkups ?? []).find((m) => m.id === b.markupId)
    if (!markup || markup.deletedAt) continue
    rows.push({ billing: b, markup, project: data.projects.find((p) => p.id === markup.projectId) })
  }
  return rows
}

export type RevenueStatus = 'pending' | 'finalized' | 'rejected'

/** Coarser 3-bucket view of the 5 QaStatus values, matching the spec's P&L
 *  revenue-handling rules: pending_review/rejection_fixed both sit in
 *  "Pending Revenue" until a decision lands; only the two approved statuses
 *  count as finalized/billable. */
export function revenueStatusOf(qa: QaStatus): RevenueStatus {
  if (qa === 'rejected') return 'rejected'
  if (qa === 'approved' || qa === 'approved_after_correction') return 'finalized'
  return 'pending'
}

export interface QaFilterState {
  projectId: string
  clientId: string
  fieldEmployeeId: string
  subcontractorId: string
  dateFrom: string
  dateTo: string
  qaStatus: QaStatus | ''
  approvedBy: string
  reviewedBy: string
  revenueStatus: RevenueStatus | ''
}

export const EMPTY_QA_FILTERS: QaFilterState = {
  projectId: '', clientId: '', fieldEmployeeId: '', subcontractorId: '',
  dateFrom: '', dateTo: '', qaStatus: '', approvedBy: '', reviewedBy: '', revenueStatus: '',
}

export function qaFiltersActive(f: QaFilterState): boolean {
  return Object.values(f).some((v) => v !== '')
}

/** Best available proxy for "date submitted" — MarkupBilling.date (the line's
 *  own work date) rather than a new field, since markupHistory's qa_submitted
 *  entries are keyed per-markup, not per-billing-line, and can't be resolved
 *  back to one specific line when a markup has several. */
function rowDate(r: QaReviewRow): string | null {
  return r.billing.date ?? r.markup.createdAt?.slice(0, 10) ?? null
}

/** Whole days a row has been sitting unresolved — null for anything already
 *  decided (approved/rejected) or with no usable date, since "days old" only
 *  means something while a line is still waiting on a decision. Counts from
 *  rowDate (the closest thing to a submission date this data model has) to
 *  right now, not to any prior review timestamp — a rejection_fixed line that
 *  was rejected and re-submitted keeps aging from its ORIGINAL submission,
 *  not resetting the clock, since it's still the same outstanding decision
 *  from the admin's point of view. */
export function daysPending(r: QaReviewRow): number | null {
  if (revenueStatusOf(r.billing.qaStatus!) !== 'pending') return null
  const d = rowDate(r)
  if (!d) return null
  const submitted = new Date(`${d}T00:00:00`).getTime()
  if (Number.isNaN(submitted)) return null
  return Math.max(0, Math.floor((Date.now() - submitted) / 86400000))
}

export function applyQaFilters(rows: QaReviewRow[], f: QaFilterState): QaReviewRow[] {
  return rows.filter((r) => {
    if (f.projectId && r.markup.projectId !== f.projectId) return false
    if (f.clientId && r.project?.clientId !== f.clientId) return false
    if (f.fieldEmployeeId && r.markup.createdBy !== f.fieldEmployeeId) return false
    if (f.subcontractorId && r.markup.assignedSubcontractorId !== f.subcontractorId) return false
    if (f.qaStatus && r.billing.qaStatus !== f.qaStatus) return false
    if (f.revenueStatus && revenueStatusOf(r.billing.qaStatus!) !== f.revenueStatus) return false
    if (f.approvedBy && r.billing.qaApprovedBy !== f.approvedBy) return false
    if (f.reviewedBy && r.billing.qaReviewedBy !== f.reviewedBy) return false
    const d = rowDate(r)
    if (f.dateFrom && d && d < f.dateFrom) return false
    if (f.dateTo && d && d > f.dateTo) return false
    return true
  })
}
