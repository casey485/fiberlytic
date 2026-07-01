/**
 * MarkupPanel — detail panel for a field markup item.
 * Opens when a new drawing is completed or an existing markup is clicked.
 * Handles: feature metadata, status/crew workflow, photo attachments, billing.
 */
import { useEffect, useRef, useState } from 'react'
import {
  X, Save, Trash2, Camera, ImagePlus, ChevronDown, Plus, Check,
  DollarSign, Image, Lock, Unlock, Send, CheckCircle2, Move, Spline,
} from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { saveBlob, loadBlob } from '../lib/fileStore'
import { MARKUP_STATUS_META } from '../types'
import type { FieldMarkup, MarkupBilling, MarkupPhoto, MarkupAttachment, InspectionItem, InspectionResult, MarkupStatus } from '../types'
import type { EditMode } from '../lib/markupLayer'
import { FEATURE_DROP_TOOLS, FEATURE_TOOL_LABELS } from '../lib/markupMeta'
import { submitMarkupToProduction } from '../lib/productionFromMarkup'
import { WORK_OBJECT_TYPE_MAP } from '../lib/workObjectTypes'

// Re-export so existing imports from MarkupPanel still work
export { FEATURE_DROP_TOOLS, FEATURE_TOOL_LABELS }

// ── Helpers ───────────────────────────────────────────────────────────────────

function isFeatureDrop(tool: string): boolean {
  return FEATURE_DROP_TOOLS.includes(tool as typeof FEATURE_DROP_TOOLS[number])
}

const STYLE_COLORS = ['#ef4444', '#f97316', '#facc15', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6', '#ffffff']
const STYLE_WEIGHTS = [
  { value: 1, label: 'XS' }, { value: 2, label: 'Thin' }, { value: 4, label: 'Med' },
  { value: 7, label: 'Thick' }, { value: 12, label: 'XL' },
]
const FONT_FAMILIES = ['inherit', 'Arial', 'Georgia', 'Courier New', 'Verdana']
const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 22, 28]

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{children}</label>
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="mb-3">{children}</div>
}

// ── Photo thumbnail component ─────────────────────────────────────────────────

function PhotoThumb({ photo, onDelete }: { photo: MarkupPhoto; onDelete: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    loadBlob(`mkp-${photo.id}`).then((url) => setSrc(url))
  }, [photo.id])

  if (!src) return (
    <div className="h-16 w-16 rounded bg-[#1e1e1e] animate-pulse shrink-0" />
  )

  return (
    <>
      <div className="relative group/ph shrink-0">
        <button onClick={() => setOpen(true)} className="block h-16 w-16 rounded overflow-hidden border border-[#2a3347]">
          <img src={src} alt={photo.caption ?? ''} className="h-full w-full object-cover" />
        </button>
        <button
          onClick={onDelete}
          className="absolute -top-1 -right-1 hidden group-hover/ph:flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white"
        >
          <X size={8} />
        </button>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80"
          onClick={() => setOpen(false)}
        >
          <img src={src} alt={photo.caption ?? ''} className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl" />
        </div>
      )}
    </>
  )
}

// ── Video thumbnail component ──────────────────────────────────────────────────

function VideoThumb({ video, onDelete }: { video: { id: string; caption: string | null }; onDelete: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { loadBlob(`mkp-${video.id}`).then(setSrc) }, [video.id])
  if (!src) return <div className="h-16 w-16 rounded bg-[#1e1e1e] animate-pulse shrink-0" />
  return (
    <div className="relative group/vid shrink-0">
      <video src={src} className="h-16 w-16 rounded object-cover border border-[#2a3347]" muted />
      <button
        onClick={onDelete}
        className="absolute -top-1 -right-1 hidden group-hover/vid:flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white"
      >
        <X size={8} />
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  markup: FieldMarkup
  onClose: () => void
  onDelete?: () => void
  onCalloutCreated?: (center: [number, number], label: string, photoBlobKey: string | null, color: string) => void
  editMode?: EditMode
  onSetEditMode?: (mode: EditMode) => void
}

export function MarkupPanel({ markup, onClose, onDelete, onCalloutCreated, editMode = 'none', onSetEditMode }: Props) {
  const {
    data, updateMarkup, deleteMarkup, addMarkup,
    addMarkupPhoto, deleteMarkupPhoto,
    addMarkupBilling, updateMarkupBilling, deleteMarkupBilling,
    addProduction,
    addMarkupVideo, deleteMarkupVideo, addMarkupInspection, addMarkupAttachment, deleteMarkupAttachment,
  } = useData()
  const { activeEmployeeId } = useRole()

  const [tab, setTab] = useState<'notes' | 'photos' | 'billing' | 'inspection' | 'history' | 'attachments'>('notes')
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Notes form state ─────────────────────────────────────────────────────
  const [featureName, setFeatureName] = useState(markup.featureName ?? '')
  const [notes, setNotes]             = useState(markup.notes ?? '')
  const [status, setStatus]           = useState<MarkupStatus>(markup.status)
  const [dirty, setDirty]             = useState(false)

  // ── Photos ────────────────────────────────────────────────────────────────
  const photos = (data.markupPhotos ?? []).filter((p) => p.markupId === markup.id)
  const videos = (data.markupVideos ?? []).filter((v) => v.markupId === markup.id)

  // ── Inspections ───────────────────────────────────────────────────────────
  const inspections = (data.markupInspections ?? []).filter((i) => i.markupId === markup.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const inspectionTemplate = markup.workObjectType ? WORK_OBJECT_TYPE_MAP[markup.workObjectType]?.inspectionTemplate ?? [] : []
  const [newInspectionItems, setNewInspectionItems] = useState<InspectionItem[] | null>(null)

  // ── History ───────────────────────────────────────────────────────────────
  const historyEntries = (data.markupHistory ?? []).filter((h) => h.markupId === markup.id)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))

  // ── Attachments ───────────────────────────────────────────────────────────
  const attachments = (data.markupAttachments ?? []).filter((a) => a.markupId === markup.id)
  const attachmentInputRef = useRef<HTMLInputElement>(null)

  // ── Billing ───────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const billingEntries = (data.markupBilling ?? []).filter((b) => b.markupId === markup.id)
  const [newDate, setNewDate]             = useState(today)
  const [newCrewId, setNewCrewId]         = useState('')
  const [newRateCode, setNewRateCode]     = useState('')
  const [newDesc, setNewDesc]             = useState('')
  const [newUnit, setNewUnit]             = useState('LF')
  const [newQty, setNewQty]               = useState<number>(markup.lengthFt ? Math.round(markup.lengthFt) : 1)
  const [newRate, setNewRate]             = useState<number>(0)
  const [newBillable, setNewBillable]     = useState(true)
  const [newNotes, setNewNotes]           = useState('')
  const [addingBilling, setAddingBilling] = useState(false)

  const allRateCards = data.rateCards ?? []
  const allRateUnits = data.rateCardUnits ?? []
  const project = data.projects.find((p) => p.id === markup.projectId)
  const client  = project?.clientId ? data.clients.find((c) => c.id === project.clientId) : undefined
  const crews   = data.crews ?? []

  // Filter rate units to project/client if possible
  const relevantUnits = (() => {
    if (!project?.clientId) return allRateUnits
    const clientCards = allRateCards.filter((rc) => rc.clientId === project.clientId).map((rc) => rc.id)
    const clientUnits = allRateUnits.filter((u) => clientCards.includes(u.rateCardId))
    return clientUnits.length > 0 ? clientUnits : allRateUnits
  })()

  const isLocked = !!markup.lockedAt
  const billingTotal = billingEntries.reduce((s, b) => s + b.total, 0)

  function markDirty() { setDirty(true) }

  function saveDetails() {
    updateMarkup(markup.id, {
      featureName: featureName || null,
      notes: notes || null,
    }, activeEmployeeId)
    setDirty(false)
  }

  // ── Photo / video upload ──────────────────────────────────────────────────
  async function handlePhotoFiles(files: FileList | null) {
    if (!files) return
    for (const file of Array.from(files)) {
      await new Promise<void>((resolve) => {
        const reader = new FileReader()
        reader.onload = async (ev) => {
          const dataUrl = ev.target?.result as string
          if (file.type.startsWith('video/')) {
            const id = addMarkupVideo({ markupId: markup.id, caption: null, takenAt: new Date().toISOString() })
            await saveBlob(`mkp-${id}`, dataUrl)
            resolve()
            return
          }
          const id = addMarkupPhoto({
            markupId: markup.id,
            caption: null,
            takenAt: new Date().toISOString(),
            uploadedBy: null,
            lat: null,
            lng: null,
          }, activeEmployeeId)
          await saveBlob(`mkp-${id}`, dataUrl)
          resolve()
        }
        reader.readAsDataURL(file)
      })
    }
  }

  // ── Billing ───────────────────────────────────────────────────────────────
  function handleAddBilling() {
    if (!newRateCode && !newDesc) return
    addMarkupBilling({
      markupId: markup.id,
      date: newDate || null,
      crewId: newCrewId || null,
      rateCode: newRateCode,
      description: newDesc,
      unitType: newUnit,
      quantity: newQty,
      rate: newRate,
      total: Math.round(newQty * newRate * 100) / 100,
      billable: newBillable,
      invoiceStatus: 'not_billed',
      notes: newNotes || null,
    }, activeEmployeeId)
    setNewDate(today); setNewCrewId(''); setNewRateCode(''); setNewDesc('')
    setNewQty(markup.lengthFt ? Math.round(markup.lengthFt) : 1)
    setNewRate(0); setNewNotes('')
    setAddingBilling(false)
  }

  // ── Submit billing to production / P&L ───────────────────────────────────
  function handleSubmitToProduction() {
    const billableCount = billingEntries.filter((b) => b.billable && b.total > 0).length
    if (billableCount === 0) return
    if (!confirm(`Submit ${billableCount} billing line${billableCount > 1 ? 's' : ''} to production and revenue?`)) return

    setSubmitting(true)
    try {
      const result = submitMarkupToProduction({
        markup, billingEntries, photos, featureName, notes, activeEmployeeId, data,
        addProduction, updateMarkupBilling, updateMarkup, addMarkup,
      })
      if (!result) return
      setStatus('billed')
      if (result.calloutCenter && result.calloutLabel) {
        onCalloutCreated?.(result.calloutCenter, result.calloutLabel, result.calloutPhotoBlobKey, markup.color)
      }
    } finally {
      setSubmitting(false)
    }
  }

  function handleDeleteMarkup() {
    if (!confirm('Delete this markup item? This cannot be undone.')) return
    deleteMarkup(markup.id)
    onDelete?.()
    onClose()
  }

  function toggleLock() {
    if (isLocked) {
      updateMarkup(markup.id, { lockedAt: null }, activeEmployeeId)
    } else {
      updateMarkup(markup.id, { lockedAt: new Date().toISOString() }, activeEmployeeId)
    }
  }

  const toolLabel = FEATURE_TOOL_LABELS[markup.tool]
  const toolMeta  = MARKUP_STATUS_META[status]

  function subtypeLabel(id: string | undefined): string {
    if (!id) return ''
    return id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
  }

  const displayName = markup.featureName
    || (markup.subtype ? subtypeLabel(markup.subtype) : null)
    || toolLabel?.label
    || markup.tool

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] border-l border-[#1e1e1e] text-slate-200 text-xs">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1e1e1e] shrink-0">
        {toolLabel && (
          <span
            className="shrink-0 flex h-6 w-8 items-center justify-center rounded text-[10px] font-bold"
            style={{ background: toolLabel.color + '33', color: toolLabel.color, border: `1px solid ${toolLabel.color}55` }}
          >
            {toolLabel.abbr}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-slate-100 truncate">
            {displayName}
          </p>
          <p className="text-[10px]" style={{ color: toolMeta.color }}>{toolMeta.label}</p>
        </div>
        {onSetEditMode && markup.tool !== 'callout' && !isLocked && (
          <>
            <button
              onClick={() => onSetEditMode(editMode === 'vertices' ? 'none' : 'vertices')}
              title="Edit vertices"
              className={`rounded p-1 transition ${editMode === 'vertices' ? 'bg-brand-600/30 text-brand-300' : 'text-slate-600 hover:text-slate-300'}`}
            >
              <Spline size={12} />
            </button>
            <button
              onClick={() => onSetEditMode(editMode === 'move' ? 'none' : 'move')}
              title="Move"
              className={`rounded p-1 transition ${editMode === 'move' ? 'bg-brand-600/30 text-brand-300' : 'text-slate-600 hover:text-slate-300'}`}
            >
              <Move size={12} />
            </button>
          </>
        )}
        <button onClick={toggleLock} title={isLocked ? 'Unlock' : 'Lock after approval'} className="rounded p-1 text-slate-600 hover:text-slate-300">
          {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
        </button>
        <button onClick={onClose} className="rounded p-1 text-slate-600 hover:text-slate-300">
          <X size={13} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0 overflow-x-auto border-b border-[#1e1e1e]">
        {(['notes', 'photos', 'billing', 'inspection', 'history', 'attachments'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wider transition ${
              tab === t ? 'border-b-2 border-brand-500 text-brand-400' : 'text-slate-600 hover:text-slate-400'
            }`}
          >
            {t === 'notes' ? 'Details' : t}
            {t === 'billing' && billingTotal > 0 ? ` ($${billingTotal.toFixed(0)})` : ''}
            {t === 'photos' && photos.length > 0 ? ` (${photos.length})` : ''}
            {t === 'inspection' && inspections.length > 0 ? ` (${inspections.length})` : ''}
            {t === 'attachments' && attachments.length > 0 ? ` (${attachments.length})` : ''}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-0">

        {/* ── Notes tab ───────────────────────────────────────────────── */}
        {tab === 'notes' && (
          <div className="space-y-3">
            {/* Feature type badge for pin drops */}
            {isFeatureDrop(markup.tool) && toolLabel && (
              <div className="flex items-center gap-2 rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5">
                <span className="h-5 w-7 rounded text-[9px] font-bold flex items-center justify-center shrink-0"
                  style={{ background: toolLabel.color + '33', color: toolLabel.color }}>
                  {toolLabel.abbr}
                </span>
                <span className="text-[11px] text-slate-300">{toolLabel.label}</span>
                {markup.lengthFt != null && (
                  <span className="ml-auto text-[10px] text-slate-500 shrink-0">{markup.lengthFt.toLocaleString()} ft</span>
                )}
              </div>
            )}

            {/* Measured length pill for line tools */}
            {!isFeatureDrop(markup.tool) && markup.lengthFt != null && markup.lengthFt > 0 && (
              <div className="flex items-center gap-1.5 rounded bg-[#141414] border border-[#2a3347] px-2 py-1 text-[10px] text-slate-500">
                <span className="text-slate-400 font-medium">{markup.lengthFt.toLocaleString()} ft</span>
                <span>measured</span>
              </div>
            )}

            {/* Smart construction metadata card */}
            {markup.workType && (
              <div className="rounded border border-[#2a3347] bg-[#0d0d0d] divide-y divide-[#1e1e1e]">
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    markup.workType === 'underground' ? 'bg-purple-900/50 text-purple-300' :
                    markup.workType === 'aerial'      ? 'bg-cyan-900/50 text-cyan-300' :
                    markup.workType === 'splicing'    ? 'bg-emerald-900/50 text-emerald-300' :
                    'bg-amber-900/50 text-amber-300'
                  }`}>{markup.workType}</span>
                  {markup.assetCategory && <span className="text-[10px] text-slate-500">{markup.assetCategory}</span>}
                  {markup.assetType && <span className="ml-auto text-[10px] font-medium text-slate-300">{markup.assetType}</span>}
                </div>
                <div className="grid grid-cols-2 gap-x-3 px-2 py-1.5 text-[10px]">
                  {markup.size && <div><span className="text-slate-600">Size</span> <span className="text-slate-300">{markup.size}</span></div>}
                  {markup.unit && <div><span className="text-slate-600">Unit</span> <span className="text-slate-300">{markup.unit}</span></div>}
                  {markup.quantity != null && <div><span className="text-slate-600">Qty</span> <span className="text-slate-300">{markup.quantity.toLocaleString()}</span></div>}
                  {markup.material && <div><span className="text-slate-600">Material</span> <span className="text-slate-300">{markup.material}</span></div>}
                </div>
                <div className="flex items-center gap-2 px-2 py-1.5 text-[9px]">
                  {markup.isBillable !== undefined && (
                    <span className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider ${markup.isBillable ? 'bg-emerald-900/40 text-emerald-400' : 'bg-[#1e1e1e] text-slate-600'}`}>
                      {markup.isBillable ? 'Billable' : 'Non-billable'}
                    </span>
                  )}
                  {markup.isProductionItem && (
                    <span className="rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider bg-brand-900/40 text-brand-400">Production</span>
                  )}
                  {markup.isQCRequired && (
                    <span className="rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider bg-purple-900/40 text-purple-400">QC Req.</span>
                  )}
                </div>
              </div>
            )}

            {/* Name / label */}
            <Field>
              <Label>Name / Label</Label>
              <input
                type="text"
                value={featureName}
                disabled={isLocked}
                onChange={(e) => { setFeatureName(e.target.value); markDirty() }}
                placeholder="e.g. HH-001, Splice A, Bore Crossing…"
                className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-[11px] text-slate-200 outline-none focus:border-brand-500 disabled:opacity-40"
              />
            </Field>

            {/* Notes — large, prominent */}
            <Field>
              <Label>Notes</Label>
              <textarea
                value={notes}
                disabled={isLocked}
                onChange={(e) => { setNotes(e.target.value); markDirty() }}
                rows={7}
                placeholder="Add field notes, instructions, conditions, issues…"
                className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-2 text-[11px] text-slate-200 outline-none focus:border-brand-500 resize-none disabled:opacity-40 leading-relaxed"
              />
            </Field>

            {/* Style */}
            {markup.tool !== 'callout' && (
              <div className="border-t border-[#1e1e1e] pt-2 space-y-2">
                <Label>Style</Label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {STYLE_COLORS.map((c) => (
                    <button
                      key={c}
                      disabled={isLocked}
                      onClick={() => updateMarkup(markup.id, { color: c }, activeEmployeeId)}
                      title={c}
                      className={`h-5 w-5 rounded-full border-2 transition disabled:opacity-40 ${markup.color === c ? 'border-white scale-110' : 'border-transparent hover:scale-110'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={markup.weight}
                    disabled={isLocked}
                    onChange={(e) => updateMarkup(markup.id, { weight: Number(e.target.value) }, activeEmployeeId)}
                    className="rounded border border-[#2a3347] bg-[#141414] px-1.5 py-1 text-[10px] text-slate-300 outline-none disabled:opacity-40"
                  >
                    {STYLE_WEIGHTS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                  </select>
                  <select
                    value={markup.opacity ?? 1}
                    disabled={isLocked}
                    onChange={(e) => updateMarkup(markup.id, { opacity: Number(e.target.value) }, activeEmployeeId)}
                    className="rounded border border-[#2a3347] bg-[#141414] px-1.5 py-1 text-[10px] text-slate-300 outline-none disabled:opacity-40"
                  >
                    {[1, 0.75, 0.5, 0.25].map((o) => <option key={o} value={o}>{Math.round(o * 100)}%</option>)}
                  </select>
                  <select
                    value={markup.lineStyle ?? 'solid'}
                    disabled={isLocked}
                    onChange={(e) => updateMarkup(markup.id, { lineStyle: e.target.value as FieldMarkup['lineStyle'] }, activeEmployeeId)}
                    className="rounded border border-[#2a3347] bg-[#141414] px-1.5 py-1 text-[10px] text-slate-300 outline-none disabled:opacity-40"
                  >
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                  </select>
                </div>

                {(markup.tool === 'text') && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={markup.fontFamily ?? 'inherit'}
                      disabled={isLocked}
                      onChange={(e) => updateMarkup(markup.id, { fontFamily: e.target.value }, activeEmployeeId)}
                      className="rounded border border-[#2a3347] bg-[#141414] px-1.5 py-1 text-[10px] text-slate-300 outline-none disabled:opacity-40"
                    >
                      {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f === 'inherit' ? 'Default' : f}</option>)}
                    </select>
                    <select
                      value={markup.fontSize ?? 13}
                      disabled={isLocked}
                      onChange={(e) => updateMarkup(markup.id, { fontSize: Number(e.target.value) }, activeEmployeeId)}
                      className="rounded border border-[#2a3347] bg-[#141414] px-1.5 py-1 text-[10px] text-slate-300 outline-none disabled:opacity-40"
                    >
                      {FONT_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
                    </select>
                    {([
                      ['fontBold', 'B'], ['fontItalic', 'I'], ['fontUnderline', 'U'], ['fontStrikethrough', 'S'],
                    ] as const).map(([field, glyph]) => (
                      <button
                        key={field}
                        disabled={isLocked}
                        onClick={() => updateMarkup(markup.id, { [field]: !markup[field] }, activeEmployeeId)}
                        className={`h-6 w-6 rounded border text-[10px] font-bold transition disabled:opacity-40 ${
                          markup[field] ? 'border-brand-500 bg-brand-600/20 text-brand-300' : 'border-[#2a3347] text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {glyph}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Customer + sync status */}
            <div className="border-t border-[#1e1e1e] pt-2 flex items-center justify-between text-[10px] text-slate-500">
              <span>Customer: <span className="text-slate-300">{client?.name ?? '—'}</span></span>
              <span className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider ${
                markup.syncStatus === 'error' ? 'bg-red-900/40 text-red-400' : 'bg-[#1e1e1e] text-slate-500'
              }`}>
                {markup.syncStatus ?? 'local'}
              </span>
            </div>

            {/* Timestamps */}
            <div className="border-t border-[#1e1e1e] pt-2 space-y-0.5 text-[10px] text-slate-600">
              <p>Created: {new Date(markup.createdAt).toLocaleString()}</p>
              {markup.updatedAt && <p>Updated: {new Date(markup.updatedAt).toLocaleString()}</p>}
              {markup.lockedAt && <p className="text-amber-600">Locked: {new Date(markup.lockedAt).toLocaleString()}</p>}
            </div>
          </div>
        )}

        {/* ── Photos tab ──────────────────────────────────────────────── */}
        {tab === 'photos' && (
          <div className="space-y-3">
            {/* Photo grid */}
            {photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {photos.map((ph) => (
                  <PhotoThumb
                    key={ph.id}
                    photo={ph}
                    onDelete={() => deleteMarkupPhoto(ph.id, activeEmployeeId)}
                  />
                ))}
              </div>
            )}

            {photos.length === 0 && videos.length === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-center text-slate-600">
                <Image size={24} className="mb-2 opacity-30" />
                <p className="text-[11px]">No photos or videos attached yet.</p>
              </div>
            )}

            {videos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {videos.map((v) => (
                  <VideoThumb key={v.id} video={v} onDelete={() => deleteMarkupVideo(v.id)} />
                ))}
              </div>
            )}

            {/* Upload buttons */}
            {!isLocked && (
              <div className="flex gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded border border-[#2a3347] py-2 text-[11px] text-slate-400 hover:bg-white/5 hover:text-slate-200 transition"
                >
                  <ImagePlus size={12} /> Upload Photo / Video
                </button>
                <button
                  onClick={() => {
                    // Trigger camera on mobile devices
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = 'image/*'
                    input.capture = 'environment'
                    input.onchange = () => handlePhotoFiles(input.files)
                    input.click()
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded border border-[#2a3347] py-2 text-[11px] text-slate-400 hover:bg-white/5 hover:text-slate-200 transition"
                >
                  <Camera size={12} /> Camera
                </button>
              </div>
            )}

            {photos.map((ph) => ph.caption !== null && (
              <div key={ph.id + '-cap'} className="text-[10px] text-slate-600 truncate">{ph.caption}</div>
            ))}
          </div>
        )}

        {/* ── Billing tab ──────────────────────────────────────────────── */}
        {tab === 'billing' && (
          <div className="space-y-3">
            {/* Existing billing entries */}
            {billingEntries.length > 0 && (
              <div className="space-y-2">
                {billingEntries.map((b) => (
                  <BillingRow
                    key={b.id}
                    entry={b}
                    isLocked={isLocked}
                    onUpdate={(patch) => updateMarkupBilling(b.id, patch)}
                    onDelete={() => deleteMarkupBilling(b.id, activeEmployeeId)}
                  />
                ))}
                <div className="flex items-center justify-between border-t border-[#2a3347] pt-2 text-[11px]">
                  <span className="text-slate-500">Total</span>
                  <span className="font-bold text-emerald-400">${billingTotal.toFixed(2)}</span>
                </div>
              </div>
            )}

            {billingEntries.length === 0 && !addingBilling && (
              <div className="flex flex-col items-center justify-center py-4 text-center text-slate-600">
                <DollarSign size={20} className="mb-1 opacity-30" />
                <p className="text-[11px]">No billing entries yet.</p>
              </div>
            )}

            {/* Add billing form */}
            {addingBilling && (
              <div className="rounded border border-[#2a3347] bg-[#0d0d0d] p-3 space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">New Billing Line</p>

                {/* Date + Crew */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Date</Label>
                    <input
                      type="date"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-[11px] text-slate-200 outline-none focus:border-brand-500"
                    />
                  </div>
                  <div>
                    <Label>Crew</Label>
                    <select
                      value={newCrewId}
                      onChange={(e) => setNewCrewId(e.target.value)}
                      className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-[11px] text-slate-200 outline-none focus:border-brand-500"
                    >
                      <option value="">— select crew —</option>
                      {crews.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Rate code */}
                <div>
                  <Label>Rate Code</Label>
                  <select
                    value={newRateCode}
                    onChange={(e) => {
                      const unit = relevantUnits.find((u) => u.unitCode === e.target.value)
                      setNewRateCode(e.target.value)
                      if (unit) {
                        setNewDesc(unit.description)
                        setNewUnit(unit.uom)
                        setNewRate(unit.rate)
                      }
                    }}
                    className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-[11px] text-slate-200 outline-none focus:border-brand-500"
                  >
                    <option value="">— select rate code —</option>
                    {relevantUnits.map((u) => (
                      <option key={u.id} value={u.unitCode}>{u.unitCode} — {u.description}</option>
                    ))}
                  </select>
                </div>

                {/* Description */}
                <div>
                  <Label>Description</Label>
                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Work description"
                    className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-[11px] text-slate-200 outline-none focus:border-brand-500"
                  />
                </div>

                {/* Unit / Footage / Rate */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>Unit</Label>
                    <select
                      value={newUnit}
                      onChange={(e) => setNewUnit(e.target.value)}
                      className="w-full rounded border border-[#2a3347] bg-[#141414] px-1.5 py-1.5 text-[11px] text-slate-200 outline-none"
                    >
                      {['LF', 'EA', 'HR', 'DAY', 'TON', 'SQFT'].map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Footage / Qty</Label>
                    <input
                      type="number" min={0} value={newQty}
                      onChange={(e) => setNewQty(parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-[11px] text-slate-200 outline-none"
                    />
                  </div>
                  <div>
                    <Label>Rate ($)</Label>
                    <input
                      type="number" min={0} step={0.01} value={newRate}
                      onChange={(e) => setNewRate(parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-[11px] text-slate-200 outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-slate-400">
                    Total: <span className="font-bold text-emerald-400">${(newQty * newRate).toFixed(2)}</span>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={newBillable} onChange={(e) => setNewBillable(e.target.checked)}
                      className="accent-brand-500" />
                    <span className="text-[10px] text-slate-400">Billable</span>
                  </label>
                </div>

                <input
                  type="text" value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-[11px] text-slate-200 outline-none focus:border-brand-500"
                />

                <div className="flex gap-2">
                  <button
                    onClick={handleAddBilling}
                    disabled={!newDesc && !newRateCode}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded bg-brand-600 py-1.5 text-[11px] font-semibold text-white hover:bg-brand-700 disabled:opacity-40 transition"
                  >
                    <Check size={11} /> Add Line
                  </button>
                  <button
                    onClick={() => setAddingBilling(false)}
                    className="rounded border border-[#2a3347] px-3 py-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {!addingBilling && !isLocked && (
              <button
                onClick={() => setAddingBilling(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-[#2a3347] py-2 text-[11px] text-slate-500 hover:text-slate-300 hover:border-[#3a4357] transition"
              >
                <Plus size={11} /> Add Billing Line
              </button>
            )}

            {/* Submit / already-submitted state */}
            {status === 'billed' ? (
              <div className="flex items-center gap-2 rounded border border-emerald-800/40 bg-emerald-900/20 px-3 py-2 text-[11px] text-emerald-400">
                <CheckCircle2 size={13} className="shrink-0" />
                <span>Submitted to production &amp; revenue</span>
              </div>
            ) : billingEntries.some((b) => b.billable && b.total > 0) && (
              <button
                onClick={handleSubmitToProduction}
                disabled={submitting || isLocked}
                className="flex w-full items-center justify-center gap-1.5 rounded bg-emerald-700 py-2 text-[11px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-40 transition"
              >
                <Send size={11} />
                {submitting ? 'Submitting…' : `Submit to Production — $${billingTotal.toFixed(2)}`}
              </button>
            )}
          </div>
        )}

        {/* ── Inspection tab ──────────────────────────────────────────── */}
        {tab === 'inspection' && (
          <div className="space-y-3">
            {newInspectionItems ? (
              <div className="space-y-2">
                {newInspectionItems.map((item, idx) => (
                  <div key={item.id} className="rounded border border-[#2a3347] bg-[#0d0d0d] p-2">
                    <p className="mb-1.5 text-[11px] text-slate-300">{item.label}</p>
                    <div className="flex gap-1">
                      {(['pass', 'fail', 'na'] as InspectionResult[]).map((r) => (
                        <button
                          key={r}
                          onClick={() => setNewInspectionItems((prev) => prev!.map((it, i) => (i === idx ? { ...it, result: r } : it)))}
                          className={`flex-1 rounded py-1 text-[10px] font-semibold uppercase transition ${
                            item.result === r
                              ? r === 'pass' ? 'bg-emerald-600 text-white' : r === 'fail' ? 'bg-red-600 text-white' : 'bg-slate-600 text-white'
                              : 'bg-white/5 text-slate-500 hover:bg-white/10'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex gap-2">
                  <button
                    onClick={() => setNewInspectionItems(null)}
                    className="flex-1 rounded border border-[#2a3347] py-1.5 text-[11px] text-slate-400 hover:bg-white/5 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      const items = newInspectionItems
                      const overallResult: 'pass' | 'fail' | 'pending' = items.some((i) => i.result === 'fail')
                        ? 'fail' : items.every((i) => i.result !== 'na') ? 'pass' : 'pending'
                      addMarkupInspection({
                        markupId: markup.id, items, overallResult, notes: null, createdBy: activeEmployeeId,
                      })
                      setNewInspectionItems(null)
                    }}
                    className="flex-1 rounded bg-brand-600 py-1.5 text-[11px] font-semibold text-white hover:bg-brand-700 transition"
                  >
                    Save Inspection
                  </button>
                </div>
              </div>
            ) : (
              !isLocked && (
                <button
                  onClick={() => setNewInspectionItems(
                    (inspectionTemplate.length ? inspectionTemplate : ['General condition']).map((label, i) => ({
                      id: `ins-${i}`, label, result: 'na' as InspectionResult, notes: null,
                    })),
                  )}
                  className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-[#2a3347] py-2 text-[11px] text-slate-500 hover:text-slate-300 hover:border-[#3a4357] transition"
                >
                  <Plus size={11} /> New Inspection
                </button>
              )
            )}

            {inspections.length === 0 && !newInspectionItems && (
              <p className="py-4 text-center text-[11px] text-slate-600">No inspections recorded yet.</p>
            )}

            {inspections.map((insp) => (
              <div key={insp.id} className="rounded border border-[#2a3347] bg-[#0d0d0d] p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className={`text-[10px] font-bold uppercase ${
                    insp.overallResult === 'pass' ? 'text-emerald-400' : insp.overallResult === 'fail' ? 'text-red-400' : 'text-slate-500'
                  }`}>
                    {insp.overallResult}
                  </span>
                  <span className="text-[10px] text-slate-600">{new Date(insp.createdAt).toLocaleString()}</span>
                </div>
                <ul className="space-y-0.5">
                  {insp.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{item.label}</span>
                      <span className={item.result === 'pass' ? 'text-emerald-400' : item.result === 'fail' ? 'text-red-400' : 'text-slate-600'}>{item.result}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* ── History tab ──────────────────────────────────────────────── */}
        {tab === 'history' && (
          <div className="space-y-1.5">
            {historyEntries.length === 0 && (
              <p className="py-4 text-center text-[11px] text-slate-600">No history recorded yet.</p>
            )}
            {historyEntries.map((h) => (
              <div key={h.id} className="rounded bg-white/5 px-2 py-1.5 text-[11px] text-slate-400">
                <div className="flex items-center justify-between">
                  <span>
                    {h.action === 'created' && 'Work Object created'}
                    {h.action === 'field_changed' && `Changed ${h.field}: ${h.oldValue ?? '(empty)'} → ${h.newValue ?? '(empty)'}`}
                    {h.action === 'photo_added' && 'Photo added'}
                    {h.action === 'photo_removed' && 'Photo removed'}
                    {h.action === 'billing_added' && 'Billing line added'}
                    {h.action === 'billing_removed' && 'Billing line removed'}
                    {h.action === 'inspection_added' && 'Inspection recorded'}
                    {h.action === 'locked' && 'Locked'}
                    {h.action === 'unlocked' && 'Unlocked'}
                  </span>
                  <span className="shrink-0 text-slate-600">{new Date(h.timestamp).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Attachments tab ─────────────────────────────────────────── */}
        {tab === 'attachments' && (
          <div className="space-y-2">
            {attachments.length === 0 && (
              <p className="py-4 text-center text-[11px] text-slate-600">No attachments yet.</p>
            )}
            {attachments.map((a) => (
              <AttachmentRow key={a.id} attachment={a} onDelete={() => deleteMarkupAttachment(a.id)} />
            ))}
            {!isLocked && (
              <button
                onClick={() => attachmentInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-[#2a3347] py-2 text-[11px] text-slate-500 hover:text-slate-300 hover:border-[#3a4357] transition"
              >
                <Plus size={11} /> Add Attachment
              </button>
            )}
            <input
              ref={attachmentInputRef}
              type="file"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                const reader = new FileReader()
                reader.onload = async (ev) => {
                  const dataUrl = ev.target?.result as string
                  const id = addMarkupAttachment({
                    markupId: markup.id, fileName: file.name, mimeType: file.type, uploadedAt: new Date().toISOString(),
                  })
                  await saveBlob(`mkp-${id}`, dataUrl)
                }
                reader.readAsDataURL(file)
              }}
            />
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="shrink-0 flex gap-2 border-t border-[#1e1e1e] px-3 py-2">
        {tab === 'notes' && (
          <button
            onClick={saveDetails}
            disabled={!dirty || isLocked}
            className="flex flex-1 items-center justify-center gap-1.5 rounded bg-brand-600 py-1.5 text-[11px] font-semibold text-white hover:bg-brand-700 disabled:opacity-40 transition"
          >
            <Save size={11} /> Save
          </button>
        )}
        {tab !== 'notes' && <div className="flex-1" />}
        <button
          onClick={handleDeleteMarkup}
          disabled={isLocked}
          className="flex items-center gap-1 rounded border border-red-900/50 px-2.5 py-1.5 text-[11px] text-red-500 hover:bg-red-500/10 disabled:opacity-30 transition"
        >
          <Trash2 size={11} /> Delete
        </button>
      </div>

      {/* Hidden file input for photo / video upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => handlePhotoFiles(e.target.files)}
      />
    </div>
  )
}

// ── Attachment row sub-component ───────────────────────────────────────────────

function AttachmentRow({ attachment, onDelete }: { attachment: MarkupAttachment; onDelete: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { loadBlob(`mkp-${attachment.id}`).then(setSrc) }, [attachment.id])
  return (
    <div className="flex items-center gap-2 rounded border border-[#2a3347] bg-[#0d0d0d] px-2.5 py-2">
      <span className="flex-1 truncate text-[11px] text-slate-300">{attachment.fileName}</span>
      {src && (
        <a href={src} download={attachment.fileName} className="text-slate-500 hover:text-slate-300">
          <ChevronDown size={12} />
        </a>
      )}
      <button onClick={onDelete} className="text-slate-600 hover:text-red-400">
        <X size={12} />
      </button>
    </div>
  )
}

// ── Billing row sub-component ─────────────────────────────────────────────────

function BillingRow({
  entry, isLocked, onUpdate, onDelete,
}: {
  entry: MarkupBilling
  isLocked: boolean
  onUpdate: (patch: Partial<MarkupBilling>) => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)

  const statusColors: Record<MarkupBilling['invoiceStatus'], string> = {
    not_billed: '#6b7280',
    invoiced:   '#f59e0b',
    approved:   '#06b6d4',
    paid:       '#22c55e',
  }

  return (
    <div className="rounded border border-[#2a3347] bg-[#0d0d0d]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <span className="flex-1 text-[11px] font-medium text-slate-200 truncate">
          {entry.rateCode ? <span className="text-brand-400 mr-1">{entry.rateCode}</span> : null}
          {entry.description}
        </span>
        <span className="shrink-0 text-[10px] font-bold text-emerald-400">${entry.total.toFixed(2)}</span>
        <ChevronDown size={10} className={`text-slate-600 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-[#1e1e1e] px-2.5 py-2 space-y-2 text-[11px]">
          <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-slate-400">
            <span>Unit: <b className="text-slate-200">{entry.unitType}</b></span>
            <span>Qty: <b className="text-slate-200">{entry.quantity}</b></span>
            <span>Rate: <b className="text-slate-200">${entry.rate.toFixed(2)}</b></span>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={entry.billable}
                disabled={isLocked}
                onChange={(e) => onUpdate({ billable: e.target.checked })}
                className="accent-brand-500"
              />
              <span className="text-slate-400">Billable</span>
            </label>
            <select
              value={entry.invoiceStatus}
              disabled={isLocked}
              onChange={(e) => onUpdate({ invoiceStatus: e.target.value as MarkupBilling['invoiceStatus'] })}
              className="rounded border border-[#2a3347] bg-[#141414] px-1.5 py-0.5 text-[10px] outline-none"
              style={{ color: statusColors[entry.invoiceStatus] }}
            >
              <option value="not_billed">Not Billed</option>
              <option value="invoiced">Invoiced</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
            </select>
          </div>

          {entry.notes && <p className="text-slate-500 italic">{entry.notes}</p>}

          {!isLocked && (
            <button onClick={onDelete} className="flex items-center gap-1 text-red-500 hover:text-red-400 transition">
              <Trash2 size={10} /> Remove
            </button>
          )}
        </div>
      )}
    </div>
  )
}
