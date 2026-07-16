import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { TrendingUp, TrendingDown, FileText, File, Clock, Package, Users, DollarSign, HardHat, Wrench, Download, AlertOctagon, CheckCircle2, Building2, Trash2 } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { loadBlob } from '../lib/fileStore'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { Field, Select } from '../components/ui/Form'
import { FiberTapReportForm } from '../components/FiberTapReportForm'
import { SpliceTemplateModal } from '../components/SpliceTemplateModal'
import { exportFiberTapReportExcel } from '../lib/spliceExport'
import { exportFiberTapReportWithTemplate, exportSpliceEnclosureWithTemplate, downloadMasterWorkbook } from '../lib/spliceReportTemplate'
import { money, moneyExact, number, percent, formatDateShort, localDateStr } from '../lib/format'
import { projectProgress, weekStart, weekEnd, daysInMonth, computeQaRevenueBreakdown, computeAllProductionQaTotals, withinDays, entryDisplayFootage, entryFootageLabel, worstQaStatus } from '../lib/analytics'
import { buildQaReviewRows, applyQaFilters, EMPTY_QA_FILTERS } from '../lib/qaReview'
import type { QaFilterState } from '../lib/qaReview'
import { redlineMapTarget } from '../lib/markupNav'
import { crewOrSubName } from '../lib/crewOrSub'
import { projectAssignedToSubcontractor, isPrintHiddenFromSession } from '../lib/printAssignment'
import { QaStatusBadge } from '../components/QaStatusBadge'
import { EmployeePicker } from '../components/EmployeePicker'
import { Projects } from './Projects'
import { KmzProduction } from './KmzProduction'
import { Materials } from './Materials'
import { QaReview } from './QaReview'
import type { Crew, Subcontractor } from '../types'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend as RechartLegend,
} from 'recharts'

function weekdaysInRange(start: string, end: string): number {
  let count = 0
  const d = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  while (d <= e) { if (d.getDay() !== 0 && d.getDay() !== 6) count++; d.setDate(d.getDate() + 1) }
  return count
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-y border-slate-100 bg-slate-50 px-5 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
      {children}
    </p>
  )
}

function BigMetric({
  label, value, sub, tone,
}: {
  label: string; value: string; sub?: string; tone: 'green' | 'red' | 'blue' | 'neutral'
}) {
  const colors = { green: 'text-emerald-700', red: 'text-rose-600', blue: 'text-brand-700', neutral: 'text-slate-800' }
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-3xl font-extrabold tracking-tight sm:text-4xl ${colors[tone]}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

function FilterChip({ label, active, onClick, color = 'brand' }: {
  label: string; active: boolean; onClick: () => void; color?: 'brand' | 'violet'
}) {
  const activeClass = color === 'violet'
    ? 'bg-violet-600 text-white'
    : 'bg-brand-600 text-white'
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
        active ? activeClass : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  )
}

// ── Unified weekly summary card ───────────────────────────────────────────────

function WeeklySummaryCard({
  crews,
  wStart,
  wEnd,
  weekdays,
  scopedProjectIds,
}: {
  crews: Crew[]
  wStart: string
  wEnd: string
  weekdays: number
  scopedProjectIds: Set<string>
}) {
  const { data } = useData()
  const { isAdmin } = useRole()

  type FilterType = { type: 'all' } | { type: 'crew'; id: string } | { type: 'project'; id: string }
  const [filter, setFilter] = useState<FilterType>({ type: 'all' })

  const crewIds = useMemo(() => new Set(crews.map((c) => c.id)), [crews])

  // Production entries for current filter
  const prodEntries = useMemo(() =>
    data.production.filter((p) =>
      p.date >= wStart && p.date <= wEnd &&
      crewIds.has(p.crewId) &&
      scopedProjectIds.has(p.projectId) &&
      (filter.type === 'all' ||
       (filter.type === 'crew' && p.crewId === filter.id) ||
       (filter.type === 'project' && p.projectId === filter.id))
    ),
  [data.production, wStart, wEnd, crewIds, scopedProjectIds, filter])

  const prodIds = useMemo(() => new Set(prodEntries.map((p) => p.id)), [prodEntries])

  // Aggregate employees from clock entries — actual hours worked this week
  const empAgg = useMemo(() => {
    const map = new Map<string, { hours: number; cost: number; crewIdSet: Set<string> }>()
    for (const ce of data.clockEntries ?? []) {
      const d = ce.clockIn.slice(0, 10)
      if (d < wStart || d > wEnd || !ce.clockOut) continue
      if (!crewIds.has(ce.crewId ?? '')) continue
      if (filter.type === 'crew'    && ce.crewId    !== filter.id) continue
      if (filter.type === 'project' && ce.projectId !== filter.id) continue
      const hrs = (new Date(ce.clockOut).getTime() - new Date(ce.clockIn).getTime()) / 3_600_000
      const emp = data.employees.find((e) => e.id === ce.employeeId)
      const cur = map.get(ce.employeeId) ?? { hours: 0, cost: 0, crewIdSet: new Set() }
      cur.hours += hrs
      cur.cost  += hrs * (emp?.hourlyRate ?? 0)
      if (ce.crewId) cur.crewIdSet.add(ce.crewId)
      map.set(ce.employeeId, cur)
    }
    return [...map.entries()]
      .map(([id, v]) => ({
        emp: data.employees.find((e) => e.id === id),
        hours: v.hours,
        cost: v.cost,
        crewNames: [...v.crewIdSet]
          .map((cid) => crews.find((c) => c.id === cid)?.name)
          .filter(Boolean)
          .join(', '),
      }))
      .sort((a, b) => b.hours - a.hours)
  }, [data.clockEntries, data.employees, wStart, wEnd, crewIds, crews, filter])

  // Revenue from PnL entries linked to these production entries
  const pnlEntries = useMemo(() =>
    data.pnl.filter((p) => p.date >= wStart && p.date <= wEnd && p.productionEntryId && prodIds.has(p.productionEntryId)),
  [data.pnl, wStart, wEnd, prodIds])

  const revenue   = pnlEntries.reduce((s, p) => s + p.revenue, 0)
  const laborCost = empAgg.length > 0
    ? empAgg.reduce((s, r) => s + r.cost, 0)
    : pnlEntries.reduce((s, p) => s + p.laborCost, 0)
  const footage    = prodEntries.reduce((s, p) => s + p.footage, 0)
  // Use timecard hours when available (same source as the employee table below) so
  // the summary bar and employee breakdown always show the same total.
  // Fall back to production.hours for entries that pre-date timecard tracking.
  const totalHours = empAgg.length > 0
    ? empAgg.reduce((s, r) => s + r.hours, 0)
    : prodEntries.reduce((s, p) => s + p.hours, 0)

  // Equipment cost — scoped to filtered crew(s), or to crews currently on the filtered project
  const filteredCrewIdSet: Set<string> =
    filter.type === 'crew'
      ? new Set([filter.id])
      : filter.type === 'project'
      ? new Set(data.crews.filter((c) => c.currentProjectId === filter.id).map((c) => c.id))
      : crewIds
  const equipRows = data.equipment
    .filter((eq) => eq.active && eq.crewId && filteredCrewIdSet.has(eq.crewId))
    .map((eq) => ({ eq, daily: eq.monthlyCost / daysInMonth(wStart), weekCost: Math.round(eq.monthlyCost / daysInMonth(wStart) * weekdays) }))
  const equipCost = equipRows.reduce((s, r) => s + r.weekCost, 0)

  // Expenses
  const expenses = data.jobExpenses.filter((ex) => {
    if (ex.date < wStart || ex.date > wEnd) return false
    if (ex.crewId) return filteredCrewIdSet.has(ex.crewId)
    if (filter.type === 'project') return ex.jobId === filter.id
    return scopedProjectIds.has(ex.jobId)
  })
  const expCost = expenses.reduce((s, ex) => s + ex.amount, 0)

  const totalCost = laborCost + equipCost + expCost
  const profit    = revenue - totalCost
  const margin    = revenue > 0 ? profit / revenue : 0

  // Tabs: crews and projects that had activity this week (within scope)
  const activeWeekCrewIds    = new Set(prodEntries.map((p) => p.crewId))
  const activeWeekProjectIds = new Set(prodEntries.map((p) => p.projectId))
  const tabCrews    = crews.filter((c) => activeWeekCrewIds.has(c.id))
  const tabProjects = [...activeWeekProjectIds]
    .map((id) => data.projects.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p)

  const showCrewCol = filter.type === 'all' && tabCrews.length > 1

  // Project files for the filtered context
  const fileProject = filter.type === 'crew'
    ? data.projects.find((p) => p.id === crews.find((c) => c.id === filter.id)?.currentProjectId)
    : filter.type === 'project'
    ? data.projects.find((p) => p.id === filter.id)
    : null

  const isEmpty = prodEntries.length === 0 && equipRows.length === 0 && expenses.length === 0

  return (
    <Card className="overflow-hidden">
      {/* ── Tab bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-5 py-3">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Filter:</span>
        <FilterChip label="All" active={filter.type === 'all'} onClick={() => setFilter({ type: 'all' })} />
        {tabCrews.map((crew) => {
          const foremanEmp = crew.foremanId ? data.employees.find((e) => e.id === crew.foremanId) : null
          const label = foremanEmp ? `${crew.name} · ${foremanEmp.name}` : crew.name
          return (
            <FilterChip
              key={crew.id}
              label={label}
              active={filter.type === 'crew' && filter.id === crew.id}
              onClick={() => setFilter({ type: 'crew', id: crew.id })}
            />
          )
        })}
        {tabProjects.length > 1 && tabProjects.map((proj) => (
          <FilterChip
            key={proj.id}
            label={proj.name}
            color="violet"
            active={filter.type === 'project' && filter.id === proj.id}
            onClick={() => setFilter({ type: 'project', id: proj.id })}
          />
        ))}
      </div>

      {isEmpty ? (
        <div className="px-5 py-10 text-center text-sm text-slate-400">
          No production logged this week for this selection.
        </div>
      ) : (
        <>
          {/* ── Summary metrics ───────────────────────────────────────── */}
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 border-b border-slate-200 sm:grid-cols-5 sm:divide-y-0">
            {[
              { label: 'Footage', value: `${number(footage)} ft`, cls: 'text-slate-800' },
              { label: 'Hours', value: totalHours > 0 ? `${totalHours.toFixed(1)} h` : '—', cls: 'text-slate-800' },
              { label: 'Revenue', value: money(revenue), cls: 'text-emerald-700' },
              { label: 'Total Cost', value: money(totalCost), cls: 'text-rose-600' },
              {
                label: 'Net Profit',
                value: money(profit),
                sub: revenue > 0 ? `${percent(margin, 1)} margin` : undefined,
                cls: profit >= 0 ? 'text-emerald-700' : 'text-rose-600',
              },
            ].map(({ label, value, sub, cls }) => (
              <div key={label} className="flex flex-col gap-0.5 px-5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
                <p className={`text-lg font-extrabold ${cls}`}>{value}</p>
                {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
              </div>
            ))}
          </div>

          {/* ── Employees ─────────────────────────────────────────────── */}
          {empAgg.length > 0 && (
            <>
              <SubLabel>Employees — week total{showCrewCol ? ' (aggregated across all crews)' : ''}</SubLabel>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400">
                    <th className="px-5 py-1.5 font-medium">Name</th>
                    <th className="px-5 py-1.5 font-medium">Role</th>
                    {showCrewCol && <th className="px-5 py-1.5 font-medium">Crew(s)</th>}
                    <th className="px-5 py-1.5 text-right font-medium">Hrs (week)</th>
                    {isAdmin && <th className="px-5 py-1.5 text-right font-medium">Rate</th>}
                    {isAdmin && <th className="px-5 py-1.5 text-right font-medium">Wk Cost</th>}
                  </tr>
                </thead>
                <tbody>
                  {empAgg.map(({ emp, hours, cost, crewNames }, i) => (
                    <tr key={emp?.id ?? i} className="border-t border-slate-50 hover:bg-slate-50/40">
                      <td className="px-5 py-1.5 font-medium text-slate-800">
                        {emp?.name ?? '—'}
                        {emp?.isForeman && (
                          <span className="ml-1.5 inline-flex items-center rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
                            Foreman
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-1.5 text-slate-500">{emp?.role ?? '—'}</td>
                      {showCrewCol && <td className="px-5 py-1.5 text-xs text-slate-400">{crewNames || '—'}</td>}
                      <td className="px-5 py-1.5 text-right font-semibold text-slate-700">{hours.toFixed(1)} h</td>
                      {isAdmin && <td className="px-5 py-1.5 text-right text-slate-400">${emp?.hourlyRate?.toFixed(2) ?? '—'}/h</td>}
                      {isAdmin && <td className="px-5 py-1.5 text-right font-semibold text-slate-800">{money(cost)}</td>}
                    </tr>
                  ))}
                </tbody>
                {isAdmin && laborCost > 0 && (
                  <tfoot>
                    <tr className="border-t border-slate-100 bg-slate-50/60">
                      <td colSpan={showCrewCol ? 5 : 4} className="px-5 py-1.5 text-right text-xs font-semibold text-slate-400">
                        Labor subtotal
                      </td>
                      <td className="px-5 py-1.5 text-right font-bold text-brand-700">{money(laborCost)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </>
          )}

          {/* ── Equipment ─────────────────────────────────────────────── */}
          {equipRows.length > 0 && (
            <>
              <SubLabel>Equipment</SubLabel>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400">
                    <th className="px-5 py-1.5 font-medium">Item</th>
                    <th className="px-5 py-1.5 font-medium">Category</th>
                    <th className="px-5 py-1.5 font-medium">Crew</th>
                    <th className="px-5 py-1.5 text-right font-medium">Daily rate</th>
                    <th className="px-5 py-1.5 text-right font-medium">Days</th>
                    <th className="px-5 py-1.5 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {equipRows.map(({ eq, daily, weekCost }) => {
                    const crew = crews.find((c) => c.id === eq.crewId)
                    return (
                      <tr key={eq.id} className="border-t border-slate-50 hover:bg-slate-50/40">
                        <td className="px-5 py-1.5 font-medium text-slate-800">{eq.name}</td>
                        <td className="px-5 py-1.5 text-slate-500">{eq.category}</td>
                        <td className="px-5 py-1.5 text-xs text-slate-400">{crew?.name ?? '—'}</td>
                        <td className="px-5 py-1.5 text-right text-slate-400">{money(daily)}</td>
                        <td className="px-5 py-1.5 text-right text-slate-400">{weekdays}</td>
                        <td className="px-5 py-1.5 text-right font-semibold text-slate-800">{money(weekCost)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-100 bg-slate-50/60">
                    <td colSpan={5} className="px-5 py-1.5 text-right text-xs font-semibold text-slate-400">Equipment subtotal</td>
                    <td className="px-5 py-1.5 text-right font-bold text-purple-700">{money(equipCost)}</td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}

          {/* ── Expenses ──────────────────────────────────────────────── */}
          {expenses.length > 0 && (
            <>
              <SubLabel>Expenses</SubLabel>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400">
                    <th className="px-5 py-1.5 font-medium">Date</th>
                    <th className="px-5 py-1.5 font-medium">Vendor</th>
                    <th className="px-5 py-1.5 font-medium">Description</th>
                    <th className="px-5 py-1.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((ex) => (
                    <tr key={ex.id} className="border-t border-slate-50 hover:bg-slate-50/40">
                      <td className="whitespace-nowrap px-5 py-1.5 text-slate-500">{ex.date.slice(5).replace('-', '/')}</td>
                      <td className="px-5 py-1.5 text-slate-600">{ex.vendor}</td>
                      <td className="px-5 py-1.5 text-slate-700">{ex.description}</td>
                      <td className="px-5 py-1.5 text-right font-semibold text-slate-800">{moneyExact(ex.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-100 bg-slate-50/60">
                    <td colSpan={3} className="px-5 py-1.5 text-right text-xs font-semibold text-slate-400">Expenses subtotal</td>
                    <td className="px-5 py-1.5 text-right font-bold text-amber-700">{money(expCost)}</td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}

          {/* ── Project files (when filtered to a specific project/crew) ── */}
          {fileProject && (() => {
            const files = data.projectFiles.filter((f) => f.projectId === fileProject.id)
            if (files.length === 0) return null
            const openFile = async (fileId: string, name: string) => {
              const dataUrl = await loadBlob(fileId)
              if (!dataUrl) return
              const a = document.createElement('a')
              a.href = dataUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.download = name; a.click()
            }
            return (
              <>
                <SubLabel>Project files — {fileProject.name}</SubLabel>
                <div className="flex flex-wrap gap-2 px-5 py-3">
                  {files.map((f) =>
                    f.fileType === 'pdf' ? (
                      <Link key={f.id} to={`/kmz/${f.projectId}/print/${f.id}`} className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100">
                        <FileText size={13} /> {f.name}
                      </Link>
                    ) : (
                      <button key={f.id} onClick={() => openFile(f.id, f.name)} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:shadow-sm ${f.fileType === 'kmz' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                        <File size={13} /> {f.name}
                      </button>
                    )
                  )}
                </div>
              </>
            )
          })()}

          {/* ── Cost/revenue footer ───────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-slate-200 bg-slate-50 px-5 py-3 text-sm">
            <div className="flex flex-wrap gap-5">
              {laborCost > 0 && <span className="text-slate-500">Labor <strong className="text-brand-700">{money(laborCost)}</strong></span>}
              {equipCost > 0 && <span className="text-slate-500">Equipment <strong className="text-purple-700">{money(equipCost)}</strong></span>}
              {expCost   > 0 && <span className="text-slate-500">Expenses <strong className="text-amber-700">{money(expCost)}</strong></span>}
              {totalCost === 0 && <span className="text-slate-400">No costs this week</span>}
            </div>
            <div className="flex flex-wrap gap-5 font-semibold">
              <span className="text-slate-600">Total Cost <span className="text-rose-600">{money(totalCost)}</span></span>
              <span className="text-slate-600">Revenue <span className="text-emerald-700">{money(revenue)}</span></span>
              <span className={profit >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                {profit >= 0 ? <TrendingUp size={14} className="inline mr-1" /> : <TrendingDown size={14} className="inline mr-1" />}
                Net {money(profit)}
              </span>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

// ── Employee picker ───────────────────────────────────────────────────────────

// ── Field dashboard ───────────────────────────────────────────────────────────

type FieldDashboardTab = 'overview' | 'projects' | 'map' | 'materials'
const FIELD_DASHBOARD_TABS: { key: FieldDashboardTab; label: string }[] = [
  { key: 'overview',  label: 'Overview' },
  { key: 'projects',  label: 'My Projects' },
  { key: 'map',       label: 'Field Map' },
  { key: 'materials', label: 'Materials' },
]

function FieldDashboard() {
  const { data, markRejectionFixedQa } = useData()
  const { activeEmployeeId, setActiveEmployee } = useRole()
  const nav = useNavigate()
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [fixNote, setFixNote] = useState('')
  const [tab, setTab] = useState<FieldDashboardTab>('overview')


  const today      = localDateStr()
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const wStart     = weekStart(today)
  const wEnd       = weekEnd(today)

  const activeEmployee = activeEmployeeId
    ? data.employees.find((e) => e.id === activeEmployeeId) ?? null
    : null

  // ── Employee picker when no one is selected ──────────────────────────────
  if (!activeEmployee) {
    return (
      <div>
        <PageHeader title="Field Dashboard" description={todayLabel} />
        <EmployeePicker
          onSelect={setActiveEmployee}
          employees={data.employees.filter((e) => e.active)}
        />
      </div>
    )
  }

  // ── Personal dashboard ───────────────────────────────────────────────────

  // Same "Pending/Approved/Rejected" summary the Subcontractor Dashboard
  // shows, scoped to this employee's own submitted redlines via
  // fieldEmployeeId (buildQaReviewRows/applyQaFilters resolve that to
  // markup.createdBy) — but in footage, not dollars. In-house employees
  // aren't paid per unit like a subcontractor, so what gets billed to the
  // customer isn't their business; footage placed by QA status is.
  const myFilteredBillingIds = new Set(
    applyQaFilters(buildQaReviewRows(data), { ...EMPTY_QA_FILTERS, fieldEmployeeId: activeEmployee.id }).map((r) => r.billing.id),
  )
  let myPendingFootage = 0, myApprovedFootage = 0, myRejectedFootage = 0
  // Point-type work (splices, handholes, tie-ins) is billed in EA/SQFT, not
  // LF — it has real, nonzero billed quantity but zero linear footage, so it
  // can't be blended into the ft totals above without being meaningless.
  // Tracked separately per status so it isn't just invisible from these
  // cards — shown as a "+ N EA" line underneath each one.
  const myPendingOther = new Map<string, number>()
  const myApprovedOther = new Map<string, number>()
  const myRejectedOther = new Map<string, number>()
  for (const li of data.productionLineItems) {
    if (!li.qaStatus || !li.sourceMarkupBillingId || !myFilteredBillingIds.has(li.sourceMarkupBillingId)) continue
    const isPending = li.qaStatus === 'pending_review' || li.qaStatus === 'rejection_fixed'
    const isApproved = li.qaStatus === 'approved' || li.qaStatus === 'approved_after_correction'
    const isRejected = li.qaStatus === 'rejected'
    if (li.uom === 'LF') {
      if (isPending) myPendingFootage += li.quantity
      else if (isApproved) myApprovedFootage += li.quantity
      else if (isRejected) myRejectedFootage += li.quantity
    } else {
      const bucket = isPending ? myPendingOther : isApproved ? myApprovedOther : isRejected ? myRejectedOther : null
      if (bucket) bucket.set(li.uom, (bucket.get(li.uom) ?? 0) + li.quantity)
    }
  }
  const formatOtherUnits = (m: Map<string, number>) =>
    [...m.entries()].map(([uom, qty]) => `${qty.toLocaleString()} ${uom}`).join(', ')

  // Redline QA/QC Approval Workflow — "Corrections Needed": billing lines an
  // admin rejected on a redline this employee drew. Subcontractors have no
  // login/dashboard session in this app's role model, so their work must
  // never surface here — excluded via assignedSubcontractorId (the real
  // attribution) rather than relying solely on createdBy staying unset for
  // subcontractor-created markups (see lib/actorId.ts's createdByActorId —
  // this is defense in depth in case any already-corrupted data still has a
  // stale employee id baked into createdBy from before that fix).
  const correctionsNeeded = (data.markupBilling ?? [])
    .filter((b) => b.qaStatus === 'rejected')
    .map((b) => {
      const markup = (data.fieldMarkups ?? []).find((m) => m.id === b.markupId)
      const isThisEmployeesOwnWork = markup && !markup.assignedSubcontractorId && !b.assignedSubcontractorId && markup.createdBy === activeEmployee.id
      return isThisEmployeesOwnWork ? { billing: b, markup } : null
    })
    .filter((r): r is { billing: typeof data.markupBilling[number]; markup: NonNullable<typeof data.fieldMarkups[number]> } => r != null)
    .map((r) => ({ ...r, project: data.projects.find((p) => p.id === r.markup.projectId) }))

  function openOnMap(projectId: string, markupId: string) {
    const markup = (data.fieldMarkups ?? []).find((m) => m.id === markupId)
    const target = markup ? redlineMapTarget(markup) : { pathname: `/kmz/${projectId}`, state: { focusMarkupId: markupId } }
    nav(target.pathname, { state: target.state })
  }

  function confirmFix(billingId: string) {
    markRejectionFixedQa(billingId, activeEmployee!.id, fixNote.trim() || undefined)
    setFixingId(null); setFixNote('')
  }

  // Collect ALL crew IDs this employee is associated with:
  //   1. their default crew assignment
  //   2. any crew where they're listed as foreman
  //   3. any crew where they appear in the members list
  //   4. any crew they logged timecards for this week (catches temp/cross-crew work)
  const myCrewIdSet = new Set<string>()
  for (const crew of data.crews) {
    if (activeEmployee.defaultCrewId && crew.id === activeEmployee.defaultCrewId) myCrewIdSet.add(crew.id)
    if (crew.foremanId === activeEmployee.id) myCrewIdSet.add(crew.id)
    if (crew.members.some((m) => m.employeeId === activeEmployee.id && m.active)) myCrewIdSet.add(crew.id)
  }
  // Add crews from timecards this week (handles cross-crew days)
  for (const tc of data.timecards) {
    if (tc.employeeId !== activeEmployee.id) continue
    if (tc.date < wStart || tc.date > wEnd) continue
    if (!tc.productionEntryId) continue
    const prod = data.production.find((p) => p.id === tc.productionEntryId)
    if (prod) myCrewIdSet.add(prod.crewId)
  }

  const myCrews = data.crews.filter((c) => myCrewIdSet.has(c.id))
  // Primary crew for the status card — prefer default assignment, fall back to first found
  const primaryCrew =
    (activeEmployee.defaultCrewId && data.crews.find((c) => c.id === activeEmployee.defaultCrewId)) ||
    myCrews[0] ||
    null
  const myProject = primaryCrew?.currentProjectId
    ? data.projects.find((p) => p.id === primaryCrew.currentProjectId) ?? null
    : null

  // Today's clock entries for this employee
  const todayClock = (data.clockEntries ?? [])
    .filter((ce) => ce.employeeId === activeEmployee.id && ce.clockIn.startsWith(today))
    .sort((a, b) => a.clockIn.localeCompare(b.clockIn))

  const activeClock = todayClock.find((ce) => !ce.clockOut) ?? null
  const clockedHoursToday = activeClock
    ? (Date.now() - new Date(activeClock.clockIn).getTime()) / 3_600_000
    : 0

  const completedHoursToday = todayClock
    .filter((ce) => ce.clockOut)
    .reduce((s, ce) => s + (new Date(ce.clockOut!).getTime() - new Date(ce.clockIn).getTime()) / 3_600_000, 0)

  const totalHoursToday = completedHoursToday + clockedHoursToday

  // All production entries for ANY of the employee's crews this week
  const weekProduction = data.production
    .filter((p) => p.date >= wStart && p.date <= wEnd && myCrewIdSet.has(p.crewId))
    .map((p) => {
      const lineItems = data.productionLineItems.filter((li) => li.productionEntryId === p.id)
      // A multi-crew redline split intentionally zeroes out entry.footage on
      // non-primary crews to avoid double-counting shared footage (see
      // productionFromMarkup.ts) — but that crew's own billed quantity still
      // lives on its line items, so prefer the LF sum from those whenever
      // line items exist rather than trusting the raw entry.footage, which
      // is what made this table show 0 ft for entries the admin Production
      // page correctly shows real footage for.
      const lfQty = lineItems.filter((li) => li.uom === 'LF').reduce((s, li) => s + li.quantity, 0)
      const displayFootage = lineItems.length > 0 ? lfQty : p.footage
      // Point-type work (splices, handholes, tie-ins — billed in EA/SQFT, not
      // LF) has zero linear footage but real billed quantity; show that
      // instead of a misleading "0 ft" on the row itself. The week total
      // above still sums pure LF only — blending units into one number
      // would be meaningless.
      const footageLabel = entryFootageLabel(p, lineItems)
      return { ...p, displayFootage, footageLabel, lineItems }
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  const crewFootageWeek = weekProduction.reduce((s, p) => s + p.displayFootage, 0)
  const crewHoursWeek   = weekProduction.reduce((s, p) => s + p.hours, 0)
  const showCrewCol     = myCrews.length > 1

  // Hours from clock entries — actual time worked regardless of whether production was logged
  const myHoursWeek = (data.clockEntries ?? [])
    .filter((ce) => {
      const d = ce.clockIn.slice(0, 10)
      return ce.employeeId === activeEmployee.id && d >= wStart && d <= wEnd && !!ce.clockOut
    })
    .reduce((s, ce) => s + (new Date(ce.clockOut!).getTime() - new Date(ce.clockIn).getTime()) / 3_600_000, 0)

  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

  const initials = activeEmployee.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div>
      <PageHeader
        title={`Hey, ${activeEmployee.name.split(' ')[0]}!`}
        description={todayLabel}
        action={
          <button
            onClick={() => setActiveEmployee(null)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700"
          >
            Switch employee
          </button>
        }
      />

      {/* Tabs — everything an In-House user needs lives here instead of in
          the sidebar: My Projects/Field Map/Materials are embedded below
          rather than routed to, so there's nothing to navigate away from. */}
      <div className="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {FIELD_DASHBOARD_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              tab === t.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'projects'  && <Projects />}
      {tab === 'map'       && <KmzProduction />}
      {tab === 'materials' && <Materials />}

      {tab === 'overview' && (
      <>
      {/* Redline QA/QC footage summary — same "Pending/Approved/Rejected"
          treatment the Subcontractor Dashboard shows, scoped to this
          employee's own submitted redlines. Footage, not dollars — what gets
          billed to the customer isn't an in-house employee's business. */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-gradient-to-br from-amber-600 to-amber-700 p-5 text-white shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-100">Pending Footage</p>
          <p className="mt-0.5 text-3xl font-extrabold tracking-tight">{number(myPendingFootage)} ft</p>
          <p className="mt-1 text-xs text-amber-100">
            Not finalized yet{myPendingOther.size > 0 && <> · +{formatOtherUnits(myPendingOther)}</>}
          </p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-700 p-5 text-white shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-100">Approved Footage</p>
          <p className="mt-0.5 text-3xl font-extrabold tracking-tight">{number(myApprovedFootage)} ft</p>
          <p className="mt-1 text-xs text-emerald-100">
            Finalized{myApprovedOther.size > 0 && <> · +{formatOtherUnits(myApprovedOther)}</>}
          </p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-red-700 to-red-800 p-5 text-white shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-red-100">Rejected Footage</p>
          <p className="mt-0.5 text-3xl font-extrabold tracking-tight">{number(myRejectedFootage)} ft</p>
          <p className="mt-1 text-xs text-red-100">
            Needs correction{myRejectedOther.size > 0 && <> · +{formatOtherUnits(myRejectedOther)}</>}
          </p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="mb-6 grid grid-cols-2 gap-3">
        <Link
          to="/clock-in"
          className="flex flex-col items-center gap-2 rounded-2xl bg-brand-600 px-4 py-5 text-white shadow-sm transition hover:opacity-90 active:scale-95"
        >
          <Clock size={24} />
          <span className="text-center text-sm font-semibold leading-tight">Time Clock</span>
        </Link>
        <button
          onClick={() => setTab('materials')}
          className="flex flex-col items-center gap-2 rounded-2xl bg-purple-600 px-4 py-5 text-white shadow-sm transition hover:opacity-90 active:scale-95"
        >
          <Package size={24} />
          <span className="text-center text-sm font-semibold leading-tight">Check Out Material</span>
        </button>
      </div>

      {/* Corrections Needed — redlines an admin rejected on this employee's work */}
      {correctionsNeeded.length > 0 && (
        <Card className="mb-6 border-red-800/40">
          <CardHeader
            title={
              <span className="flex items-center gap-1.5 text-red-600">
                <AlertOctagon size={15} /> Corrections Needed ({correctionsNeeded.length})
              </span>
            }
            subtitle="Rejected redline items waiting on you to fix and resubmit."
          />
          <CardBody className="space-y-3">
            {correctionsNeeded.map(({ billing, markup, project }) => {
              const workDate = billing.date ?? markup.workDate ?? markup.createdAt?.slice(0, 10) ?? null
              return (
              <div key={billing.id} className="rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {billing.rateCode ? <span className="text-red-600 mr-1">{billing.rateCode}</span> : null}
                      {billing.description}
                    </p>
                    <p className="text-xs text-slate-500">
                      {project?.name ?? 'Unknown project'}
                      {workDate && <> · work done {formatDateShort(workDate)}</>}
                    </p>
                    {billing.qaRejectionNote && (
                      <p className="mt-1.5 text-xs text-red-700"><b>Rejection note:</b> {billing.qaRejectionNote}</p>
                    )}
                  </div>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    onClick={() => openOnMap(markup.projectId, markup.id)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Open on Map
                  </button>
                  {fixingId !== billing.id ? (
                    <button
                      onClick={() => { setFixingId(billing.id); setFixNote('') }}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      <CheckCircle2 size={13} /> Mark Rejection Fixed
                    </button>
                  ) : (
                    <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row">
                      <input
                        autoFocus
                        value={fixNote}
                        onChange={(e) => setFixNote(e.target.value)}
                        placeholder="What did you fix? (optional)"
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-emerald-500"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => confirmFix(billing.id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                          Confirm
                        </button>
                        <button onClick={() => setFixingId(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              )
            })}
          </CardBody>
        </Card>
      )}

      {/* Today's status + crew info */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">

        {/* Clock status */}
        <Card>
          <CardBody>
            <div className="flex items-center gap-4">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${activeClock ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                <Clock size={22} className={activeClock ? 'text-emerald-600' : 'text-slate-400'} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Today's Clock</p>
                {activeClock ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                      <p className="font-semibold text-emerald-700">Clocked In</p>
                    </div>
                    <p className="text-xs text-slate-500">
                      Since {fmt(activeClock.clockIn)} · {clockedHoursToday.toFixed(1)} h running
                    </p>
                  </>
                ) : todayClock.length > 0 ? (
                  <>
                    <p className="font-semibold text-slate-700">Clocked Out</p>
                    <p className="text-xs text-slate-500">
                      {totalHoursToday.toFixed(1)} h today ·{' '}
                      {todayClock.map((ce) => `${fmt(ce.clockIn)}–${ce.clockOut ? fmt(ce.clockOut) : '?'}`).join(', ')}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-slate-500">Not clocked in yet</p>
                    <Link to="/clock-in" className="text-xs font-medium text-brand-600 hover:underline">
                      Clock in now →
                    </Link>
                  </>
                )}
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Crew & project info */}
        <Card>
          <CardBody>
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-100">
                <Users size={22} className="text-brand-600" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {myCrews.length > 1 ? 'My Crews' : 'My Crew'}
                </p>
                {primaryCrew ? (
                  <>
                    <p className="truncate font-semibold text-slate-800">
                      {myCrews.length > 1 ? myCrews.map((c) => c.name).join(', ') : primaryCrew.name}
                    </p>
                    {myProject ? (
                      <Link to={`/projects/${myProject.id}`} className="truncate text-xs font-medium text-brand-600 hover:underline">
                        {myProject.name} →
                      </Link>
                    ) : (
                      <p className="text-xs text-slate-400">No active project assigned</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-slate-400">Not assigned to a crew</p>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Personal stats this week */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          { label: 'My Hours (week)',   value: myHoursWeek > 0     ? `${myHoursWeek.toFixed(1)} h`    : '—', tone: 'neutral' as const },
          { label: 'Crew Footage (wk)', value: crewFootageWeek > 0 ? `${number(crewFootageWeek)} ft`  : '—', tone: 'blue'    as const },
        ].map(({ label, value, tone }) => (
          <BigMetric key={label} label={label} value={value} tone={tone} />
        ))}
      </div>

      {/* This week's production across all crews */}
      {myCrews.length > 0 ? (
        <Card className="overflow-hidden">
          <CardHeader
            title="Production This Week"
            subtitle={myCrews.map((c) => c.name).join(' · ')}
          />
          <CardBody className="p-0">
            {weekProduction.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-400">
                No production logged this week yet.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-2.5 font-medium">Date</th>
                    <th className="px-5 py-2.5 font-medium">Project</th>
                    {showCrewCol && <th className="px-5 py-2.5 font-medium">Crew</th>}
                    <th className="px-5 py-2.5 text-right font-medium">Footage</th>
                    <th className="px-5 py-2.5 text-right font-medium">Hours</th>
                    <th className="px-5 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {weekProduction.map((p) => {
                    const proj = data.projects.find((pr) => pr.id === p.projectId)
                    const crew = showCrewCol ? data.crews.find((c) => c.id === p.crewId) : null
                    const status = worstQaStatus(p.lineItems)
                    return (
                      <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="px-5 py-2.5 text-slate-600">
                          {new Date(p.date + 'T00:00:00').toLocaleDateString('en-US', {
                            weekday: 'short', month: 'short', day: 'numeric',
                          })}
                        </td>
                        <td className="px-5 py-2.5 text-slate-600">{proj?.name ?? '—'}</td>
                        {showCrewCol && <td className="px-5 py-2.5 text-xs text-slate-400">{crew?.name ?? '—'}</td>}
                        <td className="px-5 py-2.5 text-right font-semibold text-slate-700">{p.footageLabel}</td>
                        <td className="px-5 py-2.5 text-right text-slate-600">{p.hours.toFixed(1)} h</td>
                        <td className="px-5 py-2.5"><QaStatusBadge status={status} /></td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-100 bg-slate-50/60">
                    <td colSpan={showCrewCol ? 3 : 2} className="px-5 py-2 text-right text-xs font-semibold text-slate-400">
                      Week total
                    </td>
                    <td className="px-5 py-2 text-right font-bold text-brand-700">{number(crewFootageWeek)} ft</td>
                    <td className="px-5 py-2 text-right font-bold text-slate-700">{crewHoursWeek.toFixed(1)} h</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                <span className="text-base font-bold text-slate-400">{initials}</span>
              </div>
              <p className="text-sm text-slate-500">
                {activeEmployee.name} isn't assigned to a crew yet. Contact your foreman or admin.
              </p>
            </div>
          </CardBody>
        </Card>
      )}
      </>
      )}

    </div>
  )
}

// ── Command-center metric card ────────────────────────────────────────────────
function CmdCard({
  label, value, sub, icon: Icon, tone = 'gold',
}: {
  label: string; value: string; sub?: string; icon: React.ElementType
  tone?: 'gold' | 'green' | 'red' | 'blue'
}) {
  const iconBg = { gold: 'bg-brand-100', green: 'bg-emerald-100', red: 'bg-rose-100', blue: 'bg-cyan-100' }[tone]
  const iconColor = { gold: 'text-brand-700', green: 'text-emerald-700', red: 'text-rose-700', blue: 'text-cyan-700' }[tone]
  const valColor = { gold: 'text-slate-900', green: 'text-emerald-700', red: 'text-rose-700', blue: 'text-cyan-700' }[tone]
  return (
    <div className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
        <Icon size={20} className={iconColor} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
        <p className={`mt-0.5 text-2xl font-extrabold tracking-tight ${valColor}`}>{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
      </div>
    </div>
  )
}

// ── Subcontractor dashboard (test-phase UI simulation — see RoleContext's
// AppRole doc comment; not a real per-company security boundary yet) ───────

function SubcontractorPicker({ onSelect, subcontractors }: { onSelect: (id: string) => void; subcontractors: Subcontractor[] }) {
  const sorted = [...subcontractors].sort((a, b) => a.companyName.localeCompare(b.companyName))
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-600">
          <Building2 size={28} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Which company are you?</h2>
        <p className="mt-1 text-sm text-slate-500">Select your company to see its dashboard</p>
      </div>
      <div className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        {sorted.map((sub) => (
          <button
            key={sub.id}
            onClick={() => onSelect(sub.id)}
            className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-amber-400 hover:shadow-md active:scale-[0.98]"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">
              {sub.companyName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-slate-900">{sub.companyName}</p>
              {sub.contactName && <p className="text-xs text-slate-500">{sub.contactName}</p>}
            </div>
          </button>
        ))}
        {sorted.length === 0 && (
          <p className="col-span-2 text-center text-sm text-slate-500">
            No subcontractors yet. An admin can add one from the Subcontractors page.
          </p>
        )}
      </div>
    </div>
  )
}

type SubcontractorDashboardTab = 'overview' | 'map'
const SUBCONTRACTOR_DASHBOARD_TABS: { key: SubcontractorDashboardTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'map',      label: 'Field Map' },
]

function SubcontractorDashboard() {
  const { data, markRejectionFixedQa, addFiberTapReport, deleteFiberTapReport, deleteSpliceEnclosure } = useData()
  const { activeSubcontractorId, setActiveSubcontractor } = useRole()
  const nav = useNavigate()
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [fixNote, setFixNote] = useState('')
  const [tab, setTab] = useState<SubcontractorDashboardTab>('overview')
  const [openTapReportId, setOpenTapReportId] = useState<string | null>(null)
  const [newReportProjectId, setNewReportProjectId] = useState<string | null>(null)
  const [editingTapTemplate, setEditingTapTemplate] = useState(false)
  const fiberTapTemplate = (data.spliceReportTemplates ?? []).find((t) => t.kind === 'fiberTap')
  const [editingSpliceEnclosureTemplate, setEditingSpliceEnclosureTemplate] = useState(false)
  const spliceEnclosureTemplate = (data.spliceReportTemplates ?? []).find((t) => t.kind === 'spliceEnclosure')
  const [newSpliceProjectId, setNewSpliceProjectId] = useState<string | null>(null)
  const [newSplicePdfId, setNewSplicePdfId] = useState('')

  // Auto-detect which print(s) this subcontractor is actually allowed to see
  // for the picked project — same visibility rule the Field Map itself uses
  // (isPrintHiddenFromSession: a subcontractor only ever sees prints
  // assigned to them, never anyone else's or the unassigned/uncut master).
  // Exactly one match means there's nothing to ask — pick it automatically.
  useEffect(() => {
    if (newSpliceProjectId == null || !activeSubcontractorId) return
    const visible = (data.projectFiles ?? []).filter((f) =>
      f.projectId === newSpliceProjectId && f.fileType === 'pdf'
      && !isPrintHiddenFromSession(f, data.mapCutPackages ?? [], 'subcontractor', activeSubcontractorId, new Set()),
    )
    setNewSplicePdfId(visible.length === 1 ? visible[0].id : '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newSpliceProjectId])

  const activeSub = activeSubcontractorId
    ? (data.subcontractors ?? []).find((s) => s.id === activeSubcontractorId) ?? null
    : null

  if (!activeSub) {
    return (
      <div>
        <PageHeader title="Subcontractor Dashboard" description="Test-phase view — not a real secured login yet." />
        <SubcontractorPicker onSelect={setActiveSubcontractor} subcontractors={(data.subcontractors ?? []).filter((s) => s.active)} />
      </div>
    )
  }

  // Every billing line this subcontractor has ever submitted, joined with its
  // markup/project — same shared selector the /qa-review page and P&L QA
  // cards use, so this dashboard can never disagree with those about what's
  // pending/approved/rejected for this company.
  const myRows = applyQaFilters(buildQaReviewRows(data), { ...EMPTY_QA_FILTERS, subcontractorId: activeSub.id })
    .sort((a, b) => (b.markup.createdAt ?? '').localeCompare(a.markup.createdAt ?? ''))

  // "Your Projects" = explicitly assigned (via the Project page's Subcontractor
  // Assignment section — visible immediately, even with zero submitted work
  // yet) UNION projects with a print/phase assigned to them (covers an admin
  // who assigned a phase from the Project Files table but never separately
  // checked the explicit assignment box — see projectAssignedToSubcontractor's
  // doc comment) UNION projects they've actually submitted work on (covers a
  // subcontractor who was never formally assigned but has work on record).
  const myProjectIds = new Set([
    ...data.projects.filter((p) => (p.subcontractorIds ?? []).includes(activeSub.id)
      || projectAssignedToSubcontractor(p.id, activeSub.id, data.projectFiles ?? [], data.mapCutPackages ?? [])).map((p) => p.id),
    ...myRows.map((r) => r.markup.projectId),
  ])
  const myProjects = data.projects.filter((p) => myProjectIds.has(p.id))

  const rejected = myRows.filter((r) => r.billing.qaStatus === 'rejected')
  const pendingCount = myRows.filter((r) => r.billing.qaStatus === 'pending_review' || r.billing.qaStatus === 'rejection_fixed').length
  const approvedCount = myRows.filter((r) => r.billing.qaStatus === 'approved' || r.billing.qaStatus === 'approved_after_correction').length

  // computeQaRevenueBreakdown returns the raw customer billing revenue — the
  // same figure admin-facing P&L cards use. A subcontractor must never see
  // that number; they see their OWN pay, computed by applying their rate
  // card percentage. No percentage configured yet ⇒ show nothing rather than
  // guess 100% (which would leak the full customer rate as their "pay").
  const earnings = computeQaRevenueBreakdown(data, { ...EMPTY_QA_FILTERS, subcontractorId: activeSub.id })
  const payFactor = activeSub.payRatePercent != null ? activeSub.payRatePercent / 100 : null
  const pendingPay = payFactor != null ? (earnings.pendingReviewRevenue + earnings.revenueWaitingOnCorrections) * payFactor : null
  const approvedPay = payFactor != null ? earnings.finalApprovedRevenue * payFactor : null
  const rejectedPay = payFactor != null ? earnings.rejectedRevenue * payFactor : null

  const myEmployees = (data.employees ?? []).filter((e) => e.subcontractorId === activeSub.id)

  const myNotifications = (data.notifications ?? [])
    .filter((n) => n.recipientSubcontractorId === activeSub.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5)

  // Production This Week — same table the In-House/Supervisor dashboards
  // show, so a subcontractor can see their own crew's placed footage and QA
  // status at a glance, same as everyone else. Footage/status only, no cost
  // or billing figures (matches this dashboard's existing no-revenue rule).
  const subToday  = localDateStr()
  const subWStart = weekStart(subToday)
  const subWEnd   = weekEnd(subToday)
  const subProduction = data.production
    .filter((p) => p.subcontractorId === activeSub.id && p.date >= subWStart && p.date <= subWEnd)
    .map((p) => {
      const lineItems = data.productionLineItems.filter((li) => li.productionEntryId === p.id)
      return {
        ...p,
        displayFootage: entryDisplayFootage(p, lineItems),
        footageLabel: entryFootageLabel(p, lineItems),
        status: worstQaStatus(lineItems),
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
  const subFootageWeek = subProduction.reduce((s, p) => s + p.displayFootage, 0)

  function openOnMap(projectId: string, markupId: string) {
    const markup = (data.fieldMarkups ?? []).find((m) => m.id === markupId)
    const target = markup ? redlineMapTarget(markup) : { pathname: `/kmz/${projectId}`, state: { focusMarkupId: markupId } }
    nav(target.pathname, { state: target.state })
  }

  function confirmFix(billingId: string) {
    markRejectionFixedQa(billingId, `subcontractor:${activeSub!.id}`, fixNote.trim() || undefined)
    setFixingId(null); setFixNote('')
  }

  return (
    <div>
      <PageHeader
        title={`Hey, ${activeSub.companyName}!`}
        description="Test-phase view — not a real secured login yet."
        action={
          <button
            onClick={() => setActiveSubcontractor(null)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700"
          >
            Switch company
          </button>
        }
      />

      {/* Tabs — Field Map is embedded below rather than routed to, matching
          the In-House Dashboard's pattern. */}
      <div className="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {SUBCONTRACTOR_DASHBOARD_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              tab === t.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'map' && <KmzProduction />}

      {tab === 'overview' && (
      <>
      {/* Earnings */}
      {payFactor == null && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertOctagon size={13} className="shrink-0" />
          No pay rate has been configured for your company yet — an admin needs to set one before earnings can show here.
        </div>
      )}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-gradient-to-br from-amber-600 to-amber-700 p-5 text-white shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-100">Pending Earnings</p>
          <p className="mt-0.5 text-3xl font-extrabold tracking-tight">{pendingPay != null ? money(pendingPay) : '—'}</p>
          <p className="mt-1 text-xs text-amber-100">Not finalized yet</p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-700 p-5 text-white shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-100">Approved Earnings</p>
          <p className="mt-0.5 text-3xl font-extrabold tracking-tight">{approvedPay != null ? money(approvedPay) : '—'}</p>
          <p className="mt-1 text-xs text-emerald-100">Finalized</p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-red-700 to-red-800 p-5 text-white shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-red-100">Rejected Production</p>
          <p className="mt-0.5 text-3xl font-extrabold tracking-tight">{rejectedPay != null ? money(rejectedPay) : '—'}</p>
          <p className="mt-1 text-xs text-red-100">Needs correction</p>
        </div>
      </div>

      {/* Corrections Needed */}
      {rejected.length > 0 && (
        <Card className="mb-6 border-red-800/40">
          <CardHeader
            title={
              <span className="flex items-center gap-1.5 text-red-600">
                <AlertOctagon size={15} /> Corrections Needed ({rejected.length})
              </span>
            }
            subtitle="Rejected redline items waiting on you to fix and resubmit."
          />
          <CardBody className="space-y-3">
            {rejected.map(({ billing, markup, project }) => {
              const workDate = billing.date ?? markup.workDate ?? markup.createdAt?.slice(0, 10) ?? null
              return (
              <div key={billing.id} className="rounded-lg border border-red-200 bg-red-50 p-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {billing.rateCode ? <span className="text-red-600 mr-1">{billing.rateCode}</span> : null}
                    {billing.description}
                  </p>
                  <p className="text-xs text-slate-500">
                    {project?.name ?? 'Unknown project'}
                    {workDate && <> · work done {formatDateShort(workDate)}</>}
                  </p>
                  {billing.qaRejectionNote && (
                    <p className="mt-1.5 text-xs text-red-700"><b>Rejection note:</b> {billing.qaRejectionNote}</p>
                  )}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    onClick={() => openOnMap(markup.projectId, markup.id)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Open on Map
                  </button>
                  {fixingId !== billing.id ? (
                    <button
                      onClick={() => { setFixingId(billing.id); setFixNote('') }}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      <CheckCircle2 size={13} /> Mark Rejection Fixed
                    </button>
                  ) : (
                    <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row">
                      <input
                        autoFocus
                        value={fixNote}
                        onChange={(e) => setFixNote(e.target.value)}
                        placeholder="What did you fix? (optional)"
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-emerald-500"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => confirmFix(billing.id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                          Confirm
                        </button>
                        <button onClick={() => setFixingId(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              )
            })}
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Assigned Projects */}
        <Card>
          <CardHeader title="Your Projects" subtitle={`${myProjects.length} assigned project${myProjects.length === 1 ? '' : 's'}`} />
          <CardBody className="space-y-2">
            {myProjects.length === 0 && <p className="text-sm text-slate-500">No projects assigned yet.</p>}
            {myProjects.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-800">{p.name}</p>
                  <p className="text-xs text-slate-500">{p.location}</p>
                </div>
                <Link to={`/kmz/${p.id}`} className="text-xs font-medium text-amber-700 hover:text-amber-600">Open Map →</Link>
              </div>
            ))}
          </CardBody>
        </Card>

        {/* Submitted Redlines summary */}
        <Card>
          <CardHeader title="Your Submitted Work" subtitle={`${myRows.length} item${myRows.length === 1 ? '' : 's'} total`} />
          <CardBody>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
                <p className="text-xs text-slate-500">Pending</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-600">{approvedCount}</p>
                <p className="text-xs text-slate-500">Approved</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600">{rejected.length}</p>
                <p className="text-xs text-slate-500">Rejected</p>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Your Employees */}
        <Card>
          <CardHeader title="Your Employees" subtitle={`${myEmployees.length} on your crew`} />
          <CardBody className="space-y-1.5">
            {myEmployees.length === 0 && <p className="text-sm text-slate-500">No employees added yet.</p>}
            {myEmployees.map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-sm text-slate-800">{e.name}</p>
                <p className="text-xs text-slate-500">{e.role}</p>
              </div>
            ))}
          </CardBody>
        </Card>

        {/* Recent Notifications */}
        <Card>
          <CardHeader title="Recent Notifications" />
          <CardBody className="space-y-1.5">
            {myNotifications.length === 0 && <p className="text-sm text-slate-500">No notifications yet.</p>}
            {myNotifications.map((n) => (
              <div key={n.id} className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-sm text-slate-800">{n.title}</p>
                <p className="text-xs text-slate-500">{n.meta.projectName} · {new Date(n.createdAt).toLocaleString()}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      {/* Production This Week — same table In-House/Supervisor dashboards
          show, with QA status per row so it's clear at a glance what's
          approved, rejected, or still waiting. */}
      <Card className="mt-4">
        <CardHeader title="Production This Week" subtitle={activeSub.companyName} />
        <CardBody className="p-0">
          {subProduction.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-400">
              No production logged this week yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Project</th>
                  <th className="px-5 py-2.5 text-right font-medium">Footage</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {subProduction.map((p) => {
                  const proj = data.projects.find((pr) => pr.id === p.projectId)
                  return (
                    <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-5 py-2.5 text-slate-600">
                        {new Date(p.date + 'T00:00:00').toLocaleDateString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric',
                        })}
                      </td>
                      <td className="px-5 py-2.5 text-slate-600">{proj?.name ?? '—'}</td>
                      <td className="px-5 py-2.5 text-right font-semibold text-slate-700">{p.footageLabel}</td>
                      <td className="px-5 py-2.5"><QaStatusBadge status={p.status} /></td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-100 bg-slate-50/60">
                  <td colSpan={2} className="px-5 py-2 text-right text-xs font-semibold text-slate-400">Week total</td>
                  <td className="px-5 py-2 text-right font-bold text-brand-700">{number(subFootageWeek)} ft</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </CardBody>
      </Card>

      {/* Splice Enclosure Sheet Template — configuring the mapping doesn't
          require an actual enclosure yet, so it's surfaced here up front
          rather than only inside a specific enclosure's Field Map panel
          (WorkObjectPropertiesPanel), which was hard to find before an
          enclosure existed. Actual splice records are still captured from
          the Field Map's Add Work wizard (SpliceEnclosureForm) — this card
          only manages the template + downloads the accumulated workbook. */}
      <Card className="mt-4">
        <CardHeader
          title="Splice Enclosure Sheet Template"
          subtitle="Job Number, Splice ID, Span IDs, fiber matrix, photos — the per-enclosure splice report"
          action={
            <div className="flex items-center gap-2">
              {spliceEnclosureTemplate?.hasMasterWorkbook && (
                <button
                  onClick={() => downloadMasterWorkbook(spliceEnclosureTemplate)}
                  title="Every splice enclosure saved so far, each in its own tab"
                  className="text-xs font-medium text-slate-500 hover:text-slate-800"
                >
                  Download Master Workbook
                </button>
              )}
              <button
                onClick={() => setEditingSpliceEnclosureTemplate(true)}
                className="text-xs font-medium text-slate-500 hover:text-slate-800"
              >
                {spliceEnclosureTemplate ? 'Edit Template' : 'Upload My Template'}
              </button>
              {newSpliceProjectId === null && (
                <button
                  onClick={() => setNewSpliceProjectId(myProjects[0]?.id ?? '')}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  + New Report
                </button>
              )}
            </div>
          }
        />
        <CardBody>
          {newSpliceProjectId !== null ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-56">
                <Field label="Project">
                  <Select
                    value={newSpliceProjectId}
                    onChange={(e) => { setNewSpliceProjectId(e.target.value); setNewSplicePdfId('') }}
                  >
                    {myProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </Field>
              </div>
              {(() => {
                // Only prints assigned to THIS subcontractor (or, for an
                // unphased project with no assignment at all, none — a
                // subcontractor session never sees an unassigned/master
                // print, matching Field Map's own visibility rule).
                const visiblePdfs = (data.projectFiles ?? []).filter((f) =>
                  f.projectId === newSpliceProjectId && f.fileType === 'pdf'
                  && !isPrintHiddenFromSession(f, data.mapCutPackages ?? [], 'subcontractor', activeSub.id, new Set()),
                )
                if (visiblePdfs.length === 0) {
                  return <p className="text-xs text-slate-400">No print is assigned to you for this project — this will use the raw map.</p>
                }
                if (visiblePdfs.length === 1) {
                  return <p className="text-xs text-slate-400">Using your assigned print: <span className="font-medium text-slate-600">{visiblePdfs[0].name}</span></p>
                }
                return (
                  <div className="w-64">
                    <Field label="Which of your prints?">
                      <Select value={newSplicePdfId} onChange={(e) => setNewSplicePdfId(e.target.value)}>
                        <option value="">— Use the raw map —</option>
                        {visiblePdfs.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </Select>
                    </Field>
                  </div>
                )
              })()}
              <button
                onClick={() => nav(
                  newSplicePdfId ? `/kmz/${newSpliceProjectId}/print/${newSplicePdfId}` : `/kmz/${newSpliceProjectId}`,
                  { state: { startAddWork: 'splicing' } },
                )}
                disabled={!newSpliceProjectId}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Continue on Field Map
              </button>
              <button onClick={() => { setNewSpliceProjectId(null); setNewSplicePdfId('') }} className="text-xs text-slate-500 hover:text-slate-800">Cancel</button>
              <p className="w-full text-xs text-slate-400">
                A splice enclosure still needs a real spot to drop the pin — you'll only ever see prints assigned
                to you, never another subcontractor's.
              </p>
            </div>
          ) : spliceEnclosureTemplate ? (
            <p className="text-sm text-slate-500">
              Using <span className="font-medium text-slate-700">{spliceEnclosureTemplate.fileName}</span>
              {' '}(sheet "{spliceEnclosureTemplate.sheetName}"). Click "+ New Report" to start one, or "Edit
              Template" to change the mapping.
            </p>
          ) : (
            <p className="text-sm text-slate-500">
              Upload your splicing paperwork (.xlsx) once and tell Fiberlytic which cell each field goes in.
              Every splice enclosure you complete on the Field Map will then auto-populate into it — you'll never
              need to open Excel yourself.
            </p>
          )}

          {/* Every splice enclosure this subcontractor has worked on, so they
              can review/re-open/export one without hunting for it on the
              Field Map — same "list of my records" pattern as Fiber Tap
              Reports below, joined through the linked FieldMarkup since
              SpliceEnclosure itself has no direct subcontractor ownership
              field (see FieldMarkup.assignedSubcontractorId). */}
          {(() => {
            const mySpliceEnclosures = (data.spliceEnclosures ?? []).filter((e) => {
              const m = data.fieldMarkups.find((mk) => mk.id === e.markupId)
              return m?.assignedSubcontractorId === activeSub.id
            })
            return (
              <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3">
                {mySpliceEnclosures.length === 0 && (
                  <p className="text-sm text-slate-500">No splice enclosure reports yet.</p>
                )}
                {mySpliceEnclosures.map((e) => {
                  const m = data.fieldMarkups.find((mk) => mk.id === e.markupId)
                  const proj = data.projects.find((p) => p.id === e.projectId)
                  const reviewPath = m?.coordSpace === 'pdfPage' && m.sourceProjectFileId
                    ? `/kmz/${e.projectId}/print/${m.sourceProjectFileId}`
                    : `/kmz/${e.projectId}`
                  return (
                    <div key={e.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {e.spliceId || e.jobName || 'Untitled enclosure'} — {proj?.name ?? 'Unknown project'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {e.spans.length} span{e.spans.length === 1 ? '' : 's'} · {e.trayCount} tray{e.trayCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {spliceEnclosureTemplate && m && (
                          <button
                            onClick={() => exportSpliceEnclosureWithTemplate(spliceEnclosureTemplate, e, m, data.markupPhotos ?? [])}
                            className="text-xs font-medium text-slate-500 hover:text-slate-800"
                          >
                            Export .xlsx
                          </button>
                        )}
                        <button
                          onClick={() => nav(reviewPath, { state: { focusMarkupId: e.markupId } })}
                          className="text-xs font-medium text-amber-700 hover:text-amber-600"
                        >
                          Review / Edit →
                        </button>
                        <button
                          title="Delete splice detail"
                          onClick={() => {
                            if (window.confirm('Delete this splice enclosure\'s detail (header fields, spans, NOC report)? The map redline itself is not affected.')) {
                              deleteSpliceEnclosure(e.id)
                            }
                          }}
                          className="text-slate-400 hover:text-red-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </CardBody>
      </Card>

      {/* Fiber Tap Reports — separate from the splice-enclosure sheets
          captured on the Field Map (a node's taps aren't 1:1 with any single
          enclosure), so this gets its own standalone capture surface. */}
      <Card className="mt-4">
        <CardHeader
          title="Fiber Tap Reports"
          subtitle={`${(data.fiberTapReports ?? []).filter((r) => r.createdBySubcontractorId === activeSub.id).length} report(s)`}
          action={
            !openTapReportId && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingTapTemplate(true)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800"
                >
                  {fiberTapTemplate ? 'Edit Template' : 'Upload My Template'}
                </button>
                <button
                  onClick={() => setNewReportProjectId(myProjects[0]?.id ?? null)}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  + New Report
                </button>
              </div>
            )
          }
        />
        <CardBody>
          {openTapReportId ? (
            <FiberTapReportForm
              reportId={openTapReportId}
              uploaderName={activeSub.companyName}
              onClose={() => setOpenTapReportId(null)}
            />
          ) : newReportProjectId !== null ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-56">
                <Field label="Project">
                  <Select value={newReportProjectId} onChange={(e) => setNewReportProjectId(e.target.value)}>
                    {myProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </Field>
              </div>
              <button
                onClick={() => {
                  const id = addFiberTapReport({
                    projectId: newReportProjectId, prismId: '', nodeNumber: '', nodeLocation: '',
                    contractorCompany: activeSub.companyName, splicerName: '', opticalSourceLabel: '',
                    opticalPowerDbm: null, wavelengthNm: null, taps: [], createdBySubcontractorId: activeSub.id,
                  })
                  setNewReportProjectId(null)
                  setOpenTapReportId(id)
                }}
                disabled={!newReportProjectId}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Create
              </button>
              <button onClick={() => setNewReportProjectId(null)} className="text-xs text-slate-500 hover:text-slate-800">Cancel</button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {(data.fiberTapReports ?? []).filter((r) => r.createdBySubcontractorId === activeSub.id).length === 0 && (
                <p className="text-sm text-slate-500">No fiber tap reports yet.</p>
              )}
              {(data.fiberTapReports ?? []).filter((r) => r.createdBySubcontractorId === activeSub.id).map((r) => {
                const proj = data.projects.find((p) => p.id === r.projectId)
                return (
                  <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{r.nodeNumber || 'Untitled node'} — {proj?.name ?? 'Unknown project'}</p>
                      <p className="text-xs text-slate-500">{r.taps.length} tap{r.taps.length === 1 ? '' : 's'}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => exportFiberTapReportExcel(r)} className="text-xs font-medium text-slate-500 hover:text-slate-800">Export .xlsx</button>
                      {fiberTapTemplate && (
                        <button onClick={() => exportFiberTapReportWithTemplate(fiberTapTemplate, r)} className="text-xs font-medium text-amber-700 hover:text-amber-600">Export via Template</button>
                      )}
                      <button onClick={() => setOpenTapReportId(r.id)} className="text-xs font-medium text-amber-700 hover:text-amber-600">Open →</button>
                      <button
                        title="Delete report"
                        onClick={() => {
                          if (window.confirm(`Delete the fiber tap report for ${r.nodeNumber || 'this node'}? This cannot be undone.`)) {
                            deleteFiberTapReport(r.id)
                          }
                        }}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>
      </>
      )}
      {editingTapTemplate && <SpliceTemplateModal kind="fiberTap" onClose={() => setEditingTapTemplate(false)} />}
      {editingSpliceEnclosureTemplate && <SpliceTemplateModal kind="spliceEnclosure" onClose={() => setEditingSpliceEnclosureTemplate(false)} />}
    </div>
  )
}

type SupervisorDashboardTab = 'overview' | 'projects' | 'map' | 'qa' | 'materials'
const SUPERVISOR_DASHBOARD_TABS: { key: SupervisorDashboardTab; label: string }[] = [
  { key: 'overview',  label: 'Overview' },
  { key: 'projects',  label: 'My Projects' },
  { key: 'map',       label: 'Field Map' },
  { key: 'qa',        label: 'QA/QC Review' },
  { key: 'materials', label: 'Materials' },
]

function SupervisorDashboard() {
  const { data } = useData()
  const { activeSupervisorEmployeeId, setActiveSupervisorEmployee } = useRole()
  const nav = useNavigate()
  const [tab, setTab] = useState<SupervisorDashboardTab>('overview')

  const activeEmployee = activeSupervisorEmployeeId
    ? data.employees.find((e) => e.id === activeSupervisorEmployeeId) ?? null
    : null

  // A supervisor is just an Employee overseeing jobs, but this role keeps
  // its OWN identity selection (activeSupervisorEmployeeId) rather than
  // reusing In-House view's activeEmployeeId — sharing one meant switching
  // from In-House (where you'd picked, say, yourself as a crew member)
  // straight to Supervisor view silently carried that identity over instead
  // of asking again, landing on the wrong person's dashboard with no
  // projects and no obvious explanation why. Narrowed to
  // Employees.isSupervisor-flagged people (set in the Employees tab) rather
  // than every active employee, so this picker only lists people actually
  // meant to use this view.
  const supervisors = data.employees.filter((e) => e.active && e.isSupervisor)

  if (!activeEmployee) {
    return (
      <div>
        <PageHeader title="Supervisor Dashboard" description="Test-phase view — not a real secured login yet." />
        {supervisors.length === 0 ? (
          <p className="mt-6 text-center text-sm text-slate-500">
            No employees are marked as a supervisor yet — check "Supervisor" on someone in the Employees tab first.
          </p>
        ) : (
          <EmployeePicker onSelect={setActiveSupervisorEmployee} employees={supervisors} />
        )}
      </div>
    )
  }

  const myProjects = data.projects.filter((p) => p.supervisorId === activeEmployee.id)
  const myProjectIds = new Set(myProjects.map((p) => p.id))

  // Recent (last 14 days) production on any of the supervisor's projects —
  // footage/crew/date/status only, deliberately no revenue/cost figure
  // anywhere on this dashboard (see the per-row render below).
  const recentProduction = withinDays(data.production, 14)
    .filter((e) => myProjectIds.has(e.projectId))
    .map((e) => {
      const lineItems = data.productionLineItems.filter((li) => li.productionEntryId === e.id)
      return {
        ...e,
        displayFootage: entryDisplayFootage(e, lineItems),
        footageLabel: entryFootageLabel(e, lineItems),
        status: worstQaStatus(lineItems),
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  const weekFootageByProject = new Map<string, number>()
  for (const e of withinDays(data.production, 7).filter((e) => myProjectIds.has(e.projectId))) {
    const footage = entryDisplayFootage(e, data.productionLineItems.filter((li) => li.productionEntryId === e.id))
    weekFootageByProject.set(e.projectId, (weekFootageByProject.get(e.projectId) ?? 0) + footage)
  }

  // Redlines waiting on this supervisor's own action — anything submitted on
  // a project they oversee, regardless of which crew or subcontractor did
  // the work. Same shared row-builder /qa-review and the P&L QA cards use,
  // so these counts can never disagree with what's on the QA/QC Review tab.
  const myProjectQaRows = buildQaReviewRows(data).filter((r) => myProjectIds.has(r.markup.projectId))
  const pendingReviewCount = myProjectQaRows.filter((r) => r.billing.qaStatus === 'pending_review' || r.billing.qaStatus === 'rejection_fixed').length
  const rejectedCount = myProjectQaRows.filter((r) => r.billing.qaStatus === 'rejected').length

  // Material lists a crew/subcontractor submitted on a project this
  // supervisor oversees, still waiting on a pickup — surfaced here and in
  // the notification bell so nothing sits unnoticed.
  const pendingMaterialRequestCount = (data.materialRequests ?? [])
    .filter((r) => myProjectIds.has(r.projectId) && r.status === 'pending').length

  function openMap(projectId: string) {
    nav(`/kmz/${projectId}`)
  }

  return (
    <div>
      <PageHeader
        title={`Hey, ${activeEmployee.name}!`}
        description="Test-phase view — not a real secured login yet."
        action={
          <button
            onClick={() => setActiveSupervisorEmployee(null)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700"
          >
            Switch
          </button>
        }
      />

      {/* Tabs — My Projects/Field Map/QA-QC Review are embedded below rather
          than routed to, matching the In-House Dashboard's pattern. */}
      <div className="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {SUPERVISOR_DASHBOARD_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              tab === t.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'projects'  && <Projects />}
      {tab === 'map'       && <KmzProduction />}
      {tab === 'qa'        && <QaReview />}
      {tab === 'materials' && <Materials />}

      {tab === 'overview' && (
      <>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="rounded-2xl bg-gradient-to-br from-cyan-600 to-cyan-700 p-5 text-white shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-100">Projects Overseen</p>
          <p className="mt-0.5 text-3xl font-extrabold tracking-tight">{myProjects.length}</p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-slate-700 to-slate-800 p-5 text-white shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">Footage This Week</p>
          <p className="mt-0.5 text-3xl font-extrabold tracking-tight">{number([...weekFootageByProject.values()].reduce((s, v) => s + v, 0))} LF</p>
        </div>
        <button
          onClick={() => setTab('qa')}
          className="rounded-2xl bg-gradient-to-br from-amber-600 to-amber-700 p-5 text-left text-white shadow-md transition hover:opacity-90"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-100">Pending Review</p>
          <p className="mt-0.5 text-3xl font-extrabold tracking-tight">{pendingReviewCount}</p>
        </button>
        <button
          onClick={() => setTab('qa')}
          className="rounded-2xl bg-gradient-to-br from-red-700 to-red-800 p-5 text-left text-white shadow-md transition hover:opacity-90"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-red-100">Rejected</p>
          <p className="mt-0.5 text-3xl font-extrabold tracking-tight">{rejectedCount}</p>
        </button>
        <button
          onClick={() => setTab('materials')}
          className="rounded-2xl bg-gradient-to-br from-purple-600 to-purple-700 p-5 text-left text-white shadow-md transition hover:opacity-90"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-purple-100">Material Lists</p>
          <p className="mt-0.5 text-3xl font-extrabold tracking-tight">{pendingMaterialRequestCount}</p>
        </button>
      </div>

      <Card className="mb-6">
        <CardHeader title="Your Projects" subtitle={`${myProjects.length} project${myProjects.length === 1 ? '' : 's'} assigned to you`} />
        <CardBody className="space-y-3">
          {myProjects.length === 0 && <p className="text-sm text-slate-500">No projects assigned to you yet — an admin needs to set you as supervisor on a project.</p>}
          {myProjects.map((p) => {
            const pct = projectProgress(p)
            return (
              <div key={p.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                    <p className="text-xs text-slate-500">{p.location}</p>
                  </div>
                  <button onClick={() => openMap(p.id)} className="text-xs font-medium text-amber-700 hover:text-amber-600">Open Field Map →</button>
                </div>
                {p.footageGoal > 0 ? (
                  <div className="mt-3">
                    <div className="mb-1 flex justify-between text-xs text-slate-500">
                      <span>{number(p.footageComplete)} / {number(p.footageGoal)} LF</span>
                      <span className="font-medium text-slate-600">{percent(pct)} complete</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-fiber-500" style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">{number(p.footageComplete)} LF placed · no footage goal set</p>
                )}
                <p className="mt-2 text-xs text-slate-500">{number(weekFootageByProject.get(p.id) ?? 0)} LF placed this week</p>
              </div>
            )
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Production Log" subtitle="Last 14 days across your projects — footage and status only, no cost or billing figures." />
        <CardBody className="p-0">
          {recentProduction.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No production logged on your projects in the last 14 days.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Project</th>
                  <th className="px-5 py-2.5 font-medium">Crew / Sub</th>
                  <th className="px-5 py-2.5 text-right font-medium">Footage</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentProduction.map((e) => (
                  <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-5 py-2.5 whitespace-nowrap text-slate-500">{formatDateShort(e.date)}</td>
                    <td className="px-5 py-2.5 text-slate-600">{data.projects.find((p) => p.id === e.projectId)?.name ?? '—'}</td>
                    <td className="px-5 py-2.5 text-slate-600">{crewOrSubName(data, e.crewId, e.subcontractorId)}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-slate-800">{e.footageLabel}</td>
                    <td className="px-5 py-2.5"><QaStatusBadge status={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      </>
      )}
    </div>
  )
}

// Chart colours
const GOLD   = '#c9920a'
const GOLD2  = '#e8a90e'
const DARK_BAR = '#d4d4d4'
const AXIS   = '#94a3b8'
const TOOLTIP_STYLE = {
  contentStyle: { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, color: '#1e293b', fontSize: 12 },
  cursor: { fill: 'rgba(15,23,42,0.04)' },
}
const PIE_COLORS = [GOLD, '#94a3b8', '#cbd5e1', '#475569']

// ── Admin dashboard ───────────────────────────────────────────────────────────

function AdminDashboard() {
  const { data } = useData()
  const [activeTab] = useState<string>('all')
  const [activeProject, setActiveProject] = useState<string>('all')
  const [activeCrew,    setActiveCrew]   = useState<string>('all')

  const today = localDateStr()

  // Custom date range — defaults to current week (Mon–Sun)
  const [rangeStart, setRangeStart] = useState(() => weekStart(today))
  const [rangeEnd,   setRangeEnd]   = useState(() => weekEnd(today))

  const wStart   = rangeStart
  const wEnd     = rangeEnd
  const weekdays = weekdaysInRange(wStart, wEnd)

  const setPreset = (preset: 'thisWeek' | 'lastWeek' | '2weeks' | '4weeks' | 'thisMonth') => {
    const t = localDateStr()
    if (preset === 'thisWeek') {
      setRangeStart(weekStart(t)); setRangeEnd(weekEnd(t))
    } else if (preset === 'lastWeek') {
      const d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 7)
      const lw = localDateStr(d)
      setRangeStart(weekStart(lw)); setRangeEnd(weekEnd(lw))
    } else if (preset === '2weeks') {
      const d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 7)
      setRangeStart(weekStart(localDateStr(d))); setRangeEnd(weekEnd(t))
    } else if (preset === '4weeks') {
      const d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 21)
      setRangeStart(weekStart(localDateStr(d))); setRangeEnd(weekEnd(t))
    } else if (preset === 'thisMonth') {
      const d = new Date(t + 'T00:00:00')
      setRangeStart(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
      setRangeEnd(t)
    }
  }

  const fmtRange = (s: string, e: string) => {
    const sd = new Date(s + 'T00:00:00'), ed = new Date(e + 'T00:00:00')
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const fmtY = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return sd.getFullYear() === ed.getFullYear() ? `${fmt(sd)} – ${fmtY(ed)}` : `${fmtY(sd)} – ${fmtY(ed)}`
  }

  const rangeLabel = fmtRange(wStart, wEnd)

  const clientScopedProjects = useMemo(
    () => activeTab === 'all' ? data.projects : data.projects.filter((p) => p.clientId === activeTab),
    [data.projects, activeTab],
  )

  const scopedProjects = useMemo(
    () => activeProject === 'all' ? clientScopedProjects : clientScopedProjects.filter((p) => p.id === activeProject),
    [clientScopedProjects, activeProject],
  )
  const scopedProjectIds = useMemo(() => new Set(scopedProjects.map((p) => p.id)), [scopedProjects])

  const avgRetentionPct = useMemo(
    () => scopedProjects.length > 0
      ? scopedProjects.reduce((s, p) => s + (p.retentionPct ?? 0.10), 0) / scopedProjects.length
      : 0.10,
    [scopedProjects],
  )

  const crewsForScope = useMemo(() => {
    const base = data.crews.filter((c) => c.status !== 'off')
    if (activeProject === 'all') return base
    const assignedIds = new Set(base.filter((c) => c.currentProjectId === activeProject).map((c) => c.id))
    const prodCrewIds = new Set(
      data.production
        .filter((p) => p.projectId === activeProject && p.date >= wStart && p.date <= wEnd)
        .map((p) => p.crewId),
    )
    return base.filter((c) => assignedIds.has(c.id) || prodCrewIds.has(c.id))
  }, [data.crews, data.production, activeProject, wStart, wEnd])

  const visibleCrews = useMemo(
    () => activeCrew === 'all' ? crewsForScope : crewsForScope.filter((c) => c.id === activeCrew),
    [crewsForScope, activeCrew],
  )

  // Subcontractors, scoped and filtered the same way as crews — see
  // crewsForScope/visibleCrews above. Crew and subcontractor ids never
  // collide (distinct newId() prefixes), so activeCrew doubles as "the
  // selected crew-or-subcontractor id" without needing a kind discriminator.
  const subsForScope = useMemo(() => {
    const base = (data.subcontractors ?? []).filter((s) => s.active)
    if (activeProject === 'all') return base
    const prodSubIds = new Set(
      data.production
        .filter((p) => p.projectId === activeProject && p.date >= wStart && p.date <= wEnd && p.subcontractorId)
        .map((p) => p.subcontractorId as string),
    )
    return base.filter((s) => prodSubIds.has(s.id))
  }, [data.subcontractors, data.production, activeProject, wStart, wEnd])

  const visibleSubs = useMemo(
    () => activeCrew === 'all' ? subsForScope : subsForScope.filter((s) => s.id === activeCrew),
    [subsForScope, activeCrew],
  )

  const summary = useMemo(() => {
    const visibleCrewIds = new Set(visibleCrews.map((c) => c.id))
    const visibleSubIds = new Set(visibleSubs.map((s) => s.id))
    const inScope = (p: { crewId: string; subcontractorId?: string | null }) =>
      p.subcontractorId ? visibleSubIds.has(p.subcontractorId) : visibleCrewIds.has(p.crewId)
    const weekProd = data.production.filter(
      (p) => p.date >= wStart && p.date <= wEnd && scopedProjectIds.has(p.projectId) && inScope(p),
    )
    const prodIds = new Set(weekProd.map((p) => p.id))
    // Subcontractor-sourced production has no clock/timecard equivalent (see
    // addProduction) — its cost only ever lives on the PnLEntry, so it has to
    // be summed separately from crew cost and added in, rather than sharing
    // the crew fallback chain below (which would silently drop it any time
    // clock/timecard data also exists in scope, since that chain picks one
    // source for everything instead of combining per production-entry kind).
    const subProdIds = new Set(weekProd.filter((p) => p.subcontractorId).map((p) => p.id))
    const weekPnl = data.pnl.filter(
      (p) => p.date >= wStart && p.date <= wEnd &&
        (p.productionEntryId ? prodIds.has(p.productionEntryId) : scopedProjectIds.has(p.projectId ?? '')),
    )
    const revenue = weekPnl.reduce((s, p) => s + p.revenue, 0)
    const subLaborCost = weekPnl
      .filter((p) => p.productionEntryId && subProdIds.has(p.productionEntryId))
      .reduce((s, p) => s + p.laborCost, 0)
    const crewPnl = weekPnl.filter((p) => !p.productionEntryId || !subProdIds.has(p.productionEntryId))
    // Crew labor: real clock entries → timecards (crew day entries) → pnl snapshot fallback
    const clockLaborCost = (data.clockEntries ?? []).reduce((s, ce) => {
      const d = ce.clockIn.slice(0, 10)
      if (d < wStart || d > wEnd || !ce.clockOut || !ce.crewId || !visibleCrewIds.has(ce.crewId)) return s
      const hrs = (new Date(ce.clockOut).getTime() - new Date(ce.clockIn).getTime()) / 3_600_000
      const emp = data.employees.find((e) => e.id === ce.employeeId)
      return s + hrs * (emp?.hourlyRate ?? 0)
    }, 0)
    const tcLaborCost = data.timecards.reduce((s, tc) => {
      if (tc.date < wStart || tc.date > wEnd || !tc.productionEntryId || !prodIds.has(tc.productionEntryId)) return s
      return s + tc.laborCost
    }, 0)
    const crewLaborCost = clockLaborCost > 0
      ? Math.round(clockLaborCost)
      : tcLaborCost > 0
      ? tcLaborCost
      : crewPnl.reduce((s, p) => s + p.laborCost, 0)
    const laborCost = crewLaborCost + subLaborCost
    // When a specific project is selected, only charge equipment from crews actually on that project
    const equipCrewIds = activeProject !== 'all'
      ? new Set(data.crews.filter((c) => c.currentProjectId && scopedProjectIds.has(c.currentProjectId)).map((c) => c.id))
      : visibleCrewIds
    const equipCost = data.equipment
      .filter((eq) => eq.active && eq.crewId && equipCrewIds.has(eq.crewId))
      .reduce((s, eq) => {
        const from = eq.deployedFrom && eq.deployedFrom > wStart ? eq.deployedFrom : wStart
        if (from > wEnd) return s
        const days = weekdaysInRange(from, wEnd)
        return s + Math.round(eq.monthlyCost / daysInMonth(from) * days)
      }, 0)
    const expCost = data.jobExpenses
      .filter((ex) => ex.date >= wStart && ex.date <= wEnd &&
        (scopedProjectIds.has(ex.jobId) || (ex.crewId ? equipCrewIds.has(ex.crewId) : false)))
      .reduce((s, ex) => s + ex.amount, 0)
    const totalCost = laborCost + equipCost + expCost
    const footage   = weekProd.reduce((s, p) => s + p.footage, 0)
    const retained = Math.round(revenue * avgRetentionPct)
    const netRevenue = revenue - retained
    return { revenue, retained, netRevenue, totalCost, ebitda: netRevenue - totalCost, footage, laborCost, equipCost, expCost }
  }, [data, scopedProjectIds, visibleCrews, visibleSubs, wStart, wEnd, avgRetentionPct, activeProject])

  // ── QA/QC status ──────────────────────────────────────────────────────────
  // qaFilters still drives the deep-link into /qa-review for the Pending
  // Review / Rejected / Waiting on Corrections cards below (those three only
  // ever apply to line items that actually went through the redline
  // workflow, so /qa-review — which is scoped the same way — is the right
  // place to send someone to act on them).
  const qaFilters = useMemo<QaFilterState>(() => ({
    ...EMPTY_QA_FILTERS,
    projectId: activeProject !== 'all' ? activeProject : '',
    dateFrom: wStart,
    dateTo: wEnd,
  }), [activeProject, wStart, wEnd])
  // The card totals themselves come from computeAllProductionQaTotals, not
  // computeQaRevenueBreakdown — that function only covers line items linked
  // to a submitted redline (MarkupBilling), so it structurally excludes the
  // bulk of ordinary Log Production/Log Crew Day entries and anything logged
  // before the QA/QC workflow existed. Scoping this to the dashboard's own
  // scopedProjectIds (not just qaFilters.projectId) matches exactly what the
  // Gross Revenue card above already sums, so Final Approved + Pending +
  // Rejected + Waiting reconciles with it.
  const qaBreakdown = useMemo(
    () => computeAllProductionQaTotals(data, { projectIds: scopedProjectIds, dateFrom: wStart, dateTo: wEnd }),
    [data, scopedProjectIds, wStart, wEnd],
  )

  // ── Daily chart data ──────────────────────────────────────────────────────
  const dailyData = useMemo(() => {
    const days: string[] = []
    const d = new Date(wStart + 'T00:00:00')
    const end = new Date(wEnd + 'T00:00:00')
    while (d <= end) { days.push(localDateStr(d)); d.setDate(d.getDate() + 1) }
    const visibleCrewIds = new Set(visibleCrews.map((c) => c.id))
    const visibleSubIds = new Set(visibleSubs.map((s) => s.id))
    const inScope = (p: { crewId: string; subcontractorId?: string | null }) =>
      p.subcontractorId ? visibleSubIds.has(p.subcontractorId) : visibleCrewIds.has(p.crewId)
    const equipCrewIds = activeProject !== 'all'
      ? new Set(data.crews.filter((c) => c.currentProjectId && scopedProjectIds.has(c.currentProjectId)).map((c) => c.id))
      : visibleCrewIds
    return days.map((date) => {
      const dayPnl = data.pnl.filter((p) => p.date === date && (
        p.productionEntryId
          ? data.production.some((pr) => pr.id === p.productionEntryId && scopedProjectIds.has(pr.projectId) && inScope(pr))
          : scopedProjectIds.has(p.projectId ?? '')
      ))
      const rev = dayPnl.reduce((s, p) => s + p.revenue, 0)
      const dayProdIds = new Set(
        data.production.filter((pr) => pr.date === date && scopedProjectIds.has(pr.projectId) && inScope(pr)).map((pr) => pr.id)
      )
      // Same split as the summary card above: subcontractor cost only ever
      // lives on the PnLEntry (no clock/timecard equivalent), so it's summed
      // separately and added rather than sharing the crew fallback chain.
      const daySubProdIds = new Set(
        data.production.filter((pr) => pr.date === date && scopedProjectIds.has(pr.projectId) && inScope(pr) && pr.subcontractorId).map((pr) => pr.id)
      )
      const daySubLabor = dayPnl
        .filter((p) => p.productionEntryId && daySubProdIds.has(p.productionEntryId))
        .reduce((s, p) => s + p.laborCost, 0)
      const dayCrewPnl = dayPnl.filter((p) => !p.productionEntryId || !daySubProdIds.has(p.productionEntryId))
      const dayClockLabor = (data.clockEntries ?? []).reduce((s, ce) => {
        if (ce.clockIn.slice(0, 10) !== date || !ce.clockOut || !ce.crewId || !visibleCrewIds.has(ce.crewId)) return s
        const hrs = (new Date(ce.clockOut).getTime() - new Date(ce.clockIn).getTime()) / 3_600_000
        const emp = data.employees.find((e) => e.id === ce.employeeId)
        return s + hrs * (emp?.hourlyRate ?? 0)
      }, 0)
      const dayTcLabor = data.timecards.reduce((s, tc) => {
        if (tc.date !== date || !tc.productionEntryId || !dayProdIds.has(tc.productionEntryId)) return s
        return s + tc.laborCost
      }, 0)
      const dayCrewLabor = dayClockLabor > 0 ? Math.round(dayClockLabor) : dayTcLabor > 0 ? dayTcLabor : dayCrewPnl.reduce((s, p) => s + p.laborCost, 0)
      const lab = dayCrewLabor + daySubLabor
      // Equipment cost: weekdays only, prorated daily from monthly cost
      const dow = new Date(date + 'T00:00:00').getDay()
      const equip = (dow !== 0 && dow !== 6)
        ? Math.round(data.equipment
            .filter((eq) => eq.active && eq.crewId && equipCrewIds.has(eq.crewId) && (!eq.deployedFrom || eq.deployedFrom <= date))
            .reduce((s, eq) => s + eq.monthlyCost / daysInMonth(date), 0))
        : 0
      const exp = Math.round(data.jobExpenses
        .filter((ex) => ex.date === date && (scopedProjectIds.has(ex.jobId) || (ex.crewId ? equipCrewIds.has(ex.crewId) : false)))
        .reduce((s, ex) => s + ex.amount, 0))
      const retained = Math.round(rev * avgRetentionPct)
      const netRev = rev - retained
      const totalCost = lab + equip + exp
      const profit = netRev - totalCost
      const label = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return { date, label, revenue: Math.round(rev), netRevenue: Math.round(netRev), cost: totalCost, profit: Math.round(profit) }
    })
  }, [data, scopedProjectIds, visibleCrews, visibleSubs, activeProject, wStart, wEnd, avgRetentionPct])

  // ── Per-crew performance (crews and subcontractors — some internal, some
  // not, but both represent "who worked this") ────────────────────────────
  const crewPerf = useMemo(() => {
    const crewRows = visibleCrews.map((crew) => {
      const crewProd = data.production.filter(
        (p) => p.crewId === crew.id && p.date >= wStart && p.date <= wEnd && scopedProjectIds.has(p.projectId),
      )
      const prodIds = new Set(crewProd.map((p) => p.id))
      const crewPnl = data.pnl.filter((p) => p.date >= wStart && p.date <= wEnd && (
        p.productionEntryId ? prodIds.has(p.productionEntryId) : false
      ))
      const footage   = crewProd.reduce((s, p) => s + p.footage, 0)
      const hours     = crewProd.reduce((s, p) => s + p.hours,   0)
      const revenue   = crewPnl.reduce((s, p) => s + p.revenue,  0)
      const crewClockLabor = (data.clockEntries ?? []).reduce((s, ce) => {
        const d = ce.clockIn.slice(0, 10)
        if (d < wStart || d > wEnd || !ce.clockOut || ce.crewId !== crew.id) return s
        const hrs = (new Date(ce.clockOut).getTime() - new Date(ce.clockIn).getTime()) / 3_600_000
        const emp = data.employees.find((e) => e.id === ce.employeeId)
        return s + hrs * (emp?.hourlyRate ?? 0)
      }, 0)
      const crewTcLabor = data.timecards.reduce((s, tc) => {
        if (tc.date < wStart || tc.date > wEnd || !tc.productionEntryId || !prodIds.has(tc.productionEntryId)) return s
        return s + tc.laborCost
      }, 0)
      const laborCost = crewClockLabor > 0
        ? Math.round(crewClockLabor)
        : crewTcLabor > 0
        ? crewTcLabor
        : crewPnl.reduce((s, p) => s + p.laborCost, 0)
      const equipCost = data.equipment
        .filter((eq) => eq.active && eq.crewId === crew.id)
        .reduce((s, eq) => {
          const from = eq.deployedFrom && eq.deployedFrom > wStart ? eq.deployedFrom : wStart
          if (from > wEnd) return s
          const days = weekdaysInRange(from, wEnd)
          return s + Math.round(eq.monthlyCost / daysInMonth(from) * days)
        }, 0)
      const expCost = data.jobExpenses
        .filter((ex) => ex.date >= wStart && ex.date <= wEnd && ex.crewId === crew.id)
        .reduce((s, ex) => s + ex.amount, 0)
      const retained   = Math.round(revenue * avgRetentionPct)
      const netRevenue = revenue - retained
      const totalCost  = laborCost + equipCost + expCost
      const profit     = netRevenue - totalCost
      const margin     = netRevenue > 0 ? profit / netRevenue : 0
      const ftPerHr    = hours > 0 ? footage / hours : 0
      return { who: { id: crew.id, name: crew.name }, footage, hours, revenue, netRevenue, laborCost, equipCost, expCost, profit, margin, ftPerHr }
    })

    // Subcontractor rows — same shape, keyed by subcontractorId instead of
    // crewId. equipCost/expCost stay 0 — subcontractors use their own
    // equipment, never company-tracked assets keyed by crewId. laborCost is
    // NOT $0 here: it's the subcontractor's pay (revenue × their payRatePercent),
    // computed once in DataContext's addProduction and stored on the PnLEntry
    // the same way a billing line snapshots its rate — this table just sums
    // whatever landed there, same as the crew rows above.
    const subRows = visibleSubs.map((sub) => {
      const subProd = data.production.filter(
        (p) => p.subcontractorId === sub.id && p.date >= wStart && p.date <= wEnd && scopedProjectIds.has(p.projectId),
      )
      const prodIds = new Set(subProd.map((p) => p.id))
      const subPnl = data.pnl.filter((p) => p.date >= wStart && p.date <= wEnd && (
        p.productionEntryId ? prodIds.has(p.productionEntryId) : false
      ))
      const footage = subProd.reduce((s, p) => s + p.footage, 0)
      const hours   = subProd.reduce((s, p) => s + p.hours, 0)
      const revenue = subPnl.reduce((s, p) => s + p.revenue, 0)
      const laborCost = subPnl.reduce((s, p) => s + p.laborCost, 0)
      const retained   = Math.round(revenue * avgRetentionPct)
      const netRevenue = revenue - retained
      const totalCost  = laborCost
      const profit     = netRevenue - totalCost
      const margin     = netRevenue > 0 ? profit / netRevenue : 0
      const ftPerHr    = hours > 0 ? footage / hours : 0
      return { who: { id: sub.id, name: sub.companyName }, footage, hours, revenue, netRevenue, laborCost, equipCost: 0, expCost: 0, profit, margin, ftPerHr }
    })

    return [...crewRows, ...subRows]
  }, [data, visibleCrews, visibleSubs, scopedProjectIds, wStart, wEnd, avgRetentionPct])

  const activeFiltered = scopedProjects.filter((p) => p.status === 'active')

  const handleProjectChange = (projId: string) => { setActiveProject(projId); setActiveCrew('all') }

  const marginPct = summary.netRevenue > 0 ? (summary.ebitda / summary.netRevenue) * 100 : 0
  const costPieData = [
    { name: 'Labor', value: summary.laborCost },
    { name: 'Equipment', value: summary.equipCost },
    { name: 'Expenses', value: summary.expCost },
  ].filter((d) => d.value > 0)

  const handleExport = () => {
    const rows: string[][] = []
    const row = (...cells: (string | number)[]) => rows.push(cells.map(String))
    const blank = () => rows.push([])

    const projLabel = activeProject === 'all' ? 'All Projects' : (scopedProjects.find((p) => p.id === activeProject)?.name ?? activeProject)
    const crewLabel = activeCrew === 'all'
      ? 'All Crews'
      : (visibleCrews.find((c) => c.id === activeCrew)?.name ?? visibleSubs.find((s) => s.id === activeCrew)?.companyName ?? activeCrew)

    row('Fiberlytic P&L Report')
    row('Period', rangeLabel)
    row('Generated', new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))
    row('Project Filter', projLabel)
    row('Crew Filter', crewLabel)
    blank()

    row('SUMMARY')
    row('Metric', 'Amount (USD)')
    row('Gross Revenue', summary.revenue)
    row('Retainage Held', summary.retained)
    row('Net Revenue', summary.netRevenue)
    row('Labor Cost', summary.laborCost)
    row('Equipment Cost', summary.equipCost)
    row('Field Expenses', summary.expCost)
    row('Total Cost', summary.totalCost)
    row('EBITDA', summary.ebitda)
    row('Profit Margin %', `${marginPct.toFixed(1)}%`)
    row('Footage (ft)', summary.footage)
    blank()

    row('DAILY BREAKDOWN')
    row('Date', 'Gross Revenue', 'Net Revenue', 'Total Cost', 'Profit')
    for (const d of dailyData) {
      row(d.date, d.revenue, d.netRevenue, d.cost, d.profit)
    }
    blank()

    row('CREW PERFORMANCE')
    row('Crew', 'Hours', 'Footage (ft)', 'Ft/Hr', 'Net Revenue', 'Labor Cost', 'Equipment Cost', 'Expenses', 'Profit', 'Margin %')
    for (const r of crewPerf) {
      row(r.who.name, r.hours.toFixed(1), r.footage, r.ftPerHr.toFixed(1), r.netRevenue, r.laborCost, r.equipCost, r.expCost, r.profit, `${(r.margin * 100).toFixed(1)}%`)
    }
    blank()

    const periodExpenses = data.jobExpenses.filter((ex) => ex.date >= wStart && ex.date <= wEnd)
    if (periodExpenses.length > 0) {
      row('FIELD EXPENSES DETAIL')
      row('Date', 'Vendor', 'Description', 'Amount (USD)')
      for (const ex of periodExpenses) {
        row(ex.date, ex.vendor, ex.description, ex.amount)
      }
      blank()
    }

    const csv = rows.map((r) =>
      r.map((cell) => {
        const s = String(cell)
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
      }).join(',')
    ).join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pnl-report-${wStart}-to-${wEnd}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const selectCls = 'rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-8 text-sm font-medium text-slate-700 focus:border-brand-500 focus:outline-none'
  const presetCls = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-semibold transition ${
      active ? 'bg-brand-600 text-white' : 'border border-slate-300 text-slate-500 hover:border-brand-500 hover:text-slate-700'
    }`

  return (
    <div className="space-y-5">
      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-bold text-slate-900">P&L Command Center</h1>
          <p className="text-xs text-slate-400">{rangeLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Export */}
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-brand-500 hover:text-slate-900 transition"
          >
            <Download size={13} />
            Export CSV
          </button>
          {/* Date presets */}
          {([
            { label: 'This week', preset: 'thisWeek' as const },
            { label: 'Last week', preset: 'lastWeek' as const },
            { label: '2 wks',     preset: '2weeks'   as const },
            { label: '4 wks',     preset: '4weeks'   as const },
            { label: 'Month',     preset: 'thisMonth' as const },
          ]).map(({ label, preset }) => {
            const t = localDateStr()
            let ps = '', pe = ''
            if (preset === 'thisWeek')       { ps = weekStart(t); pe = weekEnd(t) }
            else if (preset === 'lastWeek')  { const d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 7); const lw = localDateStr(d); ps = weekStart(lw); pe = weekEnd(lw) }
            else if (preset === '2weeks')    { const d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 7); ps = weekStart(localDateStr(d)); pe = weekEnd(t) }
            else if (preset === '4weeks')    { const d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 21); ps = weekStart(localDateStr(d)); pe = weekEnd(t) }
            else if (preset === 'thisMonth') { const d = new Date(t + 'T00:00:00'); ps = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; pe = t }
            return <button key={label} onClick={() => setPreset(preset)} className={presetCls(wStart === ps && wEnd === pe)}>{label}</button>
          })}
          <div className="flex items-center gap-1">
            <input type="date" value={rangeStart} onChange={(e) => e.target.value && setRangeStart(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 focus:outline-none" />
            <span className="text-slate-400">–</span>
            <input type="date" value={rangeEnd} min={rangeStart} onChange={(e) => e.target.value && setRangeEnd(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 focus:outline-none" />
          </div>
          {/* Filters */}
          <select value={activeProject} onChange={(e) => handleProjectChange(e.target.value)} className={selectCls}>
            <option value="all">All projects</option>
            {clientScopedProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={activeCrew} onChange={(e) => setActiveCrew(e.target.value)} className={selectCls}>
            <option value="all">All crews</option>
            <optgroup label="In-House Crews">
              {crewsForScope.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
            {subsForScope.length > 0 && (
              <optgroup label="Subcontractors">
                {subsForScope.map((s) => <option key={s.id} value={s.id}>{s.companyName}</option>)}
              </optgroup>
            )}
          </select>
          {(activeProject !== 'all' || activeCrew !== 'all') && (
            <button onClick={() => { setActiveProject('all'); setActiveCrew('all') }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── KPI cards ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <CmdCard label="Gross Revenue"   value={money(summary.revenue)}     icon={DollarSign} tone="green" sub={rangeLabel} />
        <CmdCard label="Retainage Held"  value={`(${money(summary.retained)})`} icon={DollarSign} tone="gold"  sub="held until release" />
        <CmdCard label="Net Revenue"     value={money(summary.netRevenue)}  icon={DollarSign} tone="green" sub="after retainage" />
        <CmdCard label="Labor Cost"      value={money(summary.laborCost)}   icon={HardHat}    tone="gold"  sub={`${summary.netRevenue > 0 ? Math.round(summary.laborCost / summary.netRevenue * 100) : 0}% of net rev`} />
        <CmdCard label="Equip + Expenses" value={money(summary.equipCost + summary.expCost)} icon={Wrench} tone="gold" sub="equipment & field expenses" />
        <CmdCard label="EBITDA"          value={money(summary.ebitda)}      icon={TrendingUp}  tone={summary.ebitda >= 0 ? 'green' : 'red'} sub={`${marginPct.toFixed(1)}% margin · ${number(summary.footage)} ft`} />
      </div>

      {/* ── QA/QC status ─────────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">QA/QC Status · {rangeLabel}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            { label: 'Pending Review',     value: qaBreakdown.pendingReviewRevenue,        color: '#f59e0b', icon: Clock,         sub: 'awaiting supervisor review', status: 'pending_review' as const, linkable: true },
            { label: 'Rejected',           value: qaBreakdown.rejectedRevenue,              color: '#ef4444', icon: AlertOctagon,  sub: 'not counted toward invoicing', status: 'rejected' as const, linkable: true },
            { label: 'Waiting on Corrections', value: qaBreakdown.revenueWaitingOnCorrections, color: '#3b82f6', icon: FileText,   sub: 'fixed — awaiting re-review', status: 'rejection_fixed' as const, linkable: true },
            { label: 'Final Approved',     value: qaBreakdown.finalApprovedRevenue,         color: '#22c55e', icon: CheckCircle2, sub: 'billable — includes revenue entered outside QA/QC review', status: 'approved' as const, linkable: false },
          ]).map(({ label, value, color, icon: Icon, sub, status, linkable }) => {
            const content = (
              <>
                <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: `${color}18` }}>
                  <Icon size={20} style={{ color }} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
                  <p className="mt-0.5 text-2xl font-extrabold tracking-tight" style={{ color }}>{money(value)}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{sub}</p>
                </div>
              </>
            )
            return linkable ? (
              <Link
                key={label}
                to="/qa-review"
                state={{ qaFilters: { ...qaFilters, qaStatus: status } }}
                className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:shadow-md"
              >
                {content}
              </Link>
            ) : (
              <div key={label} className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                {content}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Charts row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Revenue vs Cost bar chart */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400">Revenue vs Cost vs Profit</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} barGap={2} barCategoryGap="30%">
                <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => money(v)} />
                <RechartLegend wrapperStyle={{ fontSize: 11, color: AXIS }} />
                <Bar dataKey="revenue" name="Revenue" fill={GOLD}    radius={[3,3,0,0]} />
                <Bar dataKey="cost"    name="Cost"    fill={DARK_BAR} radius={[3,3,0,0]} />
                <Bar dataKey="profit"  name="Profit"  fill={GOLD2}    radius={[3,3,0,0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cost breakdown donut */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400">Cost Breakdown</p>
          {costPieData.length > 0 ? (
            <div className="flex items-center gap-4">
              <div className="h-48 w-48 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={costPieData} cx="50%" cy="50%" innerRadius={52} outerRadius={76} dataKey="value" paddingAngle={2}>
                      {costPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => money(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs text-slate-400">Total Cost</p>
                <p className="text-lg font-bold text-slate-900">{money(summary.totalCost)}</p>
                {costPieData.map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2.5 w-2.5 rounded-sm" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-xs text-slate-500">{d.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-semibold text-slate-400">{money(d.value)}</span>
                      <span className="ml-1 text-xs text-slate-400">
                        {summary.totalCost > 0 ? `${Math.round(d.value / summary.totalCost * 100)}%` : '0%'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-8 text-center text-sm text-slate-400">No cost data</p>
          )}
        </div>
      </div>

      {/* ── Crew performance + margin chart ──────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Crew performance table */}
        <div className="rounded-xl border border-slate-200 bg-white lg:col-span-3">
          <div className="flex items-center justify-between px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Crew & Subcontractor Performance</p>
            <span className="text-xs text-slate-400">{rangeLabel}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-y border-slate-100 text-left">
                  {['Crew','Hours','Footage','Ft/Hr','Net Revenue','Labor','Equipment','Expenses','Profit','Margin'].map((h) => (
                    <th key={h} className="px-4 py-2 font-semibold uppercase tracking-wide text-slate-400 first:pl-5 last:pr-5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {crewPerf.length === 0 ? (
                  <tr><td colSpan={10} className="px-5 py-8 text-center text-slate-400">No production data for this period.</td></tr>
                ) : crewPerf.map((r) => (
                  <tr key={r.who.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2.5 pl-5 font-medium text-slate-800">{r.who.name}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.hours.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{number(r.footage)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.ftPerHr.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-slate-400">{money(r.netRevenue)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{money(r.laborCost)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{money(r.equipCost)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{money(r.expCost)}</td>
                    <td className={`px-4 py-2.5 font-semibold ${r.profit >= 0 ? 'text-amber-600' : 'text-rose-600'}`}>{money(r.profit)}</td>
                    <td className={`py-2.5 pr-5 font-semibold ${r.margin >= 0.3 ? 'text-emerald-600' : r.margin >= 0.1 ? 'text-amber-600' : 'text-rose-600'}`}>
                      {(r.margin * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              {crewPerf.length > 1 && (
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50">
                    <td className="py-2.5 pl-5 font-bold text-slate-400">TOTAL</td>
                    <td className="px-4 py-2.5 font-bold text-slate-400">{crewPerf.reduce((s,r)=>s+r.hours,0).toFixed(1)}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-400">{number(crewPerf.reduce((s,r)=>s+r.footage,0))}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-400">
                      {crewPerf.reduce((s,r)=>s+r.hours,0) > 0
                        ? (crewPerf.reduce((s,r)=>s+r.footage,0) / crewPerf.reduce((s,r)=>s+r.hours,0)).toFixed(1)
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-bold text-slate-800">{money(summary.netRevenue)}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-400">{money(summary.laborCost)}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-400">{money(summary.equipCost)}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-400">{money(summary.expCost)}</td>
                    <td className="px-4 py-2.5 font-bold text-amber-600">{money(summary.ebitda)}</td>
                    <td className="py-2.5 pr-5 font-bold text-amber-600">{marginPct.toFixed(1)}%</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Profit margin % line chart */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400">Profit Margin %</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyData.filter((d) => d.netRevenue > 0)}>
                <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `${v.toFixed(0)}%`}
                  domain={['auto', 'auto']} />
                <Tooltip {...TOOLTIP_STYLE}
                  formatter={(_v: number, _n, props) => {
                    const d = props.payload
                    if (!d || d.netRevenue === 0) return ['—', 'Margin']
                    return [`${((d.profit / d.netRevenue) * 100).toFixed(1)}%`, 'Margin']
                  }} />
                <Line
                  type="monotone"
                  dataKey={(d) => d.netRevenue > 0 ? (d.profit / d.netRevenue) * 100 : null}
                  name="Margin %"
                  stroke={GOLD}
                  strokeWidth={2}
                  dot={{ fill: GOLD, r: 3 }}
                  activeDot={{ r: 5, fill: GOLD2 }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Bottom row: projects table + per-foot metrics ─────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Active projects */}
        <div className="rounded-xl border border-slate-200 bg-white xl:col-span-2">
          <div className="flex items-center justify-between px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Active Projects</p>
            <Link to="/projects" className="text-xs text-amber-700 hover:text-amber-600">View all →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-y border-slate-100">
                  {['Project', 'Client', 'Progress', 'Contract', 'Revenue (period)'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left font-semibold uppercase tracking-wide text-slate-400 first:pl-5 last:pr-5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeFiltered.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No active projects.</td></tr>
                ) : activeFiltered.map((p) => {
                  const pct = projectProgress(p)
                  const wkRevenue = data.pnl
                    .filter((e) => e.projectId === p.id && e.date >= wStart && e.date <= wEnd)
                    .reduce((s, e) => s + e.revenue, 0)
                  return (
                    <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2.5 pl-5">
                        <Link to={`/projects/${p.id}`} className="font-medium text-slate-800 hover:text-amber-600">{p.name}</Link>
                        <div className="mt-1 h-1 w-28 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct * 100}%` }} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{p.client}</td>
                      <td className="px-4 py-2.5 text-slate-500">{percent(pct)}</td>
                      <td className="px-4 py-2.5 text-slate-400">{money(p.contractValue)}</td>
                      <td className="py-2.5 pr-5 font-semibold text-amber-600">{wkRevenue > 0 ? money(wkRevenue) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Per-foot metrics */}
        <div className="flex flex-col gap-4">
          <div className="flex-1 rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Cost Per Foot</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">
              {summary.footage > 0 ? `$${(summary.totalCost / summary.footage).toFixed(2)}` : '—'}
            </p>
            <p className="mt-1 text-xs text-slate-400">{number(summary.footage)} ft · {money(summary.totalCost)} total cost</p>
          </div>
          <div className="flex-1 rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Net Rev Per Foot</p>
            <p className="mt-2 text-3xl font-extrabold text-amber-600">
              {summary.footage > 0 ? `$${(summary.netRevenue / summary.footage).toFixed(2)}` : '—'}
            </p>
            <p className="mt-1 text-xs text-slate-400">{number(summary.footage)} ft · {money(summary.netRevenue)} net rev</p>
          </div>
          <div className="flex-1 rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Footage Placed</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-800">{number(summary.footage)}<span className="ml-1 text-sm font-normal text-slate-400">ft</span></p>
            <p className="mt-1 text-xs text-slate-400">{activeFiltered.length} active project{activeFiltered.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {/* ── Detailed weekly summary (existing card, kept for drill-down) ───────── */}
      <div className="rounded-xl border border-slate-200">
        <WeeklySummaryCard
          crews={visibleCrews}
          wStart={wStart}
          wEnd={wEnd}
          weekdays={weekdays}
          scopedProjectIds={scopedProjectIds}
        />
      </div>
    </div>
  )
}

// ── Role-dispatching entry point ──────────────────────────────────────────────

export function Dashboard() {
  const { role, isAdmin } = useRole()
  if (isAdmin) return <AdminDashboard />
  if (role === 'subcontractor') return <SubcontractorDashboard />
  if (role === 'supervisor') return <SupervisorDashboard />
  return <FieldDashboard />
}
