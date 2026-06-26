import { useEffect, useRef } from 'react'
import type { Map, Marker, Polygon, Polyline } from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface Props {
  /** Boundary vertices as [lng, lat] pairs. */
  boundary: [number, number][]
  onChange: (boundary: [number, number][]) => void
  readOnly?: boolean
}

// Default center (continental US) used when no boundary exists yet
const DEFAULT_CENTER: [number, number] = [39.5, -98.5]
const DEFAULT_ZOOM = 4

export function BoundaryMap({ boundary, onChange, readOnly = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const markersRef = useRef<Marker[]>([])
  const shapeRef = useRef<Polygon | Polyline | null>(null)
  // Keep a ref so event handlers always see the latest boundary without going stale
  const boundaryRef = useRef<[number, number][]>(boundary)

  // Sync prop → ref so click handlers always close over current value
  boundaryRef.current = boundary

  // ── Initialize map once ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    import('leaflet').then((L) => {
      // Fix Leaflet's broken default icon path when bundled with Vite
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const initialCenter: [number, number] =
        boundary.length > 0
          ? [boundary[0][1], boundary[0][0]] // leaflet uses [lat, lng]
          : DEFAULT_CENTER

      const map = L.map(containerRef.current!, {
        center: initialCenter,
        zoom: boundary.length > 0 ? 17 : DEFAULT_ZOOM,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 20,
      }).addTo(map)

      mapRef.current = map

      // Render initial boundary
      renderBoundary(L, map, boundary, readOnly, onChange, markersRef, shapeRef, boundaryRef)

      // Fit to boundary if one exists
      if (boundary.length > 1) {
        const latLngs = boundary.map<[number, number]>((p) => [p[1], p[0]])
        map.fitBounds(latLngs, { padding: [40, 40], maxZoom: 19 })
      }

      if (!readOnly) {
        map.on('click', (e) => {
          const newBoundary: [number, number][] = [
            ...boundaryRef.current,
            [e.latlng.lng, e.latlng.lat],
          ]
          onChange(newBoundary)
          renderBoundary(L, map, newBoundary, readOnly, onChange, markersRef, shapeRef, boundaryRef)
        })
      }
    })

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      markersRef.current = []
      shapeRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Sync external boundary changes (e.g. after "Clear") ─────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    import('leaflet').then((L) => {
      renderBoundary(L, map, boundary, readOnly, onChange, markersRef, shapeRef, boundaryRef)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundary])

  return (
    <div className="space-y-2">
      {!readOnly && (
        <p className="text-xs text-slate-500">
          Click anywhere on the map to add a boundary point. Click a blue dot to remove it.
          {boundary.length > 0 && boundary.length < 3 && (
            <span className="ml-1 text-amber-600">Need {3 - boundary.length} more point{3 - boundary.length === 1 ? '' : 's'} for a valid polygon.</span>
          )}
        </p>
      )}
      <div ref={containerRef} className="h-72 w-full rounded-xl overflow-hidden border border-slate-200" />
      {!readOnly && boundary.length > 0 && (
        <p className="text-xs text-slate-400">{boundary.length} point{boundary.length !== 1 ? 's' : ''} placed</p>
      )}
    </div>
  )
}

// ── Render helpers ──────────────────────────────────────────────────────────

function renderBoundary(
  L: typeof import('leaflet'),
  map: Map,
  pts: [number, number][],
  readOnly: boolean,
  onChange: (b: [number, number][]) => void,
  markersRef: React.MutableRefObject<Marker[]>,
  shapeRef: React.MutableRefObject<Polygon | Polyline | null>,
  boundaryRef: React.MutableRefObject<[number, number][]>,
) {
  // Clear previous markers + shape
  markersRef.current.forEach((m) => m.remove())
  markersRef.current = []
  shapeRef.current?.remove()
  shapeRef.current = null

  if (pts.length === 0) return

  const latLngs = pts.map<[number, number]>((p) => [p[1], p[0]])

  // Draw shape
  if (pts.length === 1) {
    // Single point — just a circle marker, no line yet
  } else if (pts.length === 2) {
    shapeRef.current = L.polyline(latLngs, { color: '#3b82f6', weight: 2 }).addTo(map)
  } else {
    shapeRef.current = L.polygon(latLngs, {
      color: '#3b82f6',
      weight: 2,
      fillColor: '#3b82f6',
      fillOpacity: 0.15,
    }).addTo(map)
  }

  // Draw vertex markers
  pts.forEach((pt, i) => {
    const dotIcon = L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;border-radius:50%;background:#3b82f6;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    })

    const marker = L.marker([pt[1], pt[0]], {
      icon: dotIcon,
      draggable: !readOnly,
    }).addTo(map)

    if (!readOnly) {
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng()
        const next: [number, number][] = boundaryRef.current.map((p, j) =>
          j === i ? [lng, lat] : p,
        )
        onChange(next)
        renderBoundary(L, map, next, readOnly, onChange, markersRef, shapeRef, boundaryRef)
      })

      marker.on('click', (e) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(e as any).originalEvent?.stopPropagation()
        const next = boundaryRef.current.filter((_, j) => j !== i)
        onChange(next)
        renderBoundary(L, map, next, readOnly, onChange, markersRef, shapeRef, boundaryRef)
      })
    }

    markersRef.current.push(marker)
  })
}
