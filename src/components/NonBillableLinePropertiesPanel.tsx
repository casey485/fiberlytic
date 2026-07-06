import { useEffect, useState } from 'react'
import { X, GripHorizontal } from 'lucide-react'
import { Field, Select, Input } from './ui/Form'
import { useData } from '../store/DataContext'
import type { FieldMarkup } from '../types'
import { getSavedPanelPosition, savePanelPosition } from '../lib/workObjectPanelPosition'

interface Props {
  markup: FieldMarkup
  /** Current on-screen anchor of the linked object — used only to pick a sensible
   *  default position the first time this markup's panel is ever opened. */
  anchor: { x: number; y: number }
  onClose: () => void
}

const PANEL_W = 220
const LINE_COLORS = ['#ef4444', '#f97316', '#facc15', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6', '#ffffff', '#94a3b8']
const WEIGHT_OPTIONS = [
  { value: 1, label: 'XS' },
  { value: 2, label: 'Thin' },
  { value: 4, label: 'Med' },
  { value: 7, label: 'Thick' },
  { value: 12, label: 'XL' },
] as const

function clamp(pos: { x: number; y: number }, height: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(8, pos.x), window.innerWidth - PANEL_W - 8),
    y: Math.min(Math.max(8, pos.y), window.innerHeight - height - 8),
  }
}

/** Small, floating, draggable properties card for a Non-Billable Item (a reference
 *  line with no workObjectType) — deliberately exposes only cosmetic fields (label,
 *  color, thickness, line style). No Work Type/Crew/Quantity/GPS/Photos/Billing —
 *  those belong to real Work Objects only. Position persists per-markup across
 *  reloads, same as WorkObjectPropertiesPanel (which this mirrors structurally). */
export function NonBillableLinePropertiesPanel({ markup, anchor, onClose }: Props) {
  const { updateMarkup } = useData()
  const [pos, setPos] = useState(() => clamp(getSavedPanelPosition(markup.id) ?? { x: anchor.x + 40, y: anchor.y - 40 }, 220))

  useEffect(() => {
    setPos(clamp(getSavedPanelPosition(markup.id) ?? { x: anchor.x + 40, y: anchor.y - 40 }, 220))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markup.id])

  function patch(p: Partial<FieldMarkup>) {
    updateMarkup(markup.id, p)
  }

  function onDragStart(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX, startY = e.clientY
    const startPos = pos
    function onMove(ev: MouseEvent) {
      setPos(clamp({ x: startPos.x + (ev.clientX - startX), y: startPos.y + (ev.clientY - startY) }, 220))
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
      className="fixed z-[1500] w-[220px] rounded-lg border border-[#2a2a2a] bg-[#141414]/95 shadow-xl shadow-black/50 backdrop-blur"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="flex cursor-grab items-center justify-between gap-2 rounded-t-lg border-b border-[#2a2a2a] px-2.5 py-1.5 active:cursor-grabbing"
        onMouseDown={onDragStart}
      >
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
          <GripHorizontal size={12} className="text-slate-600" />
          Non-Billable Item
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
          <X size={14} />
        </button>
      </div>

      <div className="space-y-2.5 p-2.5">
        <Field label="Label">
          <Input
            value={markup.label ?? ''}
            onChange={(e) => patch({ label: e.target.value || null })}
            placeholder="Optional name"
          />
        </Field>

        <Field label="Color">
          <div className="flex flex-wrap items-center gap-1.5">
            {LINE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => patch({ color: c })}
                title={c}
                className={`h-5 w-5 rounded-full border-2 transition ${markup.color === c ? 'border-white scale-110' : 'border-transparent hover:scale-110'}`}
                style={{ background: c, boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px #555' : undefined }}
              />
            ))}
          </div>
        </Field>

        <Field label="Thickness">
          <div className="flex items-center gap-1">
            {WEIGHT_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => patch({ weight: value })}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${markup.weight === value ? 'bg-[#2a3347] text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Line Style">
          <Select
            value={markup.lineStyle ?? 'solid'}
            onChange={(e) => patch({ lineStyle: e.target.value as 'solid' | 'dashed' | 'dotted' })}
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </Select>
        </Field>
      </div>
    </div>
  )
}
