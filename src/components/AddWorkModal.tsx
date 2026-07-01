/**
 * Add Work modal — Project → Field Map → Add Work → Draw → Details → Photos → Billing → Save.
 * Step 1 (Type) is shown with no markupId yet; picking a type arms the map's draw
 * tool and closes this modal so the user can draw directly on the Field Map. Once
 * a shape is committed, the parent reopens this modal with that markup's id, and
 * Details/Photos/Billing operate on it before Save.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, ImagePlus, Trash2, Search, X, MapPin, Star, Clock, Check } from 'lucide-react'
import { Modal } from './ui/Modal'
import { Button, Field, Input, Select, Textarea } from './ui/Form'
import { AddWorkTypeGrid } from './AddWorkTypeGrid'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { saveBlob, loadBlob } from '../lib/fileStore'
import { recentUnitCodes } from '../lib/analytics'
import { submitMarkupToProduction } from '../lib/productionFromMarkup'
import { MARKUP_STATUS_META, PHOTO_PROOF_META } from '../types'
import type { MarkupStatus, PhotoProofType, FieldMarkup } from '../types'
import { WORK_OBJECT_TYPE_MAP } from '../lib/workObjectTypes'
import type { WorkObjectTypeDef } from '../lib/workObjectTypes'

type Step = 'details' | 'photos' | 'billing'

interface Props {
  open: boolean
  projectId: string
  /** null while the user is still on the Step 1 type grid (map isn't drawn on yet). */
  markupId: string | null
  onClose: () => void
  onPickType: (type: WorkObjectTypeDef) => void
}

function PhotoThumb({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { loadBlob(`mkp-${photoId}`).then(setSrc) }, [photoId])
  if (!src) return <div className="h-14 w-14 shrink-0 animate-pulse rounded bg-[#1e1e1e]" />
  return <img src={src} className="h-14 w-14 shrink-0 rounded object-cover border border-[#2a3347]" />
}

export function AddWorkModal({ open, projectId, markupId, onClose, onPickType }: Props) {
  const { t } = useTranslation()
  const {
    data, updateMarkup, addMarkupPhoto, deleteMarkupPhoto, addMarkupVideo,
    addMarkupBilling, deleteMarkupBilling, updateMarkupBilling,
    addProduction, addMarkup, toggleFavoriteUnitCode,
  } = useData()
  const { activeEmployeeId } = useRole()
  const [step, setStep] = useState<Step>('details')
  const [billingSkipped, setBillingSkipped] = useState(false)
  const [billingSearch, setBillingSearch] = useState('')
  const [billingView, setBillingView] = useState<'favorites' | 'recent' | 'all'>('recent')
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'capturing' | 'error'>('idle')
  const [savingBilling, setSavingBilling] = useState(false)
  const [photoPhaseOverride, setPhotoPhaseOverride] = useState<PhotoProofType | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const markup = markupId ? data.fieldMarkups.find((m) => m.id === markupId) ?? null : null
  const typeDef = markup?.workObjectType ? WORK_OBJECT_TYPE_MAP[markup.workObjectType] : null
  const project = data.projects.find((p) => p.id === projectId)
  const rateCards = project?.clientId ? data.rateCards.filter((rc) => rc.clientId === project.clientId) : []
  const rateCardUnits = data.rateCardUnits.filter((u) => rateCards.some((rc) => rc.id === u.rateCardId))
  const billingLines = markup ? data.markupBilling.filter((b) => b.markupId === markup.id) : []
  const photos = markup ? data.markupPhotos.filter((p) => p.markupId === markup.id) : []
  const favoriteCodes = data.favoriteUnitCodes ?? []
  const recentCodes = recentUnitCodes(data)

  useEffect(() => {
    if (markupId) { setStep('details'); setBillingSkipped(false); setBillingSearch(''); setBillingView('recent'); setPhotoPhaseOverride(null) }
  }, [markupId])

  if (!open) return null

  function patchMarkup(patch: Partial<FieldMarkup>) {
    if (!markup) return
    updateMarkup(markup.id, patch, activeEmployeeId)
  }

  function captureGps() {
    if (!markup || !navigator.geolocation) { setGpsStatus('error'); return }
    setGpsStatus('capturing')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        patchMarkup({ capturedLat: pos.coords.latitude, capturedLng: pos.coords.longitude })
        setGpsStatus('idle')
      },
      () => setGpsStatus('error'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  // ── Step 1: Type (no markup yet — map isn't clickable behind a blocking modal, which is fine here) ──
  if (!markupId) {
    return (
      <Modal open={open} onClose={onClose} title={t('addWork.chooseType')} size="lg">
        <AddWorkTypeGrid onSelect={onPickType} />
      </Modal>
    )
  }

  if (!markup) return null

  async function handlePhotoFiles(files: FileList | null, phase: PhotoProofType | null) {
    if (!files || !markup) return
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
            markupId: markup.id, caption: null, takenAt: new Date().toISOString(),
            uploadedBy: null, lat: null, lng: null, phase,
          }, activeEmployeeId)
          await saveBlob(`mkp-${id}`, dataUrl)
          resolve()
        }
        reader.readAsDataURL(file)
      })
    }
  }

  const filteredUnits = billingSearch.trim()
    ? rateCardUnits.filter((u) =>
        u.unitCode.toLowerCase().includes(billingSearch.toLowerCase()) ||
        u.description.toLowerCase().includes(billingSearch.toLowerCase()))
    : billingView === 'favorites'
      ? rateCardUnits.filter((u) => favoriteCodes.includes(u.unitCode))
      : billingView === 'recent'
        ? recentCodes.map((code) => rateCardUnits.find((u) => u.unitCode === code)).filter((u): u is (typeof rateCardUnits)[number] => !!u)
        : rateCardUnits

  function addBillingLine(unit: (typeof rateCardUnits)[number]) {
    if (!markup) return
    const quantity = markup.quantity ?? 1
    addMarkupBilling({
      markupId: markup.id, date: new Date().toISOString().slice(0, 10), crewId: markup.crewId,
      rateCode: unit.unitCode, description: unit.description, unitType: unit.uom,
      quantity, rate: unit.rate, total: quantity * unit.rate,
      billable: true, invoiceStatus: 'not_billed', notes: null,
    }, activeEmployeeId)
  }

  function handleSave() {
    if (!markup) { onClose(); return }
    if (billingSkipped || billingLines.length === 0) { onClose(); return }
    setSavingBilling(true)
    try {
      submitMarkupToProduction({
        markup, billingEntries: billingLines, photos,
        featureName: markup.featureName ?? markup.label ?? '', notes: markup.notes ?? '',
        activeEmployeeId, data, addProduction, updateMarkupBilling, updateMarkup, addMarkup,
      })
    } finally {
      setSavingBilling(false)
      onClose()
    }
  }

  const steps: Step[] = ['details', 'photos', 'billing']
  const stepIdx = steps.indexOf(step)
  const nextRequiredPhase = typeDef?.requiredPhotoPhases.find((phase) => !photos.some((p) => p.phase === phase)) ?? null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('addWork.title', { type: typeDef?.label ?? 'Work Object' })}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" onClick={() => (stepIdx === 0 ? onClose() : setStep(steps[stepIdx - 1]))}>
            {stepIdx === 0 ? t('addWork.cancel') : t('addWork.back')}
          </Button>
          <Button
            onClick={() => (stepIdx === steps.length - 1 ? handleSave() : setStep(steps[stepIdx + 1]))}
            disabled={savingBilling}
          >
            {stepIdx === steps.length - 1 ? (savingBilling ? t('addWork.saving') : t('addWork.save')) : t('addWork.next')}
          </Button>
        </div>
      }
    >
      {/* Step indicator */}
      <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
        {steps.map((s, i) => (
          <span key={s} className={i <= stepIdx ? 'text-brand-400' : 'text-slate-600'}>
            {i > 0 && <span className="mx-1.5 text-slate-700">/</span>}
            {t(`addWork.steps.${s}`)}
          </span>
        ))}
      </div>

      {step === 'details' && (
        <div className="space-y-3">
          <Field label={t('addWork.field.name')}>
            <Input
              value={markup.featureName ?? markup.label ?? ''}
              onChange={(e) => patchMarkup({ featureName: e.target.value, label: e.target.value })}
              placeholder={typeDef?.label ?? t('addWork.field.namePlaceholder')}
            />
          </Field>
          <Field label={t('addWork.field.comments')}>
            <Textarea
              value={markup.notes ?? ''}
              onChange={(e) => patchMarkup({ notes: e.target.value })}
              placeholder={typeDef?.requiresNotes ? t('addWork.field.commentsRequired') : t('addWork.field.commentsOptional')}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('addWork.field.status')}>
              <Select
                value={markup.status}
                onChange={(e) => patchMarkup({ status: e.target.value as MarkupStatus })}
              >
                {(typeDef?.allowedStatuses ?? Object.keys(MARKUP_STATUS_META) as MarkupStatus[]).map((s) => (
                  <option key={s} value={s}>{MARKUP_STATUS_META[s].label}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('addWork.field.crew')}>
              <Select
                value={markup.crewId ?? ''}
                onChange={(e) => patchMarkup({ crewId: e.target.value || null })}
              >
                <option value="">{t('addWork.field.unassigned')}</option>
                {data.crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label={`${t('addWork.field.quantity')}${typeDef ? ` (${typeDef.defaultUnit})` : ''}`}>
            <Input
              type="number"
              value={markup.quantity ?? ''}
              onChange={(e) => patchMarkup({ quantity: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </Field>
          <Field label={t('addWork.field.gps')}>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={captureGps} disabled={gpsStatus === 'capturing'}>
                <MapPin size={13} className="mr-1.5" />
                {gpsStatus === 'capturing' ? t('addWork.field.capturingGps') : t('addWork.field.captureGps')}
              </Button>
              {markup.capturedLat != null && markup.capturedLng != null && (
                <span className="text-[11px] text-slate-500">{markup.capturedLat.toFixed(5)}, {markup.capturedLng.toFixed(5)}</span>
              )}
              {gpsStatus === 'error' && <span className="text-[11px] text-red-400">{t('addWork.field.gpsError')}</span>}
            </div>
          </Field>
        </div>
      )}

      {step === 'photos' && (
        <div className="space-y-3">
          {typeDef && typeDef.requiredPhotoPhases.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {typeDef.requiredPhotoPhases.map((phase) => {
                const satisfied = photos.some((p) => p.phase === phase)
                return (
                  <span
                    key={phase}
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                      satisfied ? 'border-emerald-700/60 text-emerald-400' : 'border-[#2a2a2a] text-slate-500'
                    }`}
                  >
                    {satisfied && <Check size={10} />}
                    {PHOTO_PROOF_META[phase].label}
                  </span>
                )
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <div key={p.id} className="relative">
                <PhotoThumb photoId={p.id} />
                {p.phase && (
                  <span className="absolute bottom-0 inset-x-0 truncate rounded-b bg-black/70 px-1 text-center text-[8px] text-white">
                    {PHOTO_PROOF_META[p.phase].label}
                  </span>
                )}
                <button
                  onClick={() => deleteMarkupPhoto(p.id, activeEmployeeId)}
                  className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white"
                >
                  <X size={8} />
                </button>
              </div>
            ))}
          </div>
          <Field label={t('addWork.photos.tagNextPhotoAs')}>
            <Select
              value={photoPhaseOverride ?? nextRequiredPhase ?? 'other'}
              onChange={(e) => setPhotoPhaseOverride(e.target.value as PhotoProofType)}
            >
              {(typeDef?.requiredPhotoPhases.length ? typeDef.requiredPhotoPhases : (Object.keys(PHOTO_PROOF_META) as PhotoProofType[])).map((phase) => (
                <option key={phase} value={phase}>{PHOTO_PROOF_META[phase].label}</option>
              ))}
              <option value="other">{PHOTO_PROOF_META.other.label}</option>
            </Select>
          </Field>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            capture="environment"
            className="hidden"
            onChange={(e) => handlePhotoFiles(e.target.files, photoPhaseOverride ?? nextRequiredPhase ?? 'other')}
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              <Camera size={13} className="mr-1.5" /> {t('addWork.photos.takePhoto')}
            </Button>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              <ImagePlus size={13} className="mr-1.5" /> {t('addWork.photos.upload')}
            </Button>
          </div>
        </div>
      )}

      {step === 'billing' && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            <input
              type="checkbox"
              checked={billingSkipped}
              onChange={(e) => setBillingSkipped(e.target.checked)}
            />
            {t('addWork.billing.notRequired')}
          </label>

          {!billingSkipped && (
            <>
              {billingLines.length > 0 && (
                <ul className="space-y-1">
                  {billingLines.map((b) => (
                    <li key={b.id} className="flex items-center justify-between rounded bg-white/5 px-2 py-1 text-[11px]">
                      <span>{b.rateCode} — {b.description} · {b.quantity} {b.unitType} × ${b.rate.toFixed(2)} = ${b.total.toFixed(2)}</span>
                      <button onClick={() => deleteMarkupBilling(b.id, activeEmployeeId)} className="text-slate-600 hover:text-red-400">
                        <Trash2 size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
                <Input
                  value={billingSearch}
                  onChange={(e) => setBillingSearch(e.target.value)}
                  placeholder={t('addWork.billing.searchPlaceholder')}
                  className="pl-7"
                />
              </div>
              {!billingSearch.trim() && (
                <div className="flex gap-1">
                  {(['recent', 'favorites', 'all'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setBillingView(v)}
                      className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition ${
                        billingView === v ? 'bg-brand-600/20 text-brand-300' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {v === 'recent' && <Clock size={11} />}
                      {v === 'favorites' && <Star size={11} />}
                      {v === 'recent' ? t('addWork.billing.recentlyUsed') : v === 'favorites' ? t('addWork.billing.favorites') : t('addWork.billing.allCategories')}
                    </button>
                  ))}
                </div>
              )}
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {filteredUnits.map((u) => (
                  <li key={u.id} className="flex items-center gap-1">
                    <button
                      onClick={() => addBillingLine(u)}
                      className="flex flex-1 items-center justify-between rounded px-2 py-1.5 text-left text-[11px] text-slate-300 hover:bg-white/5"
                    >
                      <span>{u.description}</span>
                      <span className="text-slate-500">{u.unitCode} · ${u.rate.toFixed(2)}/{u.uom}</span>
                    </button>
                    <button
                      onClick={() => toggleFavoriteUnitCode(u.unitCode)}
                      title={favoriteCodes.includes(u.unitCode) ? 'Remove favorite' : 'Add favorite'}
                      className={favoriteCodes.includes(u.unitCode) ? 'text-amber-400' : 'text-slate-700 hover:text-slate-400'}
                    >
                      <Star size={12} fill={favoriteCodes.includes(u.unitCode) ? 'currentColor' : 'none'} />
                    </button>
                  </li>
                ))}
                {filteredUnits.length === 0 && (
                  <li className="text-[11px] text-slate-600">
                    {billingView === 'favorites' ? t('addWork.billing.noFavorites') : billingView === 'recent' ? t('addWork.billing.noRecent') : t('addWork.billing.noUnits')}
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
