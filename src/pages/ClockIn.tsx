import { useState, useMemo } from 'react'
import {
  MapPin, LogIn, LogOut, Trash2, CheckCircle, AlertTriangle,
  Loader2, PenLine, ChevronDown, ChevronUp, Pencil,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Button, Field, Input, Select } from '../components/ui/Form'
import { Modal } from '../components/ui/Modal'
import { pointInPolygon } from '../lib/geofence'

type GpsState = 'idle' | 'checking' | 'inside' | 'outside' | 'error' | 'no-boundary'

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}
function elapsed(clockIn: string, clockOut?: string) {
  const ms = new Date(clockOut ?? new Date()).getTime() - new Date(clockIn).getTime()
  if (ms < 0) return '—'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${h}h ${m}m`
}
function hrsNum(clockIn: string, clockOut?: string) {
  if (!clockOut) return null
  return (new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 3_600_000
}

// ── Edit clock entry modal ──────────────────────────────────────────────────

function EditClockModal({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const { data, updateClockEntry } = useData()

  const [form, setForm] = useState(() => {
    const e = (data.clockEntries ?? []).find((x) => x.id === entryId)
    if (!e) return { employeeId: '', crewId: '', projectId: '', date: '', clockIn: '', clockOut: '' }
    return {
      employeeId: e.employeeId,
      crewId:     e.crewId ?? '',
      projectId:  e.projectId,
      date:       e.clockIn.slice(0, 10),
      clockIn:    e.clockIn.slice(11, 16),
      clockOut:   e.clockOut ? e.clockOut.slice(11, 16) : '',
    }
  })
  const [error, setError] = useState('')

  const entry = (data.clockEntries ?? []).find((x) => x.id === entryId)
  if (!entry) return null

  const set = (k: keyof typeof form, v: string) => { setForm((f) => ({ ...f, [k]: v })); setError('') }

  const save = () => {
    if (!form.employeeId) { setError('Select an employee.'); return }
    if (!form.projectId)  { setError('Select a project.'); return }
    if (!form.date)       { setError('Enter a date.'); return }
    if (!form.clockIn)    { setError('Enter a clock-in time.'); return }

    const clockInIso  = `${form.date}T${form.clockIn}:00`
    const clockOutIso = form.clockOut ? `${form.date}T${form.clockOut}:00` : undefined

    if (clockOutIso && clockOutIso <= clockInIso) { setError('Clock-out must be after clock-in.'); return }

    updateClockEntry(entryId, {
      employeeId: form.employeeId,
      crewId:     form.crewId || undefined,
      projectId:  form.projectId,
      clockIn:    clockInIso,
      clockOut:   clockOutIso,
    })
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit time entry"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save changes</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Employee">
          <Select value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)}>
            <option value="">— Select —</option>
            {data.employees.filter((e) => e.active).map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Crew">
          <Select value={form.crewId} onChange={(e) => set('crewId', e.target.value)}>
            <option value="">— None —</option>
            {data.crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Project">
          <Select value={form.projectId} onChange={(e) => set('projectId', e.target.value)}>
            <option value="">— Select —</option>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Clock-in">
            <Input type="time" value={form.clockIn} onChange={(e) => set('clockIn', e.target.value)} />
          </Field>
          <Field label="Clock-out">
            <Input type="time" value={form.clockOut} onChange={(e) => set('clockOut', e.target.value)} />
          </Field>
        </div>
        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>
        )}
      </div>
    </Modal>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────

export function ClockIn() {
  const { data, addClockIn, clockOut, deleteClockEntry } = useData()
  const { isAdmin, activeEmployeeId } = useRole()
  const today = new Date().toISOString().slice(0, 10)

  // In field mode, lock the employee to the active user
  const [employeeId, setEmployeeId] = useState(() => (!isAdmin && activeEmployeeId) ? activeEmployeeId : '')
  const [projectId,  setProjectId]  = useState('')
  const [gpsState,   setGpsState]   = useState<GpsState>('idle')
  const [gpsCoords,  setGpsCoords]  = useState<{ lat: number; lng: number } | null>(null)
  const [gpsError,   setGpsError]   = useState('')

  // Manual batch entry state
  const [manualOpen, setManualOpen]           = useState(false)
  const [manual, setManual]                   = useState({ crewId: '', projectId: '', date: today, clockIn: '07:00', clockOut: '16:00' })
  const [selectedEmpIds, setSelectedEmpIds]   = useState<Set<string>>(new Set())
  const [manualError, setManualError]         = useState('')

  // Edit modal state
  const [editEntryId, setEditEntryId] = useState<string | null>(null)

  // Weekly spreadsheet
  const [weekOffset, setWeekOffset] = useState(0)

  const weekDays = useMemo(() => {
    const now = new Date()
    const utcDay = now.getUTCDay()
    const mondayOffset = utcDay === 0 ? -6 : 1 - utcDay
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset + weekOffset * 7))
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base)
      d.setUTCDate(base.getUTCDate() + i)
      return d.toISOString().slice(0, 10)
    })
  }, [weekOffset])

  const weekSheet = useMemo(() => {
    const entries = data.clockEntries ?? []
    const activeEmps = data.employees.filter((e) => e.active)
    return activeEmps.map((emp) => {
      const dayHours = weekDays.map((dayStr) =>
        entries
          .filter((e) => e.employeeId === emp.id && e.clockIn.slice(0, 10) === dayStr && e.clockOut)
          .reduce((sum, e) => sum + (hrsNum(e.clockIn, e.clockOut) ?? 0), 0),
      )
      const total = dayHours.reduce((s, h) => s + h, 0)
      return { emp, dayHours, total }
    }).filter((row) => row.total > 0)
  }, [data.clockEntries, data.employees, weekDays])

  const setM = (k: keyof typeof manual, v: string) => {
    setManual((f) => ({ ...f, [k]: v }))
    setManualError('')
  }

  const handleCrewChange = (crewId: string) => {
    setManual((f) => ({ ...f, crewId }))
    setManualError('')
    if (crewId) {
      const crew = data.crews.find((c) => c.id === crewId)
      const memberIds = new Set([
        ...data.employees.filter((e) => e.active && e.defaultCrewId === crewId).map((e) => e.id),
        ...(crew?.members ?? []).filter((m) => m.employeeId).map((m) => m.employeeId!),
      ])
      const ids = data.employees.filter((e) => e.active && memberIds.has(e.id)).map((e) => e.id)
      setSelectedEmpIds(new Set(ids))
    } else {
      setSelectedEmpIds(new Set())
    }
  }

  const batchEmps = useMemo(() => {
    if (!manual.crewId) return data.employees.filter((e) => e.active)
    const crew = data.crews.find((c) => c.id === manual.crewId)
    const memberIds = new Set([
      ...data.employees.filter((e) => e.active && e.defaultCrewId === manual.crewId).map((e) => e.id),
      ...(crew?.members ?? []).filter((m) => m.employeeId).map((m) => m.employeeId!),
    ])
    const list = data.employees.filter((e) => e.active && memberIds.has(e.id))
    return list.length > 0 ? list : data.employees.filter((e) => e.active)
  }, [manual.crewId, data.employees, data.crews])

  const allSelected = batchEmps.length > 0 && batchEmps.every((e) => selectedEmpIds.has(e.id))
  const toggleAll   = () => setSelectedEmpIds(allSelected ? new Set() : new Set(batchEmps.map((e) => e.id)))
  const toggleEmp   = (id: string) => setSelectedEmpIds((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const employee   = data.employees.find((e) => e.id === employeeId)
  const activeEntry = data.clockEntries?.find(
    (e) => e.employeeId === employeeId && e.projectId === projectId && !e.clockOut,
  )

  const allEntries = [...(data.clockEntries ?? [])]
    .filter((e) => {
      if (!isAdmin && activeEmployeeId) return e.employeeId === activeEmployeeId
      return !employeeId || e.employeeId === employeeId
    })
    .sort((a, b) => b.clockIn.localeCompare(a.clockIn))
    .slice(0, 30)

  const manualEntries = useMemo(
    () => [...(data.clockEntries ?? [])]
      .filter((e) => {
        if (!e.manual) return false
        if (!isAdmin && activeEmployeeId) return e.employeeId === activeEmployeeId
        return true
      })
      .sort((a, b) => b.clockIn.localeCompare(a.clockIn)),
    [data.clockEntries, isAdmin, activeEmployeeId],
  )

  // GPS handlers
  const checkGps = () => {
    const project = data.projects.find((p) => p.id === projectId)
    if (!project) return
    if (!project.boundary || project.boundary.length < 3) { setGpsState('no-boundary'); return }
    setGpsState('checking')
    setGpsError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setGpsCoords(coords)
        setGpsState(pointInPolygon([coords.lng, coords.lat], project.boundary!) ? 'inside' : 'outside')
      },
      (err) => { setGpsState('error'); setGpsError(err.message) },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  const handleClockIn = () => {
    if (!employeeId || !projectId || !gpsCoords || gpsState !== 'inside') return
    const emp = data.employees.find((e) => e.id === employeeId)
    addClockIn({ employeeId, projectId, crewId: emp?.defaultCrewId ?? undefined, clockIn: new Date().toISOString(), lat: gpsCoords.lat, lng: gpsCoords.lng })
    setGpsState('idle')
    setGpsCoords(null)
  }

  const handleClockOut = () => {
    if (!activeEntry) return
    clockOut(activeEntry.id)
    setGpsState('idle')
    setGpsCoords(null)
  }

  const handleManualSave = () => {
    setManualError('')
    if (!manual.projectId)       { setManualError('Select a project.'); return }
    if (!manual.date)            { setManualError('Enter a date.'); return }
    if (!manual.clockIn)         { setManualError('Enter a clock-in time.'); return }
    if (selectedEmpIds.size === 0) { setManualError('Select at least one employee.'); return }

    const clockInIso  = `${manual.date}T${manual.clockIn}:00`
    const clockOutIso = manual.clockOut ? `${manual.date}T${manual.clockOut}:00` : undefined

    if (clockOutIso && clockOutIso <= clockInIso) { setManualError('Clock-out must be after clock-in.'); return }

    for (const empId of selectedEmpIds) {
      const emp = data.employees.find((e) => e.id === empId)
      addClockIn({
        crewId:     manual.crewId || emp?.defaultCrewId || undefined,
        employeeId: empId,
        projectId:  manual.projectId,
        clockIn:    clockInIso,
        clockOut:   clockOutIso,
        lat: 0, lng: 0,
        manual: true,
      })
    }
    setSelectedEmpIds(new Set())
  }

  const canCheckGps = !!employeeId && !!projectId && !activeEntry

  return (
    <div>
      <PageHeader title="Time Clock" description="Clock in / out by job site" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">

        {/* ── Left column: GPS + manual form ── */}
        <div className="space-y-4">

          {/* GPS clock-in */}
          <Card>
            <CardBody className="space-y-4">
              <Field label="Your name">
                {!isAdmin && activeEmployeeId ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">
                    {data.employees.find((e) => e.id === activeEmployeeId)?.name ?? '—'}
                  </div>
                ) : (
                  <Select value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setGpsState('idle'); setGpsCoords(null) }}>
                    <option value="">— Select employee —</option>
                    {data.employees.filter((e) => e.active).map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Project / job site">
                <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setGpsState('idle'); setGpsCoords(null) }}>
                  <option value="">— Select project —</option>
                  {data.projects.filter((p) => p.status === 'active' || p.status === 'planning').map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.client ? ` — ${p.client}` : ''}</option>
                  ))}
                </Select>
              </Field>

              {activeEntry && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2 font-medium text-emerald-700">
                    <CheckCircle size={18} /> Currently clocked in
                  </div>
                  <p className="mt-1 text-sm text-emerald-600">
                    Since {fmtTime(activeEntry.clockIn)} · {elapsed(activeEntry.clockIn)} elapsed
                    {activeEntry.crewId && (() => {
                      const crew = data.crews.find((c) => c.id === activeEntry.crewId)
                      return crew ? <span className="ml-2 text-emerald-500">· {crew.name}</span> : null
                    })()}
                  </p>
                  <Button className="mt-3 w-full" variant="danger" onClick={handleClockOut}>
                    <LogOut size={16} /> Clock Out
                  </Button>
                </div>
              )}

              {!activeEntry && (
                <div className="space-y-3">
                  {gpsState === 'idle' && (
                    <Button className="w-full" variant="secondary" onClick={checkGps} disabled={!canCheckGps}>
                      <MapPin size={16} /> Verify Location
                    </Button>
                  )}
                  {gpsState === 'checking' && (
                    <div className="flex items-center justify-center gap-2 rounded-xl bg-slate-50 py-4 text-sm text-slate-500">
                      <Loader2 size={18} className="animate-spin" /> Getting your GPS location…
                    </div>
                  )}
                  {gpsState === 'inside' && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        <CheckCircle size={16} /> You are inside the job site boundary
                      </div>
                      <Button className="w-full" onClick={handleClockIn}><LogIn size={16} /> Clock In</Button>
                    </div>
                  )}
                  {gpsState === 'outside' && (
                    <div className="space-y-2">
                      <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                        You are outside the job site boundary. You must be on-site to clock in.
                      </div>
                      <Button className="w-full" variant="secondary" onClick={checkGps}><MapPin size={16} /> Try Again</Button>
                    </div>
                  )}
                  {gpsState === 'no-boundary' && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                      <AlertTriangle size={16} className="mr-1.5 inline" />
                      No boundary set for this project. Contact your administrator.
                    </div>
                  )}
                  {gpsState === 'error' && (
                    <div className="space-y-2">
                      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        <AlertTriangle size={16} className="mr-1.5 inline" /> GPS error: {gpsError}
                      </div>
                      <Button className="w-full" variant="secondary" onClick={checkGps}><MapPin size={16} /> Retry</Button>
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Manual / batch entry — admin only */}
          {isAdmin && <Card>
            <button
              className="flex w-full items-center justify-between px-5 py-4 text-left"
              onClick={() => setManualOpen((o) => !o)}
            >
              <div className="flex items-center gap-2">
                <PenLine size={16} className="text-slate-500" />
                <span className="text-sm font-semibold text-slate-700">Manual / batch time entry</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">Admin</span>
              </div>
              {manualOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
            </button>

            {manualOpen && (
              <div className="space-y-4 border-t border-slate-100 px-5 pb-5 pt-4">
                <p className="text-xs text-slate-500">
                  Pick a crew to auto-select its members. Check everyone who worked the same shift, then save — one entry is created per person.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Crew">
                    <Select value={manual.crewId} onChange={(e) => handleCrewChange(e.target.value)}>
                      <option value="">— Any —</option>
                      {data.crews.map((c) => {
                        const foreman = data.employees.find((e) => e.isForeman && e.defaultCrewId === c.id)
                        return <option key={c.id} value={c.id}>{c.name}{foreman ? ` · ${foreman.name}` : ''}</option>
                      })}
                    </Select>
                  </Field>
                  <Field label="Project">
                    <Select value={manual.projectId} onChange={(e) => setM('projectId', e.target.value)}>
                      <option value="">— Select —</option>
                      {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </Field>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <Field label="Date">
                    <Input type="date" value={manual.date} onChange={(e) => setM('date', e.target.value)} />
                  </Field>
                  <Field label="Clock-in">
                    <Input type="time" value={manual.clockIn} onChange={(e) => setM('clockIn', e.target.value)} />
                  </Field>
                  <Field label="Clock-out">
                    <Input type="time" value={manual.clockOut} onChange={(e) => setM('clockOut', e.target.value)} />
                  </Field>
                </div>

                {/* Employee checklist */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Who worked this shift?</p>
                    <button type="button" onClick={toggleAll} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                      {allSelected ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                    {batchEmps.map((emp) => (
                      <label key={emp.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={selectedEmpIds.has(emp.id)}
                          onChange={() => toggleEmp(emp.id)}
                          className="rounded border-slate-300 text-brand-600"
                        />
                        <span className="text-sm text-slate-700">
                          {emp.name}
                          {emp.isForeman && (
                            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-600">Foreman</span>
                          )}
                        </span>
                      </label>
                    ))}
                    {batchEmps.length === 0 && (
                      <p className="px-3 py-3 text-xs text-slate-400">No active employees.</p>
                    )}
                  </div>
                  {selectedEmpIds.size > 0 && (
                    <p className="mt-1.5 text-xs text-slate-500">{selectedEmpIds.size} employee{selectedEmpIds.size !== 1 ? 's' : ''} selected</p>
                  )}
                </div>

                {manualError && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{manualError}</p>
                )}

                <Button className="w-full" onClick={handleManualSave} disabled={selectedEmpIds.size === 0}>
                  <PenLine size={15} />
                  {selectedEmpIds.size > 1 ? `Add ${selectedEmpIds.size} entries` : 'Add time entry'}
                </Button>
              </div>
            )}
          </Card>}
        </div>

        {/* ── Right column: spreadsheet tables ── */}
        <div className="space-y-4">

          {/* Weekly hours spreadsheet */}
          {isAdmin && (
            <Card>
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Weekly hours</p>
                  <p className="text-xs text-slate-400">
                    {new Date(weekDays[0] + 'T12:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    {' – '}
                    {new Date(weekDays[6] + 'T12:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setWeekOffset((o) => o - 1)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><ChevronLeft size={15} /></button>
                  {weekOffset !== 0 && (
                    <button onClick={() => setWeekOffset(0)} className="rounded px-2 py-1 text-[11px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600">Today</button>
                  )}
                  <button onClick={() => setWeekOffset((o) => o + 1)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><ChevronRight size={15} /></button>
                </div>
              </div>
              <CardBody className="p-0">
                {weekSheet.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-slate-400">No time entries this week.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          <th className="px-4 py-2.5 text-left">Employee</th>
                          {weekDays.map((dayStr, i) => (
                            <th key={dayStr} className={`px-2 py-2 text-center ${dayStr === today ? 'text-brand-600' : ''}`}>
                              <div>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}</div>
                              <div className="font-normal normal-case tracking-normal text-[10px] opacity-70">
                                {new Date(dayStr + 'T12:00:00Z').toLocaleDateString([], { month: 'numeric', day: 'numeric' })}
                              </div>
                            </th>
                          ))}
                          <th className="px-3 py-2.5 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {weekSheet.map(({ emp, dayHours, total }, i) => (
                          <tr key={emp.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                            <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">{emp.name}</td>
                            {dayHours.map((hrs, di) => (
                              <td key={di} className={`px-2 py-2.5 text-center font-mono text-xs ${weekDays[di] === today ? 'bg-brand-50/40' : ''}`}>
                                {hrs > 0
                                  ? <span className="font-semibold text-slate-700">{hrs.toFixed(1)}</span>
                                  : <span className="text-slate-200">—</span>}
                              </td>
                            ))}
                            <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-slate-800">{total.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                          <td className="px-4 py-2">Total</td>
                          {weekDays.map((_, di) => (
                            <td key={di} className={`px-2 py-2 text-center font-mono ${weekDays[di] === today ? 'bg-brand-50/40' : ''}`}>
                              {weekSheet.reduce((s, r) => s + r.dayHours[di], 0).toFixed(1)}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right font-mono">
                            {weekSheet.reduce((s, r) => s + r.total, 0).toFixed(1)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {/* Manual entries spreadsheet */}
          <Card>
            <CardHeader
              title={isAdmin ? `Manual entries · ${manualEntries.length}` : `My time entries · ${manualEntries.length}`}
              subtitle={isAdmin ? 'Pencil to edit · trash to delete' : 'Your manually entered clock times'}
            />
            <CardBody className="p-0">
              {manualEntries.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-slate-400">No manual entries yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2.5">Date</th>
                        {isAdmin && <th className="px-3 py-2.5">Employee</th>}
                        <th className="px-3 py-2.5">Crew</th>
                        <th className="px-3 py-2.5">Project</th>
                        <th className="px-3 py-2.5">In</th>
                        <th className="px-3 py-2.5">Out</th>
                        <th className="px-3 py-2.5 text-right">Hrs</th>
                        {isAdmin && <th className="px-3 py-2.5" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {manualEntries.map((e, i) => {
                        const emp  = data.employees.find((em) => em.id === e.employeeId)
                        const crew = data.crews.find((c)  => c.id  === e.crewId)
                        const proj = data.projects.find((p)  => p.id  === e.projectId)
                        const hrs  = hrsNum(e.clockIn, e.clockOut)
                        return (
                          <tr key={e.id} className={`${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-brand-50/30`}>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-500">{fmtDate(e.clockIn)}</td>
                            {isAdmin && <td className="px-3 py-2 font-medium text-slate-800">{emp?.name ?? '—'}</td>}
                            <td className="px-3 py-2 text-slate-500">{crew?.name ?? <span className="text-slate-300">—</span>}</td>
                            <td className="max-w-[140px] truncate px-3 py-2 text-slate-600">{proj?.name ?? '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-700">{fmtTime(e.clockIn)}</td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-700">
                              {e.clockOut ? fmtTime(e.clockOut) : <span className="text-emerald-600 font-medium">Active</span>}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-slate-700">
                              {hrs !== null ? hrs.toFixed(1) : '—'}
                            </td>
                            {isAdmin && (
                              <td className="px-3 py-2">
                                <div className="flex items-center justify-end gap-0.5">
                                  <button
                                    onClick={() => setEditEntryId(e.id)}
                                    className="rounded p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                                    title="Edit entry"
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (confirm(`Delete entry for ${emp?.name ?? 'employee'} on ${fmtDate(e.clockIn)}?`))
                                        deleteClockEntry(e.id)
                                    }}
                                    className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                    title="Delete entry"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
                        <td colSpan={isAdmin ? 6 : 5} className="px-3 py-2">Total</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-700">
                          {manualEntries.reduce((s, e) => s + (hrsNum(e.clockIn, e.clockOut) ?? 0), 0).toFixed(1)}
                        </td>
                        {isAdmin && <td />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          {/* All entries (GPS + manual) */}
          {allEntries.length > 0 && (
            <Card>
              <CardHeader
                title="All clock entries"
                subtitle={employeeId ? employee?.name : 'GPS + manual · last 30'}
              />
              <CardBody className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        <th className="px-4 py-2.5">Employee</th>
                        <th className="px-4 py-2.5">Crew</th>
                        <th className="px-4 py-2.5">Project</th>
                        <th className="px-4 py-2.5">Date</th>
                        <th className="px-4 py-2.5">In</th>
                        <th className="px-4 py-2.5">Out</th>
                        <th className="px-4 py-2.5 text-right">Hrs</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {allEntries.map((e) => {
                        const emp  = data.employees.find((em) => em.id === e.employeeId)
                        const crew = data.crews.find((c)  => c.id  === e.crewId)
                        const proj = data.projects.find((p)  => p.id  === e.projectId)
                        const hrs  = hrsNum(e.clockIn, e.clockOut)
                        return (
                          <tr key={e.id} className="border-b border-[#1e1e1e] hover:bg-white/5">
                            <td className="px-4 py-2.5">
                              <span className="font-medium text-slate-700">{emp?.name ?? '—'}</span>
                              {e.manual && (
                                <span className="ml-1.5 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Manual</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600">{crew?.name ?? <span className="text-slate-300">—</span>}</td>
                            <td className="max-w-[100px] truncate px-4 py-2.5 text-slate-600">{proj?.name ?? '—'}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{fmtDate(e.clockIn)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{fmtTime(e.clockIn)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                              {e.clockOut ? fmtTime(e.clockOut) : <span className="font-medium text-emerald-600">Active</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-slate-600">
                              {hrs !== null ? hrs.toFixed(1) : '—'}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-end gap-0.5">
                                {e.manual && (
                                  <button
                                    onClick={() => setEditEntryId(e.id)}
                                    className="rounded p-1.5 text-slate-300 hover:bg-brand-50 hover:text-brand-600"
                                    title="Edit"
                                  >
                                    <Pencil size={13} />
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    if (confirm(`Delete ${e.manual ? 'manual' : 'GPS'} entry for ${emp?.name ?? 'employee'}?`))
                                      deleteClockEntry(e.id)
                                  }}
                                  className="rounded p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                                  title="Delete"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {editEntryId && <EditClockModal entryId={editEntryId} onClose={() => setEditEntryId(null)} />}
    </div>
  )
}
