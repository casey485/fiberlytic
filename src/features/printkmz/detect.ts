import type {
  DetectedObject,
  Legend,
  LegendRule,
  LngLat,
  ObjectType,
  PrintExtraction,
} from './types'
import { objectMeta } from './types'

let seq = 0
const id = () => `obj-${Date.now().toString(36)}-${(seq++).toString(36)}`

export function makeObject(
  sessionId: string,
  type: ObjectType,
  position: LngLat,
  partial: Partial<DetectedObject> = {},
): DetectedObject {
  const now = new Date().toISOString()
  const meta = objectMeta(type)
  return {
    id: id(),
    sessionId,
    type,
    label: partial.label ?? meta.label,
    status: 'pending',
    position,
    constructionMethod: partial.constructionMethod ?? meta.defaultMethod,
    confidence: partial.confidence ?? 1,
    photos: [],
    redlines: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
}

const toNum = (s: string | undefined) => {
  if (!s) return undefined
  const n = parseFloat(s.replace(/[^\d.]/g, ''))
  return isNaN(n) ? undefined : n
}

const cycle = <T,>(arr: T[], i: number): T | undefined => (arr.length ? arr[i % arr.length] : undefined)

/** Build a keyword regex for a rule (longest keywords first to prefer specifics). */
function ruleRegex(rule: LegendRule): RegExp {
  const kws = [...rule.keywords].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'))
  return new RegExp(`\\b(?:${kws.join('|')})\\b`, 'gi')
}

/**
 * Heuristic, legend-driven detection. We count each rule's keyword/abbreviation
 * occurrences in the OCR text and create that many candidate objects, seeded in
 * a grid near the session center for the user to drag into place. Engineering
 * attributes (feeder/section/fiber count/footage/span/road) are pulled from the
 * extraction and attached cyclically — the review screen lets the user correct
 * any of it. (We don't do raster symbol/color recognition; the legend supplies
 * the type/method/color semantics.)
 */
export function detectObjects(
  sessionId: string,
  extraction: PrintExtraction,
  legend: Legend,
  center: LngLat,
): DetectedObject[] {
  const text = extraction.rawText
  const footages = extraction.footageLabels.map(toNum).filter((n): n is number => n !== undefined)
  const spans = extraction.spanLengths.map(toNum).filter((n): n is number => n !== undefined)
  const fiberCounts = extraction.fiberCounts.map(toNum).filter((n): n is number => n !== undefined)
  const feeders = extraction.feeders.length ? extraction.feeders : extraction.cover.feeder ? [extraction.cover.feeder] : []
  const sections = extraction.sections.length ? extraction.sections : extraction.cover.section ? [extraction.cover.section] : []
  const streets = extraction.streets

  const objects: DetectedObject[] = []
  let gridIndex = 0

  for (const rule of legend.rules) {
    const matches = text.match(ruleRegex(rule))
    let count = matches ? Math.min(matches.length, 25) : 0

    // If a linear type wasn't named but we have footage labels, still propose runs.
    if (count === 0 && objectMeta(rule.objectType).linear && rule.objectType === 'conduit_run' && footages.length) {
      count = Math.min(footages.length, 8)
    }
    if (count === 0) continue

    const meta = objectMeta(rule.objectType)
    for (let i = 0; i < count; i++) {
      const position = seedPosition(center, gridIndex++)
      const obj = makeObject(sessionId, rule.objectType, position, {
        confidence: rule.confirmedByLegend ? 0.7 : 0.5,
        constructionMethod: rule.method,
        feeder: cycle(feeders, gridIndex),
        section: cycle(sections, gridIndex),
        roadName: cycle(streets, gridIndex),
        sheet: cycle(extraction.sheets, gridIndex),
      })

      if (meta.linear) {
        const ft = cycle(footages, i)
        const span = cycle(spans, i)
        obj.footage = ft
        obj.spanLength = span
        obj.productionQuantity = ft
        obj.billingQuantity = ft
        if (ft) obj.label = `${meta.label} (${ft} LF)`
        // Seed a short polyline so linear objects export as KML LineStrings.
        obj.path = [position, offset(position, 0.0004, 0.00025)]
      }
      obj.fiberCount = cycle(fiberCounts, gridIndex)
      objects.push(obj)
    }
  }

  return objects
}

/** Lay candidates out in a grid (~25 m spacing) around the center. */
function seedPosition(center: LngLat, index: number): LngLat {
  const cols = 6
  const row = Math.floor(index / cols)
  const col = index % cols
  return { lat: center.lat + (row - 2) * 0.00022, lng: center.lng + (col - 3) * 0.0003 }
}

const offset = (p: LngLat, dLng: number, dLat: number): LngLat => ({ lng: p.lng + dLng, lat: p.lat + dLat })
