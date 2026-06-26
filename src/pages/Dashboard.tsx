import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, TrendingUp, TrendingDown, FileText, File, Clock, Receipt, Package, Users, Map as MapIcon, DollarSign, HardHat, Wrench } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { loadBlob } from '../lib/fileStore'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { money, moneyExact, number, percent } from '../lib/format'
import { projectProgress, weekStart, weekEnd, daysInMonth } from '../lib/analytics'
import type { Crew, Employee } from '../types'
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
                      <Link key={f.id} to={`/redline/${f.id}`} className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100">
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

function EmployeePicker({ onSelect, employees }: { onSelect: (id: string) => void; employees: Employee[] }) {
  const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600">
          <Users size={28} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Who are you?</h2>
        <p className="mt-1 text-sm text-slate-500">Select your name to see your personal dashboard</p>
      </div>
      <div className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        {sorted.map((emp) => (
          <button
            key={emp.id}
            onClick={() => onSelect(emp.id)}
            className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-400 hover:shadow-md active:scale-[0.98]"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
              {emp.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-slate-900">{emp.name}</p>
              <p className="text-xs text-slate-500">{emp.role}</p>
              {emp.isForeman && (
                <span className="mt-0.5 inline-flex items-center rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
                  Foreman
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Field dashboard ───────────────────────────────────────────────────────────

function FieldDashboard() {
  const { data } = useData()
  const { activeEmployeeId, setActiveEmployee } = useRole()


  const today      = new Date().toISOString().slice(0, 10)
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
    .sort((a, b) => b.date.localeCompare(a.date))

  const crewFootageWeek = weekProduction.reduce((s, p) => s + p.footage, 0)
  const crewHoursWeek   = weekProduction.reduce((s, p) => s + p.hours, 0)
  const showCrewCol     = myCrews.length > 1

  // Hours from clock entries — actual time worked regardless of whether production was logged
  const myHoursWeek = (data.clockEntries ?? [])
    .filter((ce) => {
      const d = ce.clockIn.slice(0, 10)
      return ce.employeeId === activeEmployee.id && d >= wStart && d <= wEnd && !!ce.clockOut
    })
    .reduce((s, ce) => s + (new Date(ce.clockOut!).getTime() - new Date(ce.clockIn).getTime()) / 3_600_000, 0)

  // Pay = actual clock hours × current hourly rate
  const myEarningsWeek = myHoursWeek * (activeEmployee.hourlyRate ?? 0)

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

      {/* Earnings banner */}
      <div className="mb-6 rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-700 p-5 text-white shadow-md">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-100">My Earnings This Week</p>
        <p className="mt-0.5 text-4xl font-extrabold tracking-tight">
          {myEarningsWeek > 0 ? money(myEarningsWeek) : '$0.00'}
        </p>
        <p className="mt-1.5 text-sm text-emerald-100">
          {myHoursWeek > 0
            ? `${myHoursWeek.toFixed(1)} hours logged so far`
            : 'No hours logged yet this week'}
        </p>
        {myHoursWeek > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-emerald-200">
              <span>Week progress</span>
              <span>{Math.min(100, Math.round((myHoursWeek / 40) * 100))}% of 40 h</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-emerald-900/40">
              <div
                className="h-full rounded-full bg-white/70 transition-all duration-500"
                style={{ width: `${Math.min(100, (myHoursWeek / 40) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { to: '/clock-in',        label: 'Time Clock',         icon: Clock,     color: 'bg-brand-600'   },
          { to: '/production',      label: 'Log Production',     icon: Activity,  color: 'bg-emerald-600' },
          { to: '/project-prints',  label: 'Project Prints',     icon: MapIcon,   color: 'bg-cyan-600'    },
          { to: '/expenses',        label: 'Log Expense',        icon: Receipt,   color: 'bg-amber-600'   },
          { to: '/materials',       label: 'Check Out Material', icon: Package,   color: 'bg-purple-600'  },
        ].map(({ to, label, icon: Icon, color }) => (
          <Link
            key={to}
            to={to}
            className={`flex flex-col items-center gap-2 rounded-2xl ${color} px-4 py-5 text-white shadow-sm transition hover:opacity-90 active:scale-95`}
          >
            <Icon size={24} />
            <span className="text-center text-sm font-semibold leading-tight">{label}</span>
          </Link>
        ))}
      </div>

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
                  </tr>
                </thead>
                <tbody>
                  {weekProduction.map((p) => {
                    const proj = data.projects.find((pr) => pr.id === p.projectId)
                    const crew = showCrewCol ? data.crews.find((c) => c.id === p.crewId) : null
                    return (
                      <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="px-5 py-2.5 text-slate-600">
                          {new Date(p.date + 'T00:00:00').toLocaleDateString('en-US', {
                            weekday: 'short', month: 'short', day: 'numeric',
                          })}
                        </td>
                        <td className="px-5 py-2.5 text-slate-600">{proj?.name ?? '—'}</td>
                        {showCrewCol && <td className="px-5 py-2.5 text-xs text-slate-400">{crew?.name ?? '—'}</td>}
                        <td className="px-5 py-2.5 text-right font-semibold text-slate-700">{number(p.footage)} ft</td>
                        <td className="px-5 py-2.5 text-right text-slate-600">{p.hours.toFixed(1)} h</td>
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
  const iconBg = { gold: 'bg-brand-600/20', green: 'bg-emerald-500/15', red: 'bg-rose-500/15', blue: 'bg-cyan-500/15' }[tone]
  const iconColor = { gold: 'text-brand-400', green: 'text-emerald-400', red: 'text-rose-400', blue: 'text-cyan-400' }[tone]
  const valColor = { gold: 'text-white', green: 'text-emerald-300', red: 'text-rose-300', blue: 'text-cyan-300' }[tone]
  return (
    <div className="flex items-start gap-4 rounded-xl border border-[#2a2a2a] bg-[#141414] px-5 py-4 shadow-md">
      <div className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
        <Icon size={20} className={iconColor} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
        <p className={`mt-0.5 text-2xl font-extrabold tracking-tight ${valColor}`}>{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </div>
    </div>
  )
}

// Chart colours
const GOLD   = '#c9920a'
const GOLD2  = '#e8a90e'
const DARK_BAR = '#2a2a2a'
const AXIS   = '#555555'
const TOOLTIP_STYLE = {
  contentStyle: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#e8e8e8', fontSize: 12 },
  cursor: { fill: 'rgba(255,255,255,0.03)' },
}
const PIE_COLORS = [GOLD, '#444444', '#2a2a2a', '#666666']

// ── Admin dashboard ───────────────────────────────────────────────────────────

function AdminDashboard() {
  const { data } = useData()
  const [activeTab] = useState<string>('all')
  const [activeProject, setActiveProject] = useState<string>('all')
  const [activeCrew,    setActiveCrew]   = useState<string>('all')

  const today = new Date().toISOString().slice(0, 10)

  // Custom date range — defaults to current week (Mon–Sun)
  const [rangeStart, setRangeStart] = useState(() => weekStart(today))
  const [rangeEnd,   setRangeEnd]   = useState(() => weekEnd(today))

  const wStart   = rangeStart
  const wEnd     = rangeEnd
  const weekdays = weekdaysInRange(wStart, wEnd)

  const setPreset = (preset: 'thisWeek' | 'lastWeek' | '2weeks' | '4weeks' | 'thisMonth') => {
    const t = new Date().toISOString().slice(0, 10)
    if (preset === 'thisWeek') {
      setRangeStart(weekStart(t)); setRangeEnd(weekEnd(t))
    } else if (preset === 'lastWeek') {
      const d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 7)
      const lw = d.toISOString().slice(0, 10)
      setRangeStart(weekStart(lw)); setRangeEnd(weekEnd(lw))
    } else if (preset === '2weeks') {
      const d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 7)
      setRangeStart(weekStart(d.toISOString().slice(0, 10))); setRangeEnd(weekEnd(t))
    } else if (preset === '4weeks') {
      const d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 21)
      setRangeStart(weekStart(d.toISOString().slice(0, 10))); setRangeEnd(weekEnd(t))
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

  const summary = useMemo(() => {
    const visibleCrewIds = new Set(visibleCrews.map((c) => c.id))
    const weekProd = data.production.filter(
      (p) => p.date >= wStart && p.date <= wEnd && scopedProjectIds.has(p.projectId) && visibleCrewIds.has(p.crewId),
    )
    const prodIds = new Set(weekProd.map((p) => p.id))
    const weekPnl = data.pnl.filter(
      (p) => p.date >= wStart && p.date <= wEnd &&
        (p.productionEntryId ? prodIds.has(p.productionEntryId) : scopedProjectIds.has(p.projectId ?? '')),
    )
    const revenue   = weekPnl.reduce((s, p) => s + p.revenue, 0)
    const laborCost = weekPnl.reduce((s, p) => s + p.laborCost, 0)
    // When a specific project is selected, only charge equipment from crews actually on that project
    const equipCrewIds = activeProject !== 'all'
      ? new Set(data.crews.filter((c) => c.currentProjectId && scopedProjectIds.has(c.currentProjectId)).map((c) => c.id))
      : visibleCrewIds
    const equipCost = data.equipment
      .filter((eq) => eq.active && eq.crewId && equipCrewIds.has(eq.crewId))
      .reduce((s, eq) => s + Math.round(eq.monthlyCost / daysInMonth(wStart) * weekdays), 0)
    const expCost = data.jobExpenses
      .filter((ex) => ex.date >= wStart && ex.date <= wEnd &&
        (scopedProjectIds.has(ex.jobId) || (ex.crewId ? equipCrewIds.has(ex.crewId) : false)))
      .reduce((s, ex) => s + ex.amount, 0)
    const totalCost = laborCost + equipCost + expCost
    const footage   = weekProd.reduce((s, p) => s + p.footage, 0)
    const retained = Math.round(revenue * avgRetentionPct)
    const netRevenue = revenue - retained
    return { revenue, retained, netRevenue, totalCost, ebitda: netRevenue - totalCost, footage, laborCost, equipCost, expCost }
  }, [data, scopedProjectIds, visibleCrews, weekdays, wStart, wEnd, avgRetentionPct])

  // ── Daily chart data ──────────────────────────────────────────────────────
  const dailyData = useMemo(() => {
    const days: string[] = []
    const d = new Date(wStart + 'T00:00:00')
    const end = new Date(wEnd + 'T00:00:00')
    while (d <= end) { days.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1) }
    const visibleCrewIds = new Set(visibleCrews.map((c) => c.id))
    const equipCrewIds = activeProject !== 'all'
      ? new Set(data.crews.filter((c) => c.currentProjectId && scopedProjectIds.has(c.currentProjectId)).map((c) => c.id))
      : visibleCrewIds
    return days.map((date) => {
      const dayPnl = data.pnl.filter((p) => p.date === date && (
        p.productionEntryId
          ? data.production.some((pr) => pr.id === p.productionEntryId && scopedProjectIds.has(pr.projectId) && visibleCrewIds.has(pr.crewId))
          : scopedProjectIds.has(p.projectId ?? '')
      ))
      const rev = dayPnl.reduce((s, p) => s + p.revenue, 0)
      const lab = dayPnl.reduce((s, p) => s + p.laborCost, 0)
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
  }, [data, scopedProjectIds, visibleCrews, activeProject, wStart, wEnd, avgRetentionPct])

  // ── Per-crew performance ──────────────────────────────────────────────────
  const crewPerf = useMemo(() => {
    return visibleCrews.map((crew) => {
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
      const laborCost = crewPnl.reduce((s, p) => s + p.laborCost, 0)
      const equipCost = data.equipment
        .filter((eq) => eq.active && eq.crewId === crew.id)
        .reduce((s, eq) => s + Math.round(eq.monthlyCost / daysInMonth(wStart) * weekdays), 0)
      const expCost = data.jobExpenses
        .filter((ex) => ex.date >= wStart && ex.date <= wEnd && ex.crewId === crew.id)
        .reduce((s, ex) => s + ex.amount, 0)
      const retained   = Math.round(revenue * avgRetentionPct)
      const netRevenue = revenue - retained
      const totalCost  = laborCost + equipCost + expCost
      const profit     = netRevenue - totalCost
      const margin     = netRevenue > 0 ? profit / netRevenue : 0
      const ftPerHr    = hours > 0 ? footage / hours : 0
      return { crew, footage, hours, revenue, netRevenue, laborCost, equipCost, expCost, profit, margin, ftPerHr }
    }).filter((r) => r.footage > 0 || r.revenue > 0)
  }, [data, visibleCrews, scopedProjectIds, wStart, wEnd, weekdays, avgRetentionPct])

  const activeFiltered = scopedProjects.filter((p) => p.status === 'active')

  const handleProjectChange = (projId: string) => { setActiveProject(projId); setActiveCrew('all') }

  const marginPct = summary.netRevenue > 0 ? (summary.ebitda / summary.netRevenue) * 100 : 0
  const costPieData = [
    { name: 'Labor', value: summary.laborCost },
    { name: 'Equipment', value: summary.equipCost },
    { name: 'Expenses', value: summary.expCost },
  ].filter((d) => d.value > 0)

  const selectCls = 'rounded-lg border border-[#2a2a2a] bg-[#141414] py-1.5 pl-3 pr-8 text-sm font-medium text-slate-300 focus:border-brand-500 focus:outline-none'
  const presetCls = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-semibold transition ${
      active ? 'bg-brand-600 text-white' : 'border border-[#2a2a2a] text-slate-500 hover:border-brand-600 hover:text-slate-300'
    }`

  return (
    <div className="space-y-5">
      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">P&L Command Center</h1>
          <p className="text-xs text-slate-500">{rangeLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Date presets */}
          {([
            { label: 'This week', preset: 'thisWeek' as const },
            { label: 'Last week', preset: 'lastWeek' as const },
            { label: '2 wks',     preset: '2weeks'   as const },
            { label: '4 wks',     preset: '4weeks'   as const },
            { label: 'Month',     preset: 'thisMonth' as const },
          ]).map(({ label, preset }) => {
            const t = new Date().toISOString().slice(0, 10)
            let ps = '', pe = ''
            if (preset === 'thisWeek')       { ps = weekStart(t); pe = weekEnd(t) }
            else if (preset === 'lastWeek')  { const d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 7); const lw = d.toISOString().slice(0, 10); ps = weekStart(lw); pe = weekEnd(lw) }
            else if (preset === '2weeks')    { const d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 7); ps = weekStart(d.toISOString().slice(0, 10)); pe = weekEnd(t) }
            else if (preset === '4weeks')    { const d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 21); ps = weekStart(d.toISOString().slice(0, 10)); pe = weekEnd(t) }
            else if (preset === 'thisMonth') { const d = new Date(t + 'T00:00:00'); ps = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; pe = t }
            return <button key={label} onClick={() => setPreset(preset)} className={presetCls(wStart === ps && wEnd === pe)}>{label}</button>
          })}
          <div className="flex items-center gap-1">
            <input type="date" value={rangeStart} onChange={(e) => e.target.value && setRangeStart(e.target.value)}
              className="rounded-lg border border-[#2a2a2a] bg-[#141414] px-2 py-1 text-xs text-slate-400 focus:outline-none" />
            <span className="text-slate-600">–</span>
            <input type="date" value={rangeEnd} min={rangeStart} onChange={(e) => e.target.value && setRangeEnd(e.target.value)}
              className="rounded-lg border border-[#2a2a2a] bg-[#141414] px-2 py-1 text-xs text-slate-400 focus:outline-none" />
          </div>
          {/* Filters */}
          <select value={activeProject} onChange={(e) => handleProjectChange(e.target.value)} className={selectCls}>
            <option value="all">All projects</option>
            {clientScopedProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={activeCrew} onChange={(e) => setActiveCrew(e.target.value)} className={selectCls}>
            <option value="all">All crews</option>
            {crewsForScope.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {(activeProject !== 'all' || activeCrew !== 'all') && (
            <button onClick={() => { setActiveProject('all'); setActiveCrew('all') }}
              className="rounded-lg border border-[#2a2a2a] px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300">
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

      {/* ── Charts row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Revenue vs Cost bar chart */}
        <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-5 lg:col-span-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Revenue vs Cost vs Profit</p>
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
        <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-5 lg:col-span-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Cost Breakdown</p>
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
                <p className="text-xs text-slate-500">Total Cost</p>
                <p className="text-lg font-bold text-white">{money(summary.totalCost)}</p>
                {costPieData.map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2.5 w-2.5 rounded-sm" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-xs text-slate-400">{d.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-semibold text-slate-300">{money(d.value)}</span>
                      <span className="ml-1 text-xs text-slate-600">
                        {summary.totalCost > 0 ? `${Math.round(d.value / summary.totalCost * 100)}%` : '0%'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-8 text-center text-sm text-slate-600">No cost data</p>
          )}
        </div>
      </div>

      {/* ── Crew performance + margin chart ──────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Crew performance table */}
        <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] lg:col-span-3">
          <div className="flex items-center justify-between px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Crew Performance</p>
            <span className="text-xs text-slate-600">{rangeLabel}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-y border-[#1e1e1e] text-left">
                  {['Crew','Hours','Footage','Ft/Hr','Net Revenue','Labor','Equipment','Expenses','Profit','Margin'].map((h) => (
                    <th key={h} className="px-4 py-2 font-semibold uppercase tracking-wide text-slate-600 first:pl-5 last:pr-5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {crewPerf.length === 0 ? (
                  <tr><td colSpan={10} className="px-5 py-8 text-center text-slate-600">No production data for this period.</td></tr>
                ) : crewPerf.map((r) => (
                  <tr key={r.crew.id} className="border-b border-[#1a1a1a] hover:bg-white/3">
                    <td className="py-2.5 pl-5 font-medium text-slate-200">{r.crew.name}</td>
                    <td className="px-4 py-2.5 text-slate-400">{r.hours.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-slate-400">{number(r.footage)}</td>
                    <td className="px-4 py-2.5 text-slate-400">{r.ftPerHr.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-slate-300">{money(r.netRevenue)}</td>
                    <td className="px-4 py-2.5 text-slate-400">{money(r.laborCost)}</td>
                    <td className="px-4 py-2.5 text-slate-400">{money(r.equipCost)}</td>
                    <td className="px-4 py-2.5 text-slate-400">{money(r.expCost)}</td>
                    <td className={`px-4 py-2.5 font-semibold ${r.profit >= 0 ? 'text-brand-400' : 'text-rose-400'}`}>{money(r.profit)}</td>
                    <td className={`py-2.5 pr-5 font-semibold ${r.margin >= 0.3 ? 'text-emerald-400' : r.margin >= 0.1 ? 'text-brand-400' : 'text-rose-400'}`}>
                      {(r.margin * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              {crewPerf.length > 1 && (
                <tfoot>
                  <tr className="border-t border-[#2a2a2a] bg-[#1a1a1a]">
                    <td className="py-2.5 pl-5 font-bold text-slate-300">TOTAL</td>
                    <td className="px-4 py-2.5 font-bold text-slate-300">{crewPerf.reduce((s,r)=>s+r.hours,0).toFixed(1)}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-300">{number(crewPerf.reduce((s,r)=>s+r.footage,0))}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-300">
                      {crewPerf.reduce((s,r)=>s+r.hours,0) > 0
                        ? (crewPerf.reduce((s,r)=>s+r.footage,0) / crewPerf.reduce((s,r)=>s+r.hours,0)).toFixed(1)
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-bold text-slate-200">{money(summary.netRevenue)}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-300">{money(summary.laborCost)}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-300">{money(summary.equipCost)}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-300">{money(summary.expCost)}</td>
                    <td className="px-4 py-2.5 font-bold text-brand-400">{money(summary.ebitda)}</td>
                    <td className="py-2.5 pr-5 font-bold text-brand-400">{marginPct.toFixed(1)}%</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Profit margin % line chart */}
        <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-5 lg:col-span-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Profit Margin %</p>
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
        <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] xl:col-span-2">
          <div className="flex items-center justify-between px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Active Projects</p>
            <Link to="/projects" className="text-xs text-brand-500 hover:text-brand-400">View all →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-y border-[#1e1e1e]">
                  {['Project', 'Client', 'Progress', 'Contract', 'Revenue (period)'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left font-semibold uppercase tracking-wide text-slate-600 first:pl-5 last:pr-5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeFiltered.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-600">No active projects.</td></tr>
                ) : activeFiltered.map((p) => {
                  const pct = projectProgress(p)
                  const wkRevenue = data.pnl
                    .filter((e) => e.projectId === p.id && e.date >= wStart && e.date <= wEnd)
                    .reduce((s, e) => s + e.revenue, 0)
                  return (
                    <tr key={p.id} className="border-b border-[#1a1a1a] hover:bg-white/3">
                      <td className="py-2.5 pl-5">
                        <Link to={`/projects/${p.id}`} className="font-medium text-slate-200 hover:text-brand-400">{p.name}</Link>
                        <div className="mt-1 h-1 w-28 overflow-hidden rounded-full bg-[#2a2a2a]">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct * 100}%` }} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{p.client}</td>
                      <td className="px-4 py-2.5 text-slate-400">{percent(pct)}</td>
                      <td className="px-4 py-2.5 text-slate-300">{money(p.contractValue)}</td>
                      <td className="py-2.5 pr-5 font-semibold text-brand-400">{wkRevenue > 0 ? money(wkRevenue) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Per-foot metrics */}
        <div className="flex flex-col gap-4">
          <div className="flex-1 rounded-xl border border-[#2a2a2a] bg-[#141414] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Cost Per Foot</p>
            <p className="mt-2 text-3xl font-extrabold text-white">
              {summary.footage > 0 ? `$${(summary.totalCost / summary.footage).toFixed(2)}` : '—'}
            </p>
            <p className="mt-1 text-xs text-slate-600">{number(summary.footage)} ft · {money(summary.totalCost)} total cost</p>
          </div>
          <div className="flex-1 rounded-xl border border-[#2a2a2a] bg-[#141414] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Net Rev Per Foot</p>
            <p className="mt-2 text-3xl font-extrabold text-brand-400">
              {summary.footage > 0 ? `$${(summary.netRevenue / summary.footage).toFixed(2)}` : '—'}
            </p>
            <p className="mt-1 text-xs text-slate-600">{number(summary.footage)} ft · {money(summary.netRevenue)} net rev</p>
          </div>
          <div className="flex-1 rounded-xl border border-[#2a2a2a] bg-[#141414] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Footage Placed</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-200">{number(summary.footage)}<span className="ml-1 text-sm font-normal text-slate-500">ft</span></p>
            <p className="mt-1 text-xs text-slate-600">{activeFiltered.length} active project{activeFiltered.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {/* ── Detailed weekly summary (existing card, kept for drill-down) ───────── */}
      <div className="rounded-xl border border-[#2a2a2a]">
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
  const { isAdmin } = useRole()
  return isAdmin ? <AdminDashboard /> : <FieldDashboard />
}
