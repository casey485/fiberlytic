// ---------------------------------------------------------------------------
// Work Object type catalog — the 16 field-work types selectable in the Add
// Work modal's Step 1 (Field Map).
//
// These are renamed/consolidated from the existing category definitions in
// `constructionTools.ts` (Conduit, Bore/Trench, Structures, Utilities,
// Restoration, Strand, Fiber, Poles, Hardware, Crossings, Closures, Fiber
// Work, Drops) rather than a parallel catalog — the colors, drawing tool,
// and billable/QC defaults below trace back to those categories/assets.
//
// `billingKeywords` are search hints used to prioritize matches in the
// billing step (Step 4) against a project's real `RateCardUnit` catalog —
// they are NOT billing codes themselves (unit codes are client-specific and
// only exist once a project's rate card is loaded).
// ---------------------------------------------------------------------------

import type { LucideIcon } from 'lucide-react'
import {
  Cable, Drill, GitBranch, Waypoints, Home, Tractor, Layers, Shovel,
  Box, Milestone, Anchor, Scissors, Sprout, ShieldCheck, AlertTriangle, FileWarning, Hash,
  Disc, Footprints,
} from 'lucide-react'
import type { MarkupTool, MarkupStatus, WorkObjectTypeId, PhotoProofType } from '../types'
import type { FieldMapDrawTool } from '../components/FieldMapToolbar'

export type { WorkObjectTypeId, PhotoProofType }

export type DefaultGeometryKind = 'point' | 'line' | 'polygon'

export interface WorkObjectTypeDef {
  id: WorkObjectTypeId
  label: string
  /** 3-letter code used to build a human-readable Work ID (e.g. "WO-TRN-014") — hand-picked
   *  per type rather than derived from the label, to avoid collisions/ugly abbreviations. */
  shortCode: string
  icon: LucideIcon
  defaultColor: string
  defaultGeometry: DefaultGeometryKind
  /** Initial drawing tool preselected when this type is chosen (still changeable in the draw step). */
  defaultMarkupTool: MarkupTool
  defaultUnit: 'Feet' | 'Each' | 'SqFt'
  billingKeywords: string[]
  requiredPhotoPhases: PhotoProofType[]
  requiresNotes: boolean
  allowedStatuses: MarkupStatus[]
  /** Default checklist item labels seeding a new Inspection tab entry for this type. */
  inspectionTemplate: string[]
}

const FULL_STATUSES: MarkupStatus[] = ['pending', 'in_progress', 'complete', 'qc_needed', 'rejected', 'approved', 'billed']
const NON_BILLABLE_STATUSES: MarkupStatus[] = ['pending', 'in_progress', 'complete', 'qc_needed', 'rejected']

export const WORK_OBJECT_TYPES: WorkObjectTypeDef[] = [
  {
    id: 'aerial_strand', label: 'Aerial Strand', shortCode: 'AST', icon: Cable,
    defaultColor: '#06b6d4', defaultGeometry: 'line', defaultMarkupTool: 'new_strand',
    defaultUnit: 'Feet', billingKeywords: ['strand', 'aerial'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Strand tension correct', 'Attachment height correct', 'Clearance from other utilities'],
  },
  {
    id: 'directional_drill', label: 'Directional Drill', shortCode: 'DDR', icon: Drill,
    defaultColor: '#3b82f6', defaultGeometry: 'line', defaultMarkupTool: 'directional_bore',
    defaultUnit: 'Feet', billingKeywords: ['bore', 'directional', 'hdd', 'drill'],
    requiredPhotoPhases: ['before', 'depth_proof', 'after'], requiresNotes: true, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Bore depth correct', 'No utility strikes', 'Conduit continuity verified'],
  },
  {
    id: 'distribution_fiber', label: 'Distribution Fiber', shortCode: 'DFB', icon: GitBranch,
    defaultColor: '#22c55e', defaultGeometry: 'line', defaultMarkupTool: 'distribution_fiber_route',
    defaultUnit: 'Feet', billingKeywords: ['fiber', 'distribution', 'duct'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Fiber count correct', 'No visible damage', 'Proper slack maintained'],
  },
  {
    id: 'feeder_fiber', label: 'Feeder Fiber', shortCode: 'FFB', icon: Waypoints,
    defaultColor: '#4ade80', defaultGeometry: 'line', defaultMarkupTool: 'feeder_fiber_route',
    defaultUnit: 'Feet', billingKeywords: ['fiber', 'feeder', 'trunk'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Fiber count correct', 'Splice points documented', 'Proper slack maintained'],
  },
  {
    id: 'drop', label: 'Drop', shortCode: 'DRP', icon: Home,
    defaultColor: '#22d3ee', defaultGeometry: 'line', defaultMarkupTool: 'drop_line',
    defaultUnit: 'Feet', billingKeywords: ['drop', 'service'],
    requiredPhotoPhases: ['after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Drop routed correctly', 'Weatherproofing sealed', 'Customer premise entry secure'],
  },
  {
    id: 'plowing', label: 'Plowing', shortCode: 'PLW', icon: Tractor,
    defaultColor: '#a855f7', defaultGeometry: 'line', defaultMarkupTool: 'plow_route',
    defaultUnit: 'Feet', billingKeywords: ['plow'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Depth correct', 'No utility strikes', 'Surface restored'],
  },
  {
    id: 'sub_ducting', label: 'Sub-Ducting', shortCode: 'SDT', icon: Layers,
    defaultColor: '#a855f7', defaultGeometry: 'line', defaultMarkupTool: 'duct_1way',
    defaultUnit: 'Feet', billingKeywords: ['duct', 'innerduct', 'microduct'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Duct size correct', 'Couplings sealed', 'Tracer wire continuous'],
  },
  {
    id: 'trenching', label: 'Trenching', shortCode: 'TRN', icon: Shovel,
    defaultColor: '#3b82f6', defaultGeometry: 'line', defaultMarkupTool: 'open_trench',
    defaultUnit: 'Feet', billingKeywords: ['trench', 'open trench'],
    requiredPhotoPhases: ['before', 'depth_proof', 'after'], requiresNotes: true, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Depth correct', 'Bedding/backfill proper', 'No utility strikes'],
  },
  {
    id: 'handhole_vault', label: 'Handhole / Vault', shortCode: 'HHV', icon: Box,
    defaultColor: '#f59e0b', defaultGeometry: 'point', defaultMarkupTool: 'proposed_handhole',
    defaultUnit: 'Each', billingKeywords: ['vault', 'handhole', 'pedestal', 'cabinet'],
    requiredPhotoPhases: ['handhole_proof'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Depth correct', 'Lid seated', 'Grounding present'],
  },
  {
    id: 'pole', label: 'Pole', shortCode: 'POL', icon: Milestone,
    defaultColor: '#92400e', defaultGeometry: 'point', defaultMarkupTool: 'new_pole',
    defaultUnit: 'Each', billingKeywords: ['pole'],
    requiredPhotoPhases: ['pole_anchor_proof'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Pole plumb', 'Attachment hardware secure', 'Grounding present'],
  },
  {
    id: 'anchor_down_guy', label: 'Anchor / Down Guy', shortCode: 'ADG', icon: Anchor,
    defaultColor: '#60a5fa', defaultGeometry: 'point', defaultMarkupTool: 'new_anchor',
    defaultUnit: 'Each', billingKeywords: ['anchor', 'guy'],
    requiredPhotoPhases: ['pole_anchor_proof'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Guy tension correct', 'Anchor set to spec', 'Guy guard installed'],
  },
  {
    id: 'splicing', label: 'Splicing', shortCode: 'SPL', icon: Scissors,
    defaultColor: '#10b981', defaultGeometry: 'point', defaultMarkupTool: 'splice_case',
    defaultUnit: 'Each', billingKeywords: ['splice', 'closure'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: true, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Splice loss within spec', 'Enclosure sealed', 'Slack stored properly'],
  },
  {
    id: 'restoration', label: 'Restoration', shortCode: 'RST', icon: Sprout,
    defaultColor: '#86efac', defaultGeometry: 'polygon', defaultMarkupTool: 'restoration',
    defaultUnit: 'SqFt', billingKeywords: ['restoration', 'seed', 'sod', 'asphalt', 'concrete'],
    requiredPhotoPhases: ['before', 'restoration_proof', 'after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Surface level with surroundings', 'Vegetation/seed applied', 'Site clear of debris'],
  },
  {
    id: 'qa_qc', label: 'QA/QC', shortCode: 'QAQ', icon: ShieldCheck,
    defaultColor: '#a855f7', defaultGeometry: 'point', defaultMarkupTool: 'qc_issue',
    defaultUnit: 'Each', billingKeywords: [],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: true, allowedStatuses: NON_BILLABLE_STATUSES,
    inspectionTemplate: ['Work matches plan', 'Photos documented', 'No open punch items'],
  },
  {
    id: 'utility_conflict', label: 'Utility Conflict', shortCode: 'UTC', icon: AlertTriangle,
    defaultColor: '#ef4444', defaultGeometry: 'point', defaultMarkupTool: 'qc_issue',
    defaultUnit: 'Each', billingKeywords: [],
    requiredPhotoPhases: ['before'], requiresNotes: true, allowedStatuses: NON_BILLABLE_STATUSES,
    inspectionTemplate: ['Conflict documented', 'Utility owner notified', 'Resolution plan noted'],
  },
  {
    id: 'damage_report', label: 'Damage Report', shortCode: 'DMG', icon: FileWarning,
    defaultColor: '#ef4444', defaultGeometry: 'point', defaultMarkupTool: 'qc_issue',
    defaultUnit: 'Each', billingKeywords: ['damage', 'repair'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: true, allowedStatuses: NON_BILLABLE_STATUSES,
    inspectionTemplate: ['Damage documented with photos', 'Utility owner notified', 'Repair scheduled'],
  },
  {
    id: 'flower_pot', label: 'Flower Pot', shortCode: 'FPT', icon: Box,
    defaultColor: '#f97316', defaultGeometry: 'point', defaultMarkupTool: 'point',
    defaultUnit: 'Each', billingKeywords: ['flower pot', 'pedestal'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Set flush with grade', 'Lid seated', 'Location matches plan'],
  },
  {
    id: 'tie_in', label: 'Tie-In', shortCode: 'TIE', icon: GitBranch,
    defaultColor: '#eab308', defaultGeometry: 'point', defaultMarkupTool: 'point',
    defaultUnit: 'Each', billingKeywords: ['tie-in', 'tie in', 'splice tie-in'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: true, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Continuity verified', 'Connection documented', 'Enclosure sealed'],
  },
  {
    id: 'riser_guard', label: 'Riser Guard', shortCode: 'RSG', icon: Milestone,
    defaultColor: '#64748b', defaultGeometry: 'point', defaultMarkupTool: 'riser_guard',
    defaultUnit: 'Each', billingKeywords: ['riser guard', 'riser'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Guard secured to pole', 'Height meets spec', 'No visible damage'],
  },
  {
    id: 'road_crossing', label: 'Road Crossing', shortCode: 'RDX', icon: Shovel,
    defaultColor: '#dc2626', defaultGeometry: 'line', defaultMarkupTool: 'line',
    defaultUnit: 'Feet', billingKeywords: ['road crossing', 'road bore'],
    requiredPhotoPhases: ['before', 'depth_proof', 'after'], requiresNotes: true, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Depth correct', 'No utility strikes', 'Surface restored'],
  },
  {
    id: 'sidewalk_crossing', label: 'Sidewalk Crossing', shortCode: 'SWX', icon: Shovel,
    defaultColor: '#f59e0b', defaultGeometry: 'line', defaultMarkupTool: 'line',
    defaultUnit: 'Feet', billingKeywords: ['sidewalk crossing', 'sidewalk bore'],
    requiredPhotoPhases: ['before', 'depth_proof', 'after'], requiresNotes: true, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Depth correct', 'Surface restored', 'ADA compliance maintained'],
  },
  {
    id: 'driveway_crossing', label: 'Driveway Crossing', shortCode: 'DWX', icon: Shovel,
    defaultColor: '#0ea5e9', defaultGeometry: 'line', defaultMarkupTool: 'driveway_crossing',
    defaultUnit: 'Feet', billingKeywords: ['driveway crossing', 'driveway bore'],
    requiredPhotoPhases: ['before', 'depth_proof', 'after'], requiresNotes: true, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Depth correct', 'Surface restored', 'No utility strikes'],
  },
  // ── Sequential map annotations ─────────────────────────────────────────
  // Drop a single point and type a sequence code (e.g. "TM-047") into the
  // Label field — that text is what shows on the map callout, no separate
  // field: see workObjectCallout.ts, which prefers featureName as these
  // types' callout title instead of the usual Work ID/type-label default,
  // and AddWorkTypeGrid.tsx, which surfaces them as instant-draw quick
  // actions (like Non-Billable Item) instead of normal grid cards, since
  // none of them are billable work — see SEQUENTIAL_ANNOTATION_TYPES below.
  {
    id: 'tick_mark', label: 'Fiber Tick Mark', shortCode: 'FTM', icon: Hash,
    defaultColor: '#22c55e', defaultGeometry: 'point', defaultMarkupTool: 'point',
    defaultUnit: 'Each', billingKeywords: ['tick mark', 'fiber tick'],
    requiredPhotoPhases: [], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: [],
  },
  {
    id: 'fiber_loop', label: 'Fiber Loop', shortCode: 'FLP', icon: Disc,
    defaultColor: '#06b6d4', defaultGeometry: 'point', defaultMarkupTool: 'point',
    defaultUnit: 'Each', billingKeywords: ['fiber loop', 'slack loop'],
    requiredPhotoPhases: [], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: [],
  },
  {
    id: 'snow_shoe', label: 'Snow Shoe', shortCode: 'SNS', icon: Footprints,
    defaultColor: '#eab308', defaultGeometry: 'point', defaultMarkupTool: 'point',
    defaultUnit: 'Each', billingKeywords: ['snow shoe', 'snowshoe'],
    requiredPhotoPhases: [], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: [],
  },
  {
    id: 'other', label: 'Other', shortCode: 'OTH', icon: FileWarning,
    defaultColor: '#94a3b8', defaultGeometry: 'point', defaultMarkupTool: 'point',
    defaultUnit: 'Each', billingKeywords: [],
    requiredPhotoPhases: [], requiresNotes: true, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: [],
  },
]

/** Types that are pure "drop a point, type a sequence" map annotations —
 *  never billable, never enter Production/P&L, skip the full Add Work wizard
 *  entirely (see AddWorkTypeGrid.tsx's quick-action buttons and
 *  KmzMap.tsx/PdfPrintMode.tsx's startSequentialAnnotation). Add a new id
 *  here (plus a WORK_OBJECT_TYPES entry above) to extend the family — every
 *  other call site keys off this list instead of a specific id. */
export const SEQUENTIAL_ANNOTATION_TYPES: WorkObjectTypeId[] = ['tick_mark', 'fiber_loop', 'snow_shoe']

export function isSequentialAnnotation(id: WorkObjectTypeId | null | undefined): boolean {
  return !!id && SEQUENTIAL_ANNOTATION_TYPES.includes(id)
}

/** Example text shown in the Sequence field's placeholder — purely cosmetic,
 *  keyed by id so each type can hint at its own numbering convention. */
export const SEQUENCE_PLACEHOLDER: Partial<Record<WorkObjectTypeId, string>> = {
  tick_mark: 'e.g. TM-047',
  fiber_loop: 'e.g. FL-012',
  snow_shoe: 'e.g. SS-005',
}

/** Types that keep their normal Add Work grid button and drawing geometry
 *  (Restoration still draws a polygon, the rest still drop a point) but,
 *  like SEQUENTIAL_ANNOTATION_TYPES above, skip the Photos/Billing/Crew/
 *  Quantity/Status wizard entirely — never billable, never enter Production/
 *  P&L. Instead of a short sequence code, the crew types one free-text
 *  comment (stored in markup.notes) describing what's being marked. */
export const COMMENT_ANNOTATION_TYPES: WorkObjectTypeId[] = ['restoration', 'qa_qc', 'damage_report', 'other', 'anchor_down_guy']

export function isCommentAnnotation(id: WorkObjectTypeId | null | undefined): boolean {
  return !!id && COMMENT_ANNOTATION_TYPES.includes(id)
}

/** True for any Work Type that skips the full Add Work wizard and exposes
 *  just one free-text field (a sequence code or a comment) — the shared gate
 *  used wherever crew/quantity/billing fields must stay hidden or excluded. */
export function isQuickAnnotation(id: WorkObjectTypeId | null | undefined): boolean {
  return isSequentialAnnotation(id) || isCommentAnnotation(id)
}

/** Example text shown in the Comment field's placeholder — purely cosmetic. */
export const COMMENT_PLACEHOLDER: Partial<Record<WorkObjectTypeId, string>> = {
  restoration: 'e.g. Seed and straw applied, 200 sq ft',
  qa_qc: 'e.g. Fiber count mismatch at splice 4',
  damage_report: 'e.g. Hit gas line marker near curb, called before you dig',
  other: 'Describe what this marks',
  anchor_down_guy: 'e.g. Anchor set, guy wire tensioned',
}

export const WORK_OBJECT_TYPE_MAP: Record<WorkObjectTypeId, WorkObjectTypeDef> =
  Object.fromEntries(WORK_OBJECT_TYPES.map((t) => [t.id, t])) as Record<WorkObjectTypeId, WorkObjectTypeDef>

// ---------------------------------------------------------------------------
// Which drawing tools the Field Map toolbar shows once a Work Type is picked
// — curated per type so the crew sees only what's relevant (e.g. Directional
// Drill doesn't need Rectangle/Text/Circle). Everything else is still one
// click away via the toolbar's "More Tools" flyout, never truly hidden.
// ---------------------------------------------------------------------------

const LINE_TYPE_TOOLS: FieldMapDrawTool[] = ['line', 'multi_line', 'pen', 'measure']
const POINT_TYPE_TOOLS: FieldMapDrawTool[] = ['point', 'rect', 'callout']

/** Explicit overrides for types with a distinct tool mix from their geometry-kind default. */
const RELEVANT_TOOLS_OVERRIDE: Partial<Record<WorkObjectTypeId, FieldMapDrawTool[]>> = {
  restoration: ['polygon', 'rect', 'pen', 'measure'],

  // Engineering symbol catalog (src/lib/engineeringSymbols.ts) — Phase 1 pilot
  // categories. The other Work Types below keep the generic geometry-kind
  // defaults until they're migrated the same way.
  directional_drill: [
    'directional_bore', 'road_bore', 'railroad_bore', 'bridge_bore',
    'bore_start', 'bore_end', 'conduit_run', 'direction_arrow',
    'riser', 'handhole_connection', 'callout',
  ],
  aerial_strand: [
    'new_strand', 'existing_strand', 'pole_attachment', 'dead_end',
    'slack_loop', 'anchor', 'guy_attachment', 'riser_guard', 'pole_marker',
    'direction_arrow', 'callout',
  ],
  handhole_vault: [
    'hh17', 'hh24', 'hh30', 'hh36', 'vault', 'existing_handhole', 'proposed_handhole',
    'concrete_pad', 'lid_label', 'storage_loop', 'conduit_entry', 'callout',
  ],
  distribution_fiber: [
    'distribution_fiber_route', 'direction_arrow', 'fiber_tick_marks',
    'slack_storage', 'fiber_label', 'callout',
  ],
  feeder_fiber: [
    'feeder_fiber_route', 'direction_arrow', 'fiber_count_label', 'slack_loop', 'callout',
  ],
  drop: [
    'drop_line', 'house_drop', 'service_point', 'ont_location', 'direction_arrow', 'callout',
  ],
  pole: [
    'existing_pole', 'new_pole', 'pole_number', 'riser', 'transformer',
    'street_light', 'comm_attachment', 'anchor_attachment', 'callout',
  ],
  anchor_down_guy: [
    'anchor', 'existing_anchor', 'new_anchor', 'down_guy',
    'sidewalk_guy', 'stub_pole_guy', 'anchor_label',
  ],
  splicing: [
    'splice_case', 'mst', 'terminal', 'closure', 'slack_loop', 'fiber_storage', 'splice_label',
  ],
  trenching: [
    'open_trench', 'road_cut', 'driveway_crossing', 'concrete_cut',
    'saw_cut', 'direction_arrow', 'callout',
  ],
  plowing: [
    'plow_route', 'direction_arrow', 'depth_marker', 'callout',
  ],
  sub_ducting: [
    'duct_1way', 'duct_2way', 'duct_3way', 'duct_4way', 'innerduct', 'direction_arrow', 'callout',
  ],
  riser_guard: ['riser_guard', 'callout'],
  driveway_crossing: ['driveway_crossing', 'callout'],
}

export function relevantToolsForWorkType(typeId: WorkObjectTypeId): FieldMapDrawTool[] {
  const override = RELEVANT_TOOLS_OVERRIDE[typeId]
  if (override) return override
  const type = WORK_OBJECT_TYPE_MAP[typeId]
  if (type?.defaultGeometry === 'point') return POINT_TYPE_TOOLS
  return LINE_TYPE_TOOLS
}
