import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  ArrowLeft, Layers, Search, Download, Map as MapIcon, Satellite, Upload, Globe,
  Maximize2, Minimize2, Pencil,
  Eye, EyeOff, Trash2, PanelRightOpen, PanelRightClose,
  ChevronRight, ChevronDown, FolderOpen, Folder,
  LayoutGrid, FileText,
  MapPin, DollarSign, Settings, Plus,
  AlertTriangle, CheckCircle2, X,
} from 'lucide-react'
import { DistributionLineModal } from '../components/DistributionLineModal'
import { useData } from '../store/DataContext'
import { FeaturePanel } from '../components/FeaturePanel'
import { MarkupPanel } from '../components/MarkupPanel'
import { AerialLashRunPanel } from '../components/AerialLashRunPanel'
import { PoleFormModal } from '../components/PoleFormModal'
import { FEATURE_TOOL_LABELS, FEATURE_DROP_TOOLS } from '../lib/markupMeta'
import { exportFeaturesToKmz, exportFieldMarkupsToKmz, triggerDownload } from '../lib/kmzExport'
import { parseKmzOrKml } from '../lib/kmzParser'
import { markupToLayer, buildEditHandles, buildSplitVertexMarkers } from '../lib/markupLayer'
import { computeTransform, computeScreenMatrix, type GeoTransform } from '../lib/georeference'
import { GeoreferencePanel } from '../components/GeoreferencePanel'
import { AddWorkModal } from '../components/AddWorkModal'
import { LayerManagerPanel } from '../components/LayerManagerPanel'
import { FieldMapToolbar } from '../components/FieldMapToolbar'
import { exportFieldMapReport, buildReportRows } from '../lib/fieldMapExport'
import { findSnapPoint, collectSnapCandidates } from '../lib/snap'
import { splitLine, mergeLines, splitPolygon, unionPolygons } from '../lib/geometryOps'
import type { WorkObjectTypeDef } from '../lib/workObjectTypes'
import { loadBlob, saveBlob } from '../lib/fileStore'
import type { PendingProduction } from '../lib/pendingProduction'
import { FEATURE_STATUS_META, MARKUP_LAYER_META } from '../types'
import type { MapFeature, FeatureStatus, KmzUpload, FieldMarkup, MarkupTool, MarkupLayer, MarkupStatus, AerialLashFiberRun, AerialPole } from '../types'
import { MARKUP_COLOR_CODES } from '../lib/constructionTools'

// Fix Leaflet default icon paths broken by bundlers
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const STATUS_ORDER: FeatureStatus[] = ['not_started', 'in_progress', 'complete', 'issue', 'rework']

// ── Markup tool definitions ───────────────────────────────────────────────────

type DrawTool = 'select' | 'pen' | 'line' | 'dashed_line' | 'dotted_line' | 'multi_line' | 'measure' | 'arrow' | 'double_arrow' | 'rect' | 'circle' | 'polygon' | 'text' | 'callout' | 'aerial_lash' | 'split' | 'merge'


const MARKUP_COLORS = ['#ef4444', '#f97316', '#facc15', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6', '#ffffff']


function isFeatureDrop(tool: string): boolean {
  return FEATURE_DROP_TOOLS.includes(tool as typeof FEATURE_DROP_TOOLS[number])
}


const DRAG_DRAW_TOOLS = new Set(['pen', 'line', 'dashed_line', 'dotted_line', 'arrow', 'double_arrow', 'rect', 'circle', 'highlight', 'ellipse'])
function isDragDrawTool(tool: string) { return DRAG_DRAW_TOOLS.has(tool) }

const WEIGHT_OPTIONS = [
  { value: 1,  label: 'XS' },
  { value: 2,  label: 'Thin' },
  { value: 4,  label: 'Med' },
  { value: 7,  label: 'Thick' },
  { value: 12, label: 'XL' },
] as const


// ── Haversine for line length ─────────────────────────────────────────────────

function latlngsLengthFt(pts: [number, number][]): number {
  const R = 20902231.5
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const dLat = ((pts[i][0] - pts[i - 1][0]) * Math.PI) / 180
    const dLng = ((pts[i][1] - pts[i - 1][1]) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((pts[i - 1][0] * Math.PI) / 180) *
      Math.cos((pts[i][0] * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
    total += 2 * R * Math.asin(Math.sqrt(a))
  }
  return Math.round(total)
}

export function KmzMap() {
  const { projectId } = useParams<{ projectId: string }>()
  const nav = useNavigate()
  const location = useLocation()
  const { data, setFeatureStatus, addKmzUpload, deleteMapFeature, addMarkup, updateMarkup, deleteMarkup, addProjectFile,
    addAerialLashFiberRun, deleteAerialLashFiberRun, updateFieldMapOverlay,
    addProduction, addCrewDayEntry, addPhoto } = useData()

  // DOM refs
  const wrapperRef      = useRef<HTMLDivElement>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const fileRef         = useRef<HTMLInputElement>(null)
  const pdfFileRef      = useRef<HTMLInputElement>(null)
  const textInputRef    = useRef<HTMLInputElement>(null)

  // Leaflet refs
  const mapRef          = useRef<L.Map | null>(null)
  const layerMapRef     = useRef<Map<string, L.Layer>>(new Map())
  const geoLayerRef     = useRef<L.GeoJSON | null>(null)
  const tileLayerRef    = useRef<L.TileLayer | null>(null)
  const markupGroupRef      = useRef<L.LayerGroup | null>(null)
  const mkpLayerMapRef      = useRef<Map<string, L.Layer>>(new Map())  // markupId → Leaflet layer
  const seenLayersRef       = useRef<Set<string>>(new Set())
  const calloutOverlaysRef  = useRef<HTMLDivElement[]>([])
  // Persists callout layout state across re-renders (session-only; not in DataContext)
  const calloutStateRef     = useRef<Map<string, { offsetX: number; offsetY: number; createdAtZoom: number; baseWidth?: number; baseHeight?: number }>>(new Map())
  const polygonPtsRef     = useRef<[number, number][]>([])
  const splitPickedIndicesRef = useRef<number[]>([])
  const polygonPreviewRef = useRef<L.Polygon | L.Polyline | null>(null)
  const finishPolygonRef  = useRef<(() => void) | null>(null)
  // Aerial lash fiber drawing
  const aerialPolesRef        = useRef<AerialPole[]>([])
  const aerialPoleMarkersRef  = useRef<L.Marker[]>([])
  const aerialLineLayerRef    = useRef<L.Polyline | null>(null)
  const aerialSavedGroupRef   = useRef<L.LayerGroup | null>(null)
  const finishAerialRunRef    = useRef<(() => void) | null>(null)
  // Drag-to-draw overlay state (pen/line/rect/circle/arrow)
  const drawStartLLRef   = useRef<L.LatLng | null>(null)
  const drawPreviewRef   = useRef<L.Layer | null>(null)
  const drawPenPtsRef    = useRef<L.LatLng[]>([])
  const drawActiveRef    = useRef(false)
  // Pan overlay ref (hand/select tool — uses native pointer events for reliable capture)
  const panOverlayRef    = useRef<HTMLDivElement>(null)

  // Core map state
  const [mapReady,        setMapReady]        = useState(false)
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null)
  const [activeUploadId,  setActiveUploadId]  = useState<string>('all')
  const [search,          setSearch]          = useState('')
  const [listOpen,        setListOpen]        = useState(true)
  const [collapsedLayers, setCollapsedLayers] = useState<Set<string>>(new Set())
  const [mapLayer,        setMapLayer]        = useState<'street' | 'satellite'>('street')
  const [colorMode,       setColorMode]       = useState<'kmz' | 'status'>('kmz')
  const [exporting,       setExporting]       = useState(false)
  const [importing,       setImporting]       = useState(false)
  const [importMsg,       setImportMsg]       = useState<{ text: string; ok: boolean } | null>(null)
  const [uploadingPdf,    setUploadingPdf]    = useState(false)
  const [showGeoreference, setShowGeoreference] = useState(false)
  const [preloadPdfFile, setPreloadPdfFile] = useState<{ id: string; name: string } | null>(null)

  // Panel + fullscreen
  const [panelCollapsed,    setPanelCollapsed]    = useState(false)
  const [isFullscreen,      setIsFullscreen]      = useState(false)

  // Markup tool state
  const [rlActive,      setRlActive]      = useState(false)
  const [activeTool,    setActiveTool]    = useState<DrawTool | MarkupTool>('pen')
  const [activeSubtype, setActiveSubtype] = useState<string>('pen')
  const [rlColor,       setRlColor]       = useState('#ef4444')
  const [rlWeight,      setRlWeight]      = useState(2)
  const [rlOpacity,      setRlOpacity]      = useState(1.0)
  const rlFillOpacity = 0.15
  const [rlLayer,       setRlLayer]       = useState<MarkupLayer>('crew')
  const [markupVisible, setMarkupVisible] = useState(true)
  const [visibleLayers, setVisibleLayers] = useState<Set<MarkupLayer>>(new Set(Object.keys(MARKUP_LAYER_META) as MarkupLayer[]))
  const [hiddenKmzLayerNames, setHiddenKmzLayerNames] = useState<Set<string>>(new Set())
  const [hiddenFeatureIds, setHiddenFeatureIds] = useState<Set<string>>(new Set())
  const [showLayerManager, setShowLayerManager] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(false)
  const [exportingReport, setExportingReport] = useState(false)

  // Pending production entry (from Production.tsx's "Save + Field Map" gate) — not saved until
  // the crew documents the work with at least one Work Object and completes.
  const pending = (location.state as { pending?: PendingProduction } | null)?.pending ?? null
  const [productionCompleted, setProductionCompleted] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const pendingBaselineMarkupCountRef = useRef<number | null>(null)
  // Split/Merge multi-select — separate from `selectedMarkup` (which opens the right panel)
  const [toolSelectedIds, setToolSelectedIds] = useState<Set<string>>(new Set())
  const [textPos,       setTextPos]       = useState<{ x: number; y: number; lat: number; lng: number } | null>(null)
  const [textVal,       setTextVal]       = useState('')

  // Tracks whether the user has placed any polygon points (so the toolbar can show "Finish")
  const [polygonInProgress, setPolygonInProgress] = useState(false)
  // Aerial lash fiber
  const [aerialRunInProgress, setAerialRunInProgress] = useState(false)
  const [selectedAerialRun,   setSelectedAerialRun]   = useState<AerialLashFiberRun | null>(null)
  const [editingPole,         setEditingPole]         = useState<{ pole: AerialPole; index: number } | null>(null)

  // Active field color preset (key from MARKUP_COLOR_CODES, e.g. 'backbone_fiber_overlash')
  const [, setActiveColorCode] = useState<string | null>(null)
  const activeColorCodeRef = useRef<string | null>(null)


  // Selected markup (for the right panel)
  const [selectedMarkup, setSelectedMarkup] = useState<FieldMarkup | null>(null)

  // Undo stack (just IDs of markup items added this session)
  const undoStackRef = useRef<string[]>([])
  // Redo stack — full snapshots of markups popped off the undo stack, so redo can re-create them
  const redoStackRef = useRef<FieldMarkup[]>([])

  // Edit mode for the selected markup's geometry (vertex handles / whole-shape move)
  const [editMode, setEditMode] = useState<'none' | 'vertices' | 'move'>('none')

  // Distribution line modal (Report Line workflow)
  const [distModalId,   setDistModalId]   = useState<string | null>(null)
  const reportModeRef = useRef(false)  // when true, next commitMarkup → modal instead of panel

  // Add Work modal (Type → Draw → Details → Photos → Billing workflow)
  const [addWorkModalOpen, setAddWorkModalOpen] = useState(false)
  const [addWorkMarkupId,  setAddWorkMarkupId]  = useState<string | null>(null)
  const addWorkModeRef = useRef(false)  // when true, next commitMarkup → reopen Add Work modal at Details
  const pendingWorkTypeRef = useRef<WorkObjectTypeDef | null>(null)

  // Mobile bottom nav
  const [mobileNav, setMobileNav] = useState<'map' | 'markers' | 'forms' | 'billing' | 'settings'>('map')

  const project     = data.projects.find((p) => p.id === projectId)
  const uploads     = (data.kmzUploads ?? []).filter((u) => u.projectId === projectId)
  const allFeatures = (data.mapFeatures ?? []).filter((f) => f.projectId === projectId)
  const allMarkups  = (data.fieldMarkups ?? []).filter((m) => m.projectId === projectId)
  const pdfs        = (data.projectFiles ?? []).filter((f) => f.projectId === projectId && f.fileType === 'pdf')
  const pendingActive = !!pending && !productionCompleted
  const canCompletePending = pendingActive && pendingBaselineMarkupCountRef.current != null && allMarkups.length > pendingBaselineMarkupCountRef.current

  const visibleFeatures = allFeatures.filter((f) => {
    const inUpload = activeUploadId === 'all' || f.kmzUploadId === activeUploadId
    const inSearch = !search || (f.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
                     f.layerName.toLowerCase().includes(search.toLowerCase())
    return inUpload && inSearch && !hiddenKmzLayerNames.has(f.layerName) && !hiddenFeatureIds.has(f.id)
  })
  const allKmzLayerNames = [...new Set(allFeatures.map((f) => f.layerName))].sort()

  // Snap-to-vertex candidates: every vertex from this project's own markups + KMZ features
  const snapCandidates = useMemo(() => {
    if (!snapEnabled) return []
    const fromMarkups = collectSnapCandidates(allMarkups.map((m) => m.geometry))
    const fromFeatures: [number, number][] = []
    for (const f of visibleFeatures) {
      try {
        const geom = JSON.parse(f.geometryGeoJson) as GeoJSON.Geometry
        if (geom.type === 'Point') {
          const [lng, lat] = geom.coordinates
          fromFeatures.push([lat, lng])
        } else if (geom.type === 'LineString') {
          for (const [lng, lat] of geom.coordinates) fromFeatures.push([lat, lng])
        } else if (geom.type === 'Polygon') {
          for (const ring of geom.coordinates) for (const [lng, lat] of ring) fromFeatures.push([lat, lng])
        }
      } catch { /* skip malformed */ }
    }
    return [...fromMarkups, ...fromFeatures]
  }, [snapEnabled, allMarkups, visibleFeatures])

  const byLayer = visibleFeatures.reduce<Record<string, MapFeature[]>>((acc, f) => {
    if (!acc[f.layerName]) acc[f.layerName] = []
    acc[f.layerName].push(f)
    return acc
  }, {})

  const statusCounts = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = allFeatures.filter((f) => f.status === s).length
    return acc
  }, {} as Record<FeatureStatus, number>)

  // Auto-collapse new layers
  useEffect(() => {
    const newLayers: string[] = []
    for (const f of allFeatures) {
      if (!seenLayersRef.current.has(f.layerName)) {
        seenLayersRef.current.add(f.layerName)
        newLayers.push(f.layerName)
      }
    }
    if (newLayers.length > 0) {
      setCollapsedLayers((prev) => {
        const next = new Set(prev)
        for (const name of newLayers) next.add(name)
        return next
      })
    }
  }, [allFeatures])

  // ── Initialize Leaflet ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    const map = L.map(mapContainerRef.current, { center: [39.5, -98.35], zoom: 4, zoomControl: true })
    // Pane z-index order: KMZ features (400) < markups (450) < markers (600)
    map.createPane('markups')
    const pane = map.getPane('markups')
    if (pane) pane.style.zIndex = '450'
    mapRef.current = map
    markupGroupRef.current = L.layerGroup().addTo(map)
    aerialSavedGroupRef.current = L.layerGroup().addTo(map)
    setMapReady(true)
    return () => {
      map.remove()
      mapRef.current = null
      markupGroupRef.current = null
      aerialSavedGroupRef.current = null
      setMapReady(false)
    }
  }, [])

  // ── Fullscreen listener ───────────────────────────────────────────────────
  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement) }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // ── Pending production entry gate (from Production.tsx's "Save + Field Map") ──
  useEffect(() => {
    if (pending && pendingBaselineMarkupCountRef.current === null) {
      pendingBaselineMarkupCountRef.current = allMarkups.length
    }
  }, [pending, allMarkups.length])

  useEffect(() => {
    if (!pendingActive) return
    window.history.pushState({ pendingBlock: true }, '')
    const onPop = () => { window.history.pushState({ pendingBlock: true }, ''); setShowLeaveConfirm(true) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [pendingActive])

  useEffect(() => {
    if (!pendingActive) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [pendingActive])

  // Leaving edit mode whenever the selected markup changes (or is deselected)
  useEffect(() => {
    setEditMode('none')
  }, [selectedMarkup?.id])

  // Reset split/merge working state whenever the active tool changes away from them
  useEffect(() => {
    if (activeTool !== 'merge') setToolSelectedIds(new Set())
    if (activeTool !== 'split') splitPickedIndicesRef.current = []
  }, [activeTool])

  // ── Render markup layers ──────────────────────────────────────────────────
  useEffect(() => {
    const group = markupGroupRef.current
    const map   = mapRef.current
    if (!group || !map || !mapReady) return
    const lMap: L.Map = map
    const mapContainer = lMap.getContainer()
    const ns = 'http://www.w3.org/2000/svg'

    group.clearLayers()
    mkpLayerMapRef.current.clear()

    // Remove overlays and SVG from the previous render (cleanup runs before this via return fn)
    calloutOverlaysRef.current.forEach((el) => el.remove())
    calloutOverlaysRef.current = []
    mapContainer.querySelector('svg.callout-arrows')?.remove()

    if (!markupVisible) return

    // Per-callout cleanup collections
    const geoListeners:   (() => void)[]    = []
    const resizeHandles:  HTMLDivElement[]  = []

    // Shared SVG for arrow lines; created lazily on first callout
    let arrowSVG: SVGSVGElement | null = null
    const ensureArrowSVG = (): SVGSVGElement => {
      if (arrowSVG) return arrowSVG
      arrowSVG = document.createElementNS(ns, 'svg') as SVGSVGElement
      arrowSVG.classList.add('callout-arrows')
      arrowSVG.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999;overflow:visible'
      const defs = document.createElementNS(ns, 'defs')
      const mkr  = document.createElementNS(ns, 'marker')
      mkr.id = 'callout-arrowhead'
      mkr.setAttribute('markerWidth', '10')
      mkr.setAttribute('markerHeight', '10')
      mkr.setAttribute('refX', '10')
      mkr.setAttribute('refY', '5')
      mkr.setAttribute('orient', 'auto')
      mkr.setAttribute('markerUnits', 'userSpaceOnUse')
      const p = document.createElementNS(ns, 'path')
      p.setAttribute('d', 'M0,0 L0,10 L10,5 z')
      p.setAttribute('fill', 'context-stroke')
      mkr.appendChild(p)
      defs.appendChild(mkr)
      arrowSVG.appendChild(defs)
      mapContainer.appendChild(arrowSVG)
      return arrowSVG
    }

    for (const m of allMarkups) {
      if (!visibleLayers.has(m.layer)) continue

      // ── Callout: scales with map zoom exactly like other markup layers ────────
      // Uses CSS transform:scale() keyed to zoom delta from creation zoom.
      // A custom resize handle (position:fixed on body) stays at the rendered
      // corner regardless of the scale factor.
      if (m.tool === 'callout') {
        if (!m.geometry.center) continue
        const color = m.color || '#ef4444'
        const geo   = m.geometry.center as [number, number]
        const saved = calloutStateRef.current.get(m.id)

        const createdAtZoom = saved?.createdAtZoom ?? lMap.getZoom()
        let offsetX    = saved?.offsetX   ?? 40
        let offsetY    = saved?.offsetY   ?? -60
        let baseWidth  = saved?.baseWidth
        let baseHeight = saved?.baseHeight

        // Scale factor relative to the zoom level when the callout was created
        const getScale = () => Math.pow(2, lMap.getZoom() - createdAtZoom)

        const scale0   = getScale()
        const anchor0  = lMap.latLngToContainerPoint(L.latLng(geo[0], geo[1]))

        // Overlay div — no CSS resize (transform:scale breaks the native handle's hit area)
        const overlay = document.createElement('div')
        overlay.style.cssText = `position:absolute;left:${anchor0.x + offsetX * scale0}px;top:${anchor0.y + offsetY * scale0}px;z-index:1000;background:rgba(0,0,0,0.88);border:2px solid ${color};border-radius:5px;padding:8px 10px;color:${color};font-size:${m.fontSize ?? 11}px;font-weight:600;box-shadow:0 3px 14px rgba(0,0,0,0.75);overflow:hidden;min-width:180px;max-width:none;width:max-content;transform-origin:0 0;transform:scale(${scale0})`
        if (baseWidth)  overlay.style.width  = baseWidth  + 'px'
        if (baseHeight) overlay.style.height = baseHeight + 'px'

        // SVG dashed arrow: from overlay center → markup geo point
        const svg       = ensureArrowSVG()
        const arrowLine = document.createElementNS(ns, 'line') as SVGLineElement
        arrowLine.setAttribute('stroke', color)
        arrowLine.setAttribute('stroke-width', '1.5')
        arrowLine.setAttribute('stroke-dasharray', '6 3')
        arrowLine.setAttribute('opacity', '0.75')
        arrowLine.setAttribute('marker-end', 'url(#callout-arrowhead)')
        svg.appendChild(arrowLine)

        // Custom resize handle — fixed on body so it's always at the visual corner
        const rh = document.createElement('div')
        rh.style.cssText = 'position:fixed;width:14px;height:14px;background:rgba(255,255,255,0.85);border:1.5px solid rgba(0,0,0,0.35);border-radius:2px;cursor:se-resize;z-index:2000;display:none'
        document.body.appendChild(rh)
        resizeHandles.push(rh)

        // Recomputes and applies position, scale, arrow, and resize-handle location
        const updateAll = () => {
          const scale = getScale()
          const pt    = lMap.latLngToContainerPoint(L.latLng(geo[0], geo[1]))
          const left  = pt.x + offsetX * scale
          const top   = pt.y + offsetY * scale
          overlay.style.left      = left + 'px'
          overlay.style.top       = top  + 'px'
          overlay.style.transform = `scale(${scale})`
          // Arrow: center of rendered box → geo anchor
          arrowLine.setAttribute('x1', String(left + overlay.offsetWidth  * scale / 2))
          arrowLine.setAttribute('y1', String(top  + overlay.offsetHeight * scale / 2))
          arrowLine.setAttribute('x2', String(pt.x))
          arrowLine.setAttribute('y2', String(pt.y))
          // Resize handle: bottom-right of rendered box in viewport coordinates
          const cr = mapContainer.getBoundingClientRect()
          rh.style.left    = (cr.left + left + overlay.offsetWidth  * scale - 7) + 'px'
          rh.style.top     = (cr.top  + top  + overlay.offsetHeight * scale - 7) + 'px'
          rh.style.display = 'block'
        }
        lMap.on('move zoom viewreset', updateAll)
        geoListeners.push(updateAll)

        // Resize handle drag
        rh.addEventListener('mousedown', (e) => {
          e.stopPropagation()
          e.preventDefault()
          lMap.dragging.disable()
          const scale  = getScale()
          const startX = e.clientX, startY = e.clientY
          const startW = overlay.offsetWidth, startH = overlay.offsetHeight
          const onMove = (ev: MouseEvent) => {
            baseWidth  = Math.max(140, startW + (ev.clientX - startX) / scale)
            baseHeight = Math.max( 40, startH + (ev.clientY - startY) / scale)
            overlay.style.width  = baseWidth  + 'px'
            overlay.style.height = baseHeight + 'px'
            updateAll()
          }
          const onUp = () => {
            lMap.dragging.enable()
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup',  onUp)
            calloutStateRef.current.set(m.id, { offsetX, offsetY, createdAtZoom, baseWidth, baseHeight })
          }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup',  onUp)
        })

        // ✕ close button
        const closeBtn = document.createElement('span')
        closeBtn.textContent = '✕'
        closeBtn.title = 'Remove callout'
        closeBtn.style.cssText = 'float:right;margin-left:8px;cursor:pointer;opacity:0.65;font-size:13px;line-height:1'
        closeBtn.addEventListener('mousedown', (e) => e.stopPropagation())
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          overlay.remove()
          arrowLine.remove()
          rh.remove()
          deleteMarkup(m.id)
        })
        overlay.appendChild(closeBtn)

        // Label
        const labelEl = document.createElement('span')
        labelEl.style.cssText = 'white-space:pre-line;word-break:break-word;line-height:1.55;display:block'
        labelEl.textContent = m.label ?? ''
        overlay.appendChild(labelEl)

        // Photo (above label)
        const photoBlobKey = m.subtype === 'billing_callout' && m.featureType ? m.featureType : null
        if (photoBlobKey) {
          const imgEl = document.createElement('img')
          imgEl.style.cssText = 'display:none;width:100%;max-height:90px;object-fit:cover;border-radius:3px;margin-bottom:5px'
          overlay.insertBefore(imgEl, labelEl)
          loadBlob(photoBlobKey).then((url) => {
            if (url) { imgEl.src = url; imgEl.style.display = 'block' }
          })
        }

        // Hide photo when rendered height is too small
        const ro = new ResizeObserver(() => {
          const renderedH = overlay.offsetHeight * getScale()
          overlay.querySelectorAll('img').forEach((img) => {
            (img as HTMLElement).style.display = renderedH >= 110 ? 'block' : 'none'
          })
        })
        ro.observe(overlay)

        // Drag to reposition — offset stored in base (createdAtZoom) pixels
        overlay.addEventListener('mousedown', (e) => {
          e.stopPropagation()
          lMap.dragging.disable()
          const scale = getScale()
          const sx = e.clientX, sy = e.clientY
          const sl = overlay.offsetLeft, st = overlay.offsetTop
          const onMove = (ev: MouseEvent) => {
            const newLeft = sl + ev.clientX - sx
            const newTop  = st + ev.clientY - sy
            overlay.style.left = newLeft + 'px'
            overlay.style.top  = newTop  + 'px'
            const pt = lMap.latLngToContainerPoint(L.latLng(geo[0], geo[1]))
            offsetX = (newLeft - pt.x) / scale
            offsetY = (newTop  - pt.y) / scale
            updateAll()
          }
          const onUp = () => {
            lMap.dragging.enable()
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup',  onUp)
            const prev = calloutStateRef.current.get(m.id)
            calloutStateRef.current.set(m.id, { offsetX, offsetY, createdAtZoom, baseWidth: prev?.baseWidth, baseHeight: prev?.baseHeight })
          }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup',  onUp)
        })
        overlay.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: false })

        mapContainer.appendChild(overlay)
        calloutOverlaysRef.current.push(overlay)
        if (!saved) calloutStateRef.current.set(m.id, { offsetX, offsetY, createdAtZoom })

        requestAnimationFrame(updateAll)
        continue
      }

      // ── All other markup types: standard Leaflet layers ───────────────────
      const layer = markupToLayer(m, lMap)
      if (!layer) continue
      group.addLayer(layer)
      mkpLayerMapRef.current.set(m.id, layer)

      layer.on('click', (e: L.LeafletEvent) => {
        L.DomEvent.stopPropagation(e as L.LeafletMouseEvent)
        if (activeTool === 'merge') {
          setToolSelectedIds((prev) => {
            const next = new Set(prev)
            if (next.has(m.id)) next.delete(m.id)
            else next.add(m.id)
            return next
          })
          return
        }
        if (activeTool === 'split') {
          setSelectedMarkup(m)
          return
        }
        const fresh = (data.fieldMarkups ?? []).find((mk) => mk.id === m.id)
        if (fresh) {
          setSelectedMarkup(fresh)
          setSelectedFeature(null)
          setPanelCollapsed(false)
        }
      })

      // Edit handles for the markup currently selected + in edit mode
      if (editMode !== 'none' && selectedMarkup?.id === m.id && !m.lockedAt) {
        const handles = buildEditHandles(m, editMode, (patch) => updateMarkup(m.id, patch))
        handles.forEach((h) => group.addLayer(h))
      }

      // Split-mode vertex markers for the selected line/polygon
      if (activeTool === 'split' && selectedMarkup?.id === m.id && m.geometry.latlngs?.length) {
        const splitHandles = buildSplitVertexMarkers(m, (idx) => handleSplitVertexClick(m, idx))
        splitHandles.forEach((h) => group.addLayer(h))
      }

      // Merge-mode selection highlight
      if (activeTool === 'merge' && toolSelectedIds.has(m.id)) {
        const highlight = L.circleMarker(
          m.geometry.center ?? m.geometry.latlngs?.[0] ?? m.geometry.bounds?.[0] ?? [0, 0],
          { radius: 8, color: '#f97316', weight: 2, fill: false, pane: 'markups' },
        )
        group.addLayer(highlight)
      }
    }

    return () => {
      for (const fn of geoListeners) lMap.off('move zoom viewreset', fn)
      for (const h of resizeHandles) h.remove()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMarkups, markupVisible, visibleLayers, mapReady, editMode, selectedMarkup?.id, activeTool, toolSelectedIds])

  // ── Render georeferenced PDF overlays ─────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const lMap: L.Map = map
    const mapContainer = lMap.getContainer()
    const overlays = (data.fieldMapOverlays ?? []).filter((o) => o.projectId === projectId && o.visible)
    const cleanups: (() => void)[] = []
    let cancelled = false

    overlays.forEach((o) => {
      const el = document.createElement('img')
      el.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;z-index:350'
      el.style.opacity = String(o.opacity)
      el.width = o.naturalWidth
      el.height = o.naturalHeight
      mapContainer.appendChild(el)

      let transform: GeoTransform | null = null
      try { transform = computeTransform(o.controlPoints) } catch { transform = null }

      function reposition() {
        if (!transform) return
        const mtx = computeScreenMatrix(transform, o.naturalWidth, o.naturalHeight, (lat, lng) => {
          const pt = lMap.latLngToContainerPoint([lat, lng])
          return { x: pt.x, y: pt.y }
        })
        el.style.transform = `matrix(${mtx.A}, ${mtx.B}, ${mtx.C}, ${mtx.D}, ${mtx.E}, ${mtx.F})`
      }

      loadBlob(o.imageBlobKey).then((url) => {
        if (cancelled || !url) return
        el.src = url
        reposition()
      })

      lMap.on('move zoom viewreset resize', reposition)
      cleanups.push(() => {
        lMap.off('move zoom viewreset resize', reposition)
        el.remove()
      })
    })

    return () => {
      cancelled = true
      cleanups.forEach((fn) => fn())
    }
  }, [data.fieldMapOverlays, projectId, mapReady])

  // ── Swap base tile layer ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (tileLayerRef.current) tileLayerRef.current.remove()
    const isSat = mapLayer === 'satellite'
    tileLayerRef.current = L.tileLayer(
      isSat
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: isSat ? '© Esri' : '© OpenStreetMap contributors', maxZoom: 19 },
    ).addTo(map)
  }, [mapLayer])

  // ── Render KMZ GeoJSON features ───────────────────────────────────────────
  function layerFallbackColor(layerName: string): string {
    const palette = ['#10b981','#3b82f6','#f59e0b','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316']
    let h = 0
    for (let i = 0; i < layerName.length; i++) h = ((h << 5) - h) + layerName.charCodeAt(i)
    return palette[Math.abs(h) % palette.length]
  }

  function resolveColor(styleColor: string | null, layerName: string, status: FeatureStatus, mode: 'kmz' | 'status'): string {
    if (mode === 'status') return FEATURE_STATUS_META[status]?.color ?? '#6b7280'
    return styleColor ?? layerFallbackColor(layerName)
  }

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (geoLayerRef.current) { geoLayerRef.current.remove(); geoLayerRef.current = null }
    layerMapRef.current.clear()
    if (visibleFeatures.length === 0) return

    const geoFeatures: GeoJSON.Feature[] = []
    for (const f of visibleFeatures) {
      try {
        geoFeatures.push({
          type: 'Feature', id: f.id,
          geometry: JSON.parse(f.geometryGeoJson) as GeoJSON.Geometry,
          properties: { id: f.id, status: f.status, name: f.name, layerName: f.layerName, styleColor: f.styleColor, iconHref: f.iconHref },
        })
      } catch { /* skip malformed */ }
    }

    const getColor = (props: Record<string, unknown> | null) =>
      resolveColor(
        (props?.styleColor as string | null) ?? null,
        (props?.layerName as string) ?? '',
        (props?.status as FeatureStatus) ?? 'not_started',
        colorMode,
      )

    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: geoFeatures }
    const layer = L.geoJSON(fc, {
      style: (feat) => {
        const c = getColor(feat?.properties ?? null)
        return { color: c, weight: 3, opacity: 0.9, fillColor: c, fillOpacity: 0.2 }
      },
      pointToLayer: (feat, latlng) => {
        const c = getColor(feat.properties ?? null)
        const iconHref = feat.properties?.iconHref as string | null | undefined
        if (iconHref) {
          return L.marker(latlng, {
            icon: L.divIcon({
              className: '',
              html: `<img src="${iconHref}" style="width:24px;height:24px;display:block" />`,
              iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12],
            }),
          })
        }
        return L.circleMarker(latlng, { radius: 8, color: c, fillColor: c, fillOpacity: 0.75, weight: 2 })
      },
      onEachFeature: (feat, lyr) => {
        const fid = feat.properties?.id as string
        layerMapRef.current.set(fid, lyr)
        lyr.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          const mf = allFeatures.find((f) => f.id === fid)
          if (mf) { setSelectedFeature(mf); setSelectedMarkup(null) }
        })
        if (feat.properties?.name) {
          lyr.bindTooltip(feat.properties.name as string, { permanent: false, sticky: true })
        }
      },
    }).addTo(map)

    geoLayerRef.current = layer
    try {
      const bounds = layer.getBounds()
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 })
    } catch { /* no valid bounds */ }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.mapFeatures, activeUploadId, search, colorMode])

  // ── Commit a completed markup drawing ────────────────────────────────────
  const commitMarkup = useCallback((partial: Omit<FieldMarkup, 'id' | 'createdAt' | 'projectId' | 'status' | 'layer' | 'crewId' | 'createdBy' | 'updatedAt' | 'lockedAt'>) => {
    if (!projectId) return
    const colorCodeOverride = activeColorCodeRef.current
      ? { colorCode: activeColorCodeRef.current }
      : {}

    const workObjectTypeOverride = pendingWorkTypeRef.current
      ? { workObjectType: pendingWorkTypeRef.current.id, color: pendingWorkTypeRef.current.defaultColor, unit: pendingWorkTypeRef.current.defaultUnit }
      : {}

    const id = addMarkup({
      ...partial,
      ...colorCodeOverride,
      ...workObjectTypeOverride,
      projectId,
      status: 'pending' as MarkupStatus,
      layer: rlLayer,
      crewId: null,
      createdBy: null,
      updatedAt: null,
      lockedAt: null,
    })
    undoStackRef.current.push(id)
    redoStackRef.current = []
    // Open the Add Work modal, the Distribution Line modal (Report mode), or the right panel
    setTimeout(() => {
      if (addWorkModeRef.current) {
        addWorkModeRef.current = false
        pendingWorkTypeRef.current = null
        setAddWorkMarkupId(id)
        setAddWorkModalOpen(true)
        setSelectedMarkup(null)
      } else if (reportModeRef.current) {
        reportModeRef.current = false
        setDistModalId(id)
        setSelectedMarkup(null)
      } else {
        const mk = (data.fieldMarkups ?? []).find((m) => m.id === id)
          ?? { id, projectId, ...partial, ...workObjectTypeOverride, status: 'pending' as MarkupStatus, layer: rlLayer, crewId: null, createdBy: null, createdAt: new Date().toISOString(), updatedAt: null, lockedAt: null }
        setSelectedMarkup(mk as FieldMarkup)
        setSelectedFeature(null)
        setPanelCollapsed(false)
      }
    }, 50)
  }, [projectId, addMarkup, rlLayer, data.fieldMarkups])

  // ── Markup drawing events (click-based tools only; drag-draw handled by overlay div) ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !rlActive || activeTool === 'select' || activeTool === 'aerial_lash' || isDragDrawTool(activeTool as string)) return

    // Polygon / Multi-Line / Measure / Cloud: click-to-add-point, dblclick-to-finish
    if (activeTool === 'polygon' || activeTool === 'multi_line' || activeTool === 'measure' || activeTool === 'cloud') {
      const pmap: L.Map = map
      let clickHandler: ((e: L.LeafletMouseEvent) => void) | null = null
      let dblClickHandler: ((e: L.LeafletMouseEvent) => void) | null = null

      // Open-path modes render as a polyline preview (not a closed, filled polygon) and commit with their own tool value.
      const isMultiLine = () => activeTool === 'multi_line' || activeTool === 'measure'

      // lastTouchMs guards against double-fire: on touch devices the browser fires
      // touchend → (synthetic) click in sequence; we handle touchend directly and
      // skip the follow-on click so each tap adds exactly one point.
      let lastTouchMs = 0

      const addPoint = (latlng: L.LatLng) => {
        const snapped = snapEnabled ? findSnapPoint(latlng, snapCandidates, pmap) : null
        polygonPtsRef.current.push(snapped ?? [latlng.lat, latlng.lng])
        if (polygonPtsRef.current.length === 1) setPolygonInProgress(true)
        if (polygonPreviewRef.current) polygonPreviewRef.current.remove()
        if (polygonPtsRef.current.length >= 2) {
          const previewOpts = { color: rlColor, weight: rlWeight, opacity: 0.8, pane: 'markups' as string }
          polygonPreviewRef.current = (isMultiLine()
            ? L.polyline(polygonPtsRef.current, previewOpts)
            : L.polygon(polygonPtsRef.current, { ...previewOpts, fill: true, fillColor: rlColor, fillOpacity: rlFillOpacity })
          ).addTo(pmap)
        }
      }

      const finishPolygon = () => {
        const pts = polygonPtsRef.current
        polygonPtsRef.current = []
        setPolygonInProgress(false)
        if (polygonPreviewRef.current) { polygonPreviewRef.current.remove(); polygonPreviewRef.current = null }
        const minPts = isMultiLine() ? 2 : 3
        if (pts.length >= minPts) {
          const committedTool: MarkupTool = activeTool === 'multi_line' || activeTool === 'measure' || activeTool === 'cloud' ? activeTool : 'polygon'
          commitMarkup({
            tool: committedTool, subtype: activeSubtype, color: rlColor, weight: rlWeight,
            fillColor: rlColor, fillOpacity: rlFillOpacity, opacity: rlOpacity,
            geometry: { latlngs: pts }, label: null, fontSize: 13,
            featureType: null, featureName: null, notes: null,
            lengthFt: latlngsLengthFt(pts), quantity: null,
          })
        }
      }

      finishPolygonRef.current = finishPolygon

      // Mouse click handler — skipped when a touch just fired to avoid double-add
      clickHandler = (e: L.LeafletMouseEvent) => {
        if (Date.now() - lastTouchMs < 500) return
        addPoint(e.latlng)
      }
      // Always add the dblclick endpoint before finishing — Leaflet's dblClickZoom may
      // cancel the click events that fire during a double-click.
      dblClickHandler = (e) => {
        L.DomEvent.stopPropagation(e)
        if (Date.now() - lastTouchMs < 500) return
        const snapped = snapEnabled ? findSnapPoint(e.latlng, snapCandidates, pmap) : null
        polygonPtsRef.current.push(snapped ?? [e.latlng.lat, e.latlng.lng])
        finishPolygon()
      }

      // Touch handler — reliable tap detection directly on the map container.
      // Leaflet's built-in tap→click conversion can miss taps or fire too late;
      // listening to touchend directly is much more responsive on phones/tablets.
      const container = pmap.getContainer()
      let touchStartX = 0, touchStartY = 0
      const onTouchStart = (ev: TouchEvent) => {
        const t = ev.touches[0]; if (!t) return
        touchStartX = t.clientX; touchStartY = t.clientY
      }
      const onTouchEnd = (ev: TouchEvent) => {
        const t = ev.changedTouches[0]; if (!t) return
        if (Math.abs(t.clientX - touchStartX) > 15 || Math.abs(t.clientY - touchStartY) > 15) return
        lastTouchMs = Date.now()
        const rect = container.getBoundingClientRect()
        const latlng = pmap.containerPointToLatLng(L.point(t.clientX - rect.left, t.clientY - rect.top))
        addPoint(latlng)
      }

      pmap.on('click', clickHandler)
      pmap.on('dblclick', dblClickHandler)
      container.addEventListener('touchstart', onTouchStart, { passive: true })
      container.addEventListener('touchend', onTouchEnd, { passive: true })
      return () => {
        if (clickHandler) pmap.off('click', clickHandler)
        if (dblClickHandler) pmap.off('dblclick', dblClickHandler)
        container.removeEventListener('touchstart', onTouchStart)
        container.removeEventListener('touchend', onTouchEnd)
        polygonPtsRef.current = []
        setPolygonInProgress(false)
        finishPolygonRef.current = null
        if (polygonPreviewRef.current) { polygonPreviewRef.current.remove(); polygonPreviewRef.current = null }
      }
    }

    // Feature drop — single click
    if (isFeatureDrop(activeTool as string)) {
      const onDropClick = (e: L.LeafletMouseEvent) => {
        const meta = FEATURE_TOOL_LABELS[activeTool as string]
        commitMarkup({
          tool: activeTool as MarkupTool, subtype: activeTool as string,
          color: meta?.color ?? rlColor, weight: rlWeight,
          fillColor: null, fillOpacity: 0, opacity: 1,
          geometry: { center: [e.latlng.lat, e.latlng.lng] },
          label: null, fontSize: 13,
          featureType: activeTool as string, featureName: null, notes: null,
          lengthFt: null, quantity: null,
        })
      }
      map.on('click', onDropClick)
      return () => { map.off('click', onDropClick) }
    }

    // Text/callout — single click
    if (activeTool === 'text' || activeTool === 'callout') {
      const tmap: L.Map = map
      const onTextClick = (e: L.LeafletMouseEvent) => {
        const pt = tmap.latLngToContainerPoint(e.latlng)
        setTextPos({ x: pt.x, y: pt.y, lat: e.latlng.lat, lng: e.latlng.lng })
        setTextVal('')
        setTimeout(() => textInputRef.current?.focus(), 30)
      }
      tmap.on('click', onTextClick)
      return () => { tmap.off('click', onTextClick) }
    }
  }, [rlActive, activeTool, activeSubtype, rlColor, rlWeight, rlFillOpacity, rlOpacity, projectId, commitMarkup, snapEnabled, snapCandidates])

  // ── Aerial lash fiber: drawing mode ──────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !rlActive || activeTool !== 'aerial_lash') return

    const lashColor = MARKUP_COLOR_CODES['lash_aerial'].color

    function createPoleIcon(poleNumber: number, done: boolean): L.DivIcon {
      const border = done ? '#22c55e' : lashColor
      const bg     = done ? '#052e16' : '#0d0d0d'
      return L.divIcon({
        className: '',
        html: `<div style="width:22px;height:22px;border:2.5px solid ${border};${!done ? 'border-style:dashed;' : ''}border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:${border};font-family:monospace;">${poleNumber}</div>`,
        iconSize:   [22, 22],
        iconAnchor: [11, 11],
      })
    }

    function addPole(latlng: L.LatLng) {
      const poleNumber = aerialPolesRef.current.length + 1
      const newPole: AerialPole = {
        poleNumber, lat: latlng.lat, lng: latlng.lng,
        tickMark: null, notes: null, crewName: null, dateTime: null, completed: false,
      }
      aerialPolesRef.current = [...aerialPolesRef.current, newPole]

      const marker = L.marker(latlng, {
        icon: createPoleIcon(poleNumber, false),
        pane: 'markups',
        interactive: true,
        zIndexOffset: 100,
      }).addTo(map!)
      const idx = aerialPolesRef.current.length - 1
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        setEditingPole({ pole: aerialPolesRef.current[idx], index: idx })
      })
      aerialPoleMarkersRef.current.push(marker)

      const latlngs = aerialPolesRef.current.map((p) => [p.lat, p.lng] as [number, number])
      if (aerialLineLayerRef.current) {
        aerialLineLayerRef.current.setLatLngs(latlngs)
      } else if (latlngs.length >= 2) {
        aerialLineLayerRef.current = L.polyline(latlngs, {
          color: lashColor, weight: 3, opacity: 0.9, pane: 'markups',
        }).addTo(map!)
      }
      setAerialRunInProgress(true)
    }

    function finishAerialRun() {
      const poles = aerialPolesRef.current
      if (poles.length < 2) return
      let footage = 0
      for (let i = 1; i < poles.length; i++) {
        footage += L.latLng(poles[i - 1].lat, poles[i - 1].lng)
          .distanceTo(L.latLng(poles[i].lat, poles[i].lng)) * 3.28084
      }
      addAerialLashFiberRun({
        projectId: projectId!,
        status: 'in_progress',
        poles,
        notes: null,
        totalFootage: Math.round(footage),
        totalPoles:   poles.length,
        color:        lashColor,
        colorCode:    'lash_aerial',
        updatedAt:    null,
      })
      aerialPolesRef.current = []
      aerialPoleMarkersRef.current.forEach((m) => m.remove())
      aerialPoleMarkersRef.current = []
      aerialLineLayerRef.current?.remove()
      aerialLineLayerRef.current = null
      setAerialRunInProgress(false)
      setActiveTool('select')
    }

    finishAerialRunRef.current = finishAerialRun

    // Touch: tap to place pole
    let lastTouchMs = 0, touchStartX = 0, touchStartY = 0
    const container = map.getContainer()
    const onTouchStart = (ev: TouchEvent) => {
      const t = ev.touches[0]; if (!t) return
      touchStartX = t.clientX; touchStartY = t.clientY
    }
    const onTouchEnd = (ev: TouchEvent) => {
      const t = ev.changedTouches[0]; if (!t) return
      if (Math.abs(t.clientX - touchStartX) > 15 || Math.abs(t.clientY - touchStartY) > 15) return
      lastTouchMs = Date.now()
      const rect = container.getBoundingClientRect()
      addPole(map.containerPointToLatLng(L.point(t.clientX - rect.left, t.clientY - rect.top)))
    }
    container.addEventListener('touchstart', onTouchStart)
    container.addEventListener('touchend', onTouchEnd)

    const onClick = (e: L.LeafletMouseEvent) => {
      if (Date.now() - lastTouchMs < 500) return
      addPole(e.latlng)
    }
    map.on('click', onClick)

    return () => {
      map.off('click', onClick)
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchend', onTouchEnd)
      finishAerialRunRef.current = null
    }
  }, [rlActive, activeTool, projectId, addAerialLashFiberRun])

  // ── Aerial lash fiber: render saved runs ────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const group = aerialSavedGroupRef.current
    if (!map || !group || !mapReady) return

    group.clearLayers()
    const lashColor = MARKUP_COLOR_CODES['lash_aerial'].color
    const runs = (data.aerialLashFiberRuns ?? []).filter((r) => r.projectId === projectId)

    runs.forEach((run) => {
      if (run.poles.length < 1) return
      if (run.poles.length >= 2) {
        L.polyline(run.poles.map((p) => [p.lat, p.lng] as [number, number]), {
          color: run.color, weight: 3, opacity: 0.9, pane: 'markups',
        }).addTo(group)
      }
      run.poles.forEach((pole, idx) => {
        const done   = pole.completed
        const border = done ? '#22c55e' : lashColor
        const bg     = done ? '#052e16' : '#0d0d0d'
        const icon   = L.divIcon({
          className: '',
          html: `<div style="width:22px;height:22px;border:2.5px solid ${border};${!done ? 'border-style:dashed;' : ''}border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:${border};font-family:monospace;">${pole.poleNumber}</div>`,
          iconSize: [22, 22], iconAnchor: [11, 11],
        })
        const marker = L.marker([pole.lat, pole.lng], {
          icon, pane: 'markups', interactive: true, zIndexOffset: 100,
        }).addTo(group)
        // Capture run/pole by value for closure
        const capturedRun = run
        const capturedIdx = idx
        marker.on('click', () => {
          setEditingPole({ pole: capturedRun.poles[capturedIdx], index: capturedIdx })
          setSelectedAerialRun(capturedRun)
          setPanelCollapsed(false)
        })
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.aerialLashFiberRuns, projectId, mapReady])

  // Show crosshair cursor on Leaflet map when in click-to-draw mode (polygon, feature-drop, text)
  useEffect(() => {
    if (!mapReady) return
    const el = mapContainerRef.current
    if (!el) return
    const leaf = el.querySelector('.leaflet-container') as HTMLElement | null
    if (!leaf) return
    const inClickDraw = rlActive && activeTool !== 'select' && !isDragDrawTool(activeTool as string)
    leaf.style.cursor = inClickDraw ? 'crosshair' : ''
    return () => { leaf.style.cursor = '' }
  }, [rlActive, activeTool, mapReady])

  // ── Shared pan logic (direct mapPane CSS manipulation) ───────────────────
  function applyPanDelta(dx: number, dy: number) {
    const map = mapRef.current
    if (!map || (!dx && !dy)) return
    const pane = map.getPane('mapPane') as HTMLElement | undefined
    if (!pane) return
    const pos = L.DomUtil.getPosition(pane)
    L.DomUtil.setPosition(pane, L.point(pos.x + dx, pos.y + dy))
  }

  function syncPanState() {
    const map = mapRef.current
    if (!map) return
    const size = map.getSize()
    const newCenter = map.containerPointToLatLng(L.point(size.x / 2, size.y / 2))
    map.setView(newCenter, map.getZoom(), { animate: false })
  }

  function forwardWheel(e: WheelEvent) {
    const container = mapContainerRef.current
    if (!container) return
    container.dispatchEvent(new WheelEvent('wheel', {
      deltaY: e.deltaY, deltaX: e.deltaX, deltaMode: e.deltaMode,
      clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true,
    }))
  }

  // ── Pan overlay (draw-mode hand/select tool) ──────────────────────────────
  useEffect(() => {
    if (!rlActive || activeTool !== 'select') return
    const overlayEl = panOverlayRef.current
    if (!overlayEl) return
    const overlay: HTMLDivElement = overlayEl

    let lastX = 0
    let lastY = 0

    function onDown(e: PointerEvent) {
      e.preventDefault()
      overlay.setPointerCapture(e.pointerId)
      lastX = e.clientX
      lastY = e.clientY
      overlay.style.cursor = 'grabbing'
    }

    function onMove(e: PointerEvent) {
      if (!overlay.hasPointerCapture(e.pointerId)) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      applyPanDelta(dx, dy)
    }

    function onUp(e: PointerEvent) {
      if (!overlay.hasPointerCapture(e.pointerId)) return
      overlay.releasePointerCapture(e.pointerId)
      overlay.style.cursor = 'grab'
      syncPanState()
    }

    overlay.addEventListener('pointerdown', onDown)
    overlay.addEventListener('pointermove', onMove)
    overlay.addEventListener('pointerup', onUp)
    overlay.addEventListener('pointercancel', onUp)
    overlay.addEventListener('wheel', forwardWheel, { passive: true })

    return () => {
      overlay.removeEventListener('pointerdown', onDown)
      overlay.removeEventListener('pointermove', onMove)
      overlay.removeEventListener('pointerup', onUp)
      overlay.removeEventListener('pointercancel', onUp)
      overlay.removeEventListener('wheel', forwardWheel)
    }
  }, [rlActive, activeTool])

  // ── Normal-mode pan (outside draw mode) ──────────────────────────────────
  // Leaflet's native drag is unreliable in this layout, so we implement it
  // directly on the container. We use a 5px movement threshold so that clicks
  // on KMZ features (which don't move the pointer) still fire normally.
  useEffect(() => {
    if (rlActive || !mapReady) return
    const containerEl = mapContainerRef.current
    if (!containerEl) return
    const container: HTMLDivElement = containerEl

    let capturing = false
    let lastX = 0
    let lastY = 0
    let startX = 0
    let startY = 0

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return
      startX = lastX = e.clientX
      startY = lastY = e.clientY
      capturing = false
    }

    function onMove(e: PointerEvent) {
      if (e.buttons !== 1) return
      if (!capturing) {
        if (Math.abs(e.clientX - startX) < 5 && Math.abs(e.clientY - startY) < 5) return
        container.setPointerCapture(e.pointerId)
        capturing = true
        lastX = e.clientX
        lastY = e.clientY
        return
      }
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      applyPanDelta(dx, dy)
    }

    function onUp(e: PointerEvent) {
      if (!capturing) return
      container.releasePointerCapture(e.pointerId)
      capturing = false
      syncPanState()
    }

    container.addEventListener('pointerdown', onDown)
    container.addEventListener('pointermove', onMove)
    container.addEventListener('pointerup', onUp)
    container.addEventListener('pointercancel', onUp)

    return () => {
      container.removeEventListener('pointerdown', onDown)
      container.removeEventListener('pointermove', onMove)
      container.removeEventListener('pointerup', onUp)
      container.removeEventListener('pointercancel', onUp)
    }
  }, [rlActive, mapReady])

  // ── Handlers ──────────────────────────────────────────────────────────────
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen()
    else wrapperRef.current?.requestFullscreen()
  }

  function confirmText() {
    const label = textVal.trim()
    setTextPos(null); setTextVal('')
    if (!textPos || !label) return
    commitMarkup({
      tool: (activeTool === 'callout' ? 'callout' : 'text') as MarkupTool,
      subtype: activeSubtype,
      color: rlColor, weight: rlWeight, fillColor: null, fillOpacity: 0, opacity: rlOpacity,
      geometry: { center: [textPos.lat, textPos.lng] },
      label, fontSize: 13, featureType: null, featureName: null, notes: null,
      lengthFt: null, quantity: null,
    })
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
    // `addMarkup` overwrites id/createdAt itself, so passing the full snapshot through is safe.
    const newId = addMarkup(snapshot)
    undoStackRef.current.push(newId)
  }

  // Enter "Report Line" mode — draw a polyline then show the Distribution Line modal
  function handleReportLine() {
    reportModeRef.current = true
    setRlActive(true)
    setActiveColorCode(null); activeColorCodeRef.current = null
    setActiveTool('polygon')
    setActiveSubtype('polyline')
    setMobileNav('map')
  }

  /** Add Work Step 1 (Type) → arm the map's draw tool with this type's defaults and close the modal to draw. */
  function startAddWork(type: WorkObjectTypeDef) {
    pendingWorkTypeRef.current = type
    addWorkModeRef.current = true
    reportModeRef.current = false
    setActiveColorCode(null); activeColorCodeRef.current = null
    setRlColor(type.defaultColor)
    setRlActive(true)
    if (type.defaultGeometry === 'polygon') {
      setActiveTool('polygon')
    } else if (type.defaultGeometry === 'line') {
      setActiveTool('pen')
    } else {
      setActiveTool(type.defaultMarkupTool)
    }
    setAddWorkModalOpen(false)
    setMobileNav('map')
  }

  function toggleWorkObjectLayer(layer: MarkupLayer) {
    setVisibleLayers((prev) => {
      const next = new Set(prev)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  }

  function toggleKmzLayerVisibility(layerName: string) {
    setHiddenKmzLayerNames((prev) => {
      const next = new Set(prev)
      if (next.has(layerName)) next.delete(layerName)
      else next.add(layerName)
      return next
    })
  }

  function toggleFeatureVisibility(featureId: string) {
    setHiddenFeatureIds((prev) => {
      const next = new Set(prev)
      if (next.has(featureId)) next.delete(featureId)
      else next.add(featureId)
      return next
    })
  }

  async function handleExportReport() {
    if (!mapContainerRef.current || exportingReport) return
    setExportingReport(true)
    try {
      const rows = buildReportRows(allMarkups, (data.markupBilling ?? []).filter((b) => allMarkups.some((m) => m.id === b.markupId)))
      await exportFieldMapReport(mapContainerRef.current, project?.name ?? 'Project', rows)
    } catch (err) {
      console.error('Field Map report export error', err)
      alert('Export failed — please try again.')
    } finally {
      setExportingReport(false)
    }
  }

  async function handleCompleteProduction() {
    if (!pending || !canCompletePending) return
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
    setProductionCompleted(true)
  }

  // ── Split ──────────────────────────────────────────────────────────────
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
      addMarkup({ ...markup, geometry: { latlngs: lineA }, lengthFt: latlngsLengthFt(lineA) })
      addMarkup({ ...markup, geometry: { latlngs: lineB }, lengthFt: latlngsLengthFt(lineB) })
      deleteMarkup(markup.id)
      setSelectedMarkup(null)
      setActiveTool('select')
    }
  }

  // ── Merge ──────────────────────────────────────────────────────────────
  function performMerge() {
    const ids = [...toolSelectedIds]
    if (ids.length !== 2) return
    const a = allMarkups.find((mk) => mk.id === ids[0])
    const b = allMarkups.find((mk) => mk.id === ids[1])
    if (!a || !b || !a.geometry.latlngs?.length || !b.geometry.latlngs?.length || a.tool !== b.tool) return

    if (a.tool === 'polygon') {
      const rings = unionPolygons(a.geometry.latlngs, b.geometry.latlngs)
      for (const ring of rings) addMarkup({ ...a, geometry: { latlngs: ring }, lengthFt: null })
    } else {
      const merged = mergeLines(a.geometry.latlngs, b.geometry.latlngs)
      addMarkup({ ...a, geometry: { latlngs: merged }, lengthFt: latlngsLengthFt(merged) })
    }
    deleteMarkup(a.id)
    deleteMarkup(b.id)
    setToolSelectedIds(new Set())
    setActiveTool('select')
  }


  // ── Drag-to-draw overlay handlers ────────────────────────────────────────
  // These fire on a transparent div that sits over the map only when a drag-draw
  // tool is active. Because the overlay is a sibling on top of the Leaflet
  // container, Leaflet never sees the mousedown/move/up events, so its native
  // drag handler stays enabled and works normally in select/pan mode.
  // Touch equivalents (onTouchStart/Move/End) mirror each mouse handler so the
  // same draw tools work on phone/tablet screens.

  function touchToLatLng(touch: { clientX: number; clientY: number }): L.LatLng {
    const map = mapRef.current!
    const rect = map.getContainer().getBoundingClientRect()
    return map.containerPointToLatLng(L.point(touch.clientX - rect.left, touch.clientY - rect.top))
  }

  function drawStart(latlng: L.LatLng, map: L.Map) {
    drawActiveRef.current = true
    drawStartLLRef.current = latlng
    const drawOpts: L.PathOptions = {
      color: rlColor, weight: rlWeight, opacity: 0.95, pane: 'markups',
      dashArray: activeTool === 'dashed_line' ? '10 6' : activeTool === 'dotted_line' ? '2 6' : undefined,
    }
    if (activeTool === 'pen' || activeTool === 'highlight') {
      drawPenPtsRef.current = [latlng]
      drawPreviewRef.current = L.polyline([latlng], drawOpts).addTo(map)
    } else if (activeTool === 'line' || activeTool === 'dashed_line' || activeTool === 'dotted_line' || activeTool === 'arrow' || activeTool === 'double_arrow') {
      drawPreviewRef.current = L.polyline([latlng, latlng], drawOpts).addTo(map)
    } else if (activeTool === 'rect' || activeTool === 'ellipse') {
      // Ellipse previews as its bounding box while dragging; the final shape renders as a true ellipse.
      drawPreviewRef.current = L.rectangle([[latlng.lat, latlng.lng], [latlng.lat, latlng.lng]], {
        ...drawOpts, fill: true, fillColor: rlColor, fillOpacity: rlFillOpacity,
      }).addTo(map)
    } else if (activeTool === 'circle') {
      drawPreviewRef.current = L.circle(latlng, { ...drawOpts, radius: 1, fill: true, fillColor: rlColor, fillOpacity: rlFillOpacity }).addTo(map)
    }
  }

  function drawMove(latlng: L.LatLng) {
    const start = drawStartLLRef.current
    const preview = drawPreviewRef.current
    if (!start) return
    if ((activeTool === 'pen' || activeTool === 'highlight') && preview) {
      drawPenPtsRef.current.push(latlng)
      ;(preview as L.Polyline).setLatLngs(drawPenPtsRef.current)
    } else if ((activeTool === 'line' || activeTool === 'dashed_line' || activeTool === 'dotted_line' || activeTool === 'arrow' || activeTool === 'double_arrow') && preview) {
      (preview as L.Polyline).setLatLngs([start, latlng])
    } else if ((activeTool === 'rect' || activeTool === 'ellipse') && preview) {
      (preview as L.Rectangle).setBounds([[start.lat, start.lng], [latlng.lat, latlng.lng]])
    } else if (activeTool === 'circle' && preview) {
      (preview as L.Circle).setRadius(start.distanceTo(latlng))
    }
  }

  function drawEnd(endLL: L.LatLng) {
    drawActiveRef.current = false
    drawPreviewRef.current?.remove()
    drawPreviewRef.current = null
    const start = drawStartLLRef.current
    drawStartLLRef.current = null
    if (!start) return
    const base = {
      subtype: activeSubtype,
      color: rlColor, weight: rlWeight, fillColor: rlColor,
      fillOpacity: rlFillOpacity, opacity: rlOpacity,
      label: null, fontSize: 13, featureType: null, featureName: null,
      notes: null, quantity: null,
    }
    if (activeTool === 'pen' || activeTool === 'highlight') {
      const pts = drawPenPtsRef.current
      drawPenPtsRef.current = []
      if (pts.length >= 2) {
        const latlngs = pts.map((ll) => [ll.lat, ll.lng] as [number, number])
        commitMarkup({ ...base, tool: activeTool === 'highlight' ? 'highlight' : 'pen', geometry: { latlngs }, lengthFt: latlngsLengthFt(latlngs) })
      }
    } else if (activeTool === 'line' || activeTool === 'dashed_line' || activeTool === 'dotted_line' || activeTool === 'arrow' || activeTool === 'double_arrow') {
      const latlngs: [number, number][] = [[start.lat, start.lng], [endLL.lat, endLL.lng]]
      commitMarkup({ ...base, tool: activeTool as MarkupTool, geometry: { latlngs }, lengthFt: latlngsLengthFt(latlngs) })
    } else if (activeTool === 'rect') {
      commitMarkup({ ...base, tool: 'rect', geometry: { bounds: [[start.lat, start.lng], [endLL.lat, endLL.lng]] }, lengthFt: null })
    } else if (activeTool === 'ellipse') {
      commitMarkup({ ...base, tool: 'ellipse', geometry: { bounds: [[start.lat, start.lng], [endLL.lat, endLL.lng]] }, lengthFt: null })
    } else if (activeTool === 'circle') {
      commitMarkup({ ...base, tool: 'circle', geometry: { center: [start.lat, start.lng], radius: start.distanceTo(endLL) }, lengthFt: null })
    }
  }

  function handleDrawMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const map = mapRef.current; if (!map) return
    drawStart(map.mouseEventToLatLng(e.nativeEvent), map)
  }
  function handleDrawMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!drawActiveRef.current) return
    const map = mapRef.current; if (!map) return
    drawMove(map.mouseEventToLatLng(e.nativeEvent))
  }
  function handleDrawMouseUp(e: React.MouseEvent<HTMLDivElement>) {
    if (!drawActiveRef.current) return
    const map = mapRef.current; if (!map) return
    drawEnd(map.mouseEventToLatLng(e.nativeEvent))
  }

  function handleDrawTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    const map = mapRef.current; if (!map || !e.touches[0]) return
    drawStart(touchToLatLng(e.touches[0]), map)
  }
  function handleDrawTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (!drawActiveRef.current || !e.touches[0]) return
    drawMove(touchToLatLng(e.touches[0]))
  }
  function handleDrawTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (!drawActiveRef.current || !e.changedTouches[0]) return
    drawEnd(touchToLatLng(e.changedTouches[0]))
  }

  function applyStatusColor(featureId: string, status: FeatureStatus) {
    if (colorMode !== 'status') return
    const lyr = layerMapRef.current.get(featureId)
    if (!lyr) return
    const c = FEATURE_STATUS_META[status].color
    if ((lyr as L.Path).setStyle) (lyr as L.Path).setStyle({ color: c, fillColor: c })
  }

  function handleStatusChange(id: string, status: FeatureStatus) {
    setFeatureStatus(id, status)
    applyStatusColor(id, status)
    setSelectedFeature((prev) => prev?.id === id ? { ...prev, status } : prev)
  }

  function flyToFeature(f: MapFeature) {
    setSelectedFeature(f); setSelectedMarkup(null)
    if (panelCollapsed) setPanelCollapsed(false)
    const lyr = layerMapRef.current.get(f.id)
    if (!lyr || !mapRef.current) return
    try {
      if ((lyr as L.Polyline).getBounds) {
        mapRef.current.fitBounds((lyr as L.Polyline).getBounds(), { maxZoom: 18, padding: [60, 60] })
      } else if ((lyr as L.CircleMarker).getLatLng) {
        mapRef.current.setView((lyr as L.CircleMarker).getLatLng(), 17)
      }
    } catch { /* ignore */ }
  }

  function handleDeleteFeature(f: MapFeature) {
    if (!confirm(`Delete "${f.name ?? 'this feature'}"? This cannot be undone.`)) return
    const lyr = layerMapRef.current.get(f.id)
    if (lyr) { lyr.remove(); layerMapRef.current.delete(f.id) }
    if (selectedFeature?.id === f.id) setSelectedFeature(null)
    deleteMapFeature(f.id)
  }

  function handleDeleteLayer(layerName: string, features: MapFeature[]) {
    if (!confirm(`Delete all ${features.length} feature(s) in "${layerName}"? This cannot be undone.`)) return
    for (const f of features) {
      const lyr = layerMapRef.current.get(f.id)
      if (lyr) { lyr.remove(); layerMapRef.current.delete(f.id) }
      if (selectedFeature?.id === f.id) setSelectedFeature(null)
      deleteMapFeature(f.id)
    }
  }

  function toggleLayer(layerName: string) {
    setCollapsedLayers((prev) => {
      const next = new Set(prev)
      if (next.has(layerName)) next.delete(layerName)
      else next.add(layerName)
      return next
    })
  }


  async function handleExportKmz(openGoogleMaps = false) {
    if (!project || visibleFeatures.length === 0) return
    setExporting(true)
    try {
      const blob = await exportFeaturesToKmz(visibleFeatures, project.name)
      triggerDownload(blob, `${project.name.replace(/\s+/g, '_')}.kmz`)
      if (openGoogleMaps) window.open('https://www.google.com/mymaps', '_blank', 'noopener')
    } finally { setExporting(false) }
  }

  async function handleExportMarkups() {
    if (!project || allMarkups.length === 0) return
    setExporting(true)
    try {
      const blob = await exportFieldMarkupsToKmz(allMarkups, project.name)
      triggerDownload(blob, `${project.name.replace(/\s+/g, '_')}_markups.kmz`)
    } finally { setExporting(false) }
  }

  async function onPdfUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !projectId) return
    e.target.value = ''
    setUploadingPdf(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })
      addProjectFile({ projectId, name: file.name, fileType: 'pdf', size: file.size, uploadedAt: new Date().toISOString(), dataUrl })
    } catch (err) {
      alert(`Upload failed: ${(err as Error).message}`)
    } finally {
      setUploadingPdf(false)
    }
  }

  function openPdf(fileId: string) {
    const file = pdfs.find((f) => f.id === fileId)
    if (!file) return
    setPreloadPdfFile({ id: file.id, name: file.name })
    setActiveTool('select')
    setShowGeoreference(true)
  }

  // Arriving from ProjectDetail's Files tab with a specific PDF to open (e.g. `<Link state={{ openPdfFileId }}>`)
  useEffect(() => {
    const openPdfFileId = (location.state as { openPdfFileId?: string } | null)?.openPdfFileId
    if (openPdfFileId) openPdf(openPdfFileId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !projectId) return
    e.target.value = ''
    setImporting(true)
    setImportMsg({ text: `Parsing ${file.name}…`, ok: true })
    try {
      const result = await parseKmzOrKml(file)
      addKmzUpload(
        { projectId, fileName: file.name, uploadedAt: new Date().toISOString(), featureCount: result.featureCount },
        result.features,
      )
      setImportMsg({ text: `✓ ${result.featureCount} features imported from ${file.name}`, ok: true })
      setTimeout(() => setImportMsg(null), 4000)
    } catch (err) {
      setImportMsg({ text: `Error: ${(err as Error).message}`, ok: false })
      setTimeout(() => setImportMsg(null), 6000)
    } finally { setImporting(false) }
  }

  const currentToolLabel = (() => {
    if (activeTool === 'select') return 'Pan'
    return FEATURE_TOOL_LABELS[activeTool as string]?.label ?? String(activeTool)
  })()

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={wrapperRef}
      className="-mx-4 -my-6 lg:-mx-6 flex flex-col overflow-hidden bg-[#0a0a0a]"
      style={{ height: isFullscreen ? '100dvh' : 'calc(100vh - 56px)' }}
    >

      {/* ── Leave confirm (pending production entry) ──────────────────── */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[#2a2a2a] bg-[#141414] p-5 shadow-2xl">
            <div className="mb-3 flex items-center gap-3">
              <AlertTriangle size={20} className="shrink-0 text-amber-500" />
              <h2 className="text-sm font-bold text-slate-100">Leave without saving?</h2>
            </div>
            <p className="mb-5 text-[12px] text-slate-400">Your production entry has <strong>not been saved yet</strong>. Draw at least one Work Object and click "Complete &amp; Save Production" before leaving, or discard it now.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowLeaveConfirm(false)} className="rounded-lg border border-[#2a3347] px-3 py-1.5 text-[12px] font-medium text-slate-300 hover:bg-white/5">Stay &amp; finish</button>
              <button onClick={() => { setShowLeaveConfirm(false); nav('/production', { replace: true }) }} className="rounded-lg bg-rose-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-rose-700">Leave &amp; discard</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pending production entry banner ────────────────────────────── */}
      {pendingActive && pending && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-amber-500/50 bg-amber-950/30 px-4 py-2">
          <div className="flex items-center gap-2.5 text-[12px]">
            <AlertTriangle size={16} className="shrink-0 text-amber-500" />
            <span className="font-bold text-amber-400">Production entry pending — not saved yet.</span>
            <span className="text-amber-200/80">{pending.footage} ft · {new Date(pending.date).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { if (confirm('Discard production entry?')) nav('/production', { replace: true }) }}
              className="flex items-center gap-1 rounded-lg border border-rose-800/60 bg-transparent px-2.5 py-1 text-[11px] font-medium text-rose-400 hover:bg-rose-950/40"
            >
              <X size={12} /> Discard entry
            </button>
            <button
              onClick={handleCompleteProduction}
              disabled={!canCompletePending}
              title={canCompletePending ? undefined : 'Draw at least one Work Object first'}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-[12px] font-bold text-white shadow hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckCircle2 size={14} /> Complete &amp; Save Production
            </button>
          </div>
        </div>
      )}

      {/* ── Top action bar ──────────────────────────────────────────── */}
      <div className="flex items-center shrink-0 h-11 border-b border-[#1e1e1e] bg-[#0a0a0a] px-3 gap-2">
        <button onClick={() => nav('/kmz')} className="rounded p-1 text-slate-500 hover:text-slate-300 hover:bg-white/5 transition shrink-0">
          <ArrowLeft size={14} />
        </button>
        <span className="text-xs font-semibold text-slate-200 truncate max-w-[120px]">{project?.name ?? 'Project'}</span>
        <span className="text-[10px] text-slate-600 shrink-0">{allFeatures.length} features · {allMarkups.length} markups</span>

        <div className="mx-1 h-4 w-px bg-[#2a2a2a] shrink-0" />

        {/* Map type tabs */}
        <div className="flex items-center gap-0.5 rounded-md bg-[#141414] border border-[#2a2a2a] p-0.5 shrink-0">
          {(['street', 'satellite'] as const).map((ml) => (
            <button key={ml} onClick={() => setMapLayer(ml)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition ${
                mapLayer === ml
                  ? ml === 'street' ? 'bg-brand-600 text-white shadow' : 'bg-[#1a3a5c] text-[#5aadff] shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {ml === 'street' ? <><MapIcon size={11} /> Field Map</> : <><Satellite size={11} /> Satellite</>}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Color mode toggle */}
        <div className="hidden sm:flex items-center gap-0.5 rounded-md bg-[#141414] border border-[#2a2a2a] p-0.5 shrink-0">
          {(['kmz', 'status'] as const).map((cm) => (
            <button key={cm} onClick={() => setColorMode(cm)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                colorMode === cm ? 'bg-[#2a3347] text-slate-100 shadow' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {cm === 'kmz' ? 'KMZ Colors' : 'Status Colors'}
            </button>
          ))}
        </div>

        <div className="mx-1 h-4 w-px bg-[#2a2a2a] shrink-0 hidden sm:block" />

        {/* Import / Export */}
        <button onClick={() => fileRef.current?.click()} disabled={importing}
          className="flex items-center gap-1.5 rounded-md border border-[#2a3347] px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-white/5 disabled:opacity-50 transition shrink-0">
          <Upload size={11} /> {importing ? 'Importing…' : 'Import KMZ'}
        </button>
        <button onClick={() => handleExportKmz(false)} disabled={exporting || allFeatures.length === 0}
          className="hidden sm:flex items-center gap-1.5 rounded-md border border-[#2a3347] px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-white/5 disabled:opacity-40 transition shrink-0">
          <Download size={11} /> Export KMZ
        </button>
        {allMarkups.length > 0 && (
          <button onClick={handleExportMarkups} disabled={exporting}
            className="hidden sm:flex items-center gap-1.5 rounded-md border border-[#2a3347] px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-white/5 disabled:opacity-40 transition shrink-0">
            <Download size={11} /> Export Markups
          </button>
        )}
        <button onClick={() => handleExportKmz(true)} disabled={exporting || allFeatures.length === 0}
          className="hidden sm:flex items-center gap-1.5 rounded-md border border-[#1a73e8]/40 bg-[#1a73e8]/10 px-2.5 py-1 text-[11px] font-medium text-[#5aadff] hover:bg-[#1a73e8]/20 disabled:opacity-40 transition shrink-0">
          <Globe size={11} /> Google Maps
        </button>

        <div className="mx-1 h-4 w-px bg-[#2a2a2a] shrink-0" />

        {/* Report Line — enters polyline draw mode then shows billing modal */}
        <button
          onClick={handleReportLine}
          title="Report a production line with billing"
          className="hidden sm:flex items-center gap-1.5 rounded-md border border-brand-500/40 bg-brand-500/10 px-2.5 py-1 text-[11px] font-medium text-brand-400 hover:bg-brand-500/20 transition shrink-0"
        >
          <Plus size={11} /> Report Line
        </button>

        {/* Draw toggle */}
        <button
          onClick={() => {
            const next = !rlActive
            setRlActive(next)
            setActiveColorCode(null); activeColorCodeRef.current = null
            if (next) setActiveTool('select')
          }}
          title={rlActive ? 'Exit draw mode' : 'Draw / Mark up map'}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition shrink-0 ${
            rlActive
              ? 'border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20'
              : 'border-[#2a3347] text-slate-300 hover:bg-white/5'
          }`}
        >
          <Pencil size={11} /> {rlActive ? 'Exit Markup' : 'Mark Up'}
        </button>

        {/* Fullscreen */}
        <button onClick={toggleFullscreen} className="rounded p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 transition shrink-0">
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>

      {/* ── PDF Prints bar — always visible ─────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[#1e1e1e] bg-[#0d0d0d] px-3 py-1.5 overflow-x-auto">
        <FileText size={12} className="shrink-0 text-amber-400" />
        <span className="shrink-0 text-[11px] font-semibold text-slate-500">Prints:</span>
        {pdfs.length === 0 && (
          <span className="text-[11px] text-slate-700">None uploaded yet</span>
        )}
        {pdfs.map((f) => (
          <button
            key={f.id}
            onClick={() => openPdf(f.id)}
            className="flex shrink-0 items-center gap-1.5 rounded border border-[#2a3347] bg-[#141414] px-2.5 py-0.5 text-[11px] text-slate-300 hover:text-white hover:bg-white/5 transition"
            title={`Open ${f.name}`}
          >
            <span className="max-w-[160px] truncate">{f.name}</span>
          </button>
        ))}
        <button
          onClick={() => { setActiveTool('select'); setPreloadPdfFile(null); setShowGeoreference(true) }}
          className="flex shrink-0 items-center gap-1 rounded border border-brand-700/60 px-2.5 py-0.5 text-[11px] font-medium text-brand-400 hover:bg-brand-900/20 transition ml-auto"
        >
          <Upload size={10} /> Add PDF Overlay
        </button>
        <button
          onClick={() => pdfFileRef.current?.click()}
          disabled={uploadingPdf}
          className="flex shrink-0 items-center gap-1 rounded border border-emerald-800/60 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 hover:bg-emerald-900/20 disabled:opacity-40 transition"
        >
          <Upload size={10} /> {uploadingPdf ? 'Uploading…' : 'Upload PDF'}
        </button>
      </div>

      {/* ── Unified Field Map editing toolbar ────────────────────────── */}
      {rlActive && (
        <div className="shrink-0">
          <FieldMapToolbar
            activeTool={activeTool}
            onSelectTool={(tool) => {
              setActiveTool(tool)
              if (tool === 'highlight') { setRlColor('#facc15'); setRlWeight(14); setRlOpacity(0.4) }
            }}
            onAddWork={() => { setAddWorkMarkupId(null); setAddWorkModalOpen(true) }}
            editMode={editMode}
            canVertexEdit={!!selectedMarkup && !selectedMarkup.lockedAt}
            onToggleVertexEdit={() => setEditMode((m) => (m === 'vertices' ? 'none' : 'vertices'))}
            snapEnabled={snapEnabled}
            onToggleSnap={() => setSnapEnabled((s) => !s)}
            onOpenLayerManager={() => setShowLayerManager(true)}
            onUndo={undoLast}
            onRedo={redoLast}
            onDelete={() => selectedMarkup && deleteMarkup(selectedMarkup.id)}
            canDelete={!!selectedMarkup && !selectedMarkup.lockedAt}
            onSave={() => { if (aerialRunInProgress) finishAerialRunRef.current?.(); else finishPolygonRef.current?.() }}
            canSave={polygonInProgress || aerialRunInProgress}
            canMerge={toolSelectedIds.size === 2}
            onMerge={performMerge}
            advancedToolsChildren={
              <button
                onClick={handleExportReport}
                disabled={exportingReport}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-slate-300 hover:bg-white/5 disabled:opacity-40 transition"
              >
                <Download size={12} /> {exportingReport ? 'Exporting…' : 'Export Report (PDF)'}
              </button>
            }
          />
          <div className="flex items-center gap-2 border-b border-[#1e1e1e] bg-[#0a0a0a] px-3 py-1.5 overflow-x-auto">
            <div className="flex items-center gap-1 shrink-0">
              {MARKUP_COLORS.map((c) => (
                <button key={c} onClick={() => setRlColor(c)} title={c}
                  className={`h-4 w-4 rounded-full border-2 transition shrink-0 ${rlColor === c ? 'border-white scale-110' : 'border-transparent hover:scale-110'}`}
                  style={{ background: c, boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px #555' : undefined }} />
              ))}
            </div>
            <div className="h-3 w-px bg-[#2a2a2a] shrink-0" />
            <div className="flex items-center gap-0.5 shrink-0">
              {WEIGHT_OPTIONS.map(({ value, label }) => (
                <button key={value} onClick={() => setRlWeight(value)} className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${rlWeight === value ? 'bg-[#2a3347] text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>{label}</button>
              ))}
            </div>
            <div className="h-3 w-px bg-[#2a2a2a] shrink-0" />
            <select value={rlOpacity} onChange={(e) => setRlOpacity(Number(e.target.value))}
              className="rounded border border-[#2a3347] bg-[#141414] px-1.5 py-0.5 text-[10px] outline-none shrink-0">
              {[1, 0.75, 0.5, 0.25].map((o) => (
                <option key={o} value={o}>{Math.round(o * 100)}%</option>
              ))}
            </select>
            <div className="h-3 w-px bg-[#2a2a2a] shrink-0" />
            <select value={rlLayer} onChange={(e) => setRlLayer(e.target.value as MarkupLayer)}
              className="rounded border border-[#2a3347] bg-[#141414] px-1.5 py-0.5 text-[10px] outline-none shrink-0"
              style={{ color: MARKUP_LAYER_META[rlLayer]?.color }}>
              {(Object.keys(MARKUP_LAYER_META) as MarkupLayer[]).map((l) => (
                <option key={l} value={l}>{MARKUP_LAYER_META[l].label}</option>
              ))}
            </select>
            <button onClick={() => setMarkupVisible((v) => !v)} title="Toggle markup visibility" className="ml-auto rounded p-1 text-slate-500 hover:text-slate-300 hover:bg-white/5 transition shrink-0">
              {markupVisible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <span className="text-[10px] text-slate-600 shrink-0">{allMarkups.length}</span>
          </div>
        </div>
      )}

      {/* ── Three-panel layout ──────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Feature list ────────────────────────────────── */}
        {listOpen && (
          <div className="flex w-56 shrink-0 flex-col border-r border-[#1e1e1e] bg-[#090909]">
            {uploads.length > 1 && (
              <div className="border-b border-[#1e1e1e] px-3 py-2">
                <select value={activeUploadId} onChange={(e) => setActiveUploadId(e.target.value)}
                  className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-brand-500">
                  <option value="all">All imports</option>
                  {uploads.map((u: KmzUpload) => <option key={u.id} value={u.id}>{u.fileName}</option>)}
                </select>
              </div>
            )}

            <div className="border-b border-[#1e1e1e] px-3 py-2">
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search features…"
                  className="w-full rounded border border-[#2a3347] bg-[#141414] pl-6 pr-2 py-1 text-[11px] text-slate-200 outline-none focus:border-brand-500" />
              </div>
            </div>

            {allFeatures.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center px-3 py-8 text-center">
                <Upload size={24} className="text-slate-700 mb-2" />
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  No features yet.<br />Click <strong className="text-slate-400">Import KMZ</strong> above to load a file.
                </p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {allFeatures.length > 0 && Object.keys(byLayer).length === 0 && (
                <p className="px-3 py-4 text-[11px] text-slate-600">No features match.</p>
              )}
              {Object.entries(byLayer).map(([layer, features]) => {
                const isCollapsed = collapsedLayers.has(layer)
                return (
                  <div key={layer}>
                    <div className="group/layer sticky top-0 z-10 flex items-center gap-1 bg-[#0d0d0d] px-2 py-1.5 border-b border-[#1e1e1e]">
                      <button onClick={() => toggleLayer(layer)} className="flex flex-1 items-center gap-1.5 min-w-0 text-left">
                        {isCollapsed ? <ChevronRight size={11} className="text-slate-600 shrink-0" /> : <ChevronDown size={11} className="text-slate-600 shrink-0" />}
                        {isCollapsed ? <Folder size={11} className="text-slate-500 shrink-0" /> : <FolderOpen size={11} className="text-slate-400 shrink-0" />}
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 truncate">{layer}</span>
                        <span className="ml-auto text-[9px] text-slate-600 shrink-0 pr-1">{features.length}</span>
                      </button>
                      <button onClick={() => handleDeleteLayer(layer, features)}
                        className="shrink-0 rounded p-0.5 text-slate-700 opacity-0 group-hover/layer:opacity-100 hover:text-red-400 hover:bg-red-400/10 transition"
                        title={`Delete all in "${layer}"`}>
                        <Trash2 size={10} />
                      </button>
                    </div>

                    {!isCollapsed && features.map((f) => {
                      const dotColor = colorMode === 'kmz'
                        ? (f.styleColor ?? layerFallbackColor(f.layerName))
                        : FEATURE_STATUS_META[f.status].color
                      const isSelected = selectedFeature?.id === f.id
                      return (
                        <div key={f.id}
                          className={`group flex w-full items-start gap-2 pl-6 pr-3 py-2 transition hover:bg-white/4 ${isSelected ? 'bg-white/6' : ''}`}>
                          <button onClick={() => flyToFeature(f)} className="flex flex-1 items-start gap-2 min-w-0 text-left">
                            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor }} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[11px] text-slate-300">{f.name ?? '(unnamed)'}</p>
                              {f.calculatedLengthFt != null && (
                                <p className="text-[10px] text-slate-600">{f.calculatedLengthFt.toLocaleString()} ft</p>
                              )}
                            </div>
                          </button>
                          <button onClick={() => handleDeleteFeature(f)}
                            className="shrink-0 rounded p-0.5 text-slate-700 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 transition"
                            title="Delete feature">
                            <Trash2 size={11} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )
              })}

              {/* Markup items in list */}
              {allMarkups.length > 0 && (
                <div>
                  <div className="sticky top-0 z-10 flex items-center gap-1 bg-[#0d0d0d] px-2 py-1.5 border-b border-[#1e1e1e]">
                    <LayoutGrid size={10} className="text-red-500 shrink-0" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-red-400">Markups</span>
                    <span className="ml-auto text-[9px] text-slate-600 pr-1">{allMarkups.length}</span>
                  </div>
                  {allMarkups.map((m) => {
                    const meta = FEATURE_TOOL_LABELS[m.tool]
                    const isSelected = selectedMarkup?.id === m.id
                    return (
                      <div key={m.id}
                        className={`group flex w-full items-center gap-2 pl-6 pr-3 py-1.5 transition hover:bg-white/4 ${isSelected ? 'bg-white/6' : ''}`}>
                        <button onClick={() => { setSelectedMarkup(m); setSelectedFeature(null); setSelectedAerialRun(null); setPanelCollapsed(false) }}
                          className="flex flex-1 items-center gap-2 min-w-0 text-left">
                          {meta ? (
                            <span className="h-4 w-5 flex items-center justify-center rounded text-[8px] font-bold shrink-0"
                              style={{ background: meta.color + '33', color: meta.color }}>
                              {meta.abbr}
                            </span>
                          ) : (
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} />
                          )}
                          <p className="truncate text-[11px] text-slate-300">
                            {m.featureName || meta?.label || m.tool}
                          </p>
                        </button>
                        <button onClick={() => deleteMarkup(m.id)}
                          className="shrink-0 rounded p-0.5 text-slate-700 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 transition"
                          title="Delete markup">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Aerial Lash Fiber Runs */}
              {(data.aerialLashFiberRuns ?? []).filter((r) => r.projectId === projectId).length > 0 && (
                <div>
                  <div className="sticky top-0 z-10 flex items-center gap-1 bg-[#0d0d0d] px-2 py-1.5 border-b border-[#1e1e1e]">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: '#a7dce8' }} />
                    <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#a7dce8' }}>Aerial Runs</span>
                    <span className="ml-auto text-[9px] text-slate-600 pr-1">
                      {(data.aerialLashFiberRuns ?? []).filter((r) => r.projectId === projectId).length}
                    </span>
                  </div>
                  {(data.aerialLashFiberRuns ?? []).filter((r) => r.projectId === projectId).map((run) => {
                    const done   = run.poles.filter((p) => p.completed).length
                    const total  = run.poles.length
                    const isSel  = selectedAerialRun?.id === run.id
                    return (
                      <div key={run.id}
                        className={`group flex w-full items-center gap-2 pl-6 pr-3 py-1.5 transition hover:bg-white/4 ${isSel ? 'bg-white/6' : ''}`}>
                        <button
                          onClick={() => { setSelectedAerialRun(run); setSelectedMarkup(null); setSelectedFeature(null); setPanelCollapsed(false) }}
                          className="flex flex-1 items-center gap-2 min-w-0 text-left"
                        >
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: '#a7dce8' }} />
                          <span className="truncate text-[11px] text-slate-300">
                            {total}p · {run.totalFootage > 0 ? `${run.totalFootage.toLocaleString()} ft` : '—'}
                          </span>
                          <span className="ml-auto text-[9px] shrink-0" style={{ color: done === total ? '#22c55e' : '#a7dce8' }}>
                            {done}/{total}
                          </span>
                        </button>
                        <button onClick={() => { deleteAerialLashFiberRun(run.id); if (selectedAerialRun?.id === run.id) setSelectedAerialRun(null) }}
                          className="shrink-0 rounded p-0.5 text-slate-700 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 transition"
                          title="Delete run">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Status legend */}
            {allFeatures.length > 0 && (
              <div className="border-t border-[#1e1e1e] px-3 py-2 space-y-1">
                {STATUS_ORDER.map((s) => (
                  <div key={s} className="flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: FEATURE_STATUS_META[s].color }} />
                      {FEATURE_STATUS_META[s].label}
                    </span>
                    <span className="text-slate-600">{statusCounts[s] || 0}</span>
                  </div>
                ))}
              </div>
            )}

          </div>
        )}

        {/* ── Center: Leaflet map ──────────────────────────────────── */}
        <div className="relative flex-1">
          <div ref={mapContainerRef} className="absolute inset-0 z-0" />

          {/* Draw overlay: captures drag events for draw tools (pen/line/rect/circle/arrow).
               touchAction:none prevents browser scroll/zoom so touch events reach our handlers. */}
          {rlActive && isDragDrawTool(activeTool as string) && (
            <div
              className="absolute inset-0 z-[500]"
              style={{ cursor: 'crosshair', touchAction: 'none', userSelect: 'none' }}
              onMouseDown={handleDrawMouseDown}
              onMouseMove={handleDrawMouseMove}
              onMouseUp={handleDrawMouseUp}
              onTouchStart={handleDrawTouchStart}
              onTouchMove={handleDrawTouchMove}
              onTouchEnd={handleDrawTouchEnd}
              onContextMenu={(e) => e.preventDefault()}
              onWheel={(e) => {
                const c = mapContainerRef.current
                if (c) c.dispatchEvent(new WheelEvent('wheel', {
                  deltaY: e.deltaY, deltaX: e.deltaX, deltaMode: e.nativeEvent.deltaMode,
                  clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true,
                }))
              }}
            />
          )}

          {/* Pan overlay: native pointer events + setPointerCapture for reliable grab-pan */}
          {rlActive && activeTool === 'select' && (
            <div
              ref={panOverlayRef}
              className="absolute inset-0 z-[500]"
              style={{ cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
            />
          )}

          {/* Toggle list */}
          <button onClick={() => setListOpen((o) => !o)}
            className="absolute left-2 top-2 z-[1000] rounded-md bg-[#0d0d0d]/90 border border-[#2a3347] p-1.5 text-slate-400 hover:text-slate-200 hover:bg-[#141414] transition"
            title={listOpen ? 'Hide feature list' : 'Show feature list'}>
            <Layers size={13} />
          </button>

          {/* Import toast */}
          {importMsg && (
            <div className={`absolute top-2 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium shadow-lg ${
              importMsg.ok ? 'bg-[#0d0d0d]/95 border-emerald-600/40 text-emerald-400' : 'bg-[#0d0d0d]/95 border-red-600/40 text-red-400'
            }`}>
              {importMsg.text}
            </div>
          )}

          {/* Text input overlay */}
          {textPos && (
            <div className="absolute z-[1001] flex items-center" style={{ left: textPos.x + 4, top: textPos.y - 16 }}>
              <input ref={textInputRef} type="text" value={textVal}
                onChange={(e) => setTextVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmText()
                  if (e.key === 'Escape') { setTextPos(null); setTextVal('') }
                }}
                onBlur={confirmText}
                placeholder={activeTool === 'callout' ? 'Callout text…' : 'Type label…'}
                className="rounded border border-red-500/60 bg-[#0d0d0d]/95 px-2 py-1 text-xs text-white outline-none shadow-lg"
                style={{ color: rlColor, caretColor: rlColor, minWidth: 120 }}
              />
            </div>
          )}

          {/* Active tool indicator */}
          {rlActive && (
            <div className="absolute top-2 right-2 z-[1000] flex items-center gap-1.5 rounded-md bg-[#0d0d0d]/90 border border-red-500/40 px-2 py-1 text-[11px] text-red-400">
              <Pencil size={10} />
              {currentToolLabel}
              {activeTool === 'polygon' && polygonPtsRef.current.length > 0 && ` (${polygonPtsRef.current.length} pts — dbl-click to close)`}
            </div>
          )}

          {/* Map type indicator */}
          <div className="absolute bottom-6 left-2 z-[1000]">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              mapLayer === 'satellite' ? 'bg-[#1a3a5c]/90 text-[#5aadff]' : 'bg-[#0d0d0d]/80 text-slate-400'
            }`}>
              {mapLayer === 'satellite' ? '🛰 Satellite' : '🗺 Street'}
            </span>
          </div>

          {/* Panel toggle tab */}
          {(selectedFeature || selectedMarkup) && (
            <button onClick={() => setPanelCollapsed((c) => !c)}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-[1000] flex items-center justify-center rounded-l-md bg-[#141414] border border-r-0 border-[#2a3347] py-3 px-1 text-slate-400 hover:text-slate-200 hover:bg-[#1e1e1e] transition">
              {panelCollapsed ? <PanelRightOpen size={13} /> : <PanelRightClose size={13} />}
            </button>
          )}
        </div>

        {/* ── Right: PDF georeferencing panel (stays open independent of feature/markup selection) ── */}
        {showGeoreference && (
          <div className="w-80 shrink-0 border-l border-[#1e1e1e] overflow-hidden">
            <GeoreferencePanel
              projectId={projectId!}
              map={mapRef.current}
              preloadFile={preloadPdfFile}
              onClose={() => { setShowGeoreference(false); setPreloadPdfFile(null) }}
              onSaved={() => { setShowGeoreference(false); setPreloadPdfFile(null) }}
            />
          </div>
        )}

        {/* ── Right: Layer Manager panel ────────────────────────────── */}
        {showLayerManager && (
          <div className="w-72 shrink-0 border-l border-[#1e1e1e] overflow-hidden">
            <LayerManagerPanel
              onClose={() => setShowLayerManager(false)}
              visibleLayers={visibleLayers}
              onToggleWorkObjectLayer={toggleWorkObjectLayer}
              allKmzLayerNames={allKmzLayerNames}
              hiddenKmzLayerNames={hiddenKmzLayerNames}
              onToggleKmzLayer={toggleKmzLayerVisibility}
              featuresByLayer={allFeatures}
              hiddenFeatureIds={hiddenFeatureIds}
              onToggleFeature={toggleFeatureVisibility}
              overlays={(data.fieldMapOverlays ?? []).filter((o) => o.projectId === projectId)}
              onToggleOverlay={(id, visible) => updateFieldMapOverlay(id, { visible })}
            />
          </div>
        )}

        {/* ── Right: Detail panel ───────────────────────────────────── */}
        {!showGeoreference && !showLayerManager && (selectedFeature || selectedMarkup || selectedAerialRun) && !panelCollapsed && (
          <div className="w-72 shrink-0 border-l border-[#1e1e1e] overflow-hidden">
            {selectedAerialRun ? (
              <AerialLashRunPanel
                key={selectedAerialRun.id}
                run={(data.aerialLashFiberRuns ?? []).find((r) => r.id === selectedAerialRun.id) ?? selectedAerialRun}
                onClose={() => setSelectedAerialRun(null)}
                onDelete={() => setSelectedAerialRun(null)}
              />
            ) : selectedMarkup ? (
              <MarkupPanel
                key={selectedMarkup.id}
                markup={selectedMarkup}
                onClose={() => setSelectedMarkup(null)}
                onDelete={() => setSelectedMarkup(null)}
                onCalloutCreated={(center) => {
                  mapRef.current?.panTo(center as L.LatLngExpression)
                }}
                editMode={editMode}
                onSetEditMode={setEditMode}
              />
            ) : selectedFeature ? (
              <FeaturePanel
                feature={selectedFeature}
                onClose={() => setSelectedFeature(null)}
                onStatusChange={handleStatusChange}
              />
            ) : null}
          </div>
        )}

        {/* Pole form modal — in-progress aerial run */}
        {editingPole && !selectedAerialRun && (
          <PoleFormModal
            pole={editingPole.pole}
            runId={undefined}
            onSave={(updated) => {
              aerialPolesRef.current = aerialPolesRef.current.map((p) =>
                p.poleNumber === updated.poleNumber ? updated : p,
              )
              // Refresh marker icon to reflect completed state
              const marker = aerialPoleMarkersRef.current[editingPole.index]
              if (marker) {
                const done   = updated.completed
                const border = done ? '#22c55e' : MARKUP_COLOR_CODES['lash_aerial'].color
                const bg     = done ? '#052e16' : '#0d0d0d'
                marker.setIcon(L.divIcon({
                  className: '',
                  html: `<div style="width:22px;height:22px;border:2.5px solid ${border};${!done ? 'border-style:dashed;' : ''}border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:${border};font-family:monospace;">${updated.poleNumber}</div>`,
                  iconSize: [22, 22], iconAnchor: [11, 11],
                }))
              }
              setEditingPole(null)
            }}
            onClose={() => setEditingPole(null)}
          />
        )}
      </div>

      <input ref={fileRef}    type="file" accept=".kmz,.kml" className="hidden" onChange={onImportFile} />
      <input ref={pdfFileRef} type="file" accept=".pdf"       className="hidden" onChange={onPdfUpload} />

      {/* Text input */}
      <input
        ref={textInputRef}
        type="text"
        className="sr-only"
        aria-hidden
        tabIndex={-1}
      />

      {/* ── Structure Markers panel (mobile Markers tab) ──────────── */}
      {mobileNav === 'markers' && (
        <div className="fixed bottom-14 inset-x-0 z-[800] bg-[#0d0d0d]/97 border-t border-[#2a2a2a] p-3 lg:hidden backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Place Structure Marker</p>
            <button onClick={() => setMobileNav('map')} className="text-[10px] text-slate-600 hover:text-slate-300">Done</button>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {[
              { tool: 'struct_s',   abbr: 'S',   label: 'Handhole',  color: '#f59e0b' },
              { tool: 'struct_m',   abbr: 'M',   label: 'Manhole',   color: '#f97316' },
              { tool: 'struct_l',   abbr: 'L',   label: 'Vault L',   color: '#f97316' },
              { tool: 'struct_xl',  abbr: 'XL',  label: 'Vault XL',  color: '#ef4444' },
              { tool: 'struct_fp',  abbr: 'FP',  label: 'Fiber Pt',  color: '#6366f1' },
              { tool: 'struct_lv',  abbr: 'LV',  label: 'Lrg Vault', color: '#f97316' },
              { tool: 'struct_xlv', abbr: 'XLV', label: 'XL Vault',  color: '#dc2626' },
              { tool: 'struct_ped', abbr: 'PED', label: 'Pedestal',  color: '#a78bfa' },
              { tool: 'struct_cab', abbr: 'CAB', label: 'Cabinet',   color: '#64748b' },
              { tool: 'struct_hh',  abbr: 'HH',  label: 'Handhole',  color: '#10b981' },
            ].map((sm) => {
              const sz = sm.abbr.length > 2 ? 38 : 32
              const fs = sm.abbr.length > 2 ? 9 : 11
              const isActive = activeTool === sm.tool && rlActive
              return (
                <button
                  key={sm.tool}
                  onClick={() => {
                    setActiveTool(sm.tool as MarkupTool)
                    setRlActive(true)
                    setMobileNav('map')
                  }}
                  className="flex flex-col items-center gap-1 transition active:scale-95"
                >
                  <div
                    style={{
                      width: sz, height: sz,
                      borderRadius: '50%',
                      border: `2.5px solid ${sm.color}`,
                      background: isActive ? sm.color + '33' : '#141414',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: fs, fontWeight: 800, color: sm.color,
                    }}
                  >
                    {sm.abbr}
                  </div>
                  <span className="text-[8px] text-slate-500 text-center leading-tight">{sm.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Forms panel (mobile Forms tab) — stub pending a spec for its contents ── */}
      {mobileNav === 'forms' && (
        <div className="fixed bottom-14 inset-x-0 z-[800] bg-[#0d0d0d]/97 border-t border-[#2a2a2a] p-3 lg:hidden backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Forms</p>
            <button onClick={() => setMobileNav('map')} className="text-[10px] text-slate-600 hover:text-slate-300">Done</button>
          </div>
          <p className="text-[11px] text-slate-500">QA/QC and Damage Report templates will live here.</p>
        </div>
      )}

      {/* ── Mobile bottom navigation ──────────────────────────────── */}
      <div className="fixed bottom-0 inset-x-0 z-[700] flex items-stretch h-14 bg-[#0a0a0a]/95 border-t border-[#1e1e1e] backdrop-blur-sm lg:hidden">
        {/* Map */}
        <button
          onClick={() => { setMobileNav('map'); setListOpen(false) }}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition ${mobileNav === 'map' ? 'text-brand-400' : 'text-slate-600'}`}
        >
          <MapIcon size={18} />
          <span className="text-[9px] font-medium">Map</span>
        </button>

        {/* Markers */}
        <button
          onClick={() => setMobileNav(mobileNav === 'markers' ? 'map' : 'markers')}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition ${mobileNav === 'markers' ? 'text-amber-400' : 'text-slate-600'}`}
        >
          <MapPin size={18} />
          <span className="text-[9px] font-medium">Markers</span>
        </button>

        {/* Forms */}
        <button
          onClick={() => setMobileNav(mobileNav === 'forms' ? 'map' : 'forms')}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition ${mobileNav === 'forms' ? 'text-violet-400' : 'text-slate-600'}`}
        >
          <FileText size={18} />
          <span className="text-[9px] font-medium">Forms</span>
        </button>

        {/* Billing */}
        <button
          onClick={() => {
            const billable = (data.markupBilling ?? []).filter((b) => b.billable && b.invoiceStatus === 'not_billed' && (data.fieldMarkups ?? []).some((m) => m.id === b.markupId && m.projectId === projectId))
            if (billable.length === 0) return
            const firstMarkupId = billable[0].markupId
            const mk = (data.fieldMarkups ?? []).find((m) => m.id === firstMarkupId)
            if (mk) { setSelectedMarkup(mk); setPanelCollapsed(false); setMobileNav('map') }
          }}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 text-slate-600 transition hover:text-emerald-400"
        >
          <DollarSign size={18} />
          <span className="text-[9px] font-medium">Billing</span>
        </button>

        {/* Settings */}
        <button
          onClick={() => {
            setMapLayer((ml) => ml === 'street' ? 'satellite' : 'street')
            setMobileNav('map')
          }}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 text-slate-600 transition hover:text-slate-300"
        >
          <Settings size={18} />
          <span className="text-[9px] font-medium">Layers</span>
        </button>

        {/* + Add Work — floating FAB overlaid above the nav bar */}
        <button
          onClick={() => { setActiveTool('select'); setAddWorkMarkupId(null); setAddWorkModalOpen(true); setMobileNav('map') }}
          className="absolute left-1/2 -top-6 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full bg-orange-500 shadow-lg shadow-orange-900/50 border-4 border-[#0a0a0a] transition active:scale-95 hover:bg-orange-400"
        >
          <Plus size={24} className="text-white" />
        </button>
      </div>

      {/* ── Distribution Line Modal ───────────────────────────────── */}
      {distModalId && (
        <DistributionLineModal
          key={distModalId}
          markupId={distModalId}
          projectId={projectId ?? ''}
          lengthFt={(data.fieldMarkups ?? []).find((m) => m.id === distModalId)?.lengthFt ?? null}
          onClose={() => {
            setDistModalId(null)
            // Show the markup in the right panel after closing without saving
            const mk = (data.fieldMarkups ?? []).find((m) => m.id === distModalId)
            if (mk) { setSelectedMarkup(mk); setPanelCollapsed(false) }
          }}
          onSaved={() => {
            setDistModalId(null)
            // Refresh selected markup so right panel shows updated data
            const mk = (data.fieldMarkups ?? []).find((m) => m.id === distModalId)
            if (mk) { setSelectedMarkup({ ...mk }); setPanelCollapsed(false) }
          }}
        />
      )}

      {/* ── Add Work Modal ────────────────────────────────────────── */}
      <AddWorkModal
        open={addWorkModalOpen}
        projectId={projectId ?? ''}
        markupId={addWorkMarkupId}
        onPickType={startAddWork}
        onClose={() => {
          setAddWorkModalOpen(false)
          setAddWorkMarkupId(null)
          setActiveTool('select')
        }}
      />
    </div>
  )
}
