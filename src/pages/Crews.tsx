import { useMemo, useState } from 'react'
import { Plus, HardHat, Trash2, Pencil, UserPlus, Users, Link, Unlink } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select } from '../components/ui/Form'
import { moneyExact, number, crewStatusMeta, workTypeLabel } from '../lib/format'
import { PAY_TYPES, payLabel, payUnit, crewHeadcount } from '../lib/laborCost'
import { footageByCrew } from '../lib/analytics'
import type { Crew, CrewMember, CrewStatus, Employee, PayType, WorkType } from '../types'

const WORK_TYPES: WorkType[] = ['aerial', 'underground', 'directional_bore', 'splicing', 'mdu']
const CREW_STATUSES: CrewStatus[] = ['active', 'idle', 'off']

const payDisplay = (payType: PayType, amount: number) => `${payLabel(payType)} · ${moneyExact(amount)}${payUnit(payType)}`

let memSeq = 0
const newMemberId = () => `mem-${Date.now().toString(36)}-${(memSeq++).toString(36)}`

function blankMember(): CrewMember {
  return { id: newMemberId(), name: '', role: '', payType: 'hourly', payAmount: 0, active: true }
}

// ---------------------------------------------------------------------------
// Member row — linked to Employee record or manual
// ---------------------------------------------------------------------------

function MemberRow({
  member,
  employees,
  usedEmployeeIds,
  isAdmin,
  onChange,
  onRemove,
}: {
  member: CrewMember
  employees: Employee[]
  usedEmployeeIds: Set<string>
  isAdmin: boolean
  onChange: (patch: Partial<CrewMember>) => void
  onRemove: () => void
}) {
  const isLinked = !!member.employeeId
  const linkedEmp = employees.find((e) => e.id === member.employeeId)

  // Available employee options for this row: not already used on another row (except this one)
  const available = employees.filter(
    (e) => e.active && (!usedEmployeeIds.has(e.id) || e.id === member.employeeId),
  )

  const handleEmployeeChange = (empId: string) => {
    if (!empId) {
      // Unlink — keep current name/role as manual values
      onChange({ employeeId: undefined })
      return
    }
    const emp = employees.find((e) => e.id === empId)
    if (!emp) return
    onChange({
      employeeId: emp.id,
      name: emp.name,
      role: emp.role,
      payType: 'hourly',
      payAmount: emp.hourlyRate,
    })
  }

  return (
    <div className={`rounded-lg border p-3 ${isLinked ? 'border-brand-100 bg-brand-50/30' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start gap-3">
        {/* Employee selector */}
        <div className="flex-1 min-w-0">
          <div className="mb-1 flex items-center gap-1.5">
            {isLinked
              ? <Link size={11} className="text-brand-500 shrink-0" />
              : <Unlink size={11} className="text-slate-400 shrink-0" />}
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {isLinked ? 'Linked employee' : 'Manual entry'}
            </span>
          </div>
          <Select
            value={member.employeeId ?? ''}
            onChange={(e) => handleEmployeeChange(e.target.value)}
          >
            <option value="">— Manual (no link) —</option>
            {available.map((e) => (
              <option key={e.id} value={e.id}>{e.name} — {e.role}</option>
            ))}
            {/* Show the currently linked employee even if "unavailable" (shouldn't happen, but safety) */}
            {isLinked && linkedEmp && !available.find((e) => e.id === linkedEmp.id) && (
              <option value={linkedEmp.id}>{linkedEmp.name} — {linkedEmp.role}</option>
            )}
          </Select>
        </div>

        {/* Active toggle + Remove */}
        <div className="flex items-center gap-2 pt-6 shrink-0">
          <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer" title="Active">
            <input
              type="checkbox"
              checked={member.active}
              onChange={(e) => onChange({ active: e.target.checked })}
              className="rounded border-slate-300"
            />
            <span className="hidden sm:inline">Active</span>
          </label>
          <button onClick={onRemove} className="text-slate-300 hover:text-rose-600" aria-label="Remove member">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Fields below the selector */}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* Name */}
        <div>
          <p className="mb-1 text-[10px] font-medium text-slate-500">Name</p>
          {isLinked ? (
            <p className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700">
              {member.name || '—'}
            </p>
          ) : (
            <Input
              value={member.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Full name"
            />
          )}
        </div>

        {/* Role */}
        <div>
          <p className="mb-1 text-[10px] font-medium text-slate-500">Role</p>
          {isLinked ? (
            <p className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700">
              {member.role || '—'}
            </p>
          ) : (
            <Input
              value={member.role}
              onChange={(e) => onChange({ role: e.target.value })}
              placeholder="e.g. Foreman"
            />
          )}
        </div>

        {/* Pay type — manual only */}
        {!isLinked && (
          <div>
            <p className="mb-1 text-[10px] font-medium text-slate-500">Pay type</p>
            <Select value={member.payType} onChange={(e) => onChange({ payType: e.target.value as PayType })}>
              {PAY_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </div>
        )}

        {/* Rate / Amount */}
        <div>
          <p className="mb-1 text-[10px] font-medium text-slate-500">
            {isLinked ? 'Hourly rate' : `Rate${payUnit(member.payType)}`}
          </p>
          {isLinked ? (
            isAdmin ? (
              <p className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
                {moneyExact(member.payAmount)}/hr
              </p>
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-400 italic">
                Hidden
              </p>
            )
          ) : (
            <Input
              type="number"
              step="0.01"
              min="0"
              value={member.payAmount}
              onChange={(e) => onChange({ payAmount: Number(e.target.value) })}
            />
          )}
        </div>
      </div>

      {isLinked && (
        <p className="mt-1.5 text-[10px] text-brand-600">
          Linked to Employees record — name, role, and rate are read-only. {!isAdmin && 'Rate hidden in field view.'}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Crew editor modal
// ---------------------------------------------------------------------------

function CrewEditorModal({ open, crew, onClose }: { open: boolean; crew: Crew | null; onClose: () => void }) {
  const { data, addCrew, updateCrew } = useData()
  const { isAdmin } = useRole()
  const isEdit = !!crew

  const [form, setForm] = useState(() => initForm(crew))
  const [members, setMembers] = useState<CrewMember[]>(() => crew?.members ?? [])

  // Re-seed local state whenever the modal opens for a different crew.
  const [seededFor, setSeededFor] = useState<string | null>(null)
  const key = crew?.id ?? 'new'
  if (open && seededFor !== key) {
    setForm(initForm(crew))
    setMembers(crew?.members ? crew.members.map((m) => ({ ...m })) : [])
    setSeededFor(key)
  }
  if (!open && seededFor !== null) setSeededFor(null)

  const set = (k: keyof ReturnType<typeof initForm>, v: string | number) => setForm((f) => ({ ...f, [k]: v }))
  const setMember = (id: string, patch: Partial<CrewMember>) =>
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)))

  // Employee ids already used in this crew (for dedup filtering)
  const usedEmployeeIds = useMemo(
    () => new Set(members.map((m) => m.employeeId).filter(Boolean) as string[]),
    [members],
  )

  const submit = () => {
    if (!form.name.trim()) return
    const payload = {
      name: form.name,
      foreman: form.foreman,
      specialty: form.specialty,
      status: form.status,
      payType: form.payType,
      payAmount: Number(form.payAmount),
      // Keep members that have at least a name, or are linked to an employee
      members: members.filter((m) => m.employeeId || m.name.trim() || m.role.trim()),
    }
    if (isEdit && crew) updateCrew(crew.id, payload)
    else addCrew({ ...payload, currentProjectId: null })
    onClose()
  }

  const activeEmployees = data.employees.filter((e) => e.active)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Manage ${crew?.name}` : 'Add crew'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>{isEdit ? 'Save changes' : 'Create crew'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Crew name">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Echo Aerial" />
        </Field>
        <Field label="Foreman">
          <Input value={form.foreman} onChange={(e) => set('foreman', e.target.value)} />
        </Field>
        <Field label="Specialty">
          <Select value={form.specialty} onChange={(e) => set('specialty', e.target.value)}>
            {WORK_TYPES.map((w) => <option key={w} value={w}>{workTypeLabel[w]}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
            {CREW_STATUSES.map((s) => <option key={s} value={s}>{crewStatusMeta[s].label}</option>)}
          </Select>
        </Field>
        <Field label="Fallback pay type" hint="Used only when no crew members are defined">
          <Select value={form.payType} onChange={(e) => set('payType', e.target.value)}>
            {PAY_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </Field>
        <Field label={`Fallback pay amount (${payUnit(form.payType)})`}>
          <Input type="number" step="0.01" value={form.payAmount} onChange={(e) => set('payAmount', Number(e.target.value))} />
        </Field>
      </div>

      {/* Crew members */}
      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Users size={13} /> Crew members ({members.length})
          </span>
          <button
            onClick={() => setMembers((ms) => [...ms, blankMember()])}
            className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            <UserPlus size={13} /> Add row
          </button>
        </div>

        {activeEmployees.length > 0 && members.length === 0 && (
          <p className="mb-3 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-700">
            Tip: add a row and select an employee from the dropdown to auto-fill name, role, and rate.
          </p>
        )}

        {members.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-400">
            No members — crew will bill at the fallback pay above.
          </p>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                employees={data.employees}
                usedEmployeeIds={usedEmployeeIds}
                isAdmin={isAdmin}
                onChange={(patch) => setMember(m.id, patch)}
                onRemove={() => setMembers((ms) => ms.filter((x) => x.id !== m.id))}
              />
            ))}
            <p className="px-1 pt-1 text-xs text-slate-400">
              Linked rows pull name, role, and rate from the Employees page. Manual rows accept free-text.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Crew card
// ---------------------------------------------------------------------------

export function Crews() {
  const { data, updateCrew, deleteCrew } = useData()
  const { isAdmin } = useRole()
  const [editor, setEditor] = useState<{ open: boolean; crew: Crew | null }>({ open: false, crew: null })

  const productivity = useMemo(() => new Map(footageByCrew(data, 14).map((r) => [r.crew.id, r])), [data])

  return (
    <div>
      <PageHeader
        title="Crews"
        description="Field teams, their employees, pay, and 14-day productivity."
        action={
          <Button onClick={() => setEditor({ open: true, crew: null })}>
            <Plus size={16} /> Add crew
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.crews.map((crew) => {
          const prod = productivity.get(crew.id)
          const project = data.projects.find((p) => p.id === crew.currentProjectId)
          const activeMembers = (crew.members ?? []).filter((m) => m.active)
          return (
            <Card key={crew.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <HardHat size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">{crew.name}</h3>
                    <p className="text-xs text-slate-500">{crew.foreman} · {crewHeadcount(crew)} crew</p>
                  </div>
                </div>
                <Badge tone={crewStatusMeta[crew.status].tone}>{crewStatusMeta[crew.status].label}</Badge>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Specialty</p>
                  <p className="font-medium text-slate-700">{workTypeLabel[crew.specialty]}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Fallback pay</p>
                  <p className="font-medium text-slate-700">{payDisplay(crew.payType, crew.payAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Footage (14d)</p>
                  <p className="font-medium text-slate-700">{number(prod?.footage ?? 0)} ft</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Hours (14d)</p>
                  <p className="font-medium text-slate-700">{number(prod?.hours ?? 0)}</p>
                </div>
              </div>

              {/* Crew members */}
              <div className="mt-4 border-t border-slate-100 pt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <Users size={13} /> Crew members ({activeMembers.length})
                  </p>
                </div>
                {(crew.members ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">No members — uses fallback pay.</p>
                ) : (
                  <ul className="space-y-1">
                    {(crew.members ?? []).slice(0, 5).map((m) => {
                      const emp = m.employeeId ? data.employees.find((e) => e.id === m.employeeId) : null
                      return (
                        <li key={m.id} className="flex items-center justify-between text-sm">
                          <span className={`flex items-center gap-1 truncate ${m.active ? 'text-slate-700' : 'text-slate-400 line-through'}`}>
                            {emp && <Link size={10} className="shrink-0 text-brand-400" />}
                            {m.name || 'Unnamed'} <span className="text-xs text-slate-400">· {m.role || '—'}</span>
                          </span>
                          {isAdmin && (
                            <span className="shrink-0 text-xs text-slate-500">
                              {payLabel(m.payType)} {moneyExact(m.payAmount)}{payUnit(m.payType)}
                            </span>
                          )}
                        </li>
                      )
                    })}
                    {(crew.members ?? []).length > 5 && (
                      <li className="text-xs text-slate-400">+ {(crew.members ?? []).length - 5} more</li>
                    )}
                  </ul>
                )}
              </div>

              {/* Assignment */}
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-400">Current assignment</p>
                <Select
                  value={crew.currentProjectId ?? ''}
                  onChange={(e) => updateCrew(crew.id, { currentProjectId: e.target.value || null, status: e.target.value ? 'active' : 'idle' })}
                  className="mt-1"
                >
                  <option value="">— Unassigned —</option>
                  {data.projects
                    .filter((p) => p.status === 'active' || p.id === crew.currentProjectId)
                    .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                {project && <p className="mt-1 text-xs text-slate-400">{project.location}</p>}
              </div>

              <div className="mt-3 flex justify-end gap-1">
                <Button variant="secondary" onClick={() => setEditor({ open: true, crew })}>
                  <Pencil size={14} /> Manage
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => confirm(`Remove crew "${crew.name}"?`) && deleteCrew(crew.id)}
                  className="text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </Card>
          )
        })}
      </div>

      <CrewEditorModal
        open={editor.open}
        crew={editor.crew}
        onClose={() => setEditor({ open: false, crew: null })}
      />
    </div>
  )
}

function initForm(crew: Crew | null) {
  return {
    name: crew?.name ?? '',
    foreman: crew?.foreman ?? '',
    specialty: (crew?.specialty ?? 'aerial') as WorkType,
    status: (crew?.status ?? 'idle') as CrewStatus,
    payType: (crew?.payType ?? 'daily') as PayType,
    payAmount: crew?.payAmount ?? 0,
  }
}
