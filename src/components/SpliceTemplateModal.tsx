// Upload-your-own-spreadsheet template mapper for the splice exports —
// counterpart to spliceExport.ts's hardcoded generators. Lets a user drop in
// their real .xlsx, pick a sheet, and type the cell address each field
// should land in; saved as a SpliceReportTemplate and reused by every export
// (see spliceReportTemplate.ts). One template per SpliceReportKind — saving
// replaces whichever template already exists for this modal's kind.
import { useRef, useState } from 'react'
import type { WorkBook } from 'xlsx'
import { Upload, FileSpreadsheet, AlertTriangle, Trash2, Wand2, Sparkles } from 'lucide-react'
import { useData } from '../store/DataContext'
import { Modal } from './ui/Modal'
import { Button, Field, Input, Select } from './ui/Form'
import {
  readTemplateFile, isValidCellRef, blankSpliceEnclosureMapping, blankFiberTapMapping,
  fiberlyticStandardSpliceMapping, FIBERLYTIC_STANDARD_SPLICE_SHEET_NAME,
  fiberlyticStandardFiberTapMapping, FIBERLYTIC_STANDARD_FIBER_TAP_SHEET_NAME,
  suggestSpliceEnclosureMapping, suggestFiberTapMapping,
} from '../lib/spliceReportTemplate'
import type { SpliceReportKind, SpliceEnclosureTemplateMapping, FiberTapTemplateMapping } from '../types'

/** True if `name` looks like the real "BLANK SPLICING TEMPLATE" tab, even if
 *  the user's copy renamed it slightly (e.g. "Splicing template (4)" — see
 *  the tab names visible in FIBER SPLICING PAPERWORK SLIDESHOW.pdf). */
function looksLikeStandardSpliceSheet(name: string): boolean {
  const n = name.toLowerCase()
  return n.includes('splic') && (n.includes('templ') || n === FIBERLYTIC_STANDARD_SPLICE_SHEET_NAME.toLowerCase())
}

/** True if `name` looks like the real "EXAMPLE FIBER TAP REPORT" tab, even
 *  renamed slightly (e.g. a customer's own "Fiber Tap Report" tab). */
function looksLikeStandardFiberTapSheet(name: string): boolean {
  const n = name.toLowerCase()
  return n.includes('fiber tap') && (n.includes('report') || n === FIBERLYTIC_STANDARD_FIBER_TAP_SHEET_NAME.toLowerCase())
}

const SPAN_LABELS: { index: number; label: string }[] = [
  { index: 0, label: 'Input' },
  ...Array.from({ length: 7 }, (_, i) => ({ index: i + 1, label: `Output ${i + 1}` })),
]

const ENCLOSURE_FIELDS: { key: keyof Omit<SpliceEnclosureTemplateMapping, 'spanAnchors' | 'spanLabelCells'>; label: string }[] = [
  { key: 'jobNumber', label: 'Job Number' },
  { key: 'jobName', label: 'Job Name' },
  { key: 'date', label: 'Date' },
  { key: 'spliceId', label: 'Splice ID' },
  { key: 'enclosureType', label: 'Enclosure Type' },
  { key: 'mapNumber', label: 'Map Number' },
  { key: 'trayCount', label: 'No. of Trays' },
  { key: 'location', label: 'Location' },
  { key: 'latitude', label: 'Latitude' },
  { key: 'longitude', label: 'Longitude' },
  { key: 'notes', label: 'Notes / Concerns' },
  { key: 'photosAnchor', label: 'Photos (top-left cell)' },
  { key: 'nocTicketNumber', label: 'NOC Ticket #' },
  { key: 'nocTimeIn', label: 'NOC Time In' },
  { key: 'nocTwRep', label: 'NOC TW Rep' },
  { key: 'nocClear', label: 'NOC Clear (writes "X")' },
  { key: 'nocTimeOut', label: 'NOC Time Out' },
  { key: 'nocAuditor', label: 'NOC Auditor' },
]

const FIBER_TAP_FIELDS: { key: keyof Omit<FiberTapTemplateMapping, 'tapsAnchor'>; label: string }[] = [
  { key: 'prismId', label: 'PRISM ID' },
  { key: 'opticalSourceLabel', label: 'Optical Source at Launch Site' },
  { key: 'nodeNumber', label: 'Node Number' },
  { key: 'opticalPowerDbm', label: 'Optical Power at Launch (dBm)' },
  { key: 'nodeLocation', label: 'Node Location / Optical Launch Site' },
  { key: 'wavelengthNm', label: 'Wavelength Used at Launch (nm)' },
  { key: 'contractorCompany', label: 'Contractor Company' },
  { key: 'splicerName', label: 'Splicer Name' },
]

function CellInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const invalid = value.trim() !== '' && !isValidCellRef(value)
  return (
    <div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder={placeholder ?? 'e.g. C4'}
        className={`font-mono text-xs ${invalid ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100' : ''}`}
      />
      {invalid && <span className="mt-0.5 block text-[11px] text-rose-500">Not a cell address, e.g. "C4"</span>}
    </div>
  )
}

export function SpliceTemplateModal({ kind, onClose }: { kind: SpliceReportKind; onClose: () => void }) {
  const { data, upsertSpliceReportTemplate, deleteSpliceReportTemplate } = useData()
  const existing = (data.spliceReportTemplates ?? []).find((t) => t.kind === kind)

  const [fileName, setFileName] = useState(existing?.fileName ?? '')
  const [fileData, setFileData] = useState(existing?.fileData ?? '')
  const [sheetNames, setSheetNames] = useState<string[]>(existing ? [existing.sheetName] : [])
  const [sheetName, setSheetName] = useState(existing?.sheetName ?? '')
  const [wb, setWb] = useState<WorkBook | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [enclosureMapping, setEnclosureMapping] = useState<SpliceEnclosureTemplateMapping>(
    kind === 'spliceEnclosure' && existing ? (existing.mapping as SpliceEnclosureTemplateMapping) : blankSpliceEnclosureMapping(),
  )
  const [tapMapping, setTapMapping] = useState<FiberTapTemplateMapping>(
    kind === 'fiberTap' && existing ? (existing.mapping as FiberTapTemplateMapping) : blankFiberTapMapping(),
  )

  async function handleFile(file: File) {
    setLoadError(null)
    try {
      const { base64, sheetNames: names, wb: parsedWb } = await readTemplateFile(file)
      setFileName(file.name)
      setFileData(base64)
      setSheetNames(names)
      setWb(parsedWb)
      const standardSheet = names.find(kind === 'spliceEnclosure' ? looksLikeStandardSpliceSheet : looksLikeStandardFiberTapSheet)
      const chosenSheet = standardSheet ?? names[0] ?? ''
      setSheetName(chosenSheet)
      if (hasAnyMapping) return
      // A file matching the known standard layout (see PAPERWORK SLIDESHOW.pdf
      // and fiberlyticStandardSpliceMapping's/fiberlyticStandardFiberTapMapping's
      // doc comments) can be fully mapped with no manual cell-typing — auto-fill
      // it exactly. Any other file gets a best-effort heuristic guess instead
      // (see suggestSpliceEnclosureMapping/suggestFiberTapMapping): scan the
      // sheet for cell text that looks like a known field's label and suggest
      // the cell next to it. Either way this only fires into a fresh
      // (not-yet-mapped) template, so re-uploading never silently wipes out
      // edits someone already made.
      if (standardSheet) {
        if (kind === 'spliceEnclosure') setEnclosureMapping(fiberlyticStandardSpliceMapping())
        else setTapMapping(fiberlyticStandardFiberTapMapping())
      } else if (chosenSheet) {
        await runSuggestion(parsedWb, chosenSheet)
      }
    } catch {
      setLoadError('Could not read that file — make sure it\'s a valid .xlsx workbook.')
    }
  }

  async function runSuggestion(targetWb: WorkBook, targetSheet: string) {
    setSuggesting(true)
    try {
      if (kind === 'spliceEnclosure') {
        setEnclosureMapping(await suggestSpliceEnclosureMapping(targetWb, targetSheet))
      } else {
        setTapMapping(await suggestFiberTapMapping(targetWb, targetSheet))
      }
    } finally {
      setSuggesting(false)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const allCellRefs = kind === 'spliceEnclosure'
    ? [
        ...ENCLOSURE_FIELDS.map((f) => enclosureMapping[f.key] as string | null),
        ...Object.values(enclosureMapping.spanAnchors),
        ...Object.values(enclosureMapping.spanLabelCells),
      ]
    : [
        ...FIBER_TAP_FIELDS.map((f) => tapMapping[f.key] as string | null),
        tapMapping.tapsAnchor,
      ]
  const hasInvalidRef = allCellRefs.some((v) => v != null && v.trim() !== '' && !isValidCellRef(v))
  const hasAnyMapping = allCellRefs.some((v) => v != null && v.trim() !== '')
  const canSave = !!fileData && !!sheetName && !hasInvalidRef && hasAnyMapping

  async function save() {
    if (!canSave) return
    await upsertSpliceReportTemplate(kind, {
      fileName, sheetName, fileData,
      mapping: kind === 'spliceEnclosure' ? enclosureMapping : tapMapping,
    })
    onClose()
  }

  async function remove() {
    if (window.confirm('Remove this template? Exports will go back to the built-in layout.')) {
      await deleteSpliceReportTemplate(kind)
      onClose()
    }
  }

  const title = kind === 'spliceEnclosure' ? 'Splice Enclosure Sheet Template' : 'Fiber Tap Report Template'

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="xl"
      footer={
        <>
          {existing && <Button variant="danger" onClick={remove} className="mr-auto"><Trash2 size={14} /> Remove Template</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>Save Template</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">1 · Upload your spreadsheet</p>
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
                <p className="text-sm font-medium text-slate-600">Drop your .xlsx template here or click to browse</p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
          </div>
          {loadError && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <AlertTriangle size={14} className="shrink-0" /> {loadError}
            </div>
          )}
          {sheetNames.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-slate-500">Sheet to fill in:</span>
              <Select value={sheetName} onChange={(e) => setSheetName(e.target.value)} className="w-56 text-xs">
                {sheetNames.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          )}
        </div>

        {fileData && (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                2 · Which cell does each field go in?
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                {wb && sheetName && (
                  <button
                    type="button"
                    disabled={suggesting}
                    onClick={() => runSuggestion(wb, sheetName)}
                    className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Sparkles size={12} /> {suggesting ? 'Scanning…' : 'Suggest Mapping From Headers'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => kind === 'spliceEnclosure'
                    ? setEnclosureMapping(fiberlyticStandardSpliceMapping())
                    : setTapMapping(fiberlyticStandardFiberTapMapping())}
                  className="flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-100"
                >
                  <Wand2 size={12} /> Fill In Standard Layout
                </button>
              </div>
            </div>
            <p className="mb-3 text-xs text-slate-400">
              Type the cell address (e.g. "C4") from your spreadsheet next to each field. Leave any field blank to skip it.
              {kind === 'spliceEnclosure'
                ? ' If your file is the standard "BLANK SPLICING TEMPLATE" paperwork, use "Fill In Standard Layout" instead of typing all of these by hand.'
                : ' If your file is the standard "EXAMPLE FIBER TAP REPORT" paperwork, use "Fill In Standard Layout" instead of typing all of these by hand.'}
              {' Otherwise, "Suggest Mapping From Headers" scans your sheet\'s text and guesses a starting point — always double-check its guesses.'}
              {kind === 'spliceEnclosure' && ' "Photos" is the top-left cell where the enclosure/tray photo collage gets pasted — separate from the Notes text cell, so you can put them anywhere.'}
            </p>

            {kind === 'spliceEnclosure' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {ENCLOSURE_FIELDS.map((f) => (
                    <Field key={f.key} label={f.label}>
                      <CellInput
                        value={enclosureMapping[f.key] ?? ''}
                        onChange={(v) => setEnclosureMapping((m) => ({ ...m, [f.key]: v || null }))}
                      />
                    </Field>
                  ))}
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-600">Fiber spans</p>
                  <p className="mb-2 text-xs text-slate-400">
                    "Anchor" is the cell holding fiber #1's row for that span — fiber number, tube color, and
                    fiber color are written there and 1/2 columns to its right, one row per fiber going down.
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50">
                        <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                          <th className="px-3 py-2 font-medium">Span</th>
                          <th className="px-3 py-2 font-medium">Label cell (optional)</th>
                          <th className="px-3 py-2 font-medium">Fiber table anchor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {SPAN_LABELS.map(({ index, label }) => (
                          <tr key={index} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 font-medium text-slate-600">{label}</td>
                            <td className="px-3 py-1.5">
                              <CellInput
                                value={enclosureMapping.spanLabelCells[index] ?? ''}
                                onChange={(v) => setEnclosureMapping((m) => ({
                                  ...m, spanLabelCells: { ...m.spanLabelCells, [index]: v || undefined },
                                }))}
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <CellInput
                                value={enclosureMapping.spanAnchors[index] ?? ''}
                                onChange={(v) => setEnclosureMapping((m) => ({
                                  ...m, spanAnchors: { ...m.spanAnchors, [index]: v || undefined },
                                }))}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {FIBER_TAP_FIELDS.map((f) => (
                    <Field key={f.key} label={f.label}>
                      <CellInput
                        value={tapMapping[f.key] ?? ''}
                        onChange={(v) => setTapMapping((m) => ({ ...m, [f.key]: v || null }))}
                      />
                    </Field>
                  ))}
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-600">Tap table</p>
                  <p className="mb-2 text-xs text-slate-400">
                    Anchor is the cell holding the first tap's name. Fixed columns to its right hold tap type,
                    port count, ports spliced, buffer/fiber color, the 8 port dBm readings, and the 8 computed
                    link-loss values — one row per tap, going down.
                  </p>
                  <Field label="Tap table anchor">
                    <div className="w-40">
                      <CellInput value={tapMapping.tapsAnchor ?? ''} onChange={(v) => setTapMapping((m) => ({ ...m, tapsAnchor: v || null }))} />
                    </div>
                  </Field>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
