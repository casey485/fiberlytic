import { Check, Trash2, RefreshCw } from 'lucide-react'
import type { MapReadingPage, MapReadingDetectionType } from '../../types'
import { Field, Input, Select, Textarea, Button } from '../ui/Form'
import { MAP_READING_COLORS, MAP_READING_TYPE_LABELS } from '../../lib/mapReading/colors'
import { summarizeDetections } from '../../lib/mapReading/detect'

interface DetectionsAndNotesProps {
  page: MapReadingPage
  selectedDetectionId: string | null
  onSelectDetection: (id: string | null) => void
  onUpdatePage: (patch: Partial<MapReadingPage>) => void
}

const ALL_TYPES = Object.keys(MAP_READING_TYPE_LABELS) as MapReadingDetectionType[]

export function DetectionsAndNotes({ page, selectedDetectionId, onSelectDetection, onUpdatePage }: DetectionsAndNotesProps) {
  function patchDetection(id: string, patch: Partial<MapReadingPage['detections'][number]>) {
    onUpdatePage({ detections: page.detections.map((d) => (d.id === id ? { ...d, ...patch } : d)) })
  }
  function deleteDetection(id: string) {
    onUpdatePage({ detections: page.detections.filter((d) => d.id !== id) })
    if (selectedDetectionId === id) onSelectDetection(null)
  }
  function patchNotes(patch: Partial<MapReadingPage['notes']>) {
    onUpdatePage({ notes: { ...page.notes, ...patch } })
  }
  function resummarize() {
    onUpdatePage({ notes: summarizeDetections(page.detections, page.notes.pageName || page.fileName) })
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {/* Detections list — clicking a row highlights the matching box on the
          page canvas, and vice versa (shared selectedDetectionId state one
          level up in MapReading.tsx). */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Detections ({page.detections.length})
        </p>
        {page.detections.length === 0 ? (
          <p className="rounded border border-dashed border-[#2a2a2a] px-2 py-3 text-center text-[11px] text-slate-600">
            Nothing detected on this page yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {page.detections.map((d) => (
              <li
                key={d.id}
                onClick={() => onSelectDetection(d.id)}
                className={`cursor-pointer rounded border px-2 py-1.5 text-[11px] transition ${
                  d.id === selectedDetectionId ? 'border-brand-500 bg-brand-900/20' : 'border-[#2a2a2a] hover:border-[#3a3a3a]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: MAP_READING_COLORS[d.type] }} />
                  <Select
                    value={d.type}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => patchDetection(d.id, { type: e.target.value as MapReadingDetectionType, corrected: true })}
                    className="!h-6 !py-0 text-[10px]"
                  >
                    {ALL_TYPES.map((t) => <option key={t} value={t}>{MAP_READING_TYPE_LABELS[t]}</option>)}
                  </Select>
                  <button onClick={(e) => { e.stopPropagation(); patchDetection(d.id, { confirmed: !d.confirmed }) }}
                    title={d.confirmed ? 'Approved' : 'Mark approved'}
                    className={`shrink-0 rounded p-0.5 ${d.confirmed ? 'text-emerald-400' : 'text-slate-600 hover:text-slate-300'}`}>
                    <Check size={12} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); deleteDetection(d.id) }} className="shrink-0 rounded p-0.5 text-slate-600 hover:text-rose-400">
                    <Trash2 size={12} />
                  </button>
                </div>
                <input
                  value={d.text}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => patchDetection(d.id, { text: e.target.value, corrected: true })}
                  className="mt-1 w-full rounded border border-[#2a3347] bg-[#141414] px-1.5 py-0.5 text-[11px] text-slate-300 outline-none"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Editable notes template — auto-populated from detections, always
          further hand-editable; the user's own wording always wins. */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Notes</p>
          <Button type="button" variant="ghost" onClick={resummarize} className="!px-1.5 !py-0.5 text-[10px]">
            <RefreshCw size={10} /> Re-summarize
          </Button>
        </div>
        <div className="space-y-2">
          <Field label="Page Name">
            <Input value={page.notes.pageName} onChange={(e) => patchNotes({ pageName: e.target.value })} />
          </Field>
          <Field label="Strand + Fiber 24ct"><Textarea rows={1} value={page.notes.strand24ct} onChange={(e) => patchNotes({ strand24ct: e.target.value })} /></Field>
          <Field label="Strand + Fiber 48ct"><Textarea rows={1} value={page.notes.strand48ct} onChange={(e) => patchNotes({ strand48ct: e.target.value })} /></Field>
          <Field label="Strand + Fiber 96ct"><Textarea rows={1} value={page.notes.strand96ct} onChange={(e) => patchNotes({ strand96ct: e.target.value })} /></Field>
          <Field label="Overlash Fiber"><Textarea rows={1} value={page.notes.overlash} onChange={(e) => patchNotes({ overlash: e.target.value })} /></Field>
          <Field label="Coils"><Textarea rows={1} value={page.notes.coils} onChange={(e) => patchNotes({ coils: e.target.value })} /></Field>
          <Field label="Snowshoes"><Textarea rows={1} value={page.notes.snowshoes} onChange={(e) => patchNotes({ snowshoes: e.target.value })} /></Field>
          <Field label="FE Labels"><Textarea rows={1} value={page.notes.feLabels} onChange={(e) => patchNotes({ feLabels: e.target.value })} /></Field>
          <Field label="FT Labels"><Textarea rows={1} value={page.notes.ftLabels} onChange={(e) => patchNotes({ ftLabels: e.target.value })} /></Field>
          <Field label="Road Names"><Textarea rows={1} value={page.notes.roadNames} onChange={(e) => patchNotes({ roadNames: e.target.value })} /></Field>
          <Field label="Tie Point"><Textarea rows={1} value={page.notes.tiePoint} onChange={(e) => patchNotes({ tiePoint: e.target.value })} /></Field>
          <Field label="OLT/MUX"><Textarea rows={1} value={page.notes.oltMux} onChange={(e) => patchNotes({ oltMux: e.target.value })} /></Field>
          <Field label="Questions / Needs Review">
            <Textarea rows={2} value={page.notes.needsReview} onChange={(e) => patchNotes({ needsReview: e.target.value })} />
          </Field>
        </div>
      </div>
    </div>
  )
}
