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
// Phase 1 (this file, current pass): Directional Drill, Aerial Strand,
// Handhole / Vault. The other 10 Work Types keep using the existing generic
// line/point tools (src/lib/workObjectTypes.ts's LINE_TYPE_TOOLS/
// POINT_TYPE_TOOLS defaults) until they're migrated the same way.
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
]

export const ENGINEERING_SYMBOL_MAP: Record<string, EngineeringSymbolDef> =
  Object.fromEntries(ENGINEERING_SYMBOLS.map((s) => [s.tool, s]))

export const ENGINEERING_POINT_TOOLS = ENGINEERING_SYMBOLS.filter((s) => s.geometryKind === 'point').map((s) => s.tool)
export const ENGINEERING_LINE_TOOLS = ENGINEERING_SYMBOLS.filter((s) => s.geometryKind === 'line').map((s) => s.tool)
