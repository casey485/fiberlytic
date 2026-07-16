// ---------------------------------------------------------------------------
// Shared invoice-candidate row model + filters — one row per billable
// MarkupBilling line eligible to be invoiced, joined with its parent markup/
// project/client. Mirrors the buildXRows + XFilterState + applyXFilters
// pattern already established by qaReview.ts and photoLibrary.ts. The
// candidate pool is always derived live from `data`, never snapshotted,
// so edits/approvals/rejections to production are reflected automatically
// right up until an invoice is actually generated (see buildInvoiceLineItems).
// ---------------------------------------------------------------------------

import type { AppData, Client, FieldMarkup, InvoiceLineItem, Project, QaStatus, WorkObjectTypeId } from '../types'
import type { MarkupBilling } from '../types'

export interface InvoiceCandidateRow {
  billing: MarkupBilling
  markup: FieldMarkup
  project: Project | undefined
  client: Client | undefined
}

/** A billing line that never entered the redline QA/QC pipeline (qaStatus
 *  undefined — manual entries, or data logged before that workflow existed)
 *  is treated as implicitly approved, the same rule billableMarkupLines
 *  used before this module replaced it. */
function effectiveApprovalStatus(b: MarkupBilling): QaStatus {
  return b.qaStatus ?? 'approved'
}

/** Every billable line currently eligible to be invoiced — QA-approved (or
 *  never submitted for review at all) and belonging to a live, non-deleted
 *  markup. Does NOT filter on invoiceId — "already invoiced" is one of the
 *  filter dimensions below (invoicedFilter), not an exclusion baked into the
 *  candidate pool, so "Previously Invoiced" can still browse/audit them. */
export function buildInvoiceCandidateRows(data: AppData): InvoiceCandidateRow[] {
  const rows: InvoiceCandidateRow[] = []
  for (const b of data.markupBilling ?? []) {
    if (!b.billable) continue
    // 'invoiceStatus' is a separate concept from qaStatus/invoiceId — it's
    // stamped 'invoiced' the moment a Work Object's billing is submitted to
    // production (productionFromMarkup.ts), meaning "real, submitted
    // production" as opposed to a draft/not-yet-submitted line. The old
    // billableMarkupLines gated on this too; carried forward unchanged.
    if (b.invoiceStatus !== 'invoiced') continue
    const status = effectiveApprovalStatus(b)
    if (status !== 'approved' && status !== 'approved_after_correction') continue
    const markup = (data.fieldMarkups ?? []).find((m) => m.id === b.markupId)
    if (!markup || markup.deletedAt) continue
    const project = data.projects.find((p) => p.id === markup.projectId)
    const client = project?.clientId ? data.clients.find((c) => c.id === project.clientId) : undefined
    rows.push({ billing: b, markup, project, client })
  }
  return rows
}

export interface InvoiceFilterState {
  clientId: string
  projectId: string
  /** Substring match against FieldMarkup.workId (e.g. "WO-TRN"). */
  workOrderQuery: string
  crewOrSubId: string
  dateFrom: string
  dateTo: string
  productionType: WorkObjectTypeId | ''
  approvalStatus: QaStatus | ''
  invoicedFilter: '' | 'invoiced' | 'not_invoiced'
  /** Only meaningful once something is invoiced — filters the *linked
   *  invoice's* status, gated behind invoicedFilter === 'invoiced' in
   *  practice (an un-invoiced line has no paid/unpaid state at all). */
  paidUnpaid: '' | 'paid' | 'unpaid'
}

export const EMPTY_INVOICE_FILTERS: InvoiceFilterState = {
  clientId: '', projectId: '', workOrderQuery: '', crewOrSubId: '',
  dateFrom: '', dateTo: '', productionType: '', approvalStatus: '',
  invoicedFilter: '', paidUnpaid: '',
}

export function invoiceFiltersActive(f: InvoiceFilterState): boolean {
  return Object.values(f).some((v) => v !== '')
}

/** Best available proxy for "date of work" — the billing line's own date,
 *  falling back to the markup's creation date, same convention qaReview.ts's
 *  rowDate uses. */
function rowDate(r: InvoiceCandidateRow): string | null {
  return r.billing.date ?? r.markup.createdAt?.slice(0, 10) ?? null
}

export function applyInvoiceFilters(rows: InvoiceCandidateRow[], f: InvoiceFilterState, data: AppData): InvoiceCandidateRow[] {
  return rows.filter((r) => {
    if (f.clientId && r.client?.id !== f.clientId) return false
    if (f.projectId && r.project?.id !== f.projectId) return false
    if (f.workOrderQuery && !(r.markup.workId ?? '').toLowerCase().includes(f.workOrderQuery.toLowerCase())) return false
    if (f.crewOrSubId && r.markup.crewId !== f.crewOrSubId && r.markup.assignedSubcontractorId !== f.crewOrSubId) return false
    if (f.productionType && r.markup.workObjectType !== f.productionType) return false
    if (f.approvalStatus && effectiveApprovalStatus(r.billing) !== f.approvalStatus) return false
    const isInvoiced = !!r.billing.invoiceId
    if (f.invoicedFilter === 'invoiced' && !isInvoiced) return false
    if (f.invoicedFilter === 'not_invoiced' && isInvoiced) return false
    if (f.paidUnpaid) {
      // "Paid"/"Unpaid" only mean something once a line actually has an
      // invoice — a never-invoiced row is neither, not implicitly "unpaid"
      // (that would conflate "hasn't been billed yet" with "billed and
      // still owed"), so both branches require isInvoiced.
      if (!isInvoiced) return false
      const isPaid = data.invoices.find((i) => i.id === r.billing.invoiceId)?.status === 'paid'
      if (f.paidUnpaid === 'paid' && !isPaid) return false
      if (f.paidUnpaid === 'unpaid' && isPaid) return false
    }
    const d = rowDate(r)
    if (f.dateFrom && d && d < f.dateFrom) return false
    if (f.dateTo && d && d > f.dateTo) return false
    return true
  })
}

/** One invoice per project — drawInvoicePage's Bill-To/Client layout is
 *  single-project, so "Generate Invoice(s)" batches by this grouping rather
 *  than producing one multi-project invoice. */
export function groupInvoiceCandidatesByProject(rows: InvoiceCandidateRow[]): Map<string, InvoiceCandidateRow[]> {
  const map = new Map<string, InvoiceCandidateRow[]>()
  for (const r of rows) {
    const key = r.project?.id
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(r)
  }
  return map
}

/** Groups rows by rate code + description (same convention the old
 *  billableMarkupLines used) into invoice line items, plus the raw billing
 *  ids that fed each one — the ids both lock the source lines
 *  (updateMarkupBilling invoiceId, done by the caller) and let PDF/Excel/CSV
 *  export re-fetch the exact source MarkupBilling rows later. */
export function buildInvoiceLineItems(rows: InvoiceCandidateRow[]): { lineItems: InvoiceLineItem[]; sourceBillingIds: string[] } {
  const byKey = new Map<string, { description: string; quantity: number; unitPrice: number; uom: string; ids: string[] }>()
  for (const r of rows) {
    const b = r.billing
    const key = `${b.rateCode}|${b.description}`
    const existing = byKey.get(key)
    if (existing) {
      existing.quantity += b.quantity
      existing.ids.push(b.id)
    } else {
      byKey.set(key, { description: `${b.description} (${b.rateCode})`, quantity: b.quantity, unitPrice: b.rate, uom: b.unitType, ids: [b.id] })
    }
  }
  const lineItems: InvoiceLineItem[] = []
  const sourceBillingIds: string[] = []
  let i = 0
  for (const v of byKey.values()) {
    lineItems.push({ id: `inv-line-${i++}`, description: v.description, quantity: v.quantity, unitPrice: v.unitPrice, uom: v.uom })
    sourceBillingIds.push(...v.ids)
  }
  return { lineItems, sourceBillingIds }
}

export function invoiceLineItemsTotal(lineItems: InvoiceLineItem[]): number {
  return lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
}
