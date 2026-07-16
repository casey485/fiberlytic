import { QA_STATUS_META } from '../types'
import type { QaStatus } from '../types'

/** Small colored pill for a line item's QA/QC status, reusing the same
 *  label/color map QA/QC Review and the P&L QA/QC Revenue tab already use
 *  (QA_STATUS_META) so the wording and colors never drift between surfaces. */
export function QaStatusBadge({ status, className = '' }: { status: QaStatus; className?: string }) {
  const meta = QA_STATUS_META[status]
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`}
      style={{ background: `${meta.color}18`, color: meta.color }}
    >
      {meta.label}
    </span>
  )
}
