// ---------------------------------------------------------------------------
// Shared "delete this Work Object" gate — used identically by MarkupPanel's
// Delete button and both Field Map pages' toolbar/layer-manager delete
// buttons, so PDF Print Mode and KMZ/Map Mode can't drift apart on this.
// Blocks outright if the markup's billing was already pulled into an issued
// invoice (InvoiceLineItem is a frozen snapshot with no id back to
// MarkupBilling, so there's no safe way to un-invoice a line here); otherwise
// confirms, then soft-deletes (preserves audit history, cascades a real
// removal of whatever production/P&L it had already generated).
// ---------------------------------------------------------------------------

import type { FieldMarkup, MarkupBilling } from '../types'

export interface AttemptDeleteMarkupResult {
  ok: boolean
  /** Set when blocked or cancelled — caller should alert() this if present and !ok. */
  message?: string
}

export function attemptDeleteMarkup(
  markup: FieldMarkup,
  billingLines: MarkupBilling[],
  softDeleteMarkup: (id: string, actor?: string | null) => void,
  actor: string | null,
): AttemptDeleteMarkupResult {
  const alreadyInvoiced = billingLines.some((b) => !!b.invoiceId)
  if (alreadyInvoiced) {
    return {
      ok: false,
      message: "This item's billing has already been added to an issued invoice. Void or credit that invoice before deleting it.",
    }
  }

  const hasBilling = billingLines.some((b) => b.billable && b.total > 0)
  const confirmMsg = hasBilling
    ? 'Delete this Work Object? Its linked production and P&L totals will be removed. The item itself stays in audit history.'
    : 'Delete this Work Object? It will stay in audit history but will no longer appear on the map/page.'
  if (!window.confirm(confirmMsg)) return { ok: false }

  softDeleteMarkup(markup.id, actor)
  return { ok: true }
}
