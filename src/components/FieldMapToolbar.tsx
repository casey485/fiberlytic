/**
 * FieldMapToolbar — the single top toolbar for the Field Map's editing engine.
 * Same tools regardless of whether the background is a KMZ vector layer or a
 * georeferenced PDF raster overlay — only the background differs.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MousePointer2, Hand, Plus, Circle, Square, Minus, Waypoints, Spline, Type,
  MessageSquare, ArrowUpRight, Ruler, Scissors, Combine, Magnet, Layers,
  Undo2, Redo2, Trash2, Save, PenTool, MapPinPlus, ChevronDown, Cloud, Highlighter, MoreHorizontal,
} from 'lucide-react'
import type { MarkupTool } from '../types'

export type FieldMapDrawTool =
  | 'select' | 'point' | 'line' | 'multi_line' | 'polygon' | 'rect' | 'circle'
  | 'pen' | 'text' | 'callout' | 'arrow' | 'measure' | 'split' | 'merge'
  | 'cloud' | 'highlight' | 'ellipse'

interface Props {
  activeTool: FieldMapDrawTool | MarkupTool | string
  onSelectTool: (tool: FieldMapDrawTool) => void
  onAddWork: () => void
  editMode: 'none' | 'vertices' | 'move'
  onToggleVertexEdit: () => void
  canVertexEdit: boolean
  snapEnabled: boolean
  onToggleSnap: () => void
  onOpenLayerManager: () => void
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
}

const TOOL_BUTTONS: { tool: FieldMapDrawTool; labelKey: string; icon: React.ReactNode }[] = [
  { tool: 'select', labelKey: 'toolbar.select', icon: <MousePointer2 size={15} /> },
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
  { tool: 'split', labelKey: 'toolbar.split', icon: <Scissors size={15} /> },
]

const MORE_SHAPES: { tool: FieldMapDrawTool; labelKey: string; icon: React.ReactNode }[] = [
  { tool: 'cloud', labelKey: 'toolbar.cloud', icon: <Cloud size={14} /> },
  { tool: 'highlight', labelKey: 'toolbar.highlight', icon: <Highlighter size={14} /> },
  { tool: 'ellipse', labelKey: 'toolbar.ellipse', icon: <Circle size={14} /> },
]

function ToolbarButton({
  active, disabled, title, onClick, children,
}: { active?: boolean; disabled?: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
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

export function FieldMapToolbar({
  activeTool, onSelectTool, onAddWork,
  editMode, onToggleVertexEdit, canVertexEdit,
  snapEnabled, onToggleSnap, onOpenLayerManager,
  onUndo, onRedo, onDelete, canDelete, onSave, canSave,
  canMerge, onMerge, advancedToolsChildren,
}: Props) {
  const { t } = useTranslation()
  const [moreShapesOpen, setMoreShapesOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const isMoreShapeActive = MORE_SHAPES.some((s) => s.tool === activeTool)

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

      <div className="mx-1 h-4 w-px bg-[#2a2a2a] shrink-0" />

      {TOOL_BUTTONS.map(({ tool, labelKey, icon }) => (
        <ToolbarButton key={tool} active={activeTool === tool} title={t(labelKey)} onClick={() => onSelectTool(tool)}>
          {icon}
        </ToolbarButton>
      ))}

      {/* More Shapes flyout: Cloud, Highlight, Ellipse */}
      <div className="relative shrink-0">
        <button
          onClick={() => setMoreShapesOpen((o) => !o)}
          title={t('toolbar.moreShapes')}
          className={`flex items-center gap-0.5 rounded-md p-1.5 transition ${
            isMoreShapeActive ? 'bg-brand-600/25 text-brand-300' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
        >
          <Cloud size={15} />
          <ChevronDown size={10} className={`transition-transform ${moreShapesOpen ? 'rotate-180' : ''}`} />
        </button>
        {moreShapesOpen && (
          <div className="absolute left-0 top-full z-[2000] mt-1 w-40 rounded-md border border-[#2a3347] bg-[#0d0d0d] py-1 shadow-xl">
            {MORE_SHAPES.map(({ tool, labelKey, icon }) => (
              <button
                key={tool}
                onClick={() => { onSelectTool(tool); setMoreShapesOpen(false) }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition hover:bg-white/5 ${
                  activeTool === tool ? 'text-brand-300' : 'text-slate-300'
                }`}
              >
                {icon} {t(labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mx-1 h-4 w-px bg-[#2a2a2a] shrink-0" />

      <ToolbarButton active={canMerge && activeTool === 'merge'} disabled={!canMerge && activeTool !== 'merge'} title={t('toolbar.merge')} onClick={() => (activeTool === 'merge' ? onMerge() : onSelectTool('merge'))}>
        <Combine size={15} />
      </ToolbarButton>
      <ToolbarButton active={editMode === 'vertices'} disabled={!canVertexEdit} title={t('toolbar.vertexEdit')} onClick={onToggleVertexEdit}>
        <Spline size={15} />
      </ToolbarButton>
      <ToolbarButton active={snapEnabled} title={t('toolbar.snap')} onClick={onToggleSnap}>
        <Magnet size={15} />
      </ToolbarButton>
      <ToolbarButton title={t('toolbar.layerManager')} onClick={onOpenLayerManager}>
        <Layers size={15} />
      </ToolbarButton>

      <div className="mx-1 h-4 w-px bg-[#2a2a2a] shrink-0" />

      <ToolbarButton title={t('toolbar.undo')} onClick={onUndo}><Undo2 size={15} /></ToolbarButton>
      <ToolbarButton title={t('toolbar.redo')} onClick={onRedo}><Redo2 size={15} /></ToolbarButton>
      <ToolbarButton title={t('toolbar.delete')} disabled={!canDelete} onClick={onDelete}><Trash2 size={15} /></ToolbarButton>
      <ToolbarButton title={t('toolbar.save')} disabled={!canSave} onClick={onSave}><Save size={15} /></ToolbarButton>

      {advancedToolsChildren && (
        <>
          <div className="mx-1 h-4 w-px bg-[#2a2a2a] shrink-0" />
          <div className="relative shrink-0">
            <ToolbarButton active={advancedOpen} title={t('toolbar.advancedTools')} onClick={() => setAdvancedOpen((o) => !o)}>
              <MoreHorizontal size={15} />
            </ToolbarButton>
            {advancedOpen && (
              <div className="absolute right-0 top-full z-[2000] mt-1 w-48 rounded-md border border-[#2a3347] bg-[#0d0d0d] py-1 shadow-xl">
                {advancedToolsChildren}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
