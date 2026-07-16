// Redline QA/QC Approval Workflow — notification center. Since this is a
// frontend-only app with a device-wide role toggle (not real multi-user auth,
// see RoleContext), "notify admin" means "surface to whoever is browsing in
// Admin view on this device" and "notify field user" means "surface to
// whichever employee is the active session" — the honest scope here, not a
// gap in the feature.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { QA_STATUS_META } from '../types'
import type { QaStatus } from '../types'
import { redlineMapTarget } from '../lib/markupNav'
import { buildQaReviewRows } from '../lib/qaReview'

const NOTIF_TYPE_STATUS: Record<string, QaStatus> = {
  redline_submitted: 'pending_review',
  redline_approved: 'approved',
  redline_rejected: 'rejected',
  redline_rejection_fixed: 'rejection_fixed',
  redline_approved_after_correction: 'approved_after_correction',
}

/** Uniform shape both real (persisted) Notification records and a
 *  supervisor's live-derived QA alerts render through — a supervisor never
 *  got a "notify" call written for them anywhere in the codebase (redline
 *  submissions/rejections only ever target 'admin' or the field employee/sub
 *  who did the work), so rather than retrofit that whole creation pipeline,
 *  their alerts are computed fresh from the same QA/QC Review data source
 *  every render. No read/unread state to track — the badge just clears
 *  itself as items get approved/rejected via the QA/QC Review tab. */
interface BellItem {
  id: string
  title: string
  projectName: string
  subLabel: string
  status: QaStatus | null
  readAt: string | null
  createdAt: string
  onOpen: () => void
}

export function NotificationBell() {
  const { data, markNotificationRead, markAllNotificationsRead } = useData()
  const { role, isAdmin, activeEmployeeId, activeSubcontractorId, activeSupervisorEmployeeId } = useRole()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const isSupervisor = role === 'supervisor'

  const openOnMap = (markupId: string) => {
    const markup = (data.fieldMarkups ?? []).find((m) => m.id === markupId)
    if (!markup) return
    const target = redlineMapTarget(markup)
    nav(target.pathname, { state: target.state })
  }

  // Everything still needing a supervisor's action on a project they
  // oversee: QA/QC redlines not yet finalized (excludes
  // approved/approved_after_correction — nothing left to do once approved)
  // plus pending material lists waiting on a pickup. Same shared row-builder
  // /qa-review and the Supervisor Dashboard's KPI cards use for the QA half,
  // so this can never disagree with what's sitting on those tabs.
  const supervisorItems = useMemo<BellItem[]>(() => {
    if (!isSupervisor || !activeSupervisorEmployeeId) return []
    const myProjectIds = new Set(data.projects.filter((p) => p.supervisorId === activeSupervisorEmployeeId).map((p) => p.id))
    const qaItems = buildQaReviewRows(data)
      .filter((r) => myProjectIds.has(r.markup.projectId))
      .filter((r) => r.billing.qaStatus === 'pending_review' || r.billing.qaStatus === 'rejection_fixed' || r.billing.qaStatus === 'rejected')
      .map((r) => ({
        id: r.billing.id,
        title: `${r.billing.rateCode ? r.billing.rateCode + ' — ' : ''}${r.billing.description}`,
        projectName: r.project?.name ?? 'Unknown project',
        subLabel: r.billing.qaStatus === 'rejected' ? 'Waiting on crew to fix and resubmit' : 'Needs your review',
        status: r.billing.qaStatus ?? null,
        readAt: null,
        createdAt: r.billing.date ?? r.markup.updatedAt ?? r.markup.createdAt ?? '',
        onOpen: () => { setOpen(false); openOnMap(r.markup.id) },
      }))
    // Material lists a crew/subcontractor submitted on a project this
    // supervisor oversees — same "still needs your action" framing as the QA
    // alerts above, dropped once marked fulfilled from the Materials tab.
    const materialItems = (data.materialRequests ?? [])
      .filter((r) => myProjectIds.has(r.projectId) && r.status === 'pending')
      .map((r) => ({
        id: r.id,
        title: `Material list — ${r.items.length} item${r.items.length === 1 ? '' : 's'}`,
        projectName: data.projects.find((p) => p.id === r.projectId)?.name ?? 'Unknown project',
        subLabel: `Submitted by ${r.requestedByName}`,
        status: null,
        readAt: null,
        createdAt: r.createdAt,
        onOpen: () => { setOpen(false); nav('/materials') },
      }))
    return [...qaItems, ...materialItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupervisor, activeSupervisorEmployeeId, data])

  const notificationItems = useMemo<BellItem[]>(() => {
    if (isSupervisor) return []
    return (data.notifications ?? [])
      .filter((n) => {
        if (isAdmin) return n.recipientRole === 'admin'
        if (role === 'subcontractor') return n.recipientRole === 'field' && n.recipientSubcontractorId === activeSubcontractorId
        return n.recipientRole === 'field' && n.recipientEmployeeId === activeEmployeeId
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((n) => ({
        id: n.id,
        title: n.title,
        projectName: n.meta.projectName,
        subLabel: n.meta.fieldUserName,
        status: NOTIF_TYPE_STATUS[n.type] ?? null,
        readAt: n.readAt,
        createdAt: n.createdAt,
        onOpen: () => {
          markNotificationRead(n.id)
          setOpen(false)
          openOnMap(n.markupId)
        },
      }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupervisor, isAdmin, role, activeSubcontractorId, activeEmployeeId, data.notifications])

  const mine = isSupervisor ? supervisorItems : notificationItems
  const unreadCount = isSupervisor ? mine.length : mine.filter((n) => !n.readAt).length

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  // No active session picked yet (field employee, supervisor, or
  // subcontractor) has nothing to be "notified" as.
  if (!isAdmin && role === 'field' && !activeEmployeeId) return null
  if (role === 'subcontractor' && !activeSubcontractorId) return null
  if (isSupervisor && !activeSupervisorEmployeeId) return null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-slate-400 hover:text-slate-600"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-xs font-semibold text-slate-600">{isSupervisor ? 'Needs Your Attention' : 'Notifications'}</span>
            {!isSupervisor && unreadCount > 0 && (
              <button
                onClick={() => markAllNotificationsRead(
                  isAdmin ? 'admin' : 'field',
                  isAdmin ? undefined : activeEmployeeId,
                  role === 'subcontractor' ? activeSubcontractorId : undefined,
                )}
                className="text-[11px] text-amber-700 hover:text-amber-600"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {mine.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-slate-400">
                {isSupervisor ? 'Nothing waiting on you right now.' : 'No notifications yet.'}
              </p>
            )}
            {mine.slice(0, 30).map((n) => {
              const meta = n.status ? QA_STATUS_META[n.status] : null
              return (
                <button
                  key={n.id}
                  onClick={n.onOpen}
                  className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left last:border-0 hover:bg-slate-50 ${!n.readAt ? 'bg-amber-50' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />}
                    <div className={`min-w-0 flex-1 ${n.readAt ? 'pl-3.5' : ''}`}>
                      <p className="truncate text-xs font-semibold text-slate-800">{n.title}</p>
                      <p className="truncate text-[11px] text-slate-500">{n.projectName} · {n.subLabel}</p>
                      <div className="mt-1 flex items-center justify-between">
                        {meta && (
                          <span className="text-[10px] font-bold" style={{ color: meta.color }}>{meta.label}</span>
                        )}
                        {n.createdAt && <span className="text-[10px] text-slate-400">{new Date(n.createdAt).toLocaleString()}</span>}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
