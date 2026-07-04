import { X, Pencil, Trash2 } from 'lucide-react'
import type { FieldMarkup } from '../types'

interface CalloutAnchor {
  markup: FieldMarkup
  boxX: number
  boxY: number
  targetX: number
  targetY: number
  /** Pre-computed display text — the manual callout's own free-typed label, or a
   *  Work Object's live-computed field summary (see workObjectCallout.ts). */
  text: string
  /** Manual callouts show their own one-click delete. A Work Object's companion
   *  callout does not — deleting a real, consequential record goes through the
   *  normal select → MarkupQuickActions → confirm flow instead. */
  showInlineDelete: boolean
}

interface Props {
  anchors: CalloutAnchor[]
  selectedId: string | null
  onSelect: (markup: FieldMarkup) => void
  onMove: (id: string, offsetX: number, offsetY: number) => void
  onEdit: (markup: FieldMarkup) => void
  onDelete: (markup: FieldMarkup) => void
  onClose: () => void
}

/** PDF Field Map's screen-fixed callout system — the equivalent of KmzMap.tsx's DOM
 *  overlay + dashed leader line, but built as plain React state/JSX since this page
 *  has no imperative Leaflet map to hang event listeners off of. Rendered as a sibling
 *  of the page's own pan/zoom-transformed canvas div so `position:fixed` here is
 *  genuinely viewport-fixed — callouts stay a constant, readable size at any zoom.
 *  Never shows a photo thumbnail — photo count is already part of `text`. */
export function PdfCalloutOverlay({ anchors, selectedId, onSelect, onMove, onEdit, onDelete, onClose }: Props) {
  if (anchors.length === 0) return null

  function onDragStart(e: React.MouseEvent, anchor: CalloutAnchor) {
    e.stopPropagation()
    const startX = e.clientX, startY = e.clientY
    const startOffsetX = anchor.boxX - anchor.targetX
    const startOffsetY = anchor.boxY - anchor.targetY
    let moved = false
    function onMouseMove(ev: MouseEvent) {
      if (Math.abs(ev.clientX - startX) > 6 || Math.abs(ev.clientY - startY) > 6) moved = true
      onMove(anchor.markup.id, startOffsetX + (ev.clientX - startX), startOffsetY + (ev.clientY - startY))
    }
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      // A non-drag click selects the linked map object — this is how clicking a
      // callout highlights its connected shape, and vice versa (both drive the
      // same selectedMarkup, since the callout has no identity of its own).
      if (!moved) onSelect(anchor.markup)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  return (
    <>
      <svg className="pointer-events-none fixed inset-0 z-[999]" width="100%" height="100%">
        {anchors.map((a) => {
          const color = a.markup.color || '#ef4444'
          return (
            <line
              key={a.markup.id}
              x1={a.boxX + 90} y1={a.boxY + 20} x2={a.targetX} y2={a.targetY}
              stroke={color} strokeWidth={1.5} strokeDasharray="6 3" opacity={0.75}
            />
          )
        })}
      </svg>
      {anchors.map((a) => {
        const m = a.markup
        const color = m.color || '#ef4444'
        const isSelected = selectedId === m.id
        return (
          <div
            key={m.id}
            className="fixed z-[1000] min-w-[180px] w-max max-w-[260px] cursor-pointer overflow-hidden rounded-md p-2"
            style={{
              left: a.boxX, top: a.boxY,
              background: 'rgba(0,0,0,0.88)', border: `2px solid ${color}`, color,
              fontSize: m.fontSize ?? 11, fontWeight: 600,
              boxShadow: '0 3px 14px rgba(0,0,0,0.75)',
              outline: isSelected ? '3px solid #22d3ee' : undefined, outlineOffset: isSelected ? 2 : undefined,
            }}
            onMouseDown={(e) => onDragStart(e, a)}
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="flex gap-1">
                <button title="Edit" onClick={(e) => { e.stopPropagation(); onEdit(m) }} className="opacity-70 hover:opacity-100">
                  <Pencil size={12} />
                </button>
                {a.showInlineDelete && (
                  <button title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(m) }} className="opacity-70 hover:opacity-100 hover:text-rose-400">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              <button title="Close" onClick={(e) => { e.stopPropagation(); onClose() }} className="opacity-70 hover:opacity-100">
                <X size={12} />
              </button>
            </div>
            <span className="block whitespace-pre-line break-words leading-relaxed">{a.text}</span>
          </div>
        )
      })}
    </>
  )
}
