import { useEffect, useRef, useState } from 'react'
import { X, Trash2, Camera, ImagePlus, Plus, Check, Send } from 'lucide-react'
import { useData } from '../store/DataContext'
import type { LineItemInput } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { saveBlob, loadBlob } from '../lib/fileStore'
import type { MarkupPhoto } from '../types'

// ── Photo thumbnail ────────────────────────────────────────────────────────────

function PhotoThumb({ photo, onDelete }: { photo: MarkupPhoto; onDelete: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => { loadBlob(`mkp-${photo.id}`).then(setSrc) }, [photo.id])

  if (!src) return <div className="h-14 w-14 rounded bg-slate-100 animate-pulse shrink-0" />

  return (
    <>
      <div className="relative group/ph shrink-0">
        <button onClick={() => setOpen(true)} className="block h-14 w-14 rounded overflow-hidden border border-slate-200">
          <img src={src} alt="" className="h-full w-full object-cover" />
        </button>
        <button
          onClick={onDelete}
          className="absolute -top-1 -right-1 hidden group-hover/ph:flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white"
        >
          <X size={8} />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80" onClick={() => setOpen(false)}>
          <img src={src} alt="" className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl" />
        </div>
      )}
    </>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  annotationId: string
  projectId: string
  toolName: string
  onDeleted: () => void
}

export function AnnotationPanel({ annotationId, projectId, toolName, onDeleted }: Props) {
  const {
    data,
    updateAnnotation,
    deleteAnnotation,
    addMarkupBilling, updateMarkupBilling, deleteMarkupBilling,
    addMarkupPhoto, deleteMarkupPhoto,
    addProduction,
  } = useData()
  const { activeEmployeeId } = useRole()

  const [tab, setTab]           = useState<'notes' | 'photos' | 'billing'>('notes')
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const annotation      = data.annotations.find((a) => a.id === annotationId)
  const billingEntries  = (data.markupBilling  ?? []).filter((b) => b.markupId === annotationId)
  const photos          = (data.markupPhotos   ?? []).filter((p) => p.markupId === annotationId)
  const project         = data.projects.find((p) => p.id === projectId)
  const crews           = data.crews ?? []

  // ── Notes state ────────────────────────────────────────────────────────────
  const [label, setLabel] = useState(annotation?.label ?? '')
  const [notes, setNotes] = useState(annotation?.notes ?? '')

  // Sync when annotation changes (e.g. undo/redo)
  useEffect(() => { setLabel(annotation?.label ?? '') }, [annotation?.label])
  useEffect(() => { setNotes(annotation?.notes ?? '') }, [annotation?.notes])

  function saveNotes() {
    updateAnnotation(annotationId, { label: label || undefined, notes: notes || undefined })
  }

  // ── Billing state ──────────────────────────────────────────────────────────
  const today          = new Date().toISOString().slice(0, 10)
  const allRateCards   = data.rateCards ?? []
  const allRateUnits   = data.rateCardUnits ?? []

  const relevantUnits = (() => {
    if (!project?.clientId) return allRateUnits
    const clientCards = allRateCards.filter((rc) => rc.clientId === project.clientId).map((rc) => rc.id)
    const clientUnits = allRateUnits.filter((u) => clientCards.includes(u.rateCardId))
    return clientUnits.length > 0 ? clientUnits : allRateUnits
  })()

  const billingTotal   = billingEntries.reduce((s, b) => s + b.total, 0)
  const [addingBilling, setAddingBilling] = useState(false)
  const [newDate,    setNewDate]    = useState(today)
  const [newCrewId,  setNewCrewId]  = useState('')
  const [newRateCode, setNewRateCode] = useState('')
  const [newDesc,    setNewDesc]    = useState('')
  const [newUnit,    setNewUnit]    = useState('LF')
  const [newQty,     setNewQty]     = useState<number>(1)
  const [newRate,    setNewRate]    = useState<number>(0)
  const [newBillable, setNewBillable] = useState(true)
  const [newNotes,   setNewNotes]   = useState('')

  function handleAddBilling() {
    if (!newRateCode && !newDesc) return
    addMarkupBilling({
      markupId:      annotationId,
      date:          newDate || null,
      crewId:        newCrewId || null,
      rateCode:      newRateCode,
      description:   newDesc,
      unitType:      newUnit,
      quantity:      newQty,
      rate:          newRate,
      total:         Math.round(newQty * newRate * 100) / 100,
      billable:      newBillable,
      invoiceStatus: 'not_billed',
      notes:         newNotes || null,
    })
    setNewDate(today); setNewCrewId(''); setNewRateCode('')
    setNewDesc(''); setNewQty(1); setNewRate(0); setNewNotes('')
    setAddingBilling(false)
  }

  function handleSubmitToProduction() {
    const billable = billingEntries.filter((b) => b.billable && b.total > 0)
    if (billable.length === 0) return
    if (!confirm(`Submit ${billable.length} billing line${billable.length > 1 ? 's' : ''} to production and revenue?`)) return

    setSubmitting(true)
    try {
      const resolvedCrewId = (() => {
        const emp = (data.employees ?? []).find((e) => e.id === activeEmployeeId)
        if (emp?.defaultCrewId) return emp.defaultCrewId
        return project?.crewIds?.[0] ?? ''
      })()

      const dateStr = new Date().toISOString().slice(0, 10)

      const byCrewId = new Map<string, typeof billable>()
      for (const b of billable) {
        const key = b.crewId || resolvedCrewId || ''
        if (!byCrewId.has(key)) byCrewId.set(key, [])
        byCrewId.get(key)!.push(b)
      }

      for (const [bCrewId, lines] of byCrewId) {
        const lineItems: LineItemInput[] = lines.map((b) => ({
          unitCode:      b.rateCode || 'MISC',
          description:   b.description,
          uom:           b.unitType,
          quantity:      b.quantity,
          rateSnapshot:  b.rate,
          extendedTotal: b.total,
        }))
        addProduction(
          {
            date:      dateStr,
            projectId,
            crewId:    bCrewId,
            footage:   0,
            hours:     0,
            notes:     `[annotation:${annotationId}]`,
          },
          lineItems,
        )
      }

      for (const b of billable) updateMarkupBilling(b.id, { invoiceStatus: 'invoiced' })
    } finally {
      setSubmitting(false)
    }
  }

  // ── Photo upload ───────────────────────────────────────────────────────────
  async function handlePhotoFiles(files: FileList | null) {
    if (!files) return
    for (const file of Array.from(files)) {
      await new Promise<void>((resolve) => {
        const reader = new FileReader()
        reader.onload = async (ev) => {
          const dataUrl = ev.target?.result as string
          const id = addMarkupPhoto({
            markupId:   annotationId,
            caption:    null,
            takenAt:    new Date().toISOString(),
            uploadedBy: null,
            lat:        null,
            lng:        null,
          })
          await saveBlob(`mkp-${id}`, dataUrl)
          resolve()
        }
        reader.readAsDataURL(file)
      })
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const SL = 'mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500'

  return (
    <div className="border-t-2 border-slate-200">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-100">
        <span className="flex-1 text-xs font-semibold text-slate-700 capitalize truncate">
          {toolName} — Field Audit
        </span>
        <button
          title="Delete annotation"
          onClick={() => {
            if (confirm('Delete this annotation and all associated billing/photos?')) {
              deleteAnnotation(annotationId)
              onDeleted()
            }
          }}
          className="shrink-0 text-rose-400 hover:text-rose-600 rounded p-0.5"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100">
        {(['notes', 'photos', 'billing'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
              tab === t
                ? 'border-b-2 border-brand-500 text-brand-600'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {t === 'billing' && billingTotal > 0
              ? `$${billingTotal.toFixed(0)}`
              : t === 'photos' && photos.length > 0
              ? `${t} (${photos.length})`
              : t}
          </button>
        ))}
      </div>

      {/* ── Notes ── */}
      {tab === 'notes' && (
        <div className="p-3 space-y-2">
          <div>
            <p className={SL}>Label / Name</p>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="HH-001, Bore crossing…"
              className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <p className={SL}>Notes</p>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Field observations…"
              className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-brand-400 resize-none"
            />
          </div>
          <button
            onClick={saveNotes}
            className="w-full rounded bg-brand-600 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
          >
            Save Notes
          </button>
        </div>
      )}

      {/* ── Photos ── */}
      {tab === 'photos' && (
        <div className="p-3 space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handlePhotoFiles(e.target.files)}
          />
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {photos.map((p) => (
                <PhotoThumb key={p.id} photo={p} onDelete={() => deleteMarkupPhoto(p.id)} />
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                const el = fileInputRef.current
                if (!el) return
                el.removeAttribute('capture')
                el.click()
              }}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <ImagePlus size={13} /> Upload
            </button>
            <button
              onClick={() => {
                const el = fileInputRef.current
                if (!el) return
                el.setAttribute('capture', 'environment')
                el.click()
              }}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <Camera size={13} /> Camera
            </button>
          </div>
        </div>
      )}

      {/* ── Billing ── */}
      {tab === 'billing' && (
        <div className="p-3 space-y-2">
          {billingEntries.length === 0 && !addingBilling && (
            <p className="text-[10px] text-slate-400">No billing entries yet.</p>
          )}

          {billingEntries.map((b) => (
            <div key={b.id} className="rounded border border-slate-100 bg-slate-50 p-2 text-[10px]">
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-700 truncate">{b.description || b.rateCode || 'Misc'}</p>
                  <p className="text-slate-500">
                    {b.quantity} {b.unitType} × ${b.rate.toFixed(2)} ={' '}
                    <strong className="text-slate-700">${b.total.toFixed(2)}</strong>
                  </p>
                  {b.crewId && (
                    <p className="text-slate-400">{crews.find((c) => c.id === b.crewId)?.name}</p>
                  )}
                  <span className={`inline-block mt-0.5 rounded px-1 py-px text-[9px] font-bold uppercase ${
                    b.invoiceStatus === 'invoiced' ? 'bg-emerald-50 text-emerald-700' :
                    b.invoiceStatus === 'paid'     ? 'bg-blue-50 text-blue-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>
                    {b.invoiceStatus.replace('_', ' ')}
                  </span>
                </div>
                <button
                  onClick={() => deleteMarkupBilling(b.id)}
                  className="shrink-0 text-slate-300 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}

          {addingBilling ? (
            <div className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-2">
              <p className={SL}>Add Billing Line</p>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700 outline-none focus:border-brand-400"
              />
              <select
                value={newCrewId}
                onChange={(e) => setNewCrewId(e.target.value)}
                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700 outline-none focus:border-brand-400"
              >
                <option value="">— Crew (optional)</option>
                {crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              {relevantUnits.length > 0 && (
                <select
                  value={newRateCode}
                  onChange={(e) => {
                    const u = relevantUnits.find((u) => u.unitCode === e.target.value)
                    setNewRateCode(e.target.value)
                    if (u) { setNewDesc(u.description); setNewUnit(u.uom); setNewRate(u.rate) }
                  }}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700 outline-none focus:border-brand-400"
                >
                  <option value="">— Rate Code</option>
                  {relevantUnits.map((u) => (
                    <option key={u.id} value={u.unitCode}>{u.unitCode} – {u.description}</option>
                  ))}
                </select>
              )}

              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Description *"
                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700 outline-none focus:border-brand-400"
              />

              <div className="flex gap-1">
                <input
                  type="number"
                  value={newQty}
                  min={0}
                  onChange={(e) => setNewQty(Number(e.target.value))}
                  placeholder="Qty"
                  className="w-1/3 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700 outline-none focus:border-brand-400"
                />
                <input
                  type="text"
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  placeholder="Unit"
                  className="w-1/3 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700 outline-none focus:border-brand-400"
                />
                <input
                  type="number"
                  value={newRate}
                  min={0}
                  step={0.01}
                  onChange={(e) => setNewRate(Number(e.target.value))}
                  placeholder="Rate $"
                  className="w-1/3 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700 outline-none focus:border-brand-400"
                />
              </div>

              <label className="flex items-center gap-2 text-[10px] text-slate-600 cursor-pointer">
                <input type="checkbox" checked={newBillable} onChange={(e) => setNewBillable(e.target.checked)} className="accent-brand-600" />
                Billable
              </label>

              <div className="flex gap-1">
                <button
                  onClick={handleAddBilling}
                  className="flex flex-1 items-center justify-center gap-1 rounded bg-brand-600 py-1.5 text-[10px] font-semibold text-white hover:bg-brand-700"
                >
                  <Check size={11} /> Add
                </button>
                <button
                  onClick={() => setAddingBilling(false)}
                  className="flex flex-1 items-center justify-center rounded border border-slate-200 py-1.5 text-[10px] text-slate-500 hover:bg-slate-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingBilling(true)}
              className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 py-2 text-[11px] font-medium text-slate-500 hover:bg-slate-50 hover:border-brand-400 hover:text-brand-600 transition-colors"
            >
              <Plus size={12} /> Add Billing Line
            </button>
          )}

          {billingEntries.some((b) => b.billable && b.total > 0) && (
            <div className="border-t border-slate-200 pt-2 space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-500">Billable Total</span>
                <span className="font-bold text-slate-800">${billingTotal.toFixed(2)}</span>
              </div>
              <button
                onClick={handleSubmitToProduction}
                disabled={submitting}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                <Send size={11} /> {submitting ? 'Submitting…' : 'Submit to Production'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
