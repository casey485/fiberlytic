import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { Select, Input } from '../components/ui/Form'
import { weekStart, weekEnd, weekDates } from '../lib/analytics'
import { money, moneyExact } from '../lib/format'
import { calculateProductionPay } from '../lib/productionPay'
import type { ProductionEntry, ProductionLineItem, ProductionPayAllocation } from '../types'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function shiftWeek(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n * 7)
  return d.toISOString().slice(0, 10)
}

function MetricTile({
  label, value, sub, tone = 'neutral',
}: { label: string; value: string; sub?: string; tone?: 'neutral' | 'green' }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold ${tone === 'green' ? 'text-emerald-700' : 'text-slate-800'}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Allocate Production — admin manually attributes part (or all) of a crew's
// production-entry quantity to specific employees. Nothing today ties
// quantity to an individual automatically, so this step is deliberately
// explicit rather than computed (confirmed with the business owner).
// ---------------------------------------------------------------------------

function AllocationLineRow({
  entry,
  lineItem,
  projectName,
  crewName,
  allocations,
  employees,
  findRate,
  onAdd,
  onDelete,
}: {
  entry: ProductionEntry
  lineItem: ProductionLineItem
  projectName: string
  crewName: string
  allocations: ProductionPayAllocation[]
  employees: { id: string; name: string }[]
  findRate: (employeeId: string, unitCode: string, asOfDate: string) => boolean
  onAdd: (employeeId: string, quantity: number) => void
  onDelete: (id: string) => void
}) {
  const [empId, setEmpId] = useState('')
  const [qty, setQty] = useState('')
  const allocatedSoFar = allocations.reduce((s, a) => s + a.quantity, 0)
  const remaining = Math.max(0, lineItem.quantity - allocatedSoFar)

  return (
    <tr className="border-b border-slate-50 align-top">
      <td className="px-3 py-2 text-xs text-slate-500">{entry.date}</td>
      <td className="px-3 py-2 text-xs text-slate-500">{projectName}{crewName ? ` · ${crewName}` : ''}</td>
      <td className="px-3 py-2 font-mono text-xs font-semibold text-brand-700">{lineItem.unitCode}</td>
      <td className="px-3 py-2 text-xs text-slate-600">{lineItem.description}</td>
      <td className="px-3 py-2 text-right text-xs text-slate-700">
        {lineItem.quantity} {lineItem.uom}
        {remaining > 0 && <span className="ml-1.5 text-amber-600">({remaining} unallocated)</span>}
      </td>
      <td className="px-3 py-2">
        <div className="space-y-1">
          {allocations.map((a) => {
            const emp = employees.find((e) => e.id === a.employeeId)
            const hasRate = findRate(a.employeeId, lineItem.unitCode, entry.date)
            return (
              <div key={a.id} className="flex items-center gap-2 text-xs">
                <span className="text-slate-700">{emp?.name ?? '—'}</span>
                <span className="text-slate-400">· {a.quantity} {lineItem.uom}</span>
                {!hasRate && (
                  <span className="flex items-center gap-1 text-amber-600" title="No production pay rate found for this employee and unit.">
                    <AlertTriangle size={11} /> No rate
                  </span>
                )}
                <button onClick={() => onDelete(a.id)} className="text-slate-300 hover:text-rose-600" aria-label="Remove allocation">
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
          <div className="flex items-center gap-1.5 pt-1">
            <Select value={empId} onChange={(e) => setEmpId(e.target.value)} className="!h-7 !py-0 text-xs">
              <option value="">Assign to…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
            <Input
              type="number" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)}
              placeholder="Qty" className="!h-7 w-20 !py-0 text-xs"
            />
            <button
              onClick={() => {
                const q = parseFloat(qty)
                if (empId && q > 0) { onAdd(empId, q); setEmpId(''); setQty('') }
              }}
              className="rounded p-1 text-slate-400 hover:text-brand-600"
              aria-label="Add allocation"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

function AllocateProductionSection({ wStart, wEnd }: { wStart: string; wEnd: string }) {
  const {
    data, addProductionPayAllocation, deleteProductionPayAllocation,
  } = useData()
  const [expanded, setExpanded] = useState(false)

  const entries = useMemo(
    () => data.production.filter((e) => e.date >= wStart && e.date <= wEnd),
    [data.production, wStart, wEnd],
  )
  const entryIds = useMemo(() => new Set(entries.map((e) => e.id)), [entries])
  const lineItems = useMemo(
    () => data.productionLineItems.filter((li) => entryIds.has(li.productionEntryId)),
    [data.productionLineItems, entryIds],
  )
  const entriesById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])
  const allocationsByLineItem = useMemo(() => {
    const map = new Map<string, ProductionPayAllocation[]>()
    for (const a of data.productionPayAllocations) {
      if (!map.has(a.productionLineItemId)) map.set(a.productionLineItemId, [])
      map.get(a.productionLineItemId)!.push(a)
    }
    return map
  }, [data.productionPayAllocations])

  const employees = useMemo(
    () => data.employees.filter((e) => e.active).map((e) => ({ id: e.id, name: e.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [data.employees],
  )

  const findRate = (employeeId: string, unitCode: string, asOfDate: string) =>
    data.employeeProductionRates.some(
      (r) => r.employeeId === employeeId && r.unitCode === unitCode && r.active && r.effectiveDate <= asOfDate,
    )

  const totalLines = lineItems.length
  const unallocatedCount = lineItems.filter((li) => {
    const allocated = (allocationsByLineItem.get(li.id) ?? []).reduce((s, a) => s + a.quantity, 0)
    return allocated < li.quantity
  }).length

  return (
    <Card className="mb-6">
      <CardHeader
        title={
          <button className="flex items-center gap-1.5 text-left" onClick={() => setExpanded((x) => !x)}>
            {expanded ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronUp size={15} className="text-slate-400" />}
            Allocate Production
          </button>
        }
        subtitle={
          totalLines === 0
            ? 'No production entries this week'
            : `${totalLines} line item${totalLines === 1 ? '' : 's'} this week · ${unallocatedCount} not fully allocated`
        }
      />
      {expanded && (
        <CardBody className="p-0">
          {lineItems.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-400">No production entries logged in this week's date range.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Project / Crew</th>
                  <th className="px-3 py-2 font-medium">Unit</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Quantity</th>
                  <th className="px-3 py-2 font-medium">Allocations</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li) => {
                  const entry = entriesById.get(li.productionEntryId)
                  if (!entry) return null
                  const project = data.projects.find((p) => p.id === entry.projectId)
                  const crew = data.crews.find((c) => c.id === entry.crewId)
                  return (
                    <AllocationLineRow
                      key={li.id}
                      entry={entry}
                      lineItem={li}
                      projectName={project?.name ?? '—'}
                      crewName={crew?.name ?? ''}
                      allocations={allocationsByLineItem.get(li.id) ?? []}
                      employees={employees}
                      findRate={findRate}
                      onAdd={(employeeId, quantity) =>
                        addProductionPayAllocation({ productionEntryId: entry.id, productionLineItemId: li.id, employeeId, quantity, createdBy: null })
                      }
                      onDelete={deleteProductionPayAllocation}
                    />
                  )
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function PayStubs() {
  const { data } = useData()
  const { isAdmin } = useRole()
  const [weekOffset, setWeekOffset] = useState(0)
  const [showAll, setShowAll] = useState(false)

  const today   = new Date().toISOString().slice(0, 10)
  const refDate = useMemo(() => shiftWeek(today, weekOffset), [today, weekOffset])
  const wStart  = weekStart(refDate)
  const wEnd    = weekEnd(refDate)
  const dates   = weekDates(refDate) // Mon–Sun, 7 dates

  const isCurrentWeek = weekOffset === 0
  const weekLabel = `${new Date(wStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(wEnd + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  // Production entries/line items/allocations within this week's range —
  // shared by both the Allocate Production section and each employee's
  // production-pay figure below.
  const productionPeriod = useMemo(() => {
    const entries = data.production.filter((e) => e.date >= wStart && e.date <= wEnd)
    const entryIds = new Set(entries.map((e) => e.id))
    const lineItems = data.productionLineItems.filter((li) => entryIds.has(li.productionEntryId))
    const lineItemIds = new Set(lineItems.map((li) => li.id))
    const allocations = data.productionPayAllocations.filter((a) => lineItemIds.has(a.productionLineItemId))
    return {
      allocations,
      entriesById: new Map(entries.map((e) => [e.id, e])),
      lineItemsById: new Map(lineItems.map((li) => [li.id, li])),
    }
  }, [data.production, data.productionLineItems, data.productionPayAllocations, wStart, wEnd])

  const rows = useMemo(() => {
    const weekClock = (data.clockEntries ?? []).filter(
      (ce) => ce.clockIn.slice(0, 10) >= wStart && ce.clockIn.slice(0, 10) <= wEnd && !!ce.clockOut,
    )

    return data.employees
      .filter((e) => e.active)
      .map((emp) => {
        const empClock = weekClock.filter((ce) => ce.employeeId === emp.id)

        const byDate: Record<string, { hours: number; pay: number }> = {}
        for (const d of dates) {
          const hrs = empClock
            .filter((ce) => ce.clockIn.slice(0, 10) === d)
            .reduce((s, ce) => s + (new Date(ce.clockOut!).getTime() - new Date(ce.clockIn).getTime()) / 3_600_000, 0)
          byDate[d] = { hours: hrs, pay: hrs * emp.hourlyRate }
        }

        const totalHours = empClock.reduce(
          (s, ce) => s + (new Date(ce.clockOut!).getTime() - new Date(ce.clockIn).getTime()) / 3_600_000,
          0,
        )
        const hourlyPay = totalHours * emp.hourlyRate

        const production = calculateProductionPay(
          emp.id, productionPeriod.allocations, productionPeriod.lineItemsById, productionPeriod.entriesById,
          data.employeeProductionRates,
        )
        const missingRateCount = production.lines.filter((l) => !l.rate).length
        const totalPay = hourlyPay + production.total

        const crewIdSet = new Set<string>()
        for (const ce of empClock) { if (ce.crewId) crewIdSet.add(ce.crewId) }
        if (crewIdSet.size === 0 && emp.defaultCrewId) crewIdSet.add(emp.defaultCrewId)
        const crewNames = [...crewIdSet]
          .map((id) => data.crews.find((c) => c.id === id)?.name)
          .filter(Boolean)
          .join(', ')

        return {
          emp, byDate, totalHours, hourlyPay, productionPay: production.total, missingRateCount, totalPay, crewNames,
          hasWork: totalHours > 0 || production.lines.length > 0,
        }
      })
      .sort((a, b) => {
        if (a.hasWork && !b.hasWork) return -1
        if (!a.hasWork && b.hasWork) return 1
        if (a.hasWork && b.hasWork) return b.totalPay - a.totalPay
        return a.emp.name.localeCompare(b.emp.name)
      })
  }, [data.clockEntries, data.employees, data.crews, data.employeeProductionRates, productionPeriod, wStart, wEnd, dates])

  const display        = showAll ? rows : rows.filter((r) => r.hasWork)
  const workedCount     = rows.filter((r) => r.hasWork).length
  const totalHoursAll   = display.reduce((s, r) => s + r.totalHours, 0)
  const hourlyPayAll    = display.reduce((s, r) => s + r.hourlyPay, 0)
  const productionPayAll = display.reduce((s, r) => s + r.productionPay, 0)
  const totalPayAll     = display.reduce((s, r) => s + r.totalPay, 0)

  return (
    <div>
      <PageHeader
        title="Pay Stubs"
        description={`Week of ${weekLabel}`}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWeekOffset((o) => o - 1)}
              className="rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm hover:bg-slate-50"
              title="Previous week"
            >
              <ChevronLeft size={16} className="text-slate-600" />
            </button>
            {weekOffset !== 0 && (
              <button
                onClick={() => setWeekOffset(0)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50"
              >
                This Week
              </button>
            )}
            <button
              onClick={() => setWeekOffset((o) => o + 1)}
              disabled={weekOffset >= 0}
              className="rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              title="Next week"
            >
              <ChevronRight size={16} className="text-slate-600" />
            </button>
          </div>
        }
      />

      {/* Summary metrics */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricTile label="Employees Working" value={String(workedCount)} sub="this week" />
        <MetricTile label="Total Hours"        value={`${totalHoursAll.toFixed(1)} h`} />
        <MetricTile label="Hourly + Production" value={money(totalPayAll)} sub={`${money(hourlyPayAll)} hourly · ${money(productionPayAll)} production`} tone="green" />
        <MetricTile
          label="Avg Hrs / Employee"
          value={workedCount > 0 ? `${(totalHoursAll / workedCount).toFixed(1)} h` : '—'}
        />
      </div>

      {isAdmin && <AllocateProductionSection wStart={wStart} wEnd={wEnd} />}

      {/* Controls row */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {([
            { label: 'Worked This Week', val: false },
            { label: 'All Employees',    val: true  },
          ] as const).map(({ label, val }) => (
            <button
              key={label}
              onClick={() => setShowAll(val)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                showAll === val ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {isCurrentWeek && (
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            Live — totals update as clock entries are logged
          </p>
        )}
      </div>

      {/* Pay stub table */}
      <Card className="overflow-x-auto overflow-hidden">
        <CardBody className="p-0">
          {display.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-400">
              No clock entries found for this week.
            </div>
          ) : (
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Crew</th>
                  {dates.map((d, i) => (
                    <th
                      key={d}
                      className={`px-2 py-3 text-center font-medium ${d === today ? 'text-brand-600' : ''}`}
                    >
                      <span className="block">{DAY_LABELS[i]}</span>
                      <span className="block font-normal normal-case">{d.slice(5).replace('-', '/')}</span>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right font-medium">Total Hrs</th>
                  <th className="px-4 py-3 text-right font-medium">Rate</th>
                  <th className="px-4 py-3 text-right font-medium">Hourly Pay</th>
                  <th className="px-4 py-3 text-right font-medium">Production Pay</th>
                  <th className="px-5 py-3 text-right font-medium">Total Pay</th>
                </tr>
              </thead>
              <tbody>
                {display.map(({ emp, byDate, totalHours, hourlyPay, productionPay, missingRateCount, totalPay, crewNames, hasWork }) => (
                  <tr
                    key={emp.id}
                    className={`border-b border-slate-50 hover:bg-slate-50/60 ${!hasWork ? 'opacity-40' : ''}`}
                  >
                    {/* Employee */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-700">
                          {emp.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">{emp.name}</p>
                          <p className="text-[11px] text-slate-400">{emp.role}</p>
                        </div>
                      </div>
                    </td>
                    {/* Crew */}
                    <td className="px-4 py-3 text-xs text-slate-400">{crewNames || '—'}</td>
                    {/* Daily hours */}
                    {dates.map((d) => {
                      const h = byDate[d]?.hours ?? 0
                      const isToday = d === today
                      return (
                        <td
                          key={d}
                          className={`px-2 py-3 text-center ${isToday ? 'bg-brand-50/20' : ''}`}
                        >
                          {h > 0 ? (
                            <span className={`font-semibold ${isToday ? 'text-brand-700' : 'text-slate-700'}`}>
                              {h.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-slate-200">—</span>
                          )}
                        </td>
                      )
                    })}
                    {/* Total hours */}
                    <td className="px-4 py-3 text-right font-bold text-slate-800">
                      {totalHours > 0 ? `${totalHours.toFixed(1)} h` : '—'}
                    </td>
                    {/* Rate */}
                    <td className="px-4 py-3 text-right text-slate-400">
                      ${emp.hourlyRate.toFixed(2)}/h
                    </td>
                    {/* Hourly pay */}
                    <td className="px-4 py-3 text-right font-semibold text-slate-700">
                      {hourlyPay > 0 ? money(hourlyPay) : '—'}
                    </td>
                    {/* Production pay */}
                    <td className="px-4 py-3 text-right font-semibold text-slate-700">
                      {productionPay > 0 ? moneyExact(productionPay) : '—'}
                      {missingRateCount > 0 && (
                        <span
                          className="ml-1.5 inline-flex items-center gap-0.5 text-amber-600"
                          title="No production pay rate found for this employee and unit."
                        >
                          <AlertTriangle size={11} />
                        </span>
                      )}
                    </td>
                    {/* Total pay */}
                    <td className="px-5 py-3 text-right font-bold text-emerald-700">
                      {totalPay > 0 ? money(totalPay) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td colSpan={2} className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Week Totals
                  </td>
                  {dates.map((d) => {
                    const dayTotal = display.reduce((s, r) => s + (r.byDate[d]?.hours ?? 0), 0)
                    return (
                      <td key={d} className="px-2 py-2.5 text-center text-xs font-bold text-slate-600">
                        {dayTotal > 0 ? dayTotal.toFixed(1) : '—'}
                      </td>
                    )
                  })}
                  <td className="px-4 py-2.5 text-right font-bold text-slate-800">
                    {totalHoursAll.toFixed(1)} h
                  </td>
                  <td className="px-4 py-2.5" />
                  <td className="px-4 py-2.5 text-right font-bold text-slate-700">
                    {money(hourlyPayAll)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-700">
                    {moneyExact(productionPayAll)}
                  </td>
                  <td className="px-5 py-2.5 text-right font-bold text-emerald-700">
                    {money(totalPayAll)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
