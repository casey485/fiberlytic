// ---------------------------------------------------------------------------
// OCR → Work Object candidate detection. Scans OCR word boxes (real pixel
// positions from tesseract.js, see features/printkmz/ocr.ts:runOcrWithBoxes)
// against the Work Object catalog's billingKeywords, producing candidates at
// their actual position on the plan instead of a synthetic grid.
// ---------------------------------------------------------------------------

import type { OcrPageWords } from '../features/printkmz/ocr'
import { WORK_OBJECT_TYPES } from './workObjectTypes'
import type { WorkObjectTypeId } from '../types'

export interface OcrCandidate {
  id: string
  workObjectType: WorkObjectTypeId
  label: string
  matchedText: string
  pageIndex: number
  /** Pixel position in the same coordinate space as the rendered page image. */
  px: { x: number; y: number }
}

const MIN_WORD_LEN = 4
/** Candidates within this many pixels of an already-kept one are treated as the same cluster. */
const DEDUPE_RADIUS_PX = 60
const MAX_PER_TYPE = 25

function cleanWord(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function detectOcrCandidates(pages: OcrPageWords[]): OcrCandidate[] {
  // type -> its keyword tokens (single words only; multi-word keywords like "open trench"
  // are split so either constituent word can match — OCR word boxes are per-word, not per-phrase)
  const typeTokens = WORK_OBJECT_TYPES
    .filter((t) => t.billingKeywords.length > 0)
    .map((t) => ({
      type: t,
      tokens: new Set(t.billingKeywords.flatMap((k) => k.toLowerCase().split(/\s+/)).filter((w) => w.length >= MIN_WORD_LEN)),
    }))
    .filter((t) => t.tokens.size > 0)

  const kept: OcrCandidate[] = []
  const countByType = new Map<WorkObjectTypeId, number>()

  pages.forEach((page, pageIndex) => {
    for (const word of page.words) {
      const cleaned = cleanWord(word.text)
      if (cleaned.length < MIN_WORD_LEN) continue

      for (const { type, tokens } of typeTokens) {
        if (!tokens.has(cleaned)) continue
        const used = countByType.get(type.id) ?? 0
        if (used >= MAX_PER_TYPE) continue

        const px = { x: (word.x0 + word.x1) / 2, y: (word.y0 + word.y1) / 2 }
        const dupe = kept.some((c) =>
          c.workObjectType === type.id && c.pageIndex === pageIndex &&
          Math.hypot(c.px.x - px.x, c.px.y - px.y) < DEDUPE_RADIUS_PX,
        )
        if (dupe) continue

        kept.push({
          id: `ocr-${pageIndex}-${kept.length}-${Date.now().toString(36)}`,
          workObjectType: type.id,
          label: type.label,
          matchedText: word.text,
          pageIndex,
          px,
        })
        countByType.set(type.id, used + 1)
      }
    }
  })

  return kept
}
