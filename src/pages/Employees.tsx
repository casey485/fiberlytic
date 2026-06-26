import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select } from '../components/ui/Form'
import { moneyExact } from '../lib/format'
import { weekStart, weekEnd } from '../lib/analytics'
import type { Employee } from '../types'

const OT_THRESHOLD = 40

type EmpForm = {
  name: string
  role: string
  hourlyRate: string
  defaultCrewId: string
  active: boolean
  isForeman: boolean
}

function EmployeeModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: Employee
  onSave: (f: EmpForm) => void
  onClose: () => void
}) {
  const { data } = useData()
  const { isAdmin } = useRole()
  const [form, setForm] = useState<EmpForm>({
    name: initial?.name ?? '',
    role: initial?.role ?? '',
    hourlyRate: initial ? String(initial.hourlyRate) : '',
    defaultCrewId: initial?.defaultCrewId ?? '',
    active: initial?.active ?? true,
    isForeman: initial?.isForeman ?? false,
  })
  const set = <K extends keyof EmpForm>(k: K, v: EmpForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const valid = form.name.trim() && form.role.trim() && (!isAdmin || parseFloat(form.hourlyRate) >= 0)

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Edit employee' : 'Add employee'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={() => { if (valid) { onSave(form); onClose() } }}>Save</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="First Last" autoFocus />
        </Field>
        <Field label="Role / title">
          <Input value={form.role} onChange={(e) => set('role', e.target.value)} placeholder="e.g. Driller, Locator, Labor" />
        </Field>
        {isAdmin && (
          <Field label="Hourly rate ($/hr)" hint="Admin only — not shown to field users.">
            <Input type="number" step="0.01" min="0" value={form.hourlyRate} onChange={(e) => set('hourlyRate', e.target.value)} placeholder="0.00" />
          </Field>
        )}
        <Field label="Default crew (optional)">
          <Select value={form.defaultCrewId} onChange={(e) => set('defaultCrewId', e.target.value)}>
            <option value="">— None —</option>
            {data.crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isForeman}
            onChange={(e) => set('isForeman', e.target.checked)}
            className="rounded border-slate-300"
          />
          Foreman
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => set('active', e.target.checked)}
            className="rounded border-slate-300"
          />
          Active
        </label>
      </div>
    </Modal>
  )
}

export function Employees() {
  const { data, addEmployee, updateEmployee, deleteEmployee } = useData()
  const { isAdmin } = useRole()
  const [dialog, setDialog] = useState<{ open: boolean; emp: Employee | null }>({ open: false, emp: null })
  const today = new Date().toISOString().slice(0, 10)

  // Build weekly hours from clock entries (actual time worked) so hours show
  // even when production hasn't been logged yet for the week.
  const weekHours = useMemo(() => {
    const wStart = weekStart(today)
    const wEnd   = weekEnd(today)
    const map = new Map<string, number>()
    for (const ce of data.clockEntries ?? []) {
      const d = ce.clockIn.slice(0, 10)
      if (d < wStart || d > wEnd || !ce.clockOut) continue
      const hrs = (new Date(ce.clockOut).getTime() - new Date(ce.clockIn).getTime()) / 3_600_000
      map.set(ce.employeeId, (map.get(ce.employeeId) ?? 0) + hrs)
    }
    return map
  }, [data.clockEntries, today])

  const save = (form: EmpForm) => {
    const payload = {
      name: form.name.trim(),
      role: form.role.trim(),
      hourlyRate: isAdmin ? parseFloat(form.hourlyRate) || 0 : (dialog.emp?.hourlyRate ?? 0),
      defaultCrewId: form.defaultCrewId || null,
      active: form.active,
      isForeman: form.isForeman,
    }
    if (dialog.emp) {
      updateEmployee(dialog.emp.id, payload)
    } else {
      addEmployee(payload)
    }
  }

  const activeEmps = data.employees.filter((e) => e.active)
  const inactiveEmps = data.employees.filter((e) => !e.active)

  return (
    <div>
      <PageHeader
        title="Employees"
        description="Named workers with hourly rates. Rates are admin-visible only."
        action={
          <Button onClick={() => setDialog({ open: true, emp: null })}>
            <Plus size={16} /> Add employee
          </Button>
        }
      />

      {!isAdmin && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertTriangle size={15} />
          You are in field view. Hourly rates are hidden. Switch to Admin to manage rates.
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Role</th>
                {isAdmin && <th className="px-5 py-3 text-right font-medium">Hourly Rate</th>}
                <th className="px-5 py-3 font-medium">Default Crew</th>
                <th className="px-5 py-3 text-right font-medium">Hrs This Week</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {activeEmps.map((emp) => {
                const hrs = weekHours.get(emp.id) ?? 0
                const isOT = hrs > OT_THRESHOLD
                const crew = data.crews.find((c) => c.id === emp.defaultCrewId)
                return (
                  <tr key={emp.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-medium text-slate-800">
                      {emp.name}
                      {emp.isForeman && (
                        <span className="ml-2 inline-flex items-center rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">Foreman</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{emp.role}</td>
                    {isAdmin && (
                      <td className="px-5 py-3 text-right font-medium text-slate-800">{moneyExact(emp.hourlyRate)}/hr</td>
                    )}
                    <td className="px-5 py-3 text-slate-500">{crew?.name ?? '—'}</td>
                    <td className="px-5 py-3 text-right">
                      <span className={`font-medium ${isOT ? 'text-amber-600' : 'text-slate-700'}`}>
                        {hrs.toFixed(2)}
                      </span>
                      {isOT && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                          <AlertTriangle size={9} /> OT
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone="green">Active</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setDialog({ open: true, emp })} className="p-1.5 text-slate-300 hover:text-brand-600" aria-label="Edit">
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => { if (confirm(`Remove ${emp.name}?`)) deleteEmployee(emp.id) }}
                          className="p-1.5 text-slate-300 hover:text-rose-600"
                          aria-label="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {inactiveEmps.map((emp) => (
                <tr key={emp.id} className="border-b border-slate-50 opacity-50 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-500">{emp.name}</td>
                  <td className="px-5 py-3 text-slate-400">{emp.role}</td>
                  {isAdmin && <td className="px-5 py-3 text-right text-slate-400">{moneyExact(emp.hourlyRate)}/hr</td>}
                  <td className="px-5 py-3 text-slate-400">—</td>
                  <td className="px-5 py-3 text-right text-slate-400">—</td>
                  <td className="px-5 py-3"><Badge tone="slate">Inactive</Badge></td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setDialog({ open: true, emp })} className="p-1.5 text-slate-300 hover:text-brand-600" aria-label="Edit">
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              ))}

              {data.employees.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="px-5 py-10 text-center text-slate-400">
                    No employees yet. Add employees to enable timecard entry with rate-based labor costs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {dialog.open && (
        <EmployeeModal
          initial={dialog.emp ?? undefined}
          onSave={save}
          onClose={() => setDialog({ open: false, emp: null })}
        />
      )}
    </div>
  )
}
