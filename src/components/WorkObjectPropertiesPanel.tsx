import { useEffect, useState } from 'react'
import { X, GripHorizontal } from 'lucide-react'
import { Field, Select, Input, Textarea } from './ui/Form'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { MARKUP_STATUS_META } from '../types'
import type { FieldMarkup, MarkupStatus, WorkObjectTypeId } from '../types'
import { WORK_OBJECT_TYPES, WORK_OBJECT_TYPE_MAP } from '../lib/workObjectTypes'
import type { WorkObjectTypeDef } from '../lib/workObjectTypes'
import { getSavedPanelPosition, savePanelPosition } from '../lib/workObjectPanelPosition'

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
  const { data, updateMarkup, updateMarkupBilling } = useData()
  const { activeEmployeeId } = useRole()
  const [pos, setPos] = useState(() => clamp(getSavedPanelPosition(markup.id) ?? { x: anchor.x + 40, y: anchor.y - 40 }, 260))

  // A different Work Object was selected — re-derive this instance's position
  // rather than carrying over the previous markup's spot.
  useEffect(() => {
    setPos(clamp(getSavedPanelPosition(markup.id) ?? { x: anchor.x + 40, y: anchor.y - 40 }, 260))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markup.id])

  const typeDef = markup.workObjectType ? WORK_OBJECT_TYPE_MAP[markup.workObjectType] : null
  const billingLines = (data.markupBilling ?? []).filter((b) => b.markupId === markup.id)

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

      <div className="space-y-2.5 p-2.5">
        <Field label="Work Type">
          <Select
            value={markup.workObjectType ?? ''}
            onChange={(e) => {
              const newType = WORK_OBJECT_TYPE_MAP[e.target.value as WorkObjectTypeId]
              if (newType) onWorkTypeChange(newType)
            }}
          >
            {WORK_OBJECT_TYPES.map((wt) => <option key={wt.id} value={wt.id}>{wt.label}</option>)}
          </Select>
        </Field>
        <Field label="Crew">
          <Select
            value={markup.crewId ?? ''}
            onChange={(e) => patch({ crewId: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {data.crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Quantity">
          <Input
            type="number"
            value={markup.quantity ?? ''}
            onChange={(e) => patch({ quantity: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </Field>
        <Field label="Status">
          <Select
            value={markup.status}
            onChange={(e) => patch({ status: e.target.value as MarkupStatus })}
          >
            {(typeDef?.allowedStatuses ?? Object.keys(MARKUP_STATUS_META) as MarkupStatus[]).map((s) => (
              <option key={s} value={s}>{MARKUP_STATUS_META[s].label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Work Date">
          <Input
            type="date"
            value={markup.workDate ?? markup.createdAt.slice(0, 10)}
            onChange={(e) => patch({ workDate: e.target.value })}
          />
        </Field>
        <Field label="Notes">
          <Textarea
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
              <Input
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
    </div>
  )
}
