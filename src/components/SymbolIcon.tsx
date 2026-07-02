/**
 * Renders a Field Map toolbar button's icon from the shared engineering symbol
 * catalog — so a toolbar button looks like the symbol it draws, not a generic
 * Lucide icon. Third parallel consumer of engineeringSymbols.ts's shape/lineStyle
 * data, alongside markupLayer.ts (Leaflet) and markupToPdfSvg.tsx (PDF SVG) —
 * simplified for legibility at 15px (no abbreviation text, outline only).
 */
import type { EngineeringSymbolDef, SymbolShape, LineStyle } from '../lib/engineeringSymbols'

function PointShapeIcon({ shape, color }: { shape: SymbolShape; color: string }) {
  switch (shape) {
    case 'hexagon':
      return <polygon points="7,1 12,1 15,7.5 12,14 7,14 4,7.5" fill="none" stroke={color} strokeWidth={1.6} />
    case 'circleDot':
      return (
        <>
          <circle cx={7.5} cy={7.5} r={6} fill="none" stroke={color} strokeWidth={1.6} />
          <circle cx={7.5} cy={7.5} r={2} fill={color} />
        </>
      )
    case 'diamond':
      return <rect x={3.5} y={3.5} width={8} height={8} transform="rotate(45 7.5 7.5)" fill="none" stroke={color} strokeWidth={1.6} />
    case 'flag':
      return (
        <>
          <line x1={3} y1={1} x2={3} y2={14} stroke={color} strokeWidth={1.4} />
          <polygon points="3,1 13,5 3,9" fill={color} fillOpacity={0.85} stroke={color} strokeWidth={1} />
        </>
      )
    case 'oval':
      return <ellipse cx={7.5} cy={7.5} rx={6.5} ry={4} fill="none" stroke={color} strokeWidth={1.6} />
    case 'coil':
      return <path d="M8 3 a3.3 3.3 0 1 1 -3 4.6 a2.3 2.3 0 1 1 2-3.6" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    case 'cross':
      return (
        <>
          <circle cx={7.5} cy={7.5} r={5.5} fill="none" stroke={color} strokeWidth={1.4} />
          <line x1={7.5} y1={3.5} x2={7.5} y2={11.5} stroke={color} strokeWidth={1.4} />
          <line x1={3.5} y1={7.5} x2={11.5} y2={7.5} stroke={color} strokeWidth={1.4} />
        </>
      )
    case 'square':
      return <rect x={2.5} y={2.5} width={10} height={10} fill="none" stroke={color} strokeWidth={1.6} />
    case 'pinBadge':
    default:
      return <circle cx={7.5} cy={7.5} r={6} fill={color} fillOpacity={0.85} />
  }
}

function LineStyleIcon({ lineStyle, color }: { lineStyle: LineStyle; color: string }) {
  const dash: Record<LineStyle, string | undefined> = {
    solid: undefined, dashed: '3 2', dotted: '1 2.5', tickMarked: undefined, arrowTerminated: undefined,
  }
  return (
    <>
      <line x1={1.5} y1={13} x2={13} y2={2} stroke={color} strokeWidth={1.8} strokeDasharray={dash[lineStyle]} strokeLinecap="round" />
      {lineStyle === 'arrowTerminated' && (
        <polygon points="13,2 8.5,3.5 11.5,6.5" fill={color} stroke={color} />
      )}
    </>
  )
}

export function SymbolIcon({ def, size = 15 }: { def: EngineeringSymbolDef; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 15 15">
      {def.geometryKind === 'point' && def.shape
        ? <PointShapeIcon shape={def.shape} color={def.color} />
        : <LineStyleIcon lineStyle={def.lineStyle ?? 'solid'} color={def.color} />}
    </svg>
  )
}
