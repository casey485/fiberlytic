/** Fixed 10-color palette for Map Cuts' Phase 1-10 strip — shared by the
 *  phase buttons themselves, both editors' ghost-rendering of other phases,
 *  and any future phase-labeled UI (e.g. ProjectDetail.tsx's grouped Project
 *  Files table). Deliberately a plain indexed array, not tied to any other
 *  color system in the app, since phase colors only need to be distinct from
 *  each other within one session. */
export const PHASE_COLORS = [
  '#22c55e', // 1 green
  '#3b82f6', // 2 blue
  '#f97316', // 3 orange
  '#a855f7', // 4 purple
  '#ec4899', // 5 pink
  '#eab308', // 6 yellow
  '#14b8a6', // 7 teal
  '#ef4444', // 8 red
  '#6366f1', // 9 indigo
  '#84cc16', // 10 lime
] as const

/** 1-based phase number -> its color. Falls back to the first color for an
 *  out-of-range or unset phase number rather than throwing. */
export function phaseColor(phaseNumber: number | undefined | null): string {
  const n = phaseNumber ?? 1
  return PHASE_COLORS[((n - 1) % PHASE_COLORS.length + PHASE_COLORS.length) % PHASE_COLORS.length]
}
