import { X, Pencil, Trash2 } from 'lucide-react'
import type { FieldMarkup } from '../types'
import type { CalloutContent } from '../lib/workObjectCallout'

interface CalloutAnchor {
  markup: FieldMarkup
  boxX: number
  boxY: number
  targetX: number
  targetY: number
  /** markup.calloutScale ?? 1 — the user's own manual size override, applied
   *  as an extra `transform: scale()` on top of the page's zoom scaling (see
   *  onResize below). Kept out of FieldMarkup reads inside this component so
   *  every anchor field lives in one place. */
  scale: number
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
  /** false ⇒ purely visual: no tap-to-select, no edit/delete/close buttons,
   *  default cursor. Dragging to reposition still works (cosmetic only,
   *  reveals nothing) — used for a subcontractor session viewing someone
   *  else's redline, where the box must exist but never open on click. */
  interactive: boolean
}

interface Props {
  anchors: CalloutAnchor[]
  /** Current page zoom (1 = 100%) — boxX/boxY/targetX/targetY are all plain
   *  naturalSize-space numbers now (the box lives inside the same pan/zoom
   *  transformed div as the page), so a drag's raw screen-pixel mouse delta
   *  has to be divided by zoom to land the box the same visual distance the
   *  cursor actually moved. */
  zoom: number
  selectedId: string | null
  onSelect: (markup: FieldMarkup) => void
  onMove: (id: string, offsetX: number, offsetY: number) => void
  /** Fires once, on drag release (not per-pixel like onMove) — the hook to persist
   *  the final position, so dragging doesn't hammer localStorage on every mousemove. */
  onMoveEnd: (id: string, offsetX: number, offsetY: number) => void
  /** Live-updates scale while dragging the corner handle (see onResizeEnd). */
  onResize: (id: string, scale: number) => void
  /** Fires once, on drag release — persists the final scale to the markup itself. */
  onResizeEnd: (id: string, scale: number) => void
  onEdit: (markup: FieldMarkup) => void
  onDelete: (markup: FieldMarkup) => void
  onClose: () => void
  /** True while a click-based draw tool is armed (dropping a point, drawing a
   *  line, etc.) — existing callout boxes must let clicks fall through to the
   *  page underneath instead of intercepting them, otherwise placing a second
   *  Fiber Tick Mark/Loop/Snow Shoe (or any point) near an already-annotated
   *  one re-selects the old callout instead of drawing a new point. */
  drawSessionActive?: boolean
}

/** PDF Field Map's callout system — the equivalent of KmzMap.tsx's DOM overlay +
 *  dashed leader line, but built as plain React state/JSX since this page has no
 *  imperative Leaflet map to hang event listeners off of. Rendered as a CHILD of
 *  the page's own pan/zoom-transformed canvas div (not a viewport-fixed sibling),
 *  in the same naturalSize coordinate space as the page's own markup SVG — so it
 *  scales visually right along with the print underneath it, same as any other
 *  drawn annotation, instead of staying a constant on-screen size regardless of
 *  zoom. Deliberate: with several redlines and callouts on one sheet, a
 *  screen-fixed-size box increasingly covers the print as you zoom out; this way
 *  a callout is only ever as big on screen as it was when it was drawn, and
 *  reading it again just means zooming back into that spot.
 *  Never shows a photo thumbnail — photo count is already part of `text`. */
export function PdfCalloutOverlay({ anchors, zoom, selectedId, onSelect, onMove, onMoveEnd, onResize, onResizeEnd, onEdit, onDelete, onClose, drawSessionActive = false }: Props) {
  if (anchors.length === 0) return null

  // Proportional corner-drag resize: scale changes by the ratio of the mouse's
  // current distance from the box's own top-left corner to its distance when
  // the drag started. Measured off the box's real, already-rendered
  // getBoundingClientRect (which already reflects page zoom * the box's own
  // prior scale), so this needs no manual zoom math the way onDragStart does —
  // the ratio is scale-independent by construction.
  function onResizeStart(e: React.MouseEvent, anchor: CalloutAnchor, boxEl: HTMLElement) {
    e.preventDefault()
    e.stopPropagation()
    const startScale = anchor.scale
    const rect = boxEl.getBoundingClientRect()
    const originX = rect.left, originY = rect.top
    const dist = (clientX: number, clientY: number) => Math.max(20, Math.hypot(clientX - originX, clientY - originY))
    const startDist = dist(e.clientX, e.clientY)
    const clamp = (s: number) => Math.min(4, Math.max(0.4, s))
    function onMouseMove(ev: MouseEvent) {
      onResize(anchor.markup.id, clamp(startScale * (dist(ev.clientX, ev.clientY) / startDist)))
    }
    function onMouseUp(ev: MouseEvent) {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      onResizeEnd(anchor.markup.id, clamp(startScale * (dist(ev.clientX, ev.clientY) / startDist)))
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  function onDragStart(e: React.MouseEvent, anchor: CalloutAnchor) {
    e.stopPropagation()
    const startX = e.clientX, startY = e.clientY
    const startOffsetX = anchor.boxX - anchor.targetX
    const startOffsetY = anchor.boxY - anchor.targetY
    let moved = false
    let lastOffsetX = startOffsetX, lastOffsetY = startOffsetY
    function onMouseMove(ev: MouseEvent) {
      if (Math.abs(ev.clientX - startX) > 6 || Math.abs(ev.clientY - startY) > 6) moved = true
      // Raw mouse movement is in screen pixels; the box lives in a zoom-scaled
      // coordinate space now, so divide by zoom to track the cursor 1:1.
      lastOffsetX = startOffsetX + (ev.clientX - startX) / zoom
      lastOffsetY = startOffsetY + (ev.clientY - startY) / zoom
      onMove(anchor.markup.id, lastOffsetX, lastOffsetY)
    }
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      // A non-drag click selects the linked map object — this is how clicking a
      // callout highlights its connected shape, and vice versa (both drive the
      // same selectedMarkup, since the callout has no identity of its own).
      // Non-interactive anchors (someone else's redline, subcontractor session)
      // skip selection entirely — purely visual, dragging still works.
      if (!moved) { if (anchor.interactive) onSelect(anchor.markup); return }
      onMoveEnd(anchor.markup.id, lastOffsetX, lastOffsetY)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 overflow-visible">
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
            className={`absolute z-[1000] min-w-[150px] w-max max-w-[280px] overflow-hidden rounded-lg p-2.5 ${drawSessionActive ? 'pointer-events-none' : 'pointer-events-auto'} ${a.interactive ? 'cursor-pointer' : 'cursor-default'}`}
            style={{
              left: a.boxX, top: a.boxY,
              // The extra manual scale layers on top of the page's own zoom
              // scaling (already applied by the ancestor transform this whole
              // overlay lives inside) — transformOrigin 'top left' so resizing
              // grows toward the bottom-right, keeping the leader-line
              // connection point (top-left-ish, see the <line> above) fixed.
              transform: a.scale !== 1 ? `scale(${a.scale})` : undefined,
              transformOrigin: 'top left',
              background: 'rgba(0,0,0,0.9)', border: `1.5px solid ${color}`, color: '#f1f5f9',
              fontSize: m.fontSize ?? 11,
              boxShadow: '0 4px 18px rgba(0,0,0,0.65)',
              outline: isSelected ? '3px solid #22d3ee' : undefined, outlineOffset: isSelected ? 2 : undefined,
            }}
            onMouseDown={(e) => onDragStart(e, a)}
          >
            {a.interactive && (
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
            )}
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
            {a.interactive && (
              <div
                title="Drag to resize"
                onMouseDown={(e) => onResizeStart(e, a, e.currentTarget.parentElement as HTMLElement)}
                className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 cursor-nwse-resize opacity-50 hover:opacity-100"
                style={{
                  borderRight: `2px solid ${color}`, borderBottom: `2px solid ${color}`,
                  borderBottomRightRadius: 3,
                }}
              />
            )}
          </div>
        )
      })}
    </>
  )
}
