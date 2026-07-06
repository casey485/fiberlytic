import { X, Pencil, Trash2 } from 'lucide-react'
import type { FieldMarkup } from '../types'
import type { CalloutContent } from '../lib/workObjectCallout'

interface CalloutAnchor {
  markup: FieldMarkup
  boxX: number
  boxY: number
  targetX: number
  targetY: number
  /** The manual callout's own free-typed label — ignored when `content` is set. */
  text: string
  /** A Work Object's live-computed, settings-filtered field summary (see
   *  workObjectCallout.ts) — null for manual free-typed callouts, which render
   *  `text` instead as a plain label. */
  content: CalloutContent | null
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
  /** Fires once, on drag release (not per-pixel like onMove) — the hook to persist
   *  the final position, so dragging doesn't hammer localStorage on every mousemove. */
  onMoveEnd: (id: string, offsetX: number, offsetY: number) => void
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
export function PdfCalloutOverlay({ anchors, selectedId, onSelect, onMove, onMoveEnd, onEdit, onDelete, onClose }: Props) {
  if (anchors.length === 0) return null

  function onDragStart(e: React.MouseEvent, anchor: CalloutAnchor) {
    e.stopPropagation()
    const startX = e.clientX, startY = e.clientY
    const startOffsetX = anchor.boxX - anchor.targetX
    const startOffsetY = anchor.boxY - anchor.targetY
    let moved = false
    let lastOffsetX = startOffsetX, lastOffsetY = startOffsetY
    function onMouseMove(ev: MouseEvent) {
      if (Math.abs(ev.clientX - startX) > 6 || Math.abs(ev.clientY - startY) > 6) moved = true
      lastOffsetX = startOffsetX + (ev.clientX - startX)
      lastOffsetY = startOffsetY + (ev.clientY - startY)
      onMove(anchor.markup.id, lastOffsetX, lastOffsetY)
    }
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      // A non-drag click selects the linked map object — this is how clicking a
      // callout highlights its connected shape, and vice versa (both drive the
      // same selectedMarkup, since the callout has no identity of its own).
      if (!moved) { onSelect(anchor.markup); return }
      onMoveEnd(anchor.markup.id, lastOffsetX, lastOffsetY)
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
            className="fixed z-[1000] min-w-[150px] w-max max-w-[280px] cursor-pointer overflow-hidden rounded-lg p-2.5"
            style={{
              left: a.boxX, top: a.boxY,
              background: 'rgba(0,0,0,0.9)', border: `1.5px solid ${color}`, color: '#f1f5f9',
              fontSize: m.fontSize ?? 11,
              boxShadow: '0 4px 18px rgba(0,0,0,0.65)',
              outline: isSelected ? '3px solid #22d3ee' : undefined, outlineOffset: isSelected ? 2 : undefined,
            }}
            onMouseDown={(e) => onDragStart(e, a)}
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="flex gap-0.5">
                <button title="Edit" onClick={(e) => { e.stopPropagation(); onEdit(m) }} className="rounded p-1 opacity-70 hover:bg-white/10 hover:opacity-100">
                  <Pencil size={13} />
                </button>
                {a.showInlineDelete && (
                  <button title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(m) }} className="rounded p-1 opacity-70 hover:bg-white/10 hover:opacity-100 hover:text-rose-400">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <button title="Close" onClick={(e) => { e.stopPropagation(); onClose() }} className="rounded p-1 opacity-70 hover:bg-white/10 hover:opacity-100">
                <X size={13} />
              </button>
            </div>
            {a.content ? (
              <div>
                {a.content.title && (
                  <div className="mb-1 font-bold" style={{ color, fontSize: (m.fontSize ?? 11) + 1 }}>
                    {a.content.title}
                  </div>
                )}
                {a.content.rows.map((row, i) => (
                  <div key={i} className="flex flex-wrap gap-1 leading-relaxed">
                    <span className="shrink-0 text-slate-400">{row.label}:</span>
                    <span className="font-semibold text-slate-100 break-words">{row.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="block whitespace-pre-line break-words leading-relaxed font-semibold">{a.text}</span>
            )}
          </div>
        )
      })}
    </>
  )
}
