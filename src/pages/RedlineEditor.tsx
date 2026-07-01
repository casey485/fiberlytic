import { useRef, useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  ArrowLeft, Pen, Minus, ArrowUpRight, Square, Circle, Type,
  Trash2, ChevronLeft, ChevronRight, Loader2,
  CheckCircle2, AlertTriangle, X, Highlighter, MessageSquare,
  Bold, Italic, Underline, Strikethrough, Cloud, MousePointer2,
  Route, Pentagon, MapPin, Eye, EyeOff, Undo2, Redo2,
} from 'lucide-react'
import { useData } from '../store/DataContext'
import { loadBlob, saveBlob } from '../lib/fileStore'
import type { AnnotationShape, AnnotationTool } from '../types'
import type { PendingProduction } from '../lib/pendingProduction'
import { AnnotationPanel } from '../components/AnnotationPanel'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function dashArray(style: string | undefined, sw: number): string | undefined {
  if (style === 'dashed') return `${sw * 5} ${sw * 3}`
  if (style === 'dotted') return `${sw} ${sw * 2}`
  return undefined
}

type ShapeData = Partial<AnnotationShape> & Pick<AnnotationShape, 'tool' | 'color' | 'strokeWidth'>

function renderShapeContent(s: ShapeData) {
  const { tool, color, strokeWidth: sw } = s
  const op = s.opacity ?? 1
  const da = dashArray(s.lineStyle, sw)
  const common = {
    stroke: color, strokeWidth: sw, fill: 'none',
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    strokeDasharray: da,
  }
  switch (tool) {
    case 'pen':
      return <path d={ptsToPath(s.points ?? [])} {...common} strokeDasharray={undefined} opacity={op} />
    case 'line':
      return <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...common} opacity={op} />
    case 'arrow':
      return (
        <g opacity={op}>
          <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...common} />
          <polygon points={arrowHead(s.x1 ?? 0, s.y1 ?? 0, s.x2 ?? 0, s.y2 ?? 0, sw * 3.5)} fill={color} stroke="none" />
        </g>
      )
    case 'rect': {
      const x = Math.min(s.x1 ?? 0, s.x2 ?? 0), y = Math.min(s.y1 ?? 0, s.y2 ?? 0)
      return <rect x={x} y={y} width={Math.abs((s.x2 ?? 0) - (s.x1 ?? 0))} height={Math.abs((s.y2 ?? 0) - (s.y1 ?? 0))}
        {...common} fill={s.fillColor ?? 'none'} fillOpacity={s.fillOpacity ?? 1} opacity={op} />
    }
    case 'ellipse': {
      const cx = ((s.x1 ?? 0) + (s.x2 ?? 0)) / 2, cy = ((s.y1 ?? 0) + (s.y2 ?? 0)) / 2
      return <ellipse cx={cx} cy={cy} rx={Math.abs((s.x2 ?? 0) - (s.x1 ?? 0)) / 2} ry={Math.abs((s.y2 ?? 0) - (s.y1 ?? 0)) / 2}
        {...common} fill={s.fillColor ?? 'none'} fillOpacity={s.fillOpacity ?? 1} opacity={op} />
    }
    case 'highlight': {
      const x = Math.min(s.x1 ?? 0, s.x2 ?? 0), y = Math.min(s.y1 ?? 0, s.y2 ?? 0)
      return <rect x={x} y={y} width={Math.abs((s.x2 ?? 0) - (s.x1 ?? 0))} height={Math.abs((s.y2 ?? 0) - (s.y1 ?? 0))}
        fill={color} fillOpacity={s.fillOpacity ?? 0.35} stroke="none" opacity={op} />
    }
    case 'cloud': {
      const x = Math.min(s.x1 ?? 0, s.x2 ?? 0), y = Math.min(s.y1 ?? 0, s.y2 ?? 0)
      return <rect x={x} y={y} width={Math.abs((s.x2 ?? 0) - (s.x1 ?? 0))} height={Math.abs((s.y2 ?? 0) - (s.y1 ?? 0))}
        fill={s.fillColor ?? 'none'} fillOpacity={s.fillOpacity ?? 0.08}
        stroke={color} strokeWidth={sw} strokeDasharray="10 5" rx={10} strokeLinecap="round" opacity={op} />
    }
    case 'text': {
      const td = [s.fontUnderline && 'underline', s.fontStrikethrough && 'line-through'].filter(Boolean).join(' ') || 'none'
      return (
        <text x={s.x1} y={s.y1} fill={color} fontSize={s.fontSize ?? sw * 5}
          fontFamily={s.fontFamily ?? 'Arial, sans-serif'}
          fontWeight={s.fontBold ? 'bold' : 'normal'} fontStyle={s.fontItalic ? 'italic' : 'normal'}
          textDecoration={td} dominantBaseline="hanging" opacity={op}>{s.text}</text>
      )
    }
    case 'callout': {
      if (!s.text) return null
      const fs = s.fontSize ?? 16, ff = s.fontFamily ?? 'Arial, sans-serif', pad = 8
      const estW = Math.max(s.text.length * fs * 0.58 + pad * 2, 80)
      const td = [s.fontUnderline && 'underline', s.fontStrikethrough && 'line-through'].filter(Boolean).join(' ') || 'none'
      return (
        <g opacity={s.opacity ?? 1}>
          <rect x={(s.x1 ?? 0) - pad} y={(s.y1 ?? 0) - pad} width={estW} height={fs * 1.7}
            fill={s.fillColor ?? '#ffffff'} fillOpacity={s.fillOpacity ?? 0.92}
            stroke={color} strokeWidth={sw} rx={4} />
          <text x={s.x1} y={(s.y1 ?? 0) + fs * 0.72} fill={color} fontSize={fs} fontFamily={ff}
            fontWeight={s.fontBold ? 'bold' : 'normal'} fontStyle={s.fontItalic ? 'italic' : 'normal'}
            textDecoration={td}>{s.text}</text>
        </g>
      )
    }
    case 'polyline':
      return <path d={ptsToPath(s.points ?? [])} {...common} opacity={op} />
    case 'polygon': {
      const pts = s.points ?? []
      if (pts.length < 2) return null
      const d = `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map(([x, y]) => `L ${x} ${y}`).join(' ') + ' Z'
      return <path d={d} stroke={color} strokeWidth={sw} fill={s.fillColor ?? 'none'}
        fillOpacity={s.fillOpacity ?? 0.2} strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={da} opacity={op} />
    }
    case 'pin': {
      const cx = s.x1 ?? 0, cy = s.y1 ?? 0
      return (
        <g opacity={op}>
          <line x1={cx} y1={cy - 5} x2={cx} y2={cy - 20} stroke={color} strokeWidth={Math.max(sw, 1.5)} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={7} fill={color} stroke="white" strokeWidth={1.5} />
          {s.text && (
            <text x={cx + 11} y={cy + 4} fill={color} fontSize={s.fontSize ?? 12}
              fontFamily={s.fontFamily ?? 'Arial, sans-serif'} fontWeight="bold">{s.text}</text>
          )}
        </g>
      )
    }
    default: return null
  }
}

function shapeBounds(s: ShapeData): { x: number; y: number; w: number; h: number } | null {
  const pad = 6
  if (s.tool === 'pin' && s.x1 !== undefined && s.y1 !== undefined) {
    return { x: s.x1 - 16, y: s.y1 - 28, w: 100, h: 40 }
  }
  if (s.x1 !== undefined && s.x2 !== undefined && s.y1 !== undefined && s.y2 !== undefined) {
    const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2)
    return { x: x - pad, y: y - pad, w: Math.abs(s.x2 - s.x1) + pad * 2, h: Math.abs(s.y2 - s.y1) + pad * 2 }
  }
  if (s.points && s.points.length > 0) {
    const xs = s.points.map(p => p[0]), ys = s.points.map(p => p[1])
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x: x - pad, y: y - pad, w: Math.max(...xs) - x + pad * 2, h: Math.max(...ys) - y + pad * 2 }
  }
  return null
}

function ShapeEl({ s, onClick, isSelected }: {
  s: ShapeData
  onClick?: (e: React.MouseEvent) => void
  isSelected?: boolean
}) {
  const content = renderShapeContent(s)
  const bounds = isSelected ? shapeBounds(s) : null
  return (
    <g
      data-shapeid={(s as AnnotationShape).id}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      {content}
      {isSelected && bounds && (
        <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h}
          fill="none" stroke="#3b82f6" strokeWidth={2} strokeDasharray="6 3" rx={3}
          pointerEvents="none" />
      )}
    </g>
  )
}

// ── Constants ─────────────────────────────────────────────────────────────────

type EditorTool = 'select' | AnnotationTool

const DRAW_TOOLS: { id: AnnotationTool; label: string; icon: React.ReactNode }[] = [
  { id: 'pen',       label: 'Freehand',   icon: <Pen size={15} /> },
  { id: 'highlight', label: 'Highlight',  icon: <Highlighter size={15} /> },
  { id: 'line',      label: 'Line',       icon: <Minus size={15} /> },
  { id: 'arrow',     label: 'Arrow',      icon: <ArrowUpRight size={15} /> },
  { id: 'polyline',  label: 'Multiline',  icon: <Route size={15} /> },
  { id: 'polygon',   label: 'Polygon',    icon: <Pentagon size={15} /> },
  { id: 'rect',      label: 'Rectangle',  icon: <Square size={15} /> },
  { id: 'ellipse',   label: 'Ellipse',    icon: <Circle size={15} /> },
  { id: 'cloud',     label: 'Cloud',      icon: <Cloud size={15} /> },
  { id: 'text',      label: 'Text',       icon: <Type size={15} /> },
  { id: 'callout',   label: 'Callout',    icon: <MessageSquare size={15} /> },
  { id: 'pin',       label: 'Pin',        icon: <MapPin size={15} /> },
]

const COLORS: string[] = [
  '#000000','#374151','#6b7280','#9ca3af','#d1d5db','#f9fafb','#7c1d1d',
  '#b91c1c','#c2410c','#15803d','#0f766e','#1d4ed8','#7e22ce','#ef4444',
  '#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#a855f7','#ec4899',
]

const WIDTHS = [
  { value: 1,  label: 'Hair' },
  { value: 2,  label: 'Thin' },
  { value: 4,  label: 'Medium' },
  { value: 8,  label: 'Thick' },
]

const LINE_STYLES = [
  { value: 'solid',  label: '—',   title: 'Solid' },
  { value: 'dashed', label: '- -', title: 'Dashed' },
  { value: 'dotted', label: '···', title: 'Dotted' },
] as const

const FONT_FAMILIES = [
  { label: 'Arial',     value: 'Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, sans-serif' },
  { label: 'Times',     value: 'Times New Roman, serif' },
  { label: 'Courier',   value: 'Courier New, monospace' },
  { label: 'Georgia',   value: 'Georgia, serif' },
]

const FONT_SIZES = [8, 10, 12, 14, 16, 18, 24, 32, 48]

const TEXT_TOOLS: AnnotationTool[] = ['text', 'callout', 'pin']
const FILL_TOOLS: AnnotationTool[] = ['rect', 'ellipse', 'cloud', 'highlight', 'polygon']
const LINE_STYLE_TOOLS: AnnotationTool[] = ['line', 'arrow', 'rect', 'ellipse', 'cloud', 'polyline', 'polygon']

// ── Editor ────────────────────────────────────────────────────────────────────

type PageSize  = { w: number; h: number }
type TextInput = { visible: false } | { visible: true; screenX: number; screenY: number; vbX: number; vbY: number }

function formatDateShort(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function dateLabel(isoDateTime: string): string {
  const d = new Date(isoDateTime)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Shared label style for sidebar sections
const SL = 'mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400'
const activeBtn = 'bg-brand-600 text-white shadow'
const inactiveBtn = 'text-slate-600 hover:bg-slate-100'

export function RedlineEditor() {
  const { fileId }   = useParams<{ fileId: string }>()
  const navigate     = useNavigate()
  const location     = useLocation()
  const {
    data,
    addAnnotation, updateAnnotation, deleteAnnotation, clearAnnotations, setAnnotationsForPage,
    addProduction, addCrewDayEntry, addPhoto,
  } = useData()

  const pending = (location.state as { pending?: PendingProduction } | null)?.pending ?? null
  const file    = data.projectFiles.find((f) => f.id === fileId)
  const project = file ? data.projects.find((p) => p.id === file.projectId) : null
  const crew    = pending ? data.crews.find((c) => c.id === pending.crewId) : null

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)

  useEffect(() => {
    if (!pending) return
    window.history.pushState({ pendingBlock: true }, '')
    const onPop = () => { window.history.pushState({ pendingBlock: true }, ''); setShowLeaveConfirm(true) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [pending])

  useEffect(() => {
    if (!pending) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [pending])

  // ── PDF state ──
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [pdf, setPdf]             = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum]     = useState(1)
  const [totalPages, setTotal]    = useState(0)
  const [pageSize, setPageSize]   = useState<PageSize>({ w: 612, h: 792 })
  const [rendering, setRendering] = useState(false)

  // ── Tool & style state ──
  const [tool,      setTool]      = useState<EditorTool>('select')
  const [color,     setColor]     = useState('#ef4444')
  const [width,     setWidth]     = useState(2)
  const [lineStyle, setLineStyle] = useState<'solid' | 'dashed' | 'dotted'>('solid')

  const [fontSize,          setFontSize]          = useState(18)
  const [fontFamily,        setFontFamily]        = useState('Arial, sans-serif')
  const [fontBold,          setFontBold]          = useState(false)
  const [fontItalic,        setFontItalic]        = useState(false)
  const [fontUnderline,     setFontUnderline]     = useState(false)
  const [fontStrikethrough, setFontStrikethrough] = useState(false)
  const [fillColor,         setFillColor]         = useState('#ffffff')
  const [fillOpacity,       setFillOpacity]       = useState(0.35)
  const [shapeOpacity,      setShapeOpacity]      = useState(1)

  // ── Selection ──
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // ── Drawing state ──
  const svgRef     = useRef<SVGSVGElement>(null)
  const [drawing,   setDrawing]   = useState(false)
  const [penPts,    setPenPts]    = useState<[number, number][]>([])
  const [draft,     setDraft]     = useState<Partial<AnnotationShape> | null>(null)
  const [textInput, setTextInput] = useState<TextInput>({ visible: false })
  const textRef    = useRef<HTMLInputElement>(null)

  // Multi-point drawing (polyline / polygon)
  const [multiPts,     setMultiPts]     = useState<[number, number][]>([])
  const [multiPreview, setMultiPreview] = useState<[number, number] | null>(null)
  const lastClickRef = useRef<{ time: number; vx: number; vy: number } | null>(null)

  // ── Session & undo/redo ──
  const sessionId   = useRef(Date.now().toString(36))
  const undoStackRef = useRef<AnnotationShape[][]>([])
  const redoStackRef = useRef<AnnotationShape[][]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const shapes = data.annotations.filter((a) => a.fileId === fileId && a.page === pageNum)
  const visibleShapes = shapes.filter(s => s.visible !== false)
  const selectedShape = shapes.find(s => s.id === selectedId) ?? null

  function saveUndoSnapshot() {
    undoStackRef.current = [...undoStackRef.current, [...shapes]].slice(-30)
    redoStackRef.current = []
    setCanUndo(true)
    setCanRedo(false)
  }

  function doUndo() {
    if (!undoStackRef.current.length) return
    const prev = undoStackRef.current.pop()!
    redoStackRef.current.push([...shapes])
    setAnnotationsForPage(fileId!, pageNum, prev)
    setSelectedId(null)
    setCanUndo(undoStackRef.current.length > 0)
    setCanRedo(true)
  }

  function doRedo() {
    if (!redoStackRef.current.length) return
    const next = redoStackRef.current.pop()!
    undoStackRef.current.push([...shapes])
    setAnnotationsForPage(fileId!, pageNum, next)
    setSelectedId(null)
    setCanUndo(true)
    setCanRedo(redoStackRef.current.length > 0)
  }

  // Keep selected shape in sync when tool switches away from select
  useEffect(() => { if (tool !== 'select') { setSelectedId(null); setMultiPts([]); setMultiPreview(null) } }, [tool])

  // When a shape is selected, sync the sidebar controls to that shape's properties
  useEffect(() => {
    if (!selectedShape) return
    setColor(selectedShape.color)
    setWidth(selectedShape.strokeWidth)
    if (selectedShape.lineStyle) setLineStyle(selectedShape.lineStyle)
    if (selectedShape.opacity) setShapeOpacity(selectedShape.opacity)
    if (selectedShape.fontSize) setFontSize(selectedShape.fontSize)
    if (selectedShape.fontFamily) setFontFamily(selectedShape.fontFamily)
    setFontBold(!!selectedShape.fontBold)
    setFontItalic(!!selectedShape.fontItalic)
    setFontUnderline(!!selectedShape.fontUnderline)
    setFontStrikethrough(!!selectedShape.fontStrikethrough)
    if (selectedShape.fillColor) setFillColor(selectedShape.fillColor)
    if (selectedShape.fillOpacity !== undefined) setFillOpacity(selectedShape.fillOpacity)
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // When editing a selected shape, push changes live
  const patch = useCallback((changes: Partial<AnnotationShape>) => {
    if (!selectedId) return
    updateAnnotation(selectedId, changes)
  }, [selectedId, updateAnnotation])

  // ── Load PDF ──
  useEffect(() => {
    if (!file || file.fileType !== 'pdf' || !fileId) return
    loadBlob(fileId).then((dataUrl) => {
      if (!dataUrl) return
      pdfjsLib.getDocument({ url: dataUrl }).promise.then((doc) => {
        setPdf(doc); setTotal(doc.numPages); setPageNum(1)
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
      canvas.width = vp.width; canvas.height = vp.height
      return page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
    }).then(() => { if (!cancelled) setRendering(false) })
      .catch(() => { if (!cancelled) setRendering(false) })
    return () => { cancelled = true }
  }, [pdf, pageNum])

  const toVb = useCallback((clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current; if (!svg) return [0, 0]
    const r = svg.getBoundingClientRect()
    return [((clientX - r.left) / r.width) * pageSize.w, ((clientY - r.top) / r.height) * pageSize.h]
  }, [pageSize])

  // Build style props for a new annotation from current sidebar state
  function currentStyleProps(): Partial<AnnotationShape> {
    const base: Partial<AnnotationShape> = {
      color, strokeWidth: width,
      lineStyle: lineStyle !== 'solid' ? lineStyle : undefined,
      opacity: shapeOpacity < 0.99 ? shapeOpacity : undefined,
      sessionId: sessionId.current,
    }
    if (['text', 'callout', 'pin'].includes(tool as string)) {
      return {
        ...base, fontSize, fontFamily,
        fontBold: fontBold || undefined, fontItalic: fontItalic || undefined,
        fontUnderline: fontUnderline || undefined, fontStrikethrough: fontStrikethrough || undefined,
        fillColor: tool === 'callout' ? fillColor : undefined,
        fillOpacity: tool === 'callout' ? fillOpacity : undefined,
      }
    }
    if (FILL_TOOLS.includes(tool as AnnotationTool)) {
      return {
        ...base,
        fillColor: tool === 'highlight' ? undefined : (fillColor || undefined),
        fillOpacity,
      }
    }
    return base
  }

  const commitText = useCallback(() => {
    if (!textInput.visible) return
    const val = textRef.current?.value.trim()
    if (val) {
      saveUndoSnapshot()
      const id = addAnnotation({
        fileId: fileId!, page: pageNum, tool: tool as AnnotationTool,
        color, strokeWidth: width,
        x1: textInput.vbX, y1: textInput.vbY, text: val,
        fontSize, fontFamily,
        fontBold: fontBold || undefined, fontItalic: fontItalic || undefined,
        fontUnderline: fontUnderline || undefined, fontStrikethrough: fontStrikethrough || undefined,
        fillColor: tool === 'callout' ? fillColor : undefined,
        fillOpacity: tool === 'callout' ? fillOpacity : undefined,
        opacity: shapeOpacity < 0.99 ? shapeOpacity : undefined,
        sessionId: sessionId.current,
        createdAt: new Date().toISOString(),
      })
      setSelectedId(id)
    }
    setTextInput({ visible: false })
  }, [textInput, fileId, pageNum, tool, color, width, fontSize, fontFamily, fontBold, fontItalic, fontUnderline, fontStrikethrough, fillColor, fillOpacity, shapeOpacity, addAnnotation]) // eslint-disable-line react-hooks/exhaustive-deps

  function finishMultiPoint() {
    if (tool !== 'polyline' && tool !== 'polygon') return
    const minPts = tool === 'polygon' ? 3 : 2
    if (multiPts.length < minPts) { setMultiPts([]); setMultiPreview(null); return }
    saveUndoSnapshot()
    const id = addAnnotation({
      fileId: fileId!, page: pageNum, tool,
      color, strokeWidth: width,
      lineStyle: lineStyle !== 'solid' ? lineStyle : undefined,
      points: tool === 'polygon' ? [...multiPts, multiPts[0]] : multiPts,
      fillColor: tool === 'polygon' ? (fillColor || undefined) : undefined,
      fillOpacity: tool === 'polygon' ? fillOpacity : undefined,
      opacity: shapeOpacity < 0.99 ? shapeOpacity : undefined,
      sessionId: sessionId.current,
      createdAt: new Date().toISOString(),
    })
    setSelectedId(id)
    setMultiPts([])
    setMultiPreview(null)
    lastClickRef.current = null
  }

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMultiPts([]); setMultiPreview(null); setTextInput({ visible: false }) }
      if (e.key === 'Enter' && (tool === 'polyline' || tool === 'polygon') && multiPts.length >= 2) finishMultiPoint()
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); doRedo() }
      if (e.key === 'Delete' && selectedId) { saveUndoSnapshot(); deleteAnnotation(selectedId); setSelectedId(null) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (textInput.visible) { commitText(); return }
    if (tool === 'select') {
      const hit = (e.target as Element).closest('[data-shapeid]')
      if (!hit) setSelectedId(null)
      return
    }

    const [vx, vy] = toVb(e.clientX, e.clientY)

    // Multi-point tools: click to add vertex, double-click to finish
    if (tool === 'polyline' || tool === 'polygon') {
      const now = Date.now()
      const last = lastClickRef.current
      const isDouble = !!last && now - last.time < 350 && Math.abs(vx - last.vx) < 10 && Math.abs(vy - last.vy) < 10
      lastClickRef.current = { time: now, vx, vy }
      if (isDouble) { finishMultiPoint(); return }
      setMultiPts(pts => [...pts, [vx, vy]])
      return
    }

    // Text / callout: click to open text box
    if (tool === 'text' || tool === 'callout') {
      const r = svgRef.current!.getBoundingClientRect()
      setTextInput({ visible: true, screenX: e.clientX - r.left, screenY: e.clientY - r.top, vbX: vx, vbY: vy })
      setTimeout(() => textRef.current?.focus(), 20)
      return
    }

    // Pin: click to place immediately
    if (tool === 'pin') {
      saveUndoSnapshot()
      addAnnotation({
        fileId: fileId!, page: pageNum, tool: 'pin',
        color, strokeWidth: width,
        x1: vx, y1: vy,
        fontSize, fontFamily,
        sessionId: sessionId.current,
        opacity: shapeOpacity < 0.99 ? shapeOpacity : undefined,
        createdAt: new Date().toISOString(),
      })
      return
    }

    // Regular drag tools
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrawing(true)
    if (tool === 'pen') setPenPts([[vx, vy]])
    else setDraft({ tool, color, strokeWidth: width, x1: vx, y1: vy, x2: vx, y2: vy })
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const [vx, vy] = toVb(e.clientX, e.clientY)
    // Update multipoint cursor preview regardless of drawing state
    if (tool === 'polyline' || tool === 'polygon') {
      setMultiPreview([vx, vy])
      return
    }
    if (!drawing) return
    if (tool === 'pen') setPenPts(pts => [...pts, [vx, vy]])
    else setDraft(d => d ? { ...d, x2: vx, y2: vy } : null)
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing) return
    setDrawing(false)
    const [vx, vy] = toVb(e.clientX, e.clientY)
    if (tool === 'pen') {
      if (penPts.length > 2) {
        saveUndoSnapshot()
        const id = addAnnotation({
          fileId: fileId!, page: pageNum, tool: 'pen', color, strokeWidth: width,
          opacity: shapeOpacity < 0.99 ? shapeOpacity : undefined,
          points: penPts, sessionId: sessionId.current, createdAt: new Date().toISOString(),
        })
        setSelectedId(id)
      }
      setPenPts([])
    } else if (draft) {
      const fin = { ...draft, x2: vx, y2: vy }
      const dx = Math.abs((fin.x2 ?? 0) - (fin.x1 ?? 0)), dy = Math.abs((fin.y2 ?? 0) - (fin.y1 ?? 0))
      if (dx > 4 || dy > 4) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { fileId: _f, page: _p, ...rest } = fin as AnnotationShape
        saveUndoSnapshot()
        const id = addAnnotation({ ...rest, ...currentStyleProps(), fileId: fileId!, page: pageNum, createdAt: new Date().toISOString() })
        setSelectedId(id)
      }
      setDraft(null)
    }
  }

  // ── Save & Complete ──
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
    if (pending.photos?.length) {
      await Promise.all(pending.photos.map(async (ph) => {
        const blobKey = 'pb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
        await saveBlob(blobKey, ph.preview)
        addPhoto({ projectId: pending.projectId, caption: ph.caption || 'Production photo', category: 'progress', date: pending.date, uploadedBy: 'Field', url: 'idb:' + blobKey, productionEntryId: entryId })
      }))
    }
    navigate('/production', { replace: true })
  }

  const handleBack = () => navigate((location.state as { from?: string } | null)?.from ?? (project ? `/projects/${project.id}` : '/redline'))

  if (!file) return (
    <div className="p-10 text-center">
      <p className="text-slate-400">File not found.</p>
      <Link to="/redline" className="mt-3 inline-block text-sm text-brand-600 hover:underline">← Back to Redline</Link>
    </div>
  )
  if (file.fileType !== 'pdf') return (
    <div className="p-10 text-center">
      <p className="mb-1 text-slate-500">Redline is only available for PDF files.</p>
      <Link to="/redline" className="mt-3 inline-block text-sm text-brand-600 hover:underline">← Back</Link>
    </div>
  )

  const isTextTool  = TEXT_TOOLS.includes(tool as AnnotationTool)
  const isFillTool  = FILL_TOOLS.includes(tool as AnnotationTool)
  const isDrawTool  = tool !== 'select'
  const isLineTool  = LINE_STYLE_TOOLS.includes(tool as AnnotationTool)
  const screenFs    = (fontSize ?? 18) * ((canvasRef.current?.clientWidth ?? 612) / pageSize.w)
  const pendingSummary = pending
    ? `${formatDateShort(pending.date)} · ${project?.name ?? '—'} · ${crew?.name ?? '—'} · ${pending.footage} ft`
    : null

  const isMultiMode = tool === 'polyline' || tool === 'polygon'

  // Group marks by session date for the layer list
  const shapesByDate = shapes.reduce<Map<string, AnnotationShape[]>>((acc, s) => {
    const label = dateLabel(s.createdAt)
    if (!acc.has(label)) acc.set(label, [])
    acc.get(label)!.push(s)
    return acc
  }, new Map())

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-64px)] flex-col lg:-mx-8 lg:-my-6">

      {/* Leave confirm */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-3">
              <AlertTriangle size={22} className="shrink-0 text-amber-500" />
              <h2 className="text-base font-bold text-slate-800">Leave without saving?</h2>
            </div>
            <p className="mb-5 text-sm text-slate-500">Your production entry has <strong>not been saved yet</strong>. If you leave now those numbers will be lost. Your print markups are already saved.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowLeaveConfirm(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Stay &amp; finish</button>
              <button onClick={() => { setShowLeaveConfirm(false); navigate('/production', { replace: true }) }} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700">Leave &amp; discard</button>
            </div>
          </div>
        </div>
      )}

      {/* Pending banner */}
      {pending && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-amber-300 bg-amber-50 px-4 py-2.5">
          <div className="flex items-center gap-2.5 text-sm">
            <AlertTriangle size={18} className="shrink-0 text-amber-600" />
            <span className="font-bold text-amber-800">Production entry pending — not saved yet.</span>
            {pendingSummary && <span className="text-amber-700">{pendingSummary}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { if (confirm('Discard production entry?')) navigate('/production', { replace: true }) }}
              className="flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50">
              <X size={13} /> Discard entry
            </button>
            <button onClick={handleComplete}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-bold text-white shadow hover:bg-emerald-700">
              <CheckCircle2 size={16} /> Save &amp; Complete
            </button>
          </div>
        </div>
      )}

      {/* ── Minimal top bar ── */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm">
        <button onClick={pending ? () => setShowLeaveConfirm(true) : handleBack}
          className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="min-w-0 truncate text-sm font-semibold text-slate-700">{file.name}</div>
        {project && <span className="hidden text-xs text-slate-400 sm:block shrink-0">· {project.name}</span>}
        <div className="ml-auto flex items-center gap-2">
          {totalPages > 1 && (
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-1">
              <button onClick={() => { setPageNum(p => Math.max(1, p - 1)); setTextInput({ visible: false }) }} disabled={pageNum <= 1}
                className="flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-white disabled:opacity-40">
                <ChevronLeft size={14} />
              </button>
              <span className="px-1 text-xs text-slate-600">{pageNum}/{totalPages}</span>
              <button onClick={() => { setPageNum(p => Math.min(totalPages, p + 1)); setTextInput({ visible: false }) }} disabled={pageNum >= totalPages}
                className="flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-white disabled:opacity-40">
                <ChevronRight size={14} />
              </button>
            </div>
          )}
          <button onClick={doUndo} disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50">
            <Undo2 size={13} />
          </button>
          <button onClick={doRedo} disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50">
            <Redo2 size={13} />
          </button>
          <button onClick={() => { if (confirm(`Clear all markups on page ${pageNum}?`)) { saveUndoSnapshot(); clearAnnotations(fileId!, pageNum) } }} disabled={shapes.length === 0}
            className="flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-xs font-medium text-rose-600 disabled:opacity-40 hover:bg-rose-100">
            <Trash2 size={13} /> Clear
          </button>
          {pending && (
            <button onClick={handleComplete}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white shadow hover:bg-emerald-700">
              <CheckCircle2 size={13} /> Save &amp; Complete
            </button>
          )}
        </div>
      </div>

      {/* Multi-point instruction bar */}
      {isMultiMode && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-blue-100 bg-blue-50 px-4 py-1.5 text-xs text-blue-700">
          <span>
            {multiPts.length === 0
              ? `Click to start your ${tool}`
              : `${multiPts.length} point${multiPts.length > 1 ? 's' : ''} — click to add more · double-click or press Enter to finish`}
          </span>
          {multiPts.length >= 2 && (
            <button onClick={finishMultiPoint} className="rounded bg-blue-600 px-2.5 py-1 text-white font-medium hover:bg-blue-700">
              Finish
            </button>
          )}
          {multiPts.length > 0 && (
            <button onClick={() => { setMultiPts([]); setMultiPreview(null) }} className="text-blue-500 hover:text-blue-700">
              Cancel
            </button>
          )}
        </div>
      )}

      {/* ── Main body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Canvas */}
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
              style={{
                cursor: tool === 'select' ? 'default' : (isTextTool && tool !== 'pin' ? 'text' : isMultiMode ? 'crosshair' : 'crosshair'),
                touchAction: 'none',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {visibleShapes.map((s) => (
                <ShapeEl key={s.id} s={s}
                  isSelected={s.id === selectedId}
                  onClick={tool === 'select' ? (e) => { e.stopPropagation(); setSelectedId(s.id) } : undefined}
                />
              ))}
              {drawing && tool === 'pen' && penPts.length > 1 && (
                <path d={ptsToPath(penPts)} stroke={color} strokeWidth={width} fill="none"
                  strokeLinecap="round" strokeLinejoin="round" opacity={shapeOpacity} />
              )}
              {draft && <ShapeEl s={{ ...draft as AnnotationShape, ...currentStyleProps() }} />}

              {/* Multi-point live preview */}
              {isMultiMode && multiPts.length > 0 && (
                <g>
                  <path
                    d={ptsToPath(multiPreview ? [...multiPts, multiPreview] : multiPts)}
                    stroke={color} strokeWidth={width} fill="none"
                    strokeLinecap="round" strokeLinejoin="round"
                    strokeDasharray={dashArray(lineStyle !== 'solid' ? lineStyle : 'dashed', width) ?? '6 3'}
                    opacity={0.75}
                  />
                  {tool === 'polygon' && multiPreview && multiPts.length >= 2 && (
                    <line
                      x1={multiPreview[0]} y1={multiPreview[1]}
                      x2={multiPts[0][0]} y2={multiPts[0][1]}
                      stroke={color} strokeWidth={width} strokeDasharray="4 4" opacity={0.4}
                    />
                  )}
                  {multiPts.map(([x, y], i) => (
                    <circle key={i} cx={x} cy={y} r={3} fill={color} stroke="white" strokeWidth={1} />
                  ))}
                </g>
              )}
            </svg>
            {textInput.visible && (
              <input ref={textRef} type="text" placeholder="Type then press Enter"
                style={{
                  position: 'absolute', left: textInput.screenX, top: textInput.screenY,
                  transform: 'translateY(-50%)', fontSize: screenFs, fontFamily, color,
                  fontWeight: fontBold ? 'bold' : 'normal', fontStyle: fontItalic ? 'italic' : 'normal',
                  background: tool === 'callout' ? `${fillColor}ee` : 'rgba(255,255,255,0.9)',
                  border: `2px ${tool === 'callout' ? 'solid' : 'dashed'} ${color}`,
                  borderRadius: 4, padding: '2px 8px', outline: 'none',
                  minWidth: 140, maxWidth: 360, zIndex: 30, opacity: shapeOpacity,
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitText() }
                  if (e.key === 'Escape') setTextInput({ visible: false })
                }}
                onBlur={commitText}
              />
            )}
          </div>

          {shapes.length > 0 && (
            <p className="mt-3 text-xs text-slate-300">{shapes.length} mark{shapes.length > 1 ? 's' : ''} on this page</p>
          )}

          {pending && (
            <div className="mt-6 flex w-full max-w-lg flex-col items-center gap-2 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5 shadow">
              <CheckCircle2 size={28} className="text-emerald-500" />
              <p className="text-center text-sm font-bold text-emerald-800">Done marking up the print?</p>
              <button onClick={handleComplete} className="mt-1 w-full rounded-xl bg-emerald-600 py-3 text-base font-bold text-white shadow hover:bg-emerald-700 active:scale-95">
                Save &amp; Complete Production Entry
              </button>
              <button onClick={() => { if (confirm('Discard production entry?')) navigate('/production', { replace: true }) }} className="text-xs text-rose-400 hover:text-rose-600">
                Discard production entry (keep markups)
              </button>
            </div>
          )}
        </div>

        {/* ── Right sidebar ── */}
        <div className="flex w-56 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white">

          {/* Select / Draw tools */}
          <div className="border-b border-slate-100 p-3">
            <p className={SL}>Tool</p>
            <button
              title="Select & edit"
              onClick={() => setTool('select')}
              className={`mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition ${tool === 'select' ? activeBtn : inactiveBtn}`}
            >
              <MousePointer2 size={14} /> Select / Edit
            </button>
            <div className="grid grid-cols-3 gap-1">
              {DRAW_TOOLS.map(t => (
                <button key={t.id} title={t.label} onClick={() => setTool(t.id)}
                  className={`flex flex-col items-center gap-0.5 rounded-md px-1 py-2 text-[10px] font-medium transition ${tool === t.id ? activeBtn : inactiveBtn}`}>
                  {t.icon}
                  <span className="leading-none">{t.label.split(' ')[0]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div className="border-b border-slate-100 p-3">
            <p className={SL}>Color</p>
            <div className="grid grid-cols-7 gap-1">
              {COLORS.map(c => (
                <button key={c} title={c} onClick={() => {
                    setColor(c)
                    if (selectedId) patch({ color: c })
                  }}
                  style={{ backgroundColor: c, outline: (c === '#f9fafb' || c === '#d1d5db') ? '1px solid #cbd5e1' : undefined }}
                  className={`h-5 w-5 rounded-sm transition-transform ${color === c ? 'scale-125 ring-2 ring-brand-500 ring-offset-1' : 'hover:scale-110'}`}
                />
              ))}
            </div>
          </div>

          {/* Stroke width */}
          {(isDrawTool && !isTextTool) && (
            <div className="border-b border-slate-100 p-3">
              <p className={SL}>Stroke</p>
              <div className="flex gap-1">
                {WIDTHS.map(w => (
                  <button key={w.value} title={w.label} onClick={() => {
                      setWidth(w.value)
                      if (selectedId) patch({ strokeWidth: w.value })
                    }}
                    className={`flex flex-1 items-center justify-center rounded-md py-2 transition ${width === w.value ? activeBtn : inactiveBtn}`}>
                    <div className="rounded-full bg-current" style={{ width: Math.min(w.value * 3, 22), height: Math.min(w.value * 3, 22) }} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Line style */}
          {(isDrawTool && isLineTool) && (
            <div className="border-b border-slate-100 p-3">
              <p className={SL}>Line Style</p>
              <div className="flex gap-1">
                {LINE_STYLES.map(ls => (
                  <button key={ls.value} title={ls.title} onClick={() => {
                      setLineStyle(ls.value)
                      if (selectedId) patch({ lineStyle: ls.value !== 'solid' ? ls.value : undefined })
                    }}
                    className={`flex flex-1 items-center justify-center rounded-md py-1.5 font-mono text-xs transition ${lineStyle === ls.value ? activeBtn : inactiveBtn}`}>
                    {ls.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Properties panel — context sensitive */}
          {(selectedShape || (isDrawTool && (isTextTool || isFillTool))) && (
            <div className="border-b border-slate-100 p-3">

              {/* Selected shape header */}
              {selectedShape && (
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold capitalize text-slate-700">
                    {selectedShape.tool} selected
                  </p>
                  <button onClick={() => { saveUndoSnapshot(); deleteAnnotation(selectedId!); setSelectedId(null) }}
                    className="flex items-center gap-1 rounded bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600 hover:bg-rose-100">
                    <Trash2 size={10} /> Delete
                  </button>
                </div>
              )}

              {/* Stroke width for selected shapes (that aren't text) */}
              {selectedShape && !TEXT_TOOLS.includes(selectedShape.tool) && (
                <div className="mb-3">
                  <p className={SL}>Stroke</p>
                  <div className="flex gap-1">
                    {WIDTHS.map(w => (
                      <button key={w.value} title={w.label} onClick={() => { setWidth(w.value); patch({ strokeWidth: w.value }) }}
                        className={`flex flex-1 items-center justify-center rounded-md py-2 transition ${width === w.value ? activeBtn : inactiveBtn}`}>
                        <div className="rounded-full bg-current" style={{ width: Math.min(w.value * 3, 22), height: Math.min(w.value * 3, 22) }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Line style for selected shapes */}
              {selectedShape && LINE_STYLE_TOOLS.includes(selectedShape.tool) && (
                <div className="mb-3">
                  <p className={SL}>Line Style</p>
                  <div className="flex gap-1">
                    {LINE_STYLES.map(ls => (
                      <button key={ls.value} title={ls.title} onClick={() => { setLineStyle(ls.value); patch({ lineStyle: ls.value !== 'solid' ? ls.value : undefined }) }}
                        className={`flex flex-1 items-center justify-center rounded-md py-1.5 font-mono text-xs transition ${lineStyle === ls.value ? activeBtn : inactiveBtn}`}>
                        {ls.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Pin label */}
              {(selectedShape?.tool === 'pin' || tool === 'pin') && selectedShape && (
                <div className="mb-3">
                  <p className={SL}>Label</p>
                  <input
                    type="text"
                    value={selectedShape.text ?? ''}
                    onChange={e => patch({ text: e.target.value })}
                    placeholder="Pin label…"
                    className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-brand-400 focus:outline-none"
                  />
                </div>
              )}

              {/* Text style */}
              {(isTextTool && tool !== 'pin') || (selectedShape && TEXT_TOOLS.includes(selectedShape.tool) && selectedShape.tool !== 'pin') ? (
                <>
                  <p className={SL}>Text Style</p>
                  <select value={fontFamily} onChange={e => { setFontFamily(e.target.value); if (selectedId) patch({ fontFamily: e.target.value }) }}
                    className="mb-1.5 h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-brand-400 focus:outline-none">
                    {FONT_FAMILIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                  <select value={fontSize} onChange={e => { setFontSize(Number(e.target.value)); if (selectedId) patch({ fontSize: Number(e.target.value) }) }}
                    className="mb-2 h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-brand-400 focus:outline-none">
                    {FONT_SIZES.map(s => <option key={s} value={s}>{s}pt</option>)}
                  </select>
                  <div className="flex gap-1">
                    {([
                      { icon: <Bold size={12} />,          active: fontBold,          fn: () => { const v = !fontBold; setFontBold(v); if (selectedId) patch({ fontBold: v || undefined }) }, title: 'Bold' },
                      { icon: <Italic size={12} />,        active: fontItalic,        fn: () => { const v = !fontItalic; setFontItalic(v); if (selectedId) patch({ fontItalic: v || undefined }) }, title: 'Italic' },
                      { icon: <Underline size={12} />,     active: fontUnderline,     fn: () => { const v = !fontUnderline; setFontUnderline(v); if (selectedId) patch({ fontUnderline: v || undefined }) }, title: 'Underline' },
                      { icon: <Strikethrough size={12} />, active: fontStrikethrough, fn: () => { const v = !fontStrikethrough; setFontStrikethrough(v); if (selectedId) patch({ fontStrikethrough: v || undefined }) }, title: 'Strikethrough' },
                    ] as const).map(({ icon, active, fn, title }) => (
                      <button key={title} title={title} onClick={fn}
                        className={`flex flex-1 items-center justify-center rounded py-1.5 transition ${active ? activeBtn : inactiveBtn}`}>
                        {icon}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {/* Fill */}
              {(isFillTool || (selectedShape && FILL_TOOLS.includes(selectedShape.tool))) && (
                <div className="mt-3">
                  <p className={SL}>Fill</p>
                  {(tool !== 'highlight' && selectedShape?.tool !== 'highlight') && (
                    <label className="mb-2 flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                      <span className="relative flex h-7 w-7 shrink-0 overflow-hidden rounded border border-slate-300" style={{ background: fillColor }}>
                        <input type="color" value={fillColor} onChange={e => { setFillColor(e.target.value); if (selectedId) patch({ fillColor: e.target.value }) }}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                      </span>
                      Fill color
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="w-12 shrink-0">Opacity</span>
                    <input type="range" min="0" max="100" value={Math.round(fillOpacity * 100)}
                      onChange={e => { const v = Number(e.target.value) / 100; setFillOpacity(v); if (selectedId) patch({ fillOpacity: v }) }}
                      className="h-1.5 flex-1 cursor-pointer accent-brand-600" />
                    <span className="w-8 text-right">{Math.round(fillOpacity * 100)}%</span>
                  </label>
                </div>
              )}

              {/* Shape opacity */}
              {(isDrawTool || selectedShape) && tool !== 'pen' && (
                <div className="mt-3">
                  <p className={SL}>Shape Opacity</p>
                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    <input type="range" min="10" max="100" value={Math.round(shapeOpacity * 100)}
                      onChange={e => { const v = Number(e.target.value) / 100; setShapeOpacity(v); if (selectedId) patch({ opacity: v }) }}
                      className="h-1.5 flex-1 cursor-pointer accent-brand-600" />
                    <span className="w-8 text-right">{Math.round(shapeOpacity * 100)}%</span>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Shape opacity for non-text non-fill tools */}
          {isDrawTool && !isTextTool && !isFillTool && tool !== 'pen' && (
            <div className="border-b border-slate-100 p-3">
              <p className={SL}>Opacity</p>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="range" min="10" max="100" value={Math.round(shapeOpacity * 100)}
                  onChange={e => setShapeOpacity(Number(e.target.value) / 100)}
                  className="h-1.5 flex-1 cursor-pointer accent-brand-600" />
                <span className="w-8 text-right">{Math.round(shapeOpacity * 100)}%</span>
              </label>
            </div>
          )}

          {/* ── Field Audit panel (Notes / Photos / Billing) ── */}
          {selectedShape && file?.projectId && (
            <AnnotationPanel
              annotationId={selectedShape.id}
              projectId={file.projectId}
              toolName={selectedShape.tool}
              onDeleted={() => setSelectedId(null)}
            />
          )}

          {/* Marks list — grouped by date */}
          {shapes.length > 0 && (
            <div className="flex-1 p-3">
              <p className={SL}>Marks — page {pageNum}</p>
              {[...shapesByDate.entries()].reverse().map(([dateStr, group]) => (
                <div key={dateStr} className="mb-3">
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-slate-300">{dateStr}</p>
                  <div className="space-y-0.5">
                    {[...group].reverse().map(s => (
                      <div key={s.id} className={`group flex items-center gap-1 rounded px-1.5 py-1 text-xs transition ${selectedId === s.id ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                        <button
                          onClick={() => { setTool('select'); setSelectedId(s.id) }}
                          className={`flex min-w-0 flex-1 items-center gap-2 text-left ${s.visible === false ? 'opacity-40' : ''}`}
                        >
                          <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color }} />
                          <span className={`truncate capitalize ${selectedId === s.id ? 'text-brand-700' : 'text-slate-600'}`}>
                            {s.tool}{s.text ? ` — ${s.text}` : ''}
                          </span>
                        </button>
                        {/* Visibility toggle */}
                        <button
                          title={s.visible === false ? 'Show' : 'Hide'}
                          onClick={() => updateAnnotation(s.id, { visible: s.visible === false ? undefined : false })}
                          className="shrink-0 rounded p-0.5 text-slate-300 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition"
                        >
                          {s.visible === false ? <EyeOff size={11} /> : <Eye size={11} />}
                        </button>
                        {/* Delete */}
                        <button
                          title="Delete"
                          onClick={() => { saveUndoSnapshot(); deleteAnnotation(s.id); if (selectedId === s.id) setSelectedId(null) }}
                          className="shrink-0 rounded p-0.5 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {shapes.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
              <Pen size={22} className="text-slate-300" />
              <p className="text-xs text-slate-400">Pick a tool and draw on the PDF</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
