/**
 * Converts FieldMarkup records to Leaflet layers.
 * Kept separate from KmzMap so the rendering logic is testable and reusable.
 */
import L from 'leaflet'
import type { FieldMarkup } from '../types'
import { FEATURE_TOOL_LABELS } from './markupMeta'
import { ENGINEERING_SYMBOL_MAP, computeTickMarks, type SymbolShape } from './engineeringSymbols'

/** Escapes user-entered text before it's interpolated into a divIcon's innerHTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Dash arrays for line styles. */
const DASH: Record<string, string | undefined> = {
  dashed_line: '10 6',
  dotted_line: '2 6',
}
const DASH_BY_STYLE: Record<string, string | undefined> = {
  solid: undefined,
  dashed: '10 6',
  dotted: '2 6',
  tickMarked: undefined, // ticks are drawn as a separate decoration, not a dash pattern
  arrowTerminated: undefined,
}
/** `lineStyle` (if set) takes priority over the tool-based dash lookup; an engineering
 * symbol's own catalog lineStyle is checked next, then the legacy per-tool fallback. */
function dashArrayFor(m: FieldMarkup): string | undefined {
  if (m.lineStyle) return DASH_BY_STYLE[m.lineStyle]
  const symbolStyle = ENGINEERING_SYMBOL_MAP[m.tool]?.lineStyle
  if (symbolStyle) return DASH_BY_STYLE[symbolStyle]
  return DASH[m.tool]
}

/**
 * Renders one of the shared engineering-symbol point shapes as an inline SVG string.
 * `filled` drives the standard drafting convention: hollow outline = existing,
 * solid fill = new/proposed. Mirrored exactly in src/lib/markupToPdfSvg.tsx and
 * src/components/SymbolIcon.tsx — all three read the same shape name.
 */
function symbolShapeSvg(shape: SymbolShape, color: string, abbr: string, filled: boolean): string {
  const fill = filled ? color : 'none'
  const fillOpacity = filled ? 0.85 : 0
  switch (shape) {
    case 'hexagon':
      return `<svg width="34" height="30" viewBox="0 0 34 30">
        <polygon points="9,2 25,2 33,15 25,28 9,28 1,15" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${color}" stroke-width="2.5"/>
        <text x="17" y="19" text-anchor="middle" font-size="10" font-weight="800" font-family="monospace" fill="${filled ? '#fff' : color}">${abbr}</text>
      </svg>`
    case 'circleDot':
      return `<svg width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2.5"/>
        <circle cx="12" cy="12" r="3" fill="${color}"/>
      </svg>`
    case 'diamond':
      return `<svg width="22" height="22" viewBox="0 0 22 22">
        <rect x="4" y="4" width="14" height="14" transform="rotate(45 11 11)" fill="${fill}" fill-opacity="${filled ? 0.85 : 0}" stroke="${color}" stroke-width="2.5"/>
      </svg>`
    case 'flag':
      return `<svg width="20" height="26" viewBox="0 0 20 26">
        <line x1="3" y1="2" x2="3" y2="24" stroke="${color}" stroke-width="2"/>
        <polygon points="3,2 17,7 3,12" fill="${filled ? color : 'none'}" fill-opacity="0.9" stroke="${color}" stroke-width="2"/>
      </svg>`
    case 'oval':
      return `<svg width="28" height="18" viewBox="0 0 28 18">
        <ellipse cx="14" cy="9" rx="12" ry="7" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${color}" stroke-width="2.5"/>
      </svg>`
    case 'coil':
      return `<svg width="22" height="22" viewBox="0 0 22 22">
        <path d="M11 4 a5 5 0 1 1 -4.5 7 a3.5 3.5 0 1 1 3-5.4" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
      </svg>`
    case 'cross':
      return `<svg width="20" height="20" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" fill="#0d0d0d" fill-opacity="0.5" stroke="${color}" stroke-width="2"/>
        <line x1="10" y1="4" x2="10" y2="16" stroke="${color}" stroke-width="2"/>
        <line x1="4" y1="10" x2="16" y2="10" stroke="${color}" stroke-width="2"/>
      </svg>`
    case 'square':
      return `<svg width="22" height="22" viewBox="0 0 22 22">
        <rect x="3" y="3" width="16" height="16" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${color}" stroke-width="2.5"/>
      </svg>`
    case 'pinBadge':
    default:
      return `<svg width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" fill="${color}" fill-opacity="0.85" stroke="#fff" stroke-width="1.5"/>
      </svg>`
  }
}

/** Calculate arrow head points for a polyline endpoint. */
function arrowHead(from: L.LatLng, to: L.LatLng, map: L.Map, size = 14): string {
  const fp = map.latLngToLayerPoint(from)
  const tp = map.latLngToLayerPoint(to)
  const angle = Math.atan2(tp.y - fp.y, tp.x - fp.x)
  const spread = Math.PI / 7
  const a1x = tp.x - size * Math.cos(angle - spread)
  const a1y = tp.y - size * Math.sin(angle - spread)
  const a2x = tp.x - size * Math.cos(angle + spread)
  const a2y = tp.y - size * Math.sin(angle + spread)
  return `${a1x},${a1y} ${tp.x},${tp.y} ${a2x},${a2y}`
}

export type EditMode = 'none' | 'vertices' | 'move'

/**
 * Build draggable handle markers for editing a FieldMarkup's geometry in place.
 * Callers add the returned layers to the map and re-render on every geometry
 * change (geometry always comes from the store, never local component state).
 */
export function buildEditHandles(
  m: FieldMarkup,
  mode: Exclude<EditMode, 'none'>,
  onUpdate: (patch: Partial<FieldMarkup>) => void,
): L.Layer[] {
  const geo = m.geometry
  const handleIcon = (color: string) => L.divIcon({
    className: '',
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.6)"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  })

  function translateGeometry(dLat: number, dLng: number) {
    const next = { ...geo }
    if (geo.latlngs) next.latlngs = geo.latlngs.map(([la, ln]) => [la + dLat, ln + dLng] as [number, number])
    if (geo.bounds) next.bounds = [
      [geo.bounds[0][0] + dLat, geo.bounds[0][1] + dLng],
      [geo.bounds[1][0] + dLat, geo.bounds[1][1] + dLng],
    ]
    if (geo.center) next.center = [geo.center[0] + dLat, geo.center[1] + dLng]
    onUpdate({ geometry: next })
  }

  const handles: L.Layer[] = []

  // Per-vertex handles for line/polygon-style geometry
  if (mode === 'vertices' && geo.latlngs?.length) {
    geo.latlngs.forEach(([lat, lng], idx) => {
      const marker = L.marker([lat, lng], { draggable: true, icon: handleIcon('#3b82f6'), pane: 'markups', zIndexOffset: 1000 })
      marker.on('dragend', () => {
        const ll = marker.getLatLng()
        const nextLatLngs = geo.latlngs!.map((pt, i) => (i === idx ? [ll.lat, ll.lng] as [number, number] : pt))
        onUpdate({ geometry: { ...geo, latlngs: nextLatLngs } })
      })
      handles.push(marker)
    })
    return handles
  }

  // Center + radius handles for circles
  if (mode === 'vertices' && geo.center && geo.radius != null) {
    const [cLat, cLng] = geo.center
    const centerHandle = L.marker([cLat, cLng], { draggable: true, icon: handleIcon('#3b82f6'), pane: 'markups', zIndexOffset: 1000 })
    centerHandle.on('dragend', () => {
      const ll = centerHandle.getLatLng()
      translateGeometry(ll.lat - cLat, ll.lng - cLng)
    })
    handles.push(centerHandle)

    const metersPerDegLng = 111320 * Math.cos((cLat * Math.PI) / 180) || 1
    const radiusLng = cLng + geo.radius / metersPerDegLng
    const radiusHandle = L.marker([cLat, radiusLng], { draggable: true, icon: handleIcon('#f59e0b'), pane: 'markups', zIndexOffset: 1000 })
    radiusHandle.on('dragend', () => {
      const ll = radiusHandle.getLatLng()
      const newRadius = L.latLng(cLat, cLng).distanceTo(ll)
      onUpdate({ geometry: { ...geo, radius: newRadius } })
    })
    handles.push(radiusHandle)
    return handles
  }

  // Move mode (and the vertices-mode fallback for bounds/single-point geometry):
  // one anchor handle that translates the whole shape by the drag delta.
  const anchor: [number, number] | null = geo.latlngs?.[0] ?? geo.bounds?.[0] ?? geo.center ?? null
  if (!anchor) return handles
  const moveHandle = L.marker(anchor, { draggable: true, icon: handleIcon('#22c55e'), pane: 'markups', zIndexOffset: 1000 })
  moveHandle.on('dragend', () => {
    const ll = moveHandle.getLatLng()
    translateGeometry(ll.lat - anchor[0], ll.lng - anchor[1])
  })
  handles.push(moveHandle)
  return handles
}

/**
 * Build clickable (non-draggable) vertex markers for Split mode — clicking a
 * vertex reports its index back via `onVertexClick`. Used for both line split
 * (needs 1 interior vertex) and polygon split (needs 2 vertices).
 */
export function buildSplitVertexMarkers(m: FieldMarkup, onVertexClick: (index: number) => void): L.Layer[] {
  const pts = m.geometry.latlngs
  if (!pts?.length) return []
  return pts.map(([lat, lng], idx) => {
    const marker = L.marker([lat, lng], {
      pane: 'markups',
      zIndexOffset: 1000,
      icon: L.divIcon({
        className: '',
        html: '<div style="width:10px;height:10px;border-radius:50%;background:#f97316;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.6);cursor:pointer"></div>',
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      }),
    })
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e as L.LeafletMouseEvent)
      onVertexClick(idx)
    })
    return marker
  })
}

/** Build a Leaflet layer for a FieldMarkup. Returns null if geometry is missing/invalid. */
export function markupToLayer(m: FieldMarkup, map: L.Map): L.Layer | null {
  const color = m.color || '#ef4444'
  const opts: L.PathOptions = {
    color,
    weight: m.weight || 3,
    opacity: m.opacity ?? 0.95,
    pane: 'markups',
    dashArray: dashArrayFor(m),
  }

  const geo = m.geometry

  // Engineering symbol line tools — catalog-driven, so adding a new line-kind symbol
  // to engineeringSymbols.ts never requires touching this file. 'direction_arrow' is
  // excluded here; it renders through the arrow case in the switch below instead,
  // since it needs an arrowhead, not a plain polyline.
  const lineSymbolDef = ENGINEERING_SYMBOL_MAP[m.tool]
  if (lineSymbolDef?.geometryKind === 'line' && m.tool !== 'direction_arrow') {
    if (!geo.latlngs?.length) return null
    const line = L.polyline(geo.latlngs, opts)
    if (lineSymbolDef.lineStyle !== 'tickMarked') return line
    const group = L.layerGroup([line])
    for (const tick of computeTickMarks(geo.latlngs)) {
      group.addLayer(L.polyline([tick.p1, tick.p2], { ...opts, dashArray: undefined }))
    }
    return group
  }

  switch (m.tool) {
    case 'pen':
    case 'line':
    case 'dashed_line':
    case 'dotted_line':
    case 'multi_line':
    case 'measure':
    case 'highlight': {
      if (!geo.latlngs?.length) return null
      return L.polyline(geo.latlngs, opts)
    }

    case 'direction_arrow':
    case 'arrow':
    case 'double_arrow': {
      if (!geo.latlngs || geo.latlngs.length < 2) return null
      const group = L.layerGroup()
      const line = L.polyline(geo.latlngs, opts)
      group.addLayer(line)

      // Arrow head at end
      const pts = geo.latlngs.map((ll) => L.latLng(ll[0], ll[1]))
      const endFrom = pts[pts.length - 2]
      const endTo   = pts[pts.length - 1]
      const poly1 = arrowHead(endFrom, endTo, map)
      const svg1 = L.svgOverlay(
        (() => {
          const ns = 'http://www.w3.org/2000/svg'
          const svg = document.createElementNS(ns, 'svg')
          svg.setAttribute('xmlns', ns)
          const p = document.createElementNS(ns, 'polyline')
          p.setAttribute('points', poly1)
          p.setAttribute('fill', color)
          p.setAttribute('stroke', color)
          p.setAttribute('stroke-width', '1')
          svg.appendChild(p)
          return svg
        })(),
        map.getBounds(),
        { opacity: m.opacity ?? 0.95, pane: 'markups' },
      )
      // For SVG overlays with dynamic content we use a divIcon on the endpoint instead
      const arrowIcon = L.divIcon({
        className: '',
        html: `<svg width="0" height="0"></svg>`,
        iconSize: [0, 0],
      })
      group.addLayer(L.marker(endTo, { icon: arrowIcon, interactive: false, pane: 'markups' }))
      void svg1  // unused — use canvas arrow via L.Canvas workaround below

      // Simpler approach: add a triangle marker at endpoint
      const bearingRad = Math.atan2(endTo.lat - endFrom.lat, endTo.lng - endFrom.lng)
      const bearingDeg = bearingRad * (180 / Math.PI)
      const arrowDivIcon = L.divIcon({
        className: '',
        html: `<div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:14px solid ${color};transform:rotate(${90 - bearingDeg}deg);transform-origin:center bottom;margin-top:-7px;margin-left:-7px;opacity:${m.opacity ?? 0.95}"></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      })
      group.addLayer(L.marker(endTo, { icon: arrowDivIcon, interactive: false, pane: 'markups' }))

      // Double arrow: also at start
      if (m.tool === 'double_arrow') {
        const startFrom = pts[1]
        const startTo   = pts[0]
        const bearingRad2 = Math.atan2(startTo.lat - startFrom.lat, startTo.lng - startFrom.lng)
        const bearingDeg2 = bearingRad2 * (180 / Math.PI)
        const arrowDivIcon2 = L.divIcon({
          className: '',
          html: `<div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:14px solid ${color};transform:rotate(${90 - bearingDeg2}deg);transform-origin:center bottom;margin-top:-7px;margin-left:-7px;opacity:${m.opacity ?? 0.95}"></div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        })
        group.addLayer(L.marker(startTo, { icon: arrowDivIcon2, interactive: false, pane: 'markups' }))
      }

      return group
    }

    case 'rect': {
      if (!geo.bounds) return null
      return L.rectangle(geo.bounds, {
        ...opts,
        fill: true,
        fillColor: m.fillColor ?? color,
        fillOpacity: m.fillOpacity ?? 0.15,
      })
    }

    case 'ellipse': {
      // Leaflet has no native ellipse primitive — an SVG overlay bound to LatLngBounds
      // scales/positions automatically on pan/zoom the same way L.rectangle does.
      if (!geo.bounds) return null
      const ns = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(ns, 'svg')
      svg.setAttribute('xmlns', ns)
      svg.setAttribute('viewBox', '0 0 100 100')
      svg.setAttribute('preserveAspectRatio', 'none')
      const ellipse = document.createElementNS(ns, 'ellipse')
      ellipse.setAttribute('cx', '50')
      ellipse.setAttribute('cy', '50')
      ellipse.setAttribute('rx', '49')
      ellipse.setAttribute('ry', '49')
      ellipse.setAttribute('fill', m.fillColor ?? color)
      ellipse.setAttribute('fill-opacity', String(m.fillOpacity ?? 0.15))
      ellipse.setAttribute('stroke', color)
      ellipse.setAttribute('stroke-width', '2')
      ellipse.setAttribute('vector-effect', 'non-scaling-stroke')
      svg.appendChild(ellipse)
      return L.svgOverlay(svg, geo.bounds, { opacity: m.opacity ?? 0.95, pane: 'markups', interactive: true })
    }

    case 'circle': {
      if (!geo.center || geo.radius == null) return null
      return L.circle(geo.center as L.LatLngExpression, {
        ...opts,
        radius: geo.radius,
        fill: true,
        fillColor: m.fillColor ?? color,
        fillOpacity: m.fillOpacity ?? 0.15,
      })
    }

    case 'polygon':
    case 'cloud': {
      if (!geo.latlngs?.length) return null
      return L.polygon(geo.latlngs, {
        ...opts,
        // Cloud approximates the classic "revision cloud" look with a thick, rounded, scalloped-feeling dash
        // rather than true bezier scallops — a deliberate simplification given the shape's niche use.
        weight: m.tool === 'cloud' ? Math.max(opts.weight ?? 3, 6) : opts.weight,
        lineJoin: m.tool === 'cloud' ? 'round' : undefined,
        dashArray: m.tool === 'cloud' ? '3 9' : opts.dashArray,
        fill: true,
        fillColor: m.fillColor ?? color,
        fillOpacity: m.fillOpacity ?? 0.15,
      })
    }

    case 'text': {
      if (!geo.center) return null
      const label = escapeHtml(m.label ?? '')
      const textDecoration = [m.fontUnderline && 'underline', m.fontStrikethrough && 'line-through'].filter(Boolean).join(' ') || 'none'
      return L.marker(geo.center as L.LatLngExpression, {
        pane: 'markups',
        interactive: true,
        icon: L.divIcon({
          className: '',
          html: `<span style="color:${color};font-size:${m.fontSize ?? 13}px;font-family:${m.fontFamily ?? 'inherit'};font-weight:${m.fontBold === false ? 400 : 700};font-style:${m.fontItalic ? 'italic' : 'normal'};text-decoration:${textDecoration};white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,0.9);pointer-events:none">${label}</span>`,
          iconAnchor: [0, 10],
        }),
      })
    }

    case 'callout': {
      // Rendered as a screen-fixed DOM overlay in KmzMap, not a Leaflet layer
      return null
    }

    default: {
      // Feature drop — render as a labeled pin (or circular marker for struct_ types)
      if (!geo.center) return null
      const featureLabel = escapeHtml(m.featureName ?? '')

      // Engineering symbol point tools — a genuinely distinct shape per catalog entry,
      // instead of the generic pin below. See src/lib/engineeringSymbols.ts.
      const symbolDef = ENGINEERING_SYMBOL_MAP[m.tool]
      if (symbolDef && symbolDef.geometryKind === 'point' && symbolDef.shape) {
        const filled = symbolDef.variant !== 'existing'
        return L.marker(geo.center as L.LatLngExpression, {
          pane: 'markups',
          interactive: true,
          icon: L.divIcon({
            className: '',
            html: `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
              ${symbolShapeSvg(symbolDef.shape, symbolDef.color, escapeHtml(symbolDef.abbr), filled)}
              ${featureLabel ? `<div style="background:rgba(0,0,0,0.75);color:#fff;font-size:9px;padding:1px 5px;border-radius:3px;white-space:nowrap;margin-top:2px">${featureLabel}</div>` : ''}
            </div>`,
            iconAnchor: [17, 15],
            iconSize: [34, featureLabel ? 48 : 30],
          }),
        })
      }

      const meta = FEATURE_TOOL_LABELS[m.tool] ?? { abbr: '?', color: '#6b7280', label: m.tool }
      const pinColor = meta.color

      // Structure markers render as circular icons matching field drawings
      if (m.tool.startsWith('struct_')) {
        const abbr = meta.abbr
        const sz = abbr.length > 2 ? 38 : 30
        const fs = abbr.length > 2 ? 9 : 11
        return L.marker(geo.center as L.LatLngExpression, {
          pane: 'markups',
          interactive: true,
          icon: L.divIcon({
            className: '',
            html: `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
              <div style="width:${sz}px;height:${sz}px;border:2.5px solid ${pinColor};border-radius:50%;background:#0d0d0d;display:flex;align-items:center;justify-content:center;font-size:${fs}px;font-weight:800;color:${pinColor};box-shadow:0 2px 8px rgba(0,0,0,0.7)">${abbr}</div>
              ${featureLabel ? `<div style="background:rgba(0,0,0,0.75);color:#fff;font-size:9px;padding:1px 5px;border-radius:3px;white-space:nowrap;margin-top:2px">${featureLabel}</div>` : ''}
            </div>`,
            iconAnchor: [sz / 2, sz / 2],
            iconSize: [sz, sz + (featureLabel ? 18 : 0)],
          }),
        })
      }

      // Standard feature-drop pin
      const label = featureLabel ? `\n${featureLabel}` : ''
      return L.marker(geo.center as L.LatLngExpression, {
        pane: 'markups',
        interactive: true,
        icon: L.divIcon({
          className: '',
          html: `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
            <div style="background:${pinColor};color:#fff;font-size:10px;font-weight:800;padding:3px 5px;border-radius:4px;border:2px solid rgba(255,255,255,0.3);box-shadow:0 2px 6px rgba(0,0,0,0.6);white-space:nowrap">${meta.abbr}</div>
            <div style="width:2px;height:6px;background:${pinColor};opacity:0.8"></div>
            ${label ? `<div style="background:rgba(0,0,0,0.7);color:#fff;font-size:9px;padding:1px 4px;border-radius:2px;white-space:nowrap;margin-top:1px">${label.trim()}</div>` : ''}
          </div>`,
          iconAnchor: [17, 0],
          iconSize: [34, 32],
        }),
      })
    }
  }
}
