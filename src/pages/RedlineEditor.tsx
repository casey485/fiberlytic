import { useRef, useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  ArrowLeft, Pen, Minus, ArrowUpRight, Square, Circle, Type,
  Undo2, Trash2, ChevronLeft, ChevronRight, Loader2,
  CheckCircle2, AlertTriangle, X,
} from 'lucide-react'
import { useData } from '../store/DataContext'
import { loadBlob, saveBlob } from '../lib/fileStore'
import type { AnnotationShape, AnnotationTool } from '../types'
import type { PendingProduction } from '../lib/pendingProduction'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// ── Helpers ──────────────────────────────────────────────────────────────────

function ptsToPath(pts: [number, number][]): string {
  if (pts.length < 2) return ''
  return `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map(([x, y]) => `L ${x} ${y}`).join(' ')
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1) return `${x2},${y2}`
  const ux = dx / len, uy = dy / len, px = -uy, py = ux
  const sz = Math.max(size, 14)
  const p1 = [x2 - ux * sz + px * sz * 0.45, y2 - uy * sz + py * sz * 0.45]
  const p2 = [x2 - ux * sz - px * sz * 0.45, y2 - uy * sz - py * sz * 0.45]
  return `${p1[0]},${p1[1]} ${x2},${y2} ${p2[0]},${p2[1]}`
}

function ShapeEl({ s }: { s: Partial<AnnotationShape> & Pick<AnnotationShape, 'tool' | 'color' | 'strokeWidth'> }) {
  const { tool, color, strokeWidth: sw } = s
  const common = {
    stroke: color, strokeWidth: sw,
    fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  }
  switch (tool) {
    case 'pen':
      return <path d={ptsToPath(s.points ?? [])} {...common} />
    case 'line':
      return <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...common} />
    case 'arrow':
      return (
        <g>
          <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...common} />
          <polygon points={arrowHead(s.x1 ?? 0, s.y1 ?? 0, s.x2 ?? 0, s.y2 ?? 0, sw * 3.5)} fill={color} stroke="none" />
        </g>
      )
    case 'rect': {
      const x = Math.min(s.x1 ?? 0, s.x2 ?? 0), y = Math.min(s.y1 ?? 0, s.y2 ?? 0)
      return <rect x={x} y={y} width={Math.abs((s.x2 ?? 0) - (s.x1 ?? 0))} height={Math.abs((s.y2 ?? 0) - (s.y1 ?? 0))} {...common} />
    }
    case 'ellipse': {
      const cx = ((s.x1 ?? 0) + (s.x2 ?? 0)) / 2, cy = ((s.y1 ?? 0) + (s.y2 ?? 0)) / 2
      return <ellipse cx={cx} cy={cy} rx={Math.abs((s.x2 ?? 0) - (s.x1 ?? 0)) / 2} ry={Math.abs((s.y2 ?? 0) - (s.y1 ?? 0)) / 2} {...common} />
    }
    case 'text':
      return (
        <text x={s.x1} y={s.y1} fill={color} fontSize={sw * 5} fontFamily="Arial, sans-serif" fontWeight="700" dominantBaseline="hanging">
          {s.text}
        </text>
      )
    default:
      return null
  }
}

// ── Tool / colour config ──────────────────────────────────────────────────────

const TOOLS: { id: AnnotationTool; label: string; icon: React.ReactNode }[] = [
  { id: 'pen',     label: 'Pen (freehand)',   icon: <Pen size={17} /> },
  { id: 'line',    label: 'Straight line',    icon: <Minus size={17} /> },
  { id: 'arrow',   label: 'Arrow',            icon: <ArrowUpRight size={17} /> },
  { id: 'rect',    label: 'Rectangle',        icon: <Square size={17} /> },
  { id: 'ellipse', label: 'Ellipse / circle', icon: <Circle size={17} /> },
  { id: 'text',    label: 'Text label',       icon: <Type size={17} /> },
]

const COLORS = [
  { label: 'Red',    value: '#ef4444' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Yellow', value: '#eab308' },
  { label: 'Green',  value: '#22c55e' },
  { label: 'Blue',   value: '#3b82f6' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Black',  value: '#0f172a' },
  { label: 'White',  value: '#f8fafc' },
]

const WIDTHS = [
  { value: 2,  label: 'Thin' },
  { value: 4,  label: 'Medium' },
  { value: 8,  label: 'Thick' },
  { value: 14, label: 'Bold' },
]

// ── Editor ────────────────────────────────────────────────────────────────────

type PageSize   = { w: number; h: number }
type TextInput  = { visible: false } | { visible: true; screenX: number; screenY: number; vbX: number; vbY: number }

function formatDateShort(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function RedlineEditor() {
  const { fileId }   = useParams<{ fileId: string }>()
  const navigate     = useNavigate()
  const location     = useLocation()
  const {
    data,
    addAnnotation, deleteAnnotation, clearAnnotations,
    addProduction, addCrewDayEntry, addPhoto,
  } = useData()

  // Pending production — set when navigated here from the production form
  const pending = (location.state as { pending?: PendingProduction } | null)?.pending ?? null

  const file    = data.projectFiles.find((f) => f.id === fileId)
  const project = file ? data.projects.find((p) => p.id === file.projectId) : null
  const crew    = pending ? data.crews.find((c) => c.id === pending.crewId) : null

  // ── Navigation guard (no data-router required) ──
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)

  // Block browser back/forward button when production is pending
  useEffect(() => {
    if (!pending) return
    // Push a dummy history entry so the back button hits it first
    window.history.pushState({ pendingBlock: true }, '')
    const onPop = () => {
      // Re-push so the user stays on this page visually
      window.history.pushState({ pendingBlock: true }, '')
      setShowLeaveConfirm(true)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [pending])

  // Block browser close / refresh
  useEffect(() => {
    if (!pending) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [pending])

  // ── PDF state ──
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [pdf, setPdf]            = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum]    = useState(1)
  const [totalPages, setTotal]   = useState(0)
  const [pageSize, setPageSize]  = useState<PageSize>({ w: 612, h: 792 })
  const [rendering, setRendering] = useState(false)

  // ── Tool state ──
  const [tool,  setTool]  = useState<AnnotationTool>('pen')
  const [color, setColor] = useState('#ef4444')
  const [width, setWidth] = useState(4)

  // ── Drawing state ──
  const svgRef   = useRef<SVGSVGElement>(null)
  const [drawing,   setDrawing]   = useState(false)
  const [penPts,    setPenPts]    = useState<[number, number][]>([])
  const [draft,     setDraft]     = useState<Partial<AnnotationShape> | null>(null)
  const [textInput, setTextInput] = useState<TextInput>({ visible: false })
  const textRef  = useRef<HTMLInputElement>(null)

  // Annotations for this file + page
  const shapes = data.annotations.filter((a) => a.fileId === fileId && a.page === pageNum)

  // ── Load PDF ──
  useEffect(() => {
    if (!file || file.fileType !== 'pdf' || !fileId) return
    loadBlob(fileId).then((dataUrl) => {
      if (!dataUrl) return
      pdfjsLib.getDocument({ url: dataUrl }).promise.then((doc) => {
        setPdf(doc)
        setTotal(doc.numPages)
        setPageNum(1)
      })
    }).catch(console.error)
  }, [file, fileId])

  // ── Render page ──
  useEffect(() => {
    if (!pdf || !canvasRef.current) return
    let cancelled = false
    setRendering(true)
    pdf.getPage(pageNum).then((page) => {
      if (cancelled) return
      const vpNat = page.getViewport({ scale: 1 })
      setPageSize({ w: vpNat.width, h: vpNat.height })
      const maxW  = (containerRef.current?.clientWidth ?? 900) - 32
      const scale = Math.min(2.5, maxW / vpNat.width)
      const vp    = page.getViewport({ scale })
      const canvas = canvasRef.current!
      canvas.width  = vp.width
      canvas.height = vp.height
      return page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
    }).then(() => { if (!cancelled) setRendering(false) })
      .catch(() => { if (!cancelled) setRendering(false) })
    return () => { cancelled = true }
  }, [pdf, pageNum])

  // ── Coordinates ──
  const toVb = useCallback((clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current
    if (!svg) return [0, 0]
    const r = svg.getBoundingClientRect()
    return [((clientX - r.left) / r.width) * pageSize.w, ((clientY - r.top) / r.height) * pageSize.h]
  }, [pageSize])

  // ── Text commit ──
  const commitText = useCallback(() => {
    if (!textInput.visible) return
    const val = textRef.current?.value.trim()
    if (val) {
      addAnnotation({ fileId: fileId!, page: pageNum, tool: 'text', color, strokeWidth: width, x1: textInput.vbX, y1: textInput.vbY, text: val, createdAt: new Date().toISOString() })
    }
    setTextInput({ visible: false })
  }, [textInput, fileId, pageNum, color, width, addAnnotation])

  // ── Pointer events ──
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (textInput.visible) { commitText(); return }
    e.currentTarget.setPointerCapture(e.pointerId)
    const [vx, vy] = toVb(e.clientX, e.clientY)
    if (tool === 'text') {
      const r = svgRef.current!.getBoundingClientRect()
      setTextInput({ visible: true, screenX: e.clientX - r.left, screenY: e.clientY - r.top, vbX: vx, vbY: vy })
      setTimeout(() => textRef.current?.focus(), 20)
      return
    }
    setDrawing(true)
    if (tool === 'pen') setPenPts([[vx, vy]])
    else setDraft({ tool, color, strokeWidth: width, x1: vx, y1: vy, x2: vx, y2: vy })
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing) return
    const [vx, vy] = toVb(e.clientX, e.clientY)
    if (tool === 'pen') setPenPts((pts) => [...pts, [vx, vy]])
    else setDraft((d) => d ? { ...d, x2: vx, y2: vy } : null)
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing) return
    setDrawing(false)
    const [vx, vy] = toVb(e.clientX, e.clientY)
    if (tool === 'pen') {
      if (penPts.length > 2) addAnnotation({ fileId: fileId!, page: pageNum, tool: 'pen', color, strokeWidth: width, points: penPts, createdAt: new Date().toISOString() })
      setPenPts([])
    } else if (draft) {
      const fin = { ...draft, x2: vx, y2: vy }
      const dx = Math.abs((fin.x2 ?? 0) - (fin.x1 ?? 0)), dy = Math.abs((fin.y2 ?? 0) - (fin.y1 ?? 0))
      if (dx > 4 || dy > 4) {
        const { fileId: _f, page: _p, ...rest } = fin as AnnotationShape
        addAnnotation({ ...rest, fileId: fileId!, page: pageNum, createdAt: new Date().toISOString() })
      }
      setDraft(null)
    }
  }

  const handleUndo = () => {
    const all = [...shapes]; const last = all[all.length - 1]
    if (last) deleteAnnotation(last.id)
  }

  const handleClear = () => {
    if (!confirm(`Clear all markups on page ${pageNum}?`)) return
    clearAnnotations(fileId!, pageNum)
  }

  // ── Save & Complete (pending flow) ──
  const handleComplete = async () => {
    if (!pending) return
    let entryId: string
    if (pending.type === 'simple') {
      entryId = addProduction(
        { date: pending.date, projectId: pending.projectId, crewId: pending.crewId, footage: pending.footage, hours: pending.hours, notes: pending.notes },
        pending.lineItems.length > 0 ? pending.lineItems : undefined,
      )
    } else {
      entryId = addCrewDayEntry({
        date: pending.date, projectId: pending.projectId, crewId: pending.crewId,
        footage: pending.footage, notes: pending.notes,
        employees: pending.employees, equipmentIds: pending.equipmentIds,
      })
    }
    // Save any photos that were attached in the production form
    if (pending.photos && pending.photos.length > 0) {
      await Promise.all(pending.photos.map(async (ph) => {
        const blobKey = 'pb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
        await saveBlob(blobKey, ph.preview)
        addPhoto({
          projectId: pending.projectId,
          caption: ph.caption || 'Production photo',
          category: 'progress',
          date: pending.date,
          uploadedBy: 'Field',
          url: 'idb:' + blobKey,
          productionEntryId: entryId,
        })
      }))
    }
    // Navigate back to production, clearing the pending state so the blocker disarms
    navigate('/production', { replace: true })
  }

  // ── Discard pending ──
  const handleDiscard = () => {
    if (!confirm('Discard this production entry? The print markup will be kept but the production numbers will NOT be saved.')) return
    navigate('/production', { replace: true })
  }

  // ── Back (non-pending) ──
  const handleBack = () => {
    navigate(project ? `/projects/${project.id}` : '/redline')
  }

  if (!file) {
    return (
      <div className="p-10 text-center">
        <p className="text-slate-400">File not found.</p>
        <Link to="/redline" className="mt-3 inline-block text-sm text-brand-600 hover:underline">← Back to Redline</Link>
      </div>
    )
  }

  if (file.fileType !== 'pdf') {
    return (
      <div className="p-10 text-center">
        <p className="mb-1 text-slate-500">Redline is only available for PDF files.</p>
        <Link to="/redline" className="mt-3 inline-block text-sm text-brand-600 hover:underline">← Back</Link>
      </div>
    )
  }

  // Pending production summary line
  const pendingSummary = pending
    ? `${formatDateShort(pending.date)} · ${project?.name ?? '—'} · ${crew?.name ?? '—'} · ${pending.footage} ft`
    : null

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-64px)] flex-col lg:-mx-8 lg:-my-6">

      {/* ── Leave-without-saving confirm dialog ── */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-3">
              <AlertTriangle size={22} className="shrink-0 text-amber-500" />
              <h2 className="text-base font-bold text-slate-800">Leave without saving?</h2>
            </div>
            <p className="mb-5 text-sm text-slate-500">
              Your production entry has <strong>not been saved yet</strong>. If you leave now, those numbers will be lost. Your print markups are already saved.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Stay &amp; finish
              </button>
              <button
                onClick={() => { setShowLeaveConfirm(false); navigate('/production', { replace: true }) }}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
              >
                Leave &amp; discard entry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pending production banner ── */}
      {pending && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-amber-300 bg-amber-50 px-4 py-2.5">
          <div className="flex items-center gap-2.5 text-sm">
            <AlertTriangle size={18} className="shrink-0 text-amber-600" />
            <div>
              <span className="font-bold text-amber-800">Production entry pending — not saved yet.</span>
              {pendingSummary && <span className="ml-2 text-amber-700">{pendingSummary}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDiscard}
              className="flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
            >
              <X size={13} /> Discard entry
            </button>
            <button
              onClick={handleComplete}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-bold text-white shadow hover:bg-emerald-700"
            >
              <CheckCircle2 size={16} /> Save &amp; Complete
            </button>
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm">
        {pending ? (
          <button
            onClick={handleDiscard}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
          >
            <ArrowLeft size={14} /> Back
          </button>
        ) : (
          <button
            onClick={handleBack}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft size={14} /> Back
          </button>
        )}

        <div className="hidden max-w-[160px] truncate text-sm font-semibold text-slate-700 sm:block">{file.name}</div>
        {project && <span className="hidden text-xs text-slate-400 sm:block">· {project.name}</span>}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Tools */}
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                title={t.label}
                onClick={() => { setTool(t.id); setTextInput({ visible: false }) }}
                className={`flex h-8 w-8 items-center justify-center rounded-md transition ${tool === t.id ? 'bg-brand-600 text-white shadow' : 'text-slate-500 hover:bg-white hover:text-slate-800'}`}
              >
                {t.icon}
              </button>
            ))}
          </div>

          {/* Colors */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            {COLORS.map((c) => (
              <button
                key={c.value}
                title={c.label}
                onClick={() => setColor(c.value)}
                style={{ backgroundColor: c.value, border: c.value === '#f8fafc' ? '1px solid #cbd5e1' : undefined }}
                className={`h-6 w-6 rounded-full transition-transform ${color === c.value ? 'scale-125 ring-2 ring-brand-500 ring-offset-1' : 'hover:scale-110'}`}
              />
            ))}
          </div>

          {/* Stroke width */}
          <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {WIDTHS.map((w) => (
              <button
                key={w.value}
                title={w.label}
                onClick={() => setWidth(w.value)}
                className={`flex h-8 w-8 items-center justify-center rounded-md transition ${width === w.value ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-white'}`}
              >
                <div className="rounded-full bg-current" style={{ width: Math.min(w.value * 2.5, 22), height: Math.min(w.value * 2.5, 22) }} />
              </button>
            ))}
          </div>

          <button onClick={handleUndo} disabled={shapes.length === 0} title="Undo last" className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-600 disabled:opacity-40 hover:bg-white">
            <Undo2 size={14} /> Undo
          </button>
          <button onClick={handleClear} disabled={shapes.length === 0} title="Clear all on page" className="flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-xs font-medium text-rose-600 disabled:opacity-40 hover:bg-rose-100">
            <Trash2 size={14} /> Clear
          </button>

          {/* Inline Save & Complete button in toolbar for easy reach */}
          {pending && (
            <button
              onClick={handleComplete}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white shadow hover:bg-emerald-700"
            >
              <CheckCircle2 size={14} /> Save &amp; Complete
            </button>
          )}
        </div>
      </div>

      {/* ── Canvas area ── */}
      <div ref={containerRef} className="flex flex-1 flex-col items-center overflow-auto bg-slate-400 py-6 px-4">
        <div className="relative shadow-2xl">
          {rendering && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded bg-white/80">
              <Loader2 size={32} className="animate-spin text-brand-600" />
            </div>
          )}

          <canvas ref={canvasRef} className="block select-none" />

          <svg
            ref={svgRef}
            viewBox={`0 0 ${pageSize.w} ${pageSize.h}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full select-none"
            style={{ cursor: tool === 'text' ? 'text' : 'crosshair', touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {shapes.map((s) => <ShapeEl key={s.id} s={s} />)}
            {drawing && tool === 'pen' && penPts.length > 1 && (
              <path d={ptsToPath(penPts)} stroke={color} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            )}
            {draft && <ShapeEl s={draft as AnnotationShape} />}
          </svg>

          {textInput.visible && (
            <input
              ref={textRef}
              type="text"
              placeholder="Type then press Enter"
              style={{
                position: 'absolute',
                left: textInput.screenX, top: textInput.screenY,
                transform: 'translateY(-50%)',
                fontSize: width * 5 * ((canvasRef.current?.clientWidth ?? 612) / pageSize.w),
                color, fontWeight: 700, fontFamily: 'Arial, sans-serif',
                background: 'rgba(255,255,255,0.85)',
                border: `2px dashed ${color}`, borderRadius: 4,
                padding: '2px 8px', outline: 'none', minWidth: 140, maxWidth: 360, zIndex: 30,
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitText() }
                if (e.key === 'Escape') setTextInput({ visible: false })
              }}
              onBlur={commitText}
            />
          )}
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center gap-3 rounded-full bg-white px-4 py-2 shadow-lg">
            <button onClick={() => { setPageNum((p) => Math.max(1, p - 1)); setTextInput({ visible: false }) }} disabled={pageNum <= 1} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-40">
              <ChevronLeft size={18} />
            </button>
            <span className="min-w-[100px] text-center text-sm font-medium text-slate-700">Page {pageNum} of {totalPages}</span>
            <button onClick={() => { setPageNum((p) => Math.min(totalPages, p + 1)); setTextInput({ visible: false }) }} disabled={pageNum >= totalPages} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-40">
              <ChevronRight size={18} />
            </button>
          </div>
        )}

        {shapes.length > 0 && (
          <p className="mt-2 text-xs text-slate-300">{shapes.length} mark{shapes.length > 1 ? 's' : ''} on this page</p>
        )}

        {/* Bottom Save & Complete CTA for pending production */}
        {pending && (
          <div className="mt-6 flex w-full max-w-lg flex-col items-center gap-2 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5 shadow">
            <CheckCircle2 size={28} className="text-emerald-500" />
            <p className="text-center text-sm font-bold text-emerald-800">Done marking up the print?</p>
            <p className="text-center text-xs text-emerald-600">Tap below to save your production entry and complete the redline.</p>
            <button
              onClick={handleComplete}
              className="mt-1 w-full rounded-xl bg-emerald-600 py-3 text-base font-bold text-white shadow hover:bg-emerald-700 active:scale-95"
            >
              Save &amp; Complete Production Entry
            </button>
            <button onClick={handleDiscard} className="text-xs text-rose-400 hover:text-rose-600">
              Discard production entry (keep markups)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
