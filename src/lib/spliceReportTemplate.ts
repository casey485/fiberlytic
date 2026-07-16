// ---------------------------------------------------------------------------
// "Upload your own spreadsheet" splice report templates — the counterpart to
// spliceExport.ts's from-scratch generators. Instead of us reproducing a
// paper form cell-by-cell, the user uploads their real workbook once, tells
// us which cell each field goes in (see SpliceEnclosureTemplateMapping /
// FiberTapTemplateMapping in types.ts), and every export re-opens that exact
// file with exceljs and writes values into just the mapped cells — so fonts,
// colors, other sheets/tabs, and anything else in the file survive untouched.
// ---------------------------------------------------------------------------

import type ExcelJS from 'exceljs'
import type { WorkBook } from 'xlsx'
import type {
  FieldMarkup,
  FiberTapReport,
  MarkupPhoto,
  SpliceEnclosure,
  SpliceEnclosureTemplateMapping,
  FiberTapTemplateMapping,
  SpliceReportTemplate,
} from '../types'
import { FIBER_COLOR_META } from './spliceFiberColors'
import { computeLinkLossDb } from './spliceExport'
import { triggerDownload } from './kmzExport'
import { loadBlob } from './fileStore'

export function blankSpliceEnclosureMapping(): SpliceEnclosureTemplateMapping {
  return {
    jobNumber: null, jobName: null, date: null, spliceId: null, enclosureType: null,
    mapNumber: null, trayCount: null, location: null, latitude: null, longitude: null,
    notes: null, nocTicketNumber: null, nocTimeIn: null, nocTwRep: null, nocClear: null,
    nocTimeOut: null, nocAuditor: null, photosAnchor: null, spanAnchors: {}, spanLabelCells: {},
  }
}

export function blankFiberTapMapping(): FiberTapTemplateMapping {
  return {
    prismId: null, opticalSourceLabel: null, nodeNumber: null, opticalPowerDbm: null,
    nodeLocation: null, wavelengthNm: null, contractorCompany: null, splicerName: null,
    tapsAnchor: null,
  }
}

/** The sheet name used by the real "BLANK FIBER SPLICING INVOICE.xlsx" ->
 *  per-enclosure tab, confirmed cell-by-cell against that actual workbook
 *  (same file exportSpliceEnclosureExcel's hardcoded layout was read from)
 *  and against "FIBER SPLICING PAPERWORK SLIDESHOW.pdf"'s field callouts. */
export const FIBERLYTIC_STANDARD_SPLICE_SHEET_NAME = 'BLANK SPLICING TEMPLATE'

/** One-click mapping for that standard sheet — every address below was read
 *  directly from the real file (not guessed): header fields B/C column
 *  pairs at rows 2-11, NOC box at Q/R/S rows 5-11, notes at H6, Input/Output
 *  Ftg label→value pairs at C12-C19, and the fiber matrix's 8 three-column
 *  groups (B, E, H, K, N, Q, T, W) starting at row 25. If your uploaded copy
 *  matches this layout, this fills in every field in one click; if you've
 *  since customized your copy, tweak whichever addresses moved. */
export function fiberlyticStandardSpliceMapping(): SpliceEnclosureTemplateMapping {
  return {
    jobNumber: 'C2', jobName: 'C3', date: 'C4', spliceId: 'C5', enclosureType: 'C6',
    mapNumber: 'C7', trayCount: 'C8', location: 'C9', latitude: 'C10', longitude: 'C11',
    notes: 'H6', nocTicketNumber: 'R5', nocTimeIn: 'Q7', nocTwRep: 'R7', nocClear: 'S7',
    nocTimeOut: 'R8', nocAuditor: 'R11', photosAnchor: 'H6',
    spanAnchors: { 0: 'B25', 1: 'E25', 2: 'H25', 3: 'K25', 4: 'N25', 5: 'Q25', 6: 'T25', 7: 'W25' },
    spanLabelCells: { 0: 'C12', 1: 'C13', 2: 'C14', 3: 'C15', 4: 'C16', 5: 'C17', 6: 'C18', 7: 'C19' },
  }
}

/** The sheet name used by the real "EXAMPLE FIBER TAP REPORT" tab (same
 *  family of workbook as FIBERLYTIC_STANDARD_SPLICE_SHEET_NAME above). */
export const FIBERLYTIC_STANDARD_FIBER_TAP_SHEET_NAME = 'EXAMPLE FIBER TAP REPORT'

/** One-click mapping for that standard sheet — confirmed against both the
 *  blank template's own hardcoded generator (exportFiberTapReportExcel in
 *  spliceExport.ts) and a real filled-out "EXAMPLE FIBER TAP REPORT" tab:
 *  header fields at rows 2-6 (label/value column pairs), tap table starting
 *  row 10 with fixed offsets for type/port-count/ports-spliced/buffer color
 *  (+1..+4), the 8 port dBm readings (+5..+12), and the 8 computed
 *  link-loss values (+13..+20). */
export function fiberlyticStandardFiberTapMapping(): FiberTapTemplateMapping {
  return {
    prismId: 'C2', opticalSourceLabel: 'E2', nodeNumber: 'C3', opticalPowerDbm: 'E3',
    nodeLocation: 'C4', wavelengthNm: 'E4', contractorCompany: 'C5', splicerName: 'C6',
    tapsAnchor: 'B10',
  }
}

/** Parses an A1-style address ("C4", "AA12") into 1-indexed {row, col} —
 *  exceljs's getCell(row, col) is 1-indexed, matching A1's own row numbers. */
export function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref.trim())
  if (!m) return null
  const [, letters, digits] = m
  let col = 0
  for (const ch of letters.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  const row = parseInt(digits, 10)
  if (row < 1 || col < 1) return null
  return { row, col }
}

export function isValidCellRef(ref: string): boolean {
  return ref.trim() === '' || parseCellRef(ref) !== null
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/** Reads an uploaded .xlsx file into the base64 payload we persist, its sheet
 *  names (for the upload UI's sheet picker), and the parsed workbook itself
 *  (so suggestSpliceEnclosureMapping/suggestFiberTapMapping below can scan
 *  cell text without re-reading the file). */
export async function readTemplateFile(file: File): Promise<{ base64: string; sheetNames: string[]; wb: WorkBook }> {
  const buffer = await file.arrayBuffer()
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buffer, { type: 'array' })
  return { base64: arrayBufferToBase64(buffer), sheetNames: wb.SheetNames, wb }
}

// ── Automatic template recognition ─────────────────────────────────────────
// A best-effort fallback for uploads that *aren't* the known standard layout
// (fiberlyticStandardSpliceMapping above) — scans every cell's text for
// something that looks like a known field's label and suggests the cell one
// column to the right as its value (the convention every real splicing
// template we've seen uses: label cell, then the value immediately right of
// it). Never authoritative — always a starting point the admin reviews.

type CellGrid = (string | number)[][]

async function sheetToGrid(wb: WorkBook, sheetName: string): Promise<CellGrid> {
  const ws = wb.Sheets[sheetName]
  if (!ws) return []
  const XLSX = await import('xlsx')
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as CellGrid
}

function normalizeHeaderText(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[:#.]/g, '').replace(/\s+/g, ' ').trim()
}

function findLabelCell(grid: CellGrid, aliases: string[]): { row: number; col: number } | null {
  const norm = aliases.map(normalizeHeaderText)
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const cell = normalizeHeaderText(row[c])
      if (!cell) continue
      if (norm.some((a) => cell === a || cell.includes(a))) return { row: r, col: c }
    }
  }
  return null
}

function colLettersFromIndex0(col0: number): string {
  let n = col0 + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function refFromRowCol0(row0: number, col0: number): string {
  return `${colLettersFromIndex0(col0)}${row0 + 1}`
}

type EnclosureFieldKey = keyof Omit<SpliceEnclosureTemplateMapping, 'spanAnchors' | 'spanLabelCells'>

const ENCLOSURE_FIELD_ALIASES: Record<EnclosureFieldKey, string[]> = {
  jobNumber: ['job number', 'job no', 'prism'],
  jobName: ['job name'],
  date: ['date'],
  spliceId: ['splice id'],
  enclosureType: ['enclosure'],
  mapNumber: ['map number'],
  trayCount: ['no of trays', 'number of trays'],
  location: ['location'],
  latitude: ['latitude'],
  longitude: ['longitude'],
  notes: ['notes and/or concerns', 'notes'],
  nocTicketNumber: ['ticket'],
  nocTimeIn: ['time in'],
  nocTwRep: ['tw rep'],
  nocClear: ['clear'],
  nocTimeOut: ['time out'],
  nocAuditor: ['auditor'],
  photosAnchor: [], // no reliable text header to search for — left for manual entry
}

/** Finds up to 8 "Fiber Number" column headers (left to right) and returns
 *  the fiber-table anchor just below each — handles both a single "Fiber
 *  Number" cell and the real template's label split across two rows
 *  ("Fiber" then "Number" directly beneath it, confirmed against the actual
 *  BLANK FIBER SPLICING INVOICE.xlsx). */
function guessFiberNumberAnchors(grid: CellGrid): { row: number; col: number }[] {
  const byCol = new Map<number, number>()
  const consider = (headerRow: number, col: number, dataRowOffset: number) => {
    const dataRow = headerRow + dataRowOffset
    const existing = byCol.get(col)
    if (existing == null || dataRow < existing) byCol.set(col, dataRow)
  }
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const cell = normalizeHeaderText(row[c])
      if (/^fiber (number|no|#)$/.test(cell)) {
        consider(r, c, 1)
      } else if (cell === 'fiber') {
        const below = normalizeHeaderText(grid[r + 1]?.[c])
        if (below === 'number' || below === 'no' || below === '#') consider(r, c, 2)
      }
    }
  }
  return [...byCol.entries()].sort((a, b) => a[0] - b[0]).map(([col, row]) => ({ row, col }))
}

/** Best-effort mapping suggestion for an uploaded sheet that doesn't match
 *  the known standard layout — see the section doc comment above. */
export async function suggestSpliceEnclosureMapping(wb: WorkBook, sheetName: string): Promise<SpliceEnclosureTemplateMapping> {
  const grid = await sheetToGrid(wb, sheetName)
  const mapping = blankSpliceEnclosureMapping()
  for (const key of Object.keys(ENCLOSURE_FIELD_ALIASES) as EnclosureFieldKey[]) {
    const aliases = ENCLOSURE_FIELD_ALIASES[key]
    if (aliases.length === 0) continue
    const hit = findLabelCell(grid, aliases)
    if (hit) mapping[key] = refFromRowCol0(hit.row, hit.col + 1)
  }
  guessFiberNumberAnchors(grid).slice(0, 8).forEach((a, i) => {
    mapping.spanAnchors[i] = refFromRowCol0(a.row, a.col)
  })
  return mapping
}

type FiberTapFieldKey = keyof Omit<FiberTapTemplateMapping, 'tapsAnchor'>

const FIBER_TAP_FIELD_ALIASES: Record<FiberTapFieldKey, string[]> = {
  prismId: ['prism id', 'prism'],
  opticalSourceLabel: ['optical source'],
  nodeNumber: ['node number'],
  opticalPowerDbm: ['optical power'],
  nodeLocation: ['node location'],
  wavelengthNm: ['wavelength'],
  contractorCompany: ['contractor company'],
  splicerName: ['splicer name'],
}

/** Best-effort mapping suggestion for an uploaded Fiber Tap Report sheet. */
export async function suggestFiberTapMapping(wb: WorkBook, sheetName: string): Promise<FiberTapTemplateMapping> {
  const grid = await sheetToGrid(wb, sheetName)
  const mapping = blankFiberTapMapping()
  for (const key of Object.keys(FIBER_TAP_FIELD_ALIASES) as FiberTapFieldKey[]) {
    const hit = findLabelCell(grid, FIBER_TAP_FIELD_ALIASES[key])
    if (hit) mapping[key] = refFromRowCol0(hit.row, hit.col + 1)
  }
  outer: for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const cell = normalizeHeaderText(row[c])
      if (cell.includes('tap name') || cell.includes('fiber tap number')) {
        mapping.tapsAnchor = refFromRowCol0(r + 1, c)
        break outer
      }
    }
  }
  return mapping
}

async function loadWorksheet(template: SpliceReportTemplate) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(base64ToArrayBuffer(template.fileData))
  const ws = wb.getWorksheet(template.sheetName) ?? wb.worksheets[0]
  if (!ws) throw new Error(`"${template.fileName}" has no worksheet named "${template.sheetName}"`)
  return { wb, ws }
}

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-')
}

// ── Photo collage ────────────────────────────────────────────────────────
// The real paperwork pastes the enclosure-mounted photo and one photo per
// tray directly into the sheet (see FIBER SPLICING PAPERWORK SLIDESHOW.pdf)
// — so exports embed the same photos as floating images tiled in a grid,
// anchored at whatever cell `mapping.photosAnchor` points to (independent
// of the `notes` text cell, so the two can live in different spots).

function spliceProofSlotOrder(p: MarkupPhoto): number {
  if (p.spliceProofSlot?.kind === 'enclosure_mounted') return 0
  if (p.spliceProofSlot?.kind === 'tray') return 1000 + p.spliceProofSlot.trayNumber
  return 5000
}

function spliceProofSlotCaption(p: MarkupPhoto): string {
  if (p.spliceProofSlot?.kind === 'enclosure_mounted') return 'Enclosure Mounted'
  if (p.spliceProofSlot?.kind === 'tray') return `Tray ${p.spliceProofSlot.trayNumber}`
  return p.caption ?? 'Photo'
}

/** Loads every photo captured for this enclosure's markup (enclosure-mounted
 *  + tray photos) from IndexedDB, enclosure-mounted first then trays in
 *  order — same blob-key convention AddWorkModal.tsx saves them under
 *  (`mkp-<MarkupPhoto.id>`, see fileStore.ts). Skips any that failed to load
 *  rather than failing the whole export. */
async function collectEnclosurePhotos(
  markupPhotos: MarkupPhoto[],
  markupId: string,
): Promise<{ dataUrl: string; caption: string }[]> {
  const relevant = markupPhotos
    .filter((p) => p.markupId === markupId)
    .sort((a, b) => spliceProofSlotOrder(a) - spliceProofSlotOrder(b))
  const results: { dataUrl: string; caption: string }[] = []
  for (const p of relevant) {
    const dataUrl = await loadBlob(`mkp-${p.id}`)
    if (dataUrl) results.push({ dataUrl, caption: spliceProofSlotCaption(p) })
  }
  return results
}

const PHOTO_EXTENSION_RE = /^data:image\/(png|jpe?g|gif);base64,/i

function colWidthPx(ws: ExcelJS.Worksheet, col1: number): number {
  const w = ws.getColumn(col1).width ?? 8.43
  return Math.round(w * 7 + 5)
}
function rowHeightPx(ws: ExcelJS.Worksheet, row1: number): number {
  const h = ws.getRow(row1).height ?? 15
  return Math.round((h * 4) / 3)
}

/** Converts a pixel offset from the top-left of a 1-indexed anchor cell into
 *  exceljs's 0-indexed fractional image-anchor {col, row}, walking the
 *  sheet's actual column widths / row heights (falling back to Excel's
 *  defaults where unset) so tiled photos land close to the intended spot
 *  regardless of how the uploaded file's columns/rows are sized. */
function pixelAnchor(ws: ExcelJS.Worksheet, anchorRow1: number, anchorCol1: number, dxPx: number, dyPx: number) {
  let col = anchorCol1
  let remainingX = dxPx
  for (;;) {
    const w = colWidthPx(ws, col)
    if (remainingX < w) break
    remainingX -= w
    col += 1
  }
  const colFrac = (col - 1) + remainingX / colWidthPx(ws, col)

  let row = anchorRow1
  let remainingY = dyPx
  for (;;) {
    const h = rowHeightPx(ws, row)
    if (remainingY < h) break
    remainingY -= h
    row += 1
  }
  const rowFrac = (row - 1) + remainingY / rowHeightPx(ws, row)

  return { col: colFrac, row: rowFrac }
}

const PHOTO_W = 130
const PHOTO_H = 98
const PHOTO_GAP = 8
const PHOTO_COLS = 3

function embedPhotos(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  anchorRef: string,
  photos: { dataUrl: string; caption: string }[],
) {
  const anchor = parseCellRef(anchorRef)
  if (!anchor) return
  photos.forEach((photo, i) => {
    const m = PHOTO_EXTENSION_RE.exec(photo.dataUrl)
    if (!m) return
    const extension = (m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase()) as 'png' | 'jpeg' | 'gif'
    const imageId = wb.addImage({ base64: photo.dataUrl, extension })
    const gridCol = i % PHOTO_COLS
    const gridRow = Math.floor(i / PHOTO_COLS)
    const { col, row } = pixelAnchor(
      ws, anchor.row, anchor.col,
      gridCol * (PHOTO_W + PHOTO_GAP), gridRow * (PHOTO_H + PHOTO_GAP),
    )
    ws.addImage(imageId, { tl: { col, row }, ext: { width: PHOTO_W, height: PHOTO_H } })
  })
}

/** Writes one enclosure's data (header fields, NOC box, span/fiber matrix,
 *  photo collage) into `ws` — shared by the single-file export below and by
 *  saveEnclosureToMasterWorkbook, so the two never drift out of sync. */
async function fillSpliceEnclosureSheet(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  mapping: SpliceEnclosureTemplateMapping,
  enclosure: SpliceEnclosure,
  markup: Pick<FieldMarkup, 'capturedLat' | 'capturedLng' | 'workDate' | 'createdAt'>,
  markupPhotos: MarkupPhoto[],
): Promise<void> {
  const write = (ref: string | null | undefined, value: string | number | boolean | null | undefined) => {
    if (!ref || value == null || value === '') return
    const pos = parseCellRef(ref)
    if (!pos) return
    ws.getCell(pos.row, pos.col).value = value
  }

  write(mapping.jobNumber, enclosure.jobNumber)
  write(mapping.jobName, enclosure.jobName)
  write(mapping.date, enclosure.updatedAt ?? markup.workDate ?? enclosure.createdAt.slice(0, 10))
  write(mapping.spliceId, enclosure.spliceId)
  write(mapping.enclosureType, enclosure.enclosureType)
  write(mapping.mapNumber, enclosure.mapNumber)
  write(mapping.trayCount, enclosure.trayCount)
  write(mapping.location, enclosure.location)
  write(mapping.latitude, markup.capturedLat != null ? `${markup.capturedLat} N` : null)
  write(mapping.longitude, markup.capturedLng != null ? `${markup.capturedLng} W` : null)
  write(mapping.notes, enclosure.notes)
  write(mapping.nocTicketNumber, enclosure.noc.ticketNumber)
  write(mapping.nocTimeIn, enclosure.noc.timeIn)
  write(mapping.nocTwRep, enclosure.noc.twRep)
  write(mapping.nocClear, enclosure.noc.clear ? 'X' : '')
  write(mapping.nocTimeOut, enclosure.noc.timeOut)
  write(mapping.nocAuditor, enclosure.noc.auditor)

  for (const span of enclosure.spans) {
    write(mapping.spanLabelCells[span.spanIndex], span.label)
    const anchorRef = mapping.spanAnchors[span.spanIndex]
    if (!anchorRef) continue
    const anchor = parseCellRef(anchorRef)
    if (!anchor) continue

    // The uploaded template's fiber table often ships with sample fiber
    // #/tube/fiber-color rows already filled in (the real BLANK SPLICING
    // TEMPLATE's Input span does, rows 25+, as a reference sheet for
    // someone filling it out by hand) — not placeholders meant to survive
    // into a real export. Detect how many contiguous rows of sample data
    // sit below the anchor before writing anything, then blank out
    // whichever of those rows the real fiber count doesn't overwrite.
    let templateRowCount = 0
    while (
      templateRowCount < 1000
      && ws.getCell(anchor.row + templateRowCount, anchor.col).value != null
      && ws.getCell(anchor.row + templateRowCount, anchor.col).value !== ''
    ) {
      templateRowCount++
    }

    span.fibers.forEach((f, i) => {
      const row = anchor.row + i
      ws.getCell(row, anchor.col).value = f.fiberNumber
      ws.getCell(row, anchor.col + 1).value = FIBER_COLOR_META[f.tubeColor].label
      ws.getCell(row, anchor.col + 2).value = FIBER_COLOR_META[f.fiberColor].label
    })
    for (let i = span.fibers.length; i < templateRowCount; i++) {
      const row = anchor.row + i
      ws.getCell(row, anchor.col).value = null
      ws.getCell(row, anchor.col + 1).value = null
      ws.getCell(row, anchor.col + 2).value = null
    }
  }

  if (mapping.photosAnchor) {
    const photos = await collectEnclosurePhotos(markupPhotos, enclosure.markupId)
    if (photos.length) embedPhotos(wb, ws, mapping.photosAnchor, photos)
  }
}

export async function exportSpliceEnclosureWithTemplate(
  template: SpliceReportTemplate,
  enclosure: SpliceEnclosure,
  markup: Pick<FieldMarkup, 'capturedLat' | 'capturedLng' | 'workDate' | 'createdAt'>,
  markupPhotos: MarkupPhoto[],
): Promise<void> {
  const mapping = template.mapping as SpliceEnclosureTemplateMapping
  const { wb, ws } = await loadWorksheet(template)

  await fillSpliceEnclosureSheet(wb, ws, mapping, enclosure, markup, markupPhotos)

  const buffer = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${safeFilename(enclosure.spliceId || 'splice-enclosure')}.xlsx`,
  )
}

// ── Master workbook: one tab per enclosure ─────────────────────────────────
// Mirrors how the real customer workbooks are organized (see the tab list in
// FIBER SPLICING PAPERWORK SLIDESHOW.pdf — KENLA075005, KENLA075006, etc.,
// all cloned from a blank "Splicing template" tab). Every save clones
// `template.sheetName` into a new tab named after the enclosure, fills it in,
// and persists the growing workbook; re-saving the same enclosure reuses its
// existing tab (SpliceEnclosure.exportedSheetName) instead of duplicating it.

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/*?:[\]]/g, '-').trim()
  return (cleaned || 'Enclosure').slice(0, 31)
}

function uniqueSheetName(wb: ExcelJS.Workbook, base: string): string {
  const clean = sanitizeSheetName(base)
  if (!wb.getWorksheet(clean)) return clean
  for (let i = 2; i < 1000; i++) {
    const suffix = ` (${i})`
    const candidate = clean.slice(0, 31 - suffix.length) + suffix
    if (!wb.getWorksheet(candidate)) return candidate
  }
  return sanitizeSheetName(`${clean}-${Date.now().toString(36)}`)
}

/** Duplicates `src` (values, styles, merges, column widths, row heights) as
 *  a new sheet named `targetName`, replacing any existing sheet of that name
 *  first. exceljs has no built-in "duplicate worksheet" API, so this copies
 *  cell-by-cell — verified against the real BLANK FIBER SPLICING INVOICE.xlsx
 *  to round-trip fills, fonts, formulas, and merged ranges correctly. */
function cloneWorksheet(wb: ExcelJS.Workbook, src: ExcelJS.Worksheet, targetName: string): ExcelJS.Worksheet {
  const existing = wb.getWorksheet(targetName)
  if (existing) wb.removeWorksheet(targetName)

  const dst = wb.addWorksheet(targetName, { properties: { ...src.properties } })

  for (let c = 1; c <= 60; c++) {
    const width = src.getColumn(c).width
    if (width != null) dst.getColumn(c).width = width
  }

  src.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const dstRow = dst.getRow(rowNumber)
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const dstCell = dstRow.getCell(colNumber)
      dstCell.value = cell.value
      dstCell.style = cell.style
    })
    if (row.height) dstRow.height = row.height
  })

  for (const range of src.model.merges ?? []) dst.mergeCells(range)

  return dst
}

/** IndexedDB key for a template's accumulating master workbook — bytes live
 *  there (not in the localStorage-persisted AppData record) since they can
 *  grow into the multi-MB range as photo-laden sheets pile up; see
 *  SpliceReportTemplate.hasMasterWorkbook's doc comment. */
function masterWorkbookBlobKey(template: SpliceReportTemplate): string {
  return `spltpl-${template.id}`
}

/** Clones the template sheet into a new (or existing, if re-saving) tab for
 *  this enclosure, fills it in, and returns the updated workbook bytes + the
 *  tab name used — caller persists both via setSpliceMasterWorkbookData and
 *  SpliceEnclosure.exportedSheetName. Starts from the previously saved master
 *  workbook (IndexedDB) once one exists, otherwise from the
 *  originally-uploaded `template.fileData`. */
export async function saveEnclosureToMasterWorkbook(
  template: SpliceReportTemplate,
  enclosure: SpliceEnclosure,
  markup: Pick<FieldMarkup, 'capturedLat' | 'capturedLng' | 'workDate' | 'createdAt'>,
  markupPhotos: MarkupPhoto[],
): Promise<{ fileData: string; sheetName: string }> {
  const mapping = template.mapping as SpliceEnclosureTemplateMapping
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const existingMaster = template.hasMasterWorkbook ? await loadBlob(masterWorkbookBlobKey(template)) : null
  await wb.xlsx.load(base64ToArrayBuffer(existingMaster ?? template.fileData))

  const templateSheet = wb.getWorksheet(template.sheetName) ?? wb.worksheets[0]
  if (!templateSheet) throw new Error(`"${template.fileName}" has no worksheet named "${template.sheetName}"`)

  const targetName = enclosure.exportedSheetName && wb.getWorksheet(enclosure.exportedSheetName)
    ? enclosure.exportedSheetName
    : uniqueSheetName(wb, enclosure.spliceId || enclosure.mapNumber || enclosure.id)

  const ws = cloneWorksheet(wb, templateSheet, targetName)
  await fillSpliceEnclosureSheet(wb, ws, mapping, enclosure, markup, markupPhotos)

  const buffer = await wb.xlsx.writeBuffer()
  return { fileData: arrayBufferToBase64(buffer as unknown as ArrayBuffer), sheetName: targetName }
}

/** Downloads the current accumulated multi-tab workbook as-is (no changes) —
 *  every enclosure saved so far, each in its own tab. */
export async function downloadMasterWorkbook(template: SpliceReportTemplate): Promise<void> {
  const data = (template.hasMasterWorkbook ? await loadBlob(masterWorkbookBlobKey(template)) : null) ?? template.fileData
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  triggerDownload(
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${safeFilename(template.fileName.replace(/\.xlsx$/i, '') || 'splice-workbook')}.xlsx`,
  )
}

export async function exportFiberTapReportWithTemplate(
  template: SpliceReportTemplate,
  report: FiberTapReport,
): Promise<void> {
  const mapping = template.mapping as FiberTapTemplateMapping
  const { wb, ws } = await loadWorksheet(template)

  const write = (ref: string | null | undefined, value: string | number | boolean | null | undefined) => {
    if (!ref || value == null || value === '') return
    const pos = parseCellRef(ref)
    if (!pos) return
    ws.getCell(pos.row, pos.col).value = value
  }

  write(mapping.prismId, report.prismId)
  write(mapping.opticalSourceLabel, report.opticalSourceLabel)
  write(mapping.nodeNumber, report.nodeNumber)
  write(mapping.opticalPowerDbm, report.opticalPowerDbm)
  write(mapping.nodeLocation, report.nodeLocation)
  write(mapping.wavelengthNm, report.wavelengthNm)
  write(mapping.contractorCompany, report.contractorCompany)
  write(mapping.splicerName, report.splicerName)

  const anchor = mapping.tapsAnchor ? parseCellRef(mapping.tapsAnchor) : null
  if (anchor) {
    report.taps.forEach((tap, i) => {
      const row = anchor.row + i
      ws.getCell(row, anchor.col).value = tap.tapName
      ws.getCell(row, anchor.col + 1).value = tap.tapType
      ws.getCell(row, anchor.col + 2).value = tap.portCount
      ws.getCell(row, anchor.col + 3).value = tap.portsSpliced
      ws.getCell(row, anchor.col + 4).value = tap.bufferFiberColorToPort1
      for (const port of tap.ports) {
        if (port.portNumber < 1 || port.portNumber > 8) continue
        ws.getCell(row, anchor.col + 4 + port.portNumber).value = port.dbm ?? undefined
        const loss = computeLinkLossDb(report.opticalPowerDbm, port.dbm)
        ws.getCell(row, anchor.col + 12 + port.portNumber).value = loss ?? undefined
      }
    })
  }

  const buffer = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${safeFilename(report.nodeNumber || report.prismId || 'fiber-tap-report')}-fiber-tap-report.xlsx`,
  )
}
