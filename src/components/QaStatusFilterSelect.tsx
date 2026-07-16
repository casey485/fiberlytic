import { Select } from './ui/Form'
import { QA_STATUS_META } from '../types'
import type { QaStatus } from '../types'

export type QaStatusFilterValue = QaStatus | 'all'

export function QaStatusFilterSelect({
  value, onChange, className = 'w-52',
}: {
  value: QaStatusFilterValue
  onChange: (v: QaStatusFilterValue) => void
  className?: string
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as QaStatusFilterValue)} className={className}>
      <option value="all">All QA/QC statuses</option>
      {(Object.keys(QA_STATUS_META) as QaStatus[]).map((s) => (
        <option key={s} value={s}>{QA_STATUS_META[s].label}</option>
      ))}
    </Select>
  )
}
