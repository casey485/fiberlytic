/**
 * DistributionLineModal — mobile-first 3-step production line reporting modal.
 * Triggered after drawing a production redline on the field map.
 * Steps: Type → Details → Billing (from existing project rate cards).
 */
import { useEffect, useRef, useState } from 'react'
import {
  X, Camera, ImagePlus, Search, Check, ChevronDown,
  Save, Image as ImageIcon,
} from 'lucide-react'
import { useData } from '../store/DataContext'
import { saveBlob, loadBlob } from '../lib/fileStore'
import { localDateStr } from '../lib/format'
import type { MarkupStatus } from '../types'

// ── Line type definitions ─────────────────────────────────────────────────────

export const DISTRIBUTION_LINE_TYPES = [
  { id: 'aerial_strand',      label: 'Aerial Strand',      color: '#06b6d4' },
  { id: 'distribution_fiber', label: 'Distribution Fiber', color: '#22c55e' },
  { id: 'feeder_fiber',       label: 'Feeder Fiber',       color: '#f97316' },
  { id: 'sub_ducting',        label: 'Sub-Ducting',        color: '#ec4899' },
  { id: 'directional_drill',  label: 'Directional Drill',  color: '#3b82f6' },
  { id: 'drop',               label: 'Drop',               color: '#a3e635' },
  { id: 'plowing',            label: 'Plowing',            color: '#facc15' },
  { id: 'trenching',          label: 'Trenching',          color: '#ef4444' },
] as const

// ── Recently used rate codes (localStorage) ───────────────────────────────────

const RECENT_KEY = 'fiberlytic:recentUnits'

function getRecentCodes(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') }
  catch { return [] }
}

function pushRecentCodes(codes: string[]) {
  const prev = getRecentCodes().filter((c) => !codes.includes(c))
  localStorage.setItem(RECENT_KEY, JSON.stringify([...codes, ...prev].slice(0, 10)))
}

// ── Photo thumbnail ───────────────────────────────────────────────────────────

function PendingPhotoThumb({ dataUrl, onDelete }: { dataUrl: string; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="relative group/ph shrink-0">
        <button
          onClick={() => setOpen(true)}
          className="block h-16 w-16 rounded overflow-hidden border border-[#2a3347]"
        >
          <img src={dataUrl} alt="" className="h-full w-full object-cover" />
        </button>
        <button
          onClick={onDelete}
          className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white"
        >
          <X size={8} />
        </button>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80"
          onClick={() => setOpen(false)}
        >
          <img src={dataUrl} alt="" className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl" />
        </div>
      )}
    </>
  )
}

function SavedPhotoThumb({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    loadBlob(`mkp-${photoId}`).then((url) => setSrc(url))
  }, [photoId])
  if (!src) return <div className="h-16 w-16 rounded bg-[#1e1e1e] animate-pulse shrink-0" />
  return (
    <div className="h-16 w-16 rounded overflow-hidden border border-[#2a3347] shrink-0">
      <img src={src} alt="" className="h-full w-full object-cover" />
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  markupId: string
  projectId: string
  lengthFt: number | null
  onClose: () => void
  onSaved: () => void
}

// ── Main component ────────────────────────────────────────────────────────────

export function DistributionLineModal({ markupId, projectId, lengthFt, onClose, onSaved }: Props) {
  const {
    data, updateMarkup,
    addMarkupPhoto,
    addMarkupBilling,
  } = useData()

  const markup   = (data.fieldMarkups ?? []).find((m) => m.id === markupId && !m.deletedAt)
  const project  = data.projects.find((p) => p.id === projectId)
  const allCards = data.rateCards ?? []
  const allUnits = data.rateCardUnits ?? []

  // Rate units scoped to this project's client, or all if no client
  const relevantUnits = (() => {
    if (project?.clientId) {
      const clientCardIds = allCards
        .filter((rc) => rc.clientId === project.clientId)
        .map((rc) => rc.id)
      const clientUnits = allUnits.filter((u) => clientCardIds.includes(u.rateCardId))
      if (clientUnits.length > 0) return clientUnits
    }
    return allUnits
  })()

  // Group units by rate card for the billing step
  const unitGroups = (() => {
    const map = new Map<string, { cardName: string; units: typeof relevantUnits }>()
    for (const u of relevantUnits) {
      const card = allCards.find((c) => c.id === u.rateCardId)
      const name = card?.name ?? 'Rate Card'
      if (!map.has(u.rateCardId)) map.set(u.rateCardId, { cardName: name, units: [] })
      map.get(u.rateCardId)!.units.push(u)
    }
    return [...map.values()]
  })()

  const savedPhotos = (data.markupPhotos ?? []).filter((p) => p.markupId === markupId)

  // ── Step state ──────────────────────────────────────────────────────────────
  const [step, setStep] = useState<'type' | 'details' | 'billing'>('type')

  // Type
  const [lineTypeId, setLineTypeId] = useState<string | null>(null)

  // Details
  const [name, setName]         = useState(markup?.featureName ?? '')
  const [comments, setComments] = useState(markup?.notes ?? '')
  const [status, setStatus]     = useState<MarkupStatus>(markup?.status ?? 'pending')
  const [pendingPhotos, setPendingPhotos] = useState<string[]>([])  // dataUrls
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef   = useRef<HTMLInputElement>(null)

  // Billing
  const [billingNotRequired, setBillingNotRequired] = useState(false)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selections, setSelections] = useState<Map<string, { checked: boolean; qty: number }>>(() => new Map())
  const [saving, setSaving] = useState(false)

  // Auto-open first group when entering billing step
  useEffect(() => {
    if (step === 'billing' && unitGroups.length > 0) {
      setExpanded((prev) => {
        if (prev.size > 0) return prev
        const next = new Set(prev)
        next.add(unitGroups[0].cardName)
        return next
      })
    }
  }, [step, unitGroups.length])  // eslint-disable-line react-hooks/exhaustive-deps

  const recentCodes = getRecentCodes()
  const recentUnits = recentCodes
    .map((code) => relevantUnits.find((u) => u.unitCode === code))
    .filter(Boolean) as typeof relevantUnits

  const filteredGroups = unitGroups.map((g) => ({
    ...g,
    units: search
      ? g.units.filter(
          (u) =>
            u.unitCode.toLowerCase().includes(search.toLowerCase()) ||
            u.description.toLowerCase().includes(search.toLowerCase()),
        )
      : g.units,
  })).filter((g) => g.units.length > 0)

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function toggleUnit(unitCode: string, defaultQty: number) {
    setSelections((prev) => {
      const next = new Map(prev)
      const cur = next.get(unitCode)
      if (cur?.checked) {
        next.set(unitCode, { checked: false, qty: cur.qty })
      } else {
        next.set(unitCode, { checked: true, qty: cur?.qty ?? defaultQty })
      }
      return next
    })
  }

  function setQty(unitCode: string, qty: number) {
    setSelections((prev) => {
      const next = new Map(prev)
      const cur = next.get(unitCode)
      next.set(unitCode, { checked: cur?.checked ?? true, qty })
      return next
    })
  }

  function toggleGroup(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return
    for (const file of Array.from(files)) {
      await new Promise<void>((resolve) => {
        const reader = new FileReader()
        reader.onload = (ev) => {
          setPendingPhotos((p) => [...p, ev.target?.result as string])
          resolve()
        }
        reader.readAsDataURL(file)
      })
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const chosen = DISTRIBUTION_LINE_TYPES.find((t) => t.id === lineTypeId)

      // 1. Update markup metadata
      const labelFromType = chosen
        ? chosen.label + (lengthFt ? `, ${Math.round(lengthFt).toLocaleString()} ft` : '')
        : name || null
      updateMarkup(markupId, {
        featureName:  name || labelFromType,
        notes:        comments || null,
        status,
        subtype:      lineTypeId ?? markup?.subtype,
        color:        chosen?.color ?? markup?.color ?? '#ef4444',
        updatedAt:    new Date().toISOString(),
      })

      // 2. Upload pending photos
      for (const dataUrl of pendingPhotos) {
        const id = addMarkupPhoto({
          markupId,
          caption: null,
          takenAt: new Date().toISOString(),
          uploadedBy: null,
          lat: markup?.capturedLat ?? null,
          lng: markup?.capturedLng ?? null,
          crewId: markup?.crewId ?? null,
          employeeId: markup?.createdBy ?? null,
          subcontractorId: markup?.assignedSubcontractorId ?? null,
        })
        await saveBlob(`mkp-${id}`, dataUrl)
      }

      // 3. Add billing lines
      if (!billingNotRequired) {
        const today  = localDateStr()
        const usedCodes: string[] = []
        for (const [unitCode, sel] of selections) {
          if (!sel.checked || sel.qty <= 0) continue
          const unit = relevantUnits.find((u) => u.unitCode === unitCode)
          if (!unit) continue
          addMarkupBilling({
            markupId,
            date:          today,
            crewId:        null,
            rateCode:      unit.unitCode,
            description:   unit.description,
            unitType:      unit.uom,
            quantity:      sel.qty,
            rate:          unit.rate,
            total:         Math.round(sel.qty * unit.rate * 100) / 100,
            billable:      true,
            invoiceStatus: 'not_billed',
            notes:         null,
          })
          usedCodes.push(unitCode)
        }
        if (usedCodes.length > 0) pushRecentCodes(usedCodes)
      }

      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const selectedCount = [...selections.values()].filter((s) => s.checked).length
  const lineType = DISTRIBUTION_LINE_TYPES.find((t) => t.id === lineTypeId)

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[1900] bg-black/50"
        onClick={onClose}
      />

      {/* Bottom sheet */}
      <div
        className="fixed inset-x-0 bottom-0 z-[2000] flex flex-col bg-[#0d0d0d] border-t border-[#2a2a2a] rounded-t-2xl shadow-2xl"
        style={{ maxHeight: '92dvh' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-[#3a3a3a]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2 shrink-0">
          <div>
            <h2 className="text-sm font-bold text-slate-100">Add Line</h2>
            {lengthFt != null && lengthFt > 0 && (
              <p className="text-[11px] text-slate-500">{Math.round(lengthFt).toLocaleString()} ft drawn</p>
            )}
          </div>
          {lineType && (
            <div
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: lineType.color + '22', color: lineType.color, border: `1px solid ${lineType.color}55` }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: lineType.color }} />
              {lineType.label}
            </div>
          )}
          <button onClick={onClose} className="rounded p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 transition">
            <X size={16} />
          </button>
        </div>

        {/* Step tabs */}
        <div className="flex shrink-0 border-y border-[#1e1e1e]">
          {(['type', 'details', 'billing'] as const).map((s, i) => {
            const canNav = s === 'type' || (s === 'details') || (s === 'billing' && !!lineTypeId)
            return (
              <button
                key={s}
                onClick={() => canNav && setStep(s)}
                disabled={!canNav}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition ${
                  step === s ? 'text-brand-400 border-b-2 border-brand-500' : 'text-slate-600 hover:text-slate-400'
                } disabled:cursor-default`}
              >
                <span className="mr-1 text-[10px]">{i + 1}.</span>{s}
              </button>
            )
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Step 1: Type ───────────────────────────────────────────── */}
          {step === 'type' && (
            <div className="p-4">
              <p className="text-[11px] text-slate-500 mb-3">Select the type of work completed on this line.</p>
              <div className="grid grid-cols-2 gap-2">
                {DISTRIBUTION_LINE_TYPES.map((t) => {
                  const active = lineTypeId === t.id
                  return (
                    <button
                      key={t.id}
                      onClick={() => setLineTypeId(t.id)}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition active:scale-95 ${
                        active
                          ? 'border-opacity-100 bg-opacity-10'
                          : 'border-[#2a3347] bg-[#141414] hover:bg-white/4'
                      }`}
                      style={active ? {
                        borderColor: t.color,
                        background: t.color + '18',
                      } : {}}
                    >
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{
                          background: t.color,
                          boxShadow: active ? `0 0 0 3px ${t.color}44` : 'none',
                        }}
                      />
                      <span
                        className="text-xs font-semibold leading-tight"
                        style={{ color: active ? t.color : '#cbd5e1' }}
                      >
                        {t.label}
                      </span>
                      {active && (
                        <Check size={12} className="ml-auto shrink-0" style={{ color: t.color }} />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Step 2: Details ────────────────────────────────────────── */}
          {step === 'details' && (
            <div className="p-4 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={lineType ? `${lineType.label}${lengthFt ? `, ${Math.round(lengthFt).toLocaleString()} ft` : ''}` : 'Describe this line…'}
                  className="w-full rounded-lg border border-[#2a3347] bg-[#141414] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-brand-500 placeholder:text-slate-600"
                />
              </div>

              {/* Comments */}
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Comments</label>
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={4}
                  placeholder="Add notes about this work…"
                  className="w-full rounded-lg border border-[#2a3347] bg-[#141414] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-brand-500 resize-none placeholder:text-slate-600 leading-relaxed"
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as MarkupStatus)}
                  className="w-full rounded-lg border border-[#2a3347] bg-[#141414] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-brand-500"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="complete">Completed</option>
                  <option value="qc_needed">QC Needed</option>
                  <option value="rejected">Issue / Rejected</option>
                </select>
              </div>

              {/* Photos */}
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Photos</label>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#2a3347] py-2.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-white/5 transition"
                  >
                    <Camera size={14} /> Take Photo
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#2a3347] py-2.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-white/5 transition"
                  >
                    <ImagePlus size={14} /> Upload
                  </button>
                </div>

                {(pendingPhotos.length + savedPhotos.length) > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {savedPhotos.map((ph) => (
                      <SavedPhotoThumb key={ph.id} photoId={ph.id} />
                    ))}
                    {pendingPhotos.map((url, i) => (
                      <PendingPhotoThumb
                        key={i}
                        dataUrl={url}
                        onDelete={() => setPendingPhotos((p) => p.filter((_, j) => j !== i))}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-5 text-slate-700 rounded-lg border border-dashed border-[#2a3347]">
                    <ImageIcon size={22} className="mb-1.5 opacity-40" />
                    <p className="text-xs">No photos added</p>
                    <p className="text-[10px] text-slate-700">Take, upload, or drag &amp; drop photos</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 3: Billing ────────────────────────────────────────── */}
          {step === 'billing' && (
            <div className="p-4 space-y-3">
              {/* Not required toggle */}
              <label className="flex items-center gap-2.5 cursor-pointer rounded-lg border border-[#2a3347] px-3 py-2.5">
                <div
                  onClick={() => setBillingNotRequired((v) => !v)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${billingNotRequired ? 'bg-brand-600' : 'bg-[#2a3347]'}`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${billingNotRequired ? 'translate-x-4' : 'translate-x-0.5'}`}
                  />
                </div>
                <span className="text-sm text-slate-300">Billing codes not required</span>
              </label>

              {!billingNotRequired && (
                <>
                  {/* Search */}
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search billing codes by name or unit code…"
                      className="w-full rounded-lg border border-[#2a3347] bg-[#141414] pl-8 pr-3 py-2.5 text-sm text-slate-200 outline-none focus:border-brand-500 placeholder:text-slate-600"
                    />
                  </div>

                  {relevantUnits.length === 0 && (
                    <div className="rounded-lg border border-dashed border-[#2a3347] py-6 text-center">
                      <p className="text-xs text-slate-600">No rate cards configured for this project.</p>
                      <p className="text-[10px] text-slate-700 mt-1">Add rate cards under Settings → Rate Cards.</p>
                    </div>
                  )}

                  {/* Recently Used */}
                  {!search && recentUnits.length > 0 && (
                    <BillingGroup
                      title="Recently Used"
                      units={recentUnits}
                      isOpen={expanded.has('__recent')}
                      onToggle={() => toggleGroup('__recent')}
                      selections={selections}
                      onToggleUnit={toggleUnit}
                      onSetQty={setQty}
                      defaultQty={lengthFt ? Math.round(lengthFt) : 1}
                    />
                  )}

                  {/* Rate card groups */}
                  {(search ? filteredGroups : unitGroups).map((g) => (
                    <BillingGroup
                      key={g.cardName}
                      title={g.cardName}
                      units={g.units}
                      isOpen={expanded.has(g.cardName)}
                      onToggle={() => toggleGroup(g.cardName)}
                      selections={selections}
                      onToggleUnit={toggleUnit}
                      onSetQty={setQty}
                      defaultQty={lengthFt ? Math.round(lengthFt) : 1}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-t border-[#1e1e1e] gap-3">
          {step !== 'type' ? (
            <button
              onClick={() => setStep(step === 'billing' ? 'details' : 'type')}
              className="flex items-center gap-1.5 rounded-lg border border-[#2a3347] px-5 py-2.5 text-sm text-slate-400 hover:text-slate-200 transition"
            >
              ← Back
            </button>
          ) : (
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-lg border border-[#2a3347] px-5 py-2.5 text-sm text-slate-400 hover:text-slate-200 transition"
            >
              Cancel
            </button>
          )}

          {step === 'billing' ? (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-7 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50 transition"
            >
              <Save size={14} />
              {saving ? 'Saving…' : selectedCount > 0 ? `Save (${selectedCount} billing)` : 'Save'}
            </button>
          ) : (
            <button
              onClick={() => setStep(step === 'type' ? 'details' : 'billing')}
              disabled={step === 'type' && !lineTypeId}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-7 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-40 transition"
            >
              Next →
            </button>
          )}
        </div>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => addPhotos(e.target.files)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => addPhotos(e.target.files)}
      />
    </>
  )
}

// ── Billing group sub-component ───────────────────────────────────────────────

interface BillingGroupProps {
  title: string
  units: Array<{ unitCode: string; description: string; uom: string; rate: number }>
  isOpen: boolean
  onToggle: () => void
  selections: Map<string, { checked: boolean; qty: number }>
  onToggleUnit: (code: string, defaultQty: number) => void
  onSetQty: (code: string, qty: number) => void
  defaultQty: number
}

function BillingGroup({
  title, units, isOpen, onToggle, selections, onToggleUnit, onSetQty, defaultQty,
}: BillingGroupProps) {
  const checkedCount = units.filter((u) => selections.get(u.unitCode)?.checked).length
  return (
    <div className="rounded-lg border border-[#2a3347] overflow-hidden">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 bg-[#141414] text-left hover:bg-white/4 transition"
      >
        <ChevronDown size={13} className={`text-slate-500 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
        <span className="flex-1 text-xs font-semibold text-slate-300">{title}</span>
        {checkedCount > 0 && (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-[9px] font-bold text-white">
            {checkedCount}
          </span>
        )}
        <span className="text-[10px] text-slate-600">{units.length}</span>
      </button>

      {isOpen && (
        <div className="divide-y divide-[#1e1e1e]">
          {units.map((u) => {
            const sel = selections.get(u.unitCode)
            const checked = sel?.checked ?? false
            const qty = sel?.qty ?? defaultQty
            return (
              <div key={u.unitCode} className={`px-3 py-2.5 transition ${checked ? 'bg-brand-900/20' : 'hover:bg-white/3'}`}>
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <button
                    onClick={() => onToggleUnit(u.unitCode, defaultQty)}
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                      checked ? 'bg-brand-600 border-brand-600' : 'border-[#3a4357] bg-[#141414]'
                    }`}
                  >
                    {checked && <Check size={9} className="text-white" />}
                  </button>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-200 leading-tight">{u.description}</p>
                    <p className="text-[10px] text-slate-600 mt-0.5">
                      {u.unitCode} · {u.uom}
                      {u.rate > 0 && <> · <span className="text-emerald-500">${u.rate.toFixed(2)}</span></>}
                    </p>
                  </div>

                  {/* Qty when checked */}
                  {checked && (
                    <input
                      type="number"
                      min={0}
                      step={u.uom === 'LF' ? 1 : 0.5}
                      value={qty}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onSetQty(u.unitCode, parseFloat(e.target.value) || 0)}
                      className="w-16 rounded border border-[#2a3347] bg-[#0d0d0d] px-2 py-1 text-xs text-slate-200 text-right outline-none focus:border-brand-500"
                    />
                  )}
                </div>

                {checked && u.rate > 0 && (
                  <p className="mt-1 text-right text-[10px] font-semibold text-emerald-400">
                    ${(qty * u.rate).toFixed(2)}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
