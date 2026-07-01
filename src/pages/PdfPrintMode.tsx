/**
 * PdfPrintMode — draw Work Objects directly on a PDF page (page-point coordinate
 * space), not the Leaflet map. Default entry point for PDF files; georeferencing
 * onto real lat/lng (KmzMap.tsx + GeoreferencePanel) remains available as an
 * explicit, optional, later action from this page's Advanced Tools menu.
 *
 * Reuses FieldMapToolbar / AddWorkModal / MarkupPanel completely unmodified (none
 * of them read/render `geometry`) and commitMarkup/undo-redo's exact pattern from
 * KmzMap.tsx. The only new pieces are the PDF canvas + SVG overlay renderer
 * (markupToPdfSvg.tsx) and the page-space drawing handlers below.
 */
import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronLeft, ChevronRight, AlertCircle, Loader2 } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { attemptDeleteMarkup } from '../lib/markupDelete'
import { renderPdf } from '../features/printkmz/pdf'
import { loadBlob } from '../lib/fileStore'
import { markupToPdfElement } from '../lib/markupToPdfSvg'
import type { WorkObjectTypeDef } from '../lib/workObjectTypes'
import { FieldMapToolbar, type FieldMapDrawTool } from '../components/FieldMapToolbar'
import { AddWorkModal } from '../components/AddWorkModal'
import { MarkupPanel } from '../components/MarkupPanel'
import { FEATURE_DROP_TOOLS, FEATURE_TOOL_LABELS } from '../lib/markupMeta'
import { findSnapPointFlat, collectSnapCandidates } from '../lib/snap'
import { splitLine, splitPolygon, mergeLines, unionPolygons } from '../lib/geometryOps'
import type { FieldMarkup, MarkupTool } from '../types'
import type { EditMode } from '../lib/markupLayer'

const MARKUP_COLORS = ['#ef4444', '#f97316', '#facc15', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6', '#ffffff']
const WEIGHT_OPTIONS = [
  { value: 1, label: 'XS' },
  { value: 2, label: 'Thin' },
  { value: 4, label: 'Med' },
  { value: 7, label: 'Thick' },
  { value: 12, label: 'XL' },
] as const

const DRAG_TOOLS = new Set(['pen', 'highlight', 'rect', 'ellipse', 'circle', 'arrow', 'double_arrow'])
const CLICK_ACCUM_TOOLS = new Set(['line', 'polygon', 'multi_line', 'measure', 'cloud'])

function euclideanLength(pts: [number, number][]): number {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return d
}

/** PDF points are always 72/inch — converts a page-point length to real feet using the file's scale, or null if unset. */
function feetForPageLength(pageUnits: number, scaleFeetPerInch: number | undefined): number | null {
  if (!scaleFeetPerInch) return null
  return Math.round((pageUnits / 72) * scaleFeetPerInch * 10) / 10
}

export function PdfPrintMode() {
  const { t } = useTranslation()
  const { projectId, fileId } = useParams<{ projectId: string; fileId: string }>()
  const nav = useNavigate()
  const { data, addMarkup, updateMarkup, deleteMarkup, softDeleteMarkup, updateProjectFile } = useData()
  const { activeEmployeeId } = useRole()

  const project = data.projects.find((p) => p.id === projectId)
  const file = data.projectFiles.find((f) => f.id === fileId)

  const [pageImages, setPageImages] = useState<string[]>([])
  const [pageCount, setPageCount] = useState(0)
  const [pageNum, setPageNum] = useState(0)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [activeTool, setActiveTool] = useState<FieldMapDrawTool | MarkupTool | string>('select')
  // True from the moment a Work Type is picked in Add Work through Save/Cancel of that
  // Work Object — drawing tools are locked outside this window (see FieldMapToolbar's
  // toolsLocked prop), so every new redline has to go through Add Work first.
  const [workSessionActive, setWorkSessionActive] = useState(false)
  const [activeSubtype, setActiveSubtype] = useState('pen')
  const [color, setColor] = useState('#ef4444')
  const [weight, setWeight] = useState(2)
  const [opacity, setOpacity] = useState(1)
  const fillOpacity = 0.15

  const [selectedMarkup, setSelectedMarkup] = useState<FieldMarkup | null>(null)
  const [editMode, setEditMode] = useState<EditMode>('none')
  const [panelCollapsed, setPanelCollapsed] = useState(false)

  const [addWorkModalOpen, setAddWorkModalOpen] = useState(false)
  const [addWorkMarkupId, setAddWorkMarkupId] = useState<string | null>(null)
  const addWorkModeRef = useRef(false)
  const pendingWorkTypeRef = useRef<WorkObjectTypeDef | null>(null)

  const undoStackRef = useRef<string[]>([])
  const redoStackRef = useRef<FieldMarkup[]>([])

  // Drag-tool in-progress preview (pen/highlight/rect/ellipse/circle/arrow/double_arrow)
  const [dragPreview, setDragPreview] = useState<{ tool: string; pts: [number, number][] } | null>(null)
  const dragActiveRef = useRef(false)

  // Click-accumulation in-progress points (line/polygon/multi_line/measure/cloud)
  const [accumPts, setAccumPts] = useState<[number, number][]>([])
  const [ghostPt, setGhostPt] = useState<[number, number] | null>(null)
  const downPtRef = useRef<[number, number] | null>(null)

  const [textInput, setTextInput] = useState<{ x: number; y: number; isCallout: boolean } | null>(null)
  const [textVal, setTextVal] = useState('')
  const textInputRef = useRef<HTMLInputElement>(null)

  const svgRef = useRef<SVGSVGElement>(null)

  const [scaleInput, setScaleInput] = useState('')
  useEffect(() => { setScaleInput(file?.pdfScaleFeetPerInch != null ? String(file.pdfScaleFeetPerInch) : '') }, [file?.pdfScaleFeetPerInch])

  const [snapEnabled, setSnapEnabled] = useState(false)
  const [toolSelectedIds, setToolSelectedIds] = useState<Set<string>>(new Set())
  const splitPickedIndicesRef = useRef<number[]>([])
  // Live-drag position for vertex/whole-shape/circle-radius editing — kept in local state
  // (not written to the store on every pointermove) so dragging doesn't spam updateMarkup
  // and the audit history with dozens of intermediate writes; committed once on release.
  const [vertexDrag, setVertexDrag] = useState<{ markupId: string; kind: 'vertex' | 'move' | 'radius'; index?: number; anchor: [number, number]; pt: [number, number] } | null>(null)

  // ── Load the PDF ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!fileId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    loadBlob(fileId).then(async (dataUrl) => {
      if (cancelled) return
      if (!dataUrl) { setError('Could not load the stored PDF file.'); setLoading(false); return }
      try {
        const blob = await (await fetch(dataUrl)).blob()
        const pdfFile = new File([blob], file?.name ?? 'print.pdf', { type: 'application/pdf' })
        const rendered = await renderPdf(pdfFile)
        if (cancelled) return
        setPageImages(rendered.images)
        setPageCount(rendered.pageCount)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to render PDF')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [fileId, file?.name])

  // Probe natural pixel dimensions of the current page's rendered image
  useEffect(() => {
    const img = pageImages[pageNum]
    if (!img) { setNaturalSize(null); return }
    let cancelled = false
    const probe = new Image()
    probe.onload = () => { if (!cancelled) setNaturalSize({ w: probe.naturalWidth, h: probe.naturalHeight }) }
    probe.src = img
    return () => { cancelled = true }
  }, [pageImages, pageNum])

  // Clear merge/split selection state whenever the active tool changes away from them.
  useEffect(() => {
    if (activeTool !== 'merge') setToolSelectedIds(new Set())
    if (activeTool !== 'split') splitPickedIndicesRef.current = []
  }, [activeTool])

  // Leave vertex-edit mode whenever the selection changes (or is deselected).
  useEffect(() => {
    setEditMode('none')
  }, [selectedMarkup?.id])

  const pageMarkups = (data.fieldMarkups ?? []).filter(
    (m) => m.projectId === projectId && !m.deletedAt && m.coordSpace === 'pdfPage' && m.sourceProjectFileId === fileId && m.pageIndex === pageNum,
  )

  // selectedMarkup is a point-in-time snapshot passed to MarkupPanel; some of its fields
  // (weight/opacity/lineStyle/font controls) bind directly to the prop, not local state,
  // so it must be kept fresh whenever the store changes underneath it (e.g. after editing
  // a style control) — otherwise those controls would silently show stale values.
  useEffect(() => {
    if (!selectedMarkup) return
    const fresh = (data.fieldMarkups ?? []).find((m) => m.id === selectedMarkup.id)
    if (!fresh) setSelectedMarkup(null)
    else if (fresh !== selectedMarkup) setSelectedMarkup(fresh)
  }, [data.fieldMarkups, selectedMarkup])

  // ── Screen → page-point coordinate conversion (same trick RedlineEditor used:
  // the SVG's own viewBox scaling handles zoom, only input needs converting) ──
  function toPagePt(clientX: number, clientY: number): [number, number] {
    const svg = svgRef.current
    if (!svg || !naturalSize) return [0, 0]
    const rect = svg.getBoundingClientRect()
    return [
      ((clientX - rect.left) / rect.width) * naturalSize.w,
      ((clientY - rect.top) / rect.height) * naturalSize.h,
    ]
  }

  const snapCandidates = collectSnapCandidates(pageMarkups.map((m) => m.geometry))

  function toPagePtSnapped(clientX: number, clientY: number): [number, number] {
    const pt = toPagePt(clientX, clientY)
    if (!snapEnabled) return pt
    return findSnapPointFlat(pt, snapCandidates) ?? pt
  }

  // ── Commit a completed markup (mirrors KmzMap.tsx's commitMarkup exactly) ──
  function commitMarkup(partial: Omit<FieldMarkup, 'id' | 'createdAt' | 'projectId' | 'status' | 'layer' | 'crewId' | 'createdBy' | 'updatedAt' | 'lockedAt' | 'coordSpace' | 'sourceProjectFileId' | 'pageIndex'>) {
    if (!projectId || !fileId) return
    const workObjectTypeOverride = pendingWorkTypeRef.current
      ? { workObjectType: pendingWorkTypeRef.current.id, color: pendingWorkTypeRef.current.defaultColor, unit: pendingWorkTypeRef.current.defaultUnit }
      : {}
    const id = addMarkup({
      ...partial, ...workObjectTypeOverride,
      projectId, coordSpace: 'pdfPage', sourceProjectFileId: fileId, pageIndex: pageNum,
      status: 'pending', layer: 'crew', crewId: null, createdBy: null, updatedAt: null, lockedAt: null,
    })
    undoStackRef.current.push(id)
    redoStackRef.current = []
    setTimeout(() => {
      if (addWorkModeRef.current) {
        addWorkModeRef.current = false
        pendingWorkTypeRef.current = null
        setAddWorkMarkupId(id)
        setAddWorkModalOpen(true)
        setSelectedMarkup(null)
      } else {
        const mk = (data.fieldMarkups ?? []).find((m) => m.id === id)
        if (mk) { setSelectedMarkup(mk); setPanelCollapsed(false) }
      }
    }, 50)
  }

  function startAddWork(type: WorkObjectTypeDef) {
    pendingWorkTypeRef.current = type
    addWorkModeRef.current = true
    setWorkSessionActive(true)
    setColor(type.defaultColor)
    if (type.defaultGeometry === 'polygon') setActiveTool('polygon')
    else if (type.defaultGeometry === 'line') setActiveTool('line')
    else setActiveTool(type.defaultMarkupTool)
    setActiveSubtype(type.defaultMarkupTool)
    setAddWorkModalOpen(false)
  }

  function handleSetScale() {
    if (!fileId) return
    const n = Number(scaleInput)
    updateProjectFile(fileId, { pdfScaleFeetPerInch: n > 0 ? n : undefined })
  }

  function undoLast() {
    const id = undoStackRef.current.pop()
    if (!id) return
    const snapshot = (data.fieldMarkups ?? []).find((m) => m.id === id)
    if (snapshot) redoStackRef.current.push(snapshot)
    deleteMarkup(id)
    if (selectedMarkup?.id === id) setSelectedMarkup(null)
  }

  function redoLast() {
    const snapshot = redoStackRef.current.pop()
    if (!snapshot) return
    const newId = addMarkup(snapshot)
    undoStackRef.current.push(newId)
  }

  // ── Drag-tool handlers (pen/highlight/rect/ellipse/circle/arrow/double_arrow) ──
  // Pointer Capture (not plain mouse events) so a drag that ends outside the SVG's
  // bounds still delivers its pointerup here instead of leaving the gesture stuck —
  // same fix the old RedlineEditor used. This also gives touch/pen support for free.
  function onSvgPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (textInput) { commitText(); return }
    // Defense in depth alongside the toolbar's disabled buttons — every branch below starts
    // a brand new shape, which should never be reachable outside an active Add Work session.
    if (!workSessionActive) return
    const pt = toPagePtSnapped(e.clientX, e.clientY)

    if (DRAG_TOOLS.has(activeTool as string)) {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragActiveRef.current = true
      setDragPreview({ tool: activeTool as string, pts: [pt] })
      return
    }
    if (CLICK_ACCUM_TOOLS.has(activeTool as string)) {
      e.currentTarget.setPointerCapture(e.pointerId)
      downPtRef.current = pt
      return
    }
    if (activeTool === 'point' || FEATURE_DROP_TOOLS.includes(activeTool as (typeof FEATURE_DROP_TOOLS)[number])) {
      const meta = FEATURE_TOOL_LABELS[activeTool as string]
      commitMarkup({
        tool: activeTool as MarkupTool, subtype: activeTool as string,
        color: meta?.color ?? color, weight, fillColor: null, fillOpacity: 0, opacity: 1,
        geometry: { center: pt }, label: null, fontSize: 13,
        featureType: activeTool as string, featureName: null, notes: null, lengthFt: null, quantity: null,
      })
      return
    }
    if (activeTool === 'text' || activeTool === 'callout') {
      setTextInput({ x: e.clientX, y: e.clientY, isCallout: activeTool === 'callout' })
      setTextVal('')
      setTimeout(() => textInputRef.current?.focus(), 30)
    }
  }

  function onSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const pt = toPagePtSnapped(e.clientX, e.clientY)
    if (dragActiveRef.current && dragPreview) {
      if (dragPreview.tool === 'pen' || dragPreview.tool === 'highlight') {
        setDragPreview({ ...dragPreview, pts: [...dragPreview.pts, pt] })
      } else {
        setDragPreview({ ...dragPreview, pts: [dragPreview.pts[0], pt] })
      }
      return
    }
    if (accumPts.length > 0 || downPtRef.current) setGhostPt(pt)
  }

  function onSvgPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const pt = toPagePtSnapped(e.clientX, e.clientY)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)

    if (dragActiveRef.current && dragPreview) {
      dragActiveRef.current = false
      finishDragShape(dragPreview.tool, dragPreview.pts[0], pt, dragPreview.pts)
      setDragPreview(null)
      return
    }

    if (CLICK_ACCUM_TOOLS.has(activeTool as string) && downPtRef.current) {
      const start = downPtRef.current
      downPtRef.current = null
      const moved = Math.hypot(pt[0] - start[0], pt[1] - start[1]) >= 4
      if (moved) {
        addAccumPoint(start)
        addAccumPoint(pt)
      } else {
        addAccumPoint(pt)
      }
    }
  }

  function finishDragShape(tool: string, start: [number, number], end: [number, number], pts: [number, number][]) {
    const base = {
      subtype: activeSubtype, color, weight, fillColor: color, fillOpacity, opacity,
      label: null, fontSize: 13, featureType: null, featureName: null, notes: null, quantity: null,
    }
    if (tool === 'pen' || tool === 'highlight') {
      if (pts.length < 2) return
      const feet = feetForPageLength(euclideanLength(pts), file?.pdfScaleFeetPerInch)
      commitMarkup({ ...base, tool: tool as MarkupTool, geometry: { latlngs: pts }, lengthFt: feet, quantity: feet })
    } else if (tool === 'rect') {
      commitMarkup({ ...base, tool: 'rect', geometry: { bounds: [start, end] }, lengthFt: null })
    } else if (tool === 'ellipse') {
      commitMarkup({ ...base, tool: 'ellipse', geometry: { bounds: [start, end] }, lengthFt: null })
    } else if (tool === 'circle') {
      commitMarkup({ ...base, tool: 'circle', geometry: { center: start, radius: Math.hypot(end[0] - start[0], end[1] - start[1]) }, lengthFt: null })
    } else if (tool === 'arrow' || tool === 'double_arrow') {
      const line: [number, number][] = [start, end]
      const feet = feetForPageLength(euclideanLength(line), file?.pdfScaleFeetPerInch)
      commitMarkup({ ...base, tool: tool as MarkupTool, geometry: { latlngs: line }, lengthFt: feet, quantity: feet })
    }
  }

  function addAccumPoint(pt: [number, number]) {
    // A straight line is always exactly 2 points — finish immediately on the 2nd point
    // instead of waiting for Enter/Save. finishAccumulation has side effects (setState,
    // commitMarkup), so this must NOT run inside the setAccumPts updater below — React's
    // StrictMode double-invokes updaters in dev, which would otherwise double-commit.
    if (activeTool === 'line' && accumPts.length >= 1) {
      finishAccumulation([...accumPts, pt])
      return
    }
    setAccumPts((prev) => [...prev, pt])
  }

  function finishAccumulation(ptsOverride?: [number, number][]) {
    const pts = ptsOverride ?? accumPts
    setAccumPts([])
    setGhostPt(null)
    const isMultiLine = activeTool === 'multi_line' || activeTool === 'measure' || activeTool === 'line'
    const minPts = isMultiLine ? 2 : 3
    if (pts.length < minPts) return
    const committedTool: MarkupTool = (activeTool === 'multi_line' || activeTool === 'measure' || activeTool === 'cloud' || activeTool === 'line') ? activeTool as MarkupTool : 'polygon'
    const feet = isMultiLine ? feetForPageLength(euclideanLength(pts), file?.pdfScaleFeetPerInch) : null
    commitMarkup({
      tool: committedTool, subtype: activeSubtype, color, weight,
      fillColor: color, fillOpacity, opacity,
      geometry: { latlngs: pts }, label: null, fontSize: 13,
      featureType: null, featureName: null, notes: null,
      lengthFt: feet, quantity: feet,
    })
  }

  function cancelAccumulation() {
    setAccumPts([])
    setGhostPt(null)
    downPtRef.current = null
  }

  // ── Split ────────────────────────────────────────────────────────────
  function handleSplitVertexClick(markup: FieldMarkup, idx: number) {
    const pts = markup.geometry.latlngs
    if (!pts) return
    if (markup.tool === 'polygon') {
      splitPickedIndicesRef.current.push(idx)
      if (splitPickedIndicesRef.current.length < 2) return
      const [i, j] = splitPickedIndicesRef.current
      splitPickedIndicesRef.current = []
      if (i === j) return
      const [ringA, ringB] = splitPolygon(pts, i, j)
      addMarkup({ ...markup, geometry: { latlngs: ringA }, lengthFt: null })
      addMarkup({ ...markup, geometry: { latlngs: ringB }, lengthFt: null })
      deleteMarkup(markup.id)
      setSelectedMarkup(null)
      setActiveTool('select')
    } else {
      if (idx === 0 || idx === pts.length - 1) return // must be an interior vertex
      const [lineA, lineB] = splitLine(pts, idx)
      addMarkup({ ...markup, geometry: { latlngs: lineA }, lengthFt: feetForPageLength(euclideanLength(lineA), file?.pdfScaleFeetPerInch) })
      addMarkup({ ...markup, geometry: { latlngs: lineB }, lengthFt: feetForPageLength(euclideanLength(lineB), file?.pdfScaleFeetPerInch) })
      deleteMarkup(markup.id)
      setSelectedMarkup(null)
      setActiveTool('select')
    }
  }

  // ── Merge ────────────────────────────────────────────────────────────
  function performMerge() {
    const ids = [...toolSelectedIds]
    if (ids.length !== 2) return
    const a = pageMarkups.find((mk) => mk.id === ids[0])
    const b = pageMarkups.find((mk) => mk.id === ids[1])
    if (!a || !b || !a.geometry.latlngs?.length || !b.geometry.latlngs?.length || a.tool !== b.tool) return

    if (a.tool === 'polygon') {
      const rings = unionPolygons(a.geometry.latlngs, b.geometry.latlngs)
      for (const ring of rings) addMarkup({ ...a, geometry: { latlngs: ring }, lengthFt: null })
    } else {
      const merged = mergeLines(a.geometry.latlngs, b.geometry.latlngs)
      addMarkup({ ...a, geometry: { latlngs: merged }, lengthFt: feetForPageLength(euclideanLength(merged), file?.pdfScaleFeetPerInch) })
    }
    deleteMarkup(a.id)
    deleteMarkup(b.id)
    setToolSelectedIds(new Set())
    setActiveTool('select')
  }

  // ── Vertex Edit ──────────────────────────────────────────────────────
  // Mirrors markupLayer.ts's buildEditHandles, but as plain SVG circles with pointer
  // capture instead of draggable Leaflet markers. The live position lives in local
  // `vertexDrag` state (not the store) while dragging — only committed once on release,
  // same reasoning as commitMarkup: avoid spamming updateMarkup/the audit log per frame.
  function applyVertexDragPreview(m: FieldMarkup, drag: NonNullable<typeof vertexDrag>): FieldMarkup {
    const geo = m.geometry
    if (drag.kind === 'vertex' && geo.latlngs && drag.index != null) {
      const next = geo.latlngs.map((p, i) => (i === drag.index ? drag.pt : p))
      return { ...m, geometry: { ...geo, latlngs: next } }
    }
    if (drag.kind === 'radius' && geo.center) {
      return { ...m, geometry: { ...geo, radius: Math.hypot(drag.pt[0] - geo.center[0], drag.pt[1] - geo.center[1]) } }
    }
    if (drag.kind === 'move') {
      const dx = drag.pt[0] - drag.anchor[0], dy = drag.pt[1] - drag.anchor[1]
      const next = { ...geo }
      if (geo.latlngs) next.latlngs = geo.latlngs.map(([x, y]) => [x + dx, y + dy] as [number, number])
      if (geo.bounds) next.bounds = [[geo.bounds[0][0] + dx, geo.bounds[0][1] + dy], [geo.bounds[1][0] + dx, geo.bounds[1][1] + dy]]
      if (geo.center) next.center = [geo.center[0] + dx, geo.center[1] + dy]
      return { ...m, geometry: next }
    }
    return m
  }

  function handleStart(kind: 'vertex' | 'move' | 'radius', markupId: string, anchor: [number, number], index?: number) {
    setVertexDrag({ markupId, kind, index, anchor, pt: anchor })
  }
  function handleMove(e: React.PointerEvent) {
    if (!vertexDrag) return
    e.stopPropagation()
    setVertexDrag({ ...vertexDrag, pt: toPagePtSnapped(e.clientX, e.clientY) })
  }
  function handleEnd(e: React.PointerEvent, m: FieldMarkup) {
    e.stopPropagation()
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!vertexDrag) return
    const updated = applyVertexDragPreview(m, vertexDrag)
    updateMarkup(m.id, { geometry: updated.geometry })
    setVertexDrag(null)
  }

  function renderEditHandles(m: FieldMarkup, geo: FieldMarkup['geometry']) {
    const dot = (cx: number, cy: number, color: string, onDown: () => void) => (
      <circle
        cx={cx} cy={cy} r={9} fill={color} stroke="#fff" strokeWidth={2} style={{ cursor: 'move' }}
        onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); onDown() }}
        onPointerMove={handleMove}
        onPointerUp={(e) => handleEnd(e, m)}
      />
    )
    if (geo.latlngs?.length) {
      return geo.latlngs.map(([x, y], idx) => (
        <g key={idx}>{dot(x, y, '#3b82f6', () => handleStart('vertex', m.id, [x, y], idx))}</g>
      ))
    }
    if (geo.center && geo.radius != null) {
      const [cx, cy] = geo.center
      return (
        <>
          {dot(cx, cy, '#3b82f6', () => handleStart('move', m.id, [cx, cy]))}
          {dot(cx + geo.radius, cy, '#f59e0b', () => handleStart('radius', m.id, [cx, cy]))}
        </>
      )
    }
    const anchor = geo.latlngs?.[0] ?? geo.bounds?.[0] ?? geo.center ?? null
    if (!anchor) return null
    return dot(anchor[0], anchor[1], '#22c55e', () => handleStart('move', m.id, anchor))
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (accumPts.length === 0) return
      if (e.key === 'Enter') { e.preventDefault(); finishAccumulation() }
      else if (e.key === 'Escape') { e.preventDefault(); cancelAccumulation() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accumPts])

  function commitText() {
    if (!textInput || !textVal.trim()) { setTextInput(null); return }
    const pt = toPagePt(textInput.x, textInput.y)
    commitMarkup({
      tool: (textInput.isCallout ? 'callout' : 'text') as MarkupTool, subtype: activeSubtype,
      color, weight, fillColor: null, fillOpacity: 0, opacity: 1,
      geometry: { center: pt }, label: textVal, fontSize: 13,
      featureType: null, featureName: null, notes: null, lengthFt: null, quantity: null,
    })
    setTextInput(null)
    setTextVal('')
  }

  if (!project || !file) {
    return (
      <div className="p-10 text-center text-slate-500">
        <p>Project or file not found.</p>
        <button onClick={() => nav(`/kmz/${projectId}`)} className="mt-3 text-sm text-brand-400 hover:underline">Back to Field Map</button>
      </div>
    )
  }

  const currentImage = pageImages[pageNum]

  return (
    <div className="-mx-4 -my-6 lg:-mx-6 flex flex-col overflow-hidden bg-[#0a0a0a]" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Top bar */}
      <div className="flex items-center shrink-0 h-11 border-b border-[#1e1e1e] bg-[#0a0a0a] px-3 gap-2">
        <button onClick={() => nav(`/kmz/${projectId}`)} className="rounded p-1 text-slate-500 hover:text-slate-300 hover:bg-white/5 transition shrink-0">
          <ArrowLeft size={14} />
        </button>
        <span className="text-[12px] font-medium text-slate-300 truncate">{file.name}</span>
        <span className="text-[10px] text-amber-500 bg-amber-950/40 rounded px-1.5 py-0.5 shrink-0">{t('pdfPrintMode.badge')}</span>
        {pageCount > 1 && (
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <button onClick={() => setPageNum((p) => Math.max(0, p - 1))} disabled={pageNum === 0} className="rounded p-1 text-slate-500 hover:text-slate-300 disabled:opacity-30">
              <ChevronLeft size={14} />
            </button>
            <span className="text-[11px] text-slate-400">{t('pdfPrintMode.page', { n: pageNum + 1, total: pageCount })}</span>
            <button onClick={() => setPageNum((p) => Math.min(pageCount - 1, p + 1))} disabled={pageNum === pageCount - 1} className="rounded p-1 text-slate-500 hover:text-slate-300 disabled:opacity-30">
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <FieldMapToolbar
        activeTool={activeTool}
        onSelectTool={(tool) => { setActiveTool(tool); cancelAccumulation(); if (tool === 'highlight') { setColor('#facc15'); setWeight(14); setOpacity(0.4) } }}
        onAddWork={() => { setAddWorkMarkupId(null); setAddWorkModalOpen(true) }}
        editMode={editMode}
        canVertexEdit={!!selectedMarkup && !selectedMarkup.lockedAt}
        onToggleVertexEdit={() => setEditMode((m) => (m === 'vertices' ? 'none' : 'vertices'))}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled((s) => !s)}
        onUndo={undoLast}
        onRedo={redoLast}
        onDelete={() => {
          if (!selectedMarkup) return
          const billingLines = (data.markupBilling ?? []).filter((b) => b.markupId === selectedMarkup.id)
          const result = attemptDeleteMarkup(selectedMarkup, billingLines, softDeleteMarkup, activeEmployeeId)
          if (!result.ok && result.message) alert(result.message)
          else if (result.ok) setSelectedMarkup(null)
        }}
        canDelete={!!selectedMarkup && !selectedMarkup.lockedAt}
        onSave={() => finishAccumulation()}
        canSave={accumPts.length > 0}
        canMerge={toolSelectedIds.size === 2}
        onMerge={performMerge}
        toolsLocked={!workSessionActive}
        advancedToolsChildren={
          <div className="px-3 py-2">
            <label className="block text-[10px] font-medium text-slate-400 mb-1">Page scale — 1 inch =</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number" min={0} step="any" value={scaleInput}
                onChange={(e) => setScaleInput(e.target.value)}
                placeholder="e.g. 50"
                className="w-16 rounded border border-[#2a3347] bg-[#141414] px-1.5 py-1 text-[11px] text-slate-200 outline-none"
              />
              <span className="text-[10px] text-slate-500">ft</span>
              <button onClick={handleSetScale} className="ml-auto rounded bg-brand-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-brand-500">
                Set
              </button>
            </div>
            <p className="mt-1.5 text-[9px] text-slate-600">Drawn line lengths auto-fill from this scale once set.</p>
          </div>
        }
      />

      {/* Style presets */}
      <div className="flex items-center gap-2 border-b border-[#1e1e1e] bg-[#0a0a0a] px-3 py-1.5 overflow-x-auto shrink-0">
        <div className="flex items-center gap-1 shrink-0">
          {MARKUP_COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} title={c}
              className={`h-4 w-4 rounded-full border-2 transition shrink-0 ${color === c ? 'border-white scale-110' : 'border-transparent hover:scale-110'}`}
              style={{ background: c, boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px #555' : undefined }} />
          ))}
        </div>
        <div className="h-3 w-px bg-[#2a2a2a] shrink-0" />
        <div className="flex items-center gap-0.5 shrink-0">
          {WEIGHT_OPTIONS.map(({ value, label }) => (
            <button key={value} onClick={() => setWeight(value)} className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${weight === value ? 'bg-[#2a3347] text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>{label}</button>
          ))}
        </div>
        <div className="h-3 w-px bg-[#2a2a2a] shrink-0" />
        <select value={opacity} onChange={(e) => setOpacity(Number(e.target.value))}
          className="rounded border border-[#2a3347] bg-[#141414] px-1.5 py-0.5 text-[10px] outline-none shrink-0">
          {[1, 0.75, 0.5, 0.25].map((o) => <option key={o} value={o}>{Math.round(o * 100)}%</option>)}
        </select>
        <span className="ml-auto text-[10px] text-slate-600 shrink-0">{pageMarkups.length} work object{pageMarkups.length === 1 ? '' : 's'} on this page</span>
      </div>

      {/* Canvas */}
      <div className="relative flex-1 overflow-auto flex items-start justify-center bg-[#050505]">
        {loading && (
          <div className="flex flex-col items-center gap-2 py-20 text-slate-500">
            <Loader2 size={24} className="animate-spin" />
            <p className="text-[12px]">Rendering PDF…</p>
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center gap-2 py-20 text-red-400">
            <AlertCircle size={24} />
            <p className="text-[12px]">{error}</p>
          </div>
        )}
        {!loading && !error && currentImage && naturalSize && (
          <div className="relative" style={{ width: '100%', maxWidth: naturalSize.w }}>
            <img src={currentImage} className="w-full select-none" draggable={false} alt={`${file.name} page ${pageNum + 1}`} />
            <svg
              ref={svgRef}
              viewBox={`0 0 ${naturalSize.w} ${naturalSize.h}`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
              style={{ cursor: activeTool === 'select' ? 'default' : 'crosshair', touchAction: 'none' }}
              onPointerDown={onSvgPointerDown}
              onPointerMove={onSvgPointerMove}
              onPointerUp={onSvgPointerUp}
              onClick={(e) => {
                if (activeTool !== 'select' && activeTool !== 'merge') return
                // The click target is the leaf shape (e.g. <polyline>), not the <g data-markup-id>
                // wrapper around it — walk up to find it, same as the old RedlineEditor's hit-test.
                const hit = (e.target as Element).closest('[data-markup-id]')
                const id = hit?.getAttribute('data-markup-id') ?? null
                if (activeTool === 'merge') {
                  if (!id) return
                  setToolSelectedIds((prev) => {
                    const next = new Set(prev)
                    if (next.has(id)) next.delete(id); else next.add(id)
                    return next
                  })
                  return
                }
                setSelectedMarkup(id ? (pageMarkups.find((m) => m.id === id) ?? null) : null)
              }}
            >
              {pageMarkups.map((m) => {
                const displayMarkup = vertexDrag?.markupId === m.id ? applyVertexDragPreview(m, vertexDrag) : m
                const showVertexHandles = editMode === 'vertices' && selectedMarkup?.id === m.id && !m.lockedAt
                const showSplitHandles = activeTool === 'split' && selectedMarkup?.id === m.id && !!m.geometry.latlngs?.length
                const geo = displayMarkup.geometry
                return (
                  <g key={m.id}>
                    <g data-markup-id={m.id} style={{ cursor: activeTool === 'select' || activeTool === 'merge' ? 'pointer' : undefined }}
                      opacity={selectedMarkup?.id === m.id ? 1 : 0.92}>
                      {markupToPdfElement(displayMarkup)}
                    </g>
                    {activeTool === 'merge' && toolSelectedIds.has(m.id) && (
                      <circle
                        cx={geo.center?.[0] ?? geo.latlngs?.[0]?.[0] ?? geo.bounds?.[0]?.[0] ?? 0}
                        cy={geo.center?.[1] ?? geo.latlngs?.[0]?.[1] ?? geo.bounds?.[0]?.[1] ?? 0}
                        r={10} fill="none" stroke="#f97316" strokeWidth={2} pointerEvents="none"
                      />
                    )}
                    {showVertexHandles && renderEditHandles(m, geo)}
                    {showSplitHandles && geo.latlngs!.map(([x, y], idx) => (
                      <circle
                        key={idx} cx={x} cy={y} r={7} fill="#f97316" stroke="#fff" strokeWidth={2} style={{ cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); handleSplitVertexClick(m, idx) }}
                      />
                    ))}
                  </g>
                )
              })}
              {dragPreview && dragPreview.pts.length > 0 && (
                <g opacity={0.8} pointerEvents="none">
                  {(dragPreview.tool === 'pen' || dragPreview.tool === 'highlight') && dragPreview.pts.length >= 2 && (
                    <polyline points={dragPreview.pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={weight} />
                  )}
                  {dragPreview.tool === 'rect' && dragPreview.pts.length >= 2 && (
                    <rect
                      x={Math.min(dragPreview.pts[0][0], dragPreview.pts[1][0])} y={Math.min(dragPreview.pts[0][1], dragPreview.pts[1][1])}
                      width={Math.abs(dragPreview.pts[1][0] - dragPreview.pts[0][0])} height={Math.abs(dragPreview.pts[1][1] - dragPreview.pts[0][1])}
                      fill={color} fillOpacity={fillOpacity} stroke={color} strokeWidth={weight}
                    />
                  )}
                  {(dragPreview.tool === 'circle') && dragPreview.pts.length >= 2 && (
                    <circle cx={dragPreview.pts[0][0]} cy={dragPreview.pts[0][1]} r={Math.hypot(dragPreview.pts[1][0] - dragPreview.pts[0][0], dragPreview.pts[1][1] - dragPreview.pts[0][1])} fill={color} fillOpacity={fillOpacity} stroke={color} strokeWidth={weight} />
                  )}
                  {(dragPreview.tool === 'ellipse') && dragPreview.pts.length >= 2 && (
                    <rect
                      x={Math.min(dragPreview.pts[0][0], dragPreview.pts[1][0])} y={Math.min(dragPreview.pts[0][1], dragPreview.pts[1][1])}
                      width={Math.abs(dragPreview.pts[1][0] - dragPreview.pts[0][0])} height={Math.abs(dragPreview.pts[1][1] - dragPreview.pts[0][1])}
                      fill="none" stroke={color} strokeWidth={1} strokeDasharray="4 4"
                    />
                  )}
                  {(dragPreview.tool === 'arrow' || dragPreview.tool === 'double_arrow') && dragPreview.pts.length >= 2 && (
                    <line x1={dragPreview.pts[0][0]} y1={dragPreview.pts[0][1]} x2={dragPreview.pts[1][0]} y2={dragPreview.pts[1][1]} stroke={color} strokeWidth={weight} />
                  )}
                </g>
              )}
              {accumPts.length > 0 && (
                <g opacity={0.85} pointerEvents="none">
                  <polyline
                    points={[...accumPts, ...(ghostPt ? [ghostPt] : [])].map((p) => p.join(',')).join(' ')}
                    fill="none" stroke={color} strokeWidth={weight}
                  />
                  <circle cx={accumPts[0][0]} cy={accumPts[0][1]} r={5} fill={color} stroke="#fff" strokeWidth={1.5} />
                </g>
              )}
            </svg>
            {textInput && (
              <input
                ref={textInputRef}
                value={textVal}
                onChange={(e) => setTextVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextInput(null) }}
                onBlur={commitText}
                placeholder={textInput.isCallout ? 'Callout text…' : 'Type label…'}
                className="absolute z-10 rounded border border-red-500/60 bg-[#0d0d0d]/95 px-2 py-1 text-xs text-white outline-none shadow-lg"
                style={{ left: textInput.x, top: textInput.y - 14, color, caretColor: color, minWidth: 120 }}
              />
            )}
          </div>
        )}
      </div>

      <AddWorkModal
        open={addWorkModalOpen}
        projectId={projectId ?? ''}
        markupId={addWorkMarkupId}
        onPickType={startAddWork}
        onClose={() => { setAddWorkModalOpen(false); setAddWorkMarkupId(null); setActiveTool('select'); setWorkSessionActive(false) }}
      />

      {selectedMarkup && !panelCollapsed && (
        <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm lg:static lg:w-80 lg:shrink-0 lg:max-w-none border-l border-[#1e1e1e]">
          <MarkupPanel
            markup={selectedMarkup}
            onClose={() => setSelectedMarkup(null)}
            onDelete={() => setSelectedMarkup(null)}
            editMode={editMode}
            onSetEditMode={setEditMode}
          />
        </div>
      )}
    </div>
  )
}
