import { useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle, XCircle, RefreshCw, ChevronDown } from 'lucide-react'
import { useData } from '../store/DataContext'
import { Modal } from './ui/Modal'
import { Button, Field, Select } from './ui/Form'
import { moneyExact } from '../lib/format'
import type { RateCardDivision, UOM } from '../types'

// ── Column aliases (lower-cased) ─────────────────────────────────────────────

const UNIT_CODE_ALIASES = [
  'unit code', 'unit_code', 'code', 'unit id', 'unitcode', 'item code',
  'item', 'item #', 'item no', 'item number', 'bid item', 'pay item',
]
const DESCRIPTION_ALIASES = [
  'description', 'desc', 'item description', 'work description', 'scope', 'work item', 'activity',
]
const UOM_ALIASES = [
  'uom', 'unit of measure', 'unit', 'um', 'units', 'measure', 'u/m',
]
const RATE_ALIASES = [
  'rate', 'sub rate', 'subrate', 'price', 'unit price', 'unit rate',
  'contract rate', 'bid rate', 'labor rate', 'amount', 'cost', 'unit cost',
]

const VALID_UOMS: UOM[] = ['LF', 'EA', 'SQFT']
const DIVISIONS: RateCardDivision[] = ['Underground', 'Aerial']

// ── Types ────────────────────────────────────────────────────────────────────

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

interface ManualMap {
  unitCode: string
  description: string
  uom: string
  rate: string
}

interface ParseResult {
  rows: ParsedRow[]
  rawHeaders: string[]         // non-empty header candidates from first parseable row
  autoDetected: boolean        // true if all required cols found automatically
  colFound: { unitCode: boolean; desc: boolean; uom: boolean; rate: boolean }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  if (['LINEAR FOOT', 'LINEAR FEET', 'LIN FT', 'L.F.', 'LF'].includes(u)) return 'LF'
  if (['EACH', 'EA', 'EACH.', 'PC', 'PCS'].includes(u)) return 'EA'
  if (['SQFT', 'SF', 'SQ FT', 'SQ. FT.', 'SQUARE FEET'].includes(u)) return 'SQFT'
  return u
}

function parseSheetFull(
  wb: XLSX.WorkBook,
  sheetName: string,
  existingCodes: Set<string>,
  overwrite: boolean,
  manualMap?: ManualMap,
): ParseResult {
  const empty: ParseResult = { rows: [], rawHeaders: [], autoDetected: false, colFound: { unitCode: false, desc: false, uom: false, rate: false } }
  const ws = wb.Sheets[sheetName]
  if (!ws) return empty

  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  if (raw.length < 2) return empty

  let headerRowIdx = -1
  let colUnitCode = -1, colDesc = -1, colUom = -1, colRate = -1
  let rawHeaders: string[] = []
  let autoDetected = false

  // Scan first 15 rows for a header row
  for (let i = 0; i < Math.min(raw.length, 15); i++) {
    const row = raw[i].map((c) => String(c ?? '').trim())
    const nonEmpty = row.filter((c) => c.length > 0)
    if (nonEmpty.length === 0) continue

    // Always capture the first row with content as our raw headers (for manual mapping UI)
    if (rawHeaders.length === 0) rawHeaders = nonEmpty

    if (manualMap) {
      // Use manual mapping — find the row that contains the selected unitCode header
      const idx = row.indexOf(manualMap.unitCode)
      if (idx !== -1) {
        headerRowIdx = i
        colUnitCode = idx
        colDesc = manualMap.description ? row.indexOf(manualMap.description) : -1
        colUom = manualMap.uom ? row.indexOf(manualMap.uom) : -1
        colRate = manualMap.rate ? row.indexOf(manualMap.rate) : -1
        rawHeaders = nonEmpty
        break
      }
    } else {
      const cu = findCol(row, UNIT_CODE_ALIASES)
      const cr = findCol(row, RATE_ALIASES)
      if (cu !== -1 && cr !== -1) {
        headerRowIdx = i
        colUnitCode = cu
        colDesc = findCol(row, DESCRIPTION_ALIASES)
        colUom = findCol(row, UOM_ALIASES)
        colRate = cr
        rawHeaders = nonEmpty
        autoDetected = true
        break
      }
    }
  }

  const colFound = {
    unitCode: colUnitCode !== -1,
    desc: colDesc !== -1,
    uom: colUom !== -1,
    rate: colRate !== -1,
  }

  if (headerRowIdx === -1 || colUnitCode === -1 || colRate === -1) {
    return { rows: [], rawHeaders, autoDetected: false, colFound }
  }

  const rows: ParsedRow[] = []

  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i]
    const unitCode = String(row[colUnitCode] ?? '').trim()
    const description = colDesc !== -1 ? String(row[colDesc] ?? '').trim() : ''
    const rawUom = colUom !== -1 ? String(row[colUom] ?? '').trim() : ''
    const uom = rawUom ? normalizeUom(rawUom) : ''
    const rate = parseRate(row[colRate])

    if (!unitCode || unitCode.toLowerCase() === 'unit code' || unitCode.toLowerCase() === 'code') continue
    if (unitCode.startsWith('#')) continue

    const issues: string[] = []
    let status: RowStatus = 'new'

    if (rate === null) issues.push('Invalid or missing rate')
    if (rate !== null && rate < 0) issues.push('Negative rate')
    if (!uom) issues.push('Missing UOM')
    else if (!VALID_UOMS.includes(uom as UOM)) issues.push(`Unknown UOM "${uom}" — will save as-is`)

    if (issues.some((m) => m.includes('Invalid') || m.includes('Negative'))) {
      status = 'error'
    } else if (existingCodes.has(unitCode.toUpperCase())) {
      status = overwrite ? 'update' : 'warn'
      if (!overwrite) issues.push('Duplicate — check "Overwrite duplicates" to replace')
    } else if (issues.length > 0) {
      status = 'warn'
    }

    rows.push({ rowNum: i + 1, unitCode, description, uom, rate, status, issues })
  }

  return { rows, rawHeaders, autoDetected: autoDetected || !!manualMap, colFound }
}

// ── BulkImportModal ───────────────────────────────────────────────────────────

export function BulkImportModal({ onClose }: { onClose: () => void }) {
  const { data, addRateCard, addRateCardUnit, updateRateCardUnit } = useData()

  // ── Step 1 state ──
  const [clientId, setClientId] = useState(data.clients[0]?.id ?? '')
  const [divisions, setDivisions] = useState<RateCardDivision[]>([])
  const [rateCardId, setRateCardId] = useState<string>('__new__')
  const [newCardName, setNewCardName] = useState('')
  const [newCardDate, setNewCardDate] = useState(new Date().toISOString().slice(0, 10))
  const [overwrite, setOverwrite] = useState(false)

  // ── Step 2 state ──
  const [wbState, setWbState] = useState<WorkbookState | null>(null)
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Parse result state ──
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [rawHeaders, setRawHeaders] = useState<string[]>([])
  const [parseOk, setParseOk] = useState(false)
  const [showManualMap, setShowManualMap] = useState(false)
  const [manualMap, setManualMap] = useState<ManualMap>({ unitCode: '', description: '', uom: '', rate: '' })

  // ── Import state ──
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)

  const toggleDiv = (d: RateCardDivision) =>
    setDivisions((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])

  // Rate cards matching current client + any selected division
  const matchingCards = data.rateCards.filter(
    (rc) => rc.clientId === clientId &&
      (divisions.length === 0 || (rc.divisions ?? []).some((d) => divisions.includes(d))),
  )

  // Reset rate card selection when client or divisions changes
  useEffect(() => {
    setRateCardId('__new__')
  }, [clientId, divisions])

  // Derived: existing unit codes for the selected rate card
  const getExistingCodes = useCallback((): Set<string> => {
    if (rateCardId === '__new__') return new Set()
    return new Set(
      data.rateCardUnits
        .filter((u) => u.rateCardId === rateCardId)
        .map((u) => u.unitCode.toUpperCase()),
    )
  }, [data.rateCardUnits, rateCardId])

  // Reparse when rate card or overwrite changes (so duplicate detection updates)
  useEffect(() => {
    if (!wbState) return
    const result = parseSheetFull(
      wbState.wb, wbState.activeSheet, getExistingCodes(), overwrite,
      showManualMap && manualMap.unitCode && manualMap.rate ? manualMap : undefined,
    )
    setRows(result.rows)
    setRawHeaders(result.rawHeaders)
    setParseOk(result.autoDetected)
  }, [wbState, rateCardId, overwrite, getExistingCodes, showManualMap, manualMap])

  // ── File handling ──
  const handleFile = (file: File) => {
    if (!file) return
    setFileName(file.name)
    setImportResult(null)
    setShowManualMap(false)
    const reader = new FileReader()
    reader.onload = (e) => {
      const buf = e.target?.result as ArrayBuffer
      const wb = XLSX.read(buf, { type: 'array' })
      const state: WorkbookState = { wb, sheetNames: wb.SheetNames, activeSheet: wb.SheetNames[0] }
      setWbState(state)
      const result = parseSheetFull(wb, state.activeSheet, getExistingCodes(), overwrite)
      setRows(result.rows)
      setRawHeaders(result.rawHeaders)
      setParseOk(result.autoDetected)
      if (!result.autoDetected && result.rawHeaders.length > 0) {
        setShowManualMap(true)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const onSheetChange = (sheet: string) => {
    if (!wbState) return
    const next = { ...wbState, activeSheet: sheet }
    setWbState(next)
    const result = parseSheetFull(next.wb, sheet, getExistingCodes(), overwrite)
    setRows(result.rows)
    setRawHeaders(result.rawHeaders)
    setParseOk(result.autoDetected)
    if (!result.autoDetected && result.rawHeaders.length > 0) setShowManualMap(true)
  }

  const applyManualMap = () => {
    if (!wbState || !manualMap.unitCode || !manualMap.rate) return
    const result = parseSheetFull(wbState.wb, wbState.activeSheet, getExistingCodes(), overwrite, manualMap)
    setRows(result.rows)
    setRawHeaders(result.rawHeaders)
    setParseOk(result.rows.length > 0)
  }

  // ── Computed ──
  const importableRows = rows.filter((r) => {
    if (r.status === 'error') return false
    if (r.issues.some((i) => i.includes('Duplicate') && !overwrite)) return false
    return true
  })
  const errorCount  = rows.filter((r) => r.status === 'error').length
  const newCount    = rows.filter((r) => r.status === 'new').length
  const updateCount = rows.filter((r) => r.status === 'update').length
  const warnCount   = rows.filter((r) => r.status === 'warn').length
  const dupCount    = rows.filter((r) => r.issues.some((i) => i.includes('Duplicate'))).length

  const canImport = importableRows.length > 0 && !!clientId &&
    (rateCardId !== '__new__' || newCardName.trim().length > 0)

  // ── Why is import disabled? ──
  const importBlockReason: string | null = !wbState
    ? 'Upload a spreadsheet first'
    : rows.length === 0
    ? 'No rows were parsed from the file'
    : importableRows.length === 0 && dupCount > 0 && !overwrite
    ? `All ${dupCount} row${dupCount !== 1 ? 's' : ''} are duplicates — check "Overwrite duplicates" to replace them`
    : importableRows.length === 0 && errorCount > 0
    ? `All rows have errors — check the Notes column for details`
    : rateCardId === '__new__' && !newCardName.trim()
    ? 'Enter a name for the new rate card'
    : !clientId
    ? 'Select a client'
    : null

  // ── doImport ──
  const doImport = () => {
    if (!canImport) return
    setImporting(true)
    let targetCardId = rateCardId
    if (rateCardId === '__new__') {
      const card = addRateCard({ clientId, divisions, name: newCardName.trim(), effectiveDate: newCardDate })
      targetCardId = card.id
    }
    const existing = new Map(
      data.rateCardUnits
        .filter((u) => u.rateCardId === targetCardId)
        .map((u) => [u.unitCode.toUpperCase(), u]),
    )
    let added = 0, updated = 0
    for (const row of importableRows) {
      if (row.rate === null) continue
      const code = row.unitCode.toUpperCase()
      const uom = (VALID_UOMS.includes(row.uom as UOM) ? row.uom : 'EA') as UOM
      const existingUnit = existing.get(code)
      if (existingUnit && overwrite) {
        updateRateCardUnit(existingUnit.id, { description: row.description || existingUnit.description, uom, rate: row.rate })
        updated++
      } else if (!existingUnit) {
        addRateCardUnit({ rateCardId: targetCardId, unitCode: code, description: row.description, uom, rate: row.rate })
        added++
      }
    }
    setImporting(false)
    setImportResult(`Imported ${added} new unit${added !== 1 ? 's' : ''}${updated > 0 ? `, updated ${updated}` : ''}.`)
  }

  // ── Icons / styles ──
  const statusIcon = (s: RowStatus) => {
    if (s === 'new')    return <CheckCircle size={13} className="text-emerald-500" />
    if (s === 'update') return <RefreshCw   size={13} className="text-brand-500" />
    if (s === 'warn')   return <AlertTriangle size={13} className="text-amber-500" />
    return                     <XCircle     size={13} className="text-rose-500" />
  }
  const statusRowClass = (s: RowStatus) => {
    if (s === 'error')  return 'bg-rose-50/60'
    if (s === 'update') return 'bg-brand-50/40'
    if (s === 'warn')   return 'bg-amber-50/40'
    return ''
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Bulk Import Rate Card Units"
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={doImport} disabled={!canImport || importing}>
            {importing ? 'Importing…' : `Import ${importableRows.length} row${importableRows.length !== 1 ? 's' : ''}`}
          </Button>
        </>
      }
    >
      {importResult ? (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <CheckCircle size={40} className="text-emerald-500" />
          <p className="text-lg font-semibold text-slate-800">{importResult}</p>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="space-y-5">

          {/* ── Step 1: Target ── */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">1 · Target rate card</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Client">
                <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  {data.clients.length === 0 && <option value="">No clients — add one first</option>}
                  {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Rate card">
                <Select value={rateCardId} onChange={(e) => setRateCardId(e.target.value)}>
                  <option value="__new__">+ Create new rate card</option>
                  {matchingCards.map((rc) => <option key={rc.id} value={rc.id}>{rc.name}</option>)}
                </Select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Divisions" hint="Select all that apply to this import">
                <div className="flex gap-2 pt-1">
                  {DIVISIONS.map((d) => {
                    const active = divisions.includes(d)
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDiv(d)}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                          active
                            ? d === 'Underground'
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-cyan-600 bg-cyan-600 text-white'
                            : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                        }`}
                      >
                        <span className={`h-2 w-2 rounded-full ${active ? 'bg-white' : d === 'Underground' ? 'bg-blue-400' : 'bg-cyan-400'}`} />
                        {d}
                      </button>
                    )
                  })}
                </div>
              </Field>
            </div>

            {rateCardId === '__new__' && (
              <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <Field label="New card name">
                  <input
                    value={newCardName}
                    onChange={(e) => setNewCardName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                    placeholder={`${data.clients.find((c) => c.id === clientId)?.name ?? 'Client'}${divisions.length > 0 ? ' ' + divisions.join(' + ') : ''} 2025`}
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

            {rateCardId !== '__new__' && (
              <p className="mt-1.5 text-xs text-slate-400">
                Adding to <span className="font-medium text-slate-600">{matchingCards.find(c => c.id === rateCardId)?.name}</span>
                {' · '}{data.rateCardUnits.filter(u => u.rateCardId === rateCardId).length} existing units
              </p>
            )}
          </div>

          {/* ── Step 2: Upload ── */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">2 · Upload spreadsheet</p>
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
                  <p className="text-sm font-medium text-slate-600">Drop Excel / CSV file here or click to browse</p>
                  <p className="text-xs text-slate-400">.xlsx · .xls · .csv supported</p>
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

          {/* ── Column detection feedback ── */}
          {wbState && !parseOk && rawHeaders.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle size={16} className="shrink-0 text-amber-600" />
                <p className="text-sm font-semibold text-amber-800">Couldn't auto-detect column layout</p>
              </div>
              <p className="mb-3 text-xs text-amber-700">
                Columns found in your file: <span className="font-mono">{rawHeaders.slice(0, 10).join(', ')}</span>
                {rawHeaders.length > 10 && ` … +${rawHeaders.length - 10} more`}
              </p>
              <p className="mb-3 text-xs text-amber-700">
                Select which columns contain each required field:
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  [
                    { key: 'unitCode' as const, label: 'Unit Code *' },
                    { key: 'rate' as const, label: 'Rate *' },
                    { key: 'description' as const, label: 'Description' },
                    { key: 'uom' as const, label: 'UOM' },
                  ] as const
                ).map(({ key, label }) => (
                  <div key={key}>
                    <label className="mb-1 block text-xs font-medium text-amber-800">{label}</label>
                    <select
                      value={manualMap[key]}
                      onChange={(e) => setManualMap((m) => ({ ...m, [key]: e.target.value }))}
                      className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300"
                    >
                      <option value="">— pick column —</option>
                      {rawHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <button
                onClick={applyManualMap}
                disabled={!manualMap.unitCode || !manualMap.rate}
                className="mt-3 rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Parse with these columns
              </button>
            </div>
          )}

          {wbState && !parseOk && rawHeaders.length === 0 && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              The file appears empty or could not be read. Make sure it's a valid .xlsx, .xls, or .csv file.
            </div>
          )}

          {/* ── Step 3: Preview ── */}
          {rows.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">3 · Preview ({rows.length} rows)</p>
                <div className="flex items-center gap-3 text-xs">
                  {newCount    > 0 && <span className="flex items-center gap-1 text-emerald-600"><CheckCircle size={11} /> {newCount} new</span>}
                  {updateCount > 0 && <span className="flex items-center gap-1 text-brand-600"><RefreshCw size={11} /> {updateCount} update</span>}
                  {warnCount   > 0 && <span className="flex items-center gap-1 text-amber-600"><AlertTriangle size={11} /> {warnCount} warn</span>}
                  {errorCount  > 0 && <span className="flex items-center gap-1 text-rose-600"><XCircle size={11} /> {errorCount} error</span>}
                </div>
              </div>

              {/* Overwrite toggle — shown prominently when there are duplicates */}
              <label className={`mb-3 flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition ${
                dupCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'
              }`}>
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                />
                <div>
                  <span className="text-sm font-medium text-slate-700">Overwrite duplicates</span>
                  {dupCount > 0 && (
                    <span className="ml-2 text-xs text-amber-600">
                      {dupCount} duplicate{dupCount !== 1 ? 's' : ''} found — {overwrite ? 'will be updated' : 'currently skipped'}
                    </span>
                  )}
                </div>
              </label>

              <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="w-6 px-3 py-2 font-medium"></th>
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
                        <td className="max-w-[180px] truncate px-3 py-1.5 text-slate-700">{row.description || <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-1.5 text-slate-500">{row.uom || <span className="text-rose-400">?</span>}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-slate-800">
                          {row.rate !== null ? moneyExact(row.rate) : <span className="text-rose-400">?</span>}
                        </td>
                        <td className="max-w-[160px] px-3 py-1.5 text-slate-400">
                          {row.issues.length > 0 && (
                            <span className={row.status === 'error' ? 'text-rose-500' : row.status === 'warn' ? 'text-amber-600' : ''}>
                              {row.issues.join('; ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Why is Import disabled? */}
              {!canImport && importBlockReason && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <AlertTriangle size={14} className="shrink-0 text-amber-500" />
                  <p className="text-xs text-amber-700">{importBlockReason}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Expected column names (collapsible) ── */}
          <details className="text-xs text-slate-400">
            <summary className="flex cursor-pointer items-center gap-1 hover:text-slate-600">
              <ChevronDown size={13} /> Expected column names
            </summary>
            <div className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p><span className="font-medium text-slate-600">Unit Code:</span> "Unit Code", "Code", "Item", "Item Code", "Item #"</p>
              <p><span className="font-medium text-slate-600">Description:</span> "Description", "Desc", "Work Description"</p>
              <p><span className="font-medium text-slate-600">UOM:</span> "UOM", "Unit", "Unit of Measure"</p>
              <p><span className="font-medium text-slate-600">Rate:</span> "Rate", "Sub Rate", "Price", "Unit Price", "Contract Rate", "Labor Rate"</p>
              <p className="mt-1 text-slate-400">Headers are case-insensitive. Column order doesn't matter. Extra columns are ignored.</p>
            </div>
          </details>
        </div>
      )}
    </Modal>
  )
}
