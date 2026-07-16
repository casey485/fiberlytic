import { useMemo, useState } from 'react'
import { Plus, HardHat, Trash2, Pencil } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select } from '../components/ui/Form'
import { moneyExact, number, crewStatusMeta, workTypeLabel } from '../lib/format'
import { PAY_TYPES, payLabel, payUnit } from '../lib/laborCost'
import { footageByCrew } from '../lib/analytics'
import { SubcontractorsList } from './Subcontractors'
import type { Crew, CrewStatus, PayType, WorkType } from '../types'

const WORK_TYPES: WorkType[]   = ['aerial', 'underground', 'directional_bore', 'splicing', 'mdu']
const CREW_STATUSES: CrewStatus[] = ['active', 'idle', 'off']

// ---------------------------------------------------------------------------
// Crew editor modal — name + foreman (from employees) + specialty + status
// ---------------------------------------------------------------------------

function CrewEditorModal({ open, crew, onClose }: { open: boolean; crew: Crew | null; onClose: () => void }) {
  const { data, addCrew, updateCrew } = useData()
  const { isAdmin } = useRole()
  const isEdit = !!crew

  const [form, setForm] = useState(() => initForm(crew))

  // Re-seed when the modal opens for a different crew
  const [seededFor, setSeededFor] = useState<string | null>(null)
  const key = crew?.id ?? 'new'
  if (open && seededFor !== key) { setForm(initForm(crew)); setSeededFor(key) }
  if (!open && seededFor !== null) setSeededFor(null)

  const set = <K extends keyof ReturnType<typeof initForm>>(k: K, v: ReturnType<typeof initForm>[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const activeEmployees = data.employees.filter((e) => e.active)
  // Prefer foremen for the dropdown, fall back to all active employees
  const foremanOptions = activeEmployees.filter((e) => e.isForeman).length > 0
    ? activeEmployees.filter((e) => e.isForeman)
    : activeEmployees

  const handleForemanChange = (empId: string) => {
    if (!empId) { set('foremanId', ''); set('foreman', ''); return }
    const emp = data.employees.find((e) => e.id === empId)
    if (emp) { set('foremanId', emp.id); set('foreman', emp.name) }
  }

  const submit = () => {
    if (!form.name.trim()) return
    const foremanEmp = data.employees.find((e) => e.id === form.foremanId)
    const payload = {
      name: form.name,
      foreman: foremanEmp?.name ?? form.foreman,
      foremanId: form.foremanId || undefined,
      specialty: form.specialty,
      status: form.status,
      payType: form.payType,
      payAmount: Number(form.payAmount),
      // Preserve existing members array — no longer managed here but kept so old data stays intact
      members: crew?.members ?? [],
    }
    if (isEdit && crew) updateCrew(crew.id, payload)
    else addCrew({ ...payload, currentProjectId: null })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit — ${crew?.name}` : 'Add crew'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>{isEdit ? 'Save changes' : 'Create crew'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Crew name">
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Echo Aerial"
              autoFocus
            />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Foreman" hint="Select the lead employee for this crew">
            <Select value={form.foremanId} onChange={(e) => handleForemanChange(e.target.value)}>
              <option value="">— Select foreman —</option>
              {foremanOptions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.isForeman ? '' : ` — ${e.role}`}
                </option>
              ))}
              {/* If current foreman isn't in the list (e.g. marked inactive), still show them */}
              {form.foremanId && !foremanOptions.find((e) => e.id === form.foremanId) && (() => {
                const emp = data.employees.find((e) => e.id === form.foremanId)
                return emp ? <option value={emp.id}>{emp.name} (inactive)</option> : null
              })()}
            </Select>
            {!form.foremanId && form.foreman && (
              <p className="mt-1 text-xs text-amber-600">
                Legacy foreman name: "{form.foreman}" — select from the dropdown to link to an employee record.
              </p>
            )}
          </Field>
        </div>

        <Field label="Specialty">
          <Select value={form.specialty} onChange={(e) => set('specialty', e.target.value as WorkType)}>
            {WORK_TYPES.map((w) => <option key={w} value={w}>{workTypeLabel[w]}</option>)}
          </Select>
        </Field>

        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value as CrewStatus)}>
            {CREW_STATUSES.map((s) => <option key={s} value={s}>{crewStatusMeta[s].label}</option>)}
          </Select>
        </Field>

        {isAdmin && (
          <>
            <Field label="Fallback pay type" hint="Used when employee rates aren't available">
              <Select value={form.payType} onChange={(e) => set('payType', e.target.value as PayType)}>
                {PAY_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </Field>
            <Field label={`Fallback pay amount (${payUnit(form.payType)})`}>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.payAmount}
                onChange={(e) => set('payAmount', e.target.value)}
              />
            </Field>
          </>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-xs text-brand-700">
        <strong>Crew roster is selected at production entry time</strong> — when logging a crew day, the foreman picks which employees were on site and the system pulls their hours from the time clock automatically.
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Crew list page
// ---------------------------------------------------------------------------

function CrewsList() {
  const { data, updateCrew, deleteCrew, updateEquipment } = useData()
  const { isAdmin } = useRole()
  const [editor, setEditor] = useState<{ open: boolean; crew: Crew | null }>({ open: false, crew: null })

  const productivity = useMemo(
    () => new Map(footageByCrew(data, 14).map((r) => [r.crew.id, r])),
    [data],
  )

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-400">Field teams identified by foreman — employees and hours are logged at production entry time.</p>
        <Button onClick={() => setEditor({ open: true, crew: null })}>
          <Plus size={16} /> Add crew
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.crews.map((crew) => {
          const prod    = productivity.get(crew.id)
          const project = data.projects.find((p) => p.id === crew.currentProjectId)
          const foreman = crew.foremanId ? data.employees.find((e) => e.id === crew.foremanId) : null

          return (
            <Card key={crew.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <HardHat size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">{crew.name}</h3>
                    <p className="text-xs text-slate-500">
                      Foreman: <span className="font-medium text-slate-700">
                        {(foreman?.name ?? crew.foreman) || 'Not assigned'}
                      </span>
                    </p>
                  </div>
                </div>
                <Badge tone={crewStatusMeta[crew.status].tone}>{crewStatusMeta[crew.status].label}</Badge>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Specialty</p>
                  <p className="font-medium text-slate-700">{workTypeLabel[crew.specialty]}</p>
                </div>
                {isAdmin && (
                  <div>
                    <p className="text-xs text-slate-400">Fallback pay</p>
                    <p className="font-medium text-slate-700">
                      {payLabel(crew.payType)} · {moneyExact(crew.payAmount)}{payUnit(crew.payType)}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-slate-400">Footage (14d)</p>
                  <p className="font-medium text-slate-700">{number(prod?.footage ?? 0)} ft</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Hours (14d)</p>
                  <p className="font-medium text-slate-700">{number(prod?.hours ?? 0)}</p>
                </div>
              </div>

              {/* Current assignment */}
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="mb-1 text-xs text-slate-400">Current project</p>
                <Select
                  value={crew.currentProjectId ?? ''}
                  onChange={(e) =>
                    updateCrew(crew.id, {
                      currentProjectId: e.target.value || null,
                      status: e.target.value ? 'active' : 'idle',
                    })
                  }
                >
                  <option value="">— Unassigned —</option>
                  {data.projects
                    .filter((p) => p.status === 'active' || p.id === crew.currentProjectId)
                    .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                {project && <p className="mt-1 text-xs text-slate-400">{project.location}</p>}
              </div>

              {/* Equipment — set once per crew, auto-included in all production cost calcs */}
              {(() => {
                const crewEquip = data.equipment.filter((eq) => eq.crewId === crew.id)
                const unassigned = data.equipment.filter((eq) => !eq.crewId || eq.crewId !== crew.id)
                return (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <p className="mb-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Equipment on this crew</p>
                    {crewEquip.length > 0 ? (
                      <ul className="mb-2 space-y-1">
                        {crewEquip.map((eq) => (
                          <li key={eq.id} className="flex items-center justify-between rounded-lg bg-purple-50 px-2.5 py-1.5 text-xs">
                            <span className="font-medium text-purple-800">{eq.name}
                              <span className="ml-1 font-normal text-purple-600">· {eq.category}</span>
                            </span>
                            <button
                              onClick={() => updateEquipment(eq.id, { crewId: undefined })}
                              className="ml-2 text-purple-600 hover:text-rose-500"
                              title="Remove from crew"
                            >
                              ✕
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mb-2 text-xs text-slate-400 italic">No equipment assigned yet.</p>
                    )}
                    {unassigned.length > 0 && (
                      <select
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 focus:border-brand-400 focus:outline-none"
                        value=""
                        onChange={(e) => { if (e.target.value) updateEquipment(e.target.value, { crewId: crew.id }) }}
                      >
                        <option value="">+ Assign equipment to this crew…</option>
                        {unassigned.map((eq) => (
                          <option key={eq.id} value={eq.id}>
                            {eq.name}{eq.crewId ? ` (move from ${data.crews.find(c=>c.id===eq.crewId)?.name??'other'})` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )
              })()}

              <div className="mt-3 flex justify-end gap-1">
                <Button variant="secondary" onClick={() => setEditor({ open: true, crew })}>
                  <Pencil size={14} /> Edit
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
    name:      crew?.name ?? '',
    foreman:   crew?.foreman ?? '',
    foremanId: crew?.foremanId ?? '',
    specialty: (crew?.specialty ?? 'aerial') as WorkType,
    status:    (crew?.status ?? 'idle') as CrewStatus,
    payType:   (crew?.payType ?? 'daily') as PayType,
    payAmount: String(crew?.payAmount ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Crews and Subcontractors are two separate entities, but "who did the work"
// is the same kind of question for both — some internal, some not — so they
// live under one nav tab. Each tab keeps its own existing list/editor
// self-contained; this just switches which one is visible.
// ---------------------------------------------------------------------------

type CrewTab = 'crews' | 'subcontractors'

export function CrewsAndSubcontractors() {
  const [tab, setTab] = useState<CrewTab>('crews')

  return (
    <div>
      <PageHeader title="Crews & Subcontractors" description="In-house crews and outside subcontractor companies — who performed the work." />

      <div className="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {(['crews', 'subcontractors'] as CrewTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              tab === t ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'crews' ? 'In-House Crews' : 'Subcontractors'}
          </button>
        ))}
      </div>

      {tab === 'crews' ? <CrewsList /> : <SubcontractorsList />}
    </div>
  )
}
