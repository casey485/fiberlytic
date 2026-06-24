import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Plus, Trash2, X, Users } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select, Textarea } from '../components/ui/Form'
import { number, money, moneyExact, formatDate, formatDateShort } from '../lib/format'
import { dailyProductionSeries, weekStart, weekEnd } from '../lib/analytics'
import type { RateCardUnit, WorkType } from '../types'
import type { LineItemInput } from '../store/DataContext'


function workTypeDivision(wt: WorkType) {
  if (wt === 'underground' || wt === 'directional_bore') return 'Underground'
  if (wt === 'aerial') return 'Aerial'
  return null
}

// ---------------------------------------------------------------------------
// Production Log Modal — rate-card line items
// ---------------------------------------------------------------------------

interface LineItemRow {
  key: number
  unitCode: string
  description: string
  uom: string
  rateSnapshot: number
  quantity: string
}

function ProductionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, addProduction } = useData()
  const today = new Date().toISOString().slice(0, 10)
  const activeProjects = data.projects.filter((p) => p.status === 'active')

  // Only consider rate cards that actually have units loaded
  const hasUnits = (rcId: string) => data.rateCardUnits.some((u) => u.rateCardId === rcId)

  // Best-effort rate card resolution — always prefers cards that have units:
  // clientId+division > division-only > any card with units > first card
  const resolveRateCard = (projectId: string): string => {
    const proj = data.projects.find((p) => p.id === projectId)
    const div = proj ? workTypeDivision(proj.workType) : null
    if (proj?.clientId && div) {
      const m = data.rateCards.find((rc) => rc.clientId === proj.clientId && rc.division === div && hasUnits(rc.id))
      if (m) return m.id
    }
    if (div) {
      const m = data.rateCards.find((rc) => rc.division === div && hasUnits(rc.id))
      if (m) return m.id
    }
    // Any rate card with units
    const any = data.rateCards.find((rc) => hasUnits(rc.id))
    if (any) return any.id
    // Nothing has units — return first card so the user sees the empty-state message
    return data.rateCards[0]?.id ?? ''
  }

  const initialProjectId = activeProjects[0]?.id ?? ''
  const [form, setForm] = useState({
    date: today,
    projectId: initialProjectId,
    crewId: data.crews[0]?.id ?? '',
    rateCardId: resolveRateCard(initialProjectId),
    hours: '9',
    notes: '',
  })
  const [rows, setRows] = useState<LineItemRow[]>([])
  const [nextKey, setNextKey] = useState(0)

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const changeProject = (projectId: string) => {
    setForm((f) => ({ ...f, projectId, rateCardId: resolveRateCard(projectId) }))
    setRows([])
  }

  const changeRateCard = (rateCardId: string) => {
    setForm((f) => ({ ...f, rateCardId }))
    setRows([])
  }

  const availableUnits = useMemo(
    () => data.rateCardUnits.filter((u) => u.rateCardId === form.rateCardId),
    [data.rateCardUnits, form.rateCardId],
  )

  const addRow = () => {
    const first = availableUnits[0]
    setRows((r) => [
      ...r,
      {
        key: nextKey,
        unitCode: first?.unitCode ?? '',
        description: first?.description ?? '',
        uom: first?.uom ?? 'LF',
        rateSnapshot: first?.rate ?? 0,
        quantity: '',
      },
    ])
    setNextKey((k) => k + 1)
  }

  const removeRow = (key: number) => setRows((r) => r.filter((x) => x.key !== key))

  const updateRowUnit = (key: number, unit: RateCardUnit) => {
    setRows((r) =>
      r.map((x) =>
        x.key === key
          ? { ...x, unitCode: unit.unitCode, description: unit.description, uom: unit.uom, rateSnapshot: unit.rate }
          : x,
      ),
    )
  }

  const updateRowQty = (key: number, qty: string) => {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, quantity: qty } : x)))
  }

  const lineItems: LineItemInput[] = rows
    .filter((r) => r.unitCode && parseFloat(r.quantity) > 0)
    .map((r) => {
      const qty = parseFloat(r.quantity)
      return {
        unitCode: r.unitCode,
        description: r.description,
        uom: r.uom,
        quantity: qty,
        rateSnapshot: r.rateSnapshot,
        extendedTotal: Math.round(qty * r.rateSnapshot * 100) / 100,
      }
    })

  const totalRevenue = lineItems.reduce((s, li) => s + li.extendedTotal, 0)
  const totalLF = lineItems.filter((li) => li.uom === 'LF').reduce((s, li) => s + li.quantity, 0)
  const hours = parseFloat(form.hours) || 0

  const canSubmit = form.projectId && form.crewId && hours > 0

  const submit = () => {
    if (!canSubmit) return
    addProduction(
      {
        date: form.date,
        projectId: form.projectId,
        crewId: form.crewId,
        footage: Math.round(totalLF),
        hours,
        notes: form.notes || undefined,
      },
      lineItems.length > 0 ? lineItems : undefined,
    )
    onClose()
    setRows([])
    setForm((f) => ({ ...f, hours: '9', notes: '' }))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log production"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit}>Save entry</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Crew-hours">
          <Input type="number" min="0" step="0.5" value={form.hours} onChange={(e) => set('hours', e.target.value)} />
        </Field>
        <Field label="Project">
          <Select value={form.projectId} onChange={(e) => changeProject(e.target.value)}>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Crew">
          <Select value={form.crewId} onChange={(e) => set('crewId', e.target.value)}>
            {data.crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
        <Field label="Rate card">
          <Select value={form.rateCardId} onChange={(e) => changeRateCard(e.target.value)}>
            <option value="">— Select rate card —</option>
            {data.rateCards.map((rc) => (
              <option key={rc.id} value={rc.id}>{rc.name} · {rc.division}</option>
            ))}
          </Select>
        </Field>
        </div>
      </div>

      {/* Line items */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Line items</p>
          <Button variant="ghost" className="py-1 text-xs" onClick={addRow} disabled={availableUnits.length === 0}>
            <Plus size={13} /> Add line item
          </Button>
        </div>

        {!form.rateCardId && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Select a rate card above to enable line item entry.
          </p>
        )}

        {form.rateCardId && availableUnits.length === 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            "{data.rateCards.find((rc) => rc.id === form.rateCardId)?.name ?? 'Selected rate card'}" has no units.
            Go to <strong>Rate Cards</strong> → open the card → click <strong>Add unit</strong>.
          </p>
        )}

        {rows.length === 0 && availableUnits.length > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            No line items — this will save a no-production day. Labor &amp; equipment costs will still be recorded with $0 revenue.
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">UOM</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const qty = parseFloat(row.quantity) || 0
                  const extended = qty * row.rateSnapshot
                  return (
                    <tr key={row.key} className="border-t border-slate-100">
                      <td className="px-2 py-1.5">
                        <Select
                          className="text-xs"
                          value={row.unitCode}
                          onChange={(e) => {
                            const unit = availableUnits.find((u) => u.unitCode === e.target.value)
                            if (unit) updateRowUnit(row.key, unit)
                          }}
                        >
                          {availableUnits.map((u) => (
                            <option key={u.id} value={u.unitCode}>{u.unitCode}</option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-600">{row.description}</td>
                      <td className="px-2 py-1.5 text-xs text-slate-500">{row.uom}</td>
                      <td className="px-2 py-1.5 text-right text-xs text-slate-500">{moneyExact(row.rateSnapshot)}</td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          className="w-20 text-right text-xs"
                          value={row.quantity}
                          onChange={(e) => updateRowQty(row.key, e.target.value)}
                          placeholder="0"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs font-medium text-slate-800">
                        {moneyExact(extended)}
                      </td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => removeRow(row.key)} className="text-slate-300 hover:text-rose-500" aria-label="Remove">
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Summary */}
        {lineItems.length > 0 && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Total LF placed</span>
              <span className="font-semibold text-slate-800">{number(totalLF)} ft</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-slate-500">Total revenue</span>
              <span className="font-semibold text-emerald-700">{money(totalRevenue)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4">
        <Field label="Notes (optional)">
          <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Weather, delays, rework…" />
        </Field>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Crew Day Modal
// ---------------------------------------------------------------------------

type EmpRow = { employeeId: string; checked: boolean; hours: string }

function CrewDayModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, addCrewDayEntry } = useData()
  const { isAdmin } = useRole()
  const today = new Date().toISOString().slice(0, 10)
  const activeProjects = data.projects.filter((p) => p.status === 'active')
  const activeEmps = data.employees.filter((e) => e.active)

  const defaultCrewId = data.crews[0]?.id ?? ''
  const defaultEquipIds = (crewId: string) =>
    data.equipment.filter((eq) => eq.active && eq.crewId === crewId).map((eq) => eq.id)

  const [form, setForm] = useState({
    date: today,
    projectId: activeProjects[0]?.id ?? '',
    crewId: defaultCrewId,
    footage: '',
    notes: '',
  })
  const setF = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const [selectedEquipIds, setSelectedEquipIds] = useState<string[]>(() => defaultEquipIds(defaultCrewId))

  const changeCrew = (crewId: string) => {
    setForm((f) => ({ ...f, crewId }))
    setSelectedEquipIds(defaultEquipIds(crewId))
  }

  const toggleEquip = (eqId: string) =>
    setSelectedEquipIds((ids) => ids.includes(eqId) ? ids.filter((x) => x !== eqId) : [...ids, eqId])

  const [empRows, setEmpRows] = useState<EmpRow[]>(() =>
    activeEmps.map((e) => ({ employeeId: e.id, checked: false, hours: '8' }))
  )

  const toggleEmp = (id: string) =>
    setEmpRows((rows) => rows.map((r) => (r.employeeId === id ? { ...r, checked: !r.checked } : r)))
  const setHours = (id: string, hrs: string) =>
    setEmpRows((rows) => rows.map((r) => (r.employeeId === id ? { ...r, hours: hrs } : r)))

  const checkedRows = empRows.filter((r) => r.checked)
  const totalHours = checkedRows.reduce((s, r) => s + (parseFloat(r.hours) || 0), 0)
  const totalLaborCost = checkedRows.reduce((s, r) => {
    const emp = data.employees.find((e) => e.id === r.employeeId)
    return s + (emp ? (parseFloat(r.hours) || 0) * emp.hourlyRate : 0)
  }, 0)

  const canSubmit = form.projectId && form.crewId && checkedRows.length > 0 && checkedRows.every((r) => parseFloat(r.hours) > 0)

  const submit = () => {
    if (!canSubmit) return
    addCrewDayEntry({
      date: form.date,
      projectId: form.projectId,
      crewId: form.crewId,
      footage: Math.round(parseFloat(form.footage) || 0),
      notes: form.notes || undefined,
      employees: checkedRows.map((r) => ({ employeeId: r.employeeId, hours: parseFloat(r.hours) })),
      equipmentIds: selectedEquipIds.length > 0 ? selectedEquipIds : undefined,
    })
    onClose()
    setForm((f) => ({ ...f, footage: '', notes: '' }))
    setEmpRows(activeEmps.map((e) => ({ employeeId: e.id, checked: false, hours: '8' })))
    setSelectedEquipIds(defaultEquipIds(form.crewId))
  }

  const selectedCrew = data.crews.find((c) => c.id === form.crewId)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log crew day"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit}>Save crew day</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => setF('date', e.target.value)} />
        </Field>
        <Field label="Footage placed (ft)" hint="Enter 0 for no-production days — costs still recorded">
          <Input type="number" min="0" step="1" value={form.footage} onChange={(e) => setF('footage', e.target.value)} placeholder="0" />
        </Field>
        <Field label="Project / job">
          <Select value={form.projectId} onChange={(e) => setF('projectId', e.target.value)}>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Crew">
          <Select value={form.crewId} onChange={(e) => changeCrew(e.target.value)}>
            {data.crews.map((c) => {
              const foreman = data.employees.find((e) => e.isForeman && e.defaultCrewId === c.id)
              return (
                <option key={c.id} value={c.id}>
                  {c.name}{foreman ? ` — ${foreman.name}` : ''}
                </option>
              )
            })}
          </Select>
        </Field>
      </div>

      {selectedCrew && (
        <p className="mt-1 text-xs text-slate-400">
          {selectedCrew.specialty} crew · {selectedCrew.status}
        </p>
      )}

      {/* Equipment selection — crew's equipment pre-checked, others available to add */}
      {data.equipment.filter((eq) => eq.active).length > 0 && (
        <div className="mt-3 rounded-lg border border-purple-100 bg-purple-50 px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-purple-600">Equipment on site today</p>
          <div className="space-y-1.5">
            {data.equipment.filter((eq) => eq.active).map((eq) => {
              const checked = selectedEquipIds.includes(eq.id)
              const assignedToThisCrew = eq.crewId === form.crewId
              return (
                <label key={eq.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${checked ? 'bg-purple-100' : 'hover:bg-purple-50/80'}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleEquip(eq.id)}
                    className="rounded border-purple-300 text-purple-600"
                  />
                  <span className={`flex-1 ${checked ? 'font-medium text-purple-900' : 'text-purple-700'}`}>
                    {eq.name}
                    <span className="ml-1.5 text-xs font-normal text-purple-400">· {eq.category}</span>
                    {!assignedToThisCrew && eq.crewId && (
                      <span className="ml-1.5 text-xs text-slate-400">
                        ({data.crews.find((c) => c.id === eq.crewId)?.name ?? 'other crew'})
                      </span>
                    )}
                  </span>
                  {isAdmin && (
                    <span className={`text-xs font-medium ${checked ? 'text-purple-700' : 'text-purple-400'}`}>
                      {moneyExact(eq.monthlyCost / 21)}/day
                    </span>
                  )}
                </label>
              )
            })}
          </div>
          {isAdmin && selectedEquipIds.length > 0 && (
            <div className="mt-2 flex items-center justify-between border-t border-purple-200 pt-2 text-sm font-semibold text-purple-700">
              <span>Equipment total today</span>
              <span>
                {moneyExact(
                  data.equipment
                    .filter((eq) => selectedEquipIds.includes(eq.id))
                    .reduce((s, eq) => s + eq.monthlyCost / 21, 0)
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Employee rows */}
      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Employees worked today</p>
        {activeEmps.length === 0 ? (
          <p className="text-sm text-slate-400">No active employees. Add employees first.</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {activeEmps.map((emp) => {
              const row = empRows.find((r) => r.employeeId === emp.id)!
              return (
                <div key={emp.id} className={`flex items-center gap-3 px-4 py-2.5 ${row.checked ? 'bg-brand-50/40' : ''}`}>
                  <input
                    type="checkbox"
                    checked={row.checked}
                    onChange={() => toggleEmp(emp.id)}
                    className="rounded border-slate-300"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-800">{emp.name}</span>
                    {emp.isForeman && (
                      <span className="ml-1.5 inline-flex items-center rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">Foreman</span>
                    )}
                    <span className="ml-1.5 text-xs text-slate-400">{emp.role}</span>
                  </div>
                  {row.checked && (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min="0"
                        step="0.5"
                        className="w-20 text-right text-sm"
                        value={row.hours}
                        onChange={(e) => setHours(emp.id, e.target.value)}
                      />
                      <span className="text-xs text-slate-400">hrs</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {checkedRows.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          {(parseFloat(form.footage) || 0) === 0 && (
            <p className="mb-2 text-xs font-semibold text-amber-600">
              No-production day — labor &amp; equipment costs will be recorded with $0 revenue.
            </p>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Footage</span>
            <span className="font-medium text-slate-800">{number(parseFloat(form.footage) || 0)} ft</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="text-slate-500">Employees</span>
            <span className="font-medium text-slate-800">{checkedRows.length}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="text-slate-500">Total hours</span>
            <span className="font-semibold text-slate-800">{totalHours.toFixed(2)} hrs</span>
          </div>
          {isAdmin && (
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-slate-500">Total labor cost</span>
              <span className="font-semibold text-slate-800">{moneyExact(totalLaborCost)}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        <Field label="Notes (optional)">
          <Textarea rows={2} value={form.notes} onChange={(e) => setF('notes', e.target.value)} placeholder="Weather, delays, rework…" />
        </Field>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Production tab
// ---------------------------------------------------------------------------

function ProductionTab() {
  const { data, deleteProduction } = useData()
  const [open, setOpen] = useState(false)
  const [projectFilter, setProjectFilter] = useState('all')
  const today = new Date().toISOString().slice(0, 10)
  const [dateStart, setDateStart] = useState(() => weekStart(today))
  const [dateEnd, setDateEnd] = useState(() => weekEnd(today))

  const resetToThisWeek = () => {
    const now = new Date().toISOString().slice(0, 10)
    setDateStart(weekStart(now))
    setDateEnd(weekEnd(now))
  }

  const entries = useMemo(() => {
    return [...data.production]
      .filter((e) =>
        e.date >= dateStart &&
        e.date <= dateEnd &&
        (projectFilter === 'all' || e.projectId === projectFilter)
      )
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [data.production, dateStart, dateEnd, projectFilter])

  const footageInRange = entries.reduce((s, e) => s + e.footage, 0)
  const hoursInRange = entries.reduce((s, e) => s + e.hours, 0)
  const avgRate = hoursInRange > 0 ? footageInRange / hoursInRange : 0

  const series = dailyProductionSeries(data).slice(-30).map((d) => ({ ...d, label: formatDateShort(d.date) }))

  return (
    <>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="w-48">
            <option value="all">All projects</option>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="w-40" />
          <span className="text-sm text-slate-400">to</span>
          <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="w-40" />
          <button onClick={resetToThisWeek} className="text-sm font-medium text-brand-600 hover:text-brand-700">
            This week
          </button>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> Log production
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Footage" value={`${number(footageInRange)} ft`} hint="in selected range" />
        <StatCard label="Crew-hours" value={number(hoursInRange)} hint="in selected range" />
        <StatCard label="Avg rate" value={`${avgRate.toFixed(0)} ft/hr`} hint="footage per hour" />
      </div>

      <Card className="mt-6">
        <CardHeader title="Daily footage" subtitle="All projects — last 30 days" />
        <CardBody>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={series} margin={{ left: -8, right: 8, top: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `${v / 1000}k`} />
              <Tooltip formatter={(v: number) => [`${number(v)} ft`, 'Footage']} />
              <Bar dataKey="footage" fill="#06b6d4" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title={`Production log · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}
        />
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-5 py-2.5 font-medium">Project</th>
                <th className="px-5 py-2.5 font-medium">Crew</th>
                <th className="px-5 py-2.5 text-right font-medium">Footage</th>
                <th className="px-5 py-2.5 text-right font-medium">Hours</th>
                <th className="px-5 py-2.5 text-right font-medium">Revenue</th>
                <th className="px-5 py-2.5 font-medium">Notes</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 100).map((e) => {
                const project = data.projects.find((p) => p.id === e.projectId)
                const crew = data.crews.find((c) => c.id === e.crewId)
                const entryItems = data.productionLineItems.filter((li) => li.productionEntryId === e.id)
                const revenue = entryItems.length > 0
                  ? entryItems.reduce((s, li) => s + li.extendedTotal, 0)
                  : null
                return (
                  <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-5 py-2.5 text-slate-600">{formatDate(e.date)}</td>
                    <td className="px-5 py-2.5 text-slate-700">{project?.name ?? '—'}</td>
                    <td className="px-5 py-2.5 text-slate-700">{crew?.name ?? '—'}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-slate-800">{number(e.footage)} ft</td>
                    <td className="px-5 py-2.5 text-right text-slate-600">{e.hours}</td>
                    <td className="px-5 py-2.5 text-right text-slate-600">
                      {revenue !== null ? <span className="text-emerald-700">{money(revenue)}</span> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-2.5 text-slate-400">{e.notes ?? ''}</td>
                    <td className="px-5 py-2.5 text-right">
                      <button onClick={() => deleteProduction(e.id)} className="text-slate-300 hover:text-rose-600" aria-label="Delete">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {entries.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-400">No production logged.</td></tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <ProductionModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Crew daily entry tab
// ---------------------------------------------------------------------------

function CrewDailyTab() {
  const { data, deleteCrewDayEntry } = useData()
  const { isAdmin } = useRole()
  const [open, setOpen] = useState(false)
  const [projectFilter, setProjectFilter] = useState('all')
  const today = new Date().toISOString().slice(0, 10)
  const [dateStart, setDateStart] = useState(() => weekStart(today))
  const [dateEnd, setDateEnd] = useState(() => weekEnd(today))

  const resetToThisWeek = () => {
    const now = new Date().toISOString().slice(0, 10)
    setDateStart(weekStart(now))
    setDateEnd(weekEnd(now))
  }

  // Production entries that have crew-day timecards linked to them
  const crewEntries = useMemo(() => {
    const entryIds = new Set(data.timecards.filter((t) => t.productionEntryId).map((t) => t.productionEntryId!))
    const list = data.production.filter((e) =>
      entryIds.has(e.id) &&
      e.date >= dateStart &&
      e.date <= dateEnd &&
      (projectFilter === 'all' || e.projectId === projectFilter)
    )
    return [...list].sort((a, b) => b.date.localeCompare(a.date))
  }, [data.production, data.timecards, dateStart, dateEnd, projectFilter])

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="w-48">
            <option value="all">All projects</option>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="w-40" />
          <span className="text-sm text-slate-400">to</span>
          <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="w-40" />
          <button onClick={resetToThisWeek} className="text-sm font-medium text-brand-600 hover:text-brand-700">
            This week
          </button>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> Log crew day
        </Button>
      </div>

      <Card>
        <CardHeader
          title={`Crew day log · ${crewEntries.length} ${crewEntries.length === 1 ? 'entry' : 'entries'}`}
        />
        <CardBody className="p-0">
          {crewEntries.length === 0 ? (
            <p className="px-5 py-10 text-center text-slate-400">
              No crew days logged yet. Use "Log crew day" to record a full crew's work.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {crewEntries.slice(0, 50).map((entry) => {
                const project = data.projects.find((p) => p.id === entry.projectId)
                const crew = data.crews.find((c) => c.id === entry.crewId)
                const foreman = data.employees.find((e) => e.isForeman && e.defaultCrewId === entry.crewId)
                const entryTimecards = data.timecards.filter((t) => t.productionEntryId === entry.id)
                const totalHours = entryTimecards.reduce((s, t) => s + t.hours, 0)
                const totalLabor = entryTimecards.reduce((s, t) => s + t.laborCost, 0)

                return (
                  <div key={entry.id} className="px-5 py-3">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="whitespace-nowrap text-xs text-slate-400">{formatDate(entry.date)}</span>
                          <span className="font-medium text-slate-800">{project?.name ?? '—'}</span>
                          <span className="text-sm text-slate-500">{crew?.name ?? '—'}</span>
                          {foreman && (
                            <span className="text-xs text-slate-400">· {foreman.name}</span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm">
                          <span className="flex items-center gap-1 text-slate-500">
                            <Users size={12} />{entryTimecards.length} employees
                          </span>
                          <span className="text-slate-500">{totalHours.toFixed(1)} hrs total</span>
                          {entry.footage > 0 && (
                            <span className="font-medium text-slate-700">{number(entry.footage)} ft</span>
                          )}
                          {isAdmin && totalLabor > 0 && (
                            <span className="font-medium text-emerald-700">{moneyExact(totalLabor)} labor</span>
                          )}
                          {entry.notes && (
                            <span className="text-xs text-slate-400 italic">{entry.notes}</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => { if (confirm('Delete this crew day entry?')) deleteCrewDayEntry(entry.id) }}
                        className="mt-0.5 text-slate-300 hover:text-rose-600"
                        aria-label="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    {/* Employee breakdown */}
                    <div className="mt-2 ml-0 divide-y divide-slate-50 rounded-lg border border-slate-100 bg-slate-50/60">
                      {entryTimecards.map((tc) => {
                        const emp = data.employees.find((e) => e.id === tc.employeeId)
                        return (
                          <div key={tc.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                            <span className="flex-1 text-slate-700">
                              {emp?.name ?? '—'}
                              {emp?.isForeman && (
                                <span className="ml-1.5 inline-flex items-center rounded bg-brand-100 px-1 py-0.5 text-[10px] font-semibold text-brand-700">FM</span>
                              )}
                              <span className="ml-1 text-xs text-slate-400">{emp?.role}</span>
                            </span>
                            <span className="text-slate-600">{tc.hours.toFixed(1)} hrs</span>
                            {isAdmin && (
                              <span className="w-20 text-right text-slate-500">{moneyExact(tc.laborCost)}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <CrewDayModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Page — Expenses live at /expenses in the sidebar
// ---------------------------------------------------------------------------

export function Production() {
  const [tab, setTab] = useState<'production' | 'crew'>('production')
  return (
    <div>
      <PageHeader
        title="Production Tracking"
        description="Daily footage placed by crew (rate-card driven) and crew labor entry."
      />
      <div className="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {(['production', 'crew'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              tab === t ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'production' ? 'Production' : 'Crew Entry'}
          </button>
        ))}
      </div>
      {tab === 'production' ? <ProductionTab /> : <CrewDailyTab />}
    </div>
  )
}

