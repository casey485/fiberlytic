// ---------------------------------------------------------------------------
// Splicing Excel export — recreates the real paper/Excel deliverables
// ("BLANK SPLICING TEMPLATE", "EXAMPLE INVOICE" billing matrix, "Fiber Tap
// Report") from captured app data, so a splicing subcontractor's digital
// entry produces the exact spreadsheets the office already expects.
//
// The per-enclosure sheet (exportSpliceEnclosureExcel) uses `exceljs`, since
// it needs real cell fill colors (see that function's doc comment). The
// other two exports below have no color requirement and use the same
// dynamic `await import('xlsx')` + XLSX.writeFile convention as
// invoiceExport.ts, writing cells at explicit addresses (via
// XLSX.utils.encode_cell) instead of json_to_sheet, since these layouts have
// header fields scattered at named cells plus a large tabular matrix body,
// not a simple one-row-per-record shape.
// ---------------------------------------------------------------------------

import type { FieldMarkup, FiberTapReport, Invoice, MarkupBilling, Project, SpliceEnclosure } from '../types'
import { triggerDownload } from './kmzExport'

/** One fill color per span index (0 = input, 1-7 = outputs) — read directly
 *  from the real "BLANK FIBER SPLICING INVOICE.xlsx" → "BLANK SPLICING
 *  TEMPLATE" tab (exact ARGB values pulled cell-by-cell with exceljs, not
 *  guessed from the PDF screenshot). Reused for both the "Input/Output Ftg"
 *  bar in the header block and the matching column-group header in the
 *  fiber matrix, exactly as the real sheet does — that's the system that
 *  lets the two be traced against each other at a glance. Span 5 genuinely
 *  has no fill in the real template (plain white) — that's not a gap in
 *  this data, the source file really leaves it uncolored. */
const SPAN_PALETTE = ['FF0000FF', 'FFFF9900', 'FF00FF00', 'FF980000', 'FFB7B7B7', null, 'FFFF0000', 'FF000000']
/** Font color paired with each span's fill above — also read directly from
 *  the source file; the dark fills (blue/maroon/red/black) use white text,
 *  the light/no-fill ones use the default black. */
const SPAN_FONT = ['FFFFFFFF', undefined, undefined, 'FFFFFFFF', undefined, undefined, 'FFFFFFFF', 'FFFFFFFF']
function spanColor(spanIndex: number): string | null {
  return SPAN_PALETTE[spanIndex] ?? null
}
function spanFont(spanIndex: number): string | undefined {
  return SPAN_FONT[spanIndex]
}

/** The 10 billing codes that appear as columns on the real "EXAMPLE INVOICE"
 *  matrix, in the same left-to-right order as the real sheet. */
export const SPLICE_MATRIX_CODES = ['FS16', 'FS07A', 'FS01', 'FS02', 'FS03', 'FS08', 'AS24', 'FS15', 'MC01A', 'FS14'] as const

const SPLICE_MATRIX_DESCRIPTIONS: Record<string, string> = {
  FS16: 'NEW ENCLOSURE',
  FS07A: 'New enclosure (tap), mid sheath entry, splice 1-4 fibers.',
  FS01: '1-24 SPLICES',
  FS02: '25-96 SPLICES',
  FS03: '97+ SPLICES',
  FS08: 'RE-ENTER',
  AS24: 'De/Re Enclosure',
  FS15: 'Replace / Upgrade Existing Enclosure',
  MC01A: 'Hang OLT',
  FS14: 'Hourly (Must be pre-approved)',
}

/** Every splicing billing code known to the app (superset of the 10 matrix
 *  columns above) — used to decide whether an invoice has any splicing
 *  content worth offering the matrix export for. */
const ALL_SPLICE_CODES = new Set([...SPLICE_MATRIX_CODES, 'FS04', 'FS07', 'FS10', 'FS13', 'US01'])

export function isSpliceRateCode(rateCode: string): boolean {
  return ALL_SPLICE_CODES.has(rateCode.trim().toUpperCase())
}

type CellValue = string | number | boolean

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setCell(ws: any, XLSX: typeof import('xlsx'), row0: number, col0: number, value: CellValue | null | undefined) {
  if (value == null || value === '') return
  const addr = XLSX.utils.encode_cell({ r: row0, c: col0 })
  ws[addr] = { t: typeof value === 'number' ? 'n' : typeof value === 'boolean' ? 'b' : 's', v: value }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function growRef(ws: any, XLSX: typeof import('xlsx'), row0: number, col0: number) {
  const existing = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: row0, c: col0 }, e: { r: row0, c: col0 } }
  existing.s.r = Math.min(existing.s.r, row0); existing.s.c = Math.min(existing.s.c, col0)
  existing.e.r = Math.max(existing.e.r, row0); existing.e.c = Math.max(existing.e.c, col0)
  ws['!ref'] = XLSX.utils.encode_range(existing)
}

/** Recreates "BLANK SPLICING TEMPLATE" — the per-enclosure detail sheet —
 *  filled from a captured SpliceEnclosure + its parent FieldMarkup (for GPS).
 *  Every cell address, merge range, and fill/font color below was read
 *  directly out of the real "BLANK FIBER SPLICING INVOICE.xlsx" workbook
 *  (its 3rd tab) with exceljs, not eyeballed from a screenshot — see the
 *  span palette's doc comment above for how those colors were sourced.
 *
 *  Uses `exceljs` (not the `xlsx` package used by the other two exports
 *  below) because this sheet needs real cell fill colors — SheetJS's free
 *  `xlsx` package can only round-trip existing styles on read, it can't
 *  author new ones on write; `exceljs` (MIT, free) supports full fill/font
 *  authoring, which is what actually reproduces the real template's
 *  color-coded bars instead of plain black-on-white text. */
export async function exportSpliceEnclosureExcel(
  enclosure: SpliceEnclosure,
  markup: Pick<FieldMarkup, 'capturedLat' | 'capturedLng' | 'workDate' | 'createdAt'>,
  project: Project | undefined,
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet((enclosure.enclosureType || 'Enclosure').slice(0, 28))
  ws.properties.tabColor = { argb: 'FF92D050' } // real template's tab color
  for (let c = 2; c <= 25; c++) ws.getColumn(c).width = 14.43 // real template: every col B-Y is this width
  for (let r = 4; r <= 21; r++) ws.getRow(r).height = 15.75   // real template's row heights
  ws.getRow(20).height = 15
  ws.getRow(22).height = 15

  type SetOpts = {
    bold?: boolean; italic?: boolean; fill?: string | null; color?: string
    merge?: [number, number]; size?: number; fontName?: string; center?: boolean
  }
  const set = (row1: number, col1: number, value: string | number | null | undefined, opts?: SetOpts) => {
    if (opts?.merge) ws.mergeCells(row1, col1, opts.merge[0], opts.merge[1])
    const cell = ws.getCell(row1, col1)
    if (value != null && value !== '') cell.value = value
    if (opts?.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } }
    cell.font = {
      name: opts?.fontName ?? 'Arial', size: opts?.size ?? 10,
      bold: !!opts?.bold, italic: !!opts?.italic,
      color: opts?.color ? { argb: opts.color } : undefined,
    }
    if (opts?.center) cell.alignment = { horizontal: 'center' }
  }
  const GRAY = 'FFEFEFEF'      // header-label alternating band + data-row alternating band
  const MINT = 'FFD9EAD3'      // "notes and/or concerns" banner + "NOC REPORT" title
  const LIGHT_BLUE = 'FFCFE2F3' // NOC sub-field labels

  // Header identity block — column B labels alternate shaded/plain exactly
  // as the real template does (Arial 12 bold), column C (or C:D / C:F where
  // the real sheet merges a wider value box) holds the value (Arial 10).
  set(2, 2, 'Job number', { fill: GRAY, bold: true, size: 12 });     set(2, 3, enclosure.jobNumber)
  set(3, 2, 'Job name', { bold: true, size: 12 });                   set(3, 3, enclosure.jobName)
  set(4, 2, 'Date:', { fill: GRAY, bold: true, size: 12 });          set(4, 3, enclosure.updatedAt ?? markup.workDate ?? enclosure.createdAt.slice(0, 10))
  set(5, 2, 'Splice ID:', { bold: true, size: 12 });                 set(5, 3, enclosure.spliceId)
  set(6, 2, 'Enclosure:', { fill: GRAY, bold: true, size: 12 });     set(6, 3, enclosure.enclosureType, { merge: [6, 4] })
  set(7, 2, 'Map Number', { bold: true, size: 12 });                 set(7, 3, enclosure.mapNumber, { merge: [7, 4] })
  set(8, 2, 'No. of Trays:', { fill: GRAY, bold: true, size: 12 });  set(8, 3, enclosure.trayCount)
  set(9, 2, 'Location:', { bold: true, size: 12 });                  set(9, 3, enclosure.location, { merge: [9, 6] })
  set(10, 2, 'Latitude:', { fill: GRAY, bold: true, size: 12 });     set(10, 3, markup.capturedLat != null ? `${markup.capturedLat} N` : null)
  set(11, 2, 'Longitude:', { bold: true, size: 12 });                set(11, 3, markup.capturedLng != null ? `${markup.capturedLng} W` : null)

  // "notes and/or concerns" — 2-row-tall mint banner (H4:O5), giant Verdana
  // 24pt bold-italic title exactly as the real template renders it (nothing
  // else on this sheet uses that font/size), then a big H6:O19 block for the
  // actual notes text (real sheet merges this whole 14-row area into one
  // cell for pasted photos/notes) in the sheet's normal Arial 10.
  set(4, 8, 'notes and/or concerns', { fill: MINT, italic: true, bold: true, size: 24, fontName: 'Verdana', center: true, merge: [5, 15] })
  set(6, 8, enclosure.notes, { merge: [19, 15] })

  // NOC REPORT box.
  set(4, 17, 'NOC REPORT', { fill: MINT, bold: true, center: true, merge: [4, 19] })
  set(5, 17, 'TICKET #', { fill: LIGHT_BLUE, bold: true }); set(5, 18, enclosure.noc.ticketNumber, { merge: [5, 19] })
  set(6, 17, 'TIME IN:', { fill: LIGHT_BLUE, bold: true }); set(6, 18, 'TW REP', { fill: LIGHT_BLUE, bold: true }); set(6, 19, 'CLEAR', { fill: LIGHT_BLUE, bold: true })
  set(7, 17, enclosure.noc.timeIn); set(7, 18, enclosure.noc.twRep); set(7, 19, enclosure.noc.clear ? 'X' : '')
  set(8, 17, 'TIME OUT:', { fill: LIGHT_BLUE, bold: true }); set(8, 18, enclosure.noc.timeOut)
  set(11, 17, 'AUDITOR:', { fill: LIGHT_BLUE, bold: true }); set(11, 18, enclosure.noc.auditor, { merge: [11, 20] })

  // Color legend — static reference box, same on every real enclosure sheet.
  // It doesn't exist as real cell data in the source workbook (confirmed by
  // scanning every cell) — it's a floating text box overlaid on the grid, so
  // this can't be pixel-exact, but the real sheet visibly has it in this
  // same top-right area (right of the NOC box), so it's reproduced here as
  // ordinary colored cells in roughly that position.
  set(2, 22, 'continuous - yellow', { fill: 'FF000000', color: 'FFFFD700', bold: true, merge: [2, 26] })
  set(3, 22, 'dead fibers - red', { fill: 'FF000000', color: 'FFFF4040', bold: true, merge: [3, 26] })
  set(4, 22, 'fibers spliced- blue', { fill: 'FF000000', color: 'FF4FA8FF', bold: true, merge: [4, 26] })
  set(5, 22, 'splitters may be multiple colors', { fill: 'FF000000', color: 'FFFFFFFF', bold: true, merge: [5, 26] })

  // Input/Output Ftg — label cell (B, Arial 12 bold) and value cell (C,
  // merged to F, Arial 10 bold) share the same span color, both centered;
  // spanIndex 0 = input, 1-7 = the 7 output rows.
  const inputSpan = enclosure.spans.find((s) => s.spanIndex === 0)
  const outputSpans = enclosure.spans.filter((s) => s.spanIndex > 0).sort((a, b) => a.spanIndex - b.spanIndex)
  const ftgRow = (row1: number, text: string, spanIndex: number, spanLabel: string | undefined) => {
    const fill = spanColor(spanIndex); const font = spanFont(spanIndex)
    set(row1, 2, text, { fill, color: font, bold: true, size: 12, center: true })
    set(row1, 3, spanLabel, { fill, color: font, bold: true, center: true, merge: [row1, 6] })
  }
  ftgRow(12, 'Input Ftg:', 0, inputSpan?.label)
  for (let i = 0; i < 7; i++) ftgRow(13 + i, 'Output Ftg:', i + 1, outputSpans[i]?.label)

  // Span/fiber matrix — one 3-column group per span (B-D, E-G, H-J, ...),
  // spanIndex 0 (input) in group 0, spanIndex 1-7 (outputs) in groups 1-7.
  // Row 21: all 3 columns of the group filled with the span color, value
  // (the span's own label) in the MIDDLE column only — not merged in the
  // real sheet, just 3 individually-colored cells that read as one bar.
  // Row 22: same 3-color fill, "Span Id" in the first column, "0" in the
  // other two (present in the real template with no clear purpose beyond
  // layout — kept for fidelity). Rows 23-24: plain column headers.
  // Row 25+: fiber data, alternating gray/plain row banding exactly as the
  // real template's pre-filled reference table does. All centered.
  for (const span of enclosure.spans) {
    const g = 2 + span.spanIndex * 3 // B=2
    const fill = spanColor(span.spanIndex); const font = spanFont(span.spanIndex)
    set(21, g, null, { fill, color: font, center: true });
    set(21, g + 1, span.label, { fill, color: font, bold: true, center: true });
    set(21, g + 2, null, { fill, color: font, center: true })
    set(22, g, 'Span Id', { fill, color: font, bold: true, center: true })
    set(22, g + 1, 0, { fill, color: font, bold: true, center: true })
    set(22, g + 2, 0, { fill, color: font, bold: true, center: true })
    set(23, g, 'Fiber', { bold: true, center: true }); set(23, g + 1, 'Tube', { bold: true, center: true }); set(23, g + 2, 'Fiber', { bold: true, center: true })
    set(24, g, 'Number', { bold: true, center: true }); set(24, g + 1, 'Color', { bold: true, center: true }); set(24, g + 2, 'Color', { bold: true, center: true })
    span.fibers.forEach((f, i) => {
      const row1 = 25 + i
      const band = row1 % 2 === 1 ? GRAY : null
      set(row1, g, f.fiberNumber, { fill: band, center: true })
      set(row1, g + 1, f.tubeColor, { fill: band, center: true })
      set(row1, g + 2, f.fiberColor, { fill: band, center: true })
    })
  }

  const buffer = await wb.xlsx.writeBuffer()
  const filenameSafe = (enclosure.spliceId || project?.name || 'splice-enclosure').replace(/[\\/:*?"<>|]/g, '-')
  triggerDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${filenameSafe}.xlsx`,
  )
}

/** Recreates the "EXAMPLE INVOICE" billing matrix — one row per enclosure
 *  referenced by the invoice's line items, one column per splice billing
 *  code, quantity per cell, TOTALS row. `lineRows` are the invoice's
 *  resolved MarkupBilling rows; `enclosureBySpliceMarkupId` resolves each
 *  line's markupId to its SpliceEnclosure (when one exists) for the
 *  "ENCLOSURE NAME" column — falls back to the markup's own label/workId so
 *  a mixed invoice with non-splicing lines doesn't crash the export. */
export async function exportSplicingInvoiceMatrixExcel(
  invoice: Invoice,
  lineRows: { billing: MarkupBilling; markup: FieldMarkup | undefined; enclosure: SpliceEnclosure | undefined }[],
): Promise<void> {
  const XLSX = await import('xlsx')
  const ws: import('xlsx').WorkSheet = {}
  const put = (row1: number, col1: number, v: CellValue | null | undefined) => {
    setCell(ws, XLSX, row1 - 1, col1 - 1, v)
    growRef(ws, XLSX, row1 - 1, col1 - 1)
  }

  put(1, 1, 'INVOICE')
  put(1, 8, 'WEEK START-END')
  put(1, 10, invoice.billingPeriodStart); put(1, 11, invoice.billingPeriodEnd)
  put(2, 9, 'Invoice #'); put(2, 10, invoice.number)
  put(3, 9, 'OLT#'); put(3, 10, invoice.oltNumber)
  put(4, 9, 'PRISM#'); put(4, 10, invoice.prismId)

  put(7, 1, 'Sub Invoice number that is totaled on billing sheet with invoice number created ')
  put(7, 2, 'ENCLOSURE NAME')
  SPLICE_MATRIX_CODES.forEach((code, i) => {
    put(6, 3 + i, code)
    put(7, 3 + i, SPLICE_MATRIX_DESCRIPTIONS[code])
  })

  // One row per distinct enclosure referenced by the invoice's line items.
  const enclosureKeyOf = (row: (typeof lineRows)[number]) =>
    row.enclosure?.id ?? row.markup?.id ?? row.billing.markupId
  const enclosureOrder: string[] = []
  const enclosureLabel = new Map<string, string>()
  const quantities = new Map<string, Map<string, number>>()
  for (const row of lineRows) {
    const key = enclosureKeyOf(row)
    if (!enclosureOrder.includes(key)) {
      enclosureOrder.push(key)
      enclosureLabel.set(key, row.enclosure?.spliceId || row.markup?.workId || row.markup?.label || key)
      quantities.set(key, new Map())
    }
    const code = row.billing.rateCode.trim().toUpperCase()
    if (!SPLICE_MATRIX_CODES.includes(code as (typeof SPLICE_MATRIX_CODES)[number])) continue
    const m = quantities.get(key)!
    m.set(code, (m.get(code) ?? 0) + row.billing.quantity)
  }

  let r = 8
  const totals = new Map<string, number>()
  for (const key of enclosureOrder) {
    put(r, 1, invoice.number)
    put(r, 2, enclosureLabel.get(key))
    const m = quantities.get(key)!
    SPLICE_MATRIX_CODES.forEach((code, i) => {
      const q = m.get(code)
      if (q) { put(r, 3 + i, q); totals.set(code, (totals.get(code) ?? 0) + q) }
    })
    r += 1
  }
  put(r, 1, invoice.number)
  put(r, 2, 'TOTALS')
  SPLICE_MATRIX_CODES.forEach((code, i) => put(r, 3 + i, totals.get(code) ?? 0))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'BLANK INVOICE')
  XLSX.writeFile(wb, `${invoice.number}-splicing-matrix.xlsx`)
}

/** Link Loss is a formula in the real sheet — launch power minus the port's
 *  measured dBm reading — not a fixed abs() heuristic. Exported here so
 *  FiberTapReportForm's live auto-calc uses the exact same math as the
 *  export, instead of two different approximations drifting apart. */
export function computeLinkLossDb(opticalPowerDbm: number | null, portDbm: number | null): number | null {
  if (portDbm == null) return null
  return (opticalPowerDbm ?? 0) - portDbm
}

/** Recreates "EXAMPLE FIBER TAP REPORT" — every cell address, merge, column
 *  width, row height, font, and fill below was read directly out of the real
 *  workbook with exceljs (not guessed), same as exportSpliceEnclosureExcel
 *  above. Uses exceljs for the same reason — real fill/font authoring. */
export async function exportFiberTapReportExcel(report: FiberTapReport): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Fiber Tap Report')
  ws.properties.tabColor = { argb: 'FFFF0000' } // real template's tab color

  const widths: Record<number, number> = { 1: 9.1, 2: 32.55, 3: 27.66, 4: 27.66, 5: 27.66, 6: 27.66, 23: 9.1 }
  for (let c = 7; c <= 14; c++) widths[c] = 10.66  // Tap Port dBm columns
  for (let c = 15; c <= 22; c++) widths[c] = 11.66 // Link Loss columns
  for (const [c, w] of Object.entries(widths)) ws.getColumn(Number(c)).width = w
  for (let r = 2; r <= 7; r++) ws.getRow(r).height = 30
  ws.getRow(9).height = 29.4

  const CREAM = 'FFFEF2CB'       // header value cells
  const LABEL_BLUE = 'FFD9E2F3'  // Fiber Tap Name/Type/Ports/Spliced/Buffer columns (label row + data)
  const PORT_BLUE = 'FFBDD6EE'   // Tap Port dBm columns (label row + data)
  const LOSS_GRAY = 'FFD0CECE'   // Link Loss columns (label row + data)

  type SetOpts = { bold?: boolean; fill?: string; merge?: [number, number]; center?: boolean; wrap?: boolean }
  const set = (row1: number, col1: number, value: string | number | null | undefined, opts?: SetOpts) => {
    if (opts?.merge) ws.mergeCells(row1, col1, row1, opts.merge[1])
    const cell = ws.getCell(row1, col1)
    if (value != null && value !== '') cell.value = value
    if (opts?.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } }
    cell.font = { name: 'Calibri', size: 11, bold: !!opts?.bold }
    cell.alignment = { vertical: 'middle', horizontal: opts?.center ? 'center' : undefined, wrapText: !!opts?.wrap }
  }

  // Header identity block — labels in B/D (bold, no fill), values in C/E
  // (centered, cream fill) — two label/value pairs side by side per row.
  set(2, 2, 'PRISM ID', { bold: true });                              set(2, 3, report.prismId, { fill: CREAM, center: true })
  set(2, 4, 'Optical Source at Launch Site', { bold: true });          set(2, 5, report.opticalSourceLabel, { fill: CREAM, center: true })
  set(3, 2, 'Node Number', { bold: true });                            set(3, 3, report.nodeNumber, { fill: CREAM, center: true })
  set(3, 4, 'Optical Power at Launch \n(dBm)', { bold: true, wrap: true }); set(3, 5, report.opticalPowerDbm, { fill: CREAM, center: true })
  set(4, 2, 'Node Location / Optical Launch Site', { bold: true });    set(4, 3, report.nodeLocation, { fill: CREAM, center: true })
  set(4, 4, 'Wavelenght Used at Launch (nm)', { bold: true });         set(4, 5, report.wavelengthNm, { fill: CREAM, center: true })
  set(5, 2, 'Contractor Company', { bold: true });                    set(5, 3, report.contractorCompany, { fill: CREAM, center: true })
  set(6, 2, 'Splicer Name', { bold: true });                          set(6, 3, report.splicerName, { fill: CREAM, center: true })

  // Small node-type -> expected-port-count reference legend, far right.
  set(7, 27, 'Node '); set(7, 28, 'MST'); set(7, 29, 2)
  set(8, 27, 'Light Source'); set(8, 28, 'OTE'); set(8, 29, 4)
  set(9, 29, 8)

  // "Must be measured" instruction note spanning the dBm columns.
  set(8, 7, 'Must be measured ', { center: true, wrap: true, merge: [8, 14] })

  // Column headers, row 9 — three color-coded groups matching the data
  // columns below them exactly (not alternating rows; the whole column
  // group keeps one color).
  set(9, 2, 'Fiber Tap Name/Number', { fill: LABEL_BLUE, bold: true, center: true })
  set(9, 3, 'Fiber Tap Type', { fill: LABEL_BLUE, bold: true, center: true })
  set(9, 4, 'Number of Tap Ports', { fill: LABEL_BLUE, bold: true, center: true })
  set(9, 5, 'Number of Tap Ports Spliced', { fill: LABEL_BLUE, bold: true, center: true })
  set(9, 6, 'Buffer and Fiber Color \nSpliced to Tap Port #1', { fill: LABEL_BLUE, bold: true, center: true, wrap: true })
  for (let p = 1; p <= 8; p++) set(9, 6 + p, `Tap Port #${p} \n(dBm)`, { fill: PORT_BLUE, bold: true, center: true, wrap: true })
  for (let p = 1; p <= 8; p++) set(9, 14 + p, `Link Loss #${p} \n(dB)`, { fill: LOSS_GRAY, bold: true, center: true, wrap: true })

  report.taps.forEach((tap, i) => {
    const row = 10 + i
    set(row, 2, tap.tapName, { fill: LABEL_BLUE, center: true })
    set(row, 3, tap.tapType, { fill: LABEL_BLUE, center: true })
    set(row, 4, tap.portCount, { fill: LABEL_BLUE, center: true })
    set(row, 5, tap.portsSpliced, { fill: LABEL_BLUE, center: true })
    set(row, 6, tap.bufferFiberColorToPort1, { fill: LABEL_BLUE, center: true })
    for (const port of tap.ports) {
      if (port.portNumber < 1 || port.portNumber > 8) continue
      set(row, 6 + port.portNumber, port.dbm, { fill: PORT_BLUE, center: true })
      set(row, 14 + port.portNumber, computeLinkLossDb(report.opticalPowerDbm, port.dbm), { fill: LOSS_GRAY, center: true })
    }
  })

  const buffer = await wb.xlsx.writeBuffer()
  const filenameSafe = (report.nodeNumber || report.prismId || 'fiber-tap-report').replace(/[\\/:*?"<>|]/g, '-')
  triggerDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${filenameSafe}-fiber-tap-report.xlsx`,
  )
}
