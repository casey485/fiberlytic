// ---------------------------------------------------------------------------
// Shared "submit billing to production" logic for a Work Object (FieldMarkup).
// Extracted so MarkupPanel's manual "Submit to Production" button and the
// Add Work modal's Save step both create exactly one ProductionEntry/
// ProductionLineItem set instead of maintaining two copies of this grouping
// logic.
// ---------------------------------------------------------------------------

import type { AppData, FieldMarkup, MarkupBilling, ProductionEntry } from '../types'
import type { LineItemInput } from '../store/DataContext'

export interface SubmitMarkupToProductionArgs {
  markup: FieldMarkup
  billingEntries: MarkupBilling[]
  activeEmployeeId: string | null
  data: AppData
  addProduction: (entry: Omit<ProductionEntry, 'id'>, lineItems?: LineItemInput[]) => string
  updateMarkupBilling: (id: string, patch: Partial<MarkupBilling>) => void
  updateMarkup: (id: string, patch: Partial<FieldMarkup>, actor?: string | null) => void
}

export interface SubmitMarkupToProductionResult {
  submitted: true
}

/** Returns null if there's nothing billable to submit (caller should no-op). The
 *  Work Object's callout is a live view of its own fields (see workObjectCallout.ts),
 *  not a separate record created here — nothing else to do once billing is posted. */
export function submitMarkupToProduction(args: SubmitMarkupToProductionArgs): SubmitMarkupToProductionResult | null {
  const { markup, billingEntries, activeEmployeeId, data, addProduction, updateMarkupBilling, updateMarkup } = args

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

  const today = new Date().toISOString().slice(0, 10)
  const baseNotes = [
    markup.notes,
    markup.subtype ? `[${markup.subtype.replace(/_/g, ' ')}]` : null,
    `[markup:${markup.id}]`,
  ].filter(Boolean).join(' ')

  // Group billing lines by crew — each crew gets its own production entry
  const byCrewId = new Map<string, MarkupBilling[]>()
  for (const b of billable) {
    const key = b.crewId || resolvedCrewId || ''
    if (!byCrewId.has(key)) byCrewId.set(key, [])
    byCrewId.get(key)!.push(b)
  }

  let primaryCrewHandled = false
  for (const [bCrewId, lines] of byCrewId) {
    const crewLineItems: LineItemInput[] = lines.map((b) => ({
      unitCode:      b.rateCode || 'MISC',
      description:   b.description,
      uom:           b.unitType,
      quantity:      b.quantity,
      rateSnapshot:  b.rate,
      extendedTotal: b.total,
      sourceMarkupBillingId: b.id,
    }))
    // Prefer the actual billed LF quantity — matches Production.tsx's manual-entry
    // convention (crewTotalLF) — over the drawn geometry's raw length. These can
    // otherwise disagree (e.g. markup.lengthFt is null for non-line geometry, or the
    // crew billed a manually-adjusted quantity), silently zeroing footage while the
    // dollar amount stays correct. Falls back to geometry length only when this
    // crew's billing has no LF-unit line at all (e.g. purely per-unit billing).
    const crewFootageFromLF = lines.filter((b) => b.unitType === 'LF').reduce((s, b) => s + b.quantity, 0)
    addProduction(
      {
        date:      today,
        projectId: markup.projectId,
        crewId:    bCrewId,
        footage:   crewFootageFromLF > 0 ? Math.round(crewFootageFromLF) : (!primaryCrewHandled ? Math.round(markup.lengthFt ?? 0) : 0),
        hours:     0,
        notes:     baseNotes,
        sourceMarkupId: markup.id,
      },
      crewLineItems,
    )
    primaryCrewHandled = true
  }

  // Mark billing lines as invoiced and markup as billed
  for (const b of billable) updateMarkupBilling(b.id, { invoiceStatus: 'invoiced' })
  updateMarkup(markup.id, { status: 'billed', updatedAt: new Date().toISOString() }, activeEmployeeId)

  return { submitted: true }
}
