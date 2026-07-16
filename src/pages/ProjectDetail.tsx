import { useRef, useMemo, useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, Calendar, Users, Trash2, Upload, FileText, Download, X, Pencil, Loader2, RotateCcw, Map as MapIcon, Scissors, FolderOpen } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { loadBlob } from '../lib/fileStore'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { StatCard } from '../components/ui/StatCard'
import { Button, Select } from '../components/ui/Form'
import { BoundaryMap } from '../components/BoundaryMap'
import {
  money,
  number,
  percent,
  formatDate,
  projectStatusMeta,
  workTypeLabel,
  localDateStr,
} from '../lib/format'
import { projectProgress, summarizePnl } from '../lib/analytics'
import { effectivePrintAssignment } from '../lib/printAssignment'
import { phaseColor } from '../lib/mapCuts/phaseColors'
import type { ProjectFileType, ProjectFile, MapCutPackage } from '../types'

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

/** Encodes the mutually-exclusive assignedCrewId/assignedSubcontractorId
 *  pair into one <select> value, and back — "crew:<id>" / "sub:<id>". Module
 *  scope (not just inside ProjectDetail) since PhaseGroup below needs it too. */
function assignSelectValue(crewId: string | null, subcontractorId: string | null): string {
  if (crewId) return `crew:${crewId}`
  if (subcontractorId) return `sub:${subcontractorId}`
  return ''
}
function parseAssignSelectValue(v: string): { assignedCrewId: string | null; assignedSubcontractorId: string | null } {
  if (v.startsWith('crew:')) return { assignedCrewId: v.slice(5), assignedSubcontractorId: null }
  if (v.startsWith('sub:')) return { assignedCrewId: null, assignedSubcontractorId: v.slice(4) }
  return { assignedCrewId: null, assignedSubcontractorId: null }
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, deleteProject, updateProject, updateCrew, addProjectFile, deleteProjectFile, updateProjectFile, updateMapCutPackage } = useData()
  const { isAdmin } = useRole()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [editingBoundary, setEditingBoundary] = useState(false)
  const [draftBoundary, setDraftBoundary] = useState<[number, number][]>([])

  const project = data.projects.find((p) => p.id === id)
  const projectFiles = data.projectFiles.filter((f) => f.projectId === id)
  // Every print/cut-piece file, grouped by the MapCutPackage ("phase") that
  // generated it — a plain uploaded PDF/KMZ, and the original master print
  // itself, have no package and stay ungrouped. See src/lib/printAssignment.ts
  // for how a piece's own assignment vs. its package's default resolve.
  const projectPackages = (data.mapCutPackages ?? []).filter((p) => p.projectId === id)
  const packagesById = new Map(projectPackages.map((p) => [p.id, p]))
  const ungroupedFiles = projectFiles.filter((f) => !f.sourceMapCutPackageId || !packagesById.has(f.sourceMapCutPackageId))
  const filesByPackageId = new Map<string, ProjectFile[]>()
  for (const f of projectFiles) {
    if (f.sourceMapCutPackageId && packagesById.has(f.sourceMapCutPackageId)) {
      const arr = filesByPackageId.get(f.sourceMapCutPackageId) ?? []
      arr.push(f)
      filesByPackageId.set(f.sourceMapCutPackageId, arr)
    }
  }
  // Every package's phases actually nest under their real master file (by
  // sourceProjectFileId), not just "whatever ungrouped row happens to render
  // above them" — matters once a project has more than one cut print.
  const packagesByMasterId = new Map<string, MapCutPackage[]>()
  for (const pkg of projectPackages) {
    if (!filesByPackageId.has(pkg.id) || !pkg.sourceProjectFileId) continue
    const arr = packagesByMasterId.get(pkg.sourceProjectFileId) ?? []
    arr.push(pkg)
    packagesByMasterId.set(pkg.sourceProjectFileId, arr)
  }
  const standaloneFiles = ungroupedFiles.filter((f) => !packagesByMasterId.has(f.id))
  const masterFiles = ungroupedFiles.filter((f) => packagesByMasterId.has(f.id))
  // Scoped to whoever's actually staffed on THIS project (Crew & Subcontractor
  // Assignment above) — not every crew/sub in the company. Ties the two cards
  // together instead of duplicating one big picker in both places: assign
  // someone to the project first, then route specific prints to them here.
  const projectCrewIds = project?.crewIds ?? []
  const projectSubIds = project?.subcontractorIds ?? []
  const activeCrews = data.crews.filter((c) => c.status !== 'off' && projectCrewIds.includes(c.id))
  const activeSubs = (data.subcontractors ?? []).filter((s) => s.active && projectSubIds.includes(s.id))

  // Employees.isSupervisor-flagged people, plus whoever's already assigned
  // here even if that flag got unchecked later — an existing assignment
  // should never silently vanish from the picker just because someone
  // edited the employee record after the fact.
  const supervisorOptions = data.employees.filter(
    (e) => (e.active && e.isSupervisor) || e.id === project?.supervisorId,
  )

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
        <Card className="p-10 text-center text-slate-400">Project not found.</Card>
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
              uploadedAt: localDateStr(),
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

      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-400">
        <span className="flex items-center gap-1.5"><MapPin size={14} /> {project.location}</span>
        <span className="flex items-center gap-1.5">{(project.workTypes ?? []).map((w) => workTypeLabel[w]).join(' + ') || '—'}</span>
        <span className="flex items-center gap-1.5"><Calendar size={14} /> {formatDate(project.startDate)} → {formatDate(project.dueDate)}</span>
        <span className="flex items-center gap-1.5"><Users size={14} /> {stats.crews.map((c) => c.name).join(', ') || 'No crew assigned'}</span>
        {project.client && <span className="flex items-center gap-1.5 font-medium text-slate-400">{project.client}</span>}
        {project.clientId && (() => {
          const cards = data.rateCards.filter(rc => rc.clientId === project.clientId)
          if (cards.length === 0) {
            return <span className="text-xs text-amber-500">No rate card — add one in Rate Cards</span>
          }
          if (!isAdmin) {
            const assigned = cards.find((rc) => rc.id === project.rateCardId)
            return assigned ? (
              <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">{assigned.name}</span>
            ) : (
              <span className="text-xs text-amber-500">No rate card assigned to this project</span>
            )
          }
          return (
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Rate card:</span>
              <select
                value={project.rateCardId ?? ''}
                onChange={(e) => updateProject(project.id, { rateCardId: e.target.value || null })}
                className={`rounded-md border px-2 py-0.5 text-xs font-semibold outline-none ${
                  project.rateCardId ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-amber-300 bg-amber-50 text-amber-700'
                }`}
              >
                <option value="">— Not assigned —</option>
                {cards.map(rc => <option key={rc.id} value={rc.id}>{rc.name}</option>)}
              </select>
            </span>
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

      {/* ── Supervisor Assignment ── */}
      <Card className="mt-6">
        <CardHeader
          title="Supervisor Assignment"
          subtitle="Assign one supervisor — they'll see this project's production progress in their Supervisor Dashboard and Field Map, with no revenue figures."
        />
        <CardBody>
          {supervisorOptions.length === 0 ? (
            <p className="text-sm text-slate-500 italic">
              No employees are marked as a supervisor yet — check "Supervisor" on someone in the Employees tab first.
            </p>
          ) : (
            <Select
              value={project.supervisorId ?? ''}
              onChange={(e) => updateProject(project.id, { supervisorId: e.target.value || null })}
              className="max-w-sm"
            >
              <option value="">— No supervisor assigned —</option>
              {supervisorOptions.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}{emp.role ? ` — ${emp.role}` : ''}</option>
              ))}
            </Select>
          )}
        </CardBody>
      </Card>

      {/* ── Crew & Subcontractor Assignment — who's staffed on this project overall.
           Kept as one combined multi-select card (same toggle-chip UX as before, just
           relocated next to Project files instead of living separately higher up the
           page) — distinct from the per-file "Assigned to" column below, which routes
           one specific print/phase to exactly one crew or sub. This one still drives
           immediate dashboard visibility (Subcontractor Dashboard's "Your Projects",
           Crew field view) even before any print exists to assign. ── */}
      <Card className="mt-6">
        <CardHeader
          title="Crew & Subcontractor Assignment"
          subtitle="Who's staffed on this project — they'll see it in their field/dashboard view immediately. Assign specific prints below once files are uploaded."
        />
        <CardBody className="space-y-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Crews</p>
            {data.crews.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No crews yet — add one in the Crews page.</p>
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
                          : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full shrink-0 ${assigned ? 'bg-brand-500' : 'bg-slate-300'}`} />
                      <span>{crew.name}</span>
                      {foreman && <span className="text-xs font-normal text-slate-500">· {foreman}</span>}
                      {assigned && <span className="text-xs font-normal text-brand-500">✓ Assigned</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Subcontractors</p>
            {(data.subcontractors ?? []).length === 0 ? (
              <p className="text-sm text-slate-500 italic">No subcontractors yet — add one in the Subcontractors tab.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(data.subcontractors ?? []).filter((s) => s.active).map((sub) => {
                  const subIds = project.subcontractorIds ?? []
                  const assigned = subIds.includes(sub.id)
                  return (
                    <button
                      key={sub.id}
                      onClick={() => {
                        updateProject(project.id, {
                          subcontractorIds: assigned ? subIds.filter((id) => id !== sub.id) : [...subIds, sub.id],
                        })
                      }}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                        assigned
                          ? 'border-amber-500 bg-amber-50 text-amber-700'
                          : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full shrink-0 ${assigned ? 'bg-amber-500' : 'bg-slate-300'}`} />
                      <span>{sub.companyName}</span>
                      {assigned && <span className="text-xs font-normal text-amber-500">✓ Assigned</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
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
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 py-10 text-center text-slate-500 transition hover:border-brand-300 hover:text-brand-500"
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? <Loader2 size={28} className="mb-2 animate-spin text-brand-500" /> : <Upload size={28} className="mb-2" />}
              <p className="text-sm font-medium">{uploading ? 'Uploading…' : 'Click to upload PDF or KMZ'}</p>
              <p className="mt-1 text-xs">Large files supported — stored locally on this device</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {standaloneFiles.map((f) => (
                <FileRow
                  key={f.id}
                  f={f}
                  id={id!}
                  activeCrews={activeCrews}
                  activeSubs={activeSubs}
                  value={assignSelectValue(f.assignedCrewId ?? null, f.assignedSubcontractorId ?? null)}
                  onAssignChange={(v) => updateProjectFile(f.id, parseAssignSelectValue(v))}
                  openFile={openFile}
                  deleteProjectFile={deleteProjectFile}
                  isAdmin={isAdmin}
                  onMapCut={(fileId) => navigate('/map-cuts', { state: { projectId: id, existingFileId: fileId } })}
                />
              ))}
              {masterFiles.map((master) => {
                const phases = (packagesByMasterId.get(master.id) ?? []).slice().sort((a, b) => (a.phaseNumber ?? 1) - (b.phaseNumber ?? 1))
                return (
                  <div key={master.id}>
                    <FileRow
                      f={master}
                      id={id!}
                      activeCrews={activeCrews}
                      activeSubs={activeSubs}
                      value={assignSelectValue(master.assignedCrewId ?? null, master.assignedSubcontractorId ?? null)}
                      onAssignChange={(v) => updateProjectFile(master.id, parseAssignSelectValue(v))}
                      openFile={openFile}
                      deleteProjectFile={deleteProjectFile}
                      isAdmin={isAdmin}
                      onMapCut={(fileId) => navigate('/map-cuts', { state: { projectId: id, existingFileId: fileId } })}
                    />
                    <div className="space-y-1 bg-slate-50/60 py-1 pl-9 pr-3">
                      {phases.map((pkg) => {
                        const pieces = filesByPackageId.get(pkg.id) ?? []
                        return (
                          <PhaseGroup
                            key={pkg.id}
                            pkg={pkg}
                            pieces={pieces}
                            projectPackages={projectPackages}
                            id={id!}
                            activeCrews={activeCrews}
                            activeSubs={activeSubs}
                            onPhaseAssignChange={(v) => {
                              const parsed = parseAssignSelectValue(v)
                              updateMapCutPackage(pkg.id, {
                                defaultAssignedCrewId: parsed.assignedCrewId,
                                defaultAssignedSubcontractorId: parsed.assignedSubcontractorId,
                              })
                            }}
                            onPieceAssignChange={(fileId, v) => updateProjectFile(fileId, parseAssignSelectValue(v))}
                            openFile={openFile}
                            deleteProjectFile={deleteProjectFile}
                            isAdmin={isAdmin}
                            onMapCut={(fileId) => navigate('/map-cuts', { state: { projectId: id, existingFileId: fileId } })}
                          />
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

      {/* ── Documentation / Closeout ── */}
      <Card className="mt-6">
        <CardHeader
          title="Documentation"
          subtitle="Every photo, video, inspection, and attachment submitted from the field — organized per Work Object, plus a customizable closeout package."
          action={
            <Link
              to={`/projects/${id}/documentation`}
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
            >
              <FolderOpen size={16} /> Open Documentation Folder
            </Link>
          }
        />
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
            <div className="flex h-32 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
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
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
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
                      <td className="px-5 py-2.5 text-slate-400">{formatDate(e.date)}</td>
                      <td className="px-5 py-2.5 text-slate-700">{crew?.name ?? '—'}</td>
                      <td className="px-5 py-2.5 text-right font-medium text-slate-800">{number(e.footage)} ft</td>
                      <td className="px-5 py-2.5 text-right text-slate-400">{e.hours}</td>
                    </tr>
                  )
                })}
                {recentProduction.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-500">No production logged yet.</td></tr>
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
                <span className="text-slate-400">{number(project.footageComplete)} / {number(project.footageGoal)} ft</span>
                <span className="font-semibold text-slate-800">{percent(pct)}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-fiber-500" style={{ width: `${pct * 100}%` }} />
              </div>
              {project.notes && (
                <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-400">{project.notes}</p>
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
              {stats.invoices.length === 0 && <p className="text-sm text-slate-500">No invoices yet.</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** File-action icons (open/edit, download, map-cut, delete) — identical set
 *  used by every row flavor below (standalone file, master print, single
 *  piece), so behavior never drifts between them. */
function FileActions({ f, id, openFile, deleteProjectFile, isAdmin, onMapCut }: {
  f: ProjectFile
  id: string
  openFile: (fileId: string, name: string) => void
  deleteProjectFile: (fileId: string) => void
  isAdmin: boolean
  onMapCut: (fileId: string) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {f.fileType === 'pdf' ? (
        <Link to={`/kmz/${id}/print/${f.id}`} className="text-slate-400 hover:text-brand-600" title="Open in PDF Print Mode">
          <Pencil size={14} />
        </Link>
      ) : (
        <>
          <Link to={`/kmz/${id}`} className="text-slate-400 hover:text-emerald-600" title="Open in Field Map">
            <MapIcon size={14} />
          </Link>
          <button onClick={() => openFile(f.id, f.name)} className="text-slate-400 hover:text-brand-600" title="Download">
            <Download size={14} />
          </button>
        </>
      )}
      {isAdmin && f.fileType === 'pdf' && (
        <button onClick={() => onMapCut(f.id)} className="text-slate-400 hover:text-amber-600" title={`Map Cut ${f.name}`}>
          <Scissors size={14} />
        </button>
      )}
      <button
        onClick={() => { if (confirm(`Remove "${f.name}" from this project?`)) deleteProjectFile(f.id) }}
        className="text-slate-400 hover:text-rose-600"
        title="Delete"
      >
        <X size={14} />
      </button>
    </div>
  )
}

const ASSIGN_SELECT_CLASS = '!w-48 !py-1.5 text-xs shrink-0'

/** A standalone uploaded file, or a master print's own row — icon, name
 *  (linked), a single light meta line (type · size · date) instead of three
 *  separate table columns, an assignment dropdown, and the action icons.
 *  One clean line per file instead of a wide table row. */
function FileRow({ f, id, activeCrews, activeSubs, value, onAssignChange, openFile, deleteProjectFile, isAdmin, onMapCut }: {
  f: ProjectFile
  id: string
  activeCrews: { id: string; name: string }[]
  activeSubs: { id: string; companyName: string }[]
  value: string
  onAssignChange: (value: string) => void
  openFile: (fileId: string, name: string) => void
  deleteProjectFile: (fileId: string) => void
  isAdmin: boolean
  onMapCut: (fileId: string) => void
}) {
  const isPdf = f.fileType === 'pdf'
  return (
    <div className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isPdf ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'}`}>
        {isPdf ? <FileText size={15} /> : <MapIcon size={15} />}
      </div>
      <div className="min-w-0 flex-1">
        <Link
          to={isPdf ? `/kmz/${id}/print/${f.id}` : `/kmz/${id}`}
          className="block truncate text-sm font-medium text-slate-800 hover:text-brand-600"
        >
          {f.name}
        </Link>
        <p className="truncate text-xs text-slate-400">
          {f.fileType.toUpperCase()} · {formatBytes(f.size)} · {formatDate(f.uploadedAt)}
        </p>
      </div>
      <Select value={value} onChange={(e) => onAssignChange(e.target.value)} className={ASSIGN_SELECT_CLASS}>
        <option value="">— Unassigned —</option>
        {activeCrews.map((c) => <option key={c.id} value={`crew:${c.id}`}>Crew: {c.name}</option>)}
        {activeSubs.map((s) => <option key={s.id} value={`sub:${s.id}`}>Sub: {s.companyName}</option>)}
      </Select>
      <FileActions f={f} id={id} openFile={openFile} deleteProjectFile={deleteProjectFile} isAdmin={isAdmin} onMapCut={onMapCut} />
    </div>
  )
}

/** Small colored dot + "Phase N" label — the same phaseColor palette Map
 *  Cuts' own Phase 1-10 strip uses, so a phase reads as the same visual
 *  identity everywhere it shows up in the app. */
function PhaseBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold" style={{ color: phaseColor(n) }}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: phaseColor(n) }} />
      Phase {n}
    </span>
  )
}

/** One phase (MapCutPackage) nested under its master print. The common case
 *  — one piece per phase — collapses phase badge + assignment + file actions
 *  onto a single line instead of a redundant "phase header row" followed by
 *  an almost-identical "piece row." A phase with multiple pieces keeps the
 *  phase-level assign control on its own header line, with each piece
 *  indented underneath showing just its own filename/size/actions. */
function PhaseGroup({ pkg, pieces, projectPackages, id, activeCrews, activeSubs, onPhaseAssignChange, onPieceAssignChange, openFile, deleteProjectFile, isAdmin, onMapCut }: {
  pkg: MapCutPackage
  pieces: ProjectFile[]
  projectPackages: MapCutPackage[]
  id: string
  activeCrews: { id: string; name: string }[]
  activeSubs: { id: string; companyName: string }[]
  onPhaseAssignChange: (value: string) => void
  onPieceAssignChange: (fileId: string, value: string) => void
  openFile: (fileId: string, name: string) => void
  deleteProjectFile: (fileId: string) => void
  isAdmin: boolean
  onMapCut: (fileId: string) => void
}) {
  const n = pkg.phaseNumber ?? 1
  const phaseAssignValue = assignSelectValue(pkg.defaultAssignedCrewId ?? null, pkg.defaultAssignedSubcontractorId ?? null)

  if (pieces.length === 0) return null

  if (pieces.length === 1) {
    const f = pieces[0]
    const eff = effectivePrintAssignment(f, projectPackages)
    const isPdf = f.fileType === 'pdf'
    return (
      <div className="flex items-center gap-3 rounded-lg py-2 pl-1 pr-2 hover:bg-white">
        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${isPdf ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'}`}>
          {isPdf ? <FileText size={12} /> : <MapIcon size={12} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <PhaseBadge n={n} />
            <Link to={isPdf ? `/kmz/${id}/print/${f.id}` : `/kmz/${id}`} className="truncate text-sm text-slate-700 hover:text-brand-600">
              {f.name}
            </Link>
          </div>
          <p className="truncate text-xs text-slate-400">{formatBytes(f.size)} · {formatDate(f.uploadedAt)}</p>
        </div>
        <Select
          value={assignSelectValue(eff.crewId, eff.subcontractorId)}
          onChange={(e) => onPieceAssignChange(f.id, e.target.value)}
          className={ASSIGN_SELECT_CLASS}
        >
          <option value="">Inherit from phase</option>
          {activeCrews.map((c) => <option key={c.id} value={`crew:${c.id}`}>Crew: {c.name}</option>)}
          {activeSubs.map((s) => <option key={s.id} value={`sub:${s.id}`}>Sub: {s.companyName}</option>)}
        </Select>
        <FileActions f={f} id={id} openFile={openFile} deleteProjectFile={deleteProjectFile} isAdmin={isAdmin} onMapCut={onMapCut} />
      </div>
    )
  }

  return (
    <div className="py-1">
      <div className="flex items-center gap-3 rounded-lg py-1.5 pl-1 pr-2">
        <PhaseBadge n={n} />
        <span className="flex-1 text-xs text-slate-400">{pieces.length} pieces</span>
        <Select value={phaseAssignValue} onChange={(e) => onPhaseAssignChange(e.target.value)} className={ASSIGN_SELECT_CLASS}>
          <option value="">Assign whole phase — Unassigned</option>
          {activeCrews.map((c) => <option key={c.id} value={`crew:${c.id}`}>Crew: {c.name}</option>)}
          {activeSubs.map((s) => <option key={s.id} value={`sub:${s.id}`}>Sub: {s.companyName}</option>)}
        </Select>
        <div className="w-[86px] shrink-0" />
      </div>
      <div className="space-y-0.5 border-l-2 pl-3" style={{ borderColor: phaseColor(n) + '40' }}>
        {pieces.map((f) => {
          const eff = effectivePrintAssignment(f, projectPackages)
          const isPdf = f.fileType === 'pdf'
          const inherited = !f.assignedCrewId && !f.assignedSubcontractorId
          return (
            <div key={f.id} className="flex items-center gap-3 rounded-lg py-1.5 pl-1 pr-2 hover:bg-white">
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${isPdf ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'}`}>
                {isPdf ? <FileText size={12} /> : <MapIcon size={12} />}
              </div>
              <div className="min-w-0 flex-1">
                <Link to={isPdf ? `/kmz/${id}/print/${f.id}` : `/kmz/${id}`} className="block truncate text-sm text-slate-700 hover:text-brand-600">
                  {f.name}
                </Link>
                <p className="truncate text-xs text-slate-400">{formatBytes(f.size)} · {formatDate(f.uploadedAt)}{inherited ? ' · via phase default' : ''}</p>
              </div>
              <Select
                value={assignSelectValue(eff.crewId, eff.subcontractorId)}
                onChange={(e) => onPieceAssignChange(f.id, e.target.value)}
                className={ASSIGN_SELECT_CLASS}
              >
                <option value="">Inherit from phase</option>
                {activeCrews.map((c) => <option key={c.id} value={`crew:${c.id}`}>Crew: {c.name}</option>)}
                {activeSubs.map((s) => <option key={s.id} value={`sub:${s.id}`}>Sub: {s.companyName}</option>)}
              </Select>
              <FileActions f={f} id={id} openFile={openFile} deleteProjectFile={deleteProjectFile} isAdmin={isAdmin} onMapCut={onMapCut} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
