import { useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, Calendar, Users, Trash2 } from 'lucide-react'
import { useData } from '../store/DataContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { StatCard } from '../components/ui/StatCard'
import { Button } from '../components/ui/Form'
import {
  money,
  number,
  percent,
  formatDate,
  projectStatusMeta,
  workTypeLabel,
} from '../lib/format'
import { projectProgress, summarizePnl } from '../lib/analytics'

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, deleteProject } = useData()

  const project = data.projects.find((p) => p.id === id)

  const stats = useMemo(() => {
    if (!project) return null
    const pnl = data.pnl.filter((e) => e.projectId === project.id)
    const summary = summarizePnl(pnl)
    const production = data.production.filter((e) => e.projectId === project.id)
    const photos = data.photos.filter((e) => e.projectId === project.id)
    const invoices = data.invoices.filter((e) => e.projectId === project.id)
    const crews = data.crews.filter((c) => c.currentProjectId === project.id || project.crewIds.includes(c.id))
    return { summary, production, photos, invoices, crews }
  }, [project, data])

  if (!project || !stats) {
    return (
      <div>
        <Link to="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-brand-600">
          <ArrowLeft size={16} /> Back to projects
        </Link>
        <Card className="p-10 text-center text-slate-500">Project not found.</Card>
      </div>
    )
  }

  const pct = projectProgress(project)
  const budgetUsed = project.budget > 0 ? stats.summary.cost / project.budget : 0
  const recentProduction = [...stats.production].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)

  const onDelete = () => {
    if (confirm(`Delete "${project.name}" and all its production/P&L records?`)) {
      deleteProject(project.id)
      navigate('/projects')
    }
  }

  return (
    <div>
      <Link to="/projects" className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
        <ArrowLeft size={16} /> Back to projects
      </Link>

      <PageHeader
        title={project.name}
        action={
          <>
            <Badge tone={projectStatusMeta[project.status].tone}>{projectStatusMeta[project.status].label}</Badge>
            <Button variant="danger" onClick={onDelete}>
              <Trash2 size={16} /> Delete
            </Button>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
        <span className="flex items-center gap-1.5"><MapPin size={14} /> {project.location}</span>
        <span className="flex items-center gap-1.5">{workTypeLabel[project.workType]}</span>
        <span className="flex items-center gap-1.5"><Calendar size={14} /> {formatDate(project.startDate)} → {formatDate(project.dueDate)}</span>
        <span className="flex items-center gap-1.5"><Users size={14} /> {stats.crews.map((c) => c.name).join(', ') || 'No crew assigned'}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Contract value" value={money(project.contractValue)} />
        <StatCard label="Revenue to date" value={money(stats.summary.revenue)} hint={`cost ${money(stats.summary.cost)}`} />
        <StatCard
          label="Profit"
          value={money(stats.summary.profit)}
          trend={{ value: percent(stats.summary.margin, 1), positive: stats.summary.profit >= 0 }}
          hint="margin"
        />
        <StatCard label="Budget used" value={percent(budgetUsed, 0)} hint={`of ${money(project.budget)}`} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent production" subtitle={`${number(stats.production.length)} total entries`} />
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-5 py-2 font-medium">Crew</th>
                  <th className="px-5 py-2 text-right font-medium">Footage</th>
                  <th className="px-5 py-2 text-right font-medium">Hours</th>
                </tr>
              </thead>
              <tbody>
                {recentProduction.map((e) => {
                  const crew = data.crews.find((c) => c.id === e.crewId)
                  return (
                    <tr key={e.id} className="border-b border-slate-50">
                      <td className="px-5 py-2.5 text-slate-600">{formatDate(e.date)}</td>
                      <td className="px-5 py-2.5 text-slate-700">{crew?.name ?? '—'}</td>
                      <td className="px-5 py-2.5 text-right font-medium text-slate-800">{number(e.footage)} ft</td>
                      <td className="px-5 py-2.5 text-right text-slate-600">{e.hours}</td>
                    </tr>
                  )
                })}
                {recentProduction.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">No production logged yet.</td></tr>
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Build progress" />
            <CardBody>
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-slate-500">{number(project.footageComplete)} / {number(project.footageGoal)} ft</span>
                <span className="font-semibold text-slate-800">{percent(pct)}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-fiber-500" style={{ width: `${pct * 100}%` }} />
              </div>
              {project.notes && (
                <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{project.notes}</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Invoices" subtitle={`${stats.invoices.length} on this project`} />
            <CardBody className="space-y-2">
              {stats.invoices.map((i) => (
                <Link key={i.id} to="/invoicing" className="flex items-center justify-between rounded-lg p-2 text-sm hover:bg-slate-50">
                  <span className="font-medium text-slate-700">{i.number}</span>
                  <Badge tone={i.status === 'paid' ? 'green' : i.status === 'overdue' ? 'red' : 'blue'}>{i.status}</Badge>
                </Link>
              ))}
              {stats.invoices.length === 0 && <p className="text-sm text-slate-400">No invoices yet.</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
