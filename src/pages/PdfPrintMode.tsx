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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronLeft, ChevronRight, AlertCircle, Loader2, ZoomIn, ZoomOut, Maximize2, Search, Settings, Download } from 'lucide-react'
import { CalloutSettingsPopover } from '../components/CalloutSettingsPopover'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { useMarkupDeleteFlow } from '../lib/markupDelete'
import { isTypingTarget } from '../lib/domGuards'
import { resolveActorId, createdByActorId } from '../lib/actorId'
import { renderPdf, getPdfLogicalPageSizes, getPdfPageGeometry } from '../features/printkmz/pdf'
import { openPdfDocument, renderViewportRegion, isRenderCancelledError } from '../lib/mapCuts/render'
import { transformGeometryToOutput, transformGeometryToMaster, geometryIntersectsBox, type SyncContext } from '../lib/mapCuts/boxTransform'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { loadBlob } from '../lib/fileStore'
import { markupToPdfElement } from '../lib/markupToPdfSvg'
import { buildWorkObjectCalloutContent, geometryAnchor } from '../lib/workObjectCallout'
import type { CalloutContent } from '../lib/workObjectCallout'
import { getCalloutDisplaySettings } from '../lib/calloutDisplaySettings'
import { getSavedCalloutOffset, saveCalloutOffset } from '../lib/calloutPosition'
import { FieldMapExportDialog } from '../components/FieldMapExportDialog'
import type { FieldMapExportOptions } from '../lib/fieldMapExportOptions'
import { filterMarkupsForExport } from '../lib/fieldMapExportFilters'
import type { ExportFilterCriteria } from '../lib/fieldMapExportFilters'
import { exportPdfPrintModeReport } from '../lib/pdfPrintModeExport'
import type { SummaryReportMode } from '../lib/fieldMapExport'
import { relevantToolsForWorkType, WORK_OBJECT_TYPE_MAP, isCommentAnnotation } from '../lib/workObjectTypes'
import type { WorkObjectTypeDef } from '../lib/workObjectTypes'
import { FieldMapToolbar, type FieldMapDrawTool } from '../components/FieldMapToolbar'
import { AddWorkModal } from '../components/AddWorkModal'
import { MarkupPanel } from '../components/MarkupPanel'
import { WorkObjectPropertiesPanel } from '../components/WorkObjectPropertiesPanel'
import { NonBillableLinePropertiesPanel } from '../components/NonBillableLinePropertiesPanel'
import { MarkupQuickActions } from '../components/MarkupQuickActions'
import { PdfCalloutOverlay } from '../components/PdfCalloutOverlay'
import { MarkupDeleteConfirm } from '../components/MarkupDeleteConfirm'
import { FEATURE_DROP_TOOLS, FEATURE_TOOL_LABELS } from '../lib/markupMeta'
import { ENGINEERING_SYMBOL_MAP, ENGINEERING_POINT_TOOLS, ENGINEERING_LINE_TOOLS } from '../lib/engineeringSymbols'
import { findSnapPointFlat, collectSnapCandidates } from '../lib/snap'
import { splitLine, splitPolygon, mergeLines, unionPolygons } from '../lib/geometryOps'
import type { FieldMarkup, MarkupTool, WorkObjectTypeId } from '../types'
import type { EditMode } from '../lib/markupLayer'
import { isWorkHiddenFromSession } from '../lib/markupNav'

const MARKUP_COLORS = ['#ef4444', '#f97316', '#facc15', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6', '#ffffff']
const WEIGHT_OPTIONS = [
  { value: 1, label: 'XS' },
  { value: 2, label: 'Thin' },
  { value: 4, label: 'Med' },
  { value: 7, label: 'Thick' },
  { value: 12, label: 'XL' },
] as const

const DRAG_TOOLS = new Set(['pen', 'highlight', 'rect', 'ellipse', 'circle', 'arrow', 'double_arrow', 'direction_arrow'])
// Engineering symbol line tools draw via click-accumulation like 'line' (2-point,
// auto-finish) — excludes 'direction_arrow', which is drag-based (see DRAG_TOOLS above).
const LINE_ACCUM_SYMBOL_TOOLS = new Set<MarkupTool>(ENGINEERING_LINE_TOOLS.filter((t) => t !== 'direction_arrow'))
const CLICK_ACCUM_TOOLS = new Set<string>(['line', 'polygon', 'multi_line', 'measure', 'cloud', ...LINE_ACCUM_SYMBOL_TOOLS])
/** relevantToolsForWorkType's generic per-geometry fallbacks — used to detect whether a
 * Work Type has been migrated to a real engineering symbol catalog (see startAddWork). */
const GENERIC_FIRST_TOOLS = new Set(['point', 'line', 'polygon', 'rect', 'multi_line', 'pen', 'measure', 'callout'])

// 0.5 used to be the floor for manual zoom-out too, which meant a tall/oversized
// print whose auto-fit needed to go lower than 50% simply couldn't — the user
// was stuck scrolling to see the rest of the page no matter what they clicked.
// Lowered so both the auto-fit-on-load calculation below and the manual zoom-out
// button can shrink a very tall print far enough to show the whole thing at once.
const ZOOM_MIN = 0.1
// Safe to raise freely now that the render itself is viewport-cropped (see
// hiResCrop below) rather than whole-page — cost is bounded by
// MAX_CROP_CANVAS_DIM regardless of how high this goes, unlike the old
// whole-page sharpen where a higher ceiling directly meant a bigger, slower
// render every time.
const ZOOM_MAX = 30
const ZOOM_STEP = 0.25
// Each double-click multiplies zoom by this factor (rather than adding a
// fixed amount) so it feels consistent whether you're at 100% or 1500% —
// and repeated double-clicking on the same spot keeps zooming in further,
// same as a map app.
const DOUBLE_CLICK_ZOOM_FACTOR = 2
// See hiResCrop's doc comment (below, inside the component) for the full
// reasoning — two whole-page approaches were tried and both failed (blurry,
// then freezing) before landing on cropping to just the visible region.
// MAX_CROP_CANVAS_DIM bounds a crop render to roughly a couple of screens'
// worth of pixels — independent of zoom level or the underlying page's own
// size/complexity, which is what makes this fast at any zoom on any print.
const MAX_CROP_CANVAS_DIM = 3200
// Extra margin rendered around the strictly-visible rect, as a fraction of
// the visible rect's own size — lets a small pan or zoom nudge keep using
// the existing crop instead of re-rendering immediately.
const CROP_PADDING_FRAC = 0.5
// A crop is only replaced once the visible region has moved meaningfully
// outside the current one, OR the zoom level needs meaningfully more
// resolution than what's already rendered — this hysteresis is what stops a
// slow, continuous zoom or scroll gesture from triggering a new render on
// every tick along the way.
const CROP_RESOLUTION_SLACK = 1.15
const CROP_DEBOUNCE_MS = 300

/** A sharp on-demand render of just the visible region of the current page —
 * see the hiResCrop state doc comment in the component for the full
 * reasoning. fracLeft/fracTop/fracWidth/fracHeight are in naturalSize-space
 * fractions (0-1) of the page, so the resulting image can be positioned with
 * plain CSS percentages inside the same transformed page box as the base
 * image/SVG, with zero extra coordinate math. scalePxPerPt records the
 * render's own device-pixels-per-PDF-point density, purely so a later re-run
 * can tell whether the current crop is still sharp enough or needs replacing. */
interface HiResCrop {
  pageIndex: number
  fracLeft: number; fracTop: number; fracWidth: number; fracHeight: number
  scalePxPerPt: number
  url: string
}

/** Pixel movement during a Select-mode mousedown→mouseup below this is treated as a click
 * (select/deselect), not a pan drag — mirrors KmzMap.tsx's DRAG_PLACE_THRESHOLD_PX pattern. */
const PAN_DRAG_THRESHOLD_PX = 6

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
  const location = useLocation()
  const { data, addMarkup, updateMarkup, deleteMarkup, softDeleteMarkup, updateProjectFile } = useData()
  const { role, activeEmployeeId, activeSubcontractorId, activeSupervisorEmployeeId } = useRole()
  // Supervisor and subcontractor sessions each keep their own separate
  // identity from In-House view (see RoleContext's doc comment and
  // lib/actorId.ts) — this is the id recorded as "who did this" for any
  // edit a session makes below.
  const effectiveActorId = resolveActorId(role, activeEmployeeId, activeSupervisorEmployeeId, activeSubcontractorId)

  const project = data.projects.find((p) => p.id === projectId)
  const file = data.projectFiles.find((f) => f.id === fileId)

  const [pageImages, setPageImages] = useState<string[]>([])
  const [pageCount, setPageCount] = useState(0)
  const [pageNum, setPageNum] = useState(0)

  // Map Cut redline sync — set only when this file was generated by Map Cuts
  // (file.sourceMapCutPackageId points back at the package that produced it).
  // A cut piece has no redlines of its own: every write goes to the MASTER's
  // sourceProjectFileId+pageIndex identity, transformed through the box's own
  // geometry (see src/lib/mapCuts/boxTransform.ts); reads pull the master's
  // markups back out, transformed the other way and filtered to this box's
  // region. "cutPieceCtx" resolves which package/box/master this page is;
  // "syncCtx" additionally needs the master's own page geometry (one extra,
  // cheap PDF page-open) before any transform math can run.
  const cutPieceCtx = useMemo(() => {
    if (!file?.sourceMapCutPackageId) return null
    const pkg = data.mapCutPackages.find((p) => p.id === file.sourceMapCutPackageId)
    if (!pkg || !pkg.sourceProjectFileId) return null // ad-hoc source (never a real ProjectFile) — nothing to sync to
    const box = [...pkg.boxes].sort((a, b) => a.order - b.order)[pageNum]
    if (!box) return null
    // MapCutPackage.sourcePageIndex is 1-based (pdf.js convention); FieldMarkup.pageIndex is 0-based.
    return { pkg, box, masterFileId: pkg.sourceProjectFileId, masterPageIndex: pkg.sourcePageIndex - 1 }
  }, [file?.sourceMapCutPackageId, data.mapCutPackages, pageNum])

  const [masterGeom, setMasterGeom] = useState<{ pointSize: { w: number; h: number }; naturalSize: { w: number; h: number } } | null>(null)
  useEffect(() => {
    if (!cutPieceCtx) { setMasterGeom(null); return }
    let cancelled = false
    setMasterGeom(null)
    loadBlob(cutPieceCtx.masterFileId).then(async (dataUrl) => {
      if (cancelled || !dataUrl) return
      const blob = await (await fetch(dataUrl)).blob()
      const masterFile = new File([blob], 'master.pdf', { type: 'application/pdf' })
      const geom = await getPdfPageGeometry(masterFile, cutPieceCtx.pkg.sourcePageIndex)
      if (!cancelled) setMasterGeom(geom)
    })
    return () => { cancelled = true }
  }, [cutPieceCtx])

  // Fixed legacy-formula pixel size per page — see the load effect below for
  // why this, not the displayed image's own resolution, drives naturalSize.
  const [logicalPageSizes, setLogicalPageSizes] = useState<{ w: number; h: number }[]>([])
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const syncCtx: SyncContext | null = useMemo(() => {
    if (!cutPieceCtx || !masterGeom || !naturalSize) return null
    return { pkg: cutPieceCtx.pkg, box: cutPieceCtx.box, masterPagePt: masterGeom.pointSize, masterNaturalSize: masterGeom.naturalSize, outputNaturalSize: naturalSize }
  }, [cutPieceCtx, masterGeom, naturalSize])
  const toMasterGeo = useCallback(
    (geo: FieldMarkup['geometry']) => (syncCtx ? transformGeometryToMaster(syncCtx, geo) : geo),
    [syncCtx],
  )

  // Backs the lazy per-page sharpen effect below — an already-open pdf.js
  // document (so re-rasterizing a page doesn't re-parse the whole file every
  // time) plus a small cache of its PDFPageProxy objects, and the in-flight
  // RenderTask so a superseded render can be genuinely canceled (stops the
  // browser's rasterization work, not just discarded after the fact).
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null)
  const pdfPagesRef = useRef<Map<number, PDFPageProxy>>(new Map())
  const renderTaskRef = useRef<RenderTask | null>(null)
  // pageImages (the upfront batch render) is deliberately cheap/fast — see
  // the load effect below — so it loads instantly even for a big multi-sheet
  // set. It stays on screen permanently as the base/fallback layer.
  //
  // hiResCrop is a sharp on-demand render of ONLY the region of the page
  // currently visible on screen (plus a margin), overlaid on top of that base
  // image — never the whole page. Two whole-page approaches were tried before
  // this and both failed in opposite ways: a fixed resolution cap read as
  // blurry on an oversized real print once zoomed in (the pixel budget was
  // spent once, for the whole page, so zooming in just stretched it further);
  // scaling that resolution up with zoom fixed the blur but reintroduced the
  // original freezing bug, because "whole page at very high resolution" is
  // fundamentally an unbounded amount of rendering work — it grows with the
  // page's own size/complexity, not with how much you're actually looking at.
  // Cropping to the visible region decouples the two: the rendered canvas
  // size is bounded by the SCREEN (MAX_CROP_CANVAS_DIM below), regardless of
  // how large, complex, or zoomed-in the underlying page is — so it's cheap
  // and fast at any zoom level, on any print, while still rendering directly
  // from the vector source at whatever resolution the current zoom needs.
  // Does not touch naturalSize/logicalPageSizes at all, so it carries zero
  // risk to redline positions — same "display image is independent of
  // coordinate space" principle as the DPI fix.
  const [hiResCrop, setHiResCrop] = useState<HiResCrop | null>(null)

  // Zoom/pan applied as a CSS transform on the canvas wrapper — toPagePt's
  // getBoundingClientRect()-based conversion already reflects it, so no coordinate
  // math elsewhere needs to change for either of these.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  // Provisional reset on page/file change — pageFitZoom (below, once container
  // + page dimensions are known) then takes over so the newly-opened page
  // lands fully visible instead of at a literal 100% that may cut it off.
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [pageNum, fileId])
  function zoomIn() { setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100)) }
  function zoomOut() { setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100)) }
  function resetView() { setZoom(pageFitZoom); setPan({ x: 0, y: 0 }) }

  // Double-click-to-zoom: zoom in centered on wherever you clicked, and keep
  // that same point under the cursor after zooming — click it again to zoom
  // in further, same as a map app. pendingRecenterRef carries the clicked
  // point through to the layout effect below (which runs right after the
  // zoom change lands and the page's on-screen size has actually updated) —
  // native scroll (not the pan/zoom transform) is what repositions the
  // content, matching how this page already scrolls for everything else
  // (see canvasScrollRef's own doc comment). Restricted to the Select tool
  // so it can never interfere with the click-accumulation drawing tools
  // (line/polygon/etc.), which already do their own manual double-click
  // detection for finishing a shape — see lastAccumClickRef's doc comment.
  const pendingRecenterRef = useRef<{ clientX: number; clientY: number; fracX: number; fracY: number } | null>(null)
  function onCanvasDoubleClick(e: React.MouseEvent) {
    if (activeTool !== 'select') return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    pendingRecenterRef.current = {
      clientX: e.clientX, clientY: e.clientY,
      fracX: (e.clientX - rect.left) / rect.width, fracY: (e.clientY - rect.top) / rect.height,
    }
    setZoom((z) => Math.min(ZOOM_MAX, Math.round(z * DOUBLE_CLICK_ZOOM_FACTOR * 100) / 100))
  }
  useLayoutEffect(() => {
    const pending = pendingRecenterRef.current
    if (!pending) return
    pendingRecenterRef.current = null
    const svg = svgRef.current
    const container = canvasScrollRef.current
    if (!svg || !container) return
    const rect = svg.getBoundingClientRect()
    const newScreenX = rect.left + pending.fracX * rect.width
    const newScreenY = rect.top + pending.fracY * rect.height
    container.scrollLeft += newScreenX - pending.clientX
    container.scrollTop += newScreenY - pending.clientY
  }, [zoom])
  // Scrolling past the top/bottom edge of the current page turns the page —
  // continuous-scroll like a document reader, replacing the Prev/Next
  // buttons for the common case. Ordinary scroll in the middle of a (zoomed)
  // page is untouched, and landingScrollEdgeRef (consumed by the effect
  // below) puts the new page's scroll position at the edge you scrolled
  // in from — top when advancing, bottom when going back — so the motion
  // reads as one continuous page rather than jumping back to the top.
  const lastPageTurnRef = useRef(0)
  const landingScrollEdgeRef = useRef<'top' | 'bottom' | null>(null)
  function onCanvasWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      if (e.deltaY < 0) zoomIn(); else if (e.deltaY > 0) zoomOut()
      return
    }
    const el = canvasScrollRef.current
    if (!el || e.deltaY === 0) return
    const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= 2
    const atTop = el.scrollTop <= 2
    const now = Date.now()
    if (now - lastPageTurnRef.current < 500) return // one page turn per scroll gesture, not per wheel tick
    if (e.deltaY > 0 && atBottom && pageNum < pageCount - 1) {
      lastPageTurnRef.current = now
      landingScrollEdgeRef.current = 'top'
      setPageNum((p) => Math.min(pageCount - 1, p + 1))
    } else if (e.deltaY < 0 && atTop && pageNum > 0) {
      lastPageTurnRef.current = now
      landingScrollEdgeRef.current = 'bottom'
      setPageNum((p) => Math.max(0, p - 1))
    }
  }
  useEffect(() => {
    const edge = landingScrollEdgeRef.current
    if (!edge) return
    landingScrollEdgeRef.current = null
    const el = canvasScrollRef.current
    if (!el) return
    // Run after the new page's image has painted so scrollHeight is correct.
    requestAnimationFrame(() => { el.scrollTop = edge === 'top' ? 0 : el.scrollHeight })
  }, [pageNum])

  const [activeTool, setActiveTool] = useState<FieldMapDrawTool | MarkupTool | string>('select')
  // null outside an active Add Work session — the toolbar shows only Select+Add Work, and
  // the pointer-down guard below refuses to start a new shape. Non-null from the moment a
  // Work Type is picked through Save/Cancel of that Work Object: holds the curated tool list
  // for the toolbar to show.
  const [sessionTools, setSessionTools] = useState<FieldMapDrawTool[] | null>(null)
  const [activeSubtype, setActiveSubtype] = useState('pen')
  const [color, setColor] = useState('#ef4444')
  const [weight, setWeight] = useState(2)
  const [opacity, setOpacity] = useState(1)
  const fillOpacity = 0.15

  const [selectedMarkup, setSelectedMarkup] = useState<FieldMarkup | null>(null)
  // Keep the selected markup in sync with the store — without this, editing a
  // field in WorkObjectPropertiesPanel updates data.fieldMarkups correctly (the
  // callout re-renders live, since it reads `data` fresh) but every input in the
  // panel itself, being bound to this stale snapshot, would keep showing its
  // pre-edit value until the panel is closed and reopened.
  useEffect(() => {
    if (!selectedMarkup) return
    const fresh = (data.fieldMarkups ?? []).find((m) => m.id === selectedMarkup.id)
    if (fresh && fresh !== selectedMarkup) setSelectedMarkup(fresh)
  }, [data.fieldMarkups, selectedMarkup])
  // Work Objects get the small floating WorkObjectPropertiesPanel instead of the
  // big MarkupPanel sidebar — see its render block further down.
  const isSelectedWorkObject = !!selectedMarkup?.workObjectType
  // Non-Billable Items get their own small floating panel (cosmetic fields only) —
  // mutually exclusive with isSelectedWorkObject (a markup is never both).
  const isSelectedNonBillable = selectedMarkup?.tool === 'non_billable_line'
  // Defense-in-depth safety net: every click path into selectedMarkup (canvas
  // hit-test, callout tap, search results, sidebar) already refuses to select
  // a redline outside what this session can see — this just makes sure no
  // detail panel can render even if selectedMarkup somehow ends up set to one
  // anyway (e.g. a stale deep-link). Mirrors KmzMap.tsx's identical guard.
  const isRestrictedForSession = !!selectedMarkup && isWorkHiddenFromSession(role, activeSubcontractorId, selectedMarkup)
  const [editMode, setEditMode] = useState<EditMode>('none')
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [showCalloutSettings, setShowCalloutSettings] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [openTabRequest, setOpenTabRequest] = useState<{ tab: 'notes' | 'photos' | 'billing'; nonce: number } | null>(null)
  const deleteFlow = useMarkupDeleteFlow(softDeleteMarkup, effectiveActorId)
  function requestDeleteMarkup(m: FieldMarkup) {
    const billingLines = (data.markupBilling ?? []).filter((b) => b.markupId === m.id)
    deleteFlow.requestDelete(m, billingLines)
  }
  function confirmDeleteMarkup() {
    const deletedId = deleteFlow.pendingDelete?.id
    deleteFlow.confirmDelete()
    if (deletedId && selectedMarkup?.id === deletedId) setSelectedMarkup(null)
  }

  const [addWorkModalOpen, setAddWorkModalOpen] = useState(false)
  const [addWorkMarkupId, setAddWorkMarkupId] = useState<string | null>(null)
  const addWorkModeRef = useRef(false)
  const pendingWorkTypeRef = useRef<WorkObjectTypeDef | null>(null)
  // Armed by startNonBillableLine, consumed once by the next commitMarkup — unlike
  // pendingWorkTypeRef/addWorkModeRef, this deliberately does NOT reopen the wizard
  // afterward (see commitMarkup below), so finishing the line is the entire flow.
  const nonBillableModeRef = useRef(false)
  // Armed by startSequentialAnnotation and startAddWork's comment-annotation
  // branch — same "skip the wizard" shape as nonBillableModeRef, but holds
  // which quick-annotation type (sequential: Fiber Tick Mark/Loop/Snow Shoe,
  // or comment: Restoration/QA-QC/Damage Report/Other/Anchor-Down Guy) to tag
  // the result with instead of leaving it type-less.
  const quickAnnotationTypeRef = useRef<WorkObjectTypeId | null>(null)

  const undoStackRef = useRef<string[]>([])
  const redoStackRef = useRef<FieldMarkup[]>([])

  // Drag-tool in-progress preview (pen/highlight/rect/ellipse/circle/arrow/double_arrow)
  const [dragPreview, setDragPreview] = useState<{ tool: string; pts: [number, number][] } | null>(null)
  const dragActiveRef = useRef(false)

  // Click-and-drag panning while in Select mode — works regardless of Add Work session state
  // (pan/select are base controls). Disambiguated from a click-to-select/deselect by
  // PAN_DRAG_THRESHOLD_PX: a real drag suppresses the click event that follows.
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const wasPanDragRef = useRef(false)

  // Click-accumulation in-progress points (line/polygon/multi_line/measure/cloud)
  const [accumPts, setAccumPts] = useState<[number, number][]>([])
  const [ghostPt, setGhostPt] = useState<[number, number] | null>(null)
  const downPtRef = useRef<[number, number] | null>(null)
  // Manual double-click-to-finish detection — this page has no native dblclick handler
  // at all (only Enter/Save previously finished a shape), and KmzMap.tsx's equivalent
  // Leaflet-based drawing showed the native 'dblclick' DOM event is unreliable in a
  // custom-pointer-handling context like this one, so track click timing/position
  // ourselves instead of adding a dblclick listener that might not fire.
  const lastAccumClickRef = useRef<{ time: number; pt: [number, number] } | null>(null)

  const [textInput, setTextInput] = useState<{ x: number; y: number; isCallout: boolean } | null>(null)
  const [textVal, setTextVal] = useState('')
  const textInputRef = useRef<HTMLInputElement>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  // The canvas container scrolls natively (plain wheel = "scroll-to-pan", see
  // onCanvasWheel) rather than through the pan/zoom React state — so the
  // quick-actions toolbar and callout overlays below, which only re-measure
  // svgRef's getBoundingClientRect() when pan/zoom/selection change, went
  // stale mid-scroll: their fixed screen position never updated, so they
  // visibly floated away from the shape they're anchored to as the page
  // scrolled underneath them. scrollTick bumps on every scroll frame (rAF
  // throttled) so both anchor effects below re-measure and stay pinned.
  const canvasScrollRef = useRef<HTMLDivElement>(null)
  const [scrollTick, setScrollTick] = useState(0)
  useEffect(() => {
    const el = canvasScrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; setScrollTick((t) => t + 1) })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [])

  // The page's own image/SVG shrink to fit whenever this scroll container is
  // narrower than the page's full naturalSize.w (very common for an
  // oversized print on a normal screen) — that shrink happens invisibly,
  // inside the <img>'s own layout and the markup <svg>'s viewBox, with no
  // corresponding CSS transform on any ancestor. The callout overlay lives
  // outside both of those (a plain HTML sibling with no viewBox concept), so
  // without correcting for this it places its leader line/box using
  // un-shrunk coordinates while the redline itself renders shrunk — the
  // callout drifts further from its target the more the page has to shrink
  // to fit. calloutFitScale is that missing shrink factor, applied as an
  // explicit extra transform in the JSX below.
  const [containerWidth, setContainerWidth] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  useEffect(() => {
    const el = canvasScrollRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect?.width) setContainerWidth(rect.width)
      if (rect?.height) setContainerHeight(rect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const calloutFitScale = naturalSize && containerWidth ? Math.min(1, containerWidth / naturalSize.w) : 1

  // The page already shrinks to fit the container's WIDTH automatically (see
  // calloutFitScale's doc comment above) — but nothing accounted for HEIGHT,
  // so a tall/portrait print (or a short browser window) routinely rendered
  // taller than the visible viewport, cutting the bottom off and forcing the
  // user to manually zoom out to see the whole thing every time they opened
  // a print. pageFitZoom is the additional zoom factor (on top of the
  // automatic width shrink) needed so the FULL page — width and height —
  // lands inside the viewport on load, on every role that opens a print via
  // this same page (admin, field, supervisor, subcontractor all share this
  // component). Only ever shrinks (capped at 1) — a page that already fits
  // at 100% is left alone rather than zoomed in to fill empty space.
  //
  // Reads logicalPageSizes[pageNum] directly rather than the naturalSize
  // state: naturalSize is itself derived from logicalPageSizes by a separate
  // effect one render behind pageNum, which would make the one-shot apply
  // effect below fire on stale (previous page's) dimensions during a page
  // turn and then never get a chance to correct itself (see its own comment).
  const currentPageSize = logicalPageSizes[pageNum] ?? null
  const pageFitZoom = (() => {
    if (!currentPageSize || !containerWidth || !containerHeight) return 1
    const widthShrink = Math.min(1, containerWidth / currentPageSize.w)
    const displayedHeightAtZoom1 = currentPageSize.h * widthShrink
    if (displayedHeightAtZoom1 <= containerHeight) return 1
    return Math.max(ZOOM_MIN, Math.round((containerHeight / displayedHeightAtZoom1) * 100) / 100)
  })()
  // Applies pageFitZoom exactly once per page/file load — not on every
  // window resize or re-render — so it doesn't fight a zoom level the user
  // then picks by hand. currentPageSize/containerWidth/containerHeight are
  // populated asynchronously (PDF render + ResizeObserver), so this can't
  // just live in the pageNum/fileId reset effect above; it waits for
  // pageFitZoom to actually be computable for the page currently on screen.
  const fitZoomAppliedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!currentPageSize || !containerWidth || !containerHeight) return
    const key = `${fileId}:${pageNum}`
    if (fitZoomAppliedForRef.current === key) return
    fitZoomAppliedForRef.current = key
    setZoom(pageFitZoom)
  }, [currentPageSize, containerWidth, containerHeight, fileId, pageNum, pageFitZoom])

  const [scaleInput, setScaleInput] = useState('')
  useEffect(() => { setScaleInput(file?.pdfScaleFeetPerInch != null ? String(file.pdfScaleFeetPerInch) : '') }, [file?.pdfScaleFeetPerInch])

  const [markupSearch, setMarkupSearch] = useState('')

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
        setHiResCrop(null)
        renderTaskRef.current?.cancel()
        renderTaskRef.current = null
        pdfPagesRef.current = new Map()
        const prevDoc = pdfDocRef.current
        pdfDocRef.current = null
        void prevDoc?.destroy()
        // No OCR cost here, just rendering plan sheets for viewing/markup — a
        // multi-sheet construction print set can easily run past the OCR
        // flow's conservative default, so use a much higher ceiling. This
        // batch render stays at the cheap legacy scale for every page — see
        // the progressive sharpen effect below for how the page actually on
        // screen gets a sharper on-demand version without paying that cost
        // for every page in a big set up front.
        const [rendered, logicalSizes, doc] = await Promise.all([
          renderPdf(pdfFile, undefined, 200),
          getPdfLogicalPageSizes(pdfFile, 200),
          openPdfDocument(pdfFile),
        ])
        if (cancelled) { void doc.destroy(); return }
        pdfDocRef.current = doc
        setPageImages(rendered.images)
        setPageCount(rendered.pageCount)
        setLogicalPageSizes(logicalSizes)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to render PDF')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
      pdfPagesRef.current = new Map()
      const doc = pdfDocRef.current
      pdfDocRef.current = null
      void doc?.destroy()
    }
  }, [fileId, file?.name])

  // naturalSize is the fixed legacy-formula size (see load effect above), NOT
  // the displayed image's own resolution — deliberately not derived from
  // pageImages here.
  useEffect(() => {
    setNaturalSize(logicalPageSizes[pageNum] ?? null)
  }, [logicalPageSizes, pageNum])

  // Sharpen just the region of the page actually on screen — see hiResCrop's
  // doc comment above for why this replaced two earlier whole-page attempts.
  // Debounced (CROP_DEBOUNCE_MS) so rapid page-flipping, zooming, or
  // scrolling doesn't render every intermediate step just to throw it away,
  // and genuinely cancels an in-flight render (not just discards its result)
  // if superseded before it finishes — a real pdf.js RenderTask.cancel(),
  // which actually stops the browser's rasterization work instead of
  // letting it run to completion pointlessly. Only ever swaps which image is
  // displayed; naturalSize/logicalPageSizes (and therefore every redline's
  // position) are completely untouched by this effect.
  useEffect(() => {
    const logical = logicalPageSizes[pageNum]
    const doc = pdfDocRef.current
    const svg = svgRef.current
    const container = canvasScrollRef.current
    if (!logical || !doc || !pageImages[pageNum] || !svg || !container) return

    // svgRef's own on-screen rect already reflects EVERY transform currently
    // applied to the page (pan, zoom, the automatic container-fit shrink) —
    // reading it directly is simpler and more robust than re-deriving the
    // same thing analytically from zoom/pan/calloutFitScale by hand.
    const svgRect = svg.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    if (svgRect.width === 0 || svgRect.height === 0) return

    const visLeft = Math.max(svgRect.left, containerRect.left)
    const visTop = Math.max(svgRect.top, containerRect.top)
    const visRight = Math.min(svgRect.right, containerRect.right)
    const visBottom = Math.min(svgRect.bottom, containerRect.bottom)
    if (visRight <= visLeft || visBottom <= visTop) return // page isn't actually on screen right now

    let fracLeft = (visLeft - svgRect.left) / svgRect.width
    let fracTop = (visTop - svgRect.top) / svgRect.height
    let fracRight = (visRight - svgRect.left) / svgRect.width
    let fracBottom = (visBottom - svgRect.top) / svgRect.height
    const padX = (fracRight - fracLeft) * CROP_PADDING_FRAC
    const padY = (fracBottom - fracTop) * CROP_PADDING_FRAC
    fracLeft = Math.max(0, fracLeft - padX)
    fracTop = Math.max(0, fracTop - padY)
    fracRight = Math.min(1, fracRight + padX)
    fracBottom = Math.min(1, fracBottom + padY)
    const fracWidth = fracRight - fracLeft
    const fracHeight = fracBottom - fracTop

    const dpr = window.devicePixelRatio || 1
    // Device pixels per PDF point the crop should render at to look crisp at
    // the current zoom — legacyScaleVal (naturalSize units per PDF point) is
    // computed inside the render callback below, once the page's own base
    // viewport is available; scale gets finalized there.
    const targetScaleBasis = calloutFitScale * zoom * dpr

    const cur = hiResCrop
    const alreadyCovers = cur
      && cur.pageIndex === pageNum
      && fracLeft >= cur.fracLeft - 1e-6 && fracTop >= cur.fracTop - 1e-6
      && fracLeft + fracWidth <= cur.fracLeft + cur.fracWidth + 1e-6
      && fracTop + fracHeight <= cur.fracTop + cur.fracHeight + 1e-6
    // Hysteresis — only replace the current crop once the visible region has
    // actually moved outside it, or zoom needs meaningfully more resolution
    // than what's already rendered. Without this, a slow continuous zoom or
    // scroll re-renders (and cancels) on every tick along the way, which is
    // wasted work and is what made zooming/scrolling feel sluggish before.
    if (alreadyCovers && cur && targetScaleBasis <= cur.scalePxPerPt * CROP_RESOLUTION_SLACK) return

    const targetPageNum = pageNum
    const timer = setTimeout(() => {
      void (async () => {
        try {
          let page = pdfPagesRef.current.get(targetPageNum)
          if (!page) {
            page = await doc.getPage(targetPageNum + 1)
            pdfPagesRef.current.set(targetPageNum, page)
          }
          const baseViewport = page.getViewport({ scale: 1 })
          const legacyScaleVal = logical.w / baseViewport.width
          let scale = legacyScaleVal * targetScaleBasis

          const ptX0 = (fracLeft * logical.w) / legacyScaleVal
          const ptY0 = (fracTop * logical.h) / legacyScaleVal
          const ptW = (fracWidth * logical.w) / legacyScaleVal
          const ptH = (fracHeight * logical.h) / legacyScaleVal

          let outputWidthPx = ptW * scale
          let outputHeightPx = ptH * scale
          const maxDim = Math.max(outputWidthPx, outputHeightPx)
          if (maxDim > MAX_CROP_CANVAS_DIM) {
            const shrink = MAX_CROP_CANVAS_DIM / maxDim
            scale *= shrink
            outputWidthPx *= shrink
            outputHeightPx *= shrink
          }

          renderTaskRef.current?.cancel()
          const handle = renderViewportRegion(page, {
            scale, regionXPx: ptX0 * scale, regionYPx: ptY0 * scale,
            outputWidthPx: Math.floor(outputWidthPx), outputHeightPx: Math.floor(outputHeightPx),
          })
          renderTaskRef.current = handle.renderTask
          await handle.promise
          if (renderTaskRef.current === handle.renderTask) renderTaskRef.current = null
          setHiResCrop({
            pageIndex: targetPageNum, fracLeft, fracTop, fracWidth, fracHeight,
            scalePxPerPt: targetScaleBasis, url: handle.canvas.toDataURL('image/jpeg', 0.85),
          })
        } catch (err) {
          // Canceled (superseded by a newer render) — expected, not an error.
          // Anything else — best-effort — keep showing whatever's already displayed.
          if (!isRenderCancelledError(err)) { /* swallow */ }
        }
      })()
    }, CROP_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      renderTaskRef.current?.cancel()
    }
  }, [pageNum, logicalPageSizes, pageImages, zoom, calloutFitScale, scrollTick, hiResCrop])

  // Clear merge/split selection state whenever the active tool changes away from them.
  useEffect(() => {
    if (activeTool !== 'merge') setToolSelectedIds(new Set())
    if (activeTool !== 'split') splitPickedIndicesRef.current = []
  }, [activeTool])

  // Leave vertex-edit mode whenever the selection changes (or is deselected).
  useEffect(() => {
    setEditMode('none')
  }, [selectedMarkup?.id])

  // Memoized — this is a dependency of the callout/quick-actions position
  // effects below. A plain .filter() here would produce a new array
  // reference on every single render regardless of whether the underlying
  // markups actually changed, which made those effects re-fire (and call
  // their setState) on every render — an infinite render loop that React's
  // "Maximum update depth exceeded" safety net was silently capping,
  // leaving the callouts' last-computed position stale/inconsistent with
  // the real DOM whenever a render got cut off mid-settle (exactly the
  // "floating outside the print" symptom on page change / scroll).
  const pageMarkups = useMemo(() => {
    // Cut piece: no redlines of its own — read the MASTER's markups instead,
    // keep only the ones actually inside this box's crop region, and
    // transform each for display in this page's own coordinate space. Every
    // markup below still carries its real (master) id — only `geometry` is a
    // locally-transformed display copy.
    if (syncCtx && cutPieceCtx) {
      return (data.fieldMarkups ?? [])
        .filter((m) => m.projectId === projectId && !m.deletedAt && m.coordSpace === 'pdfPage'
          && m.sourceProjectFileId === cutPieceCtx.masterFileId && m.pageIndex === cutPieceCtx.masterPageIndex)
        .filter((m) => geometryIntersectsBox(syncCtx, m.geometry))
        .map((m) => ({ ...m, geometry: transformGeometryToOutput(syncCtx, m.geometry) }))
    }
    return (data.fieldMarkups ?? []).filter(
      (m) => m.projectId === projectId && !m.deletedAt && m.coordSpace === 'pdfPage' && m.sourceProjectFileId === fileId && m.pageIndex === pageNum,
    )
  }, [data.fieldMarkups, projectId, fileId, pageNum, syncCtx, cutPieceCtx])
  // A restricted session must never interact with a redline outside what
  // it's allowed to see, here in PDF Print Mode exactly as on the Leaflet
  // Field Map (KmzMap.tsx) — visible for situational awareness, but
  // completely inert: no click, no callout detail, no panel. Permitted work
  // stays fully interactive. See isWorkHiddenFromSession for the exact rule.
  const isOtherWork = useCallback(
    (m: FieldMarkup): boolean => isWorkHiddenFromSession(role, activeSubcontractorId, m),
    [role, activeSubcontractorId],
  )
  // Every page's markups for this file, not just the one currently on screen —
  // used by the paginated "Download PDF" export, which needs no page navigation
  // since pageImages already holds every page's rendered image up front.
  const allFileMarkups = (data.fieldMarkups ?? []).filter(
    (m) => m.projectId === projectId && !m.deletedAt && m.coordSpace === 'pdfPage' && m.sourceProjectFileId === fileId,
  )

  // All of this file's Work Objects across every page — search reaches beyond just the
  // current page, since the whole point is finding something you don't already have open.
  const fileMarkups = (data.fieldMarkups ?? []).filter(
    (m) => m.projectId === projectId && !m.deletedAt && m.coordSpace === 'pdfPage' && m.sourceProjectFileId === fileId,
  )
  const searchResults = markupSearch.trim()
    ? fileMarkups.filter((m) => {
        // A subcontractor session can't search up someone else's redline
        // either — its name/notes would leak through the results list even
        // without opening anything.
        if (isOtherWork(m)) return false
        const q = markupSearch.trim().toLowerCase()
        return (m.featureName ?? '').toLowerCase().includes(q) ||
          (m.label ?? '').toLowerCase().includes(q) ||
          (m.notes ?? '').toLowerCase().includes(q)
      })
    : []

  function goToSearchResult(m: FieldMarkup) {
    setPageNum(m.pageIndex ?? 0)
    setSelectedMarkup(m)
    setMarkupSearch('')
  }

  // Redline QA/QC Approval Workflow — arriving from the /qa-review admin
  // page, a notification, or a dashboard's "Open on Map" action, when the
  // redline being reviewed lives on a PDF print rather than the Leaflet
  // Field Map. Jumps straight to the right page, selects it, and scrolls it
  // into view — mirrors KmzMap.tsx's flyToMarkup/focusMarkupId handling, the
  // equivalent deep link for this page's own coordinate space.
  useEffect(() => {
    const focusMarkupId = (location.state as { focusMarkupId?: string } | null)?.focusMarkupId
    if (!focusMarkupId) return
    const m = (data.fieldMarkups ?? []).find((mk) => mk.id === focusMarkupId)
    if (!m) return
    setPageNum(m.pageIndex ?? 0)
    setSelectedMarkup(m)
    setPanelCollapsed(false)
    const t = setTimeout(() => {
      document.querySelector(`[data-markup-id="${m.id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    }, 250)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Arriving from the Subcontractor Dashboard's "+ New Report" on the Splice
  // Enclosure Sheet Template card, when that project's splice print is a PDF
  // rather than the raw Leaflet map — mirrors KmzMap.tsx's equivalent
  // startAddWork location.state handling for this page's own coordinate space.
  useEffect(() => {
    const startAddWorkType = (location.state as { startAddWork?: string } | null)?.startAddWork
    if (!startAddWorkType || !(startAddWorkType in WORK_OBJECT_TYPE_MAP)) return
    startAddWork(WORK_OBJECT_TYPE_MAP[startAddWorkType as WorkObjectTypeId])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // ── Floating quick-actions toolbar position — the inverse of toPagePt, re-measured
  // whenever pan/zoom/selection change (pan/zoom already move the SVG in the DOM; this
  // just re-reads its resulting bounding rect rather than tracking Leaflet events). ──
  const [quickActionsAnchor, setQuickActionsAnchor] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !naturalSize || !selectedMarkup) { setQuickActionsAnchor(null); return }
    const geo = selectedMarkup.geometry
    const anchor = geo.center ?? geo.latlngs?.[0] ?? geo.bounds?.[0]
    if (!anchor) { setQuickActionsAnchor(null); return }
    const rect = svg.getBoundingClientRect()
    setQuickActionsAnchor({
      x: rect.left + (anchor[0] / naturalSize.w) * rect.width,
      y: rect.top + (anchor[1] / naturalSize.h) * rect.height,
    })
  }, [selectedMarkup, naturalSize, pan, zoom, scrollTick])

  // ── Callout screen-fixed overlay anchors — same ratio-mapping trick as
  // quickActionsAnchor above, one per visible callout OR Work Object on this page.
  // Unlike every other markup type, these render outside the zoom-scaled SVG
  // entirely (see PdfCalloutOverlay) so they stay a constant, readable size at any
  // zoom. Manual callouts (tool==='callout') show their own free-typed label; every
  // Work Object (has a workObjectType) gets an automatic, always-live companion
  // callout computed fresh from its current fields (see workObjectCallout.ts). ──
  const calloutOffsetsRef = useRef<Map<string, { offsetX: number; offsetY: number }>>(new Map())
  const [calloutAnchors, setCalloutAnchors] = useState<
    { markup: FieldMarkup; boxX: number; boxY: number; targetX: number; targetY: number; scale: number; text: string; content: CalloutContent | null; showInlineDelete: boolean; interactive: boolean }[]
  >([])
  // The component stays mounted across a fileId change (navigating from a cut
  // piece to its master, or between pieces, is just a route-param change) —
  // clear the in-memory offset cache so a stale, wrong-view offset can't leak
  // into the newly-opened file the same way the persisted store used to (see
  // calloutPosition.ts).
  useEffect(() => { calloutOffsetsRef.current = new Map() }, [fileId])
  // targetX/targetY are now plain naturalSize-space coordinates, not screen
  // pixels — the callout renders inside the same pan/zoom-transformed div as
  // the page itself now (see the JSX below), so no screen-rect/ratio math is
  // needed here at all, and this no longer needs to re-run on every pan/zoom
  // tick the way the old screen-anchored version did.
  useEffect(() => {
    if (!naturalSize) { setCalloutAnchors([]); return }
    const candidates = pageMarkups
      .map((m) => ({ m, anchor: m.tool === 'callout' ? geometryAnchor(m.geometry) : (m.workObjectType ? geometryAnchor(m.geometry) : null) }))
      .filter((c): c is { m: FieldMarkup; anchor: [number, number] } => !!c.anchor)
    const calloutSettings = getCalloutDisplaySettings()
    setCalloutAnchors(candidates.map(({ m, anchor }) => {
      const [targetX, targetY] = anchor
      const saved = calloutOffsetsRef.current.get(m.id) ?? getSavedCalloutOffset(fileId ?? '', m.id) ?? { offsetX: 40, offsetY: -60 }
      if (!calloutOffsetsRef.current.has(m.id)) calloutOffsetsRef.current.set(m.id, saved)
      const isManual = m.tool === 'callout'
      const restricted = isOtherWork(m)
      const fullContent = isManual ? null : buildWorkObjectCalloutContent(m, data, calloutSettings)
      return {
        markup: m, boxX: targetX + saved.offsetX, boxY: targetY + saved.offsetY, targetX, targetY,
        scale: m.calloutScale ?? 1,
        text: isManual ? (m.label ?? '') : '',
        content: restricted && fullContent ? { title: fullContent.title, rows: [] } : fullContent,
        showInlineDelete: isManual && !restricted,
        interactive: !restricted,
      }
    }))
  }, [pageMarkups, naturalSize, data, role, activeSubcontractorId, isOtherWork, fileId])
  function moveCalloutOffset(id: string, offsetX: number, offsetY: number) {
    calloutOffsetsRef.current.set(id, { offsetX, offsetY })
    setCalloutAnchors((prev) => prev.map((a) => {
      if (a.markup.id !== id) return a
      return { ...a, boxX: a.targetX + offsetX, boxY: a.targetY + offsetY }
    }))
  }
  // Live visual feedback while dragging the resize handle (no persistence per
  // pixel); resizeCalloutEnd below commits the final value to the markup
  // itself once, on release — same live/commit split as move above.
  function resizeCallout(id: string, scale: number) {
    setCalloutAnchors((prev) => prev.map((a) => (a.markup.id === id ? { ...a, scale } : a)))
  }
  function resizeCalloutEnd(id: string, scale: number) {
    updateMarkup(id, { calloutScale: scale })
  }
  function moveCalloutOffsetEnd(id: string, offsetX: number, offsetY: number) {
    saveCalloutOffset(fileId ?? '', id, { offsetX, offsetY })
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
    // rect/ellipse's geometry (two axis-aligned corners) can't represent a
    // rotated box's transformed shape — see boxTransform.ts's module notes.
    // Every other tool round-trips exactly through rotation.
    if (syncCtx && cutPieceCtx && cutPieceCtx.box.rotation !== 0 && (partial.tool === 'rect' || partial.tool === 'ellipse')) {
      alert('Rectangle and ellipse aren\'t available on a rotated cut piece — draw this on the original print instead.')
      setActiveTool('select')
      return
    }
    const workObjectTypeOverride = pendingWorkTypeRef.current
      ? { workObjectType: pendingWorkTypeRef.current.id, color: pendingWorkTypeRef.current.defaultColor, unit: pendingWorkTypeRef.current.defaultUnit }
      : {}
    // Non-Billable Item: relabel the tool so it's never mistaken for a plain manual
    // line, but otherwise draw exactly like the standard 'line' tool (see
    // startNonBillableLine) — no workObjectType is ever set, which is what already
    // keeps it out of billing/production/payroll/reports everywhere else in the app.
    const nonBillableOverride = nonBillableModeRef.current ? { tool: 'non_billable_line' as MarkupTool } : {}
    // Quick annotation — sequential (Fiber Tick Mark / Fiber Loop / Snow Shoe)
    // or comment (Restoration / QA-QC / Damage Report / Other / Anchor-Down
    // Guy): tag workObjectType directly (see startSequentialAnnotation and
    // startAddWork's comment-annotation branch) — this is what routes it to
    // WorkObjectPropertiesPanel's simplified single-field view and its
    // callout (workObjectCallout.ts) instead of going through
    // pendingWorkTypeRef/addWorkModeRef's full Add Work wizard.
    const quickType = quickAnnotationTypeRef.current
    const quickAnnotationOverride = quickType
      ? { workObjectType: quickType, color: WORK_OBJECT_TYPE_MAP[quickType].defaultColor, unit: WORK_OBJECT_TYPE_MAP[quickType].defaultUnit }
      : {}
    // In cut-piece mode, the drawn geometry is in THIS page's own space — transform
    // it into the master's before saving, and target the master's own identity so
    // the record created here IS the one true record, never a piece-local copy.
    const id = addMarkup({
      ...partial, ...workObjectTypeOverride, ...nonBillableOverride, ...quickAnnotationOverride,
      geometry: toMasterGeo(partial.geometry),
      projectId, coordSpace: 'pdfPage',
      sourceProjectFileId: cutPieceCtx?.masterFileId ?? fileId,
      pageIndex: cutPieceCtx?.masterPageIndex ?? pageNum,
      status: 'pending', layer: 'crew', crewId: null, createdBy: createdByActorId(role, effectiveActorId), updatedAt: null, lockedAt: null,
    })
    undoStackRef.current.push(id)
    redoStackRef.current = []
    nonBillableModeRef.current = false
    quickAnnotationTypeRef.current = null
    // Return to Select so the map is immediately clickable again — otherwise the draw
    // tool stays armed and clicking an existing line/shape is swallowed as "start a new
    // one" (drag-draw tools) or "add a vertex" (click-based tools) instead of selecting it.
    setActiveTool('select')
    setTimeout(() => {
      if (addWorkModeRef.current) {
        addWorkModeRef.current = false
        pendingWorkTypeRef.current = null
        setAddWorkMarkupId(id)
        setAddWorkModalOpen(true)
        setSelectedMarkup(null)
      } else {
        // Also covers Non-Billable Item finishing — sessionTools was only set to
        // arm the click-drawing effect (see startNonBillableLine) and there's no
        // AddWorkModal reopening here to clear it, so clear it directly.
        setSessionTools(null)
        const mk = (data.fieldMarkups ?? []).find((m) => m.id === id)
        if (mk) { setSelectedMarkup(mk); setPanelCollapsed(false) }
      }
    }, 50)
  }

  function startAddWork(type: WorkObjectTypeDef) {
    // Drop any currently-open selection (and its floating quick-actions
    // toolbar / properties panel) before arming the next draw — otherwise a
    // stale popup keeps rendering on top of the page and swallows the click
    // meant to start the new drawing (see startSequentialAnnotation's fuller
    // note; this hits any type when the user chains one drawing right into
    // the next without clicking elsewhere first).
    setSelectedMarkup(null)
    // Comment annotations (Restoration / QA-QC / Damage Report / Other /
    // Anchor-Down Guy) keep their normal grid button and drawing geometry —
    // Restoration still draws a polygon, the rest still drop a point — but
    // skip straight to WorkObjectPropertiesPanel's simplified Comment-only
    // view instead of pendingWorkTypeRef/addWorkModeRef's full wizard: never
    // billable, no crew/quantity/status, no production/P&L entry ever
    // generated (see commitMarkup and WorkObjectPropertiesPanel.tsx).
    if (isCommentAnnotation(type.id)) {
      quickAnnotationTypeRef.current = type.id
    } else {
      pendingWorkTypeRef.current = type
      addWorkModeRef.current = true
    }
    const tools = relevantToolsForWorkType(type.id)
    setSessionTools(tools)
    setColor(type.defaultColor)
    // A curated tool list whose first entry is a genuine engineering symbol (not one of
    // the generic drawing primitives) preselects that symbol directly — matches clicking
    // it in the toolbar. Work Types not yet migrated to a symbol catalog (relevantTools
    // falls back to the generic per-geometry defaults) keep the original behavior below.
    if (tools.length > 0 && !GENERIC_FIRST_TOOLS.has(tools[0])) setActiveTool(tools[0])
    else if (type.defaultGeometry === 'polygon') setActiveTool('polygon')
    else if (type.defaultGeometry === 'line') setActiveTool('line')
    else setActiveTool(type.defaultMarkupTool)
    setActiveSubtype(type.defaultMarkupTool)
    setAddWorkModalOpen(false)
  }

  /** Add Work → "Non-Billable Item": arms the plain 'line' tool (identical drawing
   *  gesture to a normal line — no new interaction code) and marks the next commit as
   *  non-billable. Deliberately does NOT set pendingWorkTypeRef/addWorkModeRef, so
   *  finishing the line just selects it — no Details/Photos/Billing wizard at all. */
  function startNonBillableLine() {
    setSelectedMarkup(null)
    nonBillableModeRef.current = true
    setColor('#94a3b8')
    // The click-drawing effect below no-ops unless sessionTools is non-null (it's
    // otherwise only ever set by startAddWork) — without this the map never attaches
    // a click listener and the line can never be drawn.
    setSessionTools(['line'])
    setActiveTool('line')
    setAddWorkModalOpen(false)
  }

  /** Add Work → "Fiber Tick Mark" / "Fiber Loop" / "Snow Shoe": arms the plain
   *  'point' tool and marks the next commit as that sequential-annotation type —
   *  one click drops the point, tags it workObjectType directly (see commitMarkup
   *  above) and skips straight to the small WorkObjectPropertiesPanel's single
   *  Sequence field, no Details/Photos/Billing wizard, no production/P&L entry
   *  ever generated for it.
   *
   *  Clears any currently-selected markup first — without this, dropping a
   *  second tick mark/loop/snow shoe right after finishing the first (the
   *  normal workflow: many of these along one run) reuses the still-open
   *  previous one's floating panel instead of drawing a new point, because
   *  that panel (z-[1500], covering a chunk of the page) intercepts the click
   *  meant to place the next point and just edits the old markup's Sequence
   *  field again. */
  function startSequentialAnnotation(typeId: WorkObjectTypeId) {
    setSelectedMarkup(null)
    quickAnnotationTypeRef.current = typeId
    setColor(WORK_OBJECT_TYPE_MAP[typeId].defaultColor)
    setSessionTools(['point'])
    setActiveTool('point')
    setAddWorkModalOpen(false)
  }

  function handleSetScale() {
    if (!fileId) return
    const n = Number(scaleInput)
    updateProjectFile(fileId, { pdfScaleFeetPerInch: n > 0 ? n : undefined })
  }

  const [exportingPdf, setExportingPdf] = useState(false)

  async function handleExportPdf(criteria: ExportFilterCriteria, options: FieldMapExportOptions) {
    if (exportingPdf) return
    setExportingPdf(true)
    try {
      let filtered = filterMarkupsForExport(allFileMarkups, data.markupBilling ?? [], criteria)
      // Defense in depth: no matter what the dialog's Crew/Subcontractor
      // filter was set to, a subcontractor session can never export anyone
      // else's redlines into a PDF they can download and share — same
      // isolation principle as the map's click restriction, just enforced
      // again here since the exported page renders full callout detail
      // (quantity, billing code) that restriction doesn't touch. Pages that
      // only had other companies' work now correctly drop out below.
      if (role === 'subcontractor') filtered = filtered.filter((m) => m.assignedSubcontractorId === activeSubcontractorId)
      // Explicit page scope (current/selected pages) wins as-is; otherwise (entire
      // project / selected redlines) derive the page list from wherever the
      // filtered redlines actually live — no point exporting a blank print sheet.
      const pagesWithContent = [...new Set(filtered.map((m) => m.pageIndex ?? 0))].sort((a, b) => a - b)
      const pageIndexes = criteria.pageIndexes ? [...criteria.pageIndexes].sort((a, b) => a - b) : pagesWithContent
      const activeSub = role === 'subcontractor' ? (data.subcontractors ?? []).find((s) => s.id === activeSubcontractorId) : null
      // Supervisor exports the redline print pages only — no invoice at all,
      // per the "he just would want to download the redlines" call.
      const exportMode: SummaryReportMode = activeSub
        ? { kind: 'subcontractorPay', payRatePercent: activeSub.payRatePercent ?? null, subcontractorName: activeSub.companyName }
        : role === 'supervisor' ? { kind: 'none' } : { kind: 'admin' }
      await exportPdfPrintModeReport({
        project: { name: project?.name ?? 'Project', id: project?.id ?? '', location: project?.location ?? '', clientId: project?.clientId },
        fileId: fileId ?? '',
        pageImages,
        logicalPageSizes,
        pageIndexes,
        markups: filtered,
        data,
        calloutSettings: getCalloutDisplaySettings(),
        options,
        mode: exportMode,
      })
      setShowExportDialog(false)
    } catch (err) {
      console.error('PDF Print Mode export error', err)
      alert('Export failed — please try again.')
    } finally {
      setExportingPdf(false)
    }
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
    if (activeTool === 'select') {
      e.currentTarget.setPointerCapture(e.pointerId)
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
      setIsPanning(true)
      return
    }
    // Defense in depth alongside the toolbar's disabled buttons — every branch below starts
    // a brand new shape, which should never be reachable outside an active Add Work session.
    if (!sessionTools) return
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
    if (activeTool === 'point' || FEATURE_DROP_TOOLS.includes(activeTool as (typeof FEATURE_DROP_TOOLS)[number]) || ENGINEERING_POINT_TOOLS.includes(activeTool as MarkupTool)) {
      const symbolColor = ENGINEERING_SYMBOL_MAP[activeTool as string]?.color
      const meta = FEATURE_TOOL_LABELS[activeTool as string]
      commitMarkup({
        tool: activeTool as MarkupTool, subtype: activeTool as string,
        color: symbolColor ?? meta?.color ?? color, weight, fillColor: null, fillOpacity: 0, opacity: 1,
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
    if (panStartRef.current) {
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy })
      return
    }
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
    if (panStartRef.current) {
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      const wasReallyDrag = Math.hypot(dx, dy) >= PAN_DRAG_THRESHOLD_PX
      wasPanDragRef.current = wasReallyDrag
      panStartRef.current = null
      setIsPanning(false)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      // A genuine click (not a drag-to-pan) while Select is active — hit-test directly
      // at the release point via elementFromPoint rather than trusting the browser's
      // derived `click` event target. `setPointerCapture` above (in onSvgPointerDown)
      // can cause some browsers to retarget the subsequent `click` event to the
      // capturing <svg> itself instead of the actual shape under the cursor, which
      // would make `closest('[data-markup-id]')` always fail — silently breaking
      // click-to-select for every object, every time, regardless of what's clicked
      // (confirmed: Search Work Objects — a separate code path — worked fine, only
      // direct on-canvas clicking never selected anything).
      if (!wasReallyDrag) {
        const real = document.elementFromPoint(e.clientX, e.clientY)
        const hitId = real?.closest('[data-markup-id]')?.getAttribute('data-markup-id') ?? null
        const hit = hitId ? (pageMarkups.find((m) => m.id === hitId) ?? null) : null
        if (hit && isOtherWork(hit)) return
        setSelectedMarkup(hit)
      }
      return
    }
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
        lastAccumClickRef.current = null
      } else {
        // Double-click-to-finish, detected off click timing/position (screen pixels, so
        // the threshold stays consistent across zoom levels) rather than a native
        // dblclick listener — see lastAccumClickRef declaration for why.
        const now = Date.now()
        const last = lastAccumClickRef.current
        const isDoubleClick =
          last !== null && now - last.time < 400 && Math.hypot(e.clientX - last.pt[0], e.clientY - last.pt[1]) < 10
        lastAccumClickRef.current = { time: now, pt: [e.clientX, e.clientY] }
        if (isDoubleClick && accumPts.length > 0) {
          lastAccumClickRef.current = null
          finishAccumulation()
        } else {
          addAccumPoint(pt)
        }
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
    if ((activeTool === 'line' || LINE_ACCUM_SYMBOL_TOOLS.has(activeTool as MarkupTool)) && accumPts.length >= 1) {
      finishAccumulation([...accumPts, pt])
      return
    }
    setAccumPts((prev) => [...prev, pt])
  }

  function finishAccumulation(ptsOverride?: [number, number][]) {
    const pts = ptsOverride ?? accumPts
    setAccumPts([])
    setGhostPt(null)
    lastAccumClickRef.current = null
    const isMultiLine = activeTool === 'multi_line' || activeTool === 'measure' || activeTool === 'line' || LINE_ACCUM_SYMBOL_TOOLS.has(activeTool as MarkupTool)
    const minPts = isMultiLine ? 2 : 3
    if (pts.length < minPts) return
    const committedTool: MarkupTool = (activeTool === 'multi_line' || activeTool === 'measure' || activeTool === 'cloud' || activeTool === 'line' || LINE_ACCUM_SYMBOL_TOOLS.has(activeTool as MarkupTool)) ? activeTool as MarkupTool : 'polygon'
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
    lastAccumClickRef.current = null
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
      addMarkup({ ...markup, geometry: toMasterGeo({ latlngs: ringA }), lengthFt: null })
      addMarkup({ ...markup, geometry: toMasterGeo({ latlngs: ringB }), lengthFt: null })
      deleteMarkup(markup.id)
      setSelectedMarkup(null)
      setActiveTool('select')
    } else {
      if (idx === 0 || idx === pts.length - 1) return // must be an interior vertex
      const [lineA, lineB] = splitLine(pts, idx)
      addMarkup({ ...markup, geometry: toMasterGeo({ latlngs: lineA }), lengthFt: feetForPageLength(euclideanLength(lineA), file?.pdfScaleFeetPerInch) })
      addMarkup({ ...markup, geometry: toMasterGeo({ latlngs: lineB }), lengthFt: feetForPageLength(euclideanLength(lineB), file?.pdfScaleFeetPerInch) })
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
      for (const ring of rings) addMarkup({ ...a, geometry: toMasterGeo({ latlngs: ring }), lengthFt: null })
    } else {
      const merged = mergeLines(a.geometry.latlngs, b.geometry.latlngs)
      addMarkup({ ...a, geometry: toMasterGeo({ latlngs: merged }), lengthFt: feetForPageLength(euclideanLength(merged), file?.pdfScaleFeetPerInch) })
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
    // m comes from pageMarkups, so its geometry is already display-transformed in
    // cut-piece mode — applyVertexDragPreview's math operates purely on whatever
    // space m.geometry is currently in, so it needs no changes; only the final
    // write needs to go back through the inverse transform.
    const updated = applyVertexDragPreview(m, vertexDrag)
    updateMarkup(m.id, { geometry: toMasterGeo(updated.geometry) })
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

  // ── Keyboard shortcuts: Delete removes the selection, Escape clears it ────
  // (Escape yields first to the in-progress-draw handler above, which owns Escape
  // whenever a multi-point accumulation is active.)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      if (e.key === 'Escape') {
        if (accumPts.length > 0) return
        setSelectedMarkup(null)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedMarkup) {
        e.preventDefault()
        requestDeleteMarkup(selectedMarkup)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMarkup, accumPts.length])

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
        <button onClick={() => nav(`/projects/${projectId}`)} className="mt-3 text-sm text-brand-400 hover:underline">Back to Project</button>
      </div>
    )
  }

  // The base image now stays the cheap batch render permanently — hiResCrop
  // (rendered below in the JSX, as a sibling overlay) is what actually
  // supplies sharpness, for just the region currently on screen.
  const currentImage = pageImages[pageNum]

  return (
    <div className="-mx-4 -my-6 lg:-mx-6 flex flex-col overflow-hidden bg-[#0a0a0a]" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Top bar */}
      <div className="flex items-center shrink-0 h-11 border-b border-[#1e1e1e] bg-[#0a0a0a] px-3 gap-2">
        {/* Genuine history-back, not a hardcoded destination: lands on the project page when
            reached directly from it, but on the Field Map when reached from within it (e.g.
            clicking a PDF in its Prints bar) — whichever is actually true for this visit. */}
        <button onClick={() => nav(-1)} className="rounded p-1 text-slate-500 hover:text-slate-300 hover:bg-white/5 transition shrink-0">
          <ArrowLeft size={14} />
        </button>
        <span className="text-[12px] font-medium text-slate-300 truncate">{file.name}</span>
        <span className="text-[10px] text-amber-500 bg-amber-950/40 rounded px-1.5 py-0.5 shrink-0">{t('pdfPrintMode.badge')}</span>
        <span className="text-[10px] text-slate-600 shrink-0">{pageMarkups.length} work object{pageMarkups.length === 1 ? '' : 's'}</span>

        <div className="relative shrink-0 w-40">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            type="text" value={markupSearch} onChange={(e) => setMarkupSearch(e.target.value)}
            placeholder={t('pdfPrintMode.searchPlaceholder')}
            className="w-full rounded border border-[#2a3347] bg-[#141414] pl-6 pr-2 py-1 text-[11px] text-slate-200 outline-none focus:border-brand-500"
          />
          {searchResults.length > 0 && (
            <div className="absolute left-0 top-full z-[2000] mt-1 max-h-64 w-64 overflow-y-auto rounded-md border border-[#2a3347] bg-[#0d0d0d] py-1 shadow-xl">
              {searchResults.map((m) => (
                <button
                  key={m.id}
                  onClick={() => goToSearchResult(m)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[11px] text-slate-300 hover:bg-white/5"
                >
                  <span className="truncate">{m.featureName || m.label || FEATURE_TOOL_LABELS[m.tool]?.label || m.tool}</span>
                  <span className="shrink-0 text-slate-600">{t('pdfPrintMode.page', { n: (m.pageIndex ?? 0) + 1, total: pageCount })}</span>
                </button>
              ))}
            </div>
          )}
          {markupSearch.trim() && searchResults.length === 0 && (
            <div className="absolute left-0 top-full z-[2000] mt-1 w-64 rounded-md border border-[#2a3347] bg-[#0d0d0d] px-3 py-2 text-[11px] text-slate-600 shadow-xl">
              {t('pdfPrintMode.noResults')}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {role !== 'field' && (
            <button onClick={() => setShowExportDialog(true)} disabled={exportingPdf}
              className="hidden sm:flex items-center gap-1.5 rounded-md border border-[#2a3347] px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-white/5 disabled:opacity-40 transition shrink-0">
              <Download size={11} /> {exportingPdf ? 'Generating…' : 'Download PDF'}
            </button>
          )}

          {pageCount > 1 && (
            <div className="flex items-center gap-1">
              <button onClick={() => setPageNum((p) => Math.max(0, p - 1))} disabled={pageNum === 0} className="rounded p-1 text-slate-500 hover:text-slate-300 disabled:opacity-30">
                <ChevronLeft size={14} />
              </button>
              <span className="text-[11px] text-slate-400">{t('pdfPrintMode.page', { n: pageNum + 1, total: pageCount })}</span>
              <button onClick={() => setPageNum((p) => Math.min(pageCount - 1, p + 1))} disabled={pageNum === pageCount - 1} className="rounded p-1 text-slate-500 hover:text-slate-300 disabled:opacity-30">
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          <div className="flex items-center gap-0.5 border-l border-[#1e1e1e] pl-2">
            <button onClick={zoomOut} disabled={zoom <= ZOOM_MIN} title={t('pdfPrintMode.zoomOut')} className="rounded p-1 text-slate-500 hover:text-slate-300 disabled:opacity-30">
              <ZoomOut size={14} />
            </button>
            <span className="w-11 text-center text-[11px] text-slate-400">{Math.round(zoom * 100)}%</span>
            <button onClick={zoomIn} disabled={zoom >= ZOOM_MAX} title={t('pdfPrintMode.zoomIn')} className="rounded p-1 text-slate-500 hover:text-slate-300 disabled:opacity-30">
              <ZoomIn size={14} />
            </button>
            <button onClick={resetView} title={t('pdfPrintMode.resetView')} className="rounded p-1 text-slate-500 hover:text-slate-300">
              <Maximize2 size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <FieldMapToolbar
        activeTool={activeTool}
        onSelectTool={(tool) => {
          setActiveTool(tool)
          cancelAccumulation()
          if (tool === 'highlight') { setColor('#facc15'); setWeight(14); setOpacity(0.4) }
          // Engineering symbol tools each carry their own distinguishing color — auto-sync
          // so switching tools mid-session doesn't draw the next symbol in the wrong color.
          const symbolColor = ENGINEERING_SYMBOL_MAP[tool]?.color
          if (symbolColor) setColor(symbolColor)
        }}
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
          requestDeleteMarkup(selectedMarkup)
        }}
        canDelete={!!selectedMarkup && !selectedMarkup.lockedAt}
        onSave={() => finishAccumulation()}
        canSave={accumPts.length > 0}
        canMerge={toolSelectedIds.size === 2}
        onMerge={performMerge}
        activeTools={sessionTools}
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
            <button
              onClick={() => nav(`/kmz/${projectId}`, { state: { openPdfFileId: fileId } })}
              className="mt-2 w-full rounded border border-[#2a3347] px-2 py-1.5 text-left text-[11px] text-slate-300 hover:bg-white/5"
            >
              Georeference to Map…
            </button>
            <button
              onClick={() => setShowCalloutSettings(true)}
              className="mt-1.5 flex w-full items-center gap-2 rounded border border-[#2a3347] px-2 py-1.5 text-left text-[11px] text-slate-300 hover:bg-white/5"
            >
              <Settings size={12} /> Callout Display Settings
            </button>
          </div>
        }
      />
      {showCalloutSettings && <CalloutSettingsPopover onClose={() => setShowCalloutSettings(false)} />}
      {showExportDialog && (
        <FieldMapExportDialog
          markups={allFileMarkups}
          data={data}
          pageContext={{ currentPage: pageNum, pageCount }}
          exporting={exportingPdf}
          onExport={handleExportPdf}
          onClose={() => setShowExportDialog(false)}
        />
      )}

      {/* Style presets — only while a Work Type is being drawn */}
      {sessionTools && (
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
        </div>
      )}

      {/* Canvas */}
      {/* min-w-0 overrides flexbox's default min-width:auto — without it a
          flex-1 item refuses to shrink below its content's intrinsic width,
          which can push fixed-position siblings anchored to the viewport
          edge (the detail panel below) partially out of view. */}
      <div ref={canvasScrollRef} className="relative min-w-0 flex-1 overflow-auto flex items-start justify-center bg-[#050505]" onWheel={onCanvasWheel}>
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
          <div
            className="relative"
            style={{
              width: '100%', maxWidth: naturalSize.w,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'top center',
            }}
          >
            <img src={currentImage} className="w-full select-none" draggable={false} alt={`${file.name} page ${pageNum + 1}`} />
            {hiResCrop && hiResCrop.pageIndex === pageNum && (
              <img
                src={hiResCrop.url}
                className="absolute pointer-events-none select-none"
                style={{
                  left: `${hiResCrop.fracLeft * 100}%`,
                  top: `${hiResCrop.fracTop * 100}%`,
                  width: `${hiResCrop.fracWidth * 100}%`,
                  height: `${hiResCrop.fracHeight * 100}%`,
                }}
                draggable={false}
                alt=""
              />
            )}
            <svg
              ref={svgRef}
              viewBox={`0 0 ${naturalSize.w} ${naturalSize.h}`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
              style={{ cursor: activeTool === 'select' ? (isPanning ? 'grabbing' : 'grab') : 'crosshair', touchAction: 'none' }}
              onPointerDown={onSvgPointerDown}
              onPointerMove={onSvgPointerMove}
              onPointerUp={onSvgPointerUp}
              onDoubleClick={onCanvasDoubleClick}
              onClick={(e) => {
                // Plain Select-mode clicking is now handled directly in onSvgPointerUp
                // (see its comment) — a mistargeted `click` event here must NOT also run
                // and clobber that already-correct result with a bad hit-test.
                if (activeTool !== 'merge') return
                if (wasPanDragRef.current) { wasPanDragRef.current = false; return }
                // The click target is the leaf shape (e.g. <polyline>), not the <g data-markup-id>
                // wrapper around it — walk up to find it, same as the old RedlineEditor's hit-test.
                const hit = (e.target as Element).closest('[data-markup-id]')
                const id = hit?.getAttribute('data-markup-id') ?? null
                if (!id) return
                setToolSelectedIds((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id); else next.add(id)
                  return next
                })
              }}
            >
              {pageMarkups.filter((m) => m.tool !== 'callout').map((m) => {
                const displayMarkup = vertexDrag?.markupId === m.id ? applyVertexDragPreview(m, vertexDrag) : m
                const showVertexHandles = editMode === 'vertices' && selectedMarkup?.id === m.id && !m.lockedAt
                const showSplitHandles = activeTool === 'split' && selectedMarkup?.id === m.id && !!m.geometry.latlngs?.length
                const geo = displayMarkup.geometry
                const isSelected = selectedMarkup?.id === m.id
                return (
                  <g key={m.id}>
                    <g data-markup-id={m.id} style={{
                      cursor: activeTool === 'select' || activeTool === 'merge' ? 'pointer' : undefined,
                      filter: isSelected ? 'drop-shadow(0 0 3px #22d3ee) drop-shadow(0 0 3px #22d3ee)' : undefined,
                    }}
                      opacity={isSelected ? 1 : 0.92}>
                      {markupToPdfElement(displayMarkup)}
                    </g>
                    {activeTool === 'merge' && toolSelectedIds.has(m.id) ? (
                      <circle
                        cx={geo.center?.[0] ?? geo.latlngs?.[0]?.[0] ?? geo.bounds?.[0]?.[0] ?? 0}
                        cy={geo.center?.[1] ?? geo.latlngs?.[0]?.[1] ?? geo.bounds?.[0]?.[1] ?? 0}
                        r={10} fill="none" stroke="#f97316" strokeWidth={2} pointerEvents="none"
                      />
                    ) : isSelected && (
                      <circle
                        cx={geo.center?.[0] ?? geo.latlngs?.[0]?.[0] ?? geo.bounds?.[0]?.[0] ?? 0}
                        cy={geo.center?.[1] ?? geo.latlngs?.[0]?.[1] ?? geo.bounds?.[0]?.[1] ?? 0}
                        r={12} fill="none" stroke="#22d3ee" strokeWidth={2.5} pointerEvents="none"
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
            {/* Lives inside the same pan/zoom-transformed div as the page image/SVG
                (not a viewport-fixed sibling) — its left/top/font-size are plain
                naturalSize-space numbers, so the ancestor's `transform: scale(zoom)`
                naturally shrinks/grows it right along with the print underneath it,
                same as any other drawn annotation. Deliberate: with many redlines
                and callouts on one sheet, a screen-fixed-size box increasingly
                covers the print as you zoom out; this way it's only ever as big
                on screen as it was when it was actually drawn, and reads at full
                size again once you zoom back into that spot — see PdfCalloutOverlay's
                own doc comment for the full reasoning.
                The extra wrapper below applies calloutFitScale — the page's own
                <img>/<svg viewBox> shrink to fit whenever this scroll container is
                narrower than naturalSize.w (any oversized print on a normal screen),
                invisibly, with no CSS transform anywhere an ancestor could pass down.
                Without correcting for it here too, the callout's leader line lands
                using un-shrunk coordinates while the redline itself renders shrunk —
                exactly the "box looks right, line looks right, but they don't touch"
                bug. This wrapper is sized at the page's true naturalSize.w/h in its
                own local coordinate space (matching the markup SVG's viewBox), then
                scaled down to match however small the page is actually rendering. */}
            <div
              className="pointer-events-none absolute left-0 top-0"
              style={{ width: naturalSize.w, height: naturalSize.h, transform: `scale(${calloutFitScale})`, transformOrigin: 'top left' }}
            >
              <PdfCalloutOverlay
                anchors={calloutAnchors}
                zoom={zoom * calloutFitScale}
                selectedId={selectedMarkup?.id ?? null}
                onSelect={(m) => { setSelectedMarkup(m); setPanelCollapsed(false) }}
                onMove={moveCalloutOffset}
                onMoveEnd={moveCalloutOffsetEnd}
                onResize={resizeCallout}
                onResizeEnd={resizeCalloutEnd}
                onEdit={(m) => {
                  // Work Object callouts: selecting is enough — it surfaces the small
                  // WorkObjectPropertiesPanel automatically. Manual free-typed callouts
                  // have no such panel, so fall back to opening the full MarkupPanel.
                  setSelectedMarkup(m)
                  if (!m.workObjectType) setPanelCollapsed(false)
                }}
                onDelete={(m) => { deleteMarkup(m.id); if (selectedMarkup?.id === m.id) setSelectedMarkup(null) }}
                onClose={() => setSelectedMarkup(null)}
                drawSessionActive={!!sessionTools && activeTool !== 'select'}
              />
            </div>
          </div>
        )}
      </div>

      <AddWorkModal
        open={addWorkModalOpen}
        projectId={projectId ?? ''}
        markupId={addWorkMarkupId}
        onPickType={startAddWork}
        onPickNonBillable={startNonBillableLine}
        onPickSequential={startSequentialAnnotation}
        onClose={() => { setAddWorkModalOpen(false); setAddWorkMarkupId(null); setActiveTool('select'); setSessionTools(null) }}
      />

      {/* Work Objects get the small floating WorkObjectPropertiesPanel instead (below)
          — this sidebar only opens for them on-demand, when a quick-action
          (Photos/Notes/Billing) explicitly requests a specific tab. Fixed,
          modest width at every viewport size — this used to widen to
          fixed/w-full below the lg breakpoint, which on anything narrower
          than a 1024px window (a perfectly normal browser width, not just
          mobile) covered almost the entire print instead of docking beside
          it. Floating-card treatment (rounded, shadowed, inset from the
          edge) matches WorkObjectPropertiesPanel's look instead of a flat
          flush sidebar. */}
      {selectedMarkup && !panelCollapsed && !isRestrictedForSession && ((!isSelectedWorkObject && !isSelectedNonBillable) || openTabRequest) && (
        <div className="fixed inset-y-2 right-2 z-40 flex w-72 shrink-0 overflow-hidden rounded-xl border border-[#2a2a2a] shadow-2xl shadow-black/50">
          <MarkupPanel
            markup={selectedMarkup}
            onClose={() => setSelectedMarkup(null)}
            onRequestDelete={requestDeleteMarkup}
            openTab={openTabRequest}
            editMode={editMode}
            onSetEditMode={setEditMode}
          />
        </div>
      )}

      {selectedMarkup && isSelectedWorkObject && quickActionsAnchor && !isRestrictedForSession && (
        <WorkObjectPropertiesPanel
          key={selectedMarkup.id}
          markup={selectedMarkup}
          anchor={quickActionsAnchor}
          onClose={() => setSelectedMarkup(null)}
          onOpenBillingTab={() => { setPanelCollapsed(false); setOpenTabRequest({ tab: 'billing', nonce: Date.now() }) }}
        />
      )}

      {selectedMarkup && isSelectedNonBillable && quickActionsAnchor && !isRestrictedForSession && (
        <NonBillableLinePropertiesPanel
          key={selectedMarkup.id}
          markup={selectedMarkup}
          anchor={quickActionsAnchor}
          onClose={() => setSelectedMarkup(null)}
        />
      )}

      {selectedMarkup && quickActionsAnchor && !isRestrictedForSession && (
        <MarkupQuickActions
          anchor={quickActionsAnchor}
          mode={selectedMarkup.tool === 'callout' ? 'callout' : isSelectedNonBillable ? 'minimal' : 'full'}
          canEdit={!selectedMarkup.lockedAt}
          onEdit={() => {
            if (selectedMarkup.tool === 'callout') { setPanelCollapsed(false); return }
            setEditMode((m) => (m === 'vertices' ? 'none' : 'vertices'))
          }}
          onOpenTab={(tab) => { setPanelCollapsed(false); setOpenTabRequest({ tab, nonce: Date.now() }) }}
          onDelete={() => {
            if (selectedMarkup.tool === 'callout') { deleteMarkup(selectedMarkup.id); setSelectedMarkup(null); return }
            requestDeleteMarkup(selectedMarkup)
          }}
          onClose={() => setSelectedMarkup(null)}
        />
      )}
      <MarkupDeleteConfirm
        markup={deleteFlow.pendingDelete}
        onCancel={deleteFlow.cancelDelete}
        onConfirm={confirmDeleteMarkup}
      />
    </div>
  )
}
