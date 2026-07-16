import { useEffect, useState } from 'react'
import { X, GripHorizontal, Trash2 } from 'lucide-react'
import { Field, Select, Input, Textarea } from './ui/Form'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { MARKUP_STATUS_META } from '../types'
import type { FieldMarkup, MarkupStatus, WorkObjectTypeId } from '../types'
import { WORK_OBJECT_TYPES, WORK_OBJECT_TYPE_MAP, isSequentialAnnotation, isCommentAnnotation, SEQUENCE_PLACEHOLDER, COMMENT_PLACEHOLDER } from '../lib/workObjectTypes'
import type { WorkObjectTypeDef } from '../lib/workObjectTypes'
import { getSavedPanelPosition, savePanelPosition } from '../lib/workObjectPanelPosition'
import { localDateStr } from '../lib/format'
import { SpliceEnclosureForm } from './SpliceEnclosureForm'
import { SpliceTemplateModal } from './SpliceTemplateModal'
import { exportSpliceEnclosureExcel } from '../lib/spliceExport'
import { exportSpliceEnclosureWithTemplate, saveEnclosureToMasterWorkbook, downloadMasterWorkbook } from '../lib/spliceReportTemplate'

interface Props {
  markup: FieldMarkup
  /** Current on-screen anchor of the linked object — used only to pick a sensible
   *  default position the first time this markup's panel is ever opened; the panel
   *  otherwise stays exactly where the user last dragged it (a normal floating
   *  window, not something that tracks the object as the map pans). */
  anchor: { x: number; y: number }
  onClose: () => void
  /** Opens the full MarkupPanel's Billing tab — used by the "+N more" link when a
   *  markup has more than one billing line (this panel only edits the primary one). */
  onOpenBillingTab?: () => void
}

const PANEL_W = 260

function clamp(pos: { x: number; y: number }, height: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(8, pos.x), window.innerWidth - PANEL_W - 8),
    y: Math.min(Math.max(8, pos.y), window.innerHeight - height - 8),
  }
}

/** Small, floating, draggable properties card for a Work Object — replaces the
 *  big MarkupPanel sidebar for this markup type so the map stays fully visible
 *  and interactive while editing. Position persists per-markup across reloads
 *  (see workObjectPanelPosition.ts). Shared as-is by both KmzMap.tsx (Leaflet)
 *  and PdfPrintMode.tsx — this component has no map-library dependency of its
 *  own, just useData() like MarkupPanel already does. */
export function WorkObjectPropertiesPanel({ markup, anchor, onClose, onOpenBillingTab }: Props) {
  const { data, updateMarkup, updateMarkupBilling, deleteSpliceEnclosure, updateSpliceEnclosure, setSpliceMasterWorkbookData } = useData()
  const { activeEmployeeId } = useRole()
  const [pos, setPos] = useState(() => clamp(getSavedPanelPosition(markup.id) ?? { x: anchor.x + 40, y: anchor.y - 40 }, 260))
  const [editingSplice, setEditingSplice] = useState(false)
  const [editingSpliceTemplate, setEditingSpliceTemplate] = useState(false)
  const [savingToWorkbook, setSavingToWorkbook] = useState(false)
  const spliceTemplate = (data.spliceReportTemplates ?? []).find((t) => t.kind === 'spliceEnclosure')

  // A different Work Object was selected — re-derive this instance's position
  // rather than carrying over the previous markup's spot.
  useEffect(() => {
    setPos(clamp(getSavedPanelPosition(markup.id) ?? { x: anchor.x + 40, y: anchor.y - 40 }, 260))
    setEditingSplice(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markup.id])

  const typeDef = markup.workObjectType ? WORK_OBJECT_TYPE_MAP[markup.workObjectType] : null
  const billingLines = (data.markupBilling ?? []).filter((b) => b.markupId === markup.id)
  const spliceEnclosure = markup.workObjectType === 'splicing' ? (data.spliceEnclosures ?? []).find((s) => s.markupId === markup.id) ?? null : null
  const project = data.projects.find((p) => p.id === markup.projectId)

  function patch(p: Partial<FieldMarkup>) {
    updateMarkup(markup.id, p, activeEmployeeId)
  }

  function onWorkTypeChange(newType: WorkObjectTypeDef) {
    const p: Partial<FieldMarkup> = { workObjectType: newType.id, color: newType.defaultColor, unit: newType.defaultUnit }
    if (!newType.allowedStatuses.includes(markup.status)) p.status = newType.allowedStatuses[0]
    patch(p)
  }

  function onDragStart(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX, startY = e.clientY
    const startPos = pos
    function onMove(ev: MouseEvent) {
      setPos(clamp({ x: startPos.x + (ev.clientX - startX), y: startPos.y + (ev.clientY - startY) }, 260))
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setPos((p) => {
        savePanelPosition(markup.id, p)
        return p
      })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // "Click Save, Fiberlytic handles the spreadsheet" — closing the splice
  // detail editor is the technician's natural "I'm done with this enclosure"
  // moment, so that's what triggers the auto-populate into the master
  // workbook (clone-or-reuse this enclosure's tab, fill it, persist).
  // Fire-and-forget from the technician's perspective: editing itself is
  // already live-saved field-by-field (see SpliceEnclosureForm), so a failed
  // workbook sync here never loses their data, just delays the spreadsheet.
  async function handleDoneSplice() {
    setEditingSplice(false)
    if (!spliceTemplate || !spliceEnclosure) return
    setSavingToWorkbook(true)
    try {
      const { fileData, sheetName } = await saveEnclosureToMasterWorkbook(spliceTemplate, spliceEnclosure, markup, data.markupPhotos ?? [])
      setSpliceMasterWorkbookData('spliceEnclosure', fileData)
      if (spliceEnclosure.exportedSheetName !== sheetName) {
        updateSpliceEnclosure(spliceEnclosure.id, { exportedSheetName: sheetName })
      }
    } catch (err) {
      console.error('Failed to sync enclosure into master workbook:', err)
    } finally {
      setSavingToWorkbook(false)
    }
  }

  return (
    <div
      className="fixed z-[1500] w-[260px] rounded-lg border border-[#2a2a2a] bg-[#141414]/95 shadow-xl shadow-black/50 backdrop-blur"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="flex cursor-grab items-center justify-between gap-2 rounded-t-lg border-b border-[#2a2a2a] px-2.5 py-1.5 active:cursor-grabbing"
        onMouseDown={onDragStart}
      >
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
          <GripHorizontal size={12} className="text-slate-600" />
          {typeDef?.label ?? markup.tool}
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
          <X size={14} />
        </button>
      </div>

      {isSequentialAnnotation(markup.workObjectType) ? (
        // Sequential annotations (Fiber Tick Mark / Fiber Loop / Snow Shoe) are
        // pure map annotations, not billable Work Objects — drop the point,
        // type the sequence, done. No crew/quantity/status/billing fields; the
        // callout on the map (see workObjectCallout.ts) shows this text
        // directly instead of the usual Work ID/type-label title.
        <div className="space-y-2.5 p-2.5">
          <Field dark label="Sequence">
            <Input dark
              autoFocus
              value={markup.featureName ?? ''}
              onChange={(e) => patch({ featureName: e.target.value, label: e.target.value })}
              placeholder={(markup.workObjectType && SEQUENCE_PLACEHOLDER[markup.workObjectType]) ?? 'e.g. 001'}
            />
          </Field>
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-emerald-700 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 transition"
          >
            Done
          </button>
        </div>
      ) : isCommentAnnotation(markup.workObjectType) ? (
        // Comment annotations (Restoration / QA-QC / Damage Report / Other /
        // Anchor-Down Guy) keep their normal drawing geometry (Restoration
        // still draws a polygon) but, like the sequential family above, are
        // never billable Work Objects — draw the shape, type a comment, done.
        // No crew/quantity/status/billing fields; the comment is stored in
        // markup.notes so it shows in the callout's existing Notes row
        // (see workObjectCallout.ts) with no further changes needed there.
        <div className="space-y-2.5 p-2.5">
          <Field dark label="Comment">
            <Textarea dark
              autoFocus
              rows={3}
              value={markup.notes ?? ''}
              onChange={(e) => patch({ notes: e.target.value || null })}
              placeholder={(markup.workObjectType && COMMENT_PLACEHOLDER[markup.workObjectType]) ?? 'Add a comment'}
            />
          </Field>
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-emerald-700 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 transition"
          >
            Done
          </button>
        </div>
      ) : markup.workObjectType === 'splicing' ? (
        // Splicing gets its own summary + edit/export branch instead of the
        // generic one below — the real data lives on the SpliceEnclosure
        // record (spans/fibers/NOC), not on the FieldMarkup's generic
        // crew/quantity/status fields, so editing it re-opens
        // SpliceEnclosureForm in place rather than showing those fields.
        <div className="max-h-[70vh] space-y-2.5 overflow-y-auto p-2.5">
          {editingSplice ? (
            <>
              <SpliceEnclosureForm markupId={markup.id} projectId={markup.projectId} />
              <button
                onClick={handleDoneSplice}
                disabled={savingToWorkbook}
                className="w-full rounded-lg bg-emerald-700 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 transition disabled:cursor-wait disabled:opacity-70"
              >
                {savingToWorkbook ? 'Saving to workbook…' : 'Done'}
              </button>
            </>
          ) : (
            <>
              <div className="space-y-1.5 text-[11px] text-slate-400">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-600">Splice ID</span>
                  <span className="text-slate-300">{spliceEnclosure?.spliceId || markup.workId || '—'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-600">Enclosure Type</span>
                  <span className="text-slate-300">{spliceEnclosure?.enclosureType ?? '—'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-600">Trays</span>
                  <span className="text-slate-300">{spliceEnclosure?.trayCount ?? '—'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-600">Spans</span>
                  <span className="text-slate-300">{spliceEnclosure?.spans.length ?? 0}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-600">Work ID</span>
                  <span className="text-slate-300">{markup.workId ?? '—'}</span>
                </div>
              </div>
              <button
                onClick={() => setEditingSplice(true)}
                className="w-full rounded-lg border border-[#2a2a2a] bg-white/5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition"
              >
                Edit Splice Detail
              </button>
              <div className="flex gap-1.5">
                <button
                  disabled={!spliceEnclosure}
                  onClick={() => spliceEnclosure && exportSpliceEnclosureExcel(spliceEnclosure, markup, project)}
                  className="flex-1 rounded-lg border border-[#2a2a2a] bg-white/5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Export Enclosure Sheet (.xlsx)
                </button>
                <button
                  disabled={!spliceEnclosure}
                  title="Delete splice detail"
                  onClick={() => {
                    if (spliceEnclosure && window.confirm('Delete this splice enclosure\'s detail (header fields, spans, NOC report)? The map redline itself is not affected.')) {
                      deleteSpliceEnclosure(spliceEnclosure.id)
                    }
                  }}
                  className="shrink-0 rounded-lg border border-[#2a2a2a] bg-white/5 px-2.5 text-slate-400 hover:border-red-800/60 hover:bg-red-950/30 hover:text-red-400 transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="flex gap-1.5">
                {spliceTemplate && (
                  <button
                    disabled={!spliceEnclosure}
                    onClick={() => spliceEnclosure && exportSpliceEnclosureWithTemplate(spliceTemplate, spliceEnclosure, markup, data.markupPhotos ?? [])}
                    title={`Fills ${spliceTemplate.fileName}`}
                    className="flex-1 rounded-lg border border-[#2a2a2a] bg-white/5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Export via My Template
                  </button>
                )}
                <button
                  onClick={() => setEditingSpliceTemplate(true)}
                  className="shrink-0 rounded-lg border border-[#2a2a2a] bg-white/5 px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/10 hover:text-slate-200 transition"
                >
                  {spliceTemplate ? 'Edit Template' : 'Upload My Template'}
                </button>
              </div>
              {spliceTemplate?.hasMasterWorkbook && (
                <button
                  onClick={() => downloadMasterWorkbook(spliceTemplate)}
                  title="Every saved enclosure so far, each in its own tab"
                  className="w-full rounded-lg border border-[#2a2a2a] bg-white/5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition"
                >
                  Download Master Workbook
                </button>
              )}
            </>
          )}
        </div>
      ) : (
      <div className="space-y-2.5 p-2.5">
        <Field dark label="Work Type">
          <Select dark
            value={markup.workObjectType ?? ''}
            onChange={(e) => {
              const newType = WORK_OBJECT_TYPE_MAP[e.target.value as WorkObjectTypeId]
              if (newType) onWorkTypeChange(newType)
            }}
          >
            {WORK_OBJECT_TYPES.map((wt) => <option key={wt.id} value={wt.id}>{wt.label}</option>)}
          </Select>
        </Field>
        <Field dark label="Crew">
          <Select dark
            value={markup.crewId ?? ''}
            onChange={(e) => patch({ crewId: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {data.crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field dark label="Quantity">
          <Input dark
            type="number"
            value={markup.quantity ?? ''}
            onChange={(e) => patch({ quantity: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </Field>
        <Field dark label="Status">
          <Select dark
            value={markup.status}
            onChange={(e) => patch({ status: e.target.value as MarkupStatus })}
          >
            {(typeDef?.allowedStatuses ?? Object.keys(MARKUP_STATUS_META) as MarkupStatus[]).map((s) => (
              <option key={s} value={s}>{MARKUP_STATUS_META[s].label}</option>
            ))}
          </Select>
        </Field>
        <Field dark label="Work Date">
          <Input dark
            type="date"
            value={markup.workDate ?? localDateStr(new Date(markup.createdAt))}
            onChange={(e) => patch({ workDate: e.target.value })}
          />
        </Field>
        <Field dark label="Notes">
          <Textarea dark
            rows={2}
            value={markup.notes ?? ''}
            onChange={(e) => patch({ notes: e.target.value || null })}
          />
        </Field>

        <div className="space-y-1.5 border-t border-[#2a2a2a] pt-2 text-[11px] text-slate-400">
          <div className="flex justify-between gap-2">
            <span className="text-slate-600">Work ID</span>
            <span className="text-slate-300">{markup.workId ?? '—'}</span>
          </div>

          {billingLines.length === 0 ? (
            <div className="flex justify-between gap-2">
              <span className="text-slate-600">Billing Code</span>
              <span className="text-slate-300">—</span>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-slate-600">Billing Code</span>
              <Input dark
                className="!h-6 !py-0 text-right text-[11px]"
                value={billingLines[0].rateCode}
                onChange={(e) => updateMarkupBilling(billingLines[0].id, { rateCode: e.target.value })}
              />
            </div>
          )}
          {billingLines.length > 1 && (
            <button
              onClick={onOpenBillingTab}
              className="block w-full text-right text-[10px] text-brand-400 hover:text-brand-300"
            >
              +{billingLines.length - 1} more — edit in Billing tab
            </button>
          )}
        </div>
      </div>
      )}
      {editingSpliceTemplate && <SpliceTemplateModal kind="spliceEnclosure" onClose={() => setEditingSpliceTemplate(false)} />}
    </div>
  )
}
