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
  Box, Milestone, Anchor, Scissors, Sprout, ShieldCheck, AlertTriangle, FileWarning,
} from 'lucide-react'
import type { MarkupTool, MarkupStatus, WorkObjectTypeId, PhotoProofType } from '../types'
import type { FieldMapDrawTool } from '../components/FieldMapToolbar'

export type { WorkObjectTypeId, PhotoProofType }

export type DefaultGeometryKind = 'point' | 'line' | 'polygon'

export interface WorkObjectTypeDef {
  id: WorkObjectTypeId
  label: string
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
    id: 'aerial_strand', label: 'Aerial Strand', icon: Cable,
    defaultColor: '#06b6d4', defaultGeometry: 'line', defaultMarkupTool: 'new_strand',
    defaultUnit: 'Feet', billingKeywords: ['strand', 'aerial'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Strand tension correct', 'Attachment height correct', 'Clearance from other utilities'],
  },
  {
    id: 'directional_drill', label: 'Directional Drill', icon: Drill,
    defaultColor: '#3b82f6', defaultGeometry: 'line', defaultMarkupTool: 'directional_bore',
    defaultUnit: 'Feet', billingKeywords: ['bore', 'directional', 'hdd', 'drill'],
    requiredPhotoPhases: ['before', 'depth_proof', 'after'], requiresNotes: true, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Bore depth correct', 'No utility strikes', 'Conduit continuity verified'],
  },
  {
    id: 'distribution_fiber', label: 'Distribution Fiber', icon: GitBranch,
    defaultColor: '#22c55e', defaultGeometry: 'line', defaultMarkupTool: 'fiber_pull',
    defaultUnit: 'Feet', billingKeywords: ['fiber', 'distribution', 'duct'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Fiber count correct', 'No visible damage', 'Proper slack maintained'],
  },
  {
    id: 'feeder_fiber', label: 'Feeder Fiber', icon: Waypoints,
    defaultColor: '#4ade80', defaultGeometry: 'line', defaultMarkupTool: 'fiber_pull',
    defaultUnit: 'Feet', billingKeywords: ['fiber', 'feeder', 'trunk'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Fiber count correct', 'Splice points documented', 'Proper slack maintained'],
  },
  {
    id: 'drop', label: 'Drop', icon: Home,
    defaultColor: '#22d3ee', defaultGeometry: 'line', defaultMarkupTool: 'fiber_pull',
    defaultUnit: 'Feet', billingKeywords: ['drop', 'service'],
    requiredPhotoPhases: ['after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Drop routed correctly', 'Weatherproofing sealed', 'Customer premise entry secure'],
  },
  {
    id: 'plowing', label: 'Plowing', icon: Tractor,
    defaultColor: '#a855f7', defaultGeometry: 'line', defaultMarkupTool: 'underground_conduit',
    defaultUnit: 'Feet', billingKeywords: ['plow'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Depth correct', 'No utility strikes', 'Surface restored'],
  },
  {
    id: 'sub_ducting', label: 'Sub-Ducting', icon: Layers,
    defaultColor: '#a855f7', defaultGeometry: 'line', defaultMarkupTool: 'underground_conduit',
    defaultUnit: 'Feet', billingKeywords: ['duct', 'innerduct', 'microduct'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Duct size correct', 'Couplings sealed', 'Tracer wire continuous'],
  },
  {
    id: 'trenching', label: 'Trenching', icon: Shovel,
    defaultColor: '#3b82f6', defaultGeometry: 'line', defaultMarkupTool: 'bore_pit',
    defaultUnit: 'Feet', billingKeywords: ['trench', 'open trench'],
    requiredPhotoPhases: ['before', 'depth_proof', 'after'], requiresNotes: true, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Depth correct', 'Bedding/backfill proper', 'No utility strikes'],
  },
  {
    id: 'handhole_vault', label: 'Handhole / Vault', icon: Box,
    defaultColor: '#f59e0b', defaultGeometry: 'point', defaultMarkupTool: 'proposed_handhole',
    defaultUnit: 'Each', billingKeywords: ['vault', 'handhole', 'pedestal', 'cabinet'],
    requiredPhotoPhases: ['handhole_proof'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Depth correct', 'Lid seated', 'Grounding present'],
  },
  {
    id: 'pole', label: 'Pole', icon: Milestone,
    defaultColor: '#92400e', defaultGeometry: 'point', defaultMarkupTool: 'pole',
    defaultUnit: 'Each', billingKeywords: ['pole'],
    requiredPhotoPhases: ['pole_anchor_proof'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Pole plumb', 'Attachment hardware secure', 'Grounding present'],
  },
  {
    id: 'anchor_down_guy', label: 'Anchor / Down Guy', icon: Anchor,
    defaultColor: '#60a5fa', defaultGeometry: 'point', defaultMarkupTool: 'dtap',
    defaultUnit: 'Each', billingKeywords: ['anchor', 'guy'],
    requiredPhotoPhases: ['pole_anchor_proof'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Guy tension correct', 'Anchor set to spec', 'Guy guard installed'],
  },
  {
    id: 'splicing', label: 'Splicing', icon: Scissors,
    defaultColor: '#10b981', defaultGeometry: 'point', defaultMarkupTool: 'splice_point',
    defaultUnit: 'Each', billingKeywords: ['splice', 'closure'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: true, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Splice loss within spec', 'Enclosure sealed', 'Slack stored properly'],
  },
  {
    id: 'restoration', label: 'Restoration', icon: Sprout,
    defaultColor: '#86efac', defaultGeometry: 'polygon', defaultMarkupTool: 'restoration',
    defaultUnit: 'SqFt', billingKeywords: ['restoration', 'seed', 'sod', 'asphalt', 'concrete'],
    requiredPhotoPhases: ['before', 'restoration_proof', 'after'], requiresNotes: false, allowedStatuses: FULL_STATUSES,
    inspectionTemplate: ['Surface level with surroundings', 'Vegetation/seed applied', 'Site clear of debris'],
  },
  {
    id: 'qa_qc', label: 'QA/QC', icon: ShieldCheck,
    defaultColor: '#a855f7', defaultGeometry: 'point', defaultMarkupTool: 'qc_issue',
    defaultUnit: 'Each', billingKeywords: [],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: true, allowedStatuses: NON_BILLABLE_STATUSES,
    inspectionTemplate: ['Work matches plan', 'Photos documented', 'No open punch items'],
  },
  {
    id: 'utility_conflict', label: 'Utility Conflict', icon: AlertTriangle,
    defaultColor: '#ef4444', defaultGeometry: 'point', defaultMarkupTool: 'qc_issue',
    defaultUnit: 'Each', billingKeywords: [],
    requiredPhotoPhases: ['before'], requiresNotes: true, allowedStatuses: NON_BILLABLE_STATUSES,
    inspectionTemplate: ['Conflict documented', 'Utility owner notified', 'Resolution plan noted'],
  },
  {
    id: 'damage_report', label: 'Damage Report', icon: FileWarning,
    defaultColor: '#ef4444', defaultGeometry: 'point', defaultMarkupTool: 'qc_issue',
    defaultUnit: 'Each', billingKeywords: ['damage', 'repair'],
    requiredPhotoPhases: ['before', 'after'], requiresNotes: true, allowedStatuses: NON_BILLABLE_STATUSES,
    inspectionTemplate: ['Damage documented with photos', 'Utility owner notified', 'Repair scheduled'],
  },
]

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
}

export function relevantToolsForWorkType(typeId: WorkObjectTypeId): FieldMapDrawTool[] {
  const override = RELEVANT_TOOLS_OVERRIDE[typeId]
  if (override) return override
  const type = WORK_OBJECT_TYPE_MAP[typeId]
  if (type?.defaultGeometry === 'point') return POINT_TYPE_TOOLS
  return LINE_TYPE_TOOLS
}
