import { useMemo, useState } from 'react'
import { X, Download, Loader2 } from 'lucide-react'
import type { AppData, FieldMarkup, WorkObjectTypeId } from '../types'
import { WORK_OBJECT_TYPES, WORK_OBJECT_TYPE_MAP } from '../lib/workObjectTypes'
import type { ExportFilterCriteria } from '../lib/fieldMapExportFilters'
import { DEFAULT_EXPORT_OPTIONS, type FieldMapExportOptions } from '../lib/fieldMapExportOptions'
import { crewOrSubSelectorOptions } from '../lib/crewOrSub'
import { useRole } from '../store/RoleContext'
import { Field, Select, Input } from './ui/Form'

type Scope = 'all' | 'currentPage' | 'selectedPages' | 'selectedRedlines'

interface Props {
  markups: FieldMarkup[]
  data: AppData
  /** Only present for the paginated PdfPrintMode export — KmzMap's Leaflet map has
   *  no page concept, so the "current page"/"selected pages" scopes are hidden. */
  pageContext?: { currentPage: number; pageCount: number } | null
  exporting: boolean
  onExport: (criteria: ExportFilterCriteria, options: FieldMapExportOptions) => void
  onClose: () => void
}

/** Shared "Download PDF" options dialog for both export paths. Scope (which
 *  radio option is chosen) picks the base candidate set; the filters below it
 *  further narrow whichever scope was picked — e.g. "Entire project" + "Crew:
 *  Christian" exports every one of Christian's redlines project-wide. */
export function FieldMapExportDialog({ markups, data, pageContext, exporting, onExport, onClose }: Props) {
  const { role, activeSubcontractorId } = useRole()
  const [scope, setScope] = useState<Scope>(pageContext ? 'currentPage' : 'all')
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set(pageContext ? [pageContext.currentPage] : []))
  const [selectedRedlines, setSelectedRedlines] = useState<Set<string>>(new Set())
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  // Encoded 'crew:<id>' / 'sub:<id>' — same convention AddWorkModal's merged
  // Crew/Subcontractor picker uses. Role-aware: a subcontractor session only
  // ever sees their own company here (crewOrSubSelectorOptions collapses to
  // one entry), so this filter can actually scope an export to "just me."
  const [crewOrSubValue, setCrewOrSubValue] = useState('')
  const crewOrSubOptions = crewOrSubSelectorOptions(data, role, activeSubcontractorId)
  const [workType, setWorkType] = useState<WorkObjectTypeId | ''>('')
  const [billingCode, setBillingCode] = useState('')
  const [options, setOptions] = useState<FieldMapExportOptions>(DEFAULT_EXPORT_OPTIONS)

  const redlineList = useMemo(
    () => markups.filter((m) => m.workObjectType && !m.deletedAt),
    [markups],
  )

  function toggleOption(key: keyof FieldMapExportOptions) {
    setOptions((o) => ({ ...o, [key]: !o[key] }))
  }

  function toggleRedline(id: string) {
    setSelectedRedlines((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function togglePage(n: number) {
    setSelectedPages((s) => {
      const next = new Set(s)
      if (next.has(n)) next.delete(n); else next.add(n)
      return next
    })
  }

  function handleExport() {
    const [kind, id] = crewOrSubValue ? crewOrSubValue.split(':') : [null, null]
    const criteria: ExportFilterCriteria = {
      redlineIds: scope === 'selectedRedlines' ? selectedRedlines : null,
      pageIndexes: pageContext
        ? (scope === 'currentPage' ? new Set([pageContext.currentPage])
          : scope === 'selectedPages' ? selectedPages
            : null)
        : null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      crewId: kind === 'crew' ? id : null,
      subcontractorId: kind === 'sub' ? id : null,
      workType: workType || null,
      billingCode: billingCode || null,
    }
    onExport(criteria, options)
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#141414] shadow-xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[#2a2a2a] px-4 py-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
            <Download size={15} className="text-brand-400" />
            Download PDF
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <Field label="Scope">
            <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="all">Entire project</option>
              {pageContext && <option value="currentPage">Current page only</option>}
              {pageContext && pageContext.pageCount > 1 && <option value="selectedPages">Selected pages</option>}
              <option value="selectedRedlines">Selected redlines only</option>
            </Select>
          </Field>

          {scope === 'selectedPages' && pageContext && (
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: pageContext.pageCount }, (_, i) => (
                <button
                  key={i}
                  onClick={() => togglePage(i)}
                  className={`rounded px-2 py-1 text-[11px] ${selectedPages.has(i) ? 'bg-brand-600 text-white' : 'bg-[#1e1e1e] text-slate-400 hover:bg-[#2a2a2a]'}`}
                >
                  Page {i + 1}
                </button>
              ))}
            </div>
          )}

          {scope === 'selectedRedlines' && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-[#2a2a2a] p-2">
              {redlineList.length === 0 && <p className="text-[11px] text-slate-500">No completed redlines yet.</p>}
              {redlineList.map((m) => {
                const typeDef = m.workObjectType ? WORK_OBJECT_TYPE_MAP[m.workObjectType] : null
                return (
                  <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px] text-slate-300 hover:bg-white/5">
                    <input type="checkbox" checked={selectedRedlines.has(m.id)} onChange={() => toggleRedline(m.id)} className="accent-brand-500" />
                    {typeDef?.label ?? m.tool} — {m.workId ?? m.id.slice(0, 8)}
                  </label>
                )
              })}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date from"><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></Field>
            <Field label="Date to"><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></Field>
          </div>

          <Field label="Crew or Subcontractor">
            <Select value={crewOrSubValue} onChange={(e) => setCrewOrSubValue(e.target.value)}>
              <option value="">{role === 'subcontractor' ? 'All your redlines' : 'All crews & subcontractors'}</option>
              {crewOrSubOptions.length === 1 ? (
                // Subcontractor session: only their own name, per the same
                // isolation principle as the Add Work picker — never show the
                // internal crew roster or other companies here either.
                <option value={`${crewOrSubOptions[0].kind === 'subcontractor' ? 'sub' : 'crew'}:${crewOrSubOptions[0].id}`}>
                  {crewOrSubOptions[0].name}
                </option>
              ) : (
                <>
                  <optgroup label="In-House Crews">
                    {crewOrSubOptions.filter((o) => o.kind === 'crew').map((o) => (
                      <option key={o.id} value={`crew:${o.id}`}>{o.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Subcontractors">
                    {crewOrSubOptions.filter((o) => o.kind === 'subcontractor').map((o) => (
                      <option key={o.id} value={`sub:${o.id}`}>{o.name}</option>
                    ))}
                  </optgroup>
                </>
              )}
            </Select>
          </Field>

          <Field label="Work type">
            <Select value={workType} onChange={(e) => setWorkType(e.target.value as WorkObjectTypeId | '')}>
              <option value="">All work types</option>
              {WORK_OBJECT_TYPES.map((wt) => <option key={wt.id} value={wt.id}>{wt.label}</option>)}
            </Select>
          </Field>

          <Field label="Billing code contains">
            <Input value={billingCode} onChange={(e) => setBillingCode(e.target.value)} placeholder="e.g. 1U4-1" />
          </Field>

          <div className="space-y-1.5 border-t border-[#2a2a2a] pt-3">
            {([
              ['includeCallouts', 'Include Callout Boxes'],
              ['includePhotos', 'Include Photos'],
              ['includeLegend', 'Include Legend'],
              ['includeQuantities', 'Include Quantities'],
              ['includeBillingCodes', 'Include Billing Codes'],
              ['includeNotes', 'Include Notes'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-[12px] text-slate-300">
                <input type="checkbox" checked={options[key]} onChange={() => toggleOption(key)} className="accent-brand-500" />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#2a2a2a] px-4 py-3">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-[12px] text-slate-400 hover:text-slate-200">Cancel</button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded bg-brand-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {exporting ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}
