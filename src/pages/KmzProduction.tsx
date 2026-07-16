import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, MapPin, Layers, CheckCircle, AlertCircle, Clock, Trash2, ChevronDown, ChevronUp, Download, Globe, UserX, FileText, Scissors, Users, HardHat } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { parseKmzOrKml } from '../lib/kmzParser'
import { exportFeaturesToKmz, triggerDownload } from '../lib/kmzExport'
import { isPrintHiddenFromSession, projectAssignedToSubcontractor, projectAssignedToCrew } from '../lib/printAssignment'
import { employeeCrewIds } from '../lib/crewOrSub'
import { phaseColor } from '../lib/mapCuts/phaseColors'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { FEATURE_STATUS_META } from '../types'
import type { FeatureStatus, MapCutPackage } from '../types'

const STATUS_ORDER: FeatureStatus[] = ['not_started', 'in_progress', 'complete', 'issue', 'rework']

export function KmzProduction() {
  const { data, addKmzUpload, deleteKmzUpload, addProjectFile } = useData()
  const { role, isAdmin, activeEmployeeId, activeSubcontractorId } = useRole()
  const nav = useNavigate()
  const kmzFileRef = useRef<HTMLInputElement>(null)
  const pdfFileRef = useRef<HTMLInputElement>(null)
  const [pendingProjectId,    setPendingProjectId]    = useState<string | null>(null)
  const [pendingPdfProjectId, setPendingPdfProjectId] = useState<string | null>(null)
  const [importing,  setImporting]  = useState<string | null>(null)
  const [importMsg,  setImportMsg]  = useState<Record<string, string>>({})
  const [expanded,   setExpanded]   = useState<Record<string, boolean>>({})
  const [exporting,  setExporting]  = useState<string | null>(null)
  const [uploadingPdf, setUploadingPdf] = useState<string | null>(null)

  function triggerUpload(projectId: string) {
    setPendingProjectId(projectId)
    kmzFileRef.current?.click()
  }

  function triggerPdfUpload(projectId: string) {
    setPendingPdfProjectId(projectId)
    pdfFileRef.current?.click()
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const projectId = pendingProjectId
    if (!file || !projectId) return
    e.target.value = ''

    setImporting(projectId)
    setImportMsg((m) => ({ ...m, [projectId]: `Parsing ${file.name}…` }))

    try {
      const result = await parseKmzOrKml(file)
      addKmzUpload(
        { projectId, fileName: file.name, uploadedAt: new Date().toISOString(), featureCount: result.featureCount },
        result.features,
      )
      setImportMsg((m) => ({ ...m, [projectId]: `✓ ${result.featureCount} features imported from ${file.name}` }))
    } catch (err) {
      setImportMsg((m) => ({ ...m, [projectId]: `Error: ${(err as Error).message}` }))
    } finally {
      setImporting(null)
    }
  }

  async function onPdfFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const projectId = pendingPdfProjectId
    if (!file || !projectId) return
    e.target.value = ''

    setUploadingPdf(projectId)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })
      addProjectFile({
        projectId,
        name: file.name,
        fileType: 'pdf',
        size: file.size,
        uploadedAt: new Date().toISOString(),
        dataUrl,
      })
    } catch (err) {
      alert(`Upload failed: ${(err as Error).message}`)
    } finally {
      setUploadingPdf(null)
    }
  }


  function openPdf(projectIdForFile: string, fileId: string) {
    nav(`/kmz/${projectIdForFile}/print/${fileId}`)
  }

  function confirmDelete(uploadId: string) {
    if (confirm('Delete this KMZ import and all its features? This cannot be undone.')) {
      deleteKmzUpload(uploadId)
    }
  }

  async function handleExportProject(projId: string, projName: string) {
    const projFeatures = (data.mapFeatures ?? []).filter((f) => f.projectId === projId)
    if (!projFeatures.length) return
    setExporting(projId)
    try {
      const blob = await exportFeaturesToKmz(projFeatures, projName)
      triggerDownload(blob, projName.replace(/\s+/g, '_') + '.kmz')
      window.open('https://www.google.com/mymaps', '_blank', 'noopener')
    } finally {
      setExporting(null)
    }
  }

  async function handleExportUpload(uploadId: string, uploadFileName: string, projName: string, openGoogle: boolean) {
    const uploadFeatures = (data.mapFeatures ?? []).filter((f) => f.kmzUploadId === uploadId)
    if (!uploadFeatures.length) return
    setExporting(uploadId)
    try {
      const blob = await exportFeaturesToKmz(uploadFeatures, projName)
      triggerDownload(blob, uploadFileName.replace(/\.km[lz]$/i, '') + '_export.kmz')
      if (openGoogle) window.open('https://www.google.com/mymaps', '_blank', 'noopener')
    } finally {
      setExporting(null)
    }
  }

  // ── Crew-based filtering for field users ─────────────────────────────────
  const myCrewIds = isAdmin ? new Set<string>() : employeeCrewIds(data, activeEmployeeId)

  const allActiveProjects = data.projects.filter((p) => p.status !== 'complete')

  // A project is visible via its explicit assignment list OR because a print
  // (or a phase of one) has been assigned to this crew/subcontractor — see
  // projectAssignedToSubcontractor/projectAssignedToCrew's doc comment for
  // why the two can disagree (admin cut+assigned a phase but never touched
  // the separate Crew & Subcontractor Assignment checklist on the Project page).
  const projects = isAdmin
    ? allActiveProjects
    : role === 'subcontractor'
    ? allActiveProjects.filter((p) => (p.subcontractorIds ?? []).includes(activeSubcontractorId ?? '')
        || (activeSubcontractorId != null && projectAssignedToSubcontractor(p.id, activeSubcontractorId, data.projectFiles ?? [], data.mapCutPackages ?? [])))
    : allActiveProjects.filter((p) =>
        myCrewIds.size > 0 &&
        (
          [...myCrewIds].some((cid) => (p.crewIds ?? []).includes(cid)) ||
          [...myCrewIds].some((cid) => data.crews.find((c) => c.id === cid)?.currentProjectId === p.id) ||
          [...myCrewIds].some((cid) => projectAssignedToCrew(p.id, cid, data.projectFiles ?? [], data.mapCutPackages ?? []))
        )
      )

  const noCrewWarning = role === 'field' && myCrewIds.size === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Field Maps"
        description={isAdmin
          ? 'Import KMZ/KML files to create live job maps. Crews click features to log production, photos, and status.'
          : role === 'subcontractor'
          ? 'Projects your company is assigned to. Tap Field Map to open and submit your work.'
          : 'Your assigned job maps. Tap Field Map to open and log production.'}
      />

      {noCrewWarning && (
        <Card className="py-12 text-center">
          <UserX size={32} className="mx-auto mb-3 opacity-40 text-slate-500" />
          <p className="text-sm font-medium text-slate-400 mb-1">No crew assignment found</p>
          <p className="text-xs text-slate-400">
            {activeEmployeeId
              ? 'Your employee profile has no default crew assigned. Ask your supervisor to assign you to a crew.'
              : 'No employee profile selected. Switch to Admin to set your crew assignment.'}
          </p>
        </Card>
      )}

      {!noCrewWarning && projects.length === 0 && (
        <Card className="py-16 text-center">
          <MapPin size={36} className="mx-auto mb-3 opacity-30 text-slate-500" />
          <p className="text-sm text-slate-500">
            {isAdmin
              ? 'No active projects — create a project first, then import a KMZ.'
              : role === 'subcontractor'
              ? 'No projects are assigned to your company right now — an admin can assign one from the Project page.'
              : 'No field maps are assigned to your crew right now.'}
          </p>
        </Card>
      )}

      {!noCrewWarning && <div className="space-y-4">
        {projects.map((proj) => {
          const uploads = (data.kmzUploads ?? []).filter((u) => u.projectId === proj.id)
          const features = (data.mapFeatures ?? []).filter((f) => f.projectId === proj.id)
          const pdfs    = (data.projectFiles ?? []).filter((f) => f.projectId === proj.id && f.fileType === 'pdf'
            && !isPrintHiddenFromSession(f, data.mapCutPackages ?? [], role, activeSubcontractorId, myCrewIds))
          const isExpanded = !!expanded[proj.id]

          // Group phase pieces under their master print, same visual language
          // as ProjectDetail.tsx's Project Files table — a flat row of 4+
          // same-prefixed filenames (master + Phase 1/2/3 pieces) reads as
          // clutter, not structure. Scoped to whichever master/phase pairs
          // are BOTH still present in `pdfs` (the already role-filtered
          // list) — for a field/subcontractor session the master is always
          // hidden (see isPrintHiddenFromSession), so this naturally falls
          // back to the old flat single-file row for them with no extra
          // role check needed; only a session that can see a master
          // alongside its phases (admin/supervisor) ever sees the grouped view.
          const pdfIds = new Set(pdfs.map((f) => f.id))
          const packagesByMasterId = new Map<string, MapCutPackage[]>()
          for (const pkg of data.mapCutPackages ?? []) {
            if (pkg.projectId !== proj.id || !pkg.sourceProjectFileId) continue
            if (!pdfIds.has(pkg.sourceProjectFileId)) continue
            if (!pdfs.some((f) => f.sourceMapCutPackageId === pkg.id)) continue
            const arr = packagesByMasterId.get(pkg.sourceProjectFileId) ?? []
            arr.push(pkg)
            packagesByMasterId.set(pkg.sourceProjectFileId, arr)
          }
          const groupedPieceIds = new Set(
            [...packagesByMasterId.values()].flat()
              .map((pkg) => pdfs.find((f) => f.sourceMapCutPackageId === pkg.id)?.id)
              .filter((id): id is string => !!id),
          )
          const standalonePdfs = pdfs.filter((f) => !packagesByMasterId.has(f.id) && !groupedPieceIds.has(f.id))
          const masterPdfsWithPhases = pdfs.filter((f) => packagesByMasterId.has(f.id))

          const assignedCrews = (data.crews ?? []).filter((c) => (proj.crewIds ?? []).includes(c.id))
          const assignedSubs = (data.subcontractors ?? []).filter((s) => (proj.subcontractorIds ?? []).includes(s.id))

          const statusCounts = STATUS_ORDER.reduce((acc, s) => {
            acc[s] = features.filter((f) => f.status === s).length
            return acc
          }, {} as Record<FeatureStatus, number>)

          const totalFt = features.reduce((s, f) => s + (f.calculatedLengthFt ?? 0), 0)
          const doneFt  = features
            .filter((f) => f.status === 'complete')
            .reduce((s, f) => s + (f.calculatedLengthFt ?? 0), 0)
          const pct = totalFt > 0 ? Math.round((doneFt / totalFt) * 100) : 0

          return (
            <Card key={proj.id} className="overflow-hidden !p-0">
              {/* Project header row */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800 truncate">{proj.name}</span>
                    <Badge tone={proj.status === 'active' ? 'green' : 'slate'}>
                      {proj.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{proj.location} · {proj.client}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isAdmin && (
                    <button
                      onClick={() => triggerUpload(proj.id)}
                      disabled={importing === proj.id}
                      className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition"
                    >
                      <Upload size={12} /> {importing === proj.id ? 'Importing…' : 'Import KMZ'}
                    </button>
                  )}
                  <button
                    onClick={() => setExpanded((e) => ({ ...e, [proj.id]: !e[proj.id] }))}
                    className="rounded p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition"
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
              </div>

              {/* Assigned crews/subs — admin-only quick reference so "who's on this
                  job" doesn't require a trip to the Project page. Mirrors the same
                  Project.crewIds/subcontractorIds explicit-assignment list shown
                  there, not the phase-level print assignment below. */}
              {isAdmin && (
                <div className="flex items-center gap-1.5 flex-wrap px-4 py-2 border-b border-slate-100 bg-slate-50/60">
                  <Users size={12} className="text-slate-400 shrink-0" />
                  {assignedCrews.length === 0 && assignedSubs.length === 0 ? (
                    <span className="text-[11px] text-slate-400">No crews or subcontractors assigned</span>
                  ) : (
                    <>
                      {assignedCrews.map((c) => (
                        <span key={c.id} className="flex items-center gap-1 rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          <HardHat size={10} className="text-brand-500" /> {c.name}
                        </span>
                      ))}
                      {assignedSubs.map((s) => (
                        <span key={s.id} className="flex items-center gap-1 rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          <HardHat size={10} className="text-amber-500" /> {s.companyName}
                        </span>
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* Map option buttons */}
              {features.length > 0 && (
                <div className="flex items-stretch border-b border-slate-100">
                  <button
                    onClick={() => nav(`/kmz/${proj.id}`)}
                    className="flex flex-1 items-center justify-center gap-2 py-2.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-500 transition border-r border-slate-100"
                  >
                    <MapPin size={13} />
                    Field Map
                  </button>

                  <button
                    onClick={() => handleExportProject(proj.id, proj.name)}
                    disabled={exporting === proj.id}
                    className="flex flex-1 items-center justify-center gap-2 py-2.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 transition"
                  >
                    <Globe size={13} />
                    {exporting === proj.id ? 'Preparing…' : 'Google Maps'}
                  </button>
                </div>
              )}

              {/* Import message */}
              {importMsg[proj.id] && (
                <div className={`px-4 py-1.5 text-xs border-b border-slate-100 ${
                  importMsg[proj.id].startsWith('✓') ? 'text-emerald-600' :
                  importMsg[proj.id].startsWith('Error') ? 'text-red-600' : 'text-slate-400'
                }`}>
                  {importMsg[proj.id]}
                </div>
              )}

              {/* Quick stats */}
              {features.length > 0 && (
                <div className="px-4 py-2 flex items-center gap-4 flex-wrap">
                  <span className="text-xs text-slate-500">
                    <strong className="text-slate-600">{features.length}</strong> features
                    {totalFt > 0 && <> · <strong className="text-slate-600">{totalFt.toLocaleString()}</strong> ft total</>}
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {STATUS_ORDER.filter((s) => statusCounts[s] > 0).map((s) => (
                      <span key={s} className="flex items-center gap-1 text-[11px]">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: FEATURE_STATUS_META[s].color }}
                        />
                        <span className="text-slate-400">{statusCounts[s]} {FEATURE_STATUS_META[s].label}</span>
                      </span>
                    ))}
                  </div>
                  {totalFt > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-32 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-400">{pct}% complete</span>
                    </div>
                  )}
                </div>
              )}

              {/* PDF Prints — always visible. Standalone prints stay a flat chip
                  row; a print that's been cut into phases gets its own block
                  below with the master chip on top and its phases (colored to
                  match Map Cuts' own phase strip) grouped underneath it. */}
              <div className="border-t border-slate-100 px-4 py-2.5 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <FileText size={13} className="text-amber-600" />
                    <span className="text-xs font-medium text-slate-400">
                      {pdfs.length === 0 ? 'No prints' : `${pdfs.length} PDF${pdfs.length === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  {standalonePdfs.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center gap-0.5 rounded-md border border-slate-300 bg-white py-1 pl-2.5 pr-1 text-[11px] font-medium text-slate-600"
                    >
                      <button
                        onClick={() => openPdf(proj.id, f.id)}
                        className="flex items-center gap-1.5 hover:text-slate-900 transition"
                        title={`Open ${f.name}`}
                      >
                        <FileText size={11} className="text-amber-600 shrink-0" />
                        <span className="max-w-[160px] truncate">{f.name}</span>
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => nav('/map-cuts', { state: { projectId: proj.id, existingFileId: f.id } })}
                          title={`Map Cut ${f.name}`}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-amber-600 transition"
                        >
                          <Scissors size={11} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => triggerPdfUpload(proj.id)}
                    disabled={uploadingPdf === proj.id}
                    className="flex items-center gap-1.5 rounded-md border border-emerald-200 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 transition"
                  >
                    <Upload size={11} />
                    {uploadingPdf === proj.id ? 'Uploading…' : 'Upload PDF'}
                  </button>
                </div>

                {masterPdfsWithPhases.map((master) => {
                  const phases = (packagesByMasterId.get(master.id) ?? [])
                    .slice()
                    .sort((a, b) => (a.phaseNumber ?? 0) - (b.phaseNumber ?? 0))
                  return (
                    <div key={master.id} className="rounded-md border border-slate-200 bg-slate-50/60 p-2">
                      <div className="flex items-center gap-0.5 rounded-md border border-slate-300 bg-white py-1 pl-2.5 pr-1 text-[11px] font-medium text-slate-600 w-fit">
                        <button
                          onClick={() => openPdf(proj.id, master.id)}
                          className="flex items-center gap-1.5 hover:text-slate-900 transition"
                          title={`Open ${master.name}`}
                        >
                          <FileText size={11} className="text-amber-600 shrink-0" />
                          <span className="max-w-[220px] truncate">{master.name}</span>
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => nav('/map-cuts', { state: { projectId: proj.id, existingFileId: master.id } })}
                            title={`Map Cut ${master.name}`}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-amber-600 transition"
                          >
                            <Scissors size={11} />
                          </button>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 pl-3 border-l-2 border-slate-200">
                        {phases.map((pkg) => {
                          const piece = pdfs.find((f) => f.sourceMapCutPackageId === pkg.id)
                          if (!piece) return null
                          const color = phaseColor(pkg.phaseNumber)
                          return (
                            <div
                              key={pkg.id}
                              className="flex items-center gap-1 rounded-md border py-0.5 pl-2 pr-1 text-[11px] font-medium"
                              style={{ borderColor: `${color}55`, background: `${color}14` }}
                            >
                              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
                              <button
                                onClick={() => openPdf(proj.id, piece.id)}
                                className="flex items-center gap-1 hover:text-slate-900 transition"
                                title={`Open ${piece.name}`}
                              >
                                <span className="font-semibold" style={{ color }}>Phase {pkg.phaseNumber ?? '?'}</span>
                              </button>
                              {isAdmin && (
                                <button
                                  onClick={() => nav('/map-cuts', { state: { projectId: proj.id, existingFileId: piece.id } })}
                                  title={`Map Cut ${piece.name}`}
                                  className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-amber-600 transition"
                                >
                                  <Scissors size={10} />
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Expanded section */}
              {isExpanded && (
                <>
                  {/* KMZ uploads */}
                  <div className="border-t border-slate-100 px-4 py-3 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                      <Layers size={11} /> KMZ Imports
                    </p>
                    {uploads.length === 0 ? (
                      <p className="text-xs text-slate-400">No KMZ files imported yet for this project.</p>
                    ) : (
                      uploads.map((u) => {
                        const uFeatures = features.filter((f) => f.kmzUploadId === u.id)
                        const layers = [...new Set(uFeatures.map((f) => f.layerName))]
                        return (
                          <div key={u.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <Layers size={12} className="text-slate-500 shrink-0" />
                                  <span className="text-xs font-medium text-slate-800">{u.fileName}</span>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-0.5">
                                  {new Date(u.uploadedAt).toLocaleString()} ·{' '}
                                  <strong>{u.featureCount}</strong> features ·{' '}
                                  {layers.length} layer{layers.length !== 1 ? 's' : ''}
                                </p>
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {layers.map((l) => (
                                    <span key={l} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">
                                      {l}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => handleExportUpload(u.id, u.fileName, proj.name, false)}
                                  disabled={exporting === u.id}
                                  className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-slate-800 hover:bg-slate-50 disabled:opacity-40 transition"
                                  title="Download KMZ with current status colors"
                                >
                                  <Download size={11} /> KMZ
                                </button>
                                <button
                                  onClick={() => handleExportUpload(u.id, u.fileName, proj.name, true)}
                                  disabled={exporting === u.id}
                                  className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40 transition"
                                  title="Download KMZ then open Google My Maps"
                                >
                                  <Globe size={11} /> Google Maps
                                </button>
                                {isAdmin && (
                                  <button
                                    onClick={() => confirmDelete(u.id)}
                                    className="rounded p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                                    title="Delete this import"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="mt-2 flex items-center gap-3 flex-wrap">
                              {STATUS_ORDER.map((s) => {
                                const n = uFeatures.filter((f) => f.status === s).length
                                if (!n) return null
                                const Icon = s === 'complete'    ? CheckCircle
                                           : s === 'issue'       ? AlertCircle
                                           : s === 'in_progress' ? Clock
                                           : null
                                return (
                                  <span key={s} className="flex items-center gap-1 text-[11px]" style={{ color: FEATURE_STATUS_META[s].color }}>
                                    {Icon && <Icon size={10} />}
                                    {n} {FEATURE_STATUS_META[s].label}
                                  </span>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>

                </>
              )}
            </Card>
          )
        })}
      </div>}

      <input ref={kmzFileRef} type="file" accept=".kmz,.kml" className="hidden" onChange={onFile} />
      <input ref={pdfFileRef} type="file" accept=".pdf"       className="hidden" onChange={onPdfFile} />
    </div>
  )
}
