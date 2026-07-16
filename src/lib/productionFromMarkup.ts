// ---------------------------------------------------------------------------
// Shared "submit billing to production" logic for a Work Object (FieldMarkup).
// Extracted so MarkupPanel's manual "Submit to Production" button and the
// Add Work modal's Save step both create exactly one ProductionEntry/
// ProductionLineItem set instead of maintaining two copies of this grouping
// logic.
// ---------------------------------------------------------------------------

import type { AppData, FieldMarkup, MarkupBilling, Notification, ProductionEntry } from '../types'
import type { LineItemInput } from '../store/DataContext'
import { localDateStr } from './format'

export interface SubmitMarkupToProductionArgs {
  markup: FieldMarkup
  billingEntries: MarkupBilling[]
  activeEmployeeId: string | null
  data: AppData
  addProduction: (entry: Omit<ProductionEntry, 'id'>, lineItems?: LineItemInput[]) => string
  updateMarkupBilling: (id: string, patch: Partial<MarkupBilling>) => void
  updateMarkup: (id: string, patch: Partial<FieldMarkup>, actor?: string | null) => void
  /** Redline QA/QC Approval Workflow — fires one 'redline_submitted' notification
   *  per billing line just submitted, so the admin notification center has one
   *  entry per reviewable "redline item," matching the per-line review granularity. */
  addNotification: (n: Omit<Notification, 'id' | 'createdAt' | 'readAt'>) => string
  /** Writes the "Submitted" entry into the permanent QA/QC audit trail. */
  logQaSubmitted: (markupId: string, actor?: string | null) => void
}

export interface SubmitMarkupToProductionResult {
  submitted: true
}

/** Returns null if there's nothing billable to submit (caller should no-op). The
 *  Work Object's callout is a live view of its own fields (see workObjectCallout.ts),
 *  not a separate record created here — nothing else to do once billing is posted. */
export function submitMarkupToProduction(args: SubmitMarkupToProductionArgs): SubmitMarkupToProductionResult | null {
  const { markup, billingEntries, activeEmployeeId, data, addProduction, updateMarkupBilling, updateMarkup, addNotification, logQaSubmitted } = args

  // invoiceStatus !== 'not_billed' means this line already generated a production/P&L
  // entry in an earlier submit — re-including it here would double-count revenue and
  // footage rather than back anything out on delete.
  const billable = billingEntries.filter((b) => b.billable && b.total > 0 && b.invoiceStatus === 'not_billed')
  if (billable.length === 0) return null

  // Fallback crew: markup.crewId → active employee's crew → first project crew
  const resolvedCrewId = (() => {
    if (markup.crewId) return markup.crewId
    const emp = (data.employees ?? []).find((e) => e.id === activeEmployeeId)
    if (emp?.defaultCrewId) return emp.defaultCrewId
    const proj = data.projects.find((p) => p.id === markup.projectId)
    return proj?.crewIds?.[0] ?? ''
  })()

  // Matches the redline's own work date (see DataContext.tsx's addMarkup,
  // which stamps every markup's workDate at creation) rather than "right now"
  // — a redline drawn late at night still lands its production/P&L entry on
  // the calendar day the work was actually done, not the day it was typed up.
  const today = markup.workDate ?? localDateStr()
  const baseNotes = [
    markup.notes,
    markup.subtype ? `[${markup.subtype.replace(/_/g, ' ')}]` : null,
    `[markup:${markup.id}]`,
  ].filter(Boolean).join(' ')

  const toLineItems = (lines: MarkupBilling[]): LineItemInput[] => lines.map((b) => ({
    unitCode:      b.rateCode || 'MISC',
    description:   b.description,
    uom:           b.unitType,
    quantity:      b.quantity,
    rateSnapshot:  b.rate,
    extendedTotal: b.total,
    sourceMarkupBillingId: b.id,
    qaStatus: 'pending_review',
  }))
  // Prefer the actual billed LF quantity — matches Production.tsx's manual-entry
  // convention (crewTotalLF) — over the drawn geometry's raw length. These can
  // otherwise disagree (e.g. markup.lengthFt is null for non-line geometry, or the
  // billed quantity was manually adjusted), silently zeroing footage while the
  // dollar amount stays correct.
  const lfFootage = (lines: MarkupBilling[]) => lines.filter((b) => b.unitType === 'LF').reduce((s, b) => s + b.quantity, 0)

  if (markup.assignedSubcontractorId) {
    // A subcontractor's work isn't further subdivided by internal crew — the
    // whole submission is one ProductionEntry, tagged by subcontractor
    // instead of crew (crewId stays '', the existing "no crew" sentinel).
    const footage = lfFootage(billable)
    addProduction(
      {
        date:      today,
        projectId: markup.projectId,
        crewId:    '',
        subcontractorId: markup.assignedSubcontractorId,
        footage:   footage > 0 ? Math.round(footage) : Math.round(markup.lengthFt ?? 0),
        hours:     0,
        notes:     baseNotes,
        sourceMarkupId: markup.id,
      },
      toLineItems(billable),
    )
  } else {
    // Group billing lines by crew — each crew gets its own production entry
    const byCrewId = new Map<string, MarkupBilling[]>()
    for (const b of billable) {
      const key = b.crewId || resolvedCrewId || ''
      if (!byCrewId.has(key)) byCrewId.set(key, [])
      byCrewId.get(key)!.push(b)
    }

    let primaryCrewHandled = false
    for (const [bCrewId, lines] of byCrewId) {
      const footage = lfFootage(lines)
      addProduction(
        {
          date:      today,
          projectId: markup.projectId,
          crewId:    bCrewId,
          footage:   footage > 0 ? Math.round(footage) : (!primaryCrewHandled ? Math.round(markup.lengthFt ?? 0) : 0),
          hours:     0,
          notes:     baseNotes,
          sourceMarkupId: markup.id,
        },
        toLineItems(lines),
      )
      primaryCrewHandled = true
    }
  }

  // Mark billing lines as invoiced and enter the QA/QC pipeline. Every submit
  // (including a later re-submit of additional billing on an already-approved
  // markup) resets to pending_review — new units always need fresh review,
  // this is intended behavior, not a bug.
  for (const b of billable) updateMarkupBilling(b.id, { invoiceStatus: 'invoiced', qaStatus: 'pending_review' })
  updateMarkup(markup.id, { status: 'billed', updatedAt: new Date().toISOString() }, activeEmployeeId)

  // Redline QA/QC Approval Workflow — permanent audit trail + notify admin,
  // one notification per submitted line but a single "Submitted" history entry
  // for the markup as a whole (history is per-markup, see qaReview.ts).
  logQaSubmitted(markup.id, activeEmployeeId)
  const project = data.projects.find((p) => p.id === markup.projectId)
  const fieldEmployee = (data.employees ?? []).find((e) => e.id === markup.createdBy)
  const isSubcontractor = !!(markup.assignedSubcontractorId)
  for (const b of billable) {
    addNotification({
      type: 'redline_submitted',
      markupId: markup.id,
      markupBillingId: b.id,
      projectId: markup.projectId,
      recipientRole: 'admin',
      title: 'New redline submitted for review',
      body: `${b.description} — ${project?.name ?? 'Unknown project'}`,
      meta: {
        projectName: project?.name ?? 'Unknown project',
        location: project?.location ?? '',
        fieldUserName: fieldEmployee?.name ?? (isSubcontractor ? 'Subcontractor' : 'Unknown'),
        isSubcontractor,
      },
    })
  }

  return { submitted: true }
}
