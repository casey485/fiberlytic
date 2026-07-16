/**
 * FieldMapToolbar — the single top toolbar for the Field Map's editing engine.
 * Same tools regardless of whether the background is a KMZ vector layer or a
 * georeferenced PDF raster overlay — only the background differs.
 *
 * Clean by default: only Select + Add Work show until an Add Work session is
 * active (a Work Type has been picked). Once active, only the tools relevant
 * to that Work Type appear, plus a "More Tools" flyout for everything else —
 * nothing is ever truly unreachable, just deprioritized. Saving/cancelling the
 * session hides everything again.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Hand, Plus, Circle, Square, Minus, Waypoints, Spline, Type,
  MessageSquare, ArrowUpRight, Ruler, Scissors, Combine, Magnet, Layers,
  Undo2, Redo2, Trash2, Save, PenTool, MapPinPlus, ChevronDown, Cloud, Highlighter,
  MoreHorizontal, Wrench,
} from 'lucide-react'
import type { MarkupTool } from '../types'
import { ENGINEERING_SYMBOLS } from '../lib/engineeringSymbols'
import { SymbolIcon } from './SymbolIcon'

export type FieldMapDrawTool =
  | 'select' | 'point' | 'line' | 'multi_line' | 'polygon' | 'rect' | 'circle'
  | 'pen' | 'text' | 'callout' | 'arrow' | 'measure' | 'split' | 'merge'
  | 'cloud' | 'highlight' | 'ellipse'
  | MarkupTool

interface Props {
  activeTool: FieldMapDrawTool | MarkupTool | string
  onSelectTool: (tool: FieldMapDrawTool) => void
  onAddWork: () => void
  editMode: 'none' | 'vertices' | 'move'
  onToggleVertexEdit: () => void
  canVertexEdit: boolean
  snapEnabled: boolean
  onToggleSnap: () => void
  /** Omitted (undefined) in PDF Print Mode — a single PDF page has no layers to manage. */
  onOpenLayerManager?: () => void
  onUndo: () => void
  onRedo: () => void
  onDelete: () => void
  canDelete: boolean
  onSave: () => void
  canSave: boolean
  canMerge: boolean
  onMerge: () => void
  /** Optional menu items injected into the Advanced Tools dropdown (e.g. Export Report). */
  advancedToolsChildren?: React.ReactNode
  /** null = no Add Work session active — only Select + Add Work render. Otherwise, the curated
   * list of drawing tools relevant to the current Work Type; everything else in ALL_DRAW_TOOLS
   * still reachable via the "More Tools" flyout. */
  activeTools: FieldMapDrawTool[] | null
}

interface ToolButtonDef { tool: FieldMapDrawTool; labelKey?: string; label?: string; icon: React.ReactNode }

/** Every generic drawing tool that can appear as a primary button or in "More Tools" —
 * canonical display order. Select/Split/Merge are handled as their own dedicated
 * buttons, not part of this set. */
const GENERIC_DRAW_TOOLS: ToolButtonDef[] = [
  { tool: 'point', labelKey: 'toolbar.point', icon: <MapPinPlus size={15} /> },
  { tool: 'line', labelKey: 'toolbar.line', icon: <Minus size={15} /> },
  { tool: 'multi_line', labelKey: 'toolbar.multiLine', icon: <Waypoints size={15} /> },
  { tool: 'polygon', labelKey: 'toolbar.polygon', icon: <Square size={15} /> },
  { tool: 'rect', labelKey: 'toolbar.rectangle', icon: <Square size={15} /> },
  { tool: 'circle', labelKey: 'toolbar.circle', icon: <Circle size={15} /> },
  { tool: 'pen', labelKey: 'toolbar.freehand', icon: <PenTool size={15} /> },
  { tool: 'text', labelKey: 'toolbar.text', icon: <Type size={15} /> },
  { tool: 'callout', labelKey: 'toolbar.callout', icon: <MessageSquare size={15} /> },
  { tool: 'arrow', labelKey: 'toolbar.arrow', icon: <ArrowUpRight size={15} /> },
  { tool: 'measure', labelKey: 'toolbar.measure', icon: <Ruler size={15} /> },
  { tool: 'cloud', labelKey: 'toolbar.cloud', icon: <Cloud size={14} /> },
  { tool: 'highlight', labelKey: 'toolbar.highlight', icon: <Highlighter size={14} /> },
  { tool: 'ellipse', labelKey: 'toolbar.ellipse', icon: <Circle size={14} /> },
]

/** Engineering symbol tools (src/lib/engineeringSymbols.ts) — plain-text labels, not
 * i18n keys, since the symbol catalog isn't localized in this pass. */
const SYMBOL_DRAW_TOOLS: ToolButtonDef[] = ENGINEERING_SYMBOLS.map((s) => ({
  tool: s.tool, label: s.label, icon: <SymbolIcon def={s} />,
}))

const ALL_DRAW_TOOLS: ToolButtonDef[] = [...GENERIC_DRAW_TOOLS, ...SYMBOL_DRAW_TOOLS]

function ToolbarButton({
  active, disabled, title, onClick, children,
}: { active?: boolean; disabled?: boolean; title: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center justify-center rounded-md p-1.5 transition shrink-0 disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? 'bg-brand-600/25 text-brand-300' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  )
}

const Divider = () => <div className="mx-1 h-4 w-px bg-[#2a2a2a] shrink-0" />

export function FieldMapToolbar({
  activeTool, onSelectTool, onAddWork,
  editMode, onToggleVertexEdit, canVertexEdit,
  snapEnabled, onToggleSnap, onOpenLayerManager,
  onUndo, onRedo, onDelete, canDelete, onSave, canSave,
  canMerge, onMerge, advancedToolsChildren,
  activeTools,
}: Props) {
  const { t } = useTranslation()
  // Stores the trigger button's screen position (not just an open/closed
  // flag) so the dropdown can render with position:fixed, anchored to that
  // point — position:absolute here would nest it inside the map's own local
  // stacking context (see KmzMap.tsx's comments on mapContainer's z-500:
  // "no matter how high a z-index it's given locally"), so the map paints
  // over it regardless of z-index. position:fixed escapes that entirely,
  // the same pattern already used for the map's other floating panels.
  const [moreToolsAnchor, setMoreToolsAnchor] = useState<{ left: number; top: number } | null>(null)
  const [advancedAnchor, setAdvancedAnchor] = useState<{ right: number; top: number } | null>(null)

  const sessionActive = activeTools !== null
  const primaryTools = sessionActive ? ALL_DRAW_TOOLS.filter((d) => activeTools.includes(d.tool)) : []
  const overflowTools = sessionActive ? ALL_DRAW_TOOLS.filter((d) => !activeTools.includes(d.tool)) : []
  const isOverflowActive = overflowTools.some((d) => d.tool === activeTool)

  return (
    <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-[#1e1e1e] bg-[#0d0d0d] px-2 py-1.5">
      <ToolbarButton active={activeTool === 'select'} title={t('toolbar.select')} onClick={() => onSelectTool('select')}>
        <Hand size={15} />
      </ToolbarButton>

      <button
        onClick={onAddWork}
        title={t('toolbar.addWork')}
        className="mx-1 flex shrink-0 items-center gap-1.5 rounded-md bg-orange-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-orange-400 transition"
      >
        <Plus size={13} /> {t('toolbar.addWork')}
      </button>

      <Divider />

      {/* Undo/Redo/Delete act on already-drawn work, not on starting new work — part of the
          clean base toolbar alongside Select/Add Work, not gated on an Add Work session. */}
      <ToolbarButton title={t('toolbar.undo')} onClick={onUndo}><Undo2 size={15} /></ToolbarButton>
      <ToolbarButton title={t('toolbar.redo')} onClick={onRedo}><Redo2 size={15} /></ToolbarButton>
      <ToolbarButton title={t('toolbar.delete')} disabled={!canDelete} onClick={onDelete}><Trash2 size={15} /></ToolbarButton>

      {sessionActive && (
        <>
          <Divider />

          {primaryTools.map(({ tool, label, labelKey, icon }) => (
            <ToolbarButton key={tool} active={activeTool === tool} title={label ?? t(labelKey!)} onClick={() => onSelectTool(tool)}>
              {icon}
            </ToolbarButton>
          ))}

          {overflowTools.length > 0 && (
            <div className="relative shrink-0">
              <button
                onClick={(e) => {
                  if (moreToolsAnchor) { setMoreToolsAnchor(null); return }
                  const rect = e.currentTarget.getBoundingClientRect()
                  setMoreToolsAnchor({ left: rect.left, top: rect.bottom + 4 })
                }}
                title={t('toolbar.moreTools')}
                className={`flex items-center gap-0.5 rounded-md p-1.5 transition ${
                  isOverflowActive ? 'bg-brand-600/25 text-brand-300' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                <Wrench size={15} />
                <ChevronDown size={10} className={`transition-transform ${moreToolsAnchor ? 'rotate-180' : ''}`} />
              </button>
              {moreToolsAnchor && (
                <div
                  className="fixed z-[2000] max-h-[60vh] w-40 overflow-y-auto rounded-md border border-[#2a3347] bg-[#0d0d0d] py-1 shadow-xl"
                  style={{ left: moreToolsAnchor.left, top: moreToolsAnchor.top }}
                >
                  {overflowTools.map(({ tool, label, labelKey, icon }) => (
                    <button
                      key={tool}
                      onClick={() => { onSelectTool(tool); setMoreToolsAnchor(null) }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition hover:bg-white/5 ${
                        activeTool === tool ? 'text-brand-300' : 'text-slate-300'
                      }`}
                    >
                      {icon} {label ?? t(labelKey!)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <Divider />

          <ToolbarButton active={activeTool === 'split'} title={t('toolbar.split')} onClick={() => onSelectTool('split')}>
            <Scissors size={15} />
          </ToolbarButton>
          <ToolbarButton active={canMerge && activeTool === 'merge'} disabled={!canMerge && activeTool !== 'merge'} title={t('toolbar.merge')} onClick={() => (activeTool === 'merge' ? onMerge() : onSelectTool('merge'))}>
            <Combine size={15} />
          </ToolbarButton>
          <ToolbarButton active={editMode === 'vertices'} disabled={!canVertexEdit} title={t('toolbar.vertexEdit')} onClick={onToggleVertexEdit}>
            <Spline size={15} />
          </ToolbarButton>
          <ToolbarButton active={snapEnabled} title={t('toolbar.snap')} onClick={onToggleSnap}>
            <Magnet size={15} />
          </ToolbarButton>

          <Divider />

          <ToolbarButton title={t('toolbar.save')} disabled={!canSave} onClick={onSave}><Save size={15} /></ToolbarButton>
        </>
      )}

      {(onOpenLayerManager || advancedToolsChildren) && <Divider />}

      {onOpenLayerManager && (
        <ToolbarButton title={t('toolbar.layerManager')} onClick={onOpenLayerManager}>
          <Layers size={15} />
        </ToolbarButton>
      )}

      {advancedToolsChildren && (
        <div className="relative shrink-0">
          <ToolbarButton
            active={!!advancedAnchor}
            title={t('toolbar.advancedTools')}
            onClick={(e) => {
              if (advancedAnchor) { setAdvancedAnchor(null); return }
              const rect = e.currentTarget.getBoundingClientRect()
              setAdvancedAnchor({ right: window.innerWidth - rect.right, top: rect.bottom + 4 })
            }}
          >
            <MoreHorizontal size={15} />
          </ToolbarButton>
          {advancedAnchor && (
            <div
              className="fixed z-[2000] max-h-[70vh] w-48 overflow-y-auto rounded-md border border-[#2a3347] bg-[#0d0d0d] py-1 shadow-xl"
              style={{ right: advancedAnchor.right, top: advancedAnchor.top }}
            >
              {advancedToolsChildren}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
