import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MapPinned } from 'lucide-react'
import type { DetectedObject, LngLat } from '../features/printkmz/types'
import { objectMeta } from '../features/printkmz/types'

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const LINE_SOURCE = 'fl-lines'
const LINE_LAYER = 'fl-lines-layer'

const opacityFor = (status: DetectedObject['status']) =>
  status === 'approved' ? 1 : status === 'rejected' ? 0.3 : 0.7

function lineFeatures(objects: DetectedObject[], selectedId: string | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = objects
    .filter((o) => objectMeta(o.type).linear && o.path && o.path.length >= 2)
    .map((o) => ({
      type: 'Feature',
      properties: { color: objectMeta(o.type).color, width: o.id === selectedId ? 5 : 3 },
      geometry: { type: 'LineString', coordinates: o.path!.map((p) => [p.lng, p.lat]) },
    }))
  return { type: 'FeatureCollection', features }
}

export function MapView({
  objects,
  center,
  selectedId,
  drawingId,
  onSelect,
  onMove,
  onAppendVertex,
  onPathChange,
}: {
  objects: DetectedObject[]
  center: LngLat
  selectedId: string | null
  drawingId: string | null
  onSelect: (id: string) => void
  onMove?: (id: string, pos: LngLat) => void
  onAppendVertex?: (id: string, pos: LngLat) => void
  onPathChange?: (id: string, path: LngLat[]) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const readyRef = useRef(false)
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  const vertexMarkersRef = useRef<mapboxgl.Marker[]>([])

  // Latest values for use inside stable map handlers.
  const onSelectRef = useRef(onSelect)
  const onMoveRef = useRef(onMove)
  const onAppendRef = useRef(onAppendVertex)
  const drawingIdRef = useRef(drawingId)
  onSelectRef.current = onSelect
  onMoveRef.current = onMove
  onAppendRef.current = onAppendVertex
  drawingIdRef.current = drawingId

  // Init map once.
  useEffect(() => {
    if (!TOKEN || !containerRef.current || mapRef.current) return
    mapboxgl.accessToken = TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [center.lng, center.lat],
      zoom: 16,
    })
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')

    map.on('load', () => {
      map.addSource(LINE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: LINE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] },
      })
      readyRef.current = true
      ;(map.getSource(LINE_SOURCE) as mapboxgl.GeoJSONSource).setData(lineFeatures(objects, selectedId))
    })

    // Click empty map while drawing → append a vertex to the active object.
    map.on('click', (e) => {
      const id = drawingIdRef.current
      if (!id) return
      onAppendRef.current?.(id, { lng: e.lngLat.lng, lat: e.lngLat.lat })
    })

    mapRef.current = map
    const markers = markersRef.current
    return () => {
      map.remove()
      mapRef.current = null
      readyRef.current = false
      markers.clear()
      vertexMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync point markers + line geometry with objects.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const markers = markersRef.current
    const liveIds = new Set(objects.map((o) => o.id))

    for (const [id, marker] of markers) {
      if (!liveIds.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    }

    for (const obj of objects) {
      const meta = objectMeta(obj.type)
      let marker = markers.get(obj.id)
      if (!marker) {
        const el = document.createElement('div')
        const m = new mapboxgl.Marker({ element: el, draggable: !!onMove })
          .setLngLat([obj.position.lng, obj.position.lat])
          .addTo(map)
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          onSelectRef.current(obj.id)
        })
        m.on('dragend', () => {
          const ll = m.getLngLat()
          onMoveRef.current?.(obj.id, { lng: ll.lng, lat: ll.lat })
        })
        markers.set(obj.id, m)
        marker = m
      } else {
        marker.setLngLat([obj.position.lng, obj.position.lat])
      }
      const el = marker.getElement()
      const selected = obj.id === selectedId
      const size = selected ? 20 : 15
      const radius = meta.linear ? '3px' : '9999px'
      el.style.cssText = `width:${size}px;height:${size}px;border-radius:${radius};background:${meta.color};border:2px solid ${selected ? '#0f172a' : '#fff'};box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer;opacity:${opacityFor(obj.status)};`
    }

    if (readyRef.current) {
(map.getSource(LINE_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(lineFeatures(objects, selectedId))
    }
  }, [objects, selectedId, onMove])

  // Vertex handles + crosshair cursor for the object being drawn.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear previous vertex markers.
    vertexMarkersRef.current.forEach((m) => m.remove())
    vertexMarkersRef.current = []

    map.getCanvas().style.cursor = drawingId ? 'crosshair' : ''

    const obj = objects.find((o) => o.id === drawingId)
    if (!obj) return
    const path = obj.path ?? []

    path.forEach((pt, idx) => {
      const el = document.createElement('div')
      el.style.cssText =
        'width:12px;height:12px;border-radius:9999px;background:#fff;border:2px solid #0f172a;box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:move;'
      const m = new mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat([pt.lng, pt.lat])
        .addTo(map)
      el.addEventListener('click', (e) => e.stopPropagation())
      m.on('dragend', () => {
        const ll = m.getLngLat()
        const next = [...(objects.find((o) => o.id === drawingId)?.path ?? [])]
        next[idx] = { lng: ll.lng, lat: ll.lat }
        onPathChange?.(drawingId!, next)
      })
      vertexMarkersRef.current.push(m)
    })
  }, [drawingId, objects, onPathChange])

  useEffect(() => {
    mapRef.current?.setCenter([center.lng, center.lat])
  }, [center.lng, center.lat])

  if (!TOKEN) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <MapPinned size={32} className="text-slate-400" />
        <div>
          <p className="font-medium text-slate-700">Map preview unavailable</p>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            Add a <code className="rounded bg-slate-200 px-1">VITE_MAPBOX_TOKEN</code> to your{' '}
            <code className="rounded bg-slate-200 px-1">.env</code> file to enable the interactive map and route
            drawing. Objects are listed and fully editable on the left in the meantime.
          </p>
        </div>
        <div className="mt-2 grid w-full max-w-sm grid-cols-1 gap-1">
          {objects.slice(0, 8).map((o) => (
            <button
              key={o.id}
              onClick={() => onSelect(o.id)}
              className={`flex items-center justify-between rounded-lg border px-3 py-1.5 text-left text-sm ${
                o.id === selectedId ? 'border-brand-400 bg-white' : 'border-slate-200 bg-white/60'
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5"
                  style={{ background: objectMeta(o.type).color, borderRadius: objectMeta(o.type).linear ? '2px' : '9999px' }}
                />
                {o.label}
              </span>
              <span className="text-xs text-slate-400">{o.position.lat.toFixed(4)}, {o.position.lng.toFixed(4)}</span>
            </button>
          ))}
          {objects.length > 8 && <p className="text-xs text-slate-400">+ {objects.length - 8} more</p>}
        </div>
      </div>
    )
  }

  return <div ref={containerRef} className="h-full min-h-[320px] w-full rounded-xl" />
}
