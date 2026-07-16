import { useMemo, useState, useCallback } from 'react'
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select, Textarea } from '../components/ui/Form'
import { QaFilterBar } from '../components/QaFilterBar'
import { QaStatusBadge } from '../components/QaStatusBadge'
import { QaStatusFilterSelect, type QaStatusFilterValue } from '../components/QaStatusFilterSelect'
import { money, moneyExact, percent, formatDate, formatDateShort, localDateStr } from '../lib/format'
import { weekStart, weekEnd, computeMetrics, daysInMonth, computeQaRevenueBreakdown } from '../lib/analytics'
import { crewOrSubName } from '../lib/crewOrSub'
import { EMPTY_QA_FILTERS } from '../lib/qaReview'
import type { QaFilterState } from '../lib/qaReview'
import type { JobExpense, ProductionLineItem } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ---------------------------------------------------------------------------
// Add Expense Modal
// ---------------------------------------------------------------------------

type ExpForm = { date: string; jobId: string; vendor: string; description: string; amount: string }

function ExpenseModal({ onClose, defaultDate }: { onClose: () => void; defaultDate: string }) {
  const { data, addJobExpense } = useData()
  const [form, setForm] = useState<ExpForm>({
    date: defaultDate,
    jobId: data.projects[0]?.id ?? '',
    vendor: '',
    description: '',
    amount: '',
  })
  const set = <K extends keyof ExpForm>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const valid = form.jobId && form.description.trim() && parseFloat(form.amount) > 0

  const submit = () => {
    if (!valid) return
    addJobExpense({
      date: form.date,
      jobId: form.jobId,
      vendor: form.vendor.trim(),
      description: form.description.trim(),
      amount: Math.round(parseFloat(form.amount) * 100) / 100,
    })
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add expense"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={submit}>Save expense</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Project / job">
          <Select value={form.jobId} onChange={(e) => set('jobId', e.target.value)}>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Vendor (optional)">
          <Input value={form.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="e.g. Home Depot" />
        </Field>
        <Field label="Amount ($)">
          <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0.00" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What was purchased or expensed?" autoFocus />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Weekly P&L view (generated from production line items + timecards + expenses)
// ---------------------------------------------------------------------------

function WeeklyView() {
  const { data, deleteJobExpense } = useData()
  const { isAdmin } = useRole()
  const today = localDateStr()
  const [weekRef, setWeekRef] = useState(weekStart(today))
  const [projectFilter, setProjectFilter] = useState('all')
  const [qaFilter, setQaFilter] = useState<QaStatusFilterValue>('all')
  const [addExpense, setAddExpense] = useState(false)

  const wStart = weekRef
  const wEnd = weekEnd(weekRef)

  const prevWeek = () => setWeekRef(addDays(weekRef, -7))
  const nextWeek = () => setWeekRef(addDays(weekRef, 7))

  // A line item "matches" the active QA filter — 'none' means logged outside
  // the redline workflow entirely (no qaStatus at all).
  // Line items with no qaStatus at all (logged before the redline QA/QC
  // workflow existed, or via the plain Log Production/Log Crew Day flows)
  // are treated as implicitly "approved" — they were never submitted for
  // review, so there's nothing pending or rejected about them.
  const qaMatches = useCallback((status: string | undefined) => {
    if (qaFilter === 'all') return true
    return (status ?? 'approved') === qaFilter
  }, [qaFilter])

  // Revenue: production line items → production entries in this week
  const revenueRows = useMemo(() => {
    const rows: { id: string; date: string; projectId: string; unitCode: string; description: string; uom: string; qty: number; rate: number; total: number; qaStatus: ProductionLineItem['qaStatus'] }[] = []
    for (const li of data.productionLineItems) {
      const entry = data.production.find((e) => e.id === li.productionEntryId)
      if (!entry || entry.date < wStart || entry.date > wEnd) continue
      if (projectFilter !== 'all' && entry.projectId !== projectFilter) continue
      if (!qaMatches(li.qaStatus)) continue
      rows.push({
        id: li.id,
        date: entry.date,
        projectId: entry.projectId,
        unitCode: li.unitCode,
        description: li.description,
        uom: li.uom,
        qty: li.quantity,
        rate: li.rateSnapshot,
        total: li.extendedTotal,
        qaStatus: li.qaStatus,
      })
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date))
  }, [data.productionLineItems, data.production, wStart, wEnd, projectFilter, qaMatches])

  // Labor: timecards in this week
  const laborRows = useMemo(() => {
    return data.timecards
      .filter((tc) => tc.date >= wStart && tc.date <= wEnd && (projectFilter === 'all' || tc.jobId === projectFilter))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [data.timecards, wStart, wEnd, projectFilter])

  // PnL-based labor for production entries without real timecards (regular production flow)
  const pnlLaborRows = useMemo(() => {
    const tcEntryIds = new Set(data.timecards.map((tc) => tc.productionEntryId).filter(Boolean) as string[])
    return data.pnl.filter((e) => {
      if (e.date < wStart || e.date > wEnd) return false
      if (projectFilter !== 'all' && e.projectId !== projectFilter) return false
      if (e.laborCost <= 0) return false
      if (e.productionEntryId && tcEntryIds.has(e.productionEntryId)) return false
      return true
    }).sort((a, b) => a.date.localeCompare(b.date))
  }, [data.pnl, data.timecards, wStart, wEnd, projectFilter])

  // Use computeMetrics for the week — same function as Dashboard and daily ledger
  const weekMetrics = useMemo(
    () => computeMetrics(data, {
      startDate: wStart,
      endDate: wEnd,
      projectId: projectFilter !== 'all' ? projectFilter : undefined,
    }),
    [data, wStart, wEnd, projectFilter]
  )

  const weeklyEquipment = weekMetrics.equipment

  // Equipment detail rows (per-piece per-crew, for the equipment section)
  const weekEquipmentDetail = useMemo(() => {
    return data.equipment
      .filter((eq) => eq.active && eq.crewId && eq.deployedFrom)
      .map((eq) => {
        const crew = data.crews.find((c) => c.id === eq.crewId)
        if (!crew) return null
        if (projectFilter !== 'all' && crew.currentProjectId !== projectFilter) return null
        return { eq, crew }
      })
      .filter(Boolean) as { eq: typeof data.equipment[0]; crew: typeof data.crews[0] }[]
  }, [data, projectFilter])

  // Expenses: job expenses in this week
  const expenseRows = useMemo(() => {
    return data.jobExpenses
      .filter((ex) => ex.date >= wStart && ex.date <= wEnd && (projectFilter === 'all' || ex.jobId === projectFilter))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [data.jobExpenses, wStart, wEnd, projectFilter])

  // Production entries in this week — source of truth for the P&L production section
  const productionRows = useMemo(() => {
    const pnlByEntryId = new Map(
      data.pnl.filter((p) => p.productionEntryId).map((p) => [p.productionEntryId!, p])
    )
    return data.production
      .filter((pe) => {
        if (pe.date < wStart || pe.date > wEnd) return false
        if (projectFilter !== 'all' && pe.projectId !== projectFilter) return false
        if (qaFilter === 'all') return true
        const items = data.productionLineItems.filter((li) => li.productionEntryId === pe.id)
        return items.length > 0 ? items.some((li) => qaMatches(li.qaStatus)) : qaMatches(undefined)
      })
      .map((pe) => {
        const pnlEntry = pnlByEntryId.get(pe.id)
        const proj = data.projects.find((p) => p.id === pe.projectId)
        const allLineItems = data.productionLineItems.filter((li) => li.productionEntryId === pe.id)
        return {
          id: pe.id,
          date: pe.date,
          projectName: proj?.name ?? '—',
          crewName: crewOrSubName(data, pe.crewId, pe.subcontractorId),
          footage: pe.footage,
          revenue: pnlEntry?.revenue ?? 0,
          retentionPct: proj?.retentionPct ?? 0.10,
          lineItems: qaFilter === 'all' ? allLineItems : allLineItems.filter((li) => qaMatches(li.qaStatus)),
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [data, wStart, wEnd, projectFilter, qaFilter, qaMatches])

  const totalRevenue = weekMetrics.revenue
  const totalLabor = laborRows.reduce((s, tc) => s + tc.laborCost, 0) + pnlLaborRows.reduce((s, e) => s + e.laborCost, 0)
  const totalExpenses = expenseRows.reduce((s, ex) => s + ex.amount, 0)

  // Retention: per selected project, or revenue-weighted average across all projects active this week
  const retentionPct = useMemo(() => {
    if (projectFilter !== 'all') {
      const proj = data.projects.find((p) => p.id === projectFilter)
      return proj?.retentionPct ?? 0.10
    }
    const projIds = new Set([
      ...productionRows.map((r) => data.projects.find((p) => p.name === r.projectName)?.id).filter(Boolean) as string[],
      ...revenueRows.map((r) => r.projectId),
      ...laborRows.map((tc) => tc.jobId),
      ...pnlLaborRows.map((e) => e.projectId),
      ...expenseRows.map((ex) => ex.jobId),
    ])
    if (projIds.size === 0) return 0.10
    const rates = [...projIds].map((id) => data.projects.find((p) => p.id === id)?.retentionPct ?? 0.10)
    return rates.reduce((s, r) => s + r, 0) / rates.length
  }, [data.projects, projectFilter, productionRows, revenueRows, laborRows, pnlLaborRows, expenseRows])

  // Revenue waterfall: gross → retained → net → EBITDA
  const retentionHeld = Math.round(totalRevenue * retentionPct)
  const netRevenue = totalRevenue - retentionHeld
  const ebitda = netRevenue - totalLabor - weeklyEquipment - totalExpenses
  const margin = netRevenue > 0 ? ebitda / netRevenue : 0

  const hasData = productionRows.length > 0 || weekMetrics.revenue > 0 || revenueRows.length > 0 || laborRows.length > 0 || pnlLaborRows.length > 0 || weeklyEquipment > 0 || expenseRows.length > 0

  return (
    <div>
      {/* Week navigator */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={prevWeek} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50" aria-label="Previous week">
            <ChevronLeft size={16} className="text-slate-400" />
          </button>
          <div className="text-sm font-medium text-slate-700">
            Week of {formatDate(wStart)} – {formatDate(wEnd)}
          </div>
          <button onClick={nextWeek} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50" aria-label="Next week">
            <ChevronRight size={16} className="text-slate-400" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="w-52">
            <option value="all">All projects</option>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          {isAdmin && <QaStatusFilterSelect value={qaFilter} onChange={setQaFilter} className="w-56" />}
          <Button onClick={() => setAddExpense(true)}>
            <Plus size={15} /> Add expense
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Gross Revenue" value={money(totalRevenue)} hint="before retention" />
        <StatCard label={`Retained (${Math.round(retentionPct * 100)}%)`} value={`(${money(retentionHeld)})`} />
        <StatCard label="Net Revenue" value={money(netRevenue)} hint="after retention" />
        <StatCard label="Total Labor" value={money(totalLabor)} />
        <StatCard label="Equipment" value={money(weeklyEquipment)} />
        <StatCard
          label="EBITDA"
          value={money(ebitda)}
          trend={{ value: percent(margin, 1), positive: ebitda >= 0 }}
          hint="net rev − costs"
        />
      </div>

      {isAdmin && totalRevenue > 0 && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">P&L Waterfall</p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm xl:grid-cols-4">
            <PnlRow label="Gross Revenue" value={money(totalRevenue)} />
            <PnlRow label={`Retainage Held (${Math.round(retentionPct * 100)}%)`} value={`(${money(retentionHeld)})`} tone="neg" />
            <PnlRow label="Net Revenue" value={money(netRevenue)} tone="pos" />
            <PnlRow label="Labor" value={`(${money(totalLabor)})`} tone="neg" />
            <PnlRow label="Equipment" value={`(${money(weeklyEquipment)})`} tone="neg" />
            <PnlRow label="Expenses" value={`(${money(totalExpenses)})`} tone="neg" />
            <div className="col-span-2 mt-2 border-t border-slate-200 pt-2 xl:col-span-4">
              <PnlRow label="EBITDA" value={money(ebitda)} tone={ebitda >= 0 ? 'pos' : 'neg'} bold />
            </div>
          </div>
        </div>
      )}

      {!hasData && (
        <Card className="py-16 text-center">
          <p className="text-slate-500">No production, timecards, or expenses logged for this week.</p>
          <p className="mt-1 text-sm text-slate-500">Use Production → Log production or Log timecard to get started.</p>
        </Card>
      )}

      {/* Production section — all entries logged this week */}
      {productionRows.length > 0 && (
        <Card className="mb-4">
          <CardHeader
            title="Production"
            subtitle={`${productionRows.length} entr${productionRows.length !== 1 ? 'ies' : 'y'} · ${productionRows.reduce((s, pe) => s + pe.footage, 0).toLocaleString()} LF${isAdmin ? ` · ${money(totalRevenue)} gross` : ''}`}
          />
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Project</th>
                  <th className="px-5 py-2.5 font-medium">Crew</th>
                  <th className="px-5 py-2.5 text-right font-medium">Footage</th>
                  {isAdmin && <th className="px-5 py-2.5 text-right font-medium">Gross Rev</th>}
                  {isAdmin && <th className="px-5 py-2.5 text-right font-medium">Retained</th>}
                  {isAdmin && <th className="px-5 py-2.5 text-right font-medium">Net Rev</th>}
                </tr>
              </thead>
              <tbody>
                {productionRows.map((pe) => {
                  // One full row per rate-card line item — two unit codes on the
                  // same entry can bill at two different rates, which a single
                  // blended gross/retained/net figure would hide. Date/Project/
                  // Crew span across an entry's rows. Falls back to the entry's
                  // own footage/revenue as a single row when there are no
                  // rate-card line items.
                  const lineRows = pe.lineItems.length > 0
                    ? pe.lineItems.map((li) => ({ key: li.id, unitCode: li.unitCode as string | null, quantity: li.quantity, revenue: li.extendedTotal, qaStatus: li.qaStatus }))
                    : [{ key: pe.id, unitCode: null, quantity: pe.footage, revenue: pe.revenue, qaStatus: undefined }]
                  const span = lineRows.length
                  return lineRows.map((lr, j) => {
                    const retained = Math.round(lr.revenue * pe.retentionPct)
                    const net = lr.revenue - retained
                    return (
                      <tr key={lr.key} className="border-b border-slate-50 hover:bg-slate-50/60">
                        {j === 0 && (
                          <>
                            <td rowSpan={span} className="whitespace-nowrap px-5 py-2.5 align-top text-slate-400">{formatDate(pe.date)}</td>
                            <td rowSpan={span} className="px-5 py-2.5 align-top font-medium text-slate-800">{pe.projectName}</td>
                            <td rowSpan={span} className="px-5 py-2.5 align-top">
                              {pe.crewName
                                ? <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{pe.crewName}</span>
                                : <span className="text-slate-500">—</span>}
                            </td>
                          </>
                        )}
                        <td className="px-5 py-2.5 text-right text-slate-700">
                          {lr.quantity.toLocaleString()} LF
                          {lr.unitCode && <div className="mt-0.5 text-[10px] font-normal leading-tight text-slate-400">{lr.unitCode}</div>}
                          <div className="mt-1 flex justify-end"><QaStatusBadge status={lr.qaStatus ?? 'approved'} /></div>
                        </td>
                        {isAdmin && <td className="px-5 py-2.5 text-right text-slate-400">{money(lr.revenue)}</td>}
                        {isAdmin && (
                          <td className="px-5 py-2.5 text-right text-amber-600">
                            {retained > 0 ? `(${money(retained)})` : '—'}
                            {pe.retentionPct > 0 && <span className="ml-1 text-xs text-slate-500">{Math.round(pe.retentionPct * 100)}%</span>}
                          </td>
                        )}
                        {isAdmin && <td className="px-5 py-2.5 text-right font-medium text-emerald-700">{money(net)}</td>}
                      </tr>
                    )
                  })
                })}
              </tbody>
              {isAdmin && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td colSpan={3} className="px-5 py-2.5 text-right text-sm font-semibold text-slate-700">Totals</td>
                    <td className="px-5 py-2.5 text-right font-bold text-slate-700">
                      {productionRows.reduce((s, pe) => s + pe.footage, 0).toLocaleString()} LF
                    </td>
                    <td className="px-5 py-2.5 text-right font-semibold text-slate-400">{money(totalRevenue)}</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-amber-600">
                      ({money(productionRows.reduce((s, pe) => s + Math.round(pe.revenue * pe.retentionPct), 0))})
                    </td>
                    <td className="px-5 py-2.5 text-right font-bold text-emerald-700">
                      {money(productionRows.reduce((s, pe) => s + pe.revenue - Math.round(pe.revenue * pe.retentionPct), 0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </CardBody>
        </Card>
      )}

      {/* Rate Card Detail — only shown when line items were submitted */}
      {revenueRows.length > 0 && (
        <Card className="mb-4">
          <CardHeader
            title="Rate Card Detail"
            subtitle={`${revenueRows.length} line item${revenueRows.length !== 1 ? 's' : ''}`}
          />
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Code</th>
                  <th className="px-5 py-2.5 font-medium">Description</th>
                  <th className="px-5 py-2.5 font-medium">UOM</th>
                  <th className="px-5 py-2.5 text-right font-medium">Qty</th>
                  <th className="px-5 py-2.5 text-right font-medium">Rate</th>
                  <th className="px-5 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {revenueRows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-5 py-2.5 text-slate-400">{formatDate(r.date)}</td>
                    <td className="px-5 py-2.5 font-mono text-xs font-semibold text-brand-700">
                      {r.unitCode}
                      <div className="mt-1"><QaStatusBadge status={r.qaStatus ?? 'approved'} /></div>
                    </td>
                    <td className="px-5 py-2.5 text-slate-700">{r.description}</td>
                    <td className="px-5 py-2.5 text-slate-400">{r.uom}</td>
                    <td className="px-5 py-2.5 text-right text-slate-700">{r.qty.toLocaleString()}</td>
                    <td className="px-5 py-2.5 text-right text-slate-400">{moneyExact(r.rate)}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-slate-800">{moneyExact(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {/* Labor section */}
      {(laborRows.length > 0 || pnlLaborRows.length > 0 || isAdmin) && (
        <Card className="mb-4">
          <CardHeader
            title="Labor"
            subtitle={isAdmin ? `${money(totalLabor)} total` : undefined}
          />
          {laborRows.length === 0 && pnlLaborRows.length === 0 ? (
            <CardBody>
              <p className="text-sm text-slate-500">No labor logged this week.</p>
            </CardBody>
          ) : (
            <CardBody className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-2.5 font-medium">Date</th>
                    <th className="px-5 py-2.5 font-medium">Source</th>
                    <th className="px-5 py-2.5 font-medium">Detail</th>
                    <th className="px-5 py-2.5 text-right font-medium">Hours</th>
                    {isAdmin && <th className="px-5 py-2.5 text-right font-medium">Cost</th>}
                  </tr>
                </thead>
                <tbody>
                  {/* Timecard rows (crew day entries) */}
                  {laborRows.map((tc) => {
                    const emp = data.employees.find((e) => e.id === tc.employeeId)
                    return (
                      <tr key={tc.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="whitespace-nowrap px-5 py-2.5 text-slate-400">{formatDate(tc.date)}</td>
                        <td className="px-5 py-2.5 text-slate-400">Timecard</td>
                        <td className="px-5 py-2.5 font-medium text-slate-800">
                          {emp?.name ?? tc.employeeId}
                          {emp?.role && <span className="ml-1.5 text-slate-500 font-normal">· {emp.role}</span>}
                        </td>
                        <td className="px-5 py-2.5 text-right text-slate-700">{tc.hours.toFixed(2)}</td>
                        {isAdmin && <td className="px-5 py-2.5 text-right font-medium text-slate-800">{moneyExact(tc.laborCost)}</td>}
                      </tr>
                    )
                  })}
                  {/* PnL-based labor rows (regular production entries) */}
                  {pnlLaborRows.map((e) => {
                    const proj = data.projects.find((p) => p.id === e.projectId)
                    return (
                      <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="whitespace-nowrap px-5 py-2.5 text-slate-400">{formatDate(e.date)}</td>
                        <td className="px-5 py-2.5 text-slate-400">Production</td>
                        <td className="px-5 py-2.5 text-slate-700">{proj?.name ?? e.projectId}</td>
                        <td className="px-5 py-2.5 text-right text-slate-500">—</td>
                        {isAdmin && <td className="px-5 py-2.5 text-right font-medium text-slate-800">{moneyExact(e.laborCost)}</td>}
                      </tr>
                    )
                  })}
                </tbody>
                {isAdmin && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50">
                      <td colSpan={4} className="px-5 py-2.5 text-right text-sm font-semibold text-slate-700">Total Labor</td>
                      <td className="px-5 py-2.5 text-right font-bold text-rose-700">{money(totalLabor)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </CardBody>
          )}
        </Card>
      )}

      {/* Equipment section */}
      {(weekEquipmentDetail.length > 0 || weeklyEquipment > 0) && (
        <Card className="mb-4">
          <CardHeader
            title="Equipment"
            subtitle={isAdmin ? `${weekEquipmentDetail.length} piece${weekEquipmentDetail.length !== 1 ? 's' : ''} deployed · ${money(weeklyEquipment)} this week` : `${weekEquipmentDetail.length} piece${weekEquipmentDetail.length !== 1 ? 's' : ''} deployed`}
          />
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5 font-medium">Equipment</th>
                  <th className="px-5 py-2.5 font-medium">Category</th>
                  <th className="px-5 py-2.5 font-medium">Crew</th>
                  <th className="px-5 py-2.5 font-medium">On site since</th>
                  {isAdmin && <th className="px-5 py-2.5 text-right font-medium">Daily rate</th>}
                  {isAdmin && <th className="px-5 py-2.5 text-right font-medium">This week</th>}
                </tr>
              </thead>
              <tbody>
                {weekEquipmentDetail.map(({ eq, crew }) => {
                  const daily = eq.monthlyCost / daysInMonth(wStart)
                  // Count weekdays in this week where equipment was deployed
                  let weekDays = 0
                  const d = new Date(wStart + 'T12:00:00')
                  const end = new Date(wEnd + 'T12:00:00')
                  while (d <= end) {
                    const dow = d.getDay()
                    const ds = localDateStr(d)
                    if (dow !== 0 && dow !== 6 && eq.deployedFrom && eq.deployedFrom <= ds) weekDays++
                    d.setDate(d.getDate() + 1)
                  }
                  return (
                    <tr key={eq.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-5 py-2.5 font-medium text-slate-800">{eq.name}</td>
                      <td className="px-5 py-2.5 text-slate-400">{eq.category}</td>
                      <td className="px-5 py-2.5">
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{crew.name}</span>
                      </td>
                      <td className="px-5 py-2.5 text-slate-400 text-xs">{eq.deployedFrom}</td>
                      {isAdmin && <td className="px-5 py-2.5 text-right text-slate-700">{money(daily)}</td>}
                      {isAdmin && <td className="px-5 py-2.5 text-right font-medium text-purple-700">{money(daily * weekDays)}</td>}
                    </tr>
                  )
                })}
              </tbody>
              {isAdmin && weekEquipmentDetail.length > 1 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td colSpan={5} className="px-5 py-2.5 text-right text-sm font-semibold text-slate-700">Total Equipment</td>
                    <td className="px-5 py-2.5 text-right font-bold text-purple-700">{money(weeklyEquipment)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </CardBody>
        </Card>
      )}

      {/* Expenses section */}
      <Card className="mb-4">
        <CardHeader
          title="Expenses"
          subtitle={`${expenseRows.length} entries · ${money(totalExpenses)}`}
          action={
            <Button variant="ghost" className="text-xs py-1" onClick={() => setAddExpense(true)}>
              <Plus size={13} /> Add expense
            </Button>
          }
        />
        {expenseRows.length === 0 ? (
          <CardBody>
            <p className="text-sm text-slate-500">No expenses logged for this week.</p>
          </CardBody>
        ) : (
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Crew</th>
                  <th className="px-5 py-2.5 font-medium">Location</th>
                  <th className="px-5 py-2.5 font-medium">Description</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {expenseRows.map((ex: JobExpense) => {
                  const crew = data.crews.find((c) => c.id === ex.crewId)
                  return (
                  <tr key={ex.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-5 py-2.5 text-slate-400">{formatDate(ex.date)}</td>
                    <td className="px-5 py-2.5">
                      {crew ? (
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{crew.name}</span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-5 py-2.5 text-slate-400 text-xs">{ex.location || ex.vendor || '—'}</td>
                    <td className="px-5 py-2.5 text-slate-700">{ex.description}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-slate-800">{moneyExact(ex.amount)}</td>
                    <td className="px-5 py-2.5 text-right">
                      <button onClick={() => deleteJobExpense(ex.id)} className="text-slate-600 hover:text-rose-600" aria-label="Delete">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td colSpan={3} className="px-5 py-2.5 text-right text-sm font-semibold text-slate-700">Total Expenses</td>
                  <td className="px-5 py-2.5 text-right font-bold text-rose-700">{money(totalExpenses)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </CardBody>
        )}
      </Card>

      {addExpense && <ExpenseModal onClose={() => setAddExpense(false)} defaultDate={wStart} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Daily ledger view — date-range picker, defaults to current week
// ---------------------------------------------------------------------------

function DailyView() {
  const { data } = useData()
  const { isAdmin } = useRole()
  const today = localDateStr()
  const [startDate, setStartDate] = useState(() => weekStart(today))
  const [endDate, setEndDate] = useState(() => weekEnd(today))
  const [projectFilter, setProjectFilter] = useState('all')

  const resetToThisWeek = () => {
    const now = localDateStr()
    setStartDate(weekStart(now))
    setEndDate(weekEnd(now))
  }

  // Single call to computeMetrics — same function Dashboard uses, so numbers always match
  const metrics = useMemo(
    () => computeMetrics(data, {
      startDate,
      endDate,
      projectId: projectFilter !== 'all' ? projectFilter : undefined,
    }),
    [data, startDate, endDate, projectFilter]
  )

  const ledger = useMemo(() => {
    return [...metrics.byDate.entries()]
      .map(([date, row]) => ({
        date,
        revenue: row.revenue,
        labor: row.labor,
        equipment: row.equipment,
        expenses: row.expenses,
        profit: row.profit,
        margin: row.revenue > 0 ? row.profit / row.revenue : 0,
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [metrics])

  const totals = metrics
  const totalMargin = metrics.margin

  // Chart series — profit trend
  const series = useMemo(() => {
    const byDate = new Map<string, { revenue: number; profit: number }>()
    for (const r of [...ledger].sort((a, b) => a.date.localeCompare(b.date))) {
      byDate.set(r.date, { revenue: r.revenue, profit: r.profit })
    }
    return [...byDate.entries()].map(([date, v]) => ({ label: formatDateShort(date), ...v }))
  }, [ledger])

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="w-48">
          <option value="all">All projects</option>
          {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
        <span className="text-sm text-slate-500">to</span>
        <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
        <button
          onClick={resetToThisWeek}
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          This week
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <StatCard label="Revenue" value={money(totals.revenue)} />
        <StatCard label="Labor" value={money(totals.labor)} />
        <StatCard label="Equipment" value={money(totals.equipment)} />
        <StatCard label="Expenses" value={money(totals.expenses)} />
        <StatCard
          label="Profit"
          value={money(totals.profit)}
          trend={{ value: percent(totalMargin, 1), positive: totals.profit >= 0 }}
          hint="margin"
        />
      </div>

      <Card className="mt-6">
        <CardHeader title="Profit trend" subtitle="Net profit per day" />
        <CardBody>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={series} margin={{ left: -4, right: 8, top: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number, n) => [money(v), n === 'profit' ? 'Profit' : 'Revenue']} />
              <ReferenceLine y={0} stroke="#cbd5e1" />
              <Line type="monotone" dataKey="revenue" stroke="#1b5cf5" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Daily ledger" subtitle="Revenue · Labor · Equipment (auto per deployed crew gear) · Expenses" />
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-5 py-2.5 text-right font-medium">Revenue</th>
                {isAdmin && <th className="px-5 py-2.5 text-right font-medium">Labor</th>}
                {isAdmin && <th className="px-5 py-2.5 text-right font-medium">Equipment</th>}
                <th className="px-5 py-2.5 text-right font-medium">Expenses</th>
                <th className="px-5 py-2.5 text-right font-medium">Profit</th>
                <th className="px-5 py-2.5 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr key={row.date} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-5 py-2.5 text-slate-400">{formatDate(row.date)}</td>
                  <td className="px-5 py-2.5 text-right text-slate-700">{money(row.revenue)}</td>
                  {isAdmin && <td className="px-5 py-2.5 text-right text-slate-400">{money(row.labor)}</td>}
                  {isAdmin && (
                    <td className="px-5 py-2.5 text-right text-purple-600">
                      {row.equipment > 0 ? money(row.equipment) : <span className="text-slate-600">—</span>}
                    </td>
                  )}
                  <td className="px-5 py-2.5 text-right text-slate-400">{row.expenses > 0 ? money(row.expenses) : <span className="text-slate-600">—</span>}</td>
                  <td className={`px-5 py-2.5 text-right font-medium ${row.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {money(row.profit)}
                  </td>
                  <td className="px-5 py-2.5 text-right text-slate-400">{percent(row.margin, 1)}</td>
                </tr>
              ))}
              {ledger.length === 0 && (
                <tr><td colSpan={isAdmin ? 7 : 5} className="px-5 py-10 text-center text-slate-500">No data in this range.</td></tr>
              )}
            </tbody>
            {ledger.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-800">
                  <td className="px-5 py-3">Total</td>
                  <td className="px-5 py-3 text-right">{money(totals.revenue)}</td>
                  {isAdmin && <td className="px-5 py-3 text-right text-slate-400">{money(totals.labor)}</td>}
                  {isAdmin && <td className="px-5 py-3 text-right text-purple-600">{money(totals.equipment)}</td>}
                  <td className="px-5 py-3 text-right text-slate-400">{money(totals.expenses)}</td>
                  <td className={`px-5 py-3 text-right ${totals.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{money(totals.profit)}</td>
                  <td className="px-5 py-3 text-right">{percent(totalMargin, 1)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardBody>
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------
// Shared row component
// ---------------------------------------------------------------------------

function PnlRow({ label, value, tone, bold }: { label: string; value: string; tone?: 'pos' | 'neg'; bold?: boolean }) {
  const color = tone === 'pos' ? 'text-emerald-600' : tone === 'neg' ? 'text-rose-600' : 'text-slate-800'
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className={`${bold ? 'font-bold text-base' : 'font-semibold'} ${color}`}>{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'weekly' | 'daily' | 'qa'

/** Color-coded stat card for the QA/QC revenue cards — StatCard's value text
 *  is always the same slate color, but the spec calls for Pending=amber,
 *  Approved=green, Rejected=red, Rejection Fixed=blue per card, so this is a
 *  small variant with a colorable value instead of extending StatCard's props
 *  for a single call site. */
function QaStatCard({ label, value, color, hint }: { label: string; value: string; color: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight" style={{ color }}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

/** Redline QA/QC Approval Workflow — P&L revenue breakdown by QA status.
 *  A separate tab (not folded into Weekly/Daily) so computeMetrics-driven
 *  views stay byte-for-byte unchanged; this reads computeQaRevenueBreakdown,
 *  a purely additive sibling selector. */
function QaRevenueView() {
  const { data } = useData()
  const [filters, setFilters] = useState<QaFilterState>(EMPTY_QA_FILTERS)
  const breakdown = useMemo(() => computeQaRevenueBreakdown(data, filters), [data, filters])

  const qtyLabel = (bucket: Record<string, number>) =>
    Object.entries(bucket).length === 0 ? '—' : Object.entries(bucket).map(([uom, qty]) => `${qty.toLocaleString()} ${uom}`).join(', ')

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <QaFilterBar value={filters} onChange={setFilters} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <QaStatCard label="Pending Review Revenue" value={money(breakdown.pendingReviewRevenue)} color="#f59e0b" hint="Not counted toward finalized revenue" />
        <QaStatCard label="Approved Revenue" value={money(breakdown.approvedRevenue)} color="#22c55e" hint="First-pass approvals" />
        <QaStatCard label="Rejected Revenue" value={money(breakdown.rejectedRevenue)} color="#ef4444" hint="Not counted toward invoicing" />
        <QaStatCard label="Revenue Waiting on Corrections" value={money(breakdown.revenueWaitingOnCorrections)} color="#3b82f6" hint="Rejection fixed — awaiting re-review" />
        <QaStatCard label="Total Submitted Revenue" value={money(breakdown.totalSubmittedRevenue)} color="#94a3b8" hint="Everything ever entered QA/QC" />
        <QaStatCard label="Final Approved Revenue" value={money(breakdown.finalApprovedRevenue)} color="#22c55e" hint="Billable — approved + approved after correction" />
        <QaStatCard label="Rejected Production Value" value={qtyLabel(breakdown.rejectedProductionValue)} color="#ef4444" hint="Footage/units, not dollars" />
        <QaStatCard label="Pending Production Value" value={qtyLabel(breakdown.pendingProductionValue)} color="#f59e0b" hint="Footage/units, not dollars" />
      </div>
    </div>
  )
}

export function DailyPnL() {
  const [tab, setTab] = useState<Tab>('weekly')

  return (
    <div>
      <PageHeader
        title="P&L"
        description="Weekly P&L from rate-card production + timecards + expenses. Daily ledger shows historical totals."
      />

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {(['weekly', 'daily', 'qa'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              tab === t ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            {t === 'weekly' ? 'Weekly (Generated)' : t === 'daily' ? 'Daily Ledger' : 'QA/QC Revenue'}
          </button>
        ))}
      </div>

      {tab === 'weekly' ? <WeeklyView /> : tab === 'daily' ? <DailyView /> : <QaRevenueView />}
    </div>
  )
}
