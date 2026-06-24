import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, MapPin, Pencil } from 'lucide-react'
import { useData } from '../store/DataContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select, Textarea } from '../components/ui/Form'
import { money, number, percent, formatDate, projectStatusMeta, workTypeLabel } from '../lib/format'
import { projectProgress, summarizePnl } from '../lib/analytics'
import type { Project, ProjectStatus, WorkType } from '../types'

const STATUSES: ProjectStatus[] = ['planning', 'active', 'on_hold', 'complete']
const WORK_TYPES: WorkType[] = ['aerial', 'underground', 'directional_bore', 'splicing', 'mdu']

export function Projects() {
  const { data, addProject } = useData()
  const [filter, setFilter] = useState<ProjectStatus | 'all'>('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)

  const filtered = useMemo(
    () => (filter === 'all' ? data.projects : data.projects.filter((p) => p.status === filter)),
    [data.projects, filter],
  )

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
        title="Projects"
        description="Every fiber build — scope, progress, and margin at a glance."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> New project
          </Button>
        }
      />

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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p) => {
          const pct = projectProgress(p)
          const profit = profitByProject.get(p.id) ?? 0
          return (
            <div key={p.id} className="relative">
              <Link to={`/projects/${p.id}`}>
              <Card className="h-full p-5 transition hover:border-brand-300 hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-slate-900 pr-6">{p.name}</h3>
                  <Badge tone={projectStatusMeta[p.status].tone}>{projectStatusMeta[p.status].label}</Badge>
                </div>
                <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                  <MapPin size={12} /> {p.location} · {workTypeLabel[p.workType]}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">{p.client}</p>

                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>{number(p.footageComplete)} / {number(p.footageGoal)} ft</span>
                    <span className="font-medium text-slate-700">{percent(pct)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-fiber-500" style={{ width: `${pct * 100}%` }} />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Contract</p>
                    <p className="text-sm font-semibold text-slate-800">{money(p.contractValue)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Profit</p>
                    <p className={`text-sm font-semibold ${profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {money(profit)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Due</p>
                    <p className="text-sm font-semibold text-slate-800">{formatDate(p.dueDate)}</p>
                  </div>
                </div>
              </Card>
              </Link>
              <button
                onClick={(e) => { e.preventDefault(); setEditing(p) }}
                className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Edit project"
              >
                <Pencil size={14} />
              </button>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <Card className="p-10 text-center text-sm text-slate-400">No projects match this filter.</Card>
      )}

      <NewProjectModal open={open} onClose={() => setOpen(false)} onCreate={addProject} />
      {editing && <EditProjectModal project={editing} onClose={() => setEditing(null)} />}
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
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    name: '',
    client: '',
    location: '',
    workType: 'aerial' as WorkType,
    status: 'planning' as ProjectStatus,
    startDate: today,
    dueDate: today,
    contractValue: 0,
    budget: 0,
    footageGoal: 0,
  })

  const set = (k: keyof typeof form, v: string | number) => setForm((f) => ({ ...f, [k]: v }))

  const submit = () => {
    if (!form.name.trim()) return
    onCreate({ ...form, footageComplete: 0, crewIds: [], notes: '' })
    onClose()
    setForm((f) => ({ ...f, name: '', client: '', location: '', contractValue: 0, budget: 0, footageGoal: 0 }))
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
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Oak Ridge FTTH Phase 1" />
          </Field>
        </div>
        <Field label="Client">
          <Input value={form.client} onChange={(e) => set('client', e.target.value)} />
        </Field>
        <Field label="Location">
          <Input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="City, ST" />
        </Field>
        <Field label="Work type">
          <Select value={form.workType} onChange={(e) => set('workType', e.target.value)}>
            {WORK_TYPES.map((w) => (
              <option key={w} value={w}>{workTypeLabel[w]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
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
  const { updateProject } = useData()
  const [form, setForm] = useState({
    name: project.name,
    client: project.client,
    location: project.location,
    workType: project.workType,
    status: project.status,
    startDate: project.startDate,
    dueDate: project.dueDate,
    contractValue: project.contractValue,
    budget: project.budget,
    footageGoal: project.footageGoal,
    retentionPct: (project.retentionPct ?? 0) * 100,
    notes: project.notes ?? '',
  })

  const set = (k: keyof typeof form, v: string | number) => setForm((f) => ({ ...f, [k]: v }))

  const submit = () => {
    if (!form.name.trim()) return
    updateProject(project.id, {
      ...form,
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
        <Field label="Client">
          <Input value={form.client} onChange={(e) => set('client', e.target.value)} />
        </Field>
        <Field label="Location">
          <Input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="City, ST" />
        </Field>
        <Field label="Work type">
          <Select value={form.workType} onChange={(e) => set('workType', e.target.value)}>
            {WORK_TYPES.map((w) => (
              <option key={w} value={w}>{workTypeLabel[w]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
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
