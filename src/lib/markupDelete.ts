// ---------------------------------------------------------------------------
// Shared "delete this Work Object" flow — one instance per page (Field Map /
// PDF Print Mode), used identically by every delete entry point on that page
// (top toolbar, layer manager, MarkupPanel's own Delete button, the floating
// quick-actions toolbar, the Delete key, and callout close buttons) so none
// of them can drift apart on the confirmation or the invoice-block rule.
//
// Blocks outright if the markup's billing was already pulled into an issued
// invoice (InvoiceLineItem is a frozen snapshot with no id back to
// MarkupBilling, so there's no safe way to un-invoice a line here). A real
// confirmation Modal can't block synchronously the way window.confirm did,
// so the flow is: requestDelete() either alerts-and-bails (invoiced) or
// stages the markup as `pendingDelete`; the caller renders
// <MarkupDeleteConfirm> once and calls confirmDelete()/cancelDelete().
// ---------------------------------------------------------------------------

import { useState } from 'react'
import type { FieldMarkup, MarkupBilling } from '../types'

export function isMarkupInvoiced(billingLines: MarkupBilling[]): boolean {
  return billingLines.some((b) => !!b.invoiceId)
}

export interface MarkupDeleteFlow {
  pendingDelete: FieldMarkup | null
  requestDelete: (markup: FieldMarkup, billingLines: MarkupBilling[]) => void
  confirmDelete: () => void
  cancelDelete: () => void
}

export function useMarkupDeleteFlow(
  softDeleteMarkup: (id: string, actor?: string | null) => void,
  actor: string | null,
): MarkupDeleteFlow {
  const [pendingDelete, setPendingDelete] = useState<FieldMarkup | null>(null)

  function requestDelete(markup: FieldMarkup, billingLines: MarkupBilling[]) {
    if (isMarkupInvoiced(billingLines)) {
      alert("This item's billing has already been added to an issued invoice. Void or credit that invoice before deleting it.")
      return
    }
    setPendingDelete(markup)
  }

  function confirmDelete() {
    if (!pendingDelete) return
    softDeleteMarkup(pendingDelete.id, actor)
    setPendingDelete(null)
  }

  function cancelDelete() {
    setPendingDelete(null)
  }

  return { pendingDelete, requestDelete, confirmDelete, cancelDelete }
}
