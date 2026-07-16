import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Upload, Download, Printer, Save, ExternalLink, Trash2, Loader2, FolderOpen, Layers, Zap } from 'lucide-react'
import { useData } from '../store/DataContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Button, Field, Input, Select, Textarea } from '../components/ui/Form'
import { PdfViewport } from '../components/mapcuts/PdfViewport'
import { GridCutViewport } from '../components/mapcuts/GridCutViewport'
import { getPdfPageCount } from '../lib/mapCuts/render'
import { gridSelectionToBoxes } from '../lib/mapCuts/geometry'
import { buildMapCutPdf } from '../lib/mapCuts/pdfBuilder'
import { phaseColor } from '../lib/mapCuts/phaseColors'
import { loadBlob } from '../lib/fileStore'
import { localDateStr } from '../lib/format'
import type { MapCutPackage, MapCutStyle, MapCutPageSize, GridCellSelection } from '../types'

const PHASE_SLOTS = Array.from({ length: 10 }, (_, i) => i + 1)

function phaseNumberOf(p: MapCutPackage): number {
  return p.phaseNumber ?? 1
}

function emptyGridSelection(rows: number, cols: number): GridCellSelection {
  return { rows, cols, selectedOrder: {}, merges: [] }
}

function baseName(name: string): string {
  return name.replace(/\.pdf$/i, '')
}

function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

async function blobFromDataUrl(dataUrl: string, name: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob()
  return new File([blob], name, { type: 'application/pdf' })
}

const PAGE_SIZE_LABELS: Record<MapCutPageSize, string> = {
  '11x17': '11 × 17 in (ANSI B)',
  '8.5x11': '8.5 × 11 in',
  legal: 'Legal (8.5 × 14 in)',
  ansiC: 'ANSI C (17 × 22 in)',
  ansiD: 'ANSI D (22 × 34 in)',
  custom: 'Custom',
}

const DPI_OPTIONS = [300, 600, 1200] as const

export function MapCuts() {
  const { data, addMapCutPackage, updateMapCutPackage, deleteMapCutPackage, addProjectFile, deleteProjectFile } = useData()
  const nav = useNavigate()
  const location = useLocation()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [projectId, setProjectId] = useState('')
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [loadingSource, setLoadingSource] = useState(false)
  const [activePkgId, setActivePkgId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generatedPdf, setGeneratedPdf] = useState<{ blob: Blob; pageCount: number } | null>(null)
  const [error, setError] = useState('')
  const [batchStatus, setBatchStatus] = useState('')
  // Quick regenerate — an already-cut phase just needs its output resolution
  // (or image format) bumped and re-saved; the full Steps 1-4 workspace
  // (project/file picker, grid/box editor, phase strip) is a lot of UI to
  // wade through for a one-field change, and confusingly implies the boxes
  // themselves need re-picking. This mode skips straight to a single compact
  // panel with just the output settings + a "Regenerate & Save" button,
  // reusing the already-picked boxes untouched. See the Zap icon in the
  // Saved cut packages sidebar.
  const [quickMode, setQuickMode] = useState(false)
  const [quickRegenStatus, setQuickRegenStatus] = useState('')

  const pkg = activePkgId ? data.mapCutPackages.find((p) => p.id === activePkgId) ?? null : null
  const gridSelection = pkg?.gridSelection ?? emptyGridSelection(pkg?.gridRows ?? 3, pkg?.gridCols ?? 3)
  const gridMergedCellIds = new Set(gridSelection.merges.flat())
  const gridOutputCount = gridSelection.merges.length
    + Object.keys(gridSelection.selectedOrder).filter((id) => !gridMergedCellIds.has(id)).length
  const project = projectId ? data.projects.find((p) => p.id === projectId) ?? null : null
  const projectFiles = projectId ? data.projectFiles.filter((f) => f.projectId === projectId && f.fileType === 'pdf') : []
  const savedPackages = projectId ? data.mapCutPackages.filter((p) => p.projectId === projectId) : []

  // Every package sharing this print's source file — the "phases" of one
  // master print, authored in one continuous session via the Phase strip
  // below. Sorted so the strip and any downstream summary reads Phase 1..N.
  const phaseFamily = pkg
    ? data.mapCutPackages
        .filter((p) => p.projectId === projectId && p.sourceProjectFileId === pkg.sourceProjectFileId)
        .sort((a, b) => phaseNumberOf(a) - phaseNumberOf(b))
    : []

  // Other phases' picks, ghosted underneath the active phase's own editor —
  // Grid Cut only ghosts a phase sharing the exact same rows/cols (ghosting
  // a mismatched grid has no sensible geometry); Manual Cut ghosts any other
  // phase's finalized boxes regardless of how they were authored.
  const otherGridPhases = pkg
    ? phaseFamily
        .filter((p) => p.id !== pkg.id && (p.gridRows ?? 3) === (pkg.gridRows ?? 3) && (p.gridCols ?? 3) === (pkg.gridCols ?? 3))
        .map((p) => ({
          color: phaseColor(p.phaseNumber),
          label: `P${phaseNumberOf(p)}`,
          selection: p.gridSelection ?? emptyGridSelection(p.gridRows ?? 3, p.gridCols ?? 3),
        }))
    : []
  const otherManualPhaseBoxes = pkg
    ? phaseFamily
        .filter((p) => p.id !== pkg.id && p.boxes.length > 0)
        .map((p) => ({ color: phaseColor(p.phaseNumber), label: `P${phaseNumberOf(p)}`, boxes: p.boxes }))
    : []

  function resetSession() {
    setSourceFile(null)
    setActivePkgId(null)
    setGeneratedPdf(null)
    setBatchStatus('')
    setError('')
    setQuickMode(false)
    setQuickRegenStatus('')
  }

  // Entry point from the Field Map's Prints bar (admin-only "Map Cut" icon on
  // a print chip, KmzMap.tsx) — pre-scopes straight into that project+file
  // instead of making the admin re-pick from scratch. Reuses the exact same
  // project/file-selection handlers a manual visit to this page already uses.
  useEffect(() => {
    const st = location.state as { projectId?: string; existingFileId?: string } | null
    if (!st?.projectId || !st?.existingFileId) return
    handleProjectChange(st.projectId)
    void handlePickExisting(st.existingFileId)
    // Consume the state so navigating back here later (or reloading) doesn't re-trigger it.
    nav(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleProjectChange(id: string) {
    setProjectId(id)
    resetSession()
  }

  async function beginWithSourceFile(file: File, projectFileId: string, name: string) {
    setQuickMode(false)
    setError('')
    setGeneratedPdf(null)
    setSourceFile(file)
    setActivePkgId(null)
    setLoadingSource(true)
    try {
      const count = await getPdfPageCount(file)
      setPageCount(count)
      const created = addMapCutPackage({
        name: `${baseName(name)} cuts`,
        projectId,
        sourceProjectFileId: projectFileId,
        sourceFileName: name,
        sourcePageIndex: 1,
        cutStyle: 'grid',
        pageSize: '8.5x11',
        gridRows: 3,
        gridCols: 3,
        overlapPct: 15,
        boxes: [],
        gridDirty: false,
        outputFileName: `${baseName(name)}_cuts.pdf`,
        outputDpi: 300,
        losslessOutput: false,
        phaseNumber: 1,
      })
      setActivePkgId(created.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load PDF')
    } finally {
      setLoadingSource(false)
    }
  }

  // Switches the active phase, creating a new package for slot n if this is
  // the first time it's been clicked. sourceFile (the loaded PDF) never
  // changes here — every phase shares one master print — so this is instant,
  // no reload. New phases inherit the current phase's cut style / grid /
  // overlap / page size / DPI so the user sets those once, not per phase.
  function switchToPhase(n: number) {
    if (!pkg) return
    const existing = phaseFamily.find((p) => phaseNumberOf(p) === n)
    setGeneratedPdf(null)
    setBatchStatus('')
    setError('')
    if (existing) {
      setActivePkgId(existing.id)
      return
    }
    const created = addMapCutPackage({
      name: `${baseName(pkg.sourceFileName)} — Phase ${n}`,
      projectId,
      sourceProjectFileId: pkg.sourceProjectFileId,
      sourceFileName: pkg.sourceFileName,
      sourcePageIndex: pkg.sourcePageIndex,
      cutStyle: pkg.cutStyle,
      pageSize: pkg.pageSize,
      customWidthIn: pkg.customWidthIn,
      customHeightIn: pkg.customHeightIn,
      gridRows: pkg.gridRows,
      gridCols: pkg.gridCols,
      overlapPct: pkg.overlapPct,
      boxes: [],
      gridDirty: false,
      outputFileName: `${baseName(pkg.sourceFileName)}_phase${n}.pdf`,
      outputDpi: pkg.outputDpi,
      losslessOutput: pkg.losslessOutput,
      phaseNumber: n,
    })
    setActivePkgId(created.id)
  }

  async function handlePickExisting(fileId: string) {
    if (!fileId) return
    const meta = data.projectFiles.find((f) => f.id === fileId)
    const dataUrl = await loadBlob(fileId)
    if (!dataUrl || !meta) { setError('Could not load that file.'); return }
    const file = await blobFromDataUrl(dataUrl, meta.name)
    await beginWithSourceFile(file, fileId, meta.name)
  }

  async function handleUploadNew(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file || !projectId) return
    setError('')
    try {
      // Persisted immediately (as a normal project document) so the source PDF survives
      // a refresh or "reopen and edit" later — the original file itself is never modified.
      const dataUrl = await fileToDataUrl(file)
      const newFileId = addProjectFile({
        projectId, name: file.name, fileType: 'pdf', size: file.size,
        uploadedAt: localDateStr(), dataUrl,
      })
      await beginWithSourceFile(file, newFileId, file.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to upload PDF')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handlePageChange(newPage: number) {
    if (!sourceFile || !pkg) return
    if (pkg.boxes.length > 0 && !confirm('Switching pages clears your current cut boxes. Continue?')) return
    setError('')
    setGeneratedPdf(null)
    updateMapCutPackage(pkg.id, { sourcePageIndex: newPage, boxes: [], gridSelection: undefined })
  }

  async function openPackage(p: MapCutPackage, opts?: { quick?: boolean }) {
    setError('')
    setGeneratedPdf(null)
    setQuickRegenStatus('')
    setQuickMode(!!opts?.quick)
    setProjectId(p.projectId)
    if (!p.sourceProjectFileId) { setError('This package has no recoverable source file.'); return }
    setLoadingSource(true)
    try {
      const dataUrl = await loadBlob(p.sourceProjectFileId)
      if (!dataUrl) { setError('The original source PDF is missing from project documents.'); return }
      const file = await blobFromDataUrl(dataUrl, p.sourceFileName)
      setSourceFile(file)
      const count = await getPdfPageCount(file)
      setPageCount(count)
      setActivePkgId(p.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reopen this cut package')
    } finally {
      setLoadingSource(false)
    }
  }

  function handleDeletePackage(p: MapCutPackage) {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return
    deleteMapCutPackage(p.id)
    if (activePkgId === p.id) resetSession()
  }

  function renamePackage(p: MapCutPackage) {
    const name = prompt('Rename this cut package', p.name)
    if (name && name.trim()) updateMapCutPackage(p.id, { name: name.trim() })
  }

  function setCutStyle(style: MapCutStyle) {
    if (!pkg) return
    if (style === 'manual') {
      if (pkg.boxes.length > 0 && !confirm('Switching to Manual Box Cut clears the current boxes. Continue?')) return
      updateMapCutPackage(pkg.id, { cutStyle: 'manual', boxes: [], gridSelection: undefined })
    } else if (style === 'grid') {
      updateMapCutPackage(pkg.id, { cutStyle: 'grid' })
    }
  }

  function handleCreateCuts() {
    if (!pkg) return
    const boxes = gridSelectionToBoxes(gridSelection)
    updateMapCutPackage(pkg.id, { boxes })
  }

  async function handleGenerate() {
    if (!pkg || !sourceFile) return
    if (pkg.boxes.length === 0) { setError('Draw or generate at least one cut box first.'); return }
    setError('')
    setGenerating(true)
    try {
      const { pdf, pageCount: n } = await buildMapCutPdf(pkg, sourceFile, pkg.projectNameOverride || project?.name || 'Project')
      const blob = pdf.output('blob')
      setGeneratedPdf({ blob, pageCount: n })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate the PDF')
    } finally {
      setGenerating(false)
    }
  }

  function handleDownload() {
    if (!generatedPdf || !pkg) return
    const url = URL.createObjectURL(generatedPdf.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = pkg.outputFileName || 'map-cuts.pdf'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handlePrint() {
    if (!generatedPdf) return
    const url = URL.createObjectURL(generatedPdf.blob)
    window.open(url, '_blank')
  }

  async function handleSaveToProject() {
    if (!generatedPdf || !pkg) return
    try {
      const dataUrl = await fileToDataUrl(generatedPdf.blob)
      // Re-saving an already-saved phase (e.g. after bumping outputDpi to
      // sharpen it) must REPLACE its file, not sit alongside it — addProjectFile
      // always mints a fresh id, so without this the old, lower-DPI file would
      // stick around orphaned: still assigned (via the package's default),
      // still visible to whoever it was assigned to, alongside the new one.
      // Redlines are unaffected either way — they're stored on the MASTER
      // file (see boxTransform.ts's doc comment) and re-projected onto
      // whichever piece is open, so swapping which file backs a phase never
      // moves them. Per-piece overrides (a direct crew/sub assignment, or a
      // manually-set page scale) DO live on the file record itself, though —
      // carry those forward so a regenerate-for-quality pass doesn't silently
      // reset them to the phase default.
      const previousFile = pkg.outputProjectFileId ? data.projectFiles.find((f) => f.id === pkg.outputProjectFileId) : null
      const newFileId = addProjectFile({
        projectId: pkg.projectId,
        name: pkg.outputFileName || 'map-cuts.pdf',
        fileType: 'pdf',
        size: generatedPdf.blob.size,
        uploadedAt: localDateStr(),
        dataUrl,
        sourceMapCutPackageId: pkg.id,
        assignedCrewId: previousFile?.assignedCrewId ?? null,
        assignedSubcontractorId: previousFile?.assignedSubcontractorId ?? null,
        pdfScaleFeetPerInch: previousFile?.pdfScaleFeetPerInch,
      })
      updateMapCutPackage(pkg.id, { outputProjectFileId: newFileId })
      if (previousFile) deleteProjectFile(previousFile.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save to project documents')
    }
  }

  // The quick-regenerate panel's one-click action — builds off the CURRENT
  // boxes (untouched) at whatever output resolution/format was just picked,
  // then saves straight to Project Documents in one step. Deliberately not
  // built on top of handleGenerate()+handleSaveToProject(): those are two
  // separate handlers that each close over their own render's `generatedPdf`,
  // so calling one right after the other here would read a stale (still
  // null) value instead of the just-built PDF. Duplicates a little of
  // handleSaveToProject's file-replacement logic instead of fighting that.
  async function handleQuickRegenerate() {
    if (!pkg || !sourceFile) return
    if (pkg.boxes.length === 0) { setError('This phase has no cut boxes saved — open the full editor to draw some first.'); return }
    setError('')
    setQuickRegenStatus('')
    setGenerating(true)
    try {
      const { pdf } = await buildMapCutPdf(pkg, sourceFile, pkg.projectNameOverride || project?.name || 'Project')
      const blob = pdf.output('blob')
      const dataUrl = await fileToDataUrl(blob)
      const previousFile = pkg.outputProjectFileId ? data.projectFiles.find((f) => f.id === pkg.outputProjectFileId) : null
      const newFileId = addProjectFile({
        projectId: pkg.projectId,
        name: pkg.outputFileName || 'map-cuts.pdf',
        fileType: 'pdf',
        size: blob.size,
        uploadedAt: localDateStr(),
        dataUrl,
        sourceMapCutPackageId: pkg.id,
        assignedCrewId: previousFile?.assignedCrewId ?? null,
        assignedSubcontractorId: previousFile?.assignedSubcontractorId ?? null,
        pdfScaleFeetPerInch: previousFile?.pdfScaleFeetPerInch,
      })
      updateMapCutPackage(pkg.id, { outputProjectFileId: newFileId })
      if (previousFile) deleteProjectFile(previousFile.id)
      setQuickRegenStatus(`Saved — regenerated at ${pkg.outputDpi ?? 300} DPI. Redlines and assignment are unchanged.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to regenerate')
    } finally {
      setGenerating(false)
    }
  }

  // Builds and saves every phase in this print's phase family in one pass —
  // "phase it out, then generate it back to the project file, one per
  // phase." Deliberately doesn't require "Create Cuts" to have been clicked
  // on every grid-style phase first: whatever cells are currently picked get
  // converted to boxes here, so nothing needs re-clicking per phase.
  async function handleGenerateAllPhases() {
    if (!pkg || !sourceFile) return
    setError('')
    setBatchStatus('')

    const effectivePhases = phaseFamily
      .map((p) => ({
        pkg: p,
        effectiveBoxes: p.cutStyle === 'grid'
          ? gridSelectionToBoxes(p.gridSelection ?? emptyGridSelection(p.gridRows ?? 3, p.gridCols ?? 3))
          : p.boxes,
      }))
      .filter(({ effectiveBoxes }) => effectiveBoxes.length > 0)

    if (effectivePhases.length === 0) { setError('No phase has any cut pages selected yet.'); return }

    const summary = effectivePhases
      .map(({ pkg: p, effectiveBoxes }) => `Phase ${phaseNumberOf(p)} — ${effectiveBoxes.length} page${effectiveBoxes.length === 1 ? '' : 's'}`)
      .join('\n')
    if (!confirm(`Generate ${effectivePhases.length} phase${effectivePhases.length === 1 ? '' : 's'}?\n\n${summary}`)) return

    setGenerating(true)
    try {
      for (const { pkg: p, effectiveBoxes } of effectivePhases) {
        const { pdf } = await buildMapCutPdf({ ...p, boxes: effectiveBoxes }, sourceFile, p.projectNameOverride || project?.name || 'Project')
        const blob = pdf.output('blob')
        const dataUrl = await fileToDataUrl(blob)
        // Same replace-not-duplicate rule as handleSaveToProject above — a
        // phase re-run through "Generate All Phases" after a DPI bump must
        // swap out its old file, not leave a stale orphan sitting alongside it.
        const previousFile = p.outputProjectFileId ? data.projectFiles.find((f) => f.id === p.outputProjectFileId) : null
        const newFileId = addProjectFile({
          projectId: p.projectId,
          name: p.outputFileName || `phase-${phaseNumberOf(p)}-cuts.pdf`,
          fileType: 'pdf',
          size: blob.size,
          uploadedAt: localDateStr(),
          dataUrl,
          sourceMapCutPackageId: p.id,
          assignedCrewId: previousFile?.assignedCrewId ?? null,
          assignedSubcontractorId: previousFile?.assignedSubcontractorId ?? null,
          pdfScaleFeetPerInch: previousFile?.pdfScaleFeetPerInch,
        })
        updateMapCutPackage(p.id, { boxes: effectiveBoxes, outputProjectFileId: newFileId })
        if (previousFile) deleteProjectFile(previousFile.id)
      }
      setBatchStatus(`Generated and saved ${effectivePhases.length} phase${effectivePhases.length === 1 ? '' : 's'} to Project Documents.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate all phases')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Map Cuts"
        description="Slice one oversized plan sheet into a readable, multi-page field print package."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {quickMode && pkg && (
            <Card>
              <CardHeader title={`Quick regenerate — ${pkg.name}`} subtitle="Change the output resolution or image format and save, without touching the cut boxes" />
              <CardBody className="space-y-3">
                <Field label="Output resolution" hint="Each page renders directly from the source PDF at this DPI">
                  <Select value={pkg.outputDpi ?? 300} onChange={(e) => updateMapCutPackage(pkg.id, { outputDpi: Number(e.target.value) as 300 | 600 | 1200 })}>
                    {DPI_OPTIONS.map((d) => <option key={d} value={d}>{d} DPI</option>)}
                  </Select>
                </Field>
                <Field label="Image format">
                  <label className="flex h-9 items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={pkg.losslessOutput ?? false}
                      onChange={(e) => updateMapCutPackage(pkg.id, { losslessOutput: e.target.checked })} />
                    Lossless (PNG) — larger files, no compression artifacts
                  </label>
                </Field>
                <p className="text-xs text-slate-500">
                  {pkg.boxes.length} page{pkg.boxes.length === 1 ? '' : 's'} already cut — this only rebuilds the image at the settings above, the boxes themselves aren't touched.
                </p>
                {error && <p className="rounded-lg bg-rose-950/40 px-3 py-2 text-xs text-rose-400">{error}</p>}
                {quickRegenStatus && <p className="rounded-lg bg-emerald-950/40 px-3 py-2 text-xs text-emerald-400">{quickRegenStatus}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={handleQuickRegenerate} disabled={generating || pkg.boxes.length === 0}>
                    {generating ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {generating ? 'Regenerating…' : 'Regenerate & Save'}
                  </Button>
                  {pkg.outputProjectFileId && (
                    <Button type="button" variant="ghost" onClick={() => nav(`/kmz/${pkg.projectId}/print/${pkg.outputProjectFileId}`)}>
                      <ExternalLink size={14} /> Open in Print Mode
                    </Button>
                  )}
                  <Button type="button" variant="ghost" onClick={() => setQuickMode(false)}>Need to redraw the cut boxes? Open full editor</Button>
                </div>
              </CardBody>
            </Card>
          )}
          {!quickMode && <>
          {/* Step 1: project + source */}
          <Card>
            <CardHeader title="1. Choose a project and PDF" />
            <CardBody className="space-y-3">
              <Field label="Project">
                <Select value={projectId} onChange={(e) => handleProjectChange(e.target.value)}>
                  <option value="">Select a project…</option>
                  {data.projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>

              {projectId && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Use an existing project PDF" hint={projectFiles.length === 0 ? 'No PDFs on this project yet' : undefined}>
                    <Select defaultValue="" onChange={(e) => e.target.value && handlePickExisting(e.target.value)} disabled={projectFiles.length === 0}>
                      <option value="">Select a file…</option>
                      {projectFiles.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Or upload a new PDF">
                    <Button type="button" variant="secondary" className="w-full" onClick={() => fileInputRef.current?.click()}>
                      <Upload size={14} /> Upload PDF
                    </Button>
                    <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
                      onChange={(e) => handleUploadNew(e.target.files)} />
                  </Field>
                </div>
              )}

              {error && <p className="rounded-lg bg-rose-950/40 px-3 py-2 text-xs text-rose-400">{error}</p>}
            </CardBody>
          </Card>

          {/* Step 2: page + viewer + editor */}
          {sourceFile && pkg && (
            <Card>
              <CardHeader
                title="2. Pick a page and draw your cuts"
                action={
                  pageCount > 1 ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>Page</span>
                      <Select
                        value={pkg.sourcePageIndex}
                        onChange={(e) => handlePageChange(Number(e.target.value))}
                        className="!w-auto"
                      >
                        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </Select>
                      <span>of {pageCount}</span>
                    </div>
                  ) : undefined
                }
              />
              <CardBody className="space-y-4">
                {/* Phase strip — click a filled phase to switch to it (its
                    picks stay ghosted on screen while another phase is
                    active); click an empty slot to start a new phase that
                    inherits this phase's grid/overlap/page-size settings. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 text-xs text-slate-500">Phases:</span>
                  {PHASE_SLOTS.map((n) => {
                    const owner = phaseFamily.find((p) => phaseNumberOf(p) === n)
                    const isActive = owner?.id === pkg.id
                    const color = phaseColor(n)
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => switchToPhase(n)}
                        title={owner ? `Phase ${n}${owner.boxes.length ? ` — ${owner.boxes.length} page${owner.boxes.length === 1 ? '' : 's'}` : ''}` : `Start Phase ${n}`}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                          owner ? 'text-white' : 'border border-dashed border-[#3a3a3a] text-slate-500 hover:text-slate-300'
                        }`}
                        style={owner ? {
                          backgroundColor: color,
                          boxShadow: isActive ? `0 0 0 2px #0a0a0a, 0 0 0 4px ${color}` : undefined,
                        } : undefined}
                      >
                        {n}
                        {owner && owner.boxes.length > 0 ? ` · ${owner.boxes.length}` : ''}
                      </button>
                    )
                  })}
                </div>

                {/* Cut style + overlap */}
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Cut style">
                    <div className="flex overflow-hidden rounded-lg border border-[#2a2a2a]">
                      {(['grid', 'manual'] as MapCutStyle[]).map((s) => (
                        <button key={s} type="button" onClick={() => setCutStyle(s)}
                          className={`px-3 py-2 text-xs font-medium transition ${pkg.cutStyle === s ? 'bg-brand-600 text-white' : 'bg-[#1a1a1a] text-slate-400 hover:text-slate-200'}`}>
                          {s === 'grid' ? 'Grid Cut' : 'Manual Box Cut'}
                        </button>
                      ))}
                    </div>
                  </Field>

                  {pkg.cutStyle === 'grid' && (
                    <>
                      <Field label="Rows">
                        <Input type="number" min={1} max={10} value={pkg.gridRows ?? 3}
                          onChange={(e) => {
                            const rows = Math.max(1, Number(e.target.value))
                            updateMapCutPackage(pkg.id, { gridRows: rows, gridSelection: emptyGridSelection(rows, pkg.gridCols ?? 3) })
                          }}
                          className="!w-20" />
                      </Field>
                      <Field label="Columns">
                        <Input type="number" min={1} max={10} value={pkg.gridCols ?? 3}
                          onChange={(e) => {
                            const cols = Math.max(1, Number(e.target.value))
                            updateMapCutPackage(pkg.id, { gridCols: cols, gridSelection: emptyGridSelection(pkg.gridRows ?? 3, cols) })
                          }}
                          className="!w-20" />
                      </Field>
                    </>
                  )}

                  <Field label={`Overlap (${pkg.overlapPct}%)`}>
                    <input type="range" min={0} max={30} value={pkg.overlapPct}
                      onChange={(e) => updateMapCutPackage(pkg.id, { overlapPct: Number(e.target.value) })}
                      className="h-9 w-40" />
                  </Field>
                </div>

                {loadingSource ? (
                  <div className="flex h-64 items-center justify-center text-slate-500">
                    <Loader2 size={20} className="animate-spin" />
                  </div>
                ) : pkg.cutStyle === 'manual' ? (
                  <PdfViewport
                    file={sourceFile}
                    pageIndex={pkg.sourcePageIndex}
                    boxes={pkg.boxes}
                    onBoxesChange={(boxes) => updateMapCutPackage(pkg.id, { boxes })}
                    overlapPct={pkg.overlapPct}
                    activeColor={phaseColor(pkg.phaseNumber)}
                    otherPhaseBoxes={otherManualPhaseBoxes}
                  />
                ) : (
                  <>
                    <GridCutViewport
                      file={sourceFile}
                      pageIndex={pkg.sourcePageIndex}
                      rows={pkg.gridRows ?? 3}
                      cols={pkg.gridCols ?? 3}
                      selection={gridSelection}
                      onSelectionChange={(next) => updateMapCutPackage(pkg.id, { gridSelection: next })}
                      overlapPct={pkg.overlapPct}
                      activeColor={phaseColor(pkg.phaseNumber)}
                      otherPhases={otherGridPhases}
                    />
                    <Button type="button" onClick={handleCreateCuts} disabled={Object.keys(gridSelection.selectedOrder).length === 0}>
                      Create Cuts ({gridOutputCount} page{gridOutputCount === 1 ? '' : 's'})
                    </Button>
                  </>
                )}
              </CardBody>
            </Card>
          )}

          {/* Step 3: page size + title block details */}
          {pkg && (
            <Card>
              <CardHeader title="3. Output page & title block" />
              <CardBody className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Page size">
                    <Select value={pkg.pageSize} onChange={(e) => updateMapCutPackage(pkg.id, { pageSize: e.target.value as MapCutPageSize })}>
                      {(Object.keys(PAGE_SIZE_LABELS) as MapCutPageSize[]).map((s) => (
                        <option key={s} value={s}>{PAGE_SIZE_LABELS[s]}</option>
                      ))}
                    </Select>
                  </Field>
                  {pkg.pageSize === 'custom' && (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Width (in)">
                        <Input type="number" min={1} value={pkg.customWidthIn ?? 11}
                          onChange={(e) => updateMapCutPackage(pkg.id, { customWidthIn: Number(e.target.value) })} />
                      </Field>
                      <Field label="Height (in)">
                        <Input type="number" min={1} value={pkg.customHeightIn ?? 8.5}
                          onChange={(e) => updateMapCutPackage(pkg.id, { customHeightIn: Number(e.target.value) })} />
                      </Field>
                    </div>
                  )}
                  <Field label="Scale (feet per inch on original page)" hint="Leave blank to omit the scale bar">
                    <Input type="number" min={0} value={pkg.scaleFeetPerInch ?? ''}
                      onChange={(e) => updateMapCutPackage(pkg.id, { scaleFeetPerInch: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </Field>
                  <Field label="Output resolution" hint="Each page renders directly from the source PDF at this DPI">
                    <Select value={pkg.outputDpi ?? 300} onChange={(e) => updateMapCutPackage(pkg.id, { outputDpi: Number(e.target.value) as 300 | 600 | 1200 })}>
                      {DPI_OPTIONS.map((d) => <option key={d} value={d}>{d} DPI</option>)}
                    </Select>
                  </Field>
                  <Field label="Image format">
                    <label className="flex h-9 items-center gap-2 text-xs text-slate-300">
                      <input type="checkbox" checked={pkg.losslessOutput ?? false}
                        onChange={(e) => updateMapCutPackage(pkg.id, { losslessOutput: e.target.checked })} />
                      Lossless (PNG) — larger files, no compression artifacts
                    </label>
                  </Field>
                  <Field label="Project name on title block">
                    <Input value={pkg.projectNameOverride ?? project?.name ?? ''}
                      onChange={(e) => updateMapCutPackage(pkg.id, { projectNameOverride: e.target.value })} />
                  </Field>
                  <Field label="Page title / road name">
                    <Input value={pkg.detectedTitle ?? ''}
                      onChange={(e) => updateMapCutPackage(pkg.id, { detectedTitle: e.target.value })} />
                  </Field>
                </div>
                <Field label="Notes">
                  <Textarea rows={2} value={pkg.notes ?? ''} onChange={(e) => updateMapCutPackage(pkg.id, { notes: e.target.value })} />
                </Field>
                <Field label="Production notes">
                  <Textarea rows={2} value={pkg.productionNotes ?? ''} onChange={(e) => updateMapCutPackage(pkg.id, { productionNotes: e.target.value })} />
                </Field>
              </CardBody>
            </Card>
          )}

          {/* Step 4: generate + output actions */}
          {pkg && (
            <Card>
              <CardHeader title="4. Generate & save" />
              <CardBody className="space-y-3">
                <Field label="Output file name">
                  <Input value={pkg.outputFileName} onChange={(e) => updateMapCutPackage(pkg.id, { outputFileName: e.target.value })} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={handleGenerate} disabled={generating || pkg.boxes.length === 0}>
                    {generating ? <Loader2 size={14} className="animate-spin" /> : null}
                    {generating ? 'Generating…' : `Generate (${pkg.boxes.length} page${pkg.boxes.length === 1 ? '' : 's'})`}
                  </Button>
                  {generatedPdf && (
                    <>
                      <Button type="button" variant="secondary" onClick={handleDownload}><Download size={14} /> Download</Button>
                      <Button type="button" variant="secondary" onClick={handlePrint}><Printer size={14} /> Print</Button>
                      <Button type="button" variant="secondary" onClick={handleSaveToProject}><Save size={14} /> Save to Project Documents</Button>
                    </>
                  )}
                  {pkg.outputProjectFileId && (
                    <Button type="button" variant="ghost" onClick={() => nav(`/kmz/${pkg.projectId}/print/${pkg.outputProjectFileId}`)}>
                      <ExternalLink size={14} /> Open in Print Mode
                    </Button>
                  )}
                </div>
                {phaseFamily.length > 1 && (
                  <div className="border-t border-[#2a2a2a] pt-3">
                    <Button type="button" variant="secondary" onClick={handleGenerateAllPhases} disabled={generating}>
                      {generating ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
                      {generating ? 'Generating…' : `Generate All Phases (${phaseFamily.length})`}
                    </Button>
                    <p className="mt-1.5 text-xs text-slate-500">
                      Builds every phase's PDF and saves each straight to Project Documents, grouped under this print.
                    </p>
                    {batchStatus && <p className="mt-1.5 text-xs text-emerald-400">{batchStatus}</p>}
                  </div>
                )}
                {generatedPdf && (
                  <p className="text-xs text-slate-500">
                    Generated {generatedPdf.pageCount} page{generatedPdf.pageCount === 1 ? '' : 's'}. Adjust anything above and click Generate again to regenerate.
                  </p>
                )}
              </CardBody>
            </Card>
          )}
          </>}
        </div>

        {/* Saved cut packages sidebar */}
        {projectId && (
          <Card className="h-fit">
            <CardHeader title="Saved cut packages" subtitle={project?.name} />
            <CardBody className="space-y-1.5">
              {savedPackages.length === 0 ? (
                <p className="text-xs text-slate-600">Nothing saved yet for this project.</p>
              ) : (
                savedPackages.map((p) => (
                  <div key={p.id}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${p.id === activePkgId ? 'border-brand-500 bg-brand-900/20' : 'border-[#2a2a2a]'}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-200">{p.name}</p>
                      <p className="truncate text-[10px] text-slate-500">{p.boxes.length} page{p.boxes.length === 1 ? '' : 's'} · {p.sourceFileName}</p>
                    </div>
                    <button onClick={() => openPackage(p)} title="Open full editor" className="rounded p-1 text-slate-500 hover:text-brand-400">
                      <FolderOpen size={13} />
                    </button>
                    <button onClick={() => openPackage(p, { quick: true })} title="Quick regenerate — change DPI/format only, no editor" className="rounded p-1 text-slate-500 hover:text-amber-400">
                      <Zap size={13} />
                    </button>
                    <button onClick={() => renamePackage(p)} title="Rename" className="rounded p-1 text-slate-500 hover:text-slate-200">
                      <Save size={13} />
                    </button>
                    <button onClick={() => handleDeletePackage(p)} title="Delete" className="rounded p-1 text-slate-500 hover:text-rose-400">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}
