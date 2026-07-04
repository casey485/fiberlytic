import { useRef, useState } from 'react'
import { Download, FileJson, FileSpreadsheet, FileText, Trash2, FolderOpen, ScanSearch } from 'lucide-react'
import { useData } from '../store/DataContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Button, Field, Select } from '../components/ui/Form'
import { PageThumbnailList } from '../components/mapreading/PageThumbnailList'
import { PageCanvas } from '../components/mapreading/PageCanvas'
import { DetectionsAndNotes } from '../components/mapreading/DetectionsAndNotes'
import { SummaryTable } from '../components/mapreading/SummaryTable'
import { renderPdfPages, renderImageFile, canvasToDataUrl, isPdfFile, isImageFile } from '../lib/mapReading/pageRender'
import { detectMapReadingCandidates, summarizeDetections } from '../lib/mapReading/detect'
import { loadImage, traceRoutes } from '../lib/mapReading/lineTrace'
import { detectLoopCandidates } from '../lib/mapReading/symbolHeuristics'
import { classifyRoutes } from '../lib/mapReading/routeClassify'
import { runOcrWithBoxes } from '../features/printkmz/ocr'
import { saveBlob, loadBlob } from '../lib/fileStore'
import { buildMarkedUpPdf, buildNotesReportPdf, buildCsvSummary, buildJsonExport } from '../lib/mapReading/exportMapReading'
import type { MapReadingPage, MapReadingNotes, MapReadingSession } from '../types'

const DEFAULT_TRACE_THRESHOLD = 128

function localId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function emptyNotes(pageName: string): MapReadingNotes {
  return {
    pageName, strand24ct: '', strand48ct: '', strand96ct: '', overlash: '',
    coils: '', snowshoes: '', feLabels: '', ftLabels: '', roadNames: '',
    tiePoint: '', oltMux: '', needsReview: '',
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

function downloadText(text: string, fileName: string, mime: string) {
  downloadBlob(new Blob([text], { type: mime }), fileName)
}

export function MapReading() {
  const { data, addMapReadingSession, updateMapReadingSession, deleteMapReadingSession } = useData()
  const dataRef = useRef(data)
  dataRef.current = data

  const [projectId, setProjectId] = useState('')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [selectedDetectionId, setSelectedDetectionId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const fileErrorRef = useRef<HTMLDivElement>(null)
  const [traceThreshold, setTraceThreshold] = useState(128)
  const [tracing, setTracing] = useState(false)
  const [showRouteGraph, setShowRouteGraph] = useState(true)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)

  const session = activeSessionId ? data.mapReadingSessions.find((s) => s.id === activeSessionId) ?? null : null
  const savedSessions = projectId ? data.mapReadingSessions.filter((s) => s.projectId === projectId) : []
  const selectedPage = session?.pages.find((p) => p.id === selectedPageId) ?? null

  function resetSession() {
    setActiveSessionId(null)
    setSelectedPageId(null)
    setSelectedDetectionId(null)
    setError('')
  }

  function handleProjectChange(id: string) {
    setProjectId(id)
    resetSession()
  }

  /** Patches one page within a session using the LATEST store state at call
   *  time (via dataRef), not a stale closure snapshot — needed since several
   *  pages' OCR jobs can complete at different times while more uploads and
   *  edits are still happening. */
  function patchPage(sessionId: string, pageId: string, patch: Partial<MapReadingPage>) {
    const latest = dataRef.current.mapReadingSessions.find((s) => s.id === sessionId)
    if (!latest) return
    updateMapReadingSession(sessionId, {
      pages: latest.pages.map((p) => (p.id === pageId ? { ...p, ...patch } : p)),
    })
  }

  /** The full pipeline for one page: OCR -> text detections -> line-tracing ->
   *  geometric slack-loop heuristic -> route classification -> notes summary
   *  -> final status. Used both by the upload flow and by "Auto Read All
   *  Pages," so every page — however it entered the session — goes through
   *  the identical process. */
  async function processPage(sessId: string, page: MapReadingPage): Promise<void> {
    patchPage(sessId, page.id, { status: 'reading', error: undefined })
    try {
      const dataUrl = await loadBlob(page.imageBlobKey)
      if (!dataUrl) throw new Error('Could not load the page image.')

      const [ocrResult] = await runOcrWithBoxes([dataUrl])
      const textDetections = detectMapReadingCandidates(ocrResult.words)

      const image = await loadImage(dataUrl)
      const rawGraph = traceRoutes(image, { ocrWordBoxes: ocrResult.words, threshold: DEFAULT_TRACE_THRESHOLD })
      const loopDetections = detectLoopCandidates(rawGraph)
      const allDetections = [...textDetections, ...loopDetections]
      const routeGraph = classifyRoutes(rawGraph, allDetections)

      const notes = summarizeDetections(allDetections, page.notes.pageName || page.fileName)
      const hasReviewFlag = allDetections.some((d) => d.type === 'needs_review')
      const hasUnclassifiedRoutes = routeGraph.segments.length > 0 && routeGraph.segments.every((s) => !s.classification)
      const status: MapReadingPage['status'] = hasReviewFlag || hasUnclassifiedRoutes ? 'needs_review' : 'complete'

      patchPage(sessId, page.id, { detections: allDetections, notes, ocrWordBoxes: ocrResult.words, routeGraph, status })
    } catch (e) {
      patchPage(sessId, page.id, { status: 'error', error: e instanceof Error ? e.message : 'Processing failed' })
    }
  }

  /** Sequential, not parallel — OCR and thinning are both CPU-heavy; running
   *  several pages at once would bog down the tab rather than finish faster. */
  async function runBatch(sessId: string, pages: MapReadingPage[]) {
    setProgress({ current: 0, total: pages.length })
    for (let i = 0; i < pages.length; i++) {
      setProgress({ current: i + 1, total: pages.length })
      const latest = dataRef.current.mapReadingSessions.find((s) => s.id === sessId)?.pages.find((p) => p.id === pages[i].id)
      await processPage(sessId, latest ?? pages[i])
    }
    setProgress(null)
  }

  async function handleAutoReadAll() {
    if (!session) return
    const unread = session.pages.filter((p) => p.status === 'not_read')
    if (unread.length === 0) { setError('No unread pages to process.'); return }
    setError('')
    await runBatch(session.id, unread)
  }

  async function handleFilesAdded(files: File[]) {
    if (!projectId) { setError('Choose a project first.'); return }
    setError('')

    // Track this session's pages in a plain local variable through the whole
    // upload, rather than re-reading it back from the store (dataRef) between
    // appends. addMapReadingSession's setData() call doesn't take effect in
    // dataRef until the next render — for a brand-new session, that render
    // hasn't happened yet by the time the very first page is ready to append,
    // so a ref-based read-then-append here would silently find no session and
    // drop every page (session shows up with "0 pages" — the actual bug this
    // fixes: a real Map Cut download uploaded as the first file into a new
    // session lost all its pages this way).
    let sessId: string
    let currentPages: MapReadingPage[]
    if (session) {
      sessId = session.id
      currentPages = session.pages
    } else {
      const sess = addMapReadingSession({ projectId, name: `Map Reading — ${new Date().toLocaleDateString()}`, pages: [] })
      sessId = sess.id
      currentPages = []
      setActiveSessionId(sessId)
    }

    const newlyAdded: MapReadingPage[] = []

    for (const file of files) {
      let rasters
      try {
        if (isPdfFile(file)) rasters = await renderPdfPages(file)
        else if (isImageFile(file)) rasters = [await renderImageFile(file)]
        else { setError(`Unsupported file type: ${file.name}`); continue }
      } catch (e) {
        setError(e instanceof Error ? e.message : `Failed to read ${file.name}`)
        continue
      }
      if (rasters.length === 0) {
        setError(`No pages found in ${file.name}`)
        continue
      }

      for (let i = 0; i < rasters.length; i++) {
        const raster = rasters[i]
        const dataUrl = canvasToDataUrl(raster.canvas)
        const blobKey = localId('mrp')
        await saveBlob(blobKey, dataUrl)

        const pageId = localId('mrpg')
        const pageName = rasters.length > 1 ? `${file.name} — page ${i + 1}` : file.name
        const newPage: MapReadingPage = {
          id: pageId, fileName: file.name, pageIndexInFile: i, imageBlobKey: blobKey,
          naturalWidth: raster.naturalWidth, naturalHeight: raster.naturalHeight,
          detections: [], notes: emptyNotes(pageName), status: 'not_read',
        }
        currentPages = [...currentPages, newPage]
        newlyAdded.push(newPage)
        updateMapReadingSession(sessId, { pages: currentPages })
        setSelectedPageId((cur) => cur ?? pageId)
      }
    }

    if (newlyAdded.length > 0 && confirm('Auto Read All Pages?')) {
      await runBatch(sessId, newlyAdded)
    }
  }

  function openSession(s: MapReadingSession) {
    setProjectId(s.projectId)
    setActiveSessionId(s.id)
    setSelectedPageId(s.pages[0]?.id ?? null)
    setSelectedDetectionId(null)
    setTraceThreshold(s.pages[0]?.routeGraph?.threshold ?? 128)
    setError('')
  }

  function handleDeleteSession(s: MapReadingSession) {
    if (!confirm(`Delete "${s.name}"? This cannot be undone.`)) return
    deleteMapReadingSession(s.id)
    if (activeSessionId === s.id) resetSession()
  }

  function updateSelectedPage(patch: Partial<MapReadingPage>) {
    if (!session || !selectedPage) return
    patchPage(session.id, selectedPage.id, patch)
  }

  function selectPage(id: string | null) {
    setSelectedPageId(id)
    setSelectedDetectionId(null)
    const page = session?.pages.find((p) => p.id === id)
    setTraceThreshold(page?.routeGraph?.threshold ?? 128)
  }

  /** Runs the Geometry/Line-Tracing layer on the selected page — an explicit,
   *  user-triggered action while this is still being proven out against real
   *  prints, not yet automatic like OCR. */
  /** Manual per-page override for fixing one page's trace — no longer the
   *  primary path (that's the automatic batch pipeline above), but still
   *  available since the auto-run uses a fixed default threshold. Re-runs the
   *  geometric slack-loop heuristic and route classification against the new
   *  trace, but keeps existing text-derived detections (and any corrections
   *  already made to them) untouched — only the geometry-derived ones are refreshed. */
  async function handleTraceLines() {
    if (!session || !selectedPage) return
    setTracing(true)
    setError('')
    try {
      const dataUrl = await loadBlob(selectedPage.imageBlobKey)
      if (!dataUrl) throw new Error('Could not load the page image.')
      const image = await loadImage(dataUrl)
      const rawGraph = traceRoutes(image, { ocrWordBoxes: selectedPage.ocrWordBoxes ?? [], threshold: traceThreshold })
      const loopDetections = detectLoopCandidates(rawGraph)
      const keptDetections = selectedPage.detections.filter((d) => !(d.type === 'coil' && d.text === 'Slack loop (geometry)'))
      const allDetections = [...keptDetections, ...loopDetections]
      const routeGraph = classifyRoutes(rawGraph, allDetections)
      const notes = summarizeDetections(allDetections, selectedPage.notes.pageName || selectedPage.fileName)
      patchPage(session.id, selectedPage.id, { detections: allDetections, routeGraph, notes })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to trace lines')
    } finally {
      setTracing(false)
    }
  }

  async function exportMarkedUpPdf() {
    if (!session) return
    const pdf = await buildMarkedUpPdf(session)
    downloadBlob(pdf.output('blob'), `${session.name}-marked-up.pdf`)
  }
  async function exportNotesReport() {
    if (!session) return
    const pdf = await buildNotesReportPdf(session)
    downloadBlob(pdf.output('blob'), `${session.name}-notes.pdf`)
  }
  function exportCsv() {
    if (!session) return
    downloadText(buildCsvSummary(session), `${session.name}-summary.csv`, 'text/csv')
  }
  function exportJson() {
    if (!session) return
    downloadText(buildJsonExport(session), `${session.name}-detections.json`, 'application/json')
  }

  return (
    <div>
      <PageHeader
        title="Map Reading"
        description="Upload cut map pages from Map Cut and get auto-generated, editable notes and highlights."
      />
      <div ref={fileErrorRef} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="1. Choose a project" />
            <CardBody className="space-y-3">
              <Field label="Project">
                <Select value={projectId} onChange={(e) => handleProjectChange(e.target.value)}>
                  <option value="">Select a project…</option>
                  {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              {error && <p className="rounded-lg bg-rose-950/40 px-3 py-2 text-xs text-rose-400">{error}</p>}
            </CardBody>
          </Card>

          {projectId && (
            <Card>
              <CardHeader
                title="2. Review pages"
                action={session && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button type="button" onClick={handleAutoReadAll} disabled={!!progress}>
                      <ScanSearch size={13} /> Auto Read All Pages
                    </Button>
                    <Button type="button" variant="secondary" onClick={exportMarkedUpPdf}><Download size={13} /> Marked-up PDF</Button>
                    <Button type="button" variant="secondary" onClick={exportNotesReport}><FileText size={13} /> Notes Report</Button>
                    <Button type="button" variant="secondary" onClick={exportCsv}><FileSpreadsheet size={13} /> CSV</Button>
                    <Button type="button" variant="secondary" onClick={exportJson}><FileJson size={13} /> JSON</Button>
                  </div>
                )}
              />
              <CardBody className="space-y-3">
                {progress && (
                  <div className="space-y-1">
                    <p className="text-[11px] text-slate-400">Reading page {progress.current} of {progress.total}…</p>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1e1e1e]">
                      <div
                        className="h-full rounded-full bg-brand-500 transition-all"
                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {session && session.pages.length > 0 && <SummaryTable pages={session.pages} />}

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1.4fr)_320px]" style={{ minHeight: 560 }}>
                  <div className="h-[560px]">
                    <PageThumbnailList
                      pages={session?.pages ?? []}
                      selectedPageId={selectedPageId}
                      onSelectPage={selectPage}
                      onFilesAdded={handleFilesAdded}
                    />
                  </div>
                  <div className="flex h-[560px] flex-col gap-2">
                    {selectedPage && (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#141414] px-2.5 py-1.5">
                        <Button type="button" variant="secondary" onClick={handleTraceLines} disabled={tracing}>
                          {tracing ? 'Tracing…' : 'Trace Lines'}
                        </Button>
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                          Threshold
                          <input
                            type="range" min={0} max={255} value={traceThreshold}
                            onChange={(e) => setTraceThreshold(Number(e.target.value))}
                            className="h-6 w-28"
                          />
                          <span className="w-7 text-right">{traceThreshold}</span>
                        </label>
                        {selectedPage.routeGraph && (
                          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
                            <input type="checkbox" checked={showRouteGraph} onChange={(e) => setShowRouteGraph(e.target.checked)} />
                            Show traced routes
                          </label>
                        )}
                      </div>
                    )}
                    <div className="min-h-0 flex-1">
                      <PageCanvas
                        page={selectedPage}
                        selectedDetectionId={selectedDetectionId}
                        onSelectDetection={setSelectedDetectionId}
                        routeGraph={showRouteGraph ? selectedPage?.routeGraph ?? null : null}
                      />
                    </div>
                  </div>
                  <div className="h-[560px]">
                    {selectedPage ? (
                      <DetectionsAndNotes
                        page={selectedPage}
                        selectedDetectionId={selectedDetectionId}
                        onSelectDetection={setSelectedDetectionId}
                        onUpdatePage={updateSelectedPage}
                      />
                    ) : (
                      <p className="text-sm text-slate-600">Select a page to see its detections and notes.</p>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        {projectId && (
          <Card className="h-fit">
            <CardHeader title="Saved sessions" />
            <CardBody className="space-y-1.5">
              {savedSessions.length === 0 ? (
                <p className="text-xs text-slate-600">Nothing saved yet for this project.</p>
              ) : (
                savedSessions.map((s) => (
                  <div key={s.id}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${s.id === activeSessionId ? 'border-brand-500 bg-brand-900/20' : 'border-[#2a2a2a]'}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-200">{s.name}</p>
                      <p className="truncate text-[10px] text-slate-500">{s.pages.length} page{s.pages.length === 1 ? '' : 's'}</p>
                    </div>
                    <button onClick={() => openSession(s)} title="Open" className="rounded p-1 text-slate-500 hover:text-brand-400">
                      <FolderOpen size={13} />
                    </button>
                    <button onClick={() => handleDeleteSession(s)} title="Delete" className="rounded p-1 text-slate-500 hover:text-rose-400">
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
