import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, MapPin, Pencil } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select, Textarea } from '../components/ui/Form'
import { money, number, percent, formatDate, projectStatusMeta, workTypeLabel } from '../lib/format'
import { projectProgress, summarizePnl } from '../lib/analytics'
import type { Project, ProjectStatus, WorkType } from '../types'

const STATUSES: ProjectStatus[] = ['planning', 'active', 'on_hold', 'complete']
const WORK_TYPES: WorkType[] = ['aerial', 'underground', 'directional_bore', 'splicing', 'mdu', 'cable_plow']

const WORK_TYPE_PILL: Record<WorkType, string> = {
  aerial:           'border-cyan-500 bg-cyan-500 text-white',
  underground:      'border-blue-600 bg-blue-600 text-white',
  directional_bore: 'border-violet-600 bg-violet-600 text-white',
  splicing:         'border-amber-500 bg-amber-500 text-white',
  mdu:              'border-emerald-600 bg-emerald-600 text-white',
  cable_plow:       'border-slate-600 bg-slate-600 text-white',
}
const WORK_TYPE_DOT: Record<WorkType, string> = {
  aerial:           'bg-cyan-400',
  underground:      'bg-blue-400',
  directional_bore: 'bg-violet-400',
  splicing:         'bg-amber-400',
  mdu:              'bg-emerald-400',
  cable_plow:       'bg-slate-400',
}

export function Projects() {
  const { data, addProject } = useData()
  const { isAdmin, activeEmployeeId } = useRole()
  const [filter, setFilter] = useState<ProjectStatus | 'all'>('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)

  // For field users: collect project IDs the employee's crews are assigned to
  const myProjectIds = useMemo(() => {
    if (isAdmin || !activeEmployeeId) return null
    const emp = data.employees.find((e) => e.id === activeEmployeeId)
    const myCrewIds = new Set<string>()
    for (const crew of data.crews) {
      if (emp?.defaultCrewId === crew.id) myCrewIds.add(crew.id)
      if (crew.foremanId === activeEmployeeId) myCrewIds.add(crew.id)
      if (crew.members.some((m) => m.employeeId === activeEmployeeId && m.active)) myCrewIds.add(crew.id)
    }
    const fromCurrentProject = data.crews
      .filter((c) => myCrewIds.has(c.id) && c.currentProjectId)
      .map((c) => c.currentProjectId as string)
    const fromCrewIds = data.projects
      .filter((p) => [...myCrewIds].some((cid) => p.crewIds.includes(cid)))
      .map((p) => p.id)
    return new Set([...fromCurrentProject, ...fromCrewIds])
  }, [isAdmin, activeEmployeeId, data.employees, data.crews, data.projects])

  const filtered = useMemo(() => {
    let list = filter === 'all' ? data.projects : data.projects.filter((p) => p.status === filter)
    if (myProjectIds) list = list.filter((p) => myProjectIds.has(p.id))
    return list
  }, [data.projects, filter, myProjectIds])

  const profitByProject = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of data.projects) {
      map.set(p.id, summarizePnl(data.pnl.filter((e) => e.projectId === p.id)).profit)
    }
    return map
  }, [data.projects, data.pnl])

  return (
    <div>
      <PageHeader
        title={isAdmin ? 'Projects' : 'My Projects'}
        description={isAdmin ? 'Every fiber build — scope, progress, and margin at a glance.' : 'Projects your crew is currently assigned to.'}
        action={
          isAdmin ? (
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} /> New project
            </Button>
          ) : undefined
        }
      />

      {isAdmin && (
        <div className="mb-4 flex flex-wrap gap-2">
          {(['all', ...STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                filter === s ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {s === 'all' ? 'All' : projectStatusMeta[s].label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p) => {
          const pct = projectProgress(p)
          const profit = profitByProject.get(p.id) ?? 0
          const card = (
            <Card className={`h-full p-5 ${isAdmin ? 'transition hover:border-brand-300 hover:shadow-md' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-slate-900 pr-6">{p.name}</h3>
                <Badge tone={projectStatusMeta[p.status].tone}>{projectStatusMeta[p.status].label}</Badge>
              </div>
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                <MapPin size={12} /> {p.location}{(p.workTypes ?? []).length > 0 ? ' · ' + (p.workTypes ?? []).map((w) => workTypeLabel[w]).join(' + ') : ''}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">{p.client}</p>

              <div className="mt-4">
                {p.footageGoal > 0 ? (
                  <>
                    <div className="mb-1 flex justify-between text-xs text-slate-500">
                      <span>{number(p.footageComplete)} / {number(p.footageGoal)} LF</span>
                      <span className="font-medium text-slate-700">{percent(pct)} complete</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-fiber-500" style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{number(p.footageComplete)} LF placed</span>
                    <span className="text-slate-400">No footage goal set</span>
                  </div>
                )}
              </div>

              <div className={`mt-4 grid gap-2 border-t border-slate-100 pt-3 text-center ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {isAdmin && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Contract</p>
                    <p className="text-sm font-semibold text-slate-800">{money(p.contractValue)}</p>
                  </div>
                )}
                {isAdmin && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Profit</p>
                    <p className={`text-sm font-semibold ${profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {money(profit)}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Work type</p>
                  <p className="text-sm font-semibold text-slate-800">{(p.workTypes ?? []).map((w) => workTypeLabel[w]).join(' + ') || '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Due</p>
                  <p className="text-sm font-semibold text-slate-800">{formatDate(p.dueDate)}</p>
                </div>
              </div>
            </Card>
          )
          return (
            <div key={p.id} className="relative">
              {isAdmin ? <Link to={`/projects/${p.id}`}>{card}</Link> : card}
              {isAdmin && (
                <button
                  onClick={(e) => { e.preventDefault(); setEditing(p) }}
                  className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Edit project"
                >
                  <Pencil size={14} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <Card className="p-10 text-center text-sm text-slate-400">
          {myProjectIds !== null
            ? 'No projects assigned to your crew yet.'
            : 'No projects match this filter.'}
        </Card>
      )}

      <NewProjectModal open={open} onClose={() => setOpen(false)} onCreate={addProject} />
      {editing && <EditProjectModal project={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ClientField({
  clients,
  rateCards,
  clientId,
  clientName,
  rateCardId,
  onChange,
  onRateCardChange,
}: {
  clients: ReturnType<typeof useData>['data']['clients']
  rateCards: ReturnType<typeof useData>['data']['rateCards']
  clientId: string
  clientName: string
  rateCardId: string
  onChange: (clientId: string, clientName: string) => void
  onRateCardChange: (rateCardId: string) => void
}) {
  const dropdownVal = clientId || (clientName ? '__other__' : '')
  const linkedCards = clientId ? rateCards.filter((rc) => rc.clientId === clientId) : []

  const handleSelect = (val: string) => {
    onRateCardChange('') // switching clients invalidates whichever rate card was picked for the old one
    if (val === '__other__' || val === '') {
      onChange('', val === '' ? '' : clientName)
    } else {
      const c = clients.find((c) => c.id === val)
      onChange(val, c?.name ?? '')
    }
  }

  return (
    <div>
      <Select value={dropdownVal} onChange={(e) => handleSelect(e.target.value)}>
        <option value="">— Select client —</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="__other__">Other / custom name</option>
      </Select>
      {dropdownVal === '__other__' && (
        <Input
          value={clientName}
          onChange={(e) => onChange('', e.target.value)}
          placeholder="Type client name"
          className="mt-2"
        />
      )}
      {linkedCards.length > 0 && (
        <div className="mt-2">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Rate card <span className="font-normal text-slate-400">— used by the Field Map for billing</span>
          </label>
          <Select value={rateCardId} onChange={(e) => onRateCardChange(e.target.value)}>
            <option value="">— Not assigned —</option>
            {linkedCards.map((rc) => (
              <option key={rc.id} value={rc.id}>
                {rc.name}{(rc.divisions ?? []).length > 0 ? ` · ${rc.divisions.join(' + ')}` : ''}
              </option>
            ))}
          </Select>
          {!rateCardId && (
            <p className="mt-1 text-xs text-amber-600">No rate card assigned — Add Work billing won't have codes to pick from until one is chosen.</p>
          )}
        </div>
      )}
      {clientId && linkedCards.length === 0 && (
        <p className="mt-1 text-xs text-amber-600">No rate cards found for this client — add one in Rate Cards.</p>
      )}
    </div>
  )
}

function NewProjectModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: ReturnType<typeof useData>['addProject']
}) {
  const { data } = useData()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    name: '',
    client: '',
    clientId: '',
    rateCardId: '',
    location: '',
    workTypes: [] as WorkType[],
    status: 'planning' as ProjectStatus,
    startDate: today,
    dueDate: today,
    contractValue: 0,
    budget: 0,
    footageGoal: 0,
    retentionPct: 10,
  })

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = () => {
    if (!form.name.trim()) return
    onCreate({ ...form, rateCardId: form.rateCardId || null, retentionPct: form.retentionPct / 100, footageComplete: 0, crewIds: [], notes: '' })
    onClose()
    setForm((f) => ({ ...f, name: '', client: '', clientId: '', rateCardId: '', location: '', contractValue: 0, budget: 0, footageGoal: 0, retentionPct: 10 }))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Create project</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Project name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Oak Ridge FTTH Phase 1" autoFocus />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Client">
            <ClientField
              clients={data.clients}
              rateCards={data.rateCards}
              clientId={form.clientId}
              clientName={form.client}
              rateCardId={form.rateCardId}
              onChange={(id, name) => setForm((f) => ({ ...f, clientId: id, client: name }))}
              onRateCardChange={(id) => set('rateCardId', id)}
            />
          </Field>
        </div>
        <Field label="Location">
          <Input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="City, ST" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Crew types" hint="Select all that apply">
            <div className="flex flex-wrap gap-2 pt-1">
              {WORK_TYPES.map((w) => {
                const active = form.workTypes.includes(w)
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => set('workTypes', active ? form.workTypes.filter((x) => x !== w) : [...form.workTypes, w])}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      active ? WORK_TYPE_PILL[w] : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${active ? 'bg-white' : WORK_TYPE_DOT[w]}`} />
                    {workTypeLabel[w]}
                  </button>
                )
              })}
            </div>
          </Field>
        </div>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{projectStatusMeta[s].label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Start date">
          <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </Field>
        <Field label="Due date">
          <Input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
        <Field label="Contract value ($)">
          <Input type="number" value={form.contractValue} onChange={(e) => set('contractValue', Number(e.target.value))} />
        </Field>
        <Field label="Budget ($)">
          <Input type="number" value={form.budget} onChange={(e) => set('budget', Number(e.target.value))} />
        </Field>
        <Field label="Footage goal (ft)">
          <Input type="number" value={form.footageGoal} onChange={(e) => set('footageGoal', Number(e.target.value))} />
        </Field>
      </div>
    </Modal>
  )
}

function EditProjectModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { data, updateProject } = useData()

  // Auto-link clientId by name match if not already set
  const resolvedClientId = project.clientId ??
    data.clients.find((c) => c.name.toLowerCase() === project.client.toLowerCase())?.id ?? ''

  const [form, setForm] = useState({
    name: project.name,
    client: project.client,
    clientId: resolvedClientId,
    rateCardId: project.rateCardId ?? '',
    location: project.location,
    workTypes: project.workTypes ?? [],
    status: project.status,
    startDate: project.startDate,
    dueDate: project.dueDate,
    contractValue: project.contractValue,
    budget: project.budget,
    footageGoal: project.footageGoal,
    retentionPct: (project.retentionPct ?? 0) * 100,
    notes: project.notes ?? '',
  })

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = () => {
    if (!form.name.trim()) return
    updateProject(project.id, {
      ...form,
      rateCardId: form.rateCardId || null,
      retentionPct: form.retentionPct / 100,
    })
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit — ${project.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Save changes</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Project name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Client">
            <ClientField
              clients={data.clients}
              rateCards={data.rateCards}
              clientId={form.clientId}
              clientName={form.client}
              rateCardId={form.rateCardId}
              onChange={(id, name) => setForm((f) => ({ ...f, clientId: id, client: name }))}
              onRateCardChange={(id) => set('rateCardId', id)}
            />
          </Field>
        </div>
        <Field label="Location">
          <Input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="City, ST" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Crew types" hint="Select all that apply">
            <div className="flex flex-wrap gap-2 pt-1">
              {WORK_TYPES.map((w) => {
                const active = form.workTypes.includes(w)
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => set('workTypes', active ? form.workTypes.filter((x) => x !== w) : [...form.workTypes, w])}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      active ? WORK_TYPE_PILL[w] : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${active ? 'bg-white' : WORK_TYPE_DOT[w]}`} />
                    {workTypeLabel[w]}
                  </button>
                )
              })}
            </div>
          </Field>
        </div>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{projectStatusMeta[s].label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Start date">
          <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </Field>
        <Field label="Due date">
          <Input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
        <Field label="Contract value ($)">
          <Input type="number" min="0" step="0.01" value={form.contractValue} onChange={(e) => set('contractValue', Number(e.target.value))} />
        </Field>
        <Field label="Budget ($)">
          <Input type="number" min="0" step="0.01" value={form.budget} onChange={(e) => set('budget', Number(e.target.value))} />
        </Field>
        <Field label="Footage goal (ft)">
          <Input type="number" min="0" value={form.footageGoal} onChange={(e) => set('footageGoal', Number(e.target.value))} />
        </Field>
        <Field label="Retention held (%)">
          <Input type="number" min="0" max="100" step="0.1" value={form.retentionPct} onChange={(e) => set('retentionPct', Number(e.target.value))} placeholder="0" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Any project notes..." />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
