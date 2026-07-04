import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, Download, Printer, Save, ExternalLink, Trash2, Loader2, FolderOpen } from 'lucide-react'
import { useData } from '../store/DataContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Button, Field, Input, Select, Textarea } from '../components/ui/Form'
import { PdfViewport } from '../components/mapcuts/PdfViewport'
import { GridCutViewport } from '../components/mapcuts/GridCutViewport'
import { getPdfPageCount } from '../lib/mapCuts/render'
import { gridSelectionToBoxes } from '../lib/mapCuts/geometry'
import { buildMapCutPdf } from '../lib/mapCuts/pdfBuilder'
import { loadBlob } from '../lib/fileStore'
import type { MapCutPackage, MapCutStyle, MapCutPageSize, GridCellSelection } from '../types'

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
  const { data, addMapCutPackage, updateMapCutPackage, deleteMapCutPackage, addProjectFile } = useData()
  const nav = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [projectId, setProjectId] = useState('')
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [loadingSource, setLoadingSource] = useState(false)
  const [activePkgId, setActivePkgId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generatedPdf, setGeneratedPdf] = useState<{ blob: Blob; pageCount: number } | null>(null)
  const [error, setError] = useState('')

  const pkg = activePkgId ? data.mapCutPackages.find((p) => p.id === activePkgId) ?? null : null
  const gridSelection = pkg?.gridSelection ?? emptyGridSelection(pkg?.gridRows ?? 3, pkg?.gridCols ?? 3)
  const gridMergedCellIds = new Set(gridSelection.merges.flat())
  const gridOutputCount = gridSelection.merges.length
    + Object.keys(gridSelection.selectedOrder).filter((id) => !gridMergedCellIds.has(id)).length
  const project = projectId ? data.projects.find((p) => p.id === projectId) ?? null : null
  const projectFiles = projectId ? data.projectFiles.filter((f) => f.projectId === projectId && f.fileType === 'pdf') : []
  const savedPackages = projectId ? data.mapCutPackages.filter((p) => p.projectId === projectId) : []

  function resetSession() {
    setSourceFile(null)
    setActivePkgId(null)
    setGeneratedPdf(null)
    setError('')
  }

  function handleProjectChange(id: string) {
    setProjectId(id)
    resetSession()
  }

  async function beginWithSourceFile(file: File, projectFileId: string, name: string) {
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
      })
      setActivePkgId(created.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load PDF')
    } finally {
      setLoadingSource(false)
    }
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
        uploadedAt: new Date().toISOString().slice(0, 10), dataUrl,
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

  async function openPackage(p: MapCutPackage) {
    setError('')
    setGeneratedPdf(null)
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
    if (style === 'manual' && pkg.boxes.length > 0) {
      if (!confirm('Switching to Manual Box Cut clears the current boxes. Continue?')) return
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
      const newFileId = addProjectFile({
        projectId: pkg.projectId,
        name: pkg.outputFileName || 'map-cuts.pdf',
        fileType: 'pdf',
        size: generatedPdf.blob.size,
        uploadedAt: new Date().toISOString().slice(0, 10),
        dataUrl,
      })
      updateMapCutPackage(pkg.id, { outputProjectFileId: newFileId })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save to project documents')
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
                {generatedPdf && (
                  <p className="text-xs text-slate-500">
                    Generated {generatedPdf.pageCount} page{generatedPdf.pageCount === 1 ? '' : 's'}. Adjust anything above and click Generate again to regenerate.
                  </p>
                )}
              </CardBody>
            </Card>
          )}
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
                    <button onClick={() => openPackage(p)} title="Open" className="rounded p-1 text-slate-500 hover:text-brand-400">
                      <FolderOpen size={13} />
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
