import { Pencil, Camera, FileText, DollarSign, Trash2, X } from 'lucide-react'

interface Props {
  /** Viewport-pixel anchor point (e.g. the selected markup's on-screen center/first vertex) —
   *  the toolbar renders just above this point, clamped to stay on screen. */
  anchor: { x: number; y: number }
  /** 'callout' shows a trimmed Edit/Delete/Close set for the auto-generated billing-summary
   *  callout, which has no independently editable Photos/Notes/Billing of its own. */
  mode?: 'full' | 'callout'
  canEdit: boolean
  onEdit: () => void
  onOpenTab?: (tab: 'photos' | 'notes' | 'billing') => void
  onDelete: () => void
  onClose?: () => void
}

const BTN_W = 40
const TOOLBAR_H = 40

/** A small floating action pill next to the selected map object. Full mode: Edit,
 *  Photos, Notes, Billing (Submit to Production lives on that tab), Delete — so common
 *  actions don't require opening the full side panel first. Callout mode: Edit (reopens
 *  the Add Work wizard on the callout's source Work Object), Delete, Close. */
export function MarkupQuickActions({ anchor, mode = 'full', canEdit, onEdit, onOpenTab, onDelete, onClose }: Props) {
  const buttonCount = mode === 'callout' ? 3 : 5
  const toolbarW = buttonCount * BTN_W
  const left = Math.min(Math.max(8, anchor.x - toolbarW / 2), window.innerWidth - toolbarW - 8)
  const top = Math.max(8, anchor.y - TOOLBAR_H - 16)

  const btn = 'flex h-8 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-white/10 hover:text-white transition disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <div
      className="fixed z-[1500] flex items-center gap-0.5 rounded-lg border border-[#2a2a2a] bg-[#141414]/95 p-1 shadow-xl shadow-black/50 backdrop-blur"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button title="Edit" disabled={!canEdit} onClick={onEdit} className={btn}><Pencil size={15} /></button>
      {mode === 'full' && (
        <>
          <button title="Photos" onClick={() => onOpenTab?.('photos')} className={btn}><Camera size={15} /></button>
          <button title="Notes" onClick={() => onOpenTab?.('notes')} className={btn}><FileText size={15} /></button>
          <button title="Billing / Production" onClick={() => onOpenTab?.('billing')} className={btn}><DollarSign size={15} /></button>
        </>
      )}
      <div className="mx-0.5 h-5 w-px bg-[#2a2a2a]" />
      <button title="Delete" onClick={onDelete} className={`${btn} hover:!bg-rose-500/15 hover:!text-rose-400`}><Trash2 size={15} /></button>
      {mode === 'callout' && (
        <button title="Close" onClick={onClose} className={btn}><X size={15} /></button>
      )}
    </div>
  )
}
