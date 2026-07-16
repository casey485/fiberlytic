import type { FiberColorCode, FiberSpliceStatus } from '../types'

/** The standard 12-color tube/fiber sequence used throughout real splicing
 *  paperwork — fiber N's default tube is SEQUENCE[floor((N-1)/12) % 12] and
 *  its default fiber color is SEQUENCE[(N-1) % 12], repeating for up to 288
 *  fibers (12 tubes x 12 fibers/tube). */
export const FIBER_COLOR_SEQUENCE: FiberColorCode[] = [
  'blue', 'orange', 'green', 'brown', 'slate', 'white',
  'red', 'black', 'yellow', 'violet', 'rose', 'aqua',
]

export const FIBER_COLOR_META: Record<FiberColorCode, { label: string; swatch: string }> = {
  blue:   { label: 'Blue',   swatch: '#2563eb' },
  orange: { label: 'Orange', swatch: '#f97316' },
  green:  { label: 'Green',  swatch: '#16a34a' },
  brown:  { label: 'Brown',  swatch: '#78350f' },
  slate:  { label: 'Slate',  swatch: '#64748b' },
  white:  { label: 'White',  swatch: '#f8fafc' },
  red:    { label: 'Red',    swatch: '#dc2626' },
  black:  { label: 'Black',  swatch: '#0f172a' },
  yellow: { label: 'Yellow', swatch: '#eab308' },
  violet: { label: 'Violet', swatch: '#7c3aed' },
  rose:   { label: 'Rose',   swatch: '#e11d48' },
  aqua:   { label: 'Aqua',   swatch: '#06b6d4' },
}

export const FIBER_STATUS_OPTIONS: FiberSpliceStatus[] = [
  'spliced', 'pass_through', 'express', 'splitter', 'reserved', 'dead_fiber', 'slack',
]

export const FIBER_STATUS_LABELS: Record<FiberSpliceStatus, string> = {
  spliced: 'Spliced',
  pass_through: 'Pass Through',
  express: 'Express',
  splitter: 'Splitter',
  reserved: 'Reserved',
  dead_fiber: 'Dead Fiber',
  slack: 'Slack',
}

/** The standard tube/fiber color pair for a given 1-864 fiber number, per the
 *  repeating 12x12 pattern. Used only to pre-fill a sensible default when a
 *  tech adds a new fiber row by number — both colors stay fully editable,
 *  since real enclosures occasionally show non-standard pairings. */
export function defaultColorsForFiberNumber(n: number): { tubeColor: FiberColorCode; fiberColor: FiberColorCode } {
  const idx = Math.max(1, Math.round(n)) - 1
  return {
    tubeColor: FIBER_COLOR_SEQUENCE[Math.floor(idx / 12) % 12],
    fiberColor: FIBER_COLOR_SEQUENCE[idx % 12],
  }
}
