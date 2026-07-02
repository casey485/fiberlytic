// ---------------------------------------------------------------------------
// Engineering symbol library — one shared catalog driving three things:
//  1. Field Map toolbar buttons (src/components/SymbolIcon.tsx)
//  2. Leaflet rendering (src/lib/markupLayer.ts)
//  3. PDF Print Mode SVG rendering (src/lib/markupToPdfSvg.tsx)
// Adding a new symbol only ever means adding a catalog entry here — the
// rendering code is shape-driven (a small, reusable set of primitives), not
// per-symbol, so it never needs touching again for a same-shape addition.
//
// Symbols follow general telecom/utility drafting convention (pole = circle
// with a center dot, handhole = labeled hexagon, anchor = flag, splice =
// oval, etc.) — not any single company's proprietary CAD block library,
// which isn't publicly documented.
//
// Covers 12 Work Types: Directional Drill, Aerial Strand, Handhole/Vault,
// Distribution Fiber, Feeder Fiber, Drop, Pole, Anchor/Down Guy, Splicing,
// Trenching, Plowing, Sub-Ducting. Restoration/QA-QC/Utility Conflict/Damage
// Report weren't given engineering-symbol specs — they keep their existing
// generic tools (src/lib/workObjectTypes.ts's LINE_TYPE_TOOLS/POINT_TYPE_TOOLS
// defaults, or Restoration's own polygon/rect/pen/measure override).
// ---------------------------------------------------------------------------

import type { MarkupTool } from '../types'

export type SymbolShape =
  | 'hexagon'   // handholes / vaults — outline hexagon with a size/id code inside
  | 'circleDot' // poles — circle with a smaller filled center dot
  | 'diamond'   // connection/label points
  | 'flag'      // anchors, guys, dead ends — small flag off the attachment point
  | 'oval'      // splice cases, closures, terminals (future phase)
  | 'coil'      // slack loops / storage loops — small spiral
  | 'cross'     // bore start/end, risers, conduit entries — small + / x mark
  | 'square'    // concrete pads, guards
  | 'pinBadge'  // fallback — the existing generic rounded-rect chip

export type LineStyle =
  | 'solid'
  | 'dashed'
  | 'dotted'          // underground / not directly visible (bores)
  | 'tickMarked'       // perpendicular tick marks at intervals (future phase — fiber count/routes)
  | 'arrowTerminated'  // arrowhead at the line's end (direction-indicating routes)

export interface EngineeringSymbolDef {
  tool: MarkupTool
  label: string
  /** Short text drawn inside/near the symbol — e.g. 'DB', '17', 'HH'. */
  abbr: string
  color: string
  geometryKind: 'point' | 'line'
  /** Point tools only. */
  shape?: SymbolShape
  /** Line tools only. */
  lineStyle?: LineStyle
  /** Drives hollow-outline (existing) vs. solid-fill (new/proposed) — the standard
   * drafting convention, applied consistently everywhere this distinction exists. */
  variant?: 'existing' | 'new'
}

export const ENGINEERING_SYMBOLS: EngineeringSymbolDef[] = [
  // ── Directional Drill ────────────────────────────────────────────────────
  { tool: 'directional_bore', label: 'Directional Bore', abbr: 'DB',  color: '#3b82f6', geometryKind: 'line', lineStyle: 'dotted' },
  { tool: 'road_bore',        label: 'Road Bore',        abbr: 'RB',  color: '#f97316', geometryKind: 'line', lineStyle: 'dotted' },
  { tool: 'railroad_bore',    label: 'Railroad Bore',    abbr: 'RRB', color: '#ef4444', geometryKind: 'line', lineStyle: 'dotted' },
  { tool: 'bridge_bore',      label: 'Bridge Bore',      abbr: 'BB',  color: '#a855f7', geometryKind: 'line', lineStyle: 'dotted' },
  { tool: 'bore_start',       label: 'Bore Start',       abbr: 'BS',  color: '#1d4ed8', geometryKind: 'point', shape: 'cross' },
  { tool: 'bore_end',         label: 'Bore End',         abbr: 'BE',  color: '#1d4ed8', geometryKind: 'point', shape: 'cross' },
  { tool: 'conduit_run',      label: 'Conduit Run',      abbr: 'CR',  color: '#64748b', geometryKind: 'line', lineStyle: 'dashed' },
  { tool: 'direction_arrow',  label: 'Direction Arrow',  abbr: '',    color: '#475569', geometryKind: 'line', lineStyle: 'arrowTerminated' },
  { tool: 'riser',            label: 'Riser',            abbr: 'R',   color: '#f59e0b', geometryKind: 'point', shape: 'cross' },
  { tool: 'handhole_connection', label: 'Handhole Connection', abbr: 'HC', color: '#f59e0b', geometryKind: 'point', shape: 'diamond' },

  // ── Aerial Strand ────────────────────────────────────────────────────────
  { tool: 'new_strand',       label: 'New Strand',       abbr: 'NS',  color: '#06b6d4', geometryKind: 'line', lineStyle: 'solid', variant: 'new' },
  { tool: 'existing_strand',  label: 'Existing Strand',  abbr: 'ES',  color: '#06b6d4', geometryKind: 'line', lineStyle: 'dashed', variant: 'existing' },
  { tool: 'pole_attachment',  label: 'Pole Attachment',  abbr: 'PA',  color: '#06b6d4', geometryKind: 'point', shape: 'circleDot' },
  { tool: 'dead_end',         label: 'Dead End',         abbr: 'DE',  color: '#ef4444', geometryKind: 'point', shape: 'flag' },
  { tool: 'anchor',           label: 'Anchor',           abbr: 'A',   color: '#f59e0b', geometryKind: 'point', shape: 'flag' },
  { tool: 'guy_attachment',   label: 'Guy Attachment',   abbr: 'GA',  color: '#d97706', geometryKind: 'point', shape: 'flag' },
  { tool: 'riser_guard',      label: 'Riser Guard',      abbr: 'RG',  color: '#78716c', geometryKind: 'point', shape: 'square' },
  { tool: 'pole_marker',      label: 'Pole Marker',      abbr: 'PM',  color: '#475569', geometryKind: 'point', shape: 'circleDot' },
  // Reuses the existing 'slack_loop' MarkupTool (types.ts) — just upgrades its shape.
  { tool: 'slack_loop',       label: 'Slack Loop',       abbr: 'SL',  color: '#0ea5e9', geometryKind: 'point', shape: 'coil' },

  // ── Handhole / Vault ─────────────────────────────────────────────────────
  { tool: 'hh17',              label: 'HH17',              abbr: '17', color: '#f59e0b', geometryKind: 'point', shape: 'hexagon', variant: 'new' },
  { tool: 'hh24',              label: 'HH24',              abbr: '24', color: '#f59e0b', geometryKind: 'point', shape: 'hexagon', variant: 'new' },
  { tool: 'hh30',              label: 'HH30',              abbr: '30', color: '#f59e0b', geometryKind: 'point', shape: 'hexagon', variant: 'new' },
  { tool: 'hh36',              label: 'HH36',              abbr: '36', color: '#f59e0b', geometryKind: 'point', shape: 'hexagon', variant: 'new' },
  { tool: 'existing_handhole', label: 'Existing Handhole', abbr: 'HH', color: '#f59e0b', geometryKind: 'point', shape: 'hexagon', variant: 'existing' },
  { tool: 'proposed_handhole', label: 'Proposed Handhole', abbr: 'HH', color: '#f59e0b', geometryKind: 'point', shape: 'hexagon', variant: 'new' },
  { tool: 'concrete_pad',      label: 'Concrete Pad',      abbr: 'CP', color: '#94a3b8', geometryKind: 'point', shape: 'square' },
  { tool: 'lid_label',         label: 'Lid Label',         abbr: 'LID', color: '#64748b', geometryKind: 'point', shape: 'diamond' },
  { tool: 'storage_loop',      label: 'Storage Loop',      abbr: 'SL', color: '#22c55e', geometryKind: 'point', shape: 'coil' },
  { tool: 'conduit_entry',     label: 'Conduit Entry',     abbr: 'CE', color: '#64748b', geometryKind: 'point', shape: 'cross' },
  // Reuses the existing 'vault' MarkupTool (types.ts) — just upgrades its shape.
  { tool: 'vault',             label: 'Vault',             abbr: 'VT', color: '#64748b', geometryKind: 'point', shape: 'hexagon', variant: 'new' },

  // ── Distribution Fiber ───────────────────────────────────────────────────
  { tool: 'distribution_fiber_route', label: 'Distribution Fiber Route', abbr: 'DFR', color: '#22c55e', geometryKind: 'line', lineStyle: 'solid' },
  { tool: 'fiber_tick_marks',  label: 'Fiber Tick Marks', abbr: 'FTM', color: '#22c55e', geometryKind: 'line', lineStyle: 'tickMarked' },
  { tool: 'slack_storage',     label: 'Slack Storage',    abbr: 'SS',  color: '#22c55e', geometryKind: 'point', shape: 'coil' },
  { tool: 'fiber_label',       label: 'Fiber Label',      abbr: 'FL',  color: '#22c55e', geometryKind: 'point', shape: 'diamond' },

  // ── Feeder Fiber ─────────────────────────────────────────────────────────
  { tool: 'feeder_fiber_route', label: 'Feeder Fiber Route', abbr: 'FFR', color: '#4ade80', geometryKind: 'line', lineStyle: 'solid' },
  { tool: 'fiber_count_label', label: 'Fiber Count Label', abbr: 'FC', color: '#4ade80', geometryKind: 'point', shape: 'diamond' },

  // ── Drop ─────────────────────────────────────────────────────────────────
  { tool: 'drop_line',        label: 'Drop Line',        abbr: 'DL',  color: '#22d3ee', geometryKind: 'line', lineStyle: 'solid' },
  { tool: 'house_drop',       label: 'House Drop',       abbr: 'HD',  color: '#22d3ee', geometryKind: 'point', shape: 'square' },
  { tool: 'service_point',    label: 'Service Point',    abbr: 'SP',  color: '#0891b2', geometryKind: 'point', shape: 'circleDot' },
  { tool: 'ont_location',     label: 'ONT Location',     abbr: 'ONT', color: '#0e7490', geometryKind: 'point', shape: 'diamond' },

  // ── Pole ─────────────────────────────────────────────────────────────────
  { tool: 'existing_pole',    label: 'Existing Pole',    abbr: 'EP',  color: '#78716c', geometryKind: 'point', shape: 'circleDot', variant: 'existing' },
  { tool: 'new_pole',         label: 'New Pole',         abbr: 'NP',  color: '#78716c', geometryKind: 'point', shape: 'circleDot', variant: 'new' },
  { tool: 'pole_number',      label: 'Pole Number',      abbr: '#',   color: '#57534e', geometryKind: 'point', shape: 'diamond' },
  { tool: 'transformer',      label: 'Transformer',      abbr: 'TR',  color: '#eab308', geometryKind: 'point', shape: 'square' },
  { tool: 'street_light',     label: 'Street Light',     abbr: 'SL',  color: '#facc15', geometryKind: 'point', shape: 'diamond' },
  { tool: 'comm_attachment',  label: 'Communication Attachment', abbr: 'CA', color: '#06b6d4', geometryKind: 'point', shape: 'circleDot' },
  { tool: 'anchor_attachment', label: 'Anchor Attachment', abbr: 'AA', color: '#f59e0b', geometryKind: 'point', shape: 'flag' },

  // ── Anchor / Down Guy ────────────────────────────────────────────────────
  { tool: 'existing_anchor',  label: 'Existing Anchor',  abbr: 'EA',  color: '#f59e0b', geometryKind: 'point', shape: 'flag', variant: 'existing' },
  { tool: 'new_anchor',       label: 'New Anchor',       abbr: 'NA',  color: '#f59e0b', geometryKind: 'point', shape: 'flag', variant: 'new' },
  { tool: 'down_guy',         label: 'Down Guy',         abbr: 'DG',  color: '#d97706', geometryKind: 'line', lineStyle: 'dashed' },
  { tool: 'sidewalk_guy',     label: 'Sidewalk Guy',     abbr: 'SG',  color: '#b45309', geometryKind: 'line', lineStyle: 'dashed' },
  { tool: 'stub_pole_guy',    label: 'Stub Pole Guy',    abbr: 'SPG', color: '#92400e', geometryKind: 'line', lineStyle: 'dashed' },
  { tool: 'anchor_label',     label: 'Anchor Label',     abbr: 'AL',  color: '#78350f', geometryKind: 'point', shape: 'diamond' },

  // ── Splicing ─────────────────────────────────────────────────────────────
  { tool: 'splice_case',      label: 'Splice Case',      abbr: 'SC',  color: '#ec4899', geometryKind: 'point', shape: 'oval' },
  { tool: 'mst',               label: 'MST',              abbr: 'MST', color: '#db2777', geometryKind: 'point', shape: 'oval' },
  { tool: 'terminal',         label: 'Terminal',         abbr: 'T',   color: '#be185d', geometryKind: 'point', shape: 'diamond' },
  { tool: 'closure',          label: 'Closure',          abbr: 'CL',  color: '#9d174d', geometryKind: 'point', shape: 'oval' },
  { tool: 'fiber_storage',    label: 'Fiber Storage',    abbr: 'FS',  color: '#10b981', geometryKind: 'point', shape: 'coil' },
  { tool: 'splice_label',     label: 'Splice Label',     abbr: 'SPL', color: '#ec4899', geometryKind: 'point', shape: 'diamond' },

  // ── Trenching ────────────────────────────────────────────────────────────
  { tool: 'open_trench',      label: 'Open Trench',      abbr: 'OT',  color: '#92400e', geometryKind: 'line', lineStyle: 'dashed' },
  { tool: 'road_cut',         label: 'Road Cut',         abbr: 'RC',  color: '#f97316', geometryKind: 'line', lineStyle: 'dotted' },
  { tool: 'driveway_crossing', label: 'Driveway Crossing', abbr: 'DC', color: '#fb923c', geometryKind: 'line', lineStyle: 'dotted' },
  { tool: 'concrete_cut',     label: 'Concrete Cut',     abbr: 'CC',  color: '#9ca3af', geometryKind: 'line', lineStyle: 'dashed' },
  { tool: 'saw_cut',          label: 'Saw Cut',          abbr: 'SWC', color: '#6b7280', geometryKind: 'line', lineStyle: 'dotted' },

  // ── Plowing ──────────────────────────────────────────────────────────────
  { tool: 'plow_route',       label: 'Plow Route',       abbr: 'PR',  color: '#a855f7', geometryKind: 'line', lineStyle: 'solid' },
  { tool: 'depth_marker',     label: 'Depth Marker',     abbr: 'DM',  color: '#7e22ce', geometryKind: 'point', shape: 'cross' },

  // ── Sub-Ducting ──────────────────────────────────────────────────────────
  { tool: 'duct_1way',        label: '1-Way Duct',       abbr: '1W',  color: '#8b5cf6', geometryKind: 'line', lineStyle: 'dashed' },
  { tool: 'duct_2way',        label: '2-Way Duct',       abbr: '2W',  color: '#8b5cf6', geometryKind: 'line', lineStyle: 'dashed' },
  { tool: 'duct_3way',        label: '3-Way Duct',       abbr: '3W',  color: '#8b5cf6', geometryKind: 'line', lineStyle: 'dashed' },
  { tool: 'duct_4way',        label: '4-Way Duct',       abbr: '4W',  color: '#8b5cf6', geometryKind: 'line', lineStyle: 'dashed' },
  { tool: 'innerduct',        label: 'Innerduct',        abbr: 'ID',  color: '#7c3aed', geometryKind: 'line', lineStyle: 'dotted' },
]

export interface TickSegment { p1: [number, number]; p2: [number, number] }

/**
 * Evenly-spaced perpendicular tick marks along a polyline — the 'tickMarked' line
 * style (fiber count / route marking). Sizes and spacing are fractions of the path's
 * own total length, not absolute units, so this works unchanged in either flat
 * coordinate space markupLayer.ts/markupToPdfSvg.tsx use (lat/lng degrees or PDF
 * page-points) — one shared implementation for both renderers.
 */
export function computeTickMarks(pts: [number, number][], count = 8, tickFraction = 0.035): TickSegment[] {
  if (pts.length < 2) return []
  const segLens: number[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    segLens.push(d)
    total += d
  }
  if (total === 0) return []
  const tickLen = total * tickFraction
  const ticks: TickSegment[] = []
  for (let i = 1; i <= count; i++) {
    const targetDist = (total * i) / (count + 1)
    let acc = 0
    for (let s = 0; s < segLens.length; s++) {
      if (acc + segLens[s] >= targetDist) {
        const segFrac = segLens[s] === 0 ? 0 : (targetDist - acc) / segLens[s]
        const [x1, y1] = pts[s]
        const [x2, y2] = pts[s + 1]
        const px = x1 + (x2 - x1) * segFrac
        const py = y1 + (y2 - y1) * segFrac
        const dx = x2 - x1, dy = y2 - y1
        const len = Math.hypot(dx, dy) || 1
        const perpX = -dy / len, perpY = dx / len
        ticks.push({
          p1: [px + (perpX * tickLen) / 2, py + (perpY * tickLen) / 2],
          p2: [px - (perpX * tickLen) / 2, py - (perpY * tickLen) / 2],
        })
        break
      }
      acc += segLens[s]
    }
  }
  return ticks
}

export const ENGINEERING_SYMBOL_MAP: Record<string, EngineeringSymbolDef> =
  Object.fromEntries(ENGINEERING_SYMBOLS.map((s) => [s.tool, s]))

export const ENGINEERING_POINT_TOOLS = ENGINEERING_SYMBOLS.filter((s) => s.geometryKind === 'point').map((s) => s.tool)
export const ENGINEERING_LINE_TOOLS = ENGINEERING_SYMBOLS.filter((s) => s.geometryKind === 'line').map((s) => s.tool)
