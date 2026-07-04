// ---------------------------------------------------------------------------
// Map Reading's own OCR-based detection vocabulary — a new module, not an
// extension of src/lib/ocrWorkObjectDetect.ts (that file's 4-char minimum
// word length and Work-Object-catalog keyword list don't fit short tokens
// like "FE1"/"#1"/"245'"). Follows the SAME proven pattern though: real OCR
// pixel positions (never a synthetic grid), pixel-radius dedup, per-type cap.
//
// Honest capability boundary: this only recognizes what's actually printed as
// text on the page. It cannot recognize a colored line or hand-drawn symbol
// with no text label — anything ambiguous (e.g. a fiber count that isn't
// 24/48/96) becomes 'needs_review' rather than a guess.
// ---------------------------------------------------------------------------

import type { OcrWordBox } from '../../features/printkmz/ocr'
import type { MapReadingDetection, MapReadingDetectionType, MapReadingNotes } from '../../types'

const DEDUPE_RADIUS_PX = 40
const MAX_PER_TYPE = 80

const ROAD_SUFFIXES = new Set([
  'ST', 'STREET', 'AVE', 'AVENUE', 'RD', 'ROAD', 'DR', 'DRIVE', 'BLVD',
  'LN', 'LANE', 'CT', 'COURT', 'WAY', 'HWY', 'HIGHWAY', 'PKWY', 'PL', 'TER', 'TRL', 'CIR',
])

function normWord(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9#'’]/g, '')
}

function ctTypeForCount(n: number): MapReadingDetectionType {
  if (n === 96) return 'construction_96ct'
  if (n === 48) return 'construction_48ct'
  if (n === 24) return 'construction_24ct'
  return 'needs_review'
}

export function detectMapReadingCandidates(words: OcrWordBox[]): MapReadingDetection[] {
  const kept: MapReadingDetection[] = []
  const countByType = new Map<MapReadingDetectionType, number>()

  function tryAdd(type: MapReadingDetectionType, text: string, box: { x0: number; y0: number; x1: number; y1: number }) {
    const used = countByType.get(type) ?? 0
    if (used >= MAX_PER_TYPE) return
    const cx = (box.x0 + box.x1) / 2
    const cy = (box.y0 + box.y1) / 2
    const dupe = kept.some((d) =>
      d.type === type && Math.hypot(d.x + d.width / 2 - cx, d.y + d.height / 2 - cy) < DEDUPE_RADIUS_PX,
    )
    if (dupe) return
    kept.push({
      id: `mrd-${kept.length}-${Date.now().toString(36)}`,
      type, text,
      x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0,
      confirmed: false,
    })
    countByType.set(type, used + 1)
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const raw = w.text.trim()
    const norm = normWord(raw)
    if (!norm) continue

    // --- Single-token regex matches ---
    let m = norm.match(/^FE-?(\d+)$/)
    if (m) { tryAdd('fe_label', raw, w); continue }
    m = norm.match(/^FT-?(\d+)$/)
    if (m) { tryAdd('ft_label', raw, w); continue }
    m = norm.match(/^#(\d+)$/)
    if (m) { tryAdd('run_number', raw, w); continue }
    m = norm.match(/^([\d,]+(?:\.\d+)?)(?:FT|LF|')$/)
    if (m) { tryAdd('footage', raw, w); continue }
    m = norm.match(/^(\d{1,3})CT$/)
    if (m) { tryAdd(ctTypeForCount(Number(m[1])), raw, w); continue }

    // --- Two-word window matches (footage split across tokens, phrases, road names) ---
    const next = words[i + 1]
    if (next) {
      const nNorm = normWord(next.text)
      const box = {
        x0: Math.min(w.x0, next.x0), y0: Math.min(w.y0, next.y0),
        x1: Math.max(w.x1, next.x1), y1: Math.max(w.y1, next.y1),
      }
      const pairText = `${raw} ${next.text}`

      if (/^[\d,]+(?:\.\d+)?$/.test(norm) && /^(FT|FEET|LF)\.?$/.test(nNorm)) { tryAdd('footage', pairText, box); continue }
      if (norm === 'TIE' && nNorm === 'POINT') { tryAdd('tie_point', pairText, box); continue }
      if (norm === 'DEAD' && nNorm === 'END') { tryAdd('dead_end', pairText, box); continue }
      if (norm === 'FIBER' && nNorm === 'ONLY') { tryAdd('fiber_only', pairText, box); continue }
      if (norm === 'STRAND' && nNorm === 'ONLY') { tryAdd('strand_only', pairText, box); continue }
      if (/^\d{1,3}$/.test(norm) && nNorm === 'CT') { tryAdd(ctTypeForCount(Number(norm)), pairText, box); continue }
      if (/^[A-Z0-9.'-]+$/.test(norm) && ROAD_SUFFIXES.has(nNorm)) { tryAdd('road_name', pairText, box); continue }
    }

    // --- Single-word keyword matches ---
    if (norm === 'OLT' || norm === 'MUX') { tryAdd('olt_mux', raw, w); continue }
    if (norm === 'OVERLASH') { tryAdd('overlash', raw, w); continue }
    if (norm === 'COIL' || norm === 'COILS') { tryAdd('coil', raw, w); continue }
    if (norm === 'SNOWSHOE' || norm === 'SNOWSHOES') { tryAdd('snowshoe', raw, w); continue }
    if (norm === 'SPLICE') { tryAdd('splice', raw, w); continue }
    if (norm === 'BRANCH') { tryAdd('branch', raw, w); continue }
    if (norm === 'TOTAL' || norm === 'SUMMARY') { tryAdd('total_summary', raw, w); continue }
  }

  return kept
}

function joinTexts(items: MapReadingDetection[]): string {
  return [...new Set(items.map((d) => d.text.trim()))].join(', ')
}

/** Builds the editable notes template from the page's current detections —
 *  always re-runnable (e.g. after the user bulk-corrects detection types)
 *  without requiring the caller to have "confirmed" anything first; approval
 *  status is tracked separately per detection for review-progress purposes. */
export function summarizeDetections(detections: MapReadingDetection[], pageName: string): MapReadingNotes {
  const byType = (t: MapReadingDetectionType) => detections.filter((d) => d.type === t)
  return {
    pageName,
    strand24ct: joinTexts(byType('construction_24ct')),
    strand48ct: joinTexts(byType('construction_48ct')),
    strand96ct: joinTexts(byType('construction_96ct')),
    overlash: joinTexts(byType('overlash')),
    coils: joinTexts(byType('coil')),
    snowshoes: joinTexts(byType('snowshoe')),
    feLabels: joinTexts(byType('fe_label')),
    ftLabels: joinTexts(byType('ft_label')),
    roadNames: joinTexts(byType('road_name')),
    tiePoint: joinTexts(byType('tie_point')),
    oltMux: joinTexts(byType('olt_mux')),
    needsReview: joinTexts(byType('needs_review')),
  }
}
