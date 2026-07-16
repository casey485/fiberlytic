import { Fragment, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Check, X, ChevronDown, MapPin, ClipboardList, Clock } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody } from '../components/ui/Card'
import { Button, Textarea } from '../components/ui/Form'
import { QaFilterBar } from '../components/QaFilterBar'
import { EmployeePicker } from '../components/EmployeePicker'
import { QA_STATUS_META } from '../types'
import { buildQaReviewRows, applyQaFilters, EMPTY_QA_FILTERS, daysPending, actorLabel, type QaReviewRow } from '../lib/qaReview'
import type { QaFilterState } from '../lib/qaReview'
import { redlineMapTarget } from '../lib/markupNav'

function submittedByLabel(row: QaReviewRow, employeeNameById: Map<string, string>, subNameById: Map<string, string>): string {
  if (row.markup.assignedSubcontractorId) {
    return subNameById.get(row.markup.assignedSubcontractorId) ?? 'Unknown subcontractor'
  }
  if (row.markup.createdBy) {
    return employeeNameById.get(row.markup.createdBy) ?? 'Unknown employee'
  }
  return 'Unassigned'
}

export function QaReview() {
  const { data, approveQaLine, rejectQaLine, updateMarkupBilling } = useData()
  const { role, activeEmployeeId, activeSupervisorEmployeeId, setActiveSupervisorEmployee } = useRole()
  const nav = useNavigate()
  const location = useLocation()
  // Lets other pages (e.g. the Admin Dashboard's QA/QC status card) deep-link
  // here already scoped to a status — e.g. Link to="/qa-review" state={{
  // qaFilters: { ...EMPTY_QA_FILTERS, qaStatus: 'pending_review' } }}.
  const [filters, setFilters] = useState<QaFilterState>(
    () => (location.state as { qaFilters?: QaFilterState } | null)?.qaFilters ?? EMPTY_QA_FILTERS,
  )
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editNoteDraft, setEditNoteDraft] = useState('')

  const isSupervisor = role === 'supervisor'
  // Supervisor keeps its own separate identity from In-House view (see
  // RoleContext's doc comment) — this is the id recorded as "who did this"
  // for any approve/reject/note a supervisor session makes below.
  const effectiveActorId = isSupervisor ? activeSupervisorEmployeeId : activeEmployeeId
  const hideDollarAmounts = isSupervisor

  const employeeNameById = useMemo(() => new Map(data.employees.map((e) => [e.id, e.name])), [data.employees])
  const subNameById = useMemo(() => new Map((data.subcontractors ?? []).map((s) => [s.id, s.companyName])), [data.subcontractors])

  // A supervisor only ever reviews their own projects' redlines — everyone
  // else's stay completely out of the list, not just visually de-emphasized,
  // since this page (unlike the Field Map) has no "visible but inert" mode.
  const supervisedProjects = useMemo(
    () => isSupervisor ? data.projects.filter((p) => p.supervisorId === activeSupervisorEmployeeId) : data.projects,
    [isSupervisor, data.projects, activeSupervisorEmployeeId],
  )
  const supervisedProjectIds = useMemo(() => new Set(supervisedProjects.map((p) => p.id)), [supervisedProjects])

  const allRows = useMemo(() => {
    const rows = buildQaReviewRows(data)
    return isSupervisor ? rows.filter((r) => supervisedProjectIds.has(r.markup.projectId)) : rows
  }, [data, isSupervisor, supervisedProjectIds])
  const rows = useMemo(() => applyQaFilters(allRows, filters)
    .sort((a, b) => (b.markup.createdAt ?? '').localeCompare(a.markup.createdAt ?? '')), [allRows, filters])

  function openRedline(row: QaReviewRow) {
    const target = redlineMapTarget(row.markup)
    nav(target.pathname, { state: target.state })
  }

  function submitReject(billingId: string) {
    if (!rejectNote.trim()) return
    rejectQaLine(billingId, effectiveActorId, rejectNote.trim())
    setRejectingId(null); setRejectNote('')
  }

  function saveNoteEdit(billingId: string) {
    updateMarkupBilling(billingId, { qaRejectionNote: editNoteDraft.trim() || null })
    setEditingNoteId(null); setEditNoteDraft('')
  }

  // A supervisor must pick who they are before this page means anything —
  // it's what scopes "your projects" above and what gets recorded as the
  // actor on any approval/rejection/note.
  if (isSupervisor && !activeSupervisorEmployeeId) {
    const supervisors = data.employees.filter((e) => e.active && e.isSupervisor)
    return (
      <div>
        <PageHeader title="QA/QC Review" description="Test-phase view — not a real secured login yet." />
        {supervisors.length === 0 ? (
          <p className="mt-6 text-center text-sm text-slate-400">
            No employees are marked as a supervisor yet — check "Supervisor" on someone in the Employees tab first.
          </p>
        ) : (
          <EmployeePicker onSelect={setActiveSupervisorEmployee} employees={supervisors} />
        )}
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="QA/QC Review"
        description={
          isSupervisor
            ? `Redlines submitted on your ${supervisedProjects.length === 1 ? 'project' : 'projects'} — approve, reject, or add notes here.`
            : 'Every redline billing line submitted from the Field Map, across all projects — approve, reject, or review its history here.'
        }
      />

      <Card className="mb-4">
        <CardBody>
          <QaFilterBar value={filters} onChange={setFilters} projects={supervisedProjects} hideRevenueStatus={isSupervisor} />
        </CardBody>
      </Card>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[1150px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Project</th>
                <th className="px-5 py-3 font-medium">Feeder ID</th>
                {!isSupervisor && <th className="px-5 py-3 font-medium">Supervisor</th>}
                <th className="px-5 py-3 font-medium">Location</th>
                <th className="px-5 py-3 font-medium">Field Employee / Subcontractor</th>
                <th className="px-5 py-3 font-medium">Item</th>
                <th className="px-5 py-3 text-right font-medium">Quantity</th>
                {!hideDollarAmounts && <th className="px-5 py-3 text-right font-medium">Value</th>}
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const b = row.billing
                const meta = QA_STATUS_META[b.qaStatus!]
                const reviewable = b.qaStatus === 'pending_review' || b.qaStatus === 'rejection_fixed'
                const pending = daysPending(row)
                const expanded = expandedId === b.id
                // History is stored per-markup, not per-billing-line (see qaReview.ts) —
                // when a markup has multiple billing lines, this shows every QA action
                // taken on the markup, not strictly scoped to this one line.
                const history = (data.markupHistory ?? [])
                  .filter((h) => h.markupId === row.markup.id && h.action.startsWith('qa_'))
                  .sort((x, y) => y.timestamp.localeCompare(x.timestamp))

                return (
                  <Fragment key={b.id}>
                    <tr className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-medium text-slate-800">{row.project?.name ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-400">{row.markup.featureName ?? row.markup.label ?? <span className="text-slate-300">—</span>}</td>
                      {!isSupervisor && (
                        <td className="px-5 py-3 text-slate-400">
                          {row.project?.supervisorId
                            ? employeeNameById.get(row.project.supervisorId) ?? 'Unknown supervisor'
                            : <span className="text-slate-300">Unassigned</span>}
                        </td>
                      )}
                      <td className="px-5 py-3 text-slate-400">{row.project?.location ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-400">{submittedByLabel(row, employeeNameById, subNameById)}</td>
                      <td className="px-5 py-3 text-slate-400">
                        {b.rateCode ? <span className="text-brand-500 mr-1">{b.rateCode}</span> : null}
                        {b.description}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-400">{b.quantity} {b.unitType}</td>
                      {!hideDollarAmounts && <td className="px-5 py-3 text-right font-medium text-slate-800">${b.total.toFixed(2)}</td>}
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                            style={{ color: meta.color, backgroundColor: `${meta.color}22` }}
                          >
                            {meta.label}
                          </span>
                          {pending !== null && (
                            <span
                              title={`Waiting on a decision for ${pending} day${pending === 1 ? '' : 's'}`}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                pending >= 7 ? 'bg-rose-100 text-rose-700' : pending >= 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'
                              }`}
                            >
                              <Clock size={11} />
                              {pending === 0 ? 'Today' : `${pending}d`}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            onClick={() => openRedline(row)}
                            className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-600"
                            title="Open this redline on the Field Map"
                            aria-label="View"
                          >
                            <MapPin size={12} /> View
                          </button>
                          {reviewable && (
                            <>
                              <button
                                onClick={() => approveQaLine(b.id, effectiveActorId)}
                                className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:border-emerald-300 hover:text-emerald-600"
                                title="Approve this billing line"
                                aria-label="Approve"
                              >
                                <Check size={12} /> Approve
                              </button>
                              <button
                                onClick={() => { setRejectingId(b.id); setExpandedId(b.id) }}
                                className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:border-rose-300 hover:text-rose-600"
                                title="Reject this billing line"
                                aria-label="Reject"
                              >
                                <X size={12} /> Reject
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => setExpandedId(expanded ? null : b.id)}
                            className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-600"
                            title="Review history / notes"
                            aria-label="Notes"
                          >
                            <ClipboardList size={12} /> Notes
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-slate-50 bg-slate-50/60">
                        <td colSpan={hideDollarAmounts ? 8 : 10} className="px-5 py-3">
                          <div className="space-y-2 text-xs">
                            {b.qaRejectionNote && editingNoteId !== b.id && (
                              <p className="text-rose-600">
                                <b>Rejection note:</b> {b.qaRejectionNote}{' '}
                                <button onClick={() => { setEditingNoteId(b.id); setEditNoteDraft(b.qaRejectionNote ?? '') }} className="ml-1 text-brand-600 underline">Edit</button>
                              </p>
                            )}
                            {editingNoteId === b.id && (
                              <div className="flex items-start gap-2">
                                <Textarea value={editNoteDraft} onChange={(e) => setEditNoteDraft(e.target.value)} rows={2} className="flex-1" />
                                <Button onClick={() => saveNoteEdit(b.id)}>Save</Button>
                                <Button variant="secondary" onClick={() => setEditingNoteId(null)}>Cancel</Button>
                              </div>
                            )}
                            {b.qaApprovedBy && b.qaApprovedAt && (
                              <p className="text-slate-400">Approved by {actorLabel(b.qaApprovedBy, employeeNameById, subNameById) ?? b.qaApprovedBy} · {new Date(b.qaApprovedAt).toLocaleString()}</p>
                            )}
                            {b.qaCorrectedBy && b.qaCorrectedAt && (
                              <p className="text-slate-400">Marked fixed by {actorLabel(b.qaCorrectedBy, employeeNameById, subNameById) ?? b.qaCorrectedBy} · {new Date(b.qaCorrectedAt).toLocaleString()}</p>
                            )}

                            {rejectingId === b.id && (
                              <div className="rounded border border-rose-200 bg-white p-2 space-y-1.5">
                                <Textarea autoFocus value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={2} placeholder="Rejection comments (required)…" />
                                <div className="flex gap-2">
                                  <Button onClick={() => submitReject(b.id)} disabled={!rejectNote.trim()}>Confirm Reject</Button>
                                  <Button variant="secondary" onClick={() => { setRejectingId(null); setRejectNote('') }}>Cancel</Button>
                                </div>
                              </div>
                            )}

                            <div>
                              <p className="mb-1 font-semibold text-slate-400">Review History</p>
                              {history.length === 0 && <p className="text-slate-500">No QA/QC history yet.</p>}
                              {history.map((h) => (
                                <div key={h.id} className="flex items-center justify-between border-t border-slate-100 py-1 first:border-0">
                                  <span className="text-slate-400">
                                    {h.action.replace('qa_', '').replace(/_/g, ' ')}
                                    {actorLabel(h.actor, employeeNameById, subNameById) && <span className="text-slate-500"> — {actorLabel(h.actor, employeeNameById, subNameById)}</span>}
                                    {h.note && <span className="italic text-slate-500"> · {h.note}</span>}
                                  </span>
                                  <span className="shrink-0 text-slate-500">{new Date(h.timestamp).toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={hideDollarAmounts ? 8 : 10} className="px-5 py-10 text-center text-slate-500">
                    <ChevronDown size={16} className="mx-auto mb-1 opacity-30" />
                    No redlines match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  )
}
