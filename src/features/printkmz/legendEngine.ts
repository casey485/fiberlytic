import type { Legend, LegendRule } from './types'

// ---------------------------------------------------------------------------
// Legend engine
//
// Honest scope: we work from OCR text, not raster pixels, so we start from the
// industry-standard conventions below (blue = aerial strand, brown = fiber,
// green = fiber pulled through conduit, dotted = underground conduit, HH =
// handhole, D Tap = splice/tap, etc.) and then *confirm/annotate* them from the
// print's own LEGEND page when one is found. Detection (detect.ts) runs off
// `legend.rules`, so it works whether or not a legend page is present.
// ---------------------------------------------------------------------------

export const DEFAULT_RULES: LegendRule[] = [
  { objectType: 'handhole', method: 'underground', label: 'Handhole (HH box)', keywords: ['HH', 'HANDHOLE', 'HAND HOLE'], symbol: 'HH', confirmedByLegend: false, source: 'default' },
  { objectType: 'manhole', method: 'underground', label: 'Manhole', keywords: ['MH', 'MANHOLE'], symbol: 'MH', confirmedByLegend: false, source: 'default' },
  { objectType: 'vault', method: 'underground', label: 'Vault', keywords: ['VAULT'], symbol: 'VAULT', confirmedByLegend: false, source: 'default' },
  { objectType: 'pedestal', method: 'aerial', label: 'Pedestal', keywords: ['PED', 'PEDESTAL'], symbol: 'PED', confirmedByLegend: false, source: 'default' },
  { objectType: 'splice_point', method: 'underground', label: 'Splice Point', keywords: ['SPLICE POINT', 'SPLICE CLOSURE', 'SPLICE'], symbol: 'SP', confirmedByLegend: false, source: 'default' },
  { objectType: 'tap', method: 'underground', label: 'D Tap (splice/tap)', keywords: ['D TAP', 'D-TAP', 'DTAP', 'TAP'], symbol: 'D TAP', confirmedByLegend: false, source: 'default' },
  { objectType: 'conduit_run', method: 'underground', label: 'Underground Conduit (dotted line)', keywords: ['CONDUIT', 'DOTTED', 'HDPE', 'DUCT', 'UNDERGROUND'], lineStyle: 'dotted', confirmedByLegend: false, source: 'default' },
  { objectType: 'aerial_strand', method: 'aerial', label: 'Aerial Strand (blue line)', keywords: ['AERIAL', 'STRAND', 'BLUE', 'MESSENGER'], colorName: 'blue', lineStyle: 'solid', confirmedByLegend: false, source: 'default' },
  { objectType: 'fiber', method: 'unknown', label: 'Fiber (brown line)', keywords: ['FIBER', 'BROWN'], colorName: 'brown', lineStyle: 'solid', confirmedByLegend: false, source: 'default' },
  { objectType: 'fiber_in_conduit', method: 'pulled_through_conduit', label: 'Fiber Pulled Through Conduit (green line)', keywords: ['FIBER IN CONDUIT', 'PULLED', 'GREEN'], colorName: 'green', lineStyle: 'solid', confirmedByLegend: false, source: 'default' },
  { objectType: 'bore', method: 'bore', label: 'Bore Path', keywords: ['BORE', 'HDD', 'DIRECTIONAL BORE', 'DIR BORE'], confirmedByLegend: false, source: 'default' },
  { objectType: 'road_crossing', method: 'bore', label: 'Road Crossing', keywords: ['ROAD CROSSING', 'RD XING', 'RD X-ING', 'X-ING', 'XING', 'CROSSING'], confirmedByLegend: false, source: 'default' },
]

const COLOR_WORDS = ['blue', 'brown', 'green', 'red', 'black', 'orange', 'yellow', 'purple', 'gray', 'grey']
const STYLE_WORDS = ['dotted', 'dashed', 'solid']

/** Find the page index whose text most looks like a legend/symbol key. */
export function findLegendPage(pages: string[]): number | null {
  let best = -1
  let bestScore = 0
  pages.forEach((text, i) => {
    const up = text.toUpperCase()
    let score = 0
    if (/\bLEGEND\b/.test(up)) score += 5
    if (/\bSYMBOLS?\b/.test(up)) score += 3
    if (/\bABBREVIATIONS?\b/.test(up)) score += 2
    score += COLOR_WORDS.filter((c) => up.includes(c.toUpperCase())).length
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  })
  return bestScore >= 3 ? best : null
}

/**
 * Build the active legend: clone defaults, then confirm/annotate from the legend
 * page text. A rule is "confirmed" when the legend mentions its keywords; if a
 * color or line-style word appears on the same line, we adopt it.
 */
export function buildLegend(pages: string[]): Legend {
  const legendPageIndex = findLegendPage(pages)
  const rules: LegendRule[] = DEFAULT_RULES.map((r) => ({ ...r, keywords: [...r.keywords] }))
  const entries: string[] = []

  if (legendPageIndex !== null) {
    const lines = pages[legendPageIndex]
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l) => l.length >= 3 && l.length <= 80)

    for (const line of lines) {
      const up = line.toUpperCase()
      const matched = rules.find((r) => r.keywords.some((k) => up.includes(k)))
      if (!matched) continue

      // Capture the raw legend line for display.
      if (entries.length < 40) entries.push(line)
      matched.confirmedByLegend = true
      matched.source = 'legend'

      const color = COLOR_WORDS.find((c) => up.includes(c.toUpperCase()))
      if (color) matched.colorName = color
      const style = STYLE_WORDS.find((s) => up.includes(s.toUpperCase()))
      if (style) matched.lineStyle = style as LegendRule['lineStyle']
    }
  }

  return { rules, legendPageIndex, entries }
}

export function legendSummary(legend: Legend): string {
  const confirmed = legend.rules.filter((r) => r.confirmedByLegend).length
  if (legend.legendPageIndex === null) return 'No legend page found — using default conventions.'
  return `Legend page ${legend.legendPageIndex + 1}: ${confirmed} of ${legend.rules.length} rules confirmed.`
}
