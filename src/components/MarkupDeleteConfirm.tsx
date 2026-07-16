import { Modal } from './ui/Modal'
import { Button } from './ui/Form'
import type { FieldMarkup } from '../types'

interface Props {
  markup: FieldMarkup | null
  onCancel: () => void
  onConfirm: () => void
}

/** One shared confirmation dialog for every delete entry point on a page
 *  (toolbar, layer manager, MarkupPanel, floating quick-actions, Delete key,
 *  callout close button) — see src/lib/markupDelete.ts's useMarkupDeleteFlow. */
export function MarkupDeleteConfirm({ markup, onCancel, onConfirm }: Props) {
  return (
    <Modal
      dark
      open={!!markup}
      onClose={onCancel}
      title="Delete this work object?"
      footer={
        <>
          <Button dark variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button dark variant="danger" onClick={onConfirm}>Delete</Button>
        </>
      }
    >
      <p className="text-sm text-slate-300">This will remove it from:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">
        <li>Map</li>
        <li>Production</li>
        <li>P&amp;L</li>
        <li>Dashboard</li>
        <li>Billing</li>
        <li>Reports</li>
      </ul>
      <p className="mt-3 text-xs text-slate-600">The item stays in audit history but no longer appears anywhere above.</p>
    </Modal>
  )
}
