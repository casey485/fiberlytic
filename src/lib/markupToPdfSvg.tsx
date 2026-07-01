/**
 * Converts FieldMarkup records to SVG elements for PDF Print Mode's page overlay.
 * Mirrors markupLayer.ts's per-tool rendering rules exactly, but emits plain SVG
 * primitives (positioned in native PDF page-point units, e.g. 612x792 for Letter)
 * instead of Leaflet layers — the parent <svg viewBox="0 0 pageW pageH"
 * preserveAspectRatio="none"> handles all zoom/container scaling automatically,
 * so sizes below are written directly in page-point units (matching how the
 * page's own content is scaled), not screen pixels.
 *
 * Geometry convention for coordSpace: 'pdfPage' markups: every [number, number]
 * pair is [x, y] in page-point space (NOT [lat, lng] — that ordering is only
 * meaningful for coordSpace: 'latlng' markups rendered by markupLayer.ts).
 */
import type { FieldMarkup } from '../types'
import { FEATURE_TOOL_LABELS } from './markupMeta'

const DASH: Record<string, string | undefined> = {
  dashed_line: '10 6',
  dotted_line: '2 6',
}
const DASH_BY_STYLE: Record<string, string | undefined> = {
  solid: undefined,
  dashed: '10 6',
  dotted: '2 6',
}
function dashArrayFor(m: FieldMarkup): string | undefined {
  return m.lineStyle ? DASH_BY_STYLE[m.lineStyle] : DASH[m.tool]
}

function ptsToPolyPoints(pts: [number, number][]): string {
  return pts.map(([x, y]) => `${x},${y}`).join(' ')
}

/** Triangle arrowhead points for a polyline endpoint, plain 2D angle math (no projection needed in flat page space). */
function arrowHeadPoints(from: [number, number], to: [number, number], size = 14): string {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
  const spread = Math.PI / 7
  const a1x = to[0] - size * Math.cos(angle - spread)
  const a1y = to[1] - size * Math.sin(angle - spread)
  const a2x = to[0] - size * Math.cos(angle + spread)
  const a2y = to[1] - size * Math.sin(angle + spread)
  return `${a1x},${a1y} ${to[0]},${to[1]} ${a2x},${a2y}`
}

/** Build an SVG element for a FieldMarkup on a PDF page. Returns null if geometry is missing/invalid or not applicable. */
export function markupToPdfElement(m: FieldMarkup): JSX.Element | null {
  const color = m.color || '#ef4444'
  const weight = m.weight || 3
  const opacity = m.opacity ?? 0.95
  const dashArray = dashArrayFor(m)
  const geo = m.geometry

  switch (m.tool) {
    case 'pen':
    case 'line':
    case 'dashed_line':
    case 'dotted_line':
    case 'multi_line':
    case 'measure':
    case 'highlight': {
      if (!geo.latlngs?.length) return null
      return (
        <polyline
          points={ptsToPolyPoints(geo.latlngs)}
          fill="none" stroke={color} strokeWidth={weight} strokeOpacity={opacity}
          strokeDasharray={dashArray} strokeLinecap="round" strokeLinejoin="round"
        />
      )
    }

    case 'arrow':
    case 'double_arrow': {
      if (!geo.latlngs || geo.latlngs.length < 2) return null
      const pts = geo.latlngs
      const end = pts[pts.length - 1], endFrom = pts[pts.length - 2]
      return (
        <g opacity={opacity}>
          <polyline points={ptsToPolyPoints(pts)} fill="none" stroke={color} strokeWidth={weight} strokeDasharray={dashArray} strokeLinecap="round" strokeLinejoin="round" />
          <polygon points={arrowHeadPoints(endFrom, end)} fill={color} stroke={color} />
          {m.tool === 'double_arrow' && (
            <polygon points={arrowHeadPoints(pts[1], pts[0])} fill={color} stroke={color} />
          )}
        </g>
      )
    }

    case 'rect': {
      if (!geo.bounds) return null
      const [[x1, y1], [x2, y2]] = geo.bounds
      return (
        <rect
          x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)}
          fill={m.fillColor ?? color} fillOpacity={m.fillOpacity ?? 0.15}
          stroke={color} strokeWidth={weight} strokeOpacity={opacity} strokeDasharray={dashArray}
        />
      )
    }

    case 'ellipse': {
      if (!geo.bounds) return null
      const [[x1, y1], [x2, y2]] = geo.bounds
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
      const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2
      return (
        <ellipse
          cx={cx} cy={cy} rx={rx} ry={ry}
          fill={m.fillColor ?? color} fillOpacity={m.fillOpacity ?? 0.15}
          stroke={color} strokeWidth={weight} strokeOpacity={opacity}
        />
      )
    }

    case 'circle': {
      if (!geo.center || geo.radius == null) return null
      return (
        <circle
          cx={geo.center[0]} cy={geo.center[1]} r={geo.radius}
          fill={m.fillColor ?? color} fillOpacity={m.fillOpacity ?? 0.15}
          stroke={color} strokeWidth={weight} strokeOpacity={opacity}
        />
      )
    }

    case 'polygon':
    case 'cloud': {
      if (!geo.latlngs?.length) return null
      return (
        <polygon
          points={ptsToPolyPoints(geo.latlngs)}
          fill={m.fillColor ?? color} fillOpacity={m.fillOpacity ?? 0.15}
          stroke={color}
          strokeWidth={m.tool === 'cloud' ? Math.max(weight, 6) : weight}
          strokeOpacity={opacity}
          strokeLinejoin={m.tool === 'cloud' ? 'round' : undefined}
          strokeDasharray={m.tool === 'cloud' ? '3 9' : dashArray}
        />
      )
    }

    case 'text': {
      if (!geo.center) return null
      const textDecoration = [m.fontUnderline && 'underline', m.fontStrikethrough && 'line-through'].filter(Boolean).join(' ') || 'none'
      return (
        <text
          x={geo.center[0]} y={geo.center[1]} fill={color}
          fontSize={m.fontSize ?? 13} fontFamily={m.fontFamily ?? 'inherit'}
          fontWeight={m.fontBold === false ? 400 : 700}
          fontStyle={m.fontItalic ? 'italic' : 'normal'}
          textDecoration={textDecoration}
          dominantBaseline="hanging"
        >
          {m.label ?? ''}
        </text>
      )
    }

    case 'callout': {
      // Unlike the Leaflet map (pans/zooms, so callouts need a screen-fixed DOM overlay to stay
      // readable), the PDF page is a fixed coordinate space — a callout is just a normal SVG box.
      if (!geo.center) return null
      const label = m.label ?? ''
      const fontSize = m.fontSize ?? 13
      const w = Math.max(60, label.length * fontSize * 0.6 + 16)
      const h = fontSize + 16
      const [cx, cy] = geo.center
      return (
        <g opacity={opacity}>
          <rect x={cx} y={cy} width={w} height={h} rx={6} fill="#0d0d0d" fillOpacity={0.85} stroke={color} strokeWidth={1.5} />
          <text x={cx + 8} y={cy + h / 2} fill={color} fontSize={fontSize} dominantBaseline="central">{label}</text>
        </g>
      )
    }

    default: {
      // Feature drop — labeled pin (or circular badge for struct_ types)
      if (!geo.center) return null
      const meta = FEATURE_TOOL_LABELS[m.tool] ?? { abbr: '?', color: '#6b7280', label: m.tool }
      const pinColor = meta.color
      const [cx, cy] = geo.center
      const featureLabel = m.featureName ?? ''

      if (m.tool.startsWith('struct_')) {
        const abbr = meta.abbr
        const r = abbr.length > 2 ? 19 : 15
        return (
          <g>
            <circle cx={cx} cy={cy} r={r} fill="#0d0d0d" stroke={pinColor} strokeWidth={2.5} />
            <text x={cx} y={cy} fill={pinColor} fontSize={abbr.length > 2 ? 9 : 11} fontWeight={800} textAnchor="middle" dominantBaseline="central">{abbr}</text>
            {featureLabel && (
              <text x={cx} y={cy + r + 10} fill="#fff" fontSize={9} textAnchor="middle" dominantBaseline="hanging">{featureLabel}</text>
            )}
          </g>
        )
      }

      return (
        <g>
          <rect x={cx - 17} y={cy - 32} width={34} height={16} rx={4} fill={pinColor} stroke="rgba(255,255,255,0.3)" strokeWidth={2} />
          <text x={cx} y={cy - 24} fill="#fff" fontSize={10} fontWeight={800} textAnchor="middle" dominantBaseline="central">{meta.abbr}</text>
          <line x1={cx} y1={cy - 16} x2={cx} y2={cy - 10} stroke={pinColor} strokeWidth={2} strokeOpacity={0.8} />
          {featureLabel && (
            <text x={cx} y={cy - 4} fill="#fff" fontSize={9} textAnchor="middle" dominantBaseline="hanging">{featureLabel}</text>
          )}
        </g>
      )
    }
  }
}
