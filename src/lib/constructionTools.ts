/**
 * Smart construction tool definitions for the KMZ markup workflow.
 * 3-step selection: Work Type → Category → Asset → Drawing Tool
 */
import type { MarkupTool } from '../types'

export type WorkType = 'underground' | 'aerial' | 'splicing' | 'general'

// ── Drawing tool types (what kind of mark to make) ────────────────────────────

export type DrawingToolType =
  | 'single_line'   // drag-draw straight line
  | 'multi_line'    // click-add-point open polyline, dblclick to finish
  | 'freehand'      // drag freehand pen
  | 'point_marker'  // single click to place a simple dot/circle
  | 'icon_marker'   // single click to place a labeled feature icon
  | 'rectangle'     // drag-draw filled rectangle
  | 'circle'        // drag-draw filled circle
  | 'polygon'       // click-add-point closed polygon with fill
  | 'cloud'         // click-add-point closed polygon, stored as cloud style
  | 'arrow'         // drag-draw directional arrow
  | 'callout'       // click to place a callout bubble
  | 'text_box'      // click to place a text label
  | 'highlight'     // drag freehand with wide yellow stroke
  | 'measurement'   // drag-draw line, auto-labels length in feet
  | 'photo_pin'     // click to place pin + opens Photos tab in markup panel
  | 'aerial_lash'   // click-to-place numbered pole markers + continuous polyline with tick-mark forms

export const DRAWING_TOOL_META: Record<DrawingToolType, { label: string; hint: string }> = {
  single_line:  { label: 'Single Line',  hint: 'Drag to draw' },
  multi_line:   { label: 'Multi-Line',   hint: 'Click points, dbl-click finish' },
  freehand:     { label: 'Freehand',     hint: 'Drag to draw' },
  point_marker: { label: 'Point',        hint: 'Click to place' },
  icon_marker:  { label: 'Icon',         hint: 'Click to place' },
  rectangle:    { label: 'Rectangle',    hint: 'Drag to draw' },
  circle:       { label: 'Circle',       hint: 'Drag to draw' },
  polygon:      { label: 'Polygon',      hint: 'Click points, dbl-click finish' },
  cloud:        { label: 'Cloud',        hint: 'Click points, dbl-click finish' },
  arrow:        { label: 'Arrow',        hint: 'Drag to draw' },
  callout:      { label: 'Callout',      hint: 'Click to place' },
  text_box:     { label: 'Text Box',     hint: 'Click to place' },
  highlight:    { label: 'Highlight',    hint: 'Drag to mark' },
  measurement:  { label: 'Measure',      hint: 'Drag to measure' },
  photo_pin:    { label: 'Photo Pin',    hint: 'Click to place + add photos' },
  aerial_lash:  { label: 'Aerial Lash', hint: 'Tap each pole — tap "Finish Aerial Run" when done' },
}

// ── Asset option (the specific item being installed/documented) ───────────────

export interface AssetOption {
  id: string
  label: string
  unit: 'Feet' | 'Each' | 'SqFt'
  isBillable: boolean
  isProductionItem: boolean
  isQCRequired: boolean
  /** Map icon/tool for point drops; overrides category.pointMapTool */
  mapTool?: MarkupTool
  /** Color override for this specific asset; overrides category.color */
  color?: string
  /** MARKUP_COLOR_CODES key to auto-apply when this asset is selected; overrides category.colorCode */
  colorCode?: string
}

// ── Category definition (groups of related assets) ────────────────────────────

export interface CategoryDef {
  id: string
  label: string
  workType: WorkType
  color: string
  /** Which drawing tool types are available for this category */
  drawingTools: DrawingToolType[]
  assets: AssetOption[]
  /** MarkupTool stored when drawing lines / polylines / freehand / highlight / measurement */
  lineMapTool: MarkupTool
  /** Default MarkupTool stored when dropping points (assets can override via mapTool) */
  pointMapTool: MarkupTool
  defaultUnit: 'Feet' | 'Each' | 'SqFt'
  isBillable: boolean
  isProductionItem: boolean
  isQCRequired: boolean
  /** MARKUP_COLOR_CODES key to auto-apply when this category is selected */
  colorCode?: string
}

// ── UNDERGROUND categories ────────────────────────────────────────────────────

const UNDERGROUND_CATEGORIES: CategoryDef[] = [
  {
    id: 'conduit', label: 'Conduit', workType: 'underground',
    color: '#a855f7', colorCode: 'conduit_placed',
    drawingTools: ['multi_line', 'single_line', 'freehand', 'measurement', 'callout', 'text_box', 'photo_pin'],
    lineMapTool: 'underground_conduit', pointMapTool: 'qc_issue',
    defaultUnit: 'Feet', isBillable: true, isProductionItem: true, isQCRequired: false,
    assets: [
      { id: '2in',        label: '2" Conduit',   unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false },
      { id: '1_25in',     label: '1.25" Conduit',unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false },
      { id: '1in',        label: '1" Conduit',   unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false },
      { id: '3in',        label: '3" Conduit',   unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false },
      { id: '4in',        label: '4" Conduit',   unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false },
      { id: 'innerduct',  label: 'Innerduct',    unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false },
      { id: 'microduct',  label: 'Microduct',    unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false },
      { id: 'mule_tape',  label: 'Mule Tape',    unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false },
      { id: 'tracer_wire',label: 'Tracer Wire',  unit: 'Feet', isBillable: true,  isProductionItem: false, isQCRequired: false },
    ],
  },
  {
    id: 'bore_trench', label: 'Bore / Trench', workType: 'underground',
    color: '#3b82f6', colorCode: 'buried_cable',
    drawingTools: ['multi_line', 'single_line', 'freehand', 'polygon', 'highlight', 'measurement', 'callout', 'photo_pin'],
    lineMapTool: 'bore_pit', pointMapTool: 'qc_issue',
    defaultUnit: 'Feet', isBillable: true, isProductionItem: true, isQCRequired: true,
    assets: [
      { id: 'dir_bore',       label: 'Directional Bore',   unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: true  },
      { id: 'open_trench',    label: 'Open Trench',        unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: true  },
      { id: 'rock_bore',      label: 'Rock Bore',          unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: true  },
      { id: 'road_bore',      label: 'Road Bore',          unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: true  },
      { id: 'driveway_bore',  label: 'Driveway Bore',      unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false },
      { id: 'sidewalk_bore',  label: 'Sidewalk Bore',      unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false },
      { id: 'creek_crossing', label: 'Creek Crossing',     unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: true  },
      { id: 'rail_crossing',  label: 'Railroad Crossing',  unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: true  },
    ],
  },
  {
    id: 'structures', label: 'Structures', workType: 'underground',
    color: '#f59e0b',
    drawingTools: ['point_marker', 'icon_marker', 'rectangle', 'circle', 'polygon', 'callout', 'text_box', 'photo_pin'],
    lineMapTool: 'underground_conduit', pointMapTool: 'handhole',
    defaultUnit: 'Each', isBillable: true, isProductionItem: true, isQCRequired: false,
    assets: [
      { id: 'handhole',  label: 'Handhole',   unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'handhole' },
      { id: 'vault',     label: 'Vault',      unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'vault' },
      { id: 'pedestal',  label: 'Pedestal',   unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'pedestal' },
      { id: 'cabinet',   label: 'Cabinet',    unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'cabinet' },
      { id: 'pull_box',  label: 'Pull Box',   unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'handhole' },
      { id: 'ground_box',label: 'Ground Box', unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'handhole' },
    ],
  },
  {
    id: 'utilities', label: 'Utilities', workType: 'underground',
    color: '#ef4444',
    drawingTools: ['multi_line', 'single_line', 'point_marker', 'icon_marker', 'highlight', 'callout', 'text_box', 'photo_pin'],
    lineMapTool: 'underground_conduit', pointMapTool: 'qc_issue',
    defaultUnit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: true,
    assets: [
      { id: 'gas',       label: 'Gas Conflict',      unit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: true,  mapTool: 'qc_issue', color: '#f97316' },
      { id: 'water',     label: 'Water Conflict',    unit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: true,  mapTool: 'qc_issue', color: '#0ea5e9' },
      { id: 'sewer',     label: 'Sewer Conflict',    unit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: true,  mapTool: 'qc_issue', color: '#78350f' },
      { id: 'electric',  label: 'Electric Conflict', unit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: true,  mapTool: 'qc_issue', color: '#facc15' },
      { id: 'catv',      label: 'CATV Conflict',     unit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: true,  mapTool: 'qc_issue', color: '#a855f7' },
      { id: 'ex_fiber',  label: 'Existing Fiber',    unit: 'Feet', isBillable: false, isProductionItem: false, isQCRequired: false, mapTool: 'qc_issue', color: '#4ade80' },
      { id: 'unk_util',  label: 'Unknown Utility',   unit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: true,  mapTool: 'qc_issue' },
    ],
  },
  {
    id: 'restoration', label: 'Restoration', workType: 'underground',
    color: '#86efac',
    drawingTools: ['rectangle', 'circle', 'polygon', 'cloud', 'highlight', 'freehand', 'callout', 'text_box', 'photo_pin'],
    lineMapTool: 'restoration', pointMapTool: 'asphalt',
    defaultUnit: 'SqFt', isBillable: true, isProductionItem: true, isQCRequired: false,
    assets: [
      { id: 'seed_straw',    label: 'Seed & Straw',       unit: 'SqFt', isBillable: true,  isProductionItem: true,  isQCRequired: false, color: '#86efac' },
      { id: 'sod',           label: 'Sod',                unit: 'SqFt', isBillable: true,  isProductionItem: true,  isQCRequired: false, color: '#4ade80' },
      { id: 'asphalt',       label: 'Asphalt Patch',      unit: 'SqFt', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'asphalt', color: '#374151' },
      { id: 'concrete',      label: 'Concrete Patch',     unit: 'SqFt', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'concrete', color: '#94a3b8' },
      { id: 'gravel',        label: 'Gravel Patch',       unit: 'SqFt', isBillable: true,  isProductionItem: true,  isQCRequired: false },
      { id: 'yard_repair',   label: 'Yard Repair',        unit: 'SqFt', isBillable: true,  isProductionItem: true,  isQCRequired: false },
      { id: 'swk_repair',    label: 'Sidewalk Repair',    unit: 'SqFt', isBillable: true,  isProductionItem: true,  isQCRequired: false },
      { id: 'dwy_repair',    label: 'Driveway Repair',    unit: 'SqFt', isBillable: true,  isProductionItem: true,  isQCRequired: false },
    ],
  },
]

// ── AERIAL categories ─────────────────────────────────────────────────────────

const AERIAL_CATEGORIES: CategoryDef[] = [
  {
    id: 'strand', label: 'Strand', workType: 'aerial',
    color: '#06b6d4', colorCode: 'strand',
    drawingTools: ['multi_line', 'single_line', 'freehand', 'measurement', 'callout', 'text_box', 'photo_pin'],
    lineMapTool: 'aerial_cable', pointMapTool: 'pole',
    defaultUnit: 'Feet', isBillable: true, isProductionItem: true, isQCRequired: false,
    assets: [
      { id: 'new_strand',      label: 'New Strand',      unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false, color: '#06b6d4', colorCode: 'strand' },
      { id: 'existing_strand', label: 'Existing Strand', unit: 'Feet', isBillable: false, isProductionItem: false, isQCRequired: false, color: '#0284c7', colorCode: 'strand' },
      { id: 'remove_strand',   label: 'Remove Strand',   unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false, color: '#ef4444', colorCode: 'strand' },
      { id: 'overlash_strand', label: 'Overlash Strand', unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false, colorCode: 'backbone_fiber_overlash' },
      { id: 'guy_strand',      label: 'Guy Strand',      unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false, color: '#78350f' },
    ],
  },
  {
    id: 'fiber', label: 'Fiber', workType: 'aerial',
    color: '#22c55e', colorCode: 'lash_aerial',
    drawingTools: ['multi_line', 'single_line', 'freehand', 'callout', 'text_box', 'photo_pin'],
    lineMapTool: 'fiber_pull', pointMapTool: 'dtap',
    defaultUnit: 'Feet', isBillable: true, isProductionItem: true, isQCRequired: false,
    assets: [
      { id: 'lash_fiber',  label: 'Lash Fiber',      unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false, color: '#22c55e', colorCode: 'lash_aerial' },
      { id: 'adss',        label: 'ADSS Fiber',      unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false, color: '#4ade80', colorCode: 'backbone_fiber_overlash' },
      { id: 'msg_fiber',   label: 'Messenger Fiber', unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false, colorCode: 'lash_aerial' },
      { id: 'slack_loop',  label: 'Slack Loop',      unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'slack_loop', color: '#86efac' },
      { id: 'fiber_riser', label: 'Fiber Riser',     unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'dtap' },
    ],
  },
  {
    id: 'poles', label: 'Poles', workType: 'aerial',
    color: '#92400e',
    drawingTools: ['point_marker', 'icon_marker', 'circle', 'callout', 'text_box', 'photo_pin'],
    lineMapTool: 'aerial_cable', pointMapTool: 'pole',
    defaultUnit: 'Each', isBillable: true, isProductionItem: true, isQCRequired: false,
    assets: [
      { id: 'ex_pole',      label: 'Existing Pole',     unit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: false, mapTool: 'pole', color: '#78350f' },
      { id: 'new_pole',     label: 'New Pole',          unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'pole', color: '#16a34a' },
      { id: 'transfer',     label: 'Transfer Pole',     unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'pole', color: '#f59e0b' },
      { id: 'replacement',  label: 'Replacement Pole',  unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: true,  mapTool: 'pole', color: '#ef4444' },
      { id: 'anchor',       label: 'Anchor Pole',       unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'pole' },
      { id: 'make_ready',   label: 'Make Ready',        unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: true,  mapTool: 'dtap', color: '#a855f7' },
    ],
  },
  {
    id: 'hardware', label: 'Hardware', workType: 'aerial',
    color: '#60a5fa',
    drawingTools: ['point_marker', 'icon_marker', 'arrow', 'callout', 'text_box', 'photo_pin'],
    lineMapTool: 'aerial_cable', pointMapTool: 'dtap',
    defaultUnit: 'Each', isBillable: true, isProductionItem: true, isQCRequired: false,
    assets: [
      { id: 'down_guy',      label: 'Down Guy',      unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'dtap' },
      { id: 'guy_wire',      label: 'Guy Wire',      unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'dtap' },
      { id: 'riser_guard',   label: 'Riser Guard',   unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'dtap' },
      { id: 'snow_shoe',     label: 'Snow Shoe',     unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'slack_loop', color: '#e2e8f0' },
      { id: 'terminal',      label: 'Terminal',      unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'dtap' },
      { id: 'pole_bracket',  label: 'Pole Bracket',  unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'dtap' },
      { id: 'j_hook',        label: 'J-Hook',        unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'dtap' },
      { id: 'anchor',        label: 'Anchor',        unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'dtap' },
    ],
  },
  {
    id: 'aerial_lash_fiber', label: 'Aerial Lash Fiber', workType: 'aerial',
    color: '#a7dce8', colorCode: 'lash_aerial',
    drawingTools: ['aerial_lash'],
    lineMapTool: 'fiber_pull', pointMapTool: 'pole',
    defaultUnit: 'Feet', isBillable: true, isProductionItem: true, isQCRequired: false,
    assets: [
      { id: 'lash_fiber_run', label: 'Lash Fiber Run', unit: 'Feet', isBillable: true, isProductionItem: true, isQCRequired: false, colorCode: 'lash_aerial' },
    ],
  },
  {
    id: 'crossings', label: 'Crossings', workType: 'aerial',
    color: '#ef4444',
    drawingTools: ['multi_line', 'single_line', 'rectangle', 'polygon', 'highlight', 'arrow', 'callout', 'photo_pin'],
    lineMapTool: 'aerial_cable', pointMapTool: 'dtap',
    defaultUnit: 'Each', isBillable: true, isProductionItem: true, isQCRequired: true,
    assets: [
      { id: 'road',     label: 'Road Crossing',      unit: 'Each', isBillable: true, isProductionItem: true, isQCRequired: true,  color: '#ef4444' },
      { id: 'rail',     label: 'Railroad Crossing',  unit: 'Each', isBillable: true, isProductionItem: true, isQCRequired: true,  color: '#f97316' },
      { id: 'creek',    label: 'Creek Crossing',     unit: 'Each', isBillable: true, isProductionItem: true, isQCRequired: true,  color: '#0ea5e9' },
      { id: 'power',    label: 'Power Crossing',     unit: 'Each', isBillable: true, isProductionItem: true, isQCRequired: true,  color: '#facc15' },
    ],
  },
]

// ── SPLICING categories ───────────────────────────────────────────────────────

const SPLICING_CATEGORIES: CategoryDef[] = [
  {
    id: 'closures', label: 'Closures', workType: 'splicing',
    color: '#10b981',
    drawingTools: ['point_marker', 'icon_marker', 'circle', 'rectangle', 'callout', 'text_box', 'photo_pin'],
    lineMapTool: 'fiber_pull', pointMapTool: 'splice_point',
    defaultUnit: 'Each', isBillable: true, isProductionItem: true, isQCRequired: true,
    assets: [
      { id: 'splice_closure', label: 'Splice Closure',  unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: true,  mapTool: 'splice_point', color: '#10b981' },
      { id: 'mst',            label: 'MST',             unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'dtap',         color: '#f59e0b', colorCode: 'mst_aerial' },
      { id: 'terminal',       label: 'Terminal',        unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'dtap',         color: '#3b82f6' },
      { id: 'hub',            label: 'Hub',             unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'cabinet',      color: '#8b5cf6' },
      { id: 'cabinet',        label: 'Cabinet',         unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'cabinet',      color: '#6366f1' },
      { id: 'hh_splice',      label: 'Handhole Splice', unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'handhole' },
    ],
  },
  {
    id: 'fiber_work', label: 'Fiber Work', workType: 'splicing',
    color: '#4ade80', colorCode: 'cable_pulled_in',
    drawingTools: ['multi_line', 'single_line', 'point_marker', 'icon_marker', 'callout', 'text_box', 'photo_pin'],
    lineMapTool: 'fiber_pull', pointMapTool: 'completed_work',
    defaultUnit: 'Each', isBillable: true, isProductionItem: true, isQCRequired: false,
    assets: [
      { id: 'splice_done',    label: 'Splice Complete',    unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: false, mapTool: 'completed_work', color: '#22c55e' },
      { id: 'splice_pending', label: 'Splice Pending',     unit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: false, mapTool: 'hold',           color: '#f59e0b' },
      { id: 'resplice',       label: 'Re-Splice',          unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: true,  mapTool: 'qc_issue',       color: '#ef4444' },
      { id: 'fiber_slack',    label: 'Fiber Slack',        unit: 'Feet', isBillable: false, isProductionItem: false, isQCRequired: false, color: '#86efac' },
      { id: 'buffer_tube',    label: 'Buffer Tube',        unit: 'Feet', isBillable: false, isProductionItem: false, isQCRequired: false },
      { id: 'fiber_count',    label: 'Fiber Count',        unit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: false, mapTool: 'dtap' },
    ],
  },
  {
    id: 'drops', label: 'Drops', workType: 'splicing',
    color: '#22d3ee',
    drawingTools: ['multi_line', 'single_line', 'point_marker', 'icon_marker', 'callout', 'text_box', 'photo_pin'],
    lineMapTool: 'fiber_pull', pointMapTool: 'dtap',
    defaultUnit: 'Feet', isBillable: true, isProductionItem: true, isQCRequired: false,
    assets: [
      { id: 'service_drop',  label: 'Service Drop',    unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false, color: '#4ade80' },
      { id: 'customer_drop', label: 'Customer Drop',   unit: 'Feet', isBillable: true,  isProductionItem: true,  isQCRequired: false, color: '#22d3ee' },
      { id: 'drop_done',     label: 'Drop Complete',   unit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: false, mapTool: 'completed_work', color: '#22c55e' },
      { id: 'drop_pending',  label: 'Drop Pending',    unit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: false, mapTool: 'hold',           color: '#f59e0b' },
    ],
  },
  {
    id: 'testing', label: 'Testing', workType: 'splicing',
    color: '#f59e0b',
    drawingTools: ['point_marker', 'icon_marker', 'callout', 'text_box', 'photo_pin'],
    lineMapTool: 'fiber_pull', pointMapTool: 'completed_work',
    defaultUnit: 'Each', isBillable: true, isProductionItem: true, isQCRequired: true,
    assets: [
      { id: 'otdr_test',    label: 'OTDR Test',     unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: true,  mapTool: 'dtap',           color: '#06b6d4' },
      { id: 'light_test',   label: 'Light Test',    unit: 'Each', isBillable: true,  isProductionItem: true,  isQCRequired: true,  mapTool: 'dtap',           color: '#60a5fa' },
      { id: 'power_reading',label: 'Power Reading', unit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: true,  mapTool: 'dtap',           color: '#a78bfa' },
      { id: 'passed',       label: 'Passed Test',   unit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: false, mapTool: 'completed_work', color: '#22c55e' },
      { id: 'failed',       label: 'Failed Test',   unit: 'Each', isBillable: false, isProductionItem: false, isQCRequired: true,  mapTool: 'qc_issue',       color: '#ef4444' },
    ],
  },
]

// ── Exports ───────────────────────────────────────────────────────────────────

export const CATEGORIES_BY_WORK_TYPE: Record<Exclude<WorkType, 'general'>, CategoryDef[]> = {
  underground: UNDERGROUND_CATEGORIES,
  aerial:      AERIAL_CATEGORIES,
  splicing:    SPLICING_CATEGORIES,
}

export const WORK_TYPE_META: Record<WorkType, { label: string; description: string; color: string }> = {
  underground: { label: 'Underground',   description: 'Conduit, bore, structures',  color: '#a855f7' },
  aerial:      { label: 'Aerial',        description: 'Strand, fiber, poles',       color: '#06b6d4' },
  splicing:    { label: 'Splicing',      description: 'Closures, fiber, testing',   color: '#10b981' },
  general:     { label: 'General Notes', description: 'Arrows, text, callouts',     color: '#f59e0b' },
}

/** Field map color legend — standard stroke colors by fiber construction work type. */
export const MARKUP_COLOR_CODES: Record<string, { label: string; color: string }> = {
  backbone_fiber_overlash: { label: 'Backbone Fiber / Overlash', color: '#ff6f8f' },
  strand:                  { label: 'Strand',                    color: '#39ff4a' },
  conduit_placed:          { label: 'Conduit Placed',            color: '#d8cfae' },
  mst_aerial:              { label: 'MST Aerial',                color: '#6bb7d6' },
  mst_conduit:             { label: 'MST Conduit',               color: '#ff0000' },
  buried_cable:            { label: 'Buried Cable',              color: '#ffd21f' },
  cable_pulled_in:         { label: 'Cable Pulled In',           color: '#b45ad6' },
  lash_aerial:             { label: 'Lash Aerial',               color: '#a7dce8' },
}

/** Which color codes are relevant for each work type — limits the color strip to context-appropriate presets. */
export const WORK_TYPE_COLOR_CODES: Record<Exclude<WorkType, 'general'>, string[]> = {
  underground: ['conduit_placed', 'buried_cable', 'mst_conduit', 'cable_pulled_in'],
  aerial:      ['strand', 'backbone_fiber_overlash', 'lash_aerial', 'mst_aerial'],
  splicing:    ['cable_pulled_in', 'lash_aerial', 'mst_aerial', 'backbone_fiber_overlash'],
}
