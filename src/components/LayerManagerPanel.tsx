/**
 * Layer Manager — one panel covering all three visibility layers on the Field
 * Map: Work Object layers (crew/supervisor/qc/as_built/production/billing),
 * KMZ import layers (by layerName), and georeferenced PDF overlays.
 */
import { useState } from 'react'
import { X, Eye, EyeOff, ChevronRight } from 'lucide-react'
import { MARKUP_LAYER_META } from '../types'
import type { MarkupLayer, GeoreferencedOverlay, MapFeature } from '../types'

interface Props {
  onClose: () => void
  visibleLayers: Set<MarkupLayer>
  onToggleWorkObjectLayer: (layer: MarkupLayer) => void
  allKmzLayerNames: string[]
  hiddenKmzLayerNames: Set<string>
  onToggleKmzLayer: (layerName: string) => void
  featuresByLayer: MapFeature[]
  hiddenFeatureIds: Set<string>
  onToggleFeature: (featureId: string) => void
  overlays: GeoreferencedOverlay[]
  onToggleOverlay: (id: string, visible: boolean) => void
}

function Row({ label, color, visible, onToggle }: { label: string; color?: string; visible: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] hover:bg-white/5 transition"
    >
      {visible ? <Eye size={12} className="text-slate-400 shrink-0" /> : <EyeOff size={12} className="text-slate-700 shrink-0" />}
      {color && <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />}
      <span className={visible ? 'text-slate-300' : 'text-slate-600'}>{label}</span>
    </button>
  )
}

function ExpandableKmzLayerRow({
  layerName, visible, onToggle, features, hiddenFeatureIds, onToggleFeature,
}: {
  layerName: string
  visible: boolean
  onToggle: () => void
  features: MapFeature[]
  hiddenFeatureIds: Set<string>
  onToggleFeature: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div>
      <div className="flex items-center">
        <button
          onClick={() => setExpanded((e) => !e)}
          disabled={features.length === 0}
          className="p-1 text-slate-600 hover:text-slate-300 disabled:opacity-20"
        >
          <ChevronRight size={11} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
        <div className="flex-1">
          <Row label={`${layerName} (${features.length})`} visible={visible} onToggle={onToggle} />
        </div>
      </div>
      {expanded && (
        <div className="ml-5 border-l border-[#2a2a2a] pl-1">
          {features.map((f) => (
            <Row
              key={f.id}
              label={f.name ?? f.id}
              visible={visible && !hiddenFeatureIds.has(f.id)}
              onToggle={() => onToggleFeature(f.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function LayerManagerPanel({
  onClose, visibleLayers, onToggleWorkObjectLayer,
  allKmzLayerNames, hiddenKmzLayerNames, onToggleKmzLayer,
  featuresByLayer, hiddenFeatureIds, onToggleFeature,
  overlays, onToggleOverlay,
}: Props) {
  return (
    <div className="flex h-full flex-col bg-[#111111]">
      <div className="flex shrink-0 items-center justify-between border-b border-[#1e1e1e] px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Layer Manager</p>
        <button onClick={onClose} className="rounded p-1 text-slate-600 hover:text-slate-300">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Work Object Layers</p>
          {(Object.keys(MARKUP_LAYER_META) as MarkupLayer[]).map((layer) => (
            <Row
              key={layer}
              label={MARKUP_LAYER_META[layer].label}
              color={MARKUP_LAYER_META[layer].color}
              visible={visibleLayers.has(layer)}
              onToggle={() => onToggleWorkObjectLayer(layer)}
            />
          ))}
        </div>

        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">KMZ Layers</p>
          {allKmzLayerNames.length === 0 && <p className="text-[11px] text-slate-600">No KMZ layers imported yet.</p>}
          {allKmzLayerNames.map((layerName) => (
            <ExpandableKmzLayerRow
              key={layerName}
              layerName={layerName}
              visible={!hiddenKmzLayerNames.has(layerName)}
              onToggle={() => onToggleKmzLayer(layerName)}
              features={featuresByLayer.filter((f) => f.layerName === layerName)}
              hiddenFeatureIds={hiddenFeatureIds}
              onToggleFeature={onToggleFeature}
            />
          ))}
        </div>

        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">PDF Overlays</p>
          {overlays.length === 0 && <p className="text-[11px] text-slate-600">No PDF overlays anchored yet.</p>}
          {overlays.map((o) => (
            <Row
              key={o.id}
              label={`Overlay (page ${o.pageIndex + 1})`}
              visible={o.visible}
              onToggle={() => onToggleOverlay(o.id, !o.visible)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
