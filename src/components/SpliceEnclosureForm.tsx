/**
 * Splice-detail step of the Add Work wizard, shown only when the picked Work
 * Type is "Splicing" — digitizes the paper "BLANK SPLICING TEMPLATE": header
 * identity fields, an input span + up to 7 output spans each with a fiber
 * table (fiber number / tube color / fiber color), and the NOC report box.
 * Persists live to a SpliceEnclosure record keyed 1:1 by markupId, same
 * "live-persisted, not deferred to Save" pattern the rest of the wizard
 * already uses for FieldMarkup fields.
 */
import { useEffect, useState } from 'react'
import { Plus, Trash2, ListPlus } from 'lucide-react'
import { Field, Input, Select, Textarea, Button } from './ui/Form'
import { useData } from '../store/DataContext'
import { FIBER_COLOR_SEQUENCE, FIBER_COLOR_META, FIBER_STATUS_OPTIONS, FIBER_STATUS_LABELS, defaultColorsForFiberNumber } from '../lib/spliceFiberColors'
import type { SpliceEnclosure, SpliceEnclosureType, SpliceSpan, FiberColorCode, FiberSpliceStatus } from '../types'

const ENCLOSURE_TYPES: SpliceEnclosureType[] = ['Can', 'D Can', 'OTE', 'MST', 'Splitter', 'Other']

const CABLE_SIZES = [12, 24, 48, 72, 96, 144, 288, 432, 864] as const

function blankEnclosure(markupId: string, projectId: string): Omit<SpliceEnclosure, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    markupId, projectId,
    jobNumber: '', jobName: '', spliceId: '', enclosureType: 'Can', mapNumber: '',
    trayCount: 1, location: '',
    spans: [{ spanIndex: 0, label: '', fibers: [] }],
    notes: null,
    noc: { ticketNumber: null, timeIn: null, twRep: null, clear: false, timeOut: null, auditor: null },
  }
}

function ColorSelect({ value, onChange }: { value: FiberColorCode; onChange: (c: FiberColorCode) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as FiberColorCode)}
      className="rounded border border-[#2a3347] bg-[#141414] px-1 py-1 text-[11px] text-slate-200 outline-none"
    >
      {FIBER_COLOR_SEQUENCE.map((c) => <option key={c} value={c}>{FIBER_COLOR_META[c].label}</option>)}
    </select>
  )
}

function ColorDot({ color }: { color: FiberColorCode }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/30" style={{ background: FIBER_COLOR_META[color].swatch }} />
}

interface SpanBlockProps {
  span: SpliceSpan
  isInput: boolean
  /** Only used (and only needed) on the Input span — the enclosure's
   *  configured Output spans, for the "Routed To" dropdown's labels. */
  outputSpans: SpliceSpan[]
  onLabelChange: (spanIndex: number, label: string) => void
  onRemoveSpan: (spanIndex: number) => void
  onGenerateReference: (count: number) => void
  onAddFiber: (spanIndex: number) => void
  onUpdateFiber: (spanIndex: number, fiberId: string, patch: Partial<SpliceSpan['fibers'][number]>) => void
  onRemoveFiber: (spanIndex: number, fiberId: string) => void
}

function outputSpanLabel(s: SpliceSpan): string {
  return s.label ? `Output ${s.spanIndex}: ${s.label}` : `Output ${s.spanIndex}`
}

// A real top-level component (not nested inside SpliceEnclosureForm's render
// body) — nesting it there would redefine it on every keystroke anywhere in
// the form, which React treats as a brand-new component type and remounts,
// dropping input focus. All mutations go through the callback props instead
// of closing over parent state directly.
function SpanBlock({ span, isInput, outputSpans, onLabelChange, onRemoveSpan, onGenerateReference, onAddFiber, onUpdateFiber, onRemoveFiber }: SpanBlockProps) {
  const [showAll, setShowAll] = useState(span.fibers.length <= 20)
  const [cableSize, setCableSize] = useState<number>(
    CABLE_SIZES.find((s) => s === span.fibers.length) ?? CABLE_SIZES.find((s) => s >= span.fibers.length) ?? 48,
  )
  // "which of my N input fibers go to Output 3" at a glance — filters the
  // displayed rows only, never the underlying data.
  const [routeFilter, setRouteFilter] = useState<'all' | 'unassigned' | number>('all')
  // Picking a specific route filter bypasses the >20-fiber collapse gate —
  // a filtered view (e.g. "just the ~30 fibers routed to Output 3") is
  // exactly the "at a glance" case worth showing directly, even out of a
  // 144-count input the collapsed summary would otherwise hide entirely.
  const collapsed = isInput && !showAll && routeFilter === 'all' && span.fibers.length > 20
  const visibleFibers = !isInput || routeFilter === 'all'
    ? span.fibers
    : span.fibers.filter((f) => (routeFilter === 'unassigned' ? f.routedToSpanIndex == null : f.routedToSpanIndex === routeFilter))

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-white/[0.03] p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <Input dark
          value={span.label}
          onChange={(e) => onLabelChange(span.spanIndex, e.target.value)}
          placeholder={isInput ? 'Input Ftg — e.g. KENLA07D008' : 'Output Ftg — e.g. KENLA07D008 TO KENLA070023'}
          className="flex-1 text-[11px]"
        />
        {!isInput && (
          <button onClick={() => onRemoveSpan(span.spanIndex)} className="shrink-0 text-slate-600 hover:text-red-400">
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {isInput && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded border border-[#2a3347] bg-white/[0.03] p-1.5">
          <span className="text-[10px] text-slate-500">Cable size</span>
          <select
            value={cableSize}
            onChange={(e) => setCableSize(Number(e.target.value))}
            className="rounded border border-[#2a3347] bg-[#141414] px-1 py-0.5 text-[11px] text-slate-200 outline-none"
          >
            {CABLE_SIZES.map((s) => <option key={s} value={s}>{s} Fiber</option>)}
          </select>
          <Button dark type="button" variant="secondary" className="!px-2 !py-1 text-[11px]" onClick={() => { onGenerateReference(cableSize); setShowAll(cableSize <= 20) }}>
            <ListPlus size={11} className="mr-1" /> Generate Reference
          </Button>
          <span className="text-[10px] text-slate-600">standard color sequence, still editable per row</span>
        </div>
      )}

      {isInput && outputSpans.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded border border-[#2a3347] bg-white/[0.03] p-1.5">
          <span className="text-[10px] text-slate-500">Show fibers routed to</span>
          <select
            value={routeFilter}
            onChange={(e) => setRouteFilter(e.target.value === 'all' || e.target.value === 'unassigned' ? e.target.value : Number(e.target.value))}
            className="rounded border border-[#2a3347] bg-[#141414] px-1 py-0.5 text-[11px] text-slate-200 outline-none"
          >
            <option value="all">All ({span.fibers.length})</option>
            <option value="unassigned">Unassigned ({span.fibers.filter((f) => f.routedToSpanIndex == null).length})</option>
            {outputSpans.map((s) => (
              <option key={s.spanIndex} value={s.spanIndex}>
                {outputSpanLabel(s)} ({span.fibers.filter((f) => f.routedToSpanIndex === s.spanIndex).length})
              </option>
            ))}
          </select>
        </div>
      )}

      {collapsed ? (
        <button
          onClick={() => setShowAll(true)}
          className="mb-2 w-full rounded border border-[#2a3347] bg-white/[0.03] py-1.5 text-[11px] text-slate-400 hover:text-slate-200"
        >
          {span.fibers.length} fibers (1–{span.fibers.length}) — click to view/edit individually
        </button>
      ) : visibleFibers.length > 0 ? (
        <ul className="mb-2 max-h-72 space-y-1 overflow-y-auto">
          {visibleFibers.map((f) => (
            <li key={f.id} className="rounded border border-[#2a3347] bg-white/[0.02] p-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="number" min={1} max={864}
                  value={f.fiberNumber}
                  onChange={(e) => onUpdateFiber(span.spanIndex, f.id, { fiberNumber: Number(e.target.value) })}
                  className="w-11 shrink-0 rounded border border-[#2a3347] bg-[#141414] px-1 py-0.5 text-right text-[11px] text-slate-200 outline-none"
                />
                <ColorDot color={f.tubeColor} />
                <ColorSelect value={f.tubeColor} onChange={(c) => onUpdateFiber(span.spanIndex, f.id, { tubeColor: c })} />
                <ColorDot color={f.fiberColor} />
                <ColorSelect value={f.fiberColor} onChange={(c) => onUpdateFiber(span.spanIndex, f.id, { fiberColor: c })} />
                <button onClick={() => onRemoveFiber(span.spanIndex, f.id)} className="ml-auto shrink-0 text-slate-600 hover:text-red-400">
                  <Trash2 size={11} />
                </button>
              </div>
              <div className="mt-1 flex items-center gap-1">
                <select
                  value={f.status}
                  onChange={(e) => onUpdateFiber(span.spanIndex, f.id, { status: e.target.value as FiberSpliceStatus })}
                  className="rounded border border-[#2a3347] bg-[#141414] px-1 py-0.5 text-[10px] text-slate-300 outline-none"
                >
                  {FIBER_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{FIBER_STATUS_LABELS[s]}</option>)}
                </select>
                <input
                  value={f.inputFiber}
                  onChange={(e) => onUpdateFiber(span.spanIndex, f.id, { inputFiber: e.target.value })}
                  placeholder="In"
                  title="Input Fiber"
                  className="w-12 rounded border border-[#2a3347] bg-[#141414] px-1 py-0.5 text-[10px] text-slate-300 outline-none"
                />
                <input
                  value={f.outputFiber}
                  onChange={(e) => onUpdateFiber(span.spanIndex, f.id, { outputFiber: e.target.value })}
                  placeholder="Out"
                  title="Output Fiber"
                  className="w-12 rounded border border-[#2a3347] bg-[#141414] px-1 py-0.5 text-[10px] text-slate-300 outline-none"
                />
                {isInput && outputSpans.length > 0 && (
                  <select
                    value={f.routedToSpanIndex ?? ''}
                    onChange={(e) => onUpdateFiber(span.spanIndex, f.id, { routedToSpanIndex: e.target.value === '' ? null : Number(e.target.value) })}
                    title="Routed to"
                    className="rounded border border-[#2a3347] bg-[#141414] px-1 py-0.5 text-[10px] text-slate-300 outline-none"
                  >
                    <option value="">Routed to…</option>
                    {outputSpans.map((s) => <option key={s.spanIndex} value={s.spanIndex}>{outputSpanLabel(s)}</option>)}
                  </select>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {!collapsed && (
        <Button dark type="button" variant="ghost" className="!px-2 !py-1 text-[11px]" onClick={() => onAddFiber(span.spanIndex)}>
          <Plus size={11} className="mr-1" /> Add Fiber
        </Button>
      )}
    </div>
  )
}

interface Props {
  markupId: string
  projectId: string
}

export function SpliceEnclosureForm({ markupId, projectId }: Props) {
  const { data, addSpliceEnclosure, updateSpliceEnclosure, updateMarkup } = useData()
  const enclosure = (data.spliceEnclosures ?? []).find((s) => s.markupId === markupId) ?? null
  const markup = data.fieldMarkups.find((m) => m.id === markupId) ?? null

  useEffect(() => {
    if (!enclosure) addSpliceEnclosure(blankEnclosure(markupId, projectId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markupId])

  if (!enclosure) return null

  function patch(p: Partial<SpliceEnclosure>) {
    if (enclosure) updateSpliceEnclosure(enclosure.id, p)
  }
  // GPS normally auto-captures onto the parent FieldMarkup when the
  // enclosure is dropped on the map (see MapView.tsx) — these fields just
  // expose that value for correction and give a manual fallback when GPS
  // was unavailable at capture time, rather than duplicating lat/lng onto
  // the SpliceEnclosure record itself.
  function patchGps(p: { capturedLat?: number | null; capturedLng?: number | null }) {
    updateMarkup(markupId, p)
  }
  function patchSpan(spanIndex: number, spanPatch: Partial<SpliceSpan>) {
    patch({ spans: (enclosure as SpliceEnclosure).spans.map((s) => (s.spanIndex === spanIndex ? { ...s, ...spanPatch } : s)) })
  }
  function addOutputSpan() {
    const e = enclosure as SpliceEnclosure
    const used = new Set(e.spans.map((s) => s.spanIndex))
    let next = 1
    while (used.has(next) && next <= 7) next += 1
    if (next > 7) return
    patch({ spans: [...e.spans, { spanIndex: next, label: '', fibers: [] }] })
  }
  function removeSpan(spanIndex: number) {
    patch({ spans: (enclosure as SpliceEnclosure).spans.filter((s) => s.spanIndex !== spanIndex) })
  }
  // The real "BLANK SPLICING TEMPLATE" always ships its Input span pre-filled
  // with the full standard 1-N reference table (fiber number -> tube/fiber
  // color per the repeating 12x12 pattern) — a tech's real job is reading
  // off that table while filling in the Output spans, not typing it in one
  // row at a time. This reproduces that: generating (or regenerating) the
  // input span's reference table for a given total fiber count.
  function generateInputReference(count: number) {
    const n = Math.max(0, Math.min(864, Math.round(count)))
    const fibers = Array.from({ length: n }, (_, i) => {
      const fiberNumber = i + 1
      const { tubeColor, fiberColor } = defaultColorsForFiberNumber(fiberNumber)
      return {
        id: crypto.randomUUID(), fiberNumber, tubeColor, fiberColor,
        inputFiber: String(fiberNumber), outputFiber: String(fiberNumber), status: 'spliced' as FiberSpliceStatus,
        routedToSpanIndex: null,
      }
    })
    patchSpan(0, { fibers })
  }
  function addFiber(spanIndex: number) {
    const e = enclosure as SpliceEnclosure
    const span = e.spans.find((s) => s.spanIndex === spanIndex)
    if (!span) return
    const nextNumber = Math.min(864, (span.fibers[span.fibers.length - 1]?.fiberNumber ?? 0) + 1)
    const { tubeColor, fiberColor } = defaultColorsForFiberNumber(nextNumber)
    patchSpan(spanIndex, {
      fibers: [...span.fibers, {
        id: crypto.randomUUID(), fiberNumber: nextNumber, tubeColor, fiberColor,
        inputFiber: String(nextNumber), outputFiber: String(nextNumber), status: 'spliced' as FiberSpliceStatus,
        routedToSpanIndex: null,
      }],
    })
  }
  function updateFiber(spanIndex: number, fiberId: string, fiberPatch: Partial<SpliceSpan['fibers'][number]>) {
    const e = enclosure as SpliceEnclosure
    const span = e.spans.find((s) => s.spanIndex === spanIndex)
    if (!span) return
    patchSpan(spanIndex, { fibers: span.fibers.map((f) => (f.id === fiberId ? { ...f, ...fiberPatch } : f)) })
  }
  function removeFiber(spanIndex: number, fiberId: string) {
    const e = enclosure as SpliceEnclosure
    const span = e.spans.find((s) => s.spanIndex === spanIndex)
    if (!span) return
    patchSpan(spanIndex, { fibers: span.fibers.filter((f) => f.id !== fiberId) })
  }
  function onLabelChange(spanIndex: number, label: string) {
    patchSpan(spanIndex, { label })
  }

  const inputSpan = enclosure.spans.find((s) => s.spanIndex === 0)!
  const outputSpans = enclosure.spans.filter((s) => s.spanIndex > 0).sort((a, b) => a.spanIndex - b.spanIndex)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field dark label="Job Number">
          <Input dark value={enclosure.jobNumber} onChange={(e) => patch({ jobNumber: e.target.value })} />
        </Field>
        <Field dark label="Job Name">
          <Input dark value={enclosure.jobName} onChange={(e) => patch({ jobName: e.target.value })} />
        </Field>
        <Field dark label="Splice ID">
          <Input dark value={enclosure.spliceId} onChange={(e) => patch({ spliceId: e.target.value })} placeholder="e.g. KENSO413D001" />
        </Field>
        <Field dark label="Enclosure Type">
          <Select dark value={enclosure.enclosureType} onChange={(e) => patch({ enclosureType: e.target.value as SpliceEnclosureType })}>
            {ENCLOSURE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field dark label="Map Number">
          <Input dark value={enclosure.mapNumber} onChange={(e) => patch({ mapNumber: e.target.value })} />
        </Field>
        <Field dark label="No. of Trays" hint="Drives the required tray-photo count on the next step.">
          <Input dark type="number" min={0}
            value={enclosure.trayCount}
            onChange={(e) => patch({ trayCount: Math.max(0, Number(e.target.value)) })}
          />
        </Field>
      </div>
      <Field dark label="Location">
        <Input dark value={enclosure.location} onChange={(e) => patch({ location: e.target.value })} placeholder="Street address" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field dark label="Latitude" hint={markup?.capturedLat != null ? undefined : 'GPS unavailable — enter manually'}>
          <Input dark type="number" step="any"
            value={markup?.capturedLat ?? ''}
            onChange={(e) => patchGps({ capturedLat: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="e.g. 37.9577"
          />
        </Field>
        <Field dark label="Longitude" hint={markup?.capturedLng != null ? undefined : 'GPS unavailable — enter manually'}>
          <Input dark type="number" step="any"
            value={markup?.capturedLng ?? ''}
            onChange={(e) => patchGps({ capturedLng: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="e.g. -85.1372"
          />
        </Field>
      </div>

      <div className="space-y-2">
        <span className="block text-xs font-medium text-slate-400">Spans</span>
        <SpanBlock
          span={inputSpan} isInput outputSpans={outputSpans}
          onLabelChange={onLabelChange} onRemoveSpan={removeSpan} onGenerateReference={generateInputReference}
          onAddFiber={addFiber} onUpdateFiber={updateFiber} onRemoveFiber={removeFiber}
        />
        {outputSpans.map((s) => (
          <SpanBlock
            key={s.spanIndex} span={s} isInput={false} outputSpans={outputSpans}
            onLabelChange={onLabelChange} onRemoveSpan={removeSpan} onGenerateReference={generateInputReference}
            onAddFiber={addFiber} onUpdateFiber={updateFiber} onRemoveFiber={removeFiber}
          />
        ))}
        {outputSpans.length < 7 && (
          <Button dark type="button" variant="secondary" className="text-[11px]" onClick={addOutputSpan}>
            <Plus size={12} className="mr-1" /> Add Output Span
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-[#2a2a2a] bg-white/[0.03] p-2.5">
        <span className="mb-2 block text-xs font-medium text-slate-400">NOC Report</span>
        <div className="grid grid-cols-2 gap-2">
          <Field dark label="Ticket #">
            <Input dark value={enclosure.noc.ticketNumber ?? ''} onChange={(e) => patch({ noc: { ...enclosure.noc, ticketNumber: e.target.value || null } })} />
          </Field>
          <Field dark label="TW Rep">
            <Input dark value={enclosure.noc.twRep ?? ''} onChange={(e) => patch({ noc: { ...enclosure.noc, twRep: e.target.value || null } })} />
          </Field>
          <Field dark label="Time In">
            <Input dark type="time" value={enclosure.noc.timeIn ?? ''} onChange={(e) => patch({ noc: { ...enclosure.noc, timeIn: e.target.value || null } })} />
          </Field>
          <Field dark label="Time Out">
            <Input dark type="time" value={enclosure.noc.timeOut ?? ''} onChange={(e) => patch({ noc: { ...enclosure.noc, timeOut: e.target.value || null } })} />
          </Field>
          <Field dark label="Auditor">
            <Input dark value={enclosure.noc.auditor ?? ''} onChange={(e) => patch({ noc: { ...enclosure.noc, auditor: e.target.value || null } })} />
          </Field>
          <label className="flex items-center gap-1.5 self-end pb-2 text-xs text-slate-400">
            <input type="checkbox" checked={enclosure.noc.clear} onChange={(e) => patch({ noc: { ...enclosure.noc, clear: e.target.checked } })} />
            Clear
          </label>
        </div>
      </div>

      <Field dark label="Notes and/or Concerns">
        <Textarea dark value={enclosure.notes ?? ''} onChange={(e) => patch({ notes: e.target.value || null })} />
      </Field>
    </div>
  )
}
