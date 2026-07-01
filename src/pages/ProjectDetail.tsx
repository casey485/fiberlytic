import { useRef, useMemo, useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, Calendar, Users, Trash2, Upload, FileText, Download, X, Pencil, Loader2, RotateCcw, Map as MapIcon } from 'lucide-react'
import { useData } from '../store/DataContext'
import { loadBlob } from '../lib/fileStore'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { StatCard } from '../components/ui/StatCard'
import { Button } from '../components/ui/Form'
import { BoundaryMap } from '../components/BoundaryMap'
import {
  money,
  number,
  percent,
  formatDate,
  projectStatusMeta,
  workTypeLabel,
} from '../lib/format'
import { projectProgress, summarizePnl } from '../lib/analytics'
import type { ProjectFileType } from '../types'

function fileTypeFromMime(mime: string, name: string): ProjectFileType {
  if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'pdf'
  if (name.toLowerCase().endsWith('.kmz') || name.toLowerCase().endsWith('.kml')) return 'kmz'
  return 'other'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, deleteProject, updateProject, updateCrew, addProjectFile, deleteProjectFile } = useData()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [editingBoundary, setEditingBoundary] = useState(false)
  const [draftBoundary, setDraftBoundary] = useState<[number, number][]>([])

  const project = data.projects.find((p) => p.id === id)
  const projectFiles = data.projectFiles.filter((f) => f.projectId === id)

  const savedBoundary = project?.boundary ?? []

  // When entering edit mode, seed the draft from the saved boundary
  useEffect(() => {
    if (editingBoundary) setDraftBoundary(savedBoundary)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingBoundary])

  const saveBoundary = () => {
    if (!project) return
    updateProject(project.id, { boundary: draftBoundary })
    setEditingBoundary(false)
  }

  const cancelEdit = () => {
    setEditingBoundary(false)
    setDraftBoundary([])
  }

  const clearBoundary = () => {
    setDraftBoundary([])
  }

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    const pending = Array.from(files).map(
      (file) =>
        new Promise<void>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => {
            addProjectFile({
              projectId: project.id,
              name: file.name,
              fileType: fileTypeFromMime(file.type, file.name),
              dataUrl: reader.result as string,
              size: file.size,
              uploadedAt: new Date().toISOString().slice(0, 10),
            })
            resolve()
          }
          reader.readAsDataURL(file)
        }),
    )
    Promise.all(pending).then(() => setUploading(false))
    e.target.value = ''
  }

  const openFile = async (fileId: string, name: string) => {
    const dataUrl = await loadBlob(fileId)
    if (!dataUrl) { alert('File not found in storage.'); return }
    const a = document.createElement('a')
    a.href = dataUrl
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.download = name
    a.click()
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
        <span className="flex items-center gap-1.5">{(project.workTypes ?? []).map((w) => workTypeLabel[w]).join(' + ') || '—'}</span>
        <span className="flex items-center gap-1.5"><Calendar size={14} /> {formatDate(project.startDate)} → {formatDate(project.dueDate)}</span>
        <span className="flex items-center gap-1.5"><Users size={14} /> {stats.crews.map((c) => c.name).join(', ') || 'No crew assigned'}</span>
        {project.client && <span className="flex items-center gap-1.5 font-medium text-slate-600">{project.client}</span>}
        {project.clientId && (() => {
          const cards = data.rateCards.filter(rc => rc.clientId === project.clientId)
          return cards.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {cards.map(rc => (
                <span key={rc.id} className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                  {rc.name}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-xs text-amber-500">No rate card — add one in Rate Cards</span>
          )
        })()}
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

      {/* ── Crew Assignment ── */}
      <Card className="mt-6">
        <CardHeader
          title="Crew Assignment"
          subtitle="Assign one or more crews — they'll see this project in their field view immediately"
        />
        <CardBody>
          {data.crews.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No crews yet — add one in the Crews page.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.crews.map((crew) => {
                const assigned = project.crewIds.includes(crew.id)
                const foreman = crew.foremanId
                  ? data.employees.find((e) => e.id === crew.foremanId)?.name
                  : crew.foreman
                return (
                  <button
                    key={crew.id}
                    onClick={() => {
                      if (assigned) {
                        updateProject(project.id, { crewIds: project.crewIds.filter((c) => c !== crew.id) })
                        if (crew.currentProjectId === project.id) updateCrew(crew.id, { currentProjectId: null, status: 'idle' })
                      } else {
                        updateProject(project.id, { crewIds: [...project.crewIds, crew.id] })
                        updateCrew(crew.id, { currentProjectId: project.id, status: 'active' })
                      }
                    }}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      assigned
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full shrink-0 ${assigned ? 'bg-brand-500' : 'bg-slate-300'}`} />
                    <span>{crew.name}</span>
                    {foreman && <span className="text-xs font-normal text-slate-400">· {foreman}</span>}
                    {assigned && <span className="text-xs font-normal text-brand-500">✓ Assigned</span>}
                  </button>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Project Files ── */}
      <Card className="mt-6">
        <CardHeader
          title="Project files"
          subtitle="PDFs and KMZ plans — shared with assigned crew in the field"
          action={
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.kmz,.kml"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? <><Loader2 size={15} className="animate-spin" /> Uploading…</> : <><Upload size={16} /> Upload file</>}
              </Button>
            </>
          }
        />
        <CardBody className={projectFiles.length === 0 ? undefined : 'p-0'}>
          {projectFiles.length === 0 ? (
            <div
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 py-10 text-center text-slate-400 transition hover:border-brand-300 hover:text-brand-500"
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? <Loader2 size={28} className="mb-2 animate-spin text-brand-500" /> : <Upload size={28} className="mb-2" />}
              <p className="text-sm font-medium">{uploading ? 'Uploading…' : 'Click to upload PDF or KMZ'}</p>
              <p className="mt-1 text-xs">Large files supported — stored locally on this device</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5 font-medium">File</th>
                  <th className="px-5 py-2.5 font-medium">Type</th>
                  <th className="px-5 py-2.5 font-medium">Size</th>
                  <th className="px-5 py-2.5 font-medium">Added</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {projectFiles.map((f) => (
                  <tr key={f.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      {f.fileType === 'pdf' ? (
                        <Link
                          to={`/kmz/${id}`}
                          state={{ openPdfFileId: f.id }}
                          className="flex items-center gap-2 font-medium text-brand-600 hover:text-brand-700"
                        >
                          <FileText size={16} />
                          {f.name}
                        </Link>
                      ) : (
                        <Link
                          to={`/kmz/${id}`}
                          className="flex items-center gap-2 font-medium text-emerald-600 hover:text-emerald-700"
                        >
                          <MapIcon size={16} />
                          {f.name}
                        </Link>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${
                        f.fileType === 'pdf' ? 'bg-red-50 text-red-600' :
                        f.fileType === 'kmz' ? 'bg-emerald-50 text-emerald-600' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {f.fileType}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{formatBytes(f.size)}</td>
                    <td className="px-5 py-3 text-slate-400">{formatDate(f.uploadedAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {f.fileType === 'pdf' ? (
                          <Link
                            to={`/kmz/${id}`}
                            state={{ openPdfFileId: f.id }}
                            className="text-slate-300 hover:text-brand-600"
                            title="Open in Field Map"
                          >
                            <Pencil size={14} />
                          </Link>
                        ) : (
                          <>
                            <Link
                              to={`/kmz/${id}`}
                              className="text-slate-300 hover:text-emerald-600"
                              title="Open in Field Map"
                            >
                              <MapIcon size={14} />
                            </Link>
                            <button
                              onClick={() => openFile(f.id, f.name)}
                              className="text-slate-300 hover:text-brand-600"
                              title="Download"
                            >
                              <Download size={14} />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => {
                            if (confirm(`Remove "${f.name}" from this project?`)) deleteProjectFile(f.id)
                          }}
                          className="text-slate-300 hover:text-rose-600"
                          title="Delete"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* ── Job Site Boundary ── */}
      <Card className="mt-6">
        <CardHeader
          title="Job site boundary"
          subtitle={
            editingBoundary
              ? 'Click the map to add points, click a blue dot to remove it, drag to reposition.'
              : savedBoundary.length >= 3
              ? `Geofence active — ${savedBoundary.length} points. Crew must be inside this area to clock in.`
              : 'No boundary set. Click "Set Boundary" to draw one — crew cannot clock in without it.'
          }
          action={
            editingBoundary ? (
              <div className="flex gap-2">
                {draftBoundary.length > 0 && (
                  <Button variant="secondary" onClick={clearBoundary}>
                    <RotateCcw size={14} /> Clear all
                  </Button>
                )}
                <Button variant="secondary" onClick={cancelEdit}>Cancel</Button>
                <Button onClick={saveBoundary} disabled={draftBoundary.length < 3}>
                  Save boundary
                </Button>
              </div>
            ) : (
              <Button onClick={() => setEditingBoundary(true)}>
                {savedBoundary.length >= 3 ? 'Edit boundary' : 'Set boundary'}
              </Button>
            )
          }
        />
        <CardBody>
          {editingBoundary ? (
            <BoundaryMap boundary={draftBoundary} onChange={setDraftBoundary} />
          ) : savedBoundary.length > 0 ? (
            <BoundaryMap boundary={savedBoundary} onChange={() => {}} readOnly />
          ) : (
            <div className="flex h-32 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
              No boundary drawn yet — click "Set boundary" to get started.
            </div>
          )}
        </CardBody>
      </Card>

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
