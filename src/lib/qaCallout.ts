// ---------------------------------------------------------------------------
// QA/QC rollup callout — a markup can carry several independently-reviewed
// MarkupBilling lines (see the Redline QA/QC Approval Workflow), so the map
// shows one aggregate status per markup rather than one callout per line:
// worst-status-wins, with per-line detail living in the review panel instead.
// Sibling to workObjectCallout.ts, same CalloutContent shape.
// ---------------------------------------------------------------------------

import type { MarkupBilling, QaStatus } from '../types'
import { QA_STATUS_META } from '../types'
import type { CalloutContent } from './workObjectCallout'

/** Worst status wins: any rejected outranks any pending_review, which
 *  outranks rejection_fixed, which outranks a clean approved sweep. */
const QA_ROLLUP_RANK: Record<QaStatus, number> = {
  rejected: 0,
  pending_review: 1,
  rejection_fixed: 2,
  approved: 3,
  approved_after_correction: 3,
}

export interface QaRollup {
  status: QaStatus
  /** True when every reviewed line landed on 'approved_after_correction' —
   *  used to add a "(2nd pass)" marker, since that status renders the same
   *  green as a clean first-pass 'approved' and needs a text distinguisher. */
  allSecondPass: boolean
  approvedCount: number
  rejectedCount: number
  pendingCount: number
  totalCount: number
}

/** Returns null when the markup has no billing lines that ever entered the QA
 *  pipeline (qaStatus undefined on all of them) — no QA callout should render. */
export function computeQaRollup(billingLines: MarkupBilling[]): QaRollup | null {
  const reviewed = billingLines.filter((b): b is MarkupBilling & { qaStatus: QaStatus } => b.qaStatus != null)
  if (reviewed.length === 0) return null

  let worst = reviewed[0].qaStatus
  for (const b of reviewed) {
    if (QA_ROLLUP_RANK[b.qaStatus] < QA_ROLLUP_RANK[worst]) worst = b.qaStatus
  }

  return {
    status: worst,
    allSecondPass: reviewed.every((b) => b.qaStatus === 'approved_after_correction'),
    approvedCount: reviewed.filter((b) => b.qaStatus === 'approved' || b.qaStatus === 'approved_after_correction').length,
    rejectedCount: reviewed.filter((b) => b.qaStatus === 'rejected').length,
    pendingCount: reviewed.filter((b) => b.qaStatus === 'pending_review' || b.qaStatus === 'rejection_fixed').length,
    totalCount: reviewed.length,
  }
}

export function buildQaCalloutContent(rollup: QaRollup): CalloutContent {
  const meta = QA_STATUS_META[rollup.status]
  const title = rollup.allSecondPass ? `${meta.label} (2nd pass)` : meta.label
  const rows: { label: string; value: string }[] = []
  if (rollup.totalCount > 1) {
    rows.push({ label: 'Items', value: `${rollup.approvedCount} approved, ${rollup.rejectedCount} rejected, ${rollup.pendingCount} pending` })
  }
  return { title, rows }
}
