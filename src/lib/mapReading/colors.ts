import type { MapReadingDetectionType } from '../../types'

/** The color-highlight system per the latest exact mapping given: 24ct=red,
 *  48ct=green, 96ct=blue, footage=yellow, slack loops (coil)=purple,
 *  splice=orange, FE=teal, FT=gold, road names=gray. Categories outside that
 *  list keep their prior colors rather than being reset to gray — this update
 *  only refines the categories the user gave new explicit colors for.
 *  `needs_review` gets its own distinct color (not part of either list)
 *  since it must be visually distinguishable from every real category. */
export const MAP_READING_COLORS: Record<MapReadingDetectionType, string> = {
  construction_24ct: '#ef4444', // red
  construction_48ct: '#22c55e', // green
  construction_96ct: '#3b82f6', // blue
  footage: '#eab308', // yellow
  coil: '#a855f7', // purple — slack loop
  splice: '#f97316', // orange
  fe_label: '#14b8a6', // teal — FE equipment
  ft_label: '#ca8a04', // gold — FT terminal (distinct shade from footage's yellow)
  road_name: '#9ca3af', // gray
  overlash: '#f59e0b', // unchanged — yellow/orange, not covered by the new list
  tie_point: '#fb923c', // unchanged — orange, "splice/tie-in/OLT areas" from the original spec
  olt_mux: '#fb923c', // unchanged — orange
  needs_review: '#ec4899', // magenta/pink — distinct review color
  fiber_only: '#9ca3af', // gray (default, not specified)
  strand_only: '#9ca3af', // gray (default, not specified)
  snowshoe: '#a855f7', // same family as coil — also a loop/hardware shape, not specified separately
  branch: '#9ca3af', // gray (default, not specified)
  dead_end: '#9ca3af', // gray (default, not specified)
  run_number: '#9ca3af', // gray (default, not specified)
  total_summary: '#9ca3af', // gray (default, not specified)
}

export const MAP_READING_TYPE_LABELS: Record<MapReadingDetectionType, string> = {
  tie_point: 'Tie Point',
  olt_mux: 'OLT/MUX',
  fe_label: 'FE Label',
  ft_label: 'FT Label',
  construction_24ct: 'Strand + Fiber 24ct',
  construction_48ct: 'Strand + Fiber 48ct',
  construction_96ct: 'Strand + Fiber 96ct',
  overlash: 'Overlash Fiber',
  fiber_only: 'Fiber Only',
  strand_only: 'Strand Only',
  footage: 'Footage',
  coil: 'Coil',
  snowshoe: 'Snowshoe',
  splice: 'Splice Area',
  branch: 'Branch',
  dead_end: 'Dead End',
  road_name: 'Road Name',
  run_number: 'Run Number',
  total_summary: 'Total Summary',
  needs_review: 'Needs Review',
}
