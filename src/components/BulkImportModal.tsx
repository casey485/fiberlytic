import { useCallback, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import { useData } from '../store/DataContext'
import { Modal } from './ui/Modal'
import { Button, Field, Select } from './ui/Form'
import { moneyExact } from '../lib/format'
import type { RateCardDivision, UOM } from '../types'

// ---------------------------------------------------------------------------
// Column name aliases (lower-cased for matching)
// ---------------------------------------------------------------------------

const UNIT_CODE_ALIASES = ['unit code', 'unit_code', 'code', 'unit id', 'unitcode', 'item code', 'item']
const DESCRIPTION_ALIASES = ['description', 'desc', 'item description', 'work description']
const UOM_ALIASES = ['uom', 'unit of measure', 'unit', 'um', 'units']
const RATE_ALIASES = ['rate', 'sub rate', 'subrate', 'price', 'unit price', 'unit rate', 'contract rate', 'bid rate']

const VALID_UOMS: UOM[] = ['LF', 'EA', 'SQFT']
const DIVISIONS: RateCardDivision[] = ['Underground', 'Aerial']

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RowStatus = 'new' | 'update' | 'error' | 'warn'

interface ParsedRow {
  rowNum: number
  unitCode: string
  description: string
  uom: string
  rate: number | null
  status: RowStatus
  issues: string[]
}

interface WorkbookState {
  wb: XLSX.WorkBook
  sheetNames: string[]
  activeSheet: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findCol(headers: string[], aliases: string[]): number {
  const lower = headers.map((h) => String(h ?? '').toLowerCase().trim())
  for (const alias of aliases) {
    const idx = lower.indexOf(alias)
    if (idx !== -1) return idx
  }
  return -1
}

function parseRate(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/[$,\s]/g, ''))
  return isNaN(n) ? null : Math.round(n * 10000) / 10000
}

function normalizeUom(raw: string): string {
  const u = raw.toUpperCase().trim()
  if (u === 'LINEAR FOOT' || u === 'LINEAR FEET' || u === 'LIN FT' || u === 'L.F.' || u === 'LF') return 'LF'
  if (u === 'EACH' || u === 'EA' || u === 'EACH.' || u === 'PC' || u === 'PCS') return 'EA'
  if (u === 'SQFT' || u === 'SF' || u === 'SQ FT' || u === 'SQ. FT.' || u === 'SQUARE FEET') return 'SQFT'
  return u
}

function parseSheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  existingCodes: Set<string>,
  overwrite: boolean,
): ParsedRow[] {
  const ws = wb.Sheets[sheetName]
  if (!ws) return []

  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  if (raw.length < 2) return []

  // Find the header row (first row where we can identify at least unit_code + rate columns)
  let headerRowIdx = -1
  let colUnitCode = -1, colDesc = -1, colUom = -1, colRate = -1

  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    const row = raw[i].map((c) => String(c ?? ''))
    const cu = findCol(row, UNIT_CODE_ALIASES)
    const cr = findCol(row, RATE_ALIASES)
    if (cu !== -1 && cr !== -1) {
      headerRowIdx = i
      colUnitCode = cu
      colDesc = findCol(row, DESCRIPTION_ALIASES)
      colUom = findCol(row, UOM_ALIASES)
      colRate = cr
      break
    }
  }

  if (headerRowIdx === -1) return []

  const results: ParsedRow[] = []

  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i]
    const rowNum = i + 1

    const unitCode = String(row[colUnitCode] ?? '').trim()
    const description = colDesc !== -1 ? String(row[colDesc] ?? '').trim() : ''
    const rawUom = colUom !== -1 ? String(row[colUom] ?? '').trim() : ''
    const uom = rawUom ? normalizeUom(rawUom) : ''
    const rate = parseRate(row[colRate])

    // Skip empty rows and header-like repeats
    if (!unitCode || unitCode.toLowerCase() === 'unit code' || unitCode.toLowerCase() === 'code') continue
    if (unitCode.startsWith('#')) continue // comment rows

    const issues: string[] = []
    let status: RowStatus = 'new'

    if (!unitCode) issues.push('Missing unit code')
    if (rate === null) issues.push('Invalid or missing rate')
    if (rate !== null && rate < 0) issues.push('Negative rate')
    if (!uom) issues.push('Missing UOM')
    else if (!VALID_UOMS.includes(uom as UOM)) issues.push(`Unknown UOM "${uom}" — will use as-is`)

    if (issues.some((msg) => msg.includes('Invalid') || msg.includes('Missing unit') || msg.includes('Negative'))) {
      status = 'error'
    } else if (issues.length > 0) {
      status = 'warn'
    } else if (existingCodes.has(unitCode.toUpperCase())) {
      status = overwrite ? 'update' : 'warn'
      if (!overwrite) issues.push('Duplicate — will skip (enable overwrite to replace)')
    } else {
      status = 'new'
    }

    results.push({ rowNum, unitCode, description, uom, rate, status, issues })
  }

  return results
}

// ---------------------------------------------------------------------------
// BulkImportModal
// ---------------------------------------------------------------------------

export function BulkImportModal({ onClose }: { onClose: () => void }) {
  const { data, addRateCard, addRateCardUnit, updateRateCardUnit } = useData()

  const [clientId, setClientId] = useState(data.clients[0]?.id ?? '')
  const [division, setDivision] = useState<RateCardDivision>('Underground')
  const [rateCardId, setRateCardId] = useState<string>('__new__')
  const [newCardName, setNewCardName] = useState('')
  const [newCardDate, setNewCardDate] = useState(new Date().toISOString().slice(0, 10))
  const [overwrite, setOverwrite] = useState(false)
  const [wbState, setWbState] = useState<WorkbookState | null>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Rate cards matching current client + division
  const matchingCards = data.rateCards.filter(
    (rc) => rc.clientId === clientId && rc.division === division,
  )

  const existingCodes = (): Set<string> => {
    const cardId = rateCardId === '__new__' ? null : rateCardId
    if (!cardId) return new Set()
    return new Set(
      data.rateCardUnits
        .filter((u) => u.rateCardId === cardId)
        .map((u) => u.unitCode.toUpperCase()),
    )
  }

  const reparse = useCallback(
    (wb: XLSX.WorkBook, sheet: string, ow: boolean) => {
      setRows(parseSheet(wb, sheet, existingCodes(), ow))
    },
    // existingCodes is derived from data — intentionally not in deps (re-derive on call)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.rateCardUnits, rateCardId],
  )

  const handleFile = (file: File) => {
    if (!file) return
    setFileName(file.name)
    setImportResult(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const buf = e.target?.result as ArrayBuffer
      const wb = XLSX.read(buf, { type: 'array' })
      const state: WorkbookState = {
        wb,
        sheetNames: wb.SheetNames,
        activeSheet: wb.SheetNames[0],
      }
      setWbState(state)
      setRows(parseSheet(wb, state.activeSheet, existingCodes(), overwrite))
    }
    reader.readAsArrayBuffer(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const onSheetChange = (sheet: string) => {
    if (!wbState) return
    const next = { ...wbState, activeSheet: sheet }
    setWbState(next)
    reparse(wbState.wb, sheet, overwrite)
  }

  const onOverwriteChange = (checked: boolean) => {
    setOverwrite(checked)
    if (wbState) reparse(wbState.wb, wbState.activeSheet, checked)
  }

  const importableRows = rows.filter((r) => {
    if (r.status === 'error') return false
    if (r.status === 'update' && !overwrite) return false
    if (r.issues.some((i) => i.includes('Duplicate') && !overwrite)) return false
    return true
  })
  const errorCount = rows.filter((r) => r.status === 'error').length
  const newCount = rows.filter((r) => r.status === 'new').length
  const updateCount = rows.filter((r) => r.status === 'update').length
  const warnCount = rows.filter((r) => r.status === 'warn').length

  const canImport = importableRows.length > 0 && clientId && (rateCardId !== '__new__' || newCardName.trim())

  const doImport = () => {
    if (!canImport) return
    setImporting(true)

    let targetCardId = rateCardId
    if (rateCardId === '__new__') {
      const card = addRateCard({
        clientId,
        division,
        name: newCardName.trim(),
        effectiveDate: newCardDate,
      })
      targetCardId = card.id
    }

    const existing = new Map(
      data.rateCardUnits
        .filter((u) => u.rateCardId === targetCardId)
        .map((u) => [u.unitCode.toUpperCase(), u]),
    )

    let added = 0
    let updated = 0
    for (const row of importableRows) {
      if (row.rate === null) continue
      const code = row.unitCode.toUpperCase()
      const uom = (VALID_UOMS.includes(row.uom as UOM) ? row.uom : 'EA') as UOM
      const existingUnit = existing.get(code)
      if (existingUnit && overwrite) {
        updateRateCardUnit(existingUnit.id, {
          description: row.description || existingUnit.description,
          uom,
          rate: row.rate,
        })
        updated++
      } else if (!existingUnit) {
        addRateCardUnit({
          rateCardId: targetCardId,
          unitCode: code,
          description: row.description,
          uom,
          rate: row.rate,
        })
        added++
      }
    }

    setImporting(false)
    setImportResult(`Imported ${added} new unit${added !== 1 ? 's' : ''}${updated > 0 ? `, updated ${updated}` : ''}.`)
  }

  const statusIcon = (s: RowStatus) => {
    if (s === 'new') return <CheckCircle size={13} className="text-emerald-500" />
    if (s === 'update') return <RefreshCw size={13} className="text-brand-500" />
    if (s === 'warn') return <AlertTriangle size={13} className="text-amber-500" />
    return <XCircle size={13} className="text-rose-500" />
  }

  const statusRowClass = (s: RowStatus) => {
    if (s === 'error') return 'bg-rose-50/60'
    if (s === 'update') return 'bg-brand-50/40'
    if (s === 'warn') return 'bg-amber-50/40'
    return ''
  }

  return (
    <Modal open onClose={onClose} title="Bulk Import Rate Card Units" size="xl" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={doImport} disabled={!canImport || importing}>
          {importing ? 'Importing…' : `Import ${importableRows.length} row${importableRows.length !== 1 ? 's' : ''}`}
        </Button>
      </>
    }>
      {importResult ? (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <CheckCircle size={40} className="text-emerald-500" />
          <p className="text-lg font-semibold text-slate-800">{importResult}</p>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Step 1: Target */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">1 · Target rate card</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Client">
                <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  {data.clients.length === 0 && <option value="">No clients — add one first</option>}
                  {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Division">
                <Select value={division} onChange={(e) => setDivision(e.target.value as RateCardDivision)}>
                  {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </Select>
              </Field>
              <Field label="Rate card">
                <Select value={rateCardId} onChange={(e) => setRateCardId(e.target.value)}>
                  <option value="__new__">+ Create new rate card</option>
                  {matchingCards.map((rc) => (
                    <option key={rc.id} value={rc.id}>{rc.name}</option>
                  ))}
                </Select>
              </Field>
            </div>

            {rateCardId === '__new__' && (
              <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <Field label="New card name">
                  <input
                    value={newCardName}
                    onChange={(e) => setNewCardName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                    placeholder={`${data.clients.find((c) => c.id === clientId)?.name ?? 'Client'} ${division} 2025`}
                  />
                </Field>
                <Field label="Effective date">
                  <input
                    type="date"
                    value={newCardDate}
                    onChange={(e) => setNewCardDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                </Field>
              </div>
            )}
          </div>

          {/* Step 2: Upload */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">2 · Upload Excel file</p>
            <div
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-8 transition ${
                dragging ? 'border-brand-400 bg-brand-50' : 'border-slate-300 bg-slate-50 hover:border-brand-300 hover:bg-brand-50/40'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              {fileName ? (
                <>
                  <FileSpreadsheet size={28} className="text-emerald-500" />
                  <p className="text-sm font-medium text-slate-700">{fileName}</p>
                  <p className="text-xs text-slate-400">Click or drop to replace</p>
                </>
              ) : (
                <>
                  <Upload size={28} className="text-slate-400" />
                  <p className="text-sm font-medium text-slate-600">Drop Excel file here or click to browse</p>
                  <p className="text-xs text-slate-400">.xlsx, .xls, .csv supported</p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
            </div>

            {/* Sheet selector */}
            {wbState && wbState.sheetNames.length > 1 && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-500">Sheet:</span>
                <Select value={wbState.activeSheet} onChange={(e) => onSheetChange(e.target.value)} className="w-48 text-xs">
                  {wbState.sheetNames.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
            )}
          </div>

          {/* Step 3: Preview */}
          {rows.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">3 · Preview ({rows.length} rows)</p>
                <div className="flex items-center gap-3 text-xs">
                  {newCount > 0 && <span className="flex items-center gap-1 text-emerald-600"><CheckCircle size={11} /> {newCount} new</span>}
                  {updateCount > 0 && <span className="flex items-center gap-1 text-brand-600"><RefreshCw size={11} /> {updateCount} update</span>}
                  {warnCount > 0 && <span className="flex items-center gap-1 text-amber-600"><AlertTriangle size={11} /> {warnCount} warn</span>}
                  {errorCount > 0 && <span className="flex items-center gap-1 text-rose-600"><XCircle size={11} /> {errorCount} error</span>}
                  <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-600">
                    <input type="checkbox" checked={overwrite} onChange={(e) => onOverwriteChange(e.target.checked)} className="rounded border-slate-300" />
                    Overwrite duplicates
                  </label>
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="px-3 py-2 font-medium w-6"></th>
                      <th className="px-3 py-2 font-medium">Code</th>
                      <th className="px-3 py-2 font-medium">Description</th>
                      <th className="px-3 py-2 font-medium">UOM</th>
                      <th className="px-3 py-2 text-right font-medium">Rate</th>
                      <th className="px-3 py-2 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.rowNum} className={`border-t border-slate-100 ${statusRowClass(row.status)}`}>
                        <td className="px-3 py-1.5 text-center">{statusIcon(row.status)}</td>
                        <td className="px-3 py-1.5 font-mono font-semibold text-brand-700">{row.unitCode}</td>
                        <td className="px-3 py-1.5 text-slate-700 max-w-[180px] truncate">{row.description || <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-1.5 text-slate-500">{row.uom || <span className="text-rose-400">?</span>}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-slate-800">
                          {row.rate !== null ? moneyExact(row.rate) : <span className="text-rose-400">?</span>}
                        </td>
                        <td className="px-3 py-1.5 text-slate-400 max-w-[160px]">
                          {row.issues.length > 0 ? (
                            <span className={row.status === 'error' ? 'text-rose-500' : row.status === 'warn' ? 'text-amber-600' : ''}>
                              {row.issues.join('; ')}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {rows.length === 0 && (
                <p className="mt-2 text-xs text-rose-500">
                  Could not find recognizable column headers. Expected columns like "Unit Code", "Description", "UOM", "Rate".
                </p>
              )}
            </div>
          )}

          {/* Column mapping hint */}
          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer hover:text-slate-600">Expected column names</summary>
            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
              <p><span className="font-medium text-slate-600">Unit Code:</span> "Unit Code", "Code", "Unit ID", "Item Code"</p>
              <p><span className="font-medium text-slate-600">Description:</span> "Description", "Desc", "Work Description"</p>
              <p><span className="font-medium text-slate-600">UOM:</span> "UOM", "Unit", "Unit of Measure"</p>
              <p><span className="font-medium text-slate-600">Rate:</span> "Rate", "Sub Rate", "Price", "Unit Price", "Contract Rate"</p>
              <p className="mt-1 text-slate-400">Headers are case-insensitive. Column order doesn't matter. Extra columns are ignored.</p>
            </div>
          </details>
        </div>
      )}
    </Modal>
  )
}
