// Shared filter row for the /qa-review admin page and (Phase 10) the P&L QA
// revenue cards — same QaFilterState in, same onChange contract out, so the
// two surfaces can't drift on what "filtered" means for QA/QC data.
import { useMemo } from 'react'
import { useData } from '../store/DataContext'
import { Select, Input, Button } from './ui/Form'
import { QA_STATUS_META } from '../types'
import type { Project, QaStatus } from '../types'
import { EMPTY_QA_FILTERS, qaFiltersActive, actorLabel, type QaFilterState } from '../lib/qaReview'

export function QaFilterBar({
  value, onChange, projects, hideRevenueStatus,
}: {
  value: QaFilterState
  onChange: (next: QaFilterState) => void
  /** Scopes the "Project" dropdown — e.g. a supervisor should only see the
   *  projects they oversee, not every project in the system. Defaults to
   *  every project (admin's unrestricted view). */
  projects?: Project[]
  /** Hides the "Revenue Status" filter — a supervisor session never reasons
   *  about revenue at all, so a filter literally labeled that has no place
   *  in their view even though the rows themselves are already scoped. */
  hideRevenueStatus?: boolean
}) {
  const { data } = useData()
  const projectOptions = projects ?? data.projects
  const set = <K extends keyof QaFilterState>(k: K, v: QaFilterState[K]) => onChange({ ...value, [k]: v })

  const employeeNameById = useMemo(() => new Map(data.employees.map((e) => [e.id, e.name])), [data.employees])
  const subNameById = useMemo(() => new Map((data.subcontractors ?? []).map((s) => [s.id, s.companyName])), [data.subcontractors])

  const reviewers = Array.from(
    new Set([
      ...(data.markupBilling ?? []).map((b) => b.qaApprovedBy).filter((v): v is string => !!v),
      ...(data.markupBilling ?? []).map((b) => b.qaReviewedBy).filter((v): v is string => !!v),
    ]),
  )
    .map((id) => ({ id, label: actorLabel(id, employeeNameById, subNameById) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Select value={value.projectId} onChange={(e) => set('projectId', e.target.value)}>
        <option value="">All Projects</option>
        {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <Select value={value.clientId} onChange={(e) => set('clientId', e.target.value)}>
        <option value="">All Customers</option>
        {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Select value={value.fieldEmployeeId} onChange={(e) => set('fieldEmployeeId', e.target.value)}>
        <option value="">All Field Employees</option>
        {data.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </Select>
      <Select value={value.subcontractorId} onChange={(e) => set('subcontractorId', e.target.value)}>
        <option value="">All Subcontractors</option>
        {(data.subcontractors ?? []).map((s) => <option key={s.id} value={s.id}>{s.companyName}</option>)}
      </Select>
      <Select value={value.qaStatus} onChange={(e) => set('qaStatus', e.target.value as QaStatus | '')}>
        <option value="">All QA/QC Statuses</option>
        {(Object.keys(QA_STATUS_META) as QaStatus[]).map((s) => (
          <option key={s} value={s}>{QA_STATUS_META[s].label}</option>
        ))}
      </Select>
      {!hideRevenueStatus && (
        <Select value={value.revenueStatus} onChange={(e) => set('revenueStatus', e.target.value as QaFilterState['revenueStatus'])}>
          <option value="">All Revenue Statuses</option>
          <option value="pending">Pending Revenue</option>
          <option value="finalized">Finalized Revenue</option>
          <option value="rejected">Rejected Revenue</option>
        </Select>
      )}
      <Select value={value.approvedBy} onChange={(e) => set('approvedBy', e.target.value)}>
        <option value="">All Approved By</option>
        {reviewers.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </Select>
      <Select value={value.reviewedBy} onChange={(e) => set('reviewedBy', e.target.value)}>
        <option value="">All Reviewers</option>
        {reviewers.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </Select>
      <Input type="date" value={value.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} placeholder="From" />
      <Input type="date" value={value.dateTo} onChange={(e) => set('dateTo', e.target.value)} placeholder="To" />
      {qaFiltersActive(value) && (
        <Button variant="secondary" onClick={() => onChange(EMPTY_QA_FILTERS)}>Clear filters</Button>
      )}
    </div>
  )
}
