import { useMemo, useState, useEffect, useCallback } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Plus, Trash2, X, FileText, PenLine, AlertCircle, Download, Clock, Camera, Pencil } from 'lucide-react'
import * as XLSX from 'xlsx'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select, Textarea } from '../components/ui/Form'
import { number, money, moneyExact, formatDateShort, workTypeLabel, localDateStr } from '../lib/format'
import { dailyProductionSeries, weekStart, weekEnd, daysInMonth, workTypeDivisions } from '../lib/analytics'
import { crewOrSubName } from '../lib/crewOrSub'
import { compressImage } from '../lib/imageCompress'
import { saveBlob } from '../lib/fileStore'
import { QaStatusBadge } from '../components/QaStatusBadge'
import { QaStatusFilterSelect, type QaStatusFilterValue } from '../components/QaStatusFilterSelect'
import type { RateCardUnit } from '../types'
import type { LineItemInput } from '../store/DataContext'
import type { PendingProduction } from '../lib/pendingProduction'

type PendingPhoto = { key: string; preview: string; caption: string }



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

type EmpRow = { employeeId: string; checked: boolean; hours: string; fromClock: boolean }

function ProductionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, addProduction, addPhoto } = useData()
  const navigate = useNavigate()
  const { isAdmin } = useRole()
  const today = localDateStr()
  const activeProjects = data.projects.filter((p) => p.status === 'active')

  // Only consider rate cards that actually have units loaded
  const hasUnits = (rcId: string) => data.rateCardUnits.some((u) => u.rateCardId === rcId)

  // Best-effort rate card resolution — always prefers cards that have units:
  // clientId+division > division-only > any card with units > first card
  const resolveRateCard = (projectId: string): string => {
    const proj = data.projects.find((p) => p.id === projectId)
    const divs = workTypeDivisions(proj?.workTypes ?? [])
    if (proj?.clientId && divs.length > 0) {
      const m = data.rateCards.find((rc) => rc.clientId === proj.clientId && (rc.divisions ?? []).some((d) => divs.includes(d)) && hasUnits(rc.id))
      if (m) return m.id
    }
    if (divs.length > 0) {
      const m = data.rateCards.find((rc) => (rc.divisions ?? []).some((d) => divs.includes(d)) && hasUnits(rc.id))
      if (m) return m.id
    }
    // Any rate card with units
    const any = data.rateCards.find((rc) => hasUnits(rc.id))
    if (any) return any.id
    // Nothing has units — return first card so the user sees the empty-state message
    return data.rateCards[0]?.id ?? ''
  }

  const initialProjectId = activeProjects[0]?.id ?? ''

  const pdfsForProject = (projectId: string) =>
    data.projectFiles.filter((f) => f.projectId === projectId && f.fileType === 'pdf')

  const [form, setForm] = useState({
    date: today,
    projectId: initialProjectId,
    crewId: data.crews[0]?.id ?? '',
    rateCardId: resolveRateCard(initialProjectId),
    notes: '',
  })
  const [rows, setRows] = useState<LineItemRow[]>([])
  const [nextKey, setNextKey] = useState(0)
  const [selectedFileId, setSelectedFileId] = useState<string>(() => pdfsForProject(initialProjectId)[0]?.id ?? '')
  const [empRows, setEmpRows] = useState<EmpRow[]>(() =>
    data.employees.filter((e) => e.active).map((e) => ({ employeeId: e.id, checked: false, hours: '8', fromClock: false }))
  )
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([])
  const [compressing, setCompressing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  // Auto-fill employee hours from time clock when date / project changes.
  // Match by employee + date only — NOT by project, because the employee's project
  // selection at clock-in time may differ from the foreman's production entry project.
  // Sum ALL completed sessions on that date so multi-session days are fully captured.
  useEffect(() => {
    const clockEntries = data.clockEntries ?? []
    setEmpRows(
      data.employees.filter((e) => e.active).map((emp) => {
        const daySessions = clockEntries.filter(
          (ce) =>
            ce.employeeId === emp.id &&
            ce.clockIn.slice(0, 10) === form.date &&
            !!ce.clockOut,
        )
        if (daySessions.length > 0) {
          const totalMs = daySessions.reduce(
            (s, ce) => s + (new Date(ce.clockOut!).getTime() - new Date(ce.clockIn).getTime()),
            0,
          )
          const hrs = Math.round((totalMs / 3_600_000) * 10) / 10
          return { employeeId: emp.id, checked: true, hours: String(hrs > 0 ? hrs : 8), fromClock: true }
        }
        return { employeeId: emp.id, checked: false, hours: '8', fromClock: false }
      }),
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date, form.crewId, form.projectId])

  const changeProject = (projectId: string) => {
    setForm((f) => ({ ...f, projectId, rateCardId: resolveRateCard(projectId) }))
    setRows([])
    setSelectedFileId(pdfsForProject(projectId)[0]?.id ?? '')
  }

  const projectPdfs = pdfsForProject(form.projectId)

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

  const toggleEmpProd = (id: string) =>
    setEmpRows((rows) => rows.map((r) => (r.employeeId === id ? { ...r, checked: !r.checked } : r)))
  const setHoursProd = (id: string, hrs: string) =>
    setEmpRows((rows) => rows.map((r) => (r.employeeId === id ? { ...r, hours: hrs, fromClock: false } : r)))

  const checkedEmpRows = empRows.filter((r) => r.checked)
  const totalHours = checkedEmpRows.reduce((s, r) => s + (parseFloat(r.hours) || 0), 0)
  const clockFilledCountProd = empRows.filter((r) => r.fromClock).length
  const totalLaborCostProd = checkedEmpRows.reduce((s, r) => {
    const emp = data.employees.find((e) => e.id === r.employeeId)
    return s + (emp ? (parseFloat(r.hours) || 0) * emp.hourlyRate : 0)
  }, 0)

  const canSubmit = !!(form.projectId && form.crewId && checkedEmpRows.length > 0 && checkedEmpRows.every((r) => parseFloat(r.hours) > 0) && pendingPhotos.length > 0)

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setCompressing(true)
    try {
      const newPhotos = await Promise.all(
        files.map(async (file) => {
          const preview = await compressImage(file)
          return { key: Date.now().toString(36) + Math.random().toString(36).slice(2), preview, caption: '' }
        })
      )
      setPendingPhotos((prev) => [...prev, ...newPhotos])
    } finally {
      setCompressing(false)
      e.target.value = ''
    }
  }

  const submitOnly = async () => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    try {
      const entryId = addProduction(
        { date: form.date, projectId: form.projectId, crewId: form.crewId, footage: Math.round(totalLF), hours: totalHours, notes: form.notes || undefined },
        lineItems.length > 0 ? lineItems : undefined,
      )
      await Promise.all(pendingPhotos.map(async (ph) => {
        const blobKey = 'pb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
        await saveBlob(blobKey, ph.preview)
        addPhoto({ projectId: form.projectId, caption: ph.caption || 'Production photo', category: 'progress', date: form.date, uploadedBy: 'Field', url: 'idb:' + blobKey, productionEntryId: entryId, crewId: form.crewId, capturedAt: new Date().toISOString() })
      }))
      setRows([])
      setEmpRows((rows) => rows.map((r) => ({ ...r, checked: false })))
      setPendingPhotos([])
      setForm((f) => ({ ...f, notes: '' }))
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const submitAndRedline = () => {
    if (!canSubmit || !selectedFileId || submitting) return
    const pending: PendingProduction = {
      type: 'simple',
      date: form.date,
      projectId: form.projectId,
      crewId: form.crewId,
      footage: Math.round(totalLF),
      hours: totalHours,
      notes: form.notes || undefined,
      lineItems,
      photos: pendingPhotos,
    }
    onClose()
    navigate(`/kmz/${form.projectId}`, { state: { pending } })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log production"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="secondary" onClick={submitOnly} disabled={!canSubmit || submitting}>{submitting ? 'Saving…' : 'Save only'}</Button>
          <Button onClick={submitAndRedline} disabled={!canSubmit || !selectedFileId || submitting} className="gap-1.5">
            <PenLine size={15} /> Save + Field Map
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Project">
          <Select value={form.projectId} onChange={(e) => changeProject(e.target.value)}>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Crew / Foreman">
            <Select value={form.crewId} onChange={(e) => set('crewId', e.target.value)}>
              {data.crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Rate card">
            <Select value={form.rateCardId} onChange={(e) => changeRateCard(e.target.value)}>
              <option value="">— Select rate card —</option>
              {data.rateCards.map((rc) => (
                <option key={rc.id} value={rc.id}>{rc.name}{(rc.divisions ?? []).length > 0 ? ` · ${rc.divisions.join(' + ')}` : ''}</option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Print selection — mandatory redline step */}
        <div className="sm:col-span-2">
          <div className={`rounded-lg border px-4 py-3 ${projectPdfs.length === 0 ? 'border-amber-200 bg-amber-50' : 'border-brand-100 bg-brand-50'}`}>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <PenLine size={13} /> Select print to mark up
            </p>
            {projectPdfs.length === 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-amber-700">
                <AlertCircle size={13} />
                <span>No prints uploaded for this project.</span>
                {form.projectId && (
                  <Link to={`/projects/${form.projectId}`} onClick={onClose} className="font-semibold underline">
                    Upload a print →
                  </Link>
                )}
                <span className="text-amber-500">(You can still "Save only" without a print.)</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {projectPdfs.map((f) => (
                  <label key={f.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition ${selectedFileId === f.id ? 'bg-brand-100' : 'hover:bg-brand-50/80'}`}>
                    <input
                      type="radio"
                      name="prod-file"
                      checked={selectedFileId === f.id}
                      onChange={() => setSelectedFileId(f.id)}
                      className="accent-brand-600"
                    />
                    <FileText size={14} className="shrink-0 text-red-500" />
                    <span className={`text-sm ${selectedFileId === f.id ? 'font-semibold text-brand-800' : 'text-slate-700'}`}>{f.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Employee selection — hours pulled from time clock */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Employees on site today</p>
          {clockFilledCountProd > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              <Clock size={10} /> {clockFilledCountProd} from time clock
            </span>
          )}
        </div>
        {clockFilledCountProd > 0 && (
          <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <Clock size={12} className="shrink-0" />
            Hours are pulled from the time clock and are read-only. To correct a clock entry, use the Time Clock page.
          </div>
        )}
        {empRows.length === 0 ? (
          <p className="text-sm text-slate-500">No active employees found.</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {empRows.map((row) => {
              const emp = data.employees.find((e) => e.id === row.employeeId)
              if (!emp) return null
              return (
                <div key={emp.id} className={`flex items-center gap-3 px-4 py-2.5 ${row.checked ? 'bg-brand-50/40' : ''}`}>
                  <input
                    type="checkbox"
                    checked={row.checked}
                    onChange={() => toggleEmpProd(emp.id)}
                    className="rounded border-slate-300"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-800">{emp.name}</span>
                    {emp.isForeman && (
                      <span className="ml-1.5 inline-flex items-center rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">Foreman</span>
                    )}
                    <span className="ml-1.5 text-xs text-slate-500">{emp.role}</span>
                    {row.fromClock && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <Clock size={8} /> clocked in
                      </span>
                    )}
                  </div>
                  {row.checked && (
                    row.fromClock ? (
                      <span className="flex items-center gap-1 text-sm font-semibold text-emerald-700">
                        <Clock size={13} />
                        {row.hours} hrs
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min="0"
                          step="0.5"
                          className="w-20 text-right text-sm border-amber-300"
                          value={row.hours}
                          onChange={(e) => setHoursProd(emp.id, e.target.value)}
                          placeholder="0"
                        />
                        <span className="text-xs text-amber-600">hrs*</span>
                      </div>
                    )
                  )}
                </div>
              )
            })}
          </div>
        )}
        {checkedEmpRows.length > 0 && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Total hours</span>
              <span className="font-semibold text-slate-800">{totalHours.toFixed(1)} hrs</span>
            </div>
            {isAdmin && (
              <div className="mt-0.5 flex items-center justify-between text-sm">
                <span className="text-slate-400">Est. labor cost</span>
                <span className="font-semibold text-slate-800">{moneyExact(totalLaborCostProd)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Rate card line items</p>
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
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
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
                            <option key={u.id} value={u.unitCode}>
                              {u.unitCode}{u.description ? ` — ${u.description}` : ''}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-400">{row.description}</td>
                      <td className="px-2 py-1.5 text-xs text-slate-400">{row.uom}</td>
                      <td className="px-2 py-1.5 text-right text-xs text-slate-400">{moneyExact(row.rateSnapshot)}</td>
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
                        <button onClick={() => removeRow(row.key)} className="text-slate-600 hover:text-rose-500" aria-label="Remove">
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
              <span className="text-slate-400">Total LF placed</span>
              <span className="font-semibold text-slate-800">{number(totalLF)} ft</span>
            </div>
            {isAdmin && (
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-slate-400">Total revenue</span>
                <span className="font-semibold text-emerald-700">{money(totalRevenue)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4">
        <Field label="Notes (optional)">
          <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Weather, delays, rework…" />
        </Field>
      </div>

      {/* Photo picker — mandatory */}
      <div className="mt-5">
        <div className={`rounded-xl border-2 transition-colors ${pendingPhotos.length === 0 ? 'border-dashed border-rose-300 bg-rose-50/40' : 'border-emerald-200 bg-emerald-50/30'}`}>
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <Camera size={15} className={pendingPhotos.length === 0 ? 'text-rose-500' : 'text-emerald-600'} />
              <p className={`text-sm font-semibold ${pendingPhotos.length === 0 ? 'text-rose-700' : 'text-emerald-800'}`}>
                Site photos <span className="text-rose-500">*</span>
                {pendingPhotos.length === 0
                  ? <span className="ml-2 text-xs font-normal text-rose-500">At least 1 required</span>
                  : <span className="ml-2 text-xs font-normal text-emerald-600">{pendingPhotos.length} photo{pendingPhotos.length > 1 ? 's' : ''} added</span>
                }
              </p>
            </div>
            <label className="cursor-pointer rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 transition">
              {compressing ? 'Processing…' : '+ Add photos'}
              <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoSelect} disabled={compressing} />
            </label>
          </div>
          {pendingPhotos.length === 0 ? (
            <p className="px-4 pb-3 text-xs text-rose-600">Take or select at least one site photo before submitting.</p>
          ) : (
            <div className="flex flex-wrap gap-3 px-4 pb-4">
              {pendingPhotos.map((ph) => (
                <div key={ph.key} className="relative">
                  <img src={ph.preview} alt="" className="h-20 w-20 rounded-lg object-cover shadow-sm" />
                  <button
                    type="button"
                    onClick={() => setPendingPhotos((prev) => prev.filter((p) => p.key !== ph.key))}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-xs font-bold text-white hover:bg-rose-600"
                  >×</button>
                  <input
                    value={ph.caption}
                    onChange={(e) => setPendingPhotos((prev) => prev.map((p) => p.key === ph.key ? { ...p, caption: e.target.value } : p))}
                    placeholder="Caption…"
                    className="mt-1 block w-20 truncate rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-400 placeholder-slate-300 focus:border-brand-400 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Crew Day Modal
// ---------------------------------------------------------------------------

function CrewDayModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, addCrewDayEntry, addPhoto } = useData()
  const navigate = useNavigate()
  const { isAdmin } = useRole()
  const today = localDateStr()
  const activeProjects = data.projects.filter((p) => p.status === 'active')

  const defaultCrewId = data.crews[0]?.id ?? ''

  const pdfsForProject = (projectId: string) =>
    data.projectFiles.filter((f) => f.projectId === projectId && f.fileType === 'pdf')

  const hasUnits = (rcId: string) => data.rateCardUnits.some((u) => u.rateCardId === rcId)
  const resolveRateCard = (projectId: string): string => {
    const proj = data.projects.find((p) => p.id === projectId)
    const divs = workTypeDivisions(proj?.workTypes ?? [])
    if (proj?.clientId && divs.length > 0) {
      const m = data.rateCards.find((rc) => rc.clientId === proj.clientId && (rc.divisions ?? []).some((d) => divs.includes(d)) && hasUnits(rc.id))
      if (m) return m.id
    }
    if (divs.length > 0) {
      const m = data.rateCards.find((rc) => (rc.divisions ?? []).some((d) => divs.includes(d)) && hasUnits(rc.id))
      if (m) return m.id
    }
    const any = data.rateCards.find((rc) => hasUnits(rc.id))
    if (any) return any.id
    return data.rateCards[0]?.id ?? ''
  }

  const initialProjId = activeProjects[0]?.id ?? ''

  const [form, setForm] = useState({
    date: today,
    projectId: initialProjId,
    crewId: defaultCrewId,
    footage: '',
    rateCardId: resolveRateCard(initialProjId),
    notes: '',
  })
  const setF = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const [rows, setRows] = useState<LineItemRow[]>([])
  const [nextKey, setNextKey] = useState(0)

  const [selectedFileId, setSelectedFileId] = useState<string>(() => pdfsForProject(initialProjId)[0]?.id ?? '')
  const [empRows, setEmpRows] = useState<EmpRow[]>([])
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([])
  const [compressing, setCompressing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // ── Auto-populate employees + hours from time clock whenever crew/date/project changes ──
  // Match by employee + date only — NOT by project, because what the employee selected
  // at clock-in time has no bearing on which project the foreman assigns the production entry to.
  // Sum ALL completed sessions on that date so multi-session (break) days are fully captured.
  useEffect(() => {
    const allActive = data.employees.filter((e) => e.active)
    const clockEntries = data.clockEntries ?? []

    setEmpRows(
      allActive.map((emp) => {
        const daySessions = clockEntries.filter(
          (ce) =>
            ce.employeeId === emp.id &&
            ce.clockIn.slice(0, 10) === form.date &&
            !!ce.clockOut,
        )
        if (daySessions.length > 0) {
          const totalMs = daySessions.reduce(
            (s, ce) => s + (new Date(ce.clockOut!).getTime() - new Date(ce.clockIn).getTime()),
            0,
          )
          const hrs = Math.round((totalMs / 3_600_000) * 10) / 10
          return { employeeId: emp.id, checked: true, hours: String(hrs > 0 ? hrs : 8), fromClock: true }
        }
        return { employeeId: emp.id, checked: false, hours: '8', fromClock: false }
      }),
    )
  // Re-run whenever date/project/crew change; omit `data` to avoid wiping manual edits on unrelated updates
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date, form.crewId, form.projectId])

  const changeCrew = (crewId: string) => {
    setForm((f) => ({ ...f, crewId }))
  }

  const changeProject = (projectId: string) => {
    setForm((f) => ({ ...f, projectId, rateCardId: resolveRateCard(projectId) }))
    setSelectedFileId(pdfsForProject(projectId)[0]?.id ?? '')
    setRows([])
  }

  const changeRateCard = (rateCardId: string) => {
    setForm((f) => ({ ...f, rateCardId }))
    setRows([])
  }

  const availableCrewUnits = useMemo(
    () => data.rateCardUnits.filter((u) => u.rateCardId === form.rateCardId),
    [data.rateCardUnits, form.rateCardId],
  )

  const addCrewRow = () => {
    const first = availableCrewUnits[0]
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

  const removeCrewRow = (key: number) => setRows((r) => r.filter((x) => x.key !== key))

  const updateCrewRowUnit = (key: number, unit: RateCardUnit) => {
    setRows((r) =>
      r.map((x) =>
        x.key === key
          ? { ...x, unitCode: unit.unitCode, description: unit.description, uom: unit.uom, rateSnapshot: unit.rate }
          : x,
      ),
    )
  }

  const updateCrewRowQty = (key: number, qty: string) => {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, quantity: qty } : x)))
  }

  const crewLineItems: LineItemInput[] = rows
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

  const crewTotalRevenue = crewLineItems.reduce((s, li) => s + li.extendedTotal, 0)
  const crewTotalLF = crewLineItems.filter((li) => li.uom === 'LF').reduce((s, li) => s + li.quantity, 0)

  const projectPdfs = pdfsForProject(form.projectId)

const toggleEmp = (id: string) =>
    setEmpRows((rows) => rows.map((r) => (r.employeeId === id ? { ...r, checked: !r.checked } : r)))
  const setHours = (id: string, hrs: string) =>
    setEmpRows((rows) => rows.map((r) => (r.employeeId === id ? { ...r, hours: hrs, fromClock: false } : r)))

  const checkedRows = empRows.filter((r) => r.checked)
  const totalHours = checkedRows.reduce((s, r) => s + (parseFloat(r.hours) || 0), 0)
  const totalLaborCost = checkedRows.reduce((s, r) => {
    const emp = data.employees.find((e) => e.id === r.employeeId)
    return s + (emp ? (parseFloat(r.hours) || 0) * emp.hourlyRate : 0)
  }, 0)
  const clockFilledCount = empRows.filter((r) => r.fromClock).length

  const canSubmit = !!(form.projectId && form.crewId && checkedRows.length > 0 && checkedRows.every((r) => parseFloat(r.hours) > 0) && pendingPhotos.length > 0)

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setCompressing(true)
    try {
      const newPhotos = await Promise.all(
        files.map(async (file) => {
          const preview = await compressImage(file)
          return { key: Date.now().toString(36) + Math.random().toString(36).slice(2), preview, caption: '' }
        })
      )
      setPendingPhotos((prev) => [...prev, ...newPhotos])
    } finally {
      setCompressing(false)
      e.target.value = ''
    }
  }

  const reset = () => {
    setForm((f) => ({ ...f, footage: '', notes: '' }))
    setRows([])
    setEmpRows((rows) => rows.map((r) => ({ ...r, checked: false })))
    setPendingPhotos([])
  }

  const submitOnly = async () => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    try {
      const entryId = addCrewDayEntry({
        date: form.date, projectId: form.projectId, crewId: form.crewId,
        footage: crewLineItems.length > 0 ? Math.round(crewTotalLF) : Math.round(parseFloat(form.footage) || 0),
        notes: form.notes || undefined,
        employees: checkedRows.map((r) => ({ employeeId: r.employeeId, hours: parseFloat(r.hours) })),
        lineItems: crewLineItems.length > 0 ? crewLineItems : undefined,
      })
      await Promise.all(pendingPhotos.map(async (ph) => {
        const blobKey = 'pb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
        await saveBlob(blobKey, ph.preview)
        addPhoto({ projectId: form.projectId, caption: ph.caption || 'Production photo', category: 'progress', date: form.date, uploadedBy: 'Field', url: 'idb:' + blobKey, productionEntryId: entryId, crewId: form.crewId, capturedAt: new Date().toISOString() })
      }))
      reset()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const submitAndRedline = () => {
    if (!canSubmit || !selectedFileId || submitting) return
    const pending: PendingProduction = {
      type: 'crewDay',
      date: form.date, projectId: form.projectId, crewId: form.crewId,
      footage: crewLineItems.length > 0 ? Math.round(crewTotalLF) : Math.round(parseFloat(form.footage) || 0),
      notes: form.notes || undefined,
      employees: checkedRows.map((r) => ({ employeeId: r.employeeId, hours: parseFloat(r.hours) })),
      photos: pendingPhotos,
    }
    reset()
    onClose()
    navigate(`/kmz/${form.projectId}`, { state: { pending } })
  }

  const selectedCrew = data.crews.find((c) => c.id === form.crewId)
  const foremanEmp = selectedCrew?.foremanId
    ? data.employees.find((e) => e.id === selectedCrew.foremanId)
    : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log crew day"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="secondary" onClick={submitOnly} disabled={!canSubmit || submitting}>{submitting ? 'Saving…' : 'Save only'}</Button>
          <Button onClick={submitAndRedline} disabled={!canSubmit || !selectedFileId || submitting} className="gap-1.5">
            <PenLine size={15} /> Save + Field Map
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => setF('date', e.target.value)} />
        </Field>
        <Field label="Project / job">
          <Select value={form.projectId} onChange={(e) => changeProject(e.target.value)}>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Crew / Foreman">
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
        <div className="sm:col-span-2">
          <Field label="Rate card">
            <Select value={form.rateCardId} onChange={(e) => changeRateCard(e.target.value)}>
              <option value="">— Select rate card —</option>
              {data.rateCards.map((rc) => (
                <option key={rc.id} value={rc.id}>{rc.name}{(rc.divisions ?? []).length > 0 ? ` · ${rc.divisions.join(' + ')}` : ''}</option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Print selection */}
        <div className="sm:col-span-2">
          <div className={`rounded-lg border px-4 py-3 ${projectPdfs.length === 0 ? 'border-amber-200 bg-amber-50' : 'border-brand-100 bg-brand-50'}`}>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <PenLine size={13} /> Select print to mark up
            </p>
            {projectPdfs.length === 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-amber-700">
                <AlertCircle size={13} />
                <span>No prints uploaded for this project.</span>
                {form.projectId && (
                  <Link to={`/projects/${form.projectId}`} onClick={onClose} className="font-semibold underline">
                    Upload a print →
                  </Link>
                )}
                <span className="text-amber-500">(You can still "Save only" without a print.)</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {projectPdfs.map((f) => (
                  <label key={f.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition ${selectedFileId === f.id ? 'bg-brand-100' : 'hover:bg-brand-50/80'}`}>
                    <input
                      type="radio"
                      name="crew-file"
                      checked={selectedFileId === f.id}
                      onChange={() => setSelectedFileId(f.id)}
                      className="accent-brand-600"
                    />
                    <FileText size={14} className="shrink-0 text-red-500" />
                    <span className={`text-sm ${selectedFileId === f.id ? 'font-semibold text-brand-800' : 'text-slate-700'}`}>{f.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedCrew && (
        <p className="mt-1 text-xs text-slate-500">
          {workTypeLabel[selectedCrew.specialty]} crew
          {(foremanEmp?.name ?? selectedCrew.foreman) ? ` · Foreman: ${foremanEmp?.name ?? selectedCrew.foreman}` : ''}
        </p>
      )}

      {/* Rate card line items */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Work units placed</p>
          <Button variant="ghost" className="py-1 text-xs" onClick={addCrewRow} disabled={availableCrewUnits.length === 0}>
            <Plus size={13} /> Add unit
          </Button>
        </div>

        {!form.rateCardId && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Select a rate card above to enable unit entry. Or enter raw footage below.
          </p>
        )}

        {form.rateCardId && availableCrewUnits.length === 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            No units in this rate card. Add units in <strong>Rate Cards</strong>, or use the footage field below.
          </p>
        )}

        {rows.length === 0 && availableCrewUnits.length > 0 && (
          <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            No units added — enter raw footage below, or click "Add unit" to log by rate card code.
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
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
                            const unit = availableCrewUnits.find((u) => u.unitCode === e.target.value)
                            if (unit) updateCrewRowUnit(row.key, unit)
                          }}
                        >
                          {availableCrewUnits.map((u) => (
                            <option key={u.id} value={u.unitCode}>
                              {u.unitCode}{u.description ? ` — ${u.description}` : ''}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-400">{row.description}</td>
                      <td className="px-2 py-1.5 text-xs text-slate-400">{row.uom}</td>
                      <td className="px-2 py-1.5 text-right text-xs text-slate-400">{moneyExact(row.rateSnapshot)}</td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          className="w-20 text-right text-xs"
                          value={row.quantity}
                          onChange={(e) => updateCrewRowQty(row.key, e.target.value)}
                          placeholder="0"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs font-medium text-slate-800">
                        {moneyExact(extended)}
                      </td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => removeCrewRow(row.key)} className="text-slate-600 hover:text-rose-500" aria-label="Remove">
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

        {crewLineItems.length > 0 && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Total LF placed</span>
              <span className="font-semibold text-slate-800">{number(crewTotalLF)} ft</span>
            </div>
            {isAdmin && (
              <div className="mt-0.5 flex items-center justify-between text-sm">
                <span className="text-slate-400">Total revenue</span>
                <span className="font-semibold text-emerald-700">{money(crewTotalRevenue)}</span>
              </div>
            )}
          </div>
        )}

        {/* Fallback raw footage — only shown when no line items entered */}
        {rows.length === 0 && (
          <div className="mt-3">
            <Field label="Footage placed (ft)" hint="Used when no rate card units are entered above">
              <Input type="number" min="0" step="1" value={form.footage} onChange={(e) => setF('footage', e.target.value)} placeholder="0" />
            </Field>
          </div>
        )}
      </div>

      {/* Equipment — auto-applied from crew assignment, no selection needed */}
      {(() => {
        const crewEquip = data.equipment.filter((eq) => eq.active && eq.crewId === form.crewId)
        if (crewEquip.length === 0) return null
        const dailyCost = crewEquip.reduce((s, eq) => s + eq.monthlyCost / daysInMonth(form.date || localDateStr()), 0)
        return (
          <div className="mt-3 rounded-lg border border-purple-100 bg-purple-50 px-4 py-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-purple-600">
              Equipment — auto-included for this crew
            </p>
            <div className="space-y-1">
              {crewEquip.map((eq) => (
                <div key={eq.id} className="flex items-center justify-between text-sm">
                  <span className="text-purple-800">{eq.name}
                    <span className="ml-1.5 text-xs font-normal text-purple-600">· {eq.category}</span>
                  </span>
                  {isAdmin && <span className="text-xs font-medium text-purple-600">{moneyExact(eq.monthlyCost / daysInMonth(form.date || localDateStr()))}/day</span>}
                </div>
              ))}
            </div>
            {isAdmin && (
              <div className="mt-2 flex items-center justify-between border-t border-purple-200 pt-2 text-sm font-semibold text-purple-700">
                <span>Equipment total today</span>
                <span>{moneyExact(dailyCost)}</span>
              </div>
            )}
          </div>
        )
      })()}

      {/* Employee rows — filtered to this crew, hours pre-filled from time clock */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Crew members worked today
          </p>
          {clockFilledCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              <Clock size={10} /> {clockFilledCount} hours from time clock
            </span>
          )}
        </div>

        {clockFilledCount > 0 && (
          <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <Clock size={12} className="shrink-0" />
            Hours are pulled directly from the time clock and are read-only. To correct a clock entry, use the Time Clock page.
          </div>
        )}

        {empRows.length === 0 ? (
          <p className="text-sm text-slate-500">No active employees found. Add employees first.</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {empRows.map((row) => {
              const emp = data.employees.find((e) => e.id === row.employeeId)
              if (!emp) return null
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
                    <span className="ml-1.5 text-xs text-slate-500">{emp.role}</span>
                    {row.fromClock && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <Clock size={8} /> clocked in
                      </span>
                    )}
                  </div>
                  {row.checked && (
                    row.fromClock ? (
                      <span className="flex items-center gap-1 text-sm font-semibold text-emerald-700">
                        <Clock size={13} />
                        {row.hours} hrs
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min="0"
                          step="0.5"
                          className="w-20 text-right text-sm border-amber-300"
                          value={row.hours}
                          onChange={(e) => setHours(emp.id, e.target.value)}
                          placeholder="0"
                        />
                        <span className="text-xs text-amber-600">hrs*</span>
                      </div>
                    )
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {checkedRows.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          {crewLineItems.length === 0 && (parseFloat(form.footage) || 0) === 0 && (
            <p className="mb-2 text-xs font-semibold text-amber-600">
              No-production day — labor &amp; equipment costs will be recorded with $0 revenue.
            </p>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Footage</span>
            <span className="font-medium text-slate-800">
              {number(crewLineItems.length > 0 ? Math.round(crewTotalLF) : (parseFloat(form.footage) || 0))} ft
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="text-slate-400">Employees</span>
            <span className="font-medium text-slate-800">{checkedRows.length}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="text-slate-400">Total hours</span>
            <span className="font-semibold text-slate-800">{totalHours.toFixed(2)} hrs</span>
          </div>
          {isAdmin && (
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-slate-400">Total labor cost</span>
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

      {/* Photo picker — mandatory */}
      <div className="mt-5">
        <div className={`rounded-xl border-2 transition-colors ${pendingPhotos.length === 0 ? 'border-dashed border-rose-300 bg-rose-50/40' : 'border-emerald-200 bg-emerald-50/30'}`}>
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <Camera size={15} className={pendingPhotos.length === 0 ? 'text-rose-500' : 'text-emerald-600'} />
              <p className={`text-sm font-semibold ${pendingPhotos.length === 0 ? 'text-rose-700' : 'text-emerald-800'}`}>
                Site photos <span className="text-rose-500">*</span>
                {pendingPhotos.length === 0
                  ? <span className="ml-2 text-xs font-normal text-rose-500">At least 1 required</span>
                  : <span className="ml-2 text-xs font-normal text-emerald-600">{pendingPhotos.length} photo{pendingPhotos.length > 1 ? 's' : ''} added</span>
                }
              </p>
            </div>
            <label className="cursor-pointer rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 transition">
              {compressing ? 'Processing…' : '+ Add photos'}
              <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoSelect} disabled={compressing} />
            </label>
          </div>
          {pendingPhotos.length === 0 ? (
            <p className="px-4 pb-3 text-xs text-rose-600">Take or select at least one site photo before submitting.</p>
          ) : (
            <div className="flex flex-wrap gap-3 px-4 pb-4">
              {pendingPhotos.map((ph) => (
                <div key={ph.key} className="relative">
                  <img src={ph.preview} alt="" className="h-20 w-20 rounded-lg object-cover shadow-sm" />
                  <button
                    type="button"
                    onClick={() => setPendingPhotos((prev) => prev.filter((p) => p.key !== ph.key))}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-xs font-bold text-white hover:bg-rose-600"
                  >×</button>
                  <input
                    value={ph.caption}
                    onChange={(e) => setPendingPhotos((prev) => prev.map((p) => p.key === ph.key ? { ...p, caption: e.target.value } : p))}
                    placeholder="Caption…"
                    className="mt-1 block w-20 truncate rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-400 placeholder-slate-300 focus:border-brand-400 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Edit entry modal — change project or crew on any existing production entry
// ---------------------------------------------------------------------------

function EditEntryModal({
  entryId,
  onClose,
}: {
  entryId: string
  onClose: () => void
}) {
  const { data, patchProductionEntry } = useData()
  const entry = data.production.find((e) => e.id === entryId)
  const existingLineItems = useMemo(
    () => data.productionLineItems.filter((li) => li.productionEntryId === entryId),
    [data.productionLineItems, entryId],
  )

  const [date, setDate]           = useState(entry?.date ?? '')
  const [projectId, setProjectId] = useState(entry?.projectId ?? '')
  const [crewId, setCrewId]       = useState(entry?.crewId ?? '')
  const [footage, setFootage]     = useState(String(entry?.footage ?? ''))
  const [notes, setNotes]         = useState(entry?.notes ?? '')

  const hasUnits = (rcId: string) => data.rateCardUnits.some((u) => u.rateCardId === rcId)
  const resolveRateCardEdit = (projId: string): string => {
    const proj = data.projects.find((p) => p.id === projId)
    const divs = workTypeDivisions(proj?.workTypes ?? [])
    if (proj?.clientId && divs.length > 0) {
      const m = data.rateCards.find((rc) => rc.clientId === proj.clientId && (rc.divisions ?? []).some((d) => divs.includes(d)) && hasUnits(rc.id))
      if (m) return m.id
    }
    if (divs.length > 0) {
      const m = data.rateCards.find((rc) => (rc.divisions ?? []).some((d) => divs.includes(d)) && hasUnits(rc.id))
      if (m) return m.id
    }
    const any = data.rateCards.find((rc) => hasUnits(rc.id))
    if (any) return any.id
    return data.rateCards[0]?.id ?? ''
  }

  const [rateCardId, setRateCardId] = useState(() => resolveRateCardEdit(entry?.projectId ?? ''))
  const [rows, setRows] = useState<LineItemRow[]>(() =>
    existingLineItems.map((li, i) => ({
      key: i,
      unitCode: li.unitCode,
      description: li.description,
      uom: li.uom,
      rateSnapshot: li.rateSnapshot,
      quantity: String(li.quantity),
    }))
  )
  const [nextKey, setNextKey] = useState(existingLineItems.length)

  const availableEditUnits = useMemo(
    () => data.rateCardUnits.filter((u) => u.rateCardId === rateCardId),
    [data.rateCardUnits, rateCardId],
  )

  const addEditRow = () => {
    const first = availableEditUnits[0]
    setRows((r) => [
      ...r,
      { key: nextKey, unitCode: first?.unitCode ?? '', description: first?.description ?? '', uom: first?.uom ?? 'LF', rateSnapshot: first?.rate ?? 0, quantity: '' },
    ])
    setNextKey((k) => k + 1)
  }

  const removeEditRow = (key: number) => setRows((r) => r.filter((x) => x.key !== key))

  const updateEditRowUnit = (key: number, unit: RateCardUnit) => {
    setRows((r) =>
      r.map((x) =>
        x.key === key ? { ...x, unitCode: unit.unitCode, description: unit.description, uom: unit.uom, rateSnapshot: unit.rate } : x,
      ),
    )
  }

  const updateEditRowQty = (key: number, qty: string) => {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, quantity: qty } : x)))
  }

  const editLineItems: LineItemInput[] = rows
    .filter((r) => r.unitCode && parseFloat(r.quantity) > 0)
    .map((r) => {
      const qty = parseFloat(r.quantity)
      return { unitCode: r.unitCode, description: r.description, uom: r.uom, quantity: qty, rateSnapshot: r.rateSnapshot, extendedTotal: Math.round(qty * r.rateSnapshot * 100) / 100 }
    })
  const editTotalRevenue = editLineItems.reduce((s, li) => s + li.extendedTotal, 0)
  const editTotalLF = editLineItems.filter((li) => li.uom === 'LF').reduce((s, li) => s + li.quantity, 0)

  // When line items are present footage comes from LF quantities, not manual input
  const hasLineItems = rows.length > 0

  if (!entry) return null

  const save = () => {
    const patch: Parameters<typeof patchProductionEntry>[1] = {}
    if (date      !== entry.date)             patch.date      = date
    if (projectId !== entry.projectId)        patch.projectId = projectId
    if (crewId    !== entry.crewId)           patch.crewId    = crewId
    if (!hasLineItems) {
      const ft = parseFloat(footage)
      if (!isNaN(ft) && ft !== entry.footage) patch.footage = ft
    }
    if (notes !== (entry.notes ?? ''))        patch.notes     = notes
    // Always sync line items if the user has touched them (rows changed vs existing)
    if (rows.length > 0 || existingLineItems.length > 0) patch.lineItems = editLineItems
    if (Object.keys(patch).length > 0) patchProductionEntry(entryId, patch)
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit production entry"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save changes</Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Date + Project side by side */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Project">
            <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setRateCardId(resolveRateCardEdit(e.target.value)) }}>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Crew">
          <Select value={crewId} onChange={(e) => setCrewId(e.target.value)}>
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

        {/* Unit codes / line items */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unit codes / line items</p>
            <div className="flex items-center gap-2">
              <Select className="text-xs" value={rateCardId} onChange={(e) => setRateCardId(e.target.value)}>
                <option value="">— Rate card —</option>
                {data.rateCards.map((rc) => (
                  <option key={rc.id} value={rc.id}>{rc.name}</option>
                ))}
              </Select>
              <Button variant="ghost" className="py-1 text-xs" onClick={addEditRow} disabled={availableEditUnits.length === 0}>
                <Plus size={13} /> Add
              </Button>
            </div>
          </div>

          {rows.length === 0 && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {existingLineItems.length === 0
                ? 'No unit codes on this entry — enter raw footage below.'
                : 'All units removed — saving will clear line items and use raw footage.'}
            </p>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">Code</th>
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
                    return (
                      <tr key={row.key} className="border-t border-slate-100">
                        <td className="px-2 py-1.5">
                          <Select
                            className="text-xs"
                            value={row.unitCode}
                            onChange={(e) => {
                              const unit = availableEditUnits.find((u) => u.unitCode === e.target.value)
                              if (unit) updateEditRowUnit(row.key, unit)
                            }}
                          >
                            {availableEditUnits.length === 0 && <option value={row.unitCode}>{row.unitCode}</option>}
                            {availableEditUnits.map((u) => (
                              <option key={u.id} value={u.unitCode}>{u.unitCode}{u.description ? ` — ${u.description}` : ''}</option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-2 py-1.5 text-xs text-slate-400">{row.uom}</td>
                        <td className="px-2 py-1.5 text-right text-xs text-slate-400">{moneyExact(row.rateSnapshot)}</td>
                        <td className="px-2 py-1.5">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            className="w-20 text-right text-xs"
                            value={row.quantity}
                            onChange={(e) => updateEditRowQty(row.key, e.target.value)}
                            placeholder="0"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs font-medium text-slate-600">
                          {moneyExact(qty * row.rateSnapshot)}
                        </td>
                        <td className="px-2 py-1.5">
                          <button onClick={() => removeEditRow(row.key)} className="text-slate-400 hover:text-rose-500" aria-label="Remove">
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

          {editLineItems.length > 0 && (
            <div className="mt-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <span className="text-slate-400">LF placed</span>
              <span className="font-semibold text-slate-600">{number(editTotalLF)} ft</span>
              <span className="text-slate-400">Revenue</span>
              <span className="font-semibold text-emerald-500">{money(editTotalRevenue)}</span>
            </div>
          )}
        </div>

        {/* Footage — manual entry when no line items; computed when line items present */}
        {hasLineItems ? (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <span>Footage (from LF units)</span>
            <span className="font-mono font-semibold text-slate-600">{number(editTotalLF)} ft</span>
          </div>
        ) : (
          <Field label="Footage (ft)">
            <Input
              type="number"
              min="0"
              step="1"
              value={footage}
              onChange={(e) => setFootage(e.target.value)}
              placeholder="0"
            />
          </Field>
        )}

        <Field label="Notes (optional)">
          <Input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Weather, delays, rework…"
          />
        </Field>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Production tab
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Export modal
// ---------------------------------------------------------------------------

function ExportModal({
  onClose,
  defaultProject,
  defaultStart,
  defaultEnd,
}: {
  onClose: () => void
  defaultProject: string
  defaultStart: string
  defaultEnd: string
}) {
  const { data } = useData()
  const [projectId, setProjectId] = useState(defaultProject)
  const [dateStart, setDateStart] = useState(defaultStart)
  const [dateEnd, setDateEnd]     = useState(defaultEnd)

  const doExport = () => {
    // Entries in scope
    const entries = data.production.filter(
      (e) => e.date >= dateStart && e.date <= dateEnd &&
        (projectId === 'all' || e.projectId === projectId),
    ).sort((a, b) => a.date.localeCompare(b.date))

    const projectName = projectId === 'all'
      ? 'All Projects'
      : (data.projects.find((p) => p.id === projectId)?.name ?? 'Export')

    // ── Sheet 1: Production Summary ──
    const summaryRows = entries.map((e) => {
      const proj  = data.projects.find((p) => p.id === e.projectId)
      const items = data.productionLineItems.filter((li) => li.productionEntryId === e.id)
      const revenue = items.reduce((s, li) => s + li.extendedTotal, 0)
      return {
        Date:     e.date,
        Project:  proj?.name ?? '',
        Client:   proj?.client ?? '',
        Crew:     crewOrSubName(data, e.crewId, e.subcontractorId),
        'Footage (ft)': e.footage,
        'Hours':        e.hours,
        'Revenue ($)':  revenue,
        Notes:    e.notes ?? '',
      }
    })

    // ── Sheet 2: Line Item Detail ──
    const lineRows: Record<string, string | number>[] = []
    for (const e of entries) {
      const proj  = data.projects.find((p) => p.id === e.projectId)
      const items = data.productionLineItems.filter((li) => li.productionEntryId === e.id)
      if (items.length === 0) continue
      for (const li of items) {
        lineRows.push({
          Date:         e.date,
          Project:      proj?.name ?? '',
          Client:       proj?.client ?? '',
          Crew:         crewOrSubName(data, e.crewId, e.subcontractorId),
          'Unit Code':  li.unitCode,
          Description:  li.description,
          UOM:          li.uom,
          Quantity:     li.quantity,
          'Rate ($)':   li.rateSnapshot,
          'Total ($)':  li.extendedTotal,
        })
      }
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows),  'Production')
    if (lineRows.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lineRows), 'Line Items')
    }

    const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_')
    XLSX.writeFile(wb, `production_${safeName}_${dateStart}_${dateEnd}.xlsx`)
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Export production to Excel"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={doExport}>
            <Download size={15} /> Export
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Project / Job">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="all">All projects</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.client ? ` — ${p.client}` : ''}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
          </Field>
        </div>
        {(() => {
          const count = data.production.filter(
            (e) => e.date >= dateStart && e.date <= dateEnd &&
              (projectId === 'all' || e.projectId === projectId),
          ).length
          return (
            <p className="text-sm text-slate-400">
              <span className="font-semibold text-slate-700">{count}</span> production {count === 1 ? 'entry' : 'entries'} will be exported.
            </p>
          )
        })()}
      </div>
    </Modal>
  )
}

function ProductionTab({ initial }: { initial?: { projectId: string; date: string } }) {
  const { data, deleteProduction } = useData()
  const { isAdmin, activeEmployeeId } = useRole()
  const [open, setOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [editEntryId, setEditEntryId] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useState(initial?.projectId ?? 'all')
  const [qaFilter, setQaFilter] = useState<QaStatusFilterValue>('all')
  const today = localDateStr()
  const [dateStart, setDateStart] = useState(initial?.date ?? '2020-01-01')
  const [dateEnd,   setDateEnd]   = useState(initial?.date ?? today)

  const jumpToThisWeek = () => {
    const now = localDateStr()
    setDateStart(weekStart(now))
    setDateEnd(weekEnd(now))
  }
  const showAll = () => { setDateStart('2020-01-01'); setDateEnd(today) }

  // In field mode, only show production entries the employee has a timecard for
  const myProdIds = useMemo(() => {
    if (isAdmin || !activeEmployeeId) return null
    return new Set(
      data.timecards
        .filter((tc) => tc.employeeId === activeEmployeeId && tc.productionEntryId)
        .map((tc) => tc.productionEntryId as string),
    )
  }, [isAdmin, activeEmployeeId, data.timecards])

  // A line item "matches" the active QA filter — 'none' means logged outside
  // the redline workflow entirely (no qaStatus at all), matching an entry's
  // own fallback row when it has no rate-card line items.
  // Line items with no qaStatus at all (logged before the redline QA/QC
  // workflow existed, or via the plain Log Production/Log Crew Day flows)
  // are treated as implicitly "approved" — they were never submitted for
  // review, so there's nothing pending or rejected about them.
  const qaMatches = useCallback((status: string | undefined) => {
    if (qaFilter === 'all') return true
    return (status ?? 'approved') === qaFilter
  }, [qaFilter])

  const entries = useMemo(() => {
    return [...data.production]
      .filter((e) =>
        e.date >= dateStart &&
        e.date <= dateEnd &&
        (projectFilter === 'all' || e.projectId === projectFilter) &&
        (myProdIds === null || myProdIds.has(e.id)) &&
        (qaFilter === 'all' || (() => {
          const items = data.productionLineItems.filter((li) => li.productionEntryId === e.id)
          return items.length > 0 ? items.some((li) => qaMatches(li.qaStatus)) : qaMatches(undefined)
        })())
      )
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [data.production, data.productionLineItems, dateStart, dateEnd, projectFilter, myProdIds, qaFilter, qaMatches])

  const footageInRange = entries.reduce((s, e) => s + e.footage, 0)
  const hoursInRange = entries.reduce((s, e) => s + e.hours, 0)
  const avgRate = hoursInRange > 0 ? footageInRange / hoursInRange : 0
  const revenueInRange = useMemo(() => {
    const ids = new Set(entries.map((e) => e.id))
    return data.pnl.filter((p) => p.productionEntryId && ids.has(p.productionEntryId)).reduce((s, p) => s + p.revenue, 0)
  }, [entries, data.pnl])

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
          <span className="text-sm text-slate-500">to</span>
          <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="w-40" />
          <button onClick={jumpToThisWeek} className="text-sm font-medium text-brand-600 hover:text-brand-700">
            This week
          </button>
          <button onClick={showAll} className="text-sm font-medium text-slate-400 hover:text-slate-700">
            All time
          </button>
          {isAdmin && <QaStatusFilterSelect value={qaFilter} onChange={setQaFilter} className="w-56" />}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setExportOpen(true)}>
              <Download size={15} /> Export
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} /> Log production
            </Button>
          </div>
        )}
      </div>

      <div className={`grid gap-4 grid-cols-2 ${isAdmin ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        <StatCard label="Footage" value={`${number(footageInRange)} ft`} hint="in selected range" />
        <StatCard label="Crew-hours" value={hoursInRange.toFixed(1)} hint="in selected range" />
        <StatCard label="Ft / Hr" value={avgRate.toFixed(0)} hint="avg pace" />
        {isAdmin && <StatCard label="Revenue" value={money(revenueInRange)} hint="in selected range" />}
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
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div>
            <p className="text-sm font-semibold text-slate-800">Production log</p>
            <p className="text-xs text-slate-500">{entries.length} {entries.length === 1 ? 'entry' : 'entries'} in range</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Crew</th>
                <th className="px-4 py-3 text-right">Footage</th>
                <th className="px-4 py-3 text-right">Hours</th>
                <th className="px-4 py-3 text-right">Ft/Hr</th>
                {isAdmin && <th className="px-4 py-3 text-right">Revenue</th>}
                {isAdmin && <th className="px-4 py-3 text-right">$/Ft</th>}
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e, i) => {
                const project = data.projects.find((p) => p.id === e.projectId)
                const crewLabel = crewOrSubName(data, e.crewId, e.subcontractorId)
                const pnlEntry = data.pnl.find((p) => p.productionEntryId === e.id)
                const entryItems = data.productionLineItems.filter((li) => li.productionEntryId === e.id)
                const revenue = pnlEntry?.revenue ?? (entryItems.length > 0 ? entryItems.reduce((s, li) => s + li.extendedTotal, 0) : 0)
                const ftPerHr = e.hours > 0 ? e.footage / e.hours : 0
                const dollarPerFt = revenue > 0 && e.footage > 0 ? revenue / e.footage : 0
                const rowBg = i % 2 === 0 ? 'bg-transparent' : 'bg-slate-50/60'
                // One full row per rate-card line item, not one blended row per
                // entry — two different unit codes on the same work item can (and
                // often do) bill at two different rates, and a single combined
                // revenue/$-per-ft number hides that. Date/Project/Crew/Hours/
                // Notes/Actions span across an entry's rows since those are
                // entry-level, not per-item. Falls back to the entry's own
                // footage/revenue as a single row when there are no rate-card
                // line items (e.g. manually-entered raw footage).
                const allLineRows = entryItems.length > 0
                  ? entryItems.map((li) => ({ key: li.id, unitCode: li.unitCode as string | null, quantity: li.quantity, revenue: li.extendedTotal, rate: li.rateSnapshot, qaStatus: li.qaStatus }))
                  : [{ key: e.id, unitCode: null, quantity: e.footage, revenue, rate: dollarPerFt, qaStatus: undefined }]
                const lineRows = qaFilter === 'all' ? allLineRows : allLineRows.filter((lr) => qaMatches(lr.qaStatus))
                const span = lineRows.length
                return lineRows.map((lr, j) => (
                  <tr key={lr.key} className={`${rowBg} hover:bg-slate-50`}>
                    {j === 0 && (
                      <>
                        <td rowSpan={span} className="whitespace-nowrap px-4 py-2.5 align-top text-slate-400">{formatDateShort(e.date)}</td>
                        <td rowSpan={span} className="max-w-[140px] truncate px-4 py-2.5 align-top font-medium text-slate-800">{project?.name ?? '—'}</td>
                        <td rowSpan={span} className="px-4 py-2.5 align-top text-slate-400">{crewLabel}</td>
                      </>
                    )}
                    <td className="px-4 py-2.5 text-right">
                      <div className="font-mono font-semibold text-slate-800">{number(lr.quantity)}</div>
                      {lr.unitCode && <div className="mt-0.5 text-[10px] font-normal leading-tight text-slate-400">{lr.unitCode}</div>}
                      <div className="mt-1 flex justify-end"><QaStatusBadge status={lr.qaStatus ?? 'approved'} /></div>
                    </td>
                    {j === 0 && (
                      <>
                        <td rowSpan={span} className="px-4 py-2.5 text-right align-top font-mono text-slate-400">{typeof e.hours === 'number' ? e.hours.toFixed(1) : e.hours}</td>
                        <td rowSpan={span} className="px-4 py-2.5 text-right align-top font-mono text-slate-400">{ftPerHr > 0 ? ftPerHr.toFixed(0) : <span className="text-slate-600">—</span>}</td>
                      </>
                    )}
                    {isAdmin && (
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-700">
                        {lr.revenue > 0 ? money(lr.revenue) : <span className="font-normal text-slate-600">—</span>}
                      </td>
                    )}
                    {isAdmin && (
                      <td className="px-4 py-2.5 text-right font-mono text-slate-400">
                        {lr.rate > 0 ? `$${lr.rate.toFixed(2)}` : <span className="text-slate-600">—</span>}
                      </td>
                    )}
                    {j === 0 && (
                      <>
                        <td rowSpan={span} className="max-w-[120px] truncate px-4 py-2.5 align-top text-xs text-slate-500">{e.notes ?? ''}</td>
                        <td rowSpan={span} className="px-4 py-2.5 align-top">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setEditEntryId(e.id)} className="rounded p-1 text-slate-600 hover:bg-brand-50 hover:text-brand-600" aria-label="Edit">
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => { if (confirm('Delete this production entry?')) deleteProduction(e.id) }} className="rounded p-1 text-slate-600 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              })}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 10 : 8} className="px-4 py-10 text-center text-slate-500">No production logged in this range.</td>
                </tr>
              )}
            </tbody>
            {entries.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-400">
                  <td colSpan={3} className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-700">{number(footageInRange)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-700">{hoursInRange.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-400">{hoursInRange > 0 ? (footageInRange / hoursInRange).toFixed(0) : '—'}</td>
                  {isAdmin && <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-700">{money(revenueInRange)}</td>}
                  {isAdmin && (
                    <td className="px-4 py-2.5 text-right font-mono text-slate-400">
                      {footageInRange > 0 ? `$${(revenueInRange / footageInRange).toFixed(2)}` : '—'}
                    </td>
                  )}
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      <ProductionModal open={open} onClose={() => setOpen(false)} />
      {exportOpen && (
        <ExportModal
          onClose={() => setExportOpen(false)}
          defaultProject={projectFilter}
          defaultStart={dateStart}
          defaultEnd={dateEnd}
        />
      )}
      {editEntryId && <EditEntryModal entryId={editEntryId} onClose={() => setEditEntryId(null)} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// Crew daily entry tab
// ---------------------------------------------------------------------------

function CrewDailyTab({ initial }: { initial?: { projectId: string; date: string } }) {
  const { data, deleteCrewDayEntry } = useData()
  const { isAdmin, activeEmployeeId } = useRole()
  const [open, setOpen] = useState(false)
  const [editEntryId, setEditEntryId] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useState(initial?.projectId ?? 'all')
  const [qaFilter, setQaFilter] = useState<QaStatusFilterValue>('all')
  const today = localDateStr()
  const [dateStart, setDateStart] = useState(initial?.date ?? '2020-01-01')
  const [dateEnd,   setDateEnd]   = useState(initial?.date ?? today)

  const jumpToThisWeek = () => {
    const now = localDateStr()
    setDateStart(weekStart(now))
    setDateEnd(weekEnd(now))
  }
  const showAllDates = () => { setDateStart('2020-01-01'); setDateEnd(today) }

  // In field mode, only show entries the employee has a timecard for
  const myProdIds = useMemo(() => {
    if (isAdmin || !activeEmployeeId) return null
    return new Set(
      data.timecards
        .filter((tc) => tc.employeeId === activeEmployeeId && tc.productionEntryId)
        .map((tc) => tc.productionEntryId as string),
    )
  }, [isAdmin, activeEmployeeId, data.timecards])

  // See ProductionTab's identical helper above.
  // Line items with no qaStatus at all (logged before the redline QA/QC
  // workflow existed, or via the plain Log Production/Log Crew Day flows)
  // are treated as implicitly "approved" — they were never submitted for
  // review, so there's nothing pending or rejected about them.
  const qaMatches = useCallback((status: string | undefined) => {
    if (qaFilter === 'all') return true
    return (status ?? 'approved') === qaFilter
  }, [qaFilter])

  const crewEntries = useMemo(() => {
    const list = data.production.filter((e) =>
      e.date >= dateStart &&
      e.date <= dateEnd &&
      (projectFilter === 'all' || e.projectId === projectFilter) &&
      (myProdIds === null || myProdIds.has(e.id)) &&
      (qaFilter === 'all' || (() => {
        const items = data.productionLineItems.filter((li) => li.productionEntryId === e.id)
        return items.length > 0 ? items.some((li) => qaMatches(li.qaStatus)) : qaMatches(undefined)
      })())
    )
    return [...list].sort((a, b) => b.date.localeCompare(a.date))
  }, [data.production, data.productionLineItems, dateStart, dateEnd, projectFilter, myProdIds, qaFilter, qaMatches])

  const crewTotalFootage = crewEntries.reduce((s, e) => s + e.footage, 0)
  const crewTotalHours = useMemo(() =>
    crewEntries.reduce((s, entry) => {
      const tc = data.timecards.filter((t) => t.productionEntryId === entry.id)
      return s + tc.reduce((ts, t) => ts + t.hours, 0)
    }, 0),
  [crewEntries, data.timecards])
  const crewTotalRevenue = useMemo(() => {
    const ids = new Set(crewEntries.map((e) => e.id))
    return data.pnl.filter((p) => p.productionEntryId && ids.has(p.productionEntryId)).reduce((s, p) => s + p.revenue, 0)
  }, [crewEntries, data.pnl])

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="w-48">
            <option value="all">All projects</option>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="w-40" />
          <span className="text-sm text-slate-500">to</span>
          <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="w-40" />
          <button onClick={jumpToThisWeek} className="text-sm font-medium text-brand-600 hover:text-brand-700">
            This week
          </button>
          <button onClick={showAllDates} className="text-sm font-medium text-slate-400 hover:text-slate-700">
            All time
          </button>
          {isAdmin && <QaStatusFilterSelect value={qaFilter} onChange={setQaFilter} className="w-56" />}
        </div>
        {isAdmin && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> Log crew day
          </Button>
        )}
      </div>

      <div className={`mb-4 grid gap-4 grid-cols-2 ${isAdmin ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        <StatCard label="Footage" value={`${number(crewTotalFootage)} ft`} hint="in selected range" />
        <StatCard label="Crew-hours" value={crewTotalHours.toFixed(1)} hint="in selected range" />
        <StatCard label="Entries" value={String(crewEntries.length)} hint="crew days logged" />
        {isAdmin && <StatCard label="Revenue" value={money(crewTotalRevenue)} hint="in selected range" />}
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div>
            <p className="text-sm font-semibold text-slate-800">{isAdmin ? 'Crew day log' : 'My production'}</p>
            <p className="text-xs text-slate-500">{crewEntries.length} {crewEntries.length === 1 ? 'entry' : 'entries'} in range</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Crew</th>
                <th className="px-4 py-3 text-right">Employees</th>
                <th className="px-4 py-3 text-right">Hours</th>
                <th className="px-4 py-3 text-right">Footage</th>
                {isAdmin && <th className="px-4 py-3 text-right">Revenue</th>}
                {isAdmin && <th className="px-4 py-3 text-right">$/Ft</th>}
                <th className="px-4 py-3">Notes</th>
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {crewEntries.map((entry, i) => {
                const project = data.projects.find((p) => p.id === entry.projectId)
                const crewLabel = crewOrSubName(data, entry.crewId, entry.subcontractorId)
                const foreman = data.employees.find((e) => e.isForeman && e.defaultCrewId === entry.crewId)
                const entryTimecards = data.timecards.filter((t) => t.productionEntryId === entry.id)
                const totalHours = entryTimecards.reduce((s, t) => s + t.hours, 0)
                const pnlEntry = data.pnl.find((p) => p.productionEntryId === entry.id)
                const entryItems = data.productionLineItems.filter((li) => li.productionEntryId === entry.id)
                const revenue = pnlEntry?.revenue ?? (entryItems.length > 0 ? entryItems.reduce((s, li) => s + li.extendedTotal, 0) : 0)
                const dollarPerFt = revenue > 0 && entry.footage > 0 ? revenue / entry.footage : 0
                const rowBg = i % 2 === 0 ? 'bg-transparent' : 'bg-slate-50/60'
                // One full row per rate-card line item — see ProductionTab's
                // identical pattern above for why (two unit codes on the same
                // entry can bill at two different rates, which one blended
                // row/revenue number would hide).
                const allLineRows = entryItems.length > 0
                  ? entryItems.map((li) => ({ key: li.id, unitCode: li.unitCode as string | null, quantity: li.quantity, revenue: li.extendedTotal, rate: li.rateSnapshot, qaStatus: li.qaStatus }))
                  : [{ key: entry.id, unitCode: null, quantity: entry.footage, revenue, rate: dollarPerFt, qaStatus: undefined }]
                const lineRows = qaFilter === 'all' ? allLineRows : allLineRows.filter((lr) => qaMatches(lr.qaStatus))
                const span = lineRows.length
                return lineRows.map((lr, j) => (
                  <tr key={lr.key} className={`${rowBg} hover:bg-slate-50`}>
                    {j === 0 && (
                      <>
                        <td rowSpan={span} className="whitespace-nowrap px-4 py-2.5 align-top text-slate-400">{formatDateShort(entry.date)}</td>
                        <td rowSpan={span} className="max-w-[140px] truncate px-4 py-2.5 align-top font-medium text-slate-800">{project?.name ?? '—'}</td>
                        <td rowSpan={span} className="px-4 py-2.5 align-top text-slate-400">
                          {crewLabel}
                          {foreman && <span className="ml-1.5 text-xs text-slate-500">· {foreman.name}</span>}
                        </td>
                        <td rowSpan={span} className="px-4 py-2.5 text-right align-top font-mono text-slate-400">{entryTimecards.length}</td>
                        <td rowSpan={span} className="px-4 py-2.5 text-right align-top font-mono text-slate-400">{totalHours.toFixed(1)}</td>
                      </>
                    )}
                    <td className="px-4 py-2.5 text-right">
                      <div className="font-mono font-semibold text-slate-800">{number(lr.quantity)}</div>
                      {lr.unitCode && <div className="mt-0.5 text-[10px] font-normal leading-tight text-slate-400">{lr.unitCode}</div>}
                      <div className="mt-1 flex justify-end"><QaStatusBadge status={lr.qaStatus ?? 'approved'} /></div>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-700">
                        {lr.revenue > 0 ? money(lr.revenue) : <span className="font-normal text-slate-600">—</span>}
                      </td>
                    )}
                    {isAdmin && (
                      <td className="px-4 py-2.5 text-right font-mono text-slate-400">
                        {lr.rate > 0 ? `$${lr.rate.toFixed(2)}` : <span className="text-slate-600">—</span>}
                      </td>
                    )}
                    {j === 0 && (
                      <>
                        <td rowSpan={span} className="max-w-[120px] truncate px-4 py-2.5 align-top text-xs text-slate-500">{entry.notes ?? ''}</td>
                        {isAdmin && (
                          <td rowSpan={span} className="px-4 py-2.5 align-top">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => setEditEntryId(entry.id)} className="rounded p-1 text-slate-600 hover:bg-brand-50 hover:text-brand-600" aria-label="Edit" title="Change project or crew">
                                <Pencil size={13} />
                              </button>
                              <button onClick={() => { if (confirm('Delete this crew day entry and all linked timecards?')) deleteCrewDayEntry(entry.id) }} className="rounded p-1 text-slate-600 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                ))
              })}
              {crewEntries.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 10 : 7} className="px-4 py-10 text-center text-slate-500">
                    {isAdmin ? 'No crew days logged yet. Use "Log crew day" to record a full crew\'s work.' : 'No production entries found for you yet.'}
                  </td>
                </tr>
              )}
            </tbody>
            {crewEntries.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-400">
                  <td colSpan={3} className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-400">—</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-700">{crewTotalHours.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-700">{number(crewTotalFootage)}</td>
                  {isAdmin && <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-700">{money(crewTotalRevenue)}</td>}
                  {isAdmin && (
                    <td className="px-4 py-2.5 text-right font-mono text-slate-400">
                      {crewTotalFootage > 0 ? `$${(crewTotalRevenue / crewTotalFootage).toFixed(2)}` : '—'}
                    </td>
                  )}
                  <td colSpan={isAdmin ? 2 : 1} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      <CrewDayModal open={open} onClose={() => setOpen(false)} />
      {editEntryId && <EditEntryModal entryId={editEntryId} onClose={() => setEditEntryId(null)} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// Page — Expenses live at /expenses in the sidebar
// ---------------------------------------------------------------------------

export function Production() {
  // Photos page "Open Production Record" arrives with a project+date to
  // pre-filter to (no per-entry deep link exists in this data model — see
  // photoLibrary.ts's doc comment — pre-filtering the log to the right
  // project/day is the honest, in-scope equivalent).
  const location = useLocation()
  const prefilter = (location.state as { prefilterProjectId?: string; prefilterDate?: string } | null) ?? null
  const initial = prefilter?.prefilterProjectId ? { projectId: prefilter.prefilterProjectId, date: prefilter.prefilterDate ?? localDateStr() } : undefined
  const [tab, setTab] = useState<'crew' | 'production'>(initial ? 'production' : 'crew')
  return (
    <div>
      <PageHeader
        title="Production Tracking"
        description="Log daily crew work and footage placed. Hours are pulled from the time clock automatically."
      />
      <div className="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {(['crew', 'production'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              tab === t ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            {t === 'crew' ? 'Crew Day Entry' : 'Rate Card Log'}
          </button>
        ))}
      </div>
      {tab === 'crew' ? <CrewDailyTab initial={initial} /> : <ProductionTab initial={initial} />}
    </div>
  )
}

