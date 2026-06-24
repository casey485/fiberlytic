import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Activity, DollarSign, FolderKanban, TrendingUp, TrendingDown } from 'lucide-react'
import { useData } from '../store/DataContext'
import { StatCard } from '../components/ui/StatCard'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { money, moneyExact, number, percent, projectStatusMeta } from '../lib/format'
import { computeMetrics, projectProgress, weekStart, weekEnd } from '../lib/analytics'
import { memberCost } from '../lib/laborCost'
import { Badge } from '../components/ui/Badge'
import type { Crew } from '../types'

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

// ── One card per crew — everything for that crew in one place ─────────────────

function CrewCard({ crew, wStart, wEnd, weekdays }: { crew: Crew; wStart: string; wEnd: string; weekdays: number }) {
  const { data } = useData()

  // Production this week for this crew
  const crewProd = data.production.filter((e) => e.crewId === crew.id && e.date >= wStart && e.date <= wEnd)
  const footage  = crewProd.reduce((s, e) => s + e.footage, 0)
  const prodIds  = new Set(crewProd.map((e) => e.id))

  // Revenue from P&L entries tied to this crew's production
  const crewPnl  = data.pnl.filter((e) => e.date >= wStart && e.date <= wEnd && e.productionEntryId && prodIds.has(e.productionEntryId))
  const revenue  = crewPnl.reduce((s, e) => s + e.revenue, 0)

  // Hours from production entries this week
  const hoursFromProd = crewProd.reduce((s, e) => s + e.hours, 0)

  // If no hours this week, find the most recent week that has any data for this crew.
  // Seed data is generated relative to when the app was first loaded, so it may
  // predate the current calendar week by weeks or months.
  let totalHours  = hoursFromProd
  let hoursLabel  = 'this wk'
  if (hoursFromProd === 0) {
    const allCrewProd = [...data.production]
      .filter((e) => e.crewId === crew.id)
      .sort((a, b) => b.date.localeCompare(a.date))
    if (allCrewProd.length > 0) {
      const rWkStart = weekStart(allCrewProd[0].date)
      const rWkEnd   = weekEnd(allCrewProd[0].date)
      const rHours   = allCrewProd
        .filter((e) => e.date >= rWkStart && e.date <= rWkEnd)
        .reduce((s, e) => s + e.hours, 0)
      if (rHours > 0) {
        totalHours = rHours
        const d = new Date(rWkStart + 'T00:00:00')
        hoursLabel = `wk of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      }
    }
  }

  // Per-employee breakdown: timecards tied to ANY of this crew's production entries
  // (not just this week's) so employees show even if production spans weeks
  const allCrewProdIds = new Set(
    data.production.filter((e) => e.crewId === crew.id).map((e) => e.id)
  )
  const crewTc = data.timecards.filter(
    (t) => t.date >= wStart && t.date <= wEnd &&
           t.productionEntryId && allCrewProdIds.has(t.productionEntryId),
  )
  const empMap = new Map<string, { hours: number; cost: number }>()
  for (const tc of crewTc) {
    const cur = empMap.get(tc.employeeId) ?? { hours: 0, cost: 0 }
    empMap.set(tc.employeeId, { hours: cur.hours + tc.hours, cost: cur.cost + tc.laborCost })
  }
  const empRows = [...empMap.entries()].map(([id, v]) => ({ emp: data.employees.find((e) => e.id === id), ...v }))

  // When production was logged via the simple form (not crew day entry), timecards don't
  // exist. Synthesize per-member rows from crew.members using the same memberCost formula.
  const syntheticRows = empRows.length === 0 && crewProd.length > 0
    ? crew.members.filter((m) => m.active).map((m) => ({
        m,
        cost: Math.round(crewProd.reduce((s, pe) => s + memberCost(m, pe.hours, pe.footage), 0)),
        hours: m.payType === 'hourly' ? crewProd.reduce((s, pe) => s + pe.hours, 0) : null,
      }))
    : []

  const laborCost  = empRows.length > 0
    ? empRows.reduce((s, r) => s + r.cost, 0)
    : crewPnl.reduce((s, e) => s + e.laborCost, 0)

  // Equipment assigned to this crew
  const equipRows = data.equipment
    .filter((eq) => eq.active && eq.crewId === crew.id)
    .map((eq) => ({ eq, daily: eq.monthlyCost / 21, weekCost: Math.round(eq.monthlyCost / 21 * weekdays) }))
  const equipCost = equipRows.reduce((s, r) => s + r.weekCost, 0)

  // Expenses for this crew this week
  const expenses  = data.jobExpenses.filter((ex) => ex.crewId === crew.id && ex.date >= wStart && ex.date <= wEnd)
    .sort((a, b) => a.date.localeCompare(b.date))
  const expCost   = expenses.reduce((s, ex) => s + ex.amount, 0)

  const totalCost = laborCost + equipCost + expCost
  const profit    = revenue - totalCost
  const margin    = revenue > 0 ? profit / revenue : 0
  const proj      = crew.currentProjectId ? data.projects.find((p) => p.id === crew.currentProjectId) : null

  return (
    <Card className="overflow-hidden">
      {/* ── Header ── */}
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-800">{crew.name}</h3>
              <Badge tone={crew.status === 'active' ? 'green' : 'slate'}>{crew.status}</Badge>
            </div>
            {proj      && <p className="mt-0.5 text-xs text-slate-400">Project: {proj.name}</p>}
            {crew.foreman && <p className="text-xs text-slate-500">Foreman: {crew.foreman}</p>}
          </div>

          {/* Quick stats */}
          <div className="flex flex-wrap gap-5 text-right text-sm">
            <div>
              <p className="text-[11px] text-slate-400">Footage</p>
              <p className="font-bold text-slate-800">{number(footage)} ft</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Hours {hoursLabel}</p>
              <p className="font-bold text-slate-800">{totalHours > 0 ? `${totalHours.toFixed(1)} h` : '—'}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Revenue</p>
              <p className="font-bold text-emerald-700">{money(revenue)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Total Cost</p>
              <p className="font-bold text-rose-600">{money(totalCost)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Net</p>
              <p className={`flex items-center gap-1 font-bold ${profit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                {profit >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {money(profit)}
              </p>
              {revenue > 0 && <p className="text-[10px] text-slate-400">{percent(margin, 1)} margin</p>}
            </div>
          </div>
        </div>
      </div>

      {/* ── Crew members ── */}
      {(empRows.length > 0 || crew.members.filter((m) => m.active).length > 0) && (
        <>
          <SubLabel>Crew members</SubLabel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="px-5 py-1.5 font-medium">Name</th>
                <th className="px-5 py-1.5 font-medium">Role</th>
                <th className="px-5 py-1.5 text-right font-medium">Hrs (wk total)</th>
                <th className="px-5 py-1.5 text-right font-medium">Rate</th>
                <th className="px-5 py-1.5 text-right font-medium">Wk Cost</th>
              </tr>
            </thead>
            <tbody>
              {empRows.length > 0
                ? empRows.map(({ emp, hours, cost }, i) => (
                    <tr key={emp?.id ?? i} className="border-t border-slate-50 hover:bg-slate-50/40">
                      <td className="px-5 py-1.5 font-medium text-slate-800">{emp?.name ?? '—'}</td>
                      <td className="px-5 py-1.5 text-slate-500">{emp?.role ?? '—'}</td>
                      <td className="px-5 py-1.5 text-right text-slate-700">{hours.toFixed(1)} h</td>
                      <td className="px-5 py-1.5 text-right text-slate-400">${emp?.hourlyRate?.toFixed(2) ?? '—'}/h</td>
                      <td className="px-5 py-1.5 text-right font-semibold text-slate-800">{money(cost)}</td>
                    </tr>
                  ))
                : syntheticRows.length > 0
                ? syntheticRows.map(({ m, hours, cost }) => (
                    <tr key={m.id} className="border-t border-slate-50 hover:bg-slate-50/40">
                      <td className="px-5 py-1.5 font-medium text-slate-800">{m.name}</td>
                      <td className="px-5 py-1.5 text-slate-500">{m.role}</td>
                      <td className="px-5 py-1.5 text-right text-slate-700">
                        {hours !== null ? `${hours.toFixed(1)} h` : '—'}
                      </td>
                      <td className="px-5 py-1.5 text-right text-slate-400">
                        {m.payType === 'hourly' ? `$${m.payAmount}/h` : m.payType === 'daily' ? `$${m.payAmount}/day` : `$${m.payAmount}/ft`}
                      </td>
                      <td className="px-5 py-1.5 text-right font-semibold text-slate-800">
                        {cost > 0 ? money(cost) : '—'}
                      </td>
                    </tr>
                  ))
                : crew.members.filter((m) => m.active).map((m) => (
                    <tr key={m.id} className="border-t border-slate-50 hover:bg-slate-50/40">
                      <td className="px-5 py-1.5 font-medium text-slate-800">{m.name}</td>
                      <td className="px-5 py-1.5 text-slate-500">{m.role}</td>
                      <td className="px-5 py-1.5 text-right text-slate-400">—</td>
                      <td className="px-5 py-1.5 text-right text-slate-400">
                        {m.payType === 'hourly' ? `$${m.payAmount}/h` : m.payType === 'daily' ? `$${m.payAmount}/day` : `$${m.payAmount}/ft`}
                      </td>
                      <td className="px-5 py-1.5 text-right text-slate-400">—</td>
                    </tr>
                  ))
              }
            </tbody>
            {laborCost > 0 && (
              <tfoot>
                <tr className="border-t border-slate-100 bg-slate-50/60">
                  <td colSpan={4} className="px-5 py-1.5 text-right text-xs font-semibold text-slate-400">Labor subtotal</td>
                  <td className="px-5 py-1.5 text-right font-bold text-brand-700">{money(laborCost)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </>
      )}

      {/* ── Equipment ── */}
      {equipRows.length > 0 && (
        <>
          <SubLabel>Equipment</SubLabel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="px-5 py-1.5 font-medium">Item</th>
                <th className="px-5 py-1.5 font-medium">Category</th>
                <th className="px-5 py-1.5 text-right font-medium">Daily rate</th>
                <th className="px-5 py-1.5 text-right font-medium">Days</th>
                <th className="px-5 py-1.5 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {equipRows.map(({ eq, daily, weekCost }) => (
                <tr key={eq.id} className="border-t border-slate-50 hover:bg-slate-50/40">
                  <td className="px-5 py-1.5 font-medium text-slate-800">{eq.name}</td>
                  <td className="px-5 py-1.5 text-slate-500">{eq.category}</td>
                  <td className="px-5 py-1.5 text-right text-slate-400">{money(daily)}</td>
                  <td className="px-5 py-1.5 text-right text-slate-400">{weekdays}</td>
                  <td className="px-5 py-1.5 text-right font-semibold text-slate-800">{money(weekCost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-100 bg-slate-50/60">
                <td colSpan={4} className="px-5 py-1.5 text-right text-xs font-semibold text-slate-400">Equipment subtotal</td>
                <td className="px-5 py-1.5 text-right font-bold text-purple-700">{money(equipCost)}</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}

      {/* ── Expenses ── */}
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

      {/* ── Cost summary footer ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-slate-200 bg-slate-50 px-5 py-3 text-sm">
        <div className="flex flex-wrap gap-5">
          {laborCost > 0 && <span className="text-slate-500">Labor <strong className="text-brand-700">{money(laborCost)}</strong></span>}
          {equipCost > 0 && <span className="text-slate-500">Equipment <strong className="text-purple-700">{money(equipCost)}</strong></span>}
          {expCost   > 0 && <span className="text-slate-500">Expenses <strong className="text-amber-700">{money(expCost)}</strong></span>}
          {totalCost === 0 && <span className="text-slate-400">No costs this week</span>}
        </div>
        <div className="flex gap-5 font-semibold">
          <span className="text-slate-600">Total Cost <span className="text-rose-600">{money(totalCost)}</span></span>
          <span className="text-slate-600">Revenue <span className="text-emerald-700">{money(revenue)}</span></span>
          <span className={profit >= 0 ? 'text-emerald-700' : 'text-rose-600'}>Net {money(profit)}</span>
        </div>
      </div>
    </Card>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function Dashboard() {
  const { data } = useData()

  const today  = new Date().toISOString().slice(0, 10)
  const wStart = weekStart(today)
  const wEnd   = weekEnd(today)

  const metricsWeek = useMemo(
    () => computeMetrics(data, { startDate: wStart, endDate: wEnd }),
    [data, wStart, wEnd],
  )

  const weekdays = weekdaysInRange(wStart, wEnd)

  const footageWeek = data.production
    .filter((e) => e.date >= wStart && e.date <= wEnd)
    .reduce((s, e) => s + e.footage, 0)

  const activeProjects = data.projects.filter((p) => p.status === 'active')
  const allCrews = data.crews.filter((c) => c.status !== 'off')
  const totalCost = metricsWeek.labor + metricsWeek.equipment + metricsWeek.expenses

  const weekLabel = `Week of ${new Date(wStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(wEnd + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  return (
    <div>
      <PageHeader title="Dashboard" description={weekLabel} />

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Footage"         value={`${number(footageWeek)} ft`}    icon={<Activity size={20} />}     hint="placed this week" />
        <StatCard label="Revenue"         value={money(metricsWeek.revenue)}      icon={<DollarSign size={20} />}   hint="this week" />
        <StatCard label="Total Cost"      value={money(totalCost)}                icon={<TrendingDown size={20} />} hint="labor + equip + expenses" />
        <StatCard
          label="Net Profit"
          value={money(metricsWeek.profit)}
          icon={<TrendingUp size={20} />}
          trend={{ value: percent(metricsWeek.margin, 1), positive: metricsWeek.profit >= 0 }}
          hint="margin"
        />
        <StatCard label="Active Projects" value={String(activeProjects.length)}  icon={<FolderKanban size={20} />} hint={`${data.projects.length} total`} />
      </div>

      {/* ── One card per crew — everything together ── */}
      <div className="mt-6 space-y-6">
        {allCrews.length === 0 && (
          <Card><CardBody><p className="text-sm text-slate-400">No crews set up yet.</p></CardBody></Card>
        )}
        {allCrews.map((crew) => (
          <CrewCard key={crew.id} crew={crew} wStart={wStart} wEnd={wEnd} weekdays={weekdays} />
        ))}
      </div>

      {/* ── Active projects ── */}
      <Card className="mt-6">
        <CardHeader
          title="Active projects"
          subtitle={`${activeProjects.length} in progress`}
          action={<Link to="/projects" className="text-xs font-medium text-brand-600 hover:text-brand-700">View all</Link>}
        />
        <CardBody className="p-0">
          {activeProjects.length === 0 ? (
            <div className="px-5 py-8 text-sm text-slate-400">No active projects.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5 font-medium">Project</th>
                  <th className="px-5 py-2.5 font-medium">Client</th>
                  <th className="px-5 py-2.5 text-right font-medium">Progress</th>
                  <th className="px-5 py-2.5 text-right font-medium">Contract</th>
                  <th className="px-5 py-2.5 text-right font-medium">Revenue this wk</th>
                </tr>
              </thead>
              <tbody>
                {activeProjects.map((p) => {
                  const pct = projectProgress(p)
                  const wkRevenue = metricsWeek.byProject.get(p.id)?.revenue ?? 0
                  return (
                    <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <Link to={`/projects/${p.id}`} className="font-medium text-slate-800 hover:text-brand-600">{p.name}</Link>
                        <div className="mt-1.5 h-1.5 w-36 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-fiber-500" style={{ width: `${pct * 100}%` }} />
                        </div>
                        <p className="mt-0.5 text-xs text-slate-400">{number(p.footageComplete)} / {number(p.footageGoal)} ft</p>
                      </td>
                      <td className="px-5 py-3 text-slate-500">{p.client}</td>
                      <td className="px-5 py-3 text-right">
                        <Badge tone={projectStatusMeta[p.status].tone}>{percent(pct)}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-slate-700">{money(p.contractValue)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-emerald-700">
                        {wkRevenue > 0 ? money(wkRevenue) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
