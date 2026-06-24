import { createWorker } from 'tesseract.js'
import type { CoverInfo, PrintExtraction } from './types'
import { findLegendPage } from './legendEngine'

export interface OcrProgress {
  page: number
  total: number
  progress: number // 0–1 within the page
}

/** Run OCR across rendered page images; returns per-page text. */
export async function runOcr(
  images: string[],
  onProgress?: (p: OcrProgress) => void,
): Promise<string[]> {
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress?.({ page: 0, total: images.length, progress: m.progress })
      }
    },
  })

  const pages: string[] = []
  for (let i = 0; i < images.length; i++) {
    const { data } = await worker.recognize(images[i])
    pages.push(data.text)
    onProgress?.({ page: i + 1, total: images.length, progress: 1 })
  }
  await worker.terminate()
  return pages
}

const uniq = (arr: string[]) => [...new Set(arr.map((s) => s.trim()).filter(Boolean))]
const lines = (text: string) =>
  text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)

// --- Regexes -----------------------------------------------------------------

const STREET_RE =
  /\b([A-Z0-9][A-Za-z0-9.'-]+(?:\s+[A-Z0-9][A-Za-z0-9.'-]+)*)\s+(ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|BLVD|LN|LANE|CT|COURT|WAY|HWY|HIGHWAY|PKWY|PL|TER|TRL|CIR)\b\.?/gi
const SHEET_RE = /\b(?:SHEET|SHT)\.?\s*(?:NO\.?\s*)?([0-9]+)\s*(?:OF\s*([0-9]+))?/gi
const STATION_RE = /\b(?:STA\.?\s*)?(\d{1,4}\+\d{2}(?:\.\d+)?)\b/g
const FOOTAGE_RE = /\b([\d,]+(?:\.\d+)?)\s*(?:LF|FT|FEET|')\b/gi
const SPAN_RE = /\bSPAN\s*[:#]?\s*([\d,]+(?:\.\d+)?)\s*(?:'|FT|LF)?/gi
const FEEDER_RE = /\b(?:FEEDER|FDR)\.?\s*#?\s*([0-9A-Z][0-9A-Z-]{0,7})/gi
const SECTION_RE = /\b(?:SECTION|SECT|SEC)\.?\s*#?\s*([0-9A-Z][0-9A-Z-]{0,7})/gi
const FIBER_CT_RE = /\b(\d{1,4})\s*(?:CT|F|FO|FIBERS?)\b/gi
const FIBER_COUNT_RE = /\bFIBER\s*COUNT\s*[:#]?\s*(\d{1,4})\b/gi
const CITY_STATE_RE = /\b([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+)?),\s*([A-Z]{2})\b/
const COUNTY_RE = /\b([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+)?)\s+COUNTY\b/i

function matchAll(text: string, re: RegExp, group = 1): string[] {
  const out: string[] = []
  for (const m of text.matchAll(re)) if (m[group]) out.push(m[group])
  return out
}

// --- Cover page --------------------------------------------------------------

/** Parse city/county/state/project/feeder/section/sheet index from the cover. */
export function parseCover(coverText: string): CoverInfo {
  const ls = lines(coverText)
  const cover: CoverInfo = { sheetIndex: [] }

  const cityState = coverText.match(CITY_STATE_RE)
  if (cityState) {
    cover.city = cityState[1]
    cover.state = cityState[2]
  }
  const cityOf = coverText.match(/\bCITY OF\s+([A-Z][A-Za-z.\s]{2,30})/i)
  if (cityOf) cover.city = cityOf[1].trim()

  const county = coverText.match(COUNTY_RE)
  if (county) cover.county = `${county[1].trim()} County`

  const proj = ls.find((l) => /PROJECT|FTTH|FIBER|ROUTE|BUILD|NETWORK/i.test(l) && l.length < 80)
  if (proj) cover.projectName = proj.replace(/.*PROJECT\s*(?:NAME)?\s*[:-]?\s*/i, '').trim() || proj

  cover.feeder = matchAll(coverText, FEEDER_RE)[0]
  cover.section = matchAll(coverText, SECTION_RE)[0]

  // Sheet index: any "SHEET n ..." lines on the cover.
  cover.sheetIndex = uniq(ls.filter((l) => /\bSHEET\b/i.test(l) && l.length < 60)).slice(0, 30)

  return cover
}

// --- Full extraction ---------------------------------------------------------

/** Parse the structured fields Fiberlytic cares about from all OCR pages. */
export function parseExtraction(pages: string[]): PrintExtraction {
  const rawText = pages.join('\n')
  const cover = parseCover(pages[0] ?? '')

  const streets: string[] = []
  for (const m of rawText.matchAll(STREET_RE)) streets.push(`${m[1]} ${m[2]}`.replace(/\s+/g, ' ').trim())

  const sheets: string[] = []
  for (const m of rawText.matchAll(SHEET_RE)) sheets.push(m[2] ? `${m[1]} of ${m[2]}` : m[1])

  const stations = matchAll(rawText, STATION_RE)
  const footageLabels = matchAll(rawText, FOOTAGE_RE).map((f) => `${f} LF`)
  const spanLengths = matchAll(rawText, SPAN_RE).map((s) => `${s} ft`)
  const feeders = matchAll(rawText, FEEDER_RE)
  const sections = matchAll(rawText, SECTION_RE)
  const fiberCounts = [...matchAll(rawText, FIBER_COUNT_RE), ...matchAll(rawText, FIBER_CT_RE)]

  // Construction notes: lines under a NOTES section or numbered notes.
  const notes: string[] = []
  let inNotes = false
  for (const l of lines(rawText)) {
    if (/^(CONSTRUCTION\s+)?NOTES?\b/i.test(l)) {
      inNotes = true
      const after = l.replace(/^(CONSTRUCTION\s+)?NOTES?\s*[:-]?\s*/i, '').trim()
      if (after) notes.push(after)
      continue
    }
    if (inNotes) {
      if (/^[A-Z][A-Z\s]{6,}$/.test(l) && !/^\d/.test(l)) inNotes = false
      else if (l.length > 3) notes.push(l)
    } else if (/^\d+[.)]\s+\S/.test(l)) {
      notes.push(l)
    }
  }

  return {
    cover,
    streets: uniq(streets).slice(0, 40),
    sheets: uniq(sheets).slice(0, 20),
    stations: uniq(stations).slice(0, 80),
    footageLabels: uniq(footageLabels).slice(0, 80),
    spanLengths: uniq(spanLengths).slice(0, 60),
    feeders: uniq(feeders).slice(0, 30),
    sections: uniq(sections).slice(0, 40),
    fiberCounts: uniq(fiberCounts).slice(0, 30),
    notes: uniq(notes).slice(0, 50),
    legendPageIndex: findLegendPage(pages),
    rawText,
  }
}
