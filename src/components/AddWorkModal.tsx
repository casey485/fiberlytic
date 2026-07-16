/**
 * Add Work modal — Project → Field Map → Add Work → Draw → Details → Photos → Billing → Save.
 * Step 1 (Type) is shown with no markupId yet; picking a type arms the map's draw
 * tool and closes this modal so the user can draw directly on the Field Map. Once
 * a shape is committed, the parent reopens this modal with that markup's id, and
 * Details/Photos/Billing operate on it before Save.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, ImagePlus, Trash2, Search, X, MapPin, Star, Clock, Check, Sparkles } from 'lucide-react'
import { Modal } from './ui/Modal'
import { Button, Field, Input, Select, Textarea } from './ui/Form'
import { AddWorkTypeGrid } from './AddWorkTypeGrid'
import { AddWorkDiscardConfirm } from './AddWorkDiscardConfirm'
import { SpliceEnclosureForm } from './SpliceEnclosureForm'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { saveBlob, loadBlob } from '../lib/fileStore'
import { recentUnitCodes } from '../lib/analytics'
import { submitMarkupToProduction } from '../lib/productionFromMarkup'
import { crewOrSubSelectorOptions } from '../lib/crewOrSub'
import { resolveActorId } from '../lib/actorId'
import { MARKUP_STATUS_META, PHOTO_PROOF_META } from '../types'
import type { MarkupStatus, PhotoProofType, FieldMarkup, WorkObjectTypeId } from '../types'
import { WORK_OBJECT_TYPES, WORK_OBJECT_TYPE_MAP, isSequentialAnnotation, SEQUENCE_PLACEHOLDER } from '../lib/workObjectTypes'
import type { WorkObjectTypeDef } from '../lib/workObjectTypes'
import { localDateStr } from '../lib/format'

/**
 * TEMPORARY test-trial toggle — set back to `true` once trials are done to
 * restore normal required-field enforcement on the Details step (Work Type,
 * Comments, Status, Crew, Quantity, GPS): no red asterisks, no blocked
 * Next/Save while `false`, so testers can click through Details freely.
 *
 * Billing is NOT gated by this flag — it's enforced unconditionally (see
 * billingErrors below) even during test trials, because a redline finished
 * with zero billing lines never generates a Production/P&L entry at all
 * (submitMarkupToProduction bails out completely when there's nothing
 * billable) — it just silently vanishes from Production/Dashboard/P&L
 * while still looking "done" on the Field Map. That's a data-completeness
 * problem, not a required-field annoyance, so it stays locked regardless.
 */
const REQUIRE_ADD_WORK_FIELDS = false

/** Human-readable Work ID, e.g. "WO-TRN-014" — generated once, at final Save. Scoped
 *  per-project-per-type so numbers stay small; defensively re-incremented on collision
 *  (there's no server-side sequence in this frontend-only app). */
function generateWorkId(typeDef: WorkObjectTypeDef, projectId: string, allMarkups: FieldMarkup[]): string {
  const existing = new Set(
    allMarkups.filter((m) => m.projectId === projectId && m.workId).map((m) => m.workId as string),
  )
  let n = allMarkups.filter((m) => m.projectId === projectId && m.workObjectType === typeDef.id && m.workId).length + 1
  let candidate = `WO-${typeDef.shortCode}-${String(n).padStart(3, '0')}`
  while (existing.has(candidate)) {
    n += 1
    candidate = `WO-${typeDef.shortCode}-${String(n).padStart(3, '0')}`
  }
  return candidate
}

type Step = 'details' | 'splice' | 'photos' | 'billing'

interface Props {
  open: boolean
  projectId: string
  /** null while the user is still on the Step 1 type grid (map isn't drawn on yet). */
  markupId: string | null
  onClose: () => void
  onPickType: (type: WorkObjectTypeDef) => void
  /** "Non-Billable Item" — draws a reference line immediately with no wizard at all;
   *  see startNonBillableLine in KmzMap.tsx / PdfPrintMode.tsx. */
  onPickNonBillable: () => void
  /** Fiber Tick Mark / Fiber Loop / Snow Shoe — drops a point immediately with no
   *  wizard at all, straight to WorkObjectPropertiesPanel's Sequence-only view;
   *  see startSequentialAnnotation. */
  onPickSequential: (typeId: WorkObjectTypeId) => void
}

function PhotoThumb({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { loadBlob(`mkp-${photoId}`).then(setSrc) }, [photoId])
  if (!src) return <div className="h-14 w-14 shrink-0 animate-pulse rounded bg-[#1e1e1e]" />
  return <img src={src} className="h-14 w-14 shrink-0 rounded object-cover border border-[#2a3347]" />
}

export function AddWorkModal({ open, projectId, markupId, onClose, onPickType, onPickNonBillable, onPickSequential }: Props) {
  const { t } = useTranslation()
  const {
    data, updateMarkup, deleteMarkup, addMarkupPhoto, deleteMarkupPhoto, addMarkupVideo,
    addMarkupBilling, deleteMarkupBilling, updateMarkupBilling,
    addProduction, toggleFavoriteUnitCode, addNotification, logQaSubmitted,
  } = useData()
  const { role, activeEmployeeId, activeSubcontractorId, activeSupervisorEmployeeId } = useRole()
  // Supervisor and subcontractor sessions each keep their own separate
  // identity from In-House view (see RoleContext's doc comment and
  // lib/actorId.ts) — this is the id recorded as "who did this" for any
  // edit a session makes below.
  const effectiveActorId = resolveActorId(role, activeEmployeeId, activeSupervisorEmployeeId, activeSubcontractorId)
  const crewOrSubOptions = crewOrSubSelectorOptions(data, role, activeSubcontractorId)
  const [step, setStep] = useState<Step>('details')
  const [billingSearch, setBillingSearch] = useState('')
  const [billingView, setBillingView] = useState<'suggested' | 'favorites' | 'recent' | 'all'>('recent')
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'capturing' | 'error'>('idle')
  const [savingBilling, setSavingBilling] = useState(false)
  const [photoPhaseOverride, setPhotoPhaseOverride] = useState<PhotoProofType | null>(null)
  const [spliceSlotOverride, setSpliceSlotOverride] = useState<{ kind: 'enclosure_mounted' } | { kind: 'tray'; trayNumber: number } | null>(null)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Tracks the billing line just added so its quantity input can be
  // auto-focused/selected right away — see addBillingLine's comment.
  const [justAddedBillingId, setJustAddedBillingId] = useState<string | null>(null)
  const billingQtyInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  const markup = markupId ? data.fieldMarkups.find((m) => m.id === markupId) ?? null : null
  const typeDef = markup?.workObjectType ? WORK_OBJECT_TYPE_MAP[markup.workObjectType] : null
  const project = data.projects.find((p) => p.id === projectId)
  const assignedSubcontractor = markup?.assignedSubcontractorId
    ? (data.subcontractors ?? []).find((s) => s.id === markup.assignedSubcontractorId) ?? null
    : null
  // Resolution order, most specific first: (1) this subcontractor's own
  // per-project override for the project being worked — lets a subcontractor
  // running several jobs at once bill each at its own negotiated rate;
  // (2) the project's own assigned rate card. There's no single company-wide
  // fallback rate card anymore — once a subcontractor can carry a different
  // rate card per project, a lone "default" is either redundant (duplicates
  // whatever the project already specifies) or actively wrong (silently
  // applies one project's deal to every other project the same company
  // works), so the only two sources of truth are "this project, this
  // company's negotiated rate" or "this project's own rate card."
  const subProjectRateCardId = assignedSubcontractor?.projectRateCards?.find((pr) => pr.projectId === projectId)?.rateCardId
  const effectiveRateCardId = subProjectRateCardId || project?.rateCardId
  const assignedRateCard = effectiveRateCardId ? data.rateCards.find((rc) => rc.id === effectiveRateCardId) ?? null : null
  const rateCardUnits = assignedRateCard ? data.rateCardUnits.filter((u) => u.rateCardId === assignedRateCard.id) : []
  // A subcontractor session must never see the customer's rate — the price
  // we bill the client for a unit code is exactly the "what we make" figure
  // established elsewhere in the app. They see their own pay instead
  // (rate × payRatePercent/100); with no percentage configured yet, the
  // dollar figure is hidden entirely rather than guessing 100%. An in-house
  // field session gets the same rate hidden too — they're paid hourly via
  // Time Clock, unrelated to the billing rate card, so there's no pay
  // figure to substitute in; it's just gone, same as a subcontractor with
  // no pay rate configured yet. A supervisor gets the same treatment — full
  // access to pick the right unit, just never the $ figure next to it.
  const activeSub = role === 'subcontractor' ? (data.subcontractors ?? []).find((s) => s.id === activeSubcontractorId) : null
  const subPayFactor = activeSub?.payRatePercent != null ? activeSub.payRatePercent / 100 : null
  function displayRate(rawRate: number): string | null {
    if (role === 'field' || role === 'supervisor') return null
    if (role !== 'subcontractor') return `$${rawRate.toFixed(2)}`
    return subPayFactor != null ? `$${(rawRate * subPayFactor).toFixed(2)}` : null
  }
  const billingLines = markup ? data.markupBilling.filter((b) => b.markupId === markup.id) : []
  const photos = markup ? data.markupPhotos.filter((p) => p.markupId === markup.id) : []
  const favoriteCodes = data.favoriteUnitCodes ?? []
  const recentCodes = recentUnitCodes(data)

  // A unit "suggested" for the drawn Work Type either has a manually-tagged category
  // matching the type's label, or its code/description/category text hits one of the
  // type's existing OCR billingKeywords (same keyword list workObjectTypes.ts already
  // uses to auto-match plan text) — removes the need to search for the common case.
  function unitMatchesWorkType(u: (typeof rateCardUnits)[number]): boolean {
    if (!typeDef) return false
    if (u.category && u.category.trim().toLowerCase() === typeDef.label.toLowerCase()) return true
    const haystack = `${u.unitCode} ${u.description} ${u.category ?? ''}`.toLowerCase()
    return typeDef.billingKeywords.some((kw) => haystack.includes(kw.toLowerCase()))
  }
  const suggestedUnits = rateCardUnits.filter(unitMatchesWorkType)

  useEffect(() => {
    if (markupId) {
      setStep('details'); setBillingSearch('')
      setBillingView(suggestedUnits.length > 0 ? 'suggested' : 'recent')
      setPhotoPhaseOverride(null)
      setSpliceSlotOverride(null)
      setShowDiscardConfirm(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markupId])

  // Focus + select the quantity input of whatever billing line was just
  // added, so the very next thing typed lands in that field — the point of
  // capturing quantity per line "at the moment" a unit is picked, rather
  // than pre-filling every line from one shared upfront number.
  useEffect(() => {
    if (!justAddedBillingId) return
    const input = billingQtyInputRefs.current.get(justAddedBillingId)
    if (input) { input.focus(); input.select() }
    setJustAddedBillingId(null)
  }, [justAddedBillingId])

  if (!open) return null

  function patchMarkup(patch: Partial<FieldMarkup>) {
    if (!markup) return
    updateMarkup(markup.id, patch, effectiveActorId)
  }

  function captureGps() {
    if (!markup || !navigator.geolocation) { setGpsStatus('error'); return }
    setGpsStatus('capturing')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        patchMarkup({ capturedLat: pos.coords.latitude, capturedLng: pos.coords.longitude, gpsUnavailableConfirmed: false })
        setGpsStatus('idle')
      },
      () => setGpsStatus('error'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  function onWorkTypeChange(newType: WorkObjectTypeDef) {
    const patch: Partial<FieldMarkup> = { workObjectType: newType.id, color: newType.defaultColor, unit: newType.defaultUnit }
    if (markup && !newType.allowedStatuses.includes(markup.status)) patch.status = newType.allowedStatuses[0]
    patchMarkup(patch)
  }

  // ── Step 1: Type (no markup yet — map isn't clickable behind a blocking modal, which is fine here) ──
  if (!markupId) {
    return (
      <Modal dark open={open} onClose={onClose} title={t('addWork.chooseType')} size="lg">
        <AddWorkTypeGrid onSelect={onPickType} onSelectNonBillable={onPickNonBillable} onSelectSequential={onPickSequential} />
      </Modal>
    )
  }

  if (!markup) return null

  async function handlePhotoFiles(
    files: FileList | null,
    phase: PhotoProofType | null,
    spliceProofSlot?: { kind: 'enclosure_mounted' } | { kind: 'tray'; trayNumber: number } | null,
  ) {
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
            uploadedBy: null, lat: markup.capturedLat ?? null, lng: markup.capturedLng ?? null, phase,
            crewId: markup.crewId, employeeId: markup.createdBy, subcontractorId: markup.assignedSubcontractorId,
            ...(spliceProofSlot ? { spliceProofSlot } : {}),
          }, effectiveActorId)
          await saveBlob(`mkp-${id}`, dataUrl)
          resolve()
        }
        reader.readAsDataURL(file)
      })
    }
  }

  const filteredUnits = billingSearch.trim()
    ? rateCardUnits.filter((u) => {
        const q = billingSearch.toLowerCase()
        return u.unitCode.toLowerCase().includes(q) ||
          u.description.toLowerCase().includes(q) ||
          (u.category ?? '').toLowerCase().includes(q)
      })
    : billingView === 'suggested'
      ? suggestedUnits
      : billingView === 'favorites'
        ? rateCardUnits.filter((u) => favoriteCodes.includes(u.unitCode))
        : billingView === 'recent'
          ? recentCodes.map((code) => rateCardUnits.find((u) => u.unitCode === code)).filter((u): u is (typeof rateCardUnits)[number] => !!u)
          : rateCardUnits

  function addBillingLine(unit: (typeof rateCardUnits)[number]) {
    if (!markup) return
    // Quantity is captured per billing line, right here, not as one shared
    // upfront field — a work item that needs two different codes (e.g. a
    // footage code and a separate bundle-count code) gets its own real
    // quantity for each, instead of both silently inheriting the same
    // number. markup.quantity can still carry a value from legacy data or a
    // later edit (WorkObjectPropertiesPanel), so it's still honored as a
    // starting point if present; otherwise an LF-billed unit starts from the
    // geometry's own drawn length (closer to correct than a flat "1" for a
    // linear item), and anything else starts at 1 — both are just starting
    // points the field/subcontractor is expected to correct via the
    // quantity input that's auto-focused right after this line is added.
    const quantity = markup.quantity ?? (unit.uom === 'LF' ? Math.round(markup.lengthFt ?? 0) || 1 : 1)
    const newBillingId = addMarkupBilling({
      markupId: markup.id, date: markup.workDate ?? localDateStr(), crewId: markup.crewId,
      rateCode: unit.unitCode, description: unit.description, unitType: unit.uom,
      quantity, rate: unit.rate, total: quantity * unit.rate,
      billable: true, invoiceStatus: 'not_billed', notes: null,
    }, effectiveActorId)
    setJustAddedBillingId(newBillingId)
  }

  interface DetailsErrors {
    workObjectType?: string; comments?: string; status?: string; crew?: string; gps?: string
  }
  function detailsErrors(): DetailsErrors {
    if (!markup || !REQUIRE_ADD_WORK_FIELDS) return {}
    const errs: DetailsErrors = {}
    if (!markup.workObjectType) errs.workObjectType = t('addWork.validation.workTypeRequired')
    if (!markup.notes?.trim()) errs.comments = t('addWork.validation.commentsRequired')
    if (!markup.status) errs.status = t('addWork.validation.statusRequired')
    if (!markup.crewId && !markup.assignedSubcontractorId) errs.crew = t('addWork.validation.crewRequired')
    const hasGps = markup.capturedLat != null && markup.capturedLng != null
    if (!hasGps && !markup.gpsUnavailableConfirmed) errs.gps = t('addWork.validation.gpsRequired')
    return errs
  }
  // Informational only — which of a work type's suggested photo phases are still
  // missing. No longer blocks Next/Save (photos are optional): the checklist chip
  // still reflects this so a crew can see what's recommended, it just can't stop
  // them from finishing the wizard without a signal, connectivity, or a photo.
  function photosErrors(): PhotoProofType[] {
    if (!typeDef) return []
    return typeDef.requiredPhotoPhases.filter((phase) => !photos.some((p) => p.phase === phase))
  }
  // Splicing-only, and unlike photosErrors above, this DOES block Next — the
  // real paperwork's photo checklist (enclosure mounted + one photo per tray,
  // matching the enclosure's own tray count) is a hard completeness
  // requirement, not a recommendation, so it gets real count enforcement
  // instead of the informational-only treatment every other work type gets.
  function spliceProofErrors(): string[] {
    if (typeDef?.id !== 'splicing' || !markup) return []
    const enclosure = (data.spliceEnclosures ?? []).find((s) => s.markupId === markup.id)
    if (!enclosure) return ['Splice enclosure detail']
    const missing: string[] = []
    if (!photos.some((p) => p.spliceProofSlot?.kind === 'enclosure_mounted')) missing.push('Enclosure mounted photo')
    for (let tray = 1; tray <= enclosure.trayCount; tray++) {
      if (!photos.some((p) => p.spliceProofSlot?.kind === 'tray' && p.spliceProofSlot.trayNumber === tray)) {
        missing.push(`Tray ${tray} photo`)
      }
    }
    return missing
  }
  function billingErrors(): string | null {
    // Always enforced, even during test trials — see REQUIRE_ADD_WORK_FIELDS's
    // doc comment above for why this one can't be relaxed.
    if (billingLines.length === 0) return t('addWork.validation.billingRequired')
    if (!billingLines.some((b) => b.quantity > 0)) return t('addWork.validation.billingQuantityRequired')
    return null
  }
  const isWizardComplete = Object.keys(detailsErrors()).length === 0 && !billingErrors() && spliceProofErrors().length === 0

  function requestClose() {
    if (isWizardComplete) { onClose(); return }
    setShowDiscardConfirm(true)
  }
  function discardDraft() {
    if (markup) deleteMarkup(markup.id)
    setShowDiscardConfirm(false)
    onClose()
  }
  function saveDraft() {
    setShowDiscardConfirm(false)
    onClose()
  }

  function handleSave() {
    if (!markup || billingErrors() || Object.keys(detailsErrors()).length > 0 || spliceProofErrors().length > 0) return
    const workId = typeDef ? generateWorkId(typeDef, markup.projectId, data.fieldMarkups) : markup.workId ?? null
    patchMarkup({ workId })
    setSavingBilling(true)
    try {
      submitMarkupToProduction({
        markup: { ...markup, workId }, billingEntries: billingLines,
        activeEmployeeId: effectiveActorId, data, addProduction, updateMarkupBilling, updateMarkup, addNotification, logQaSubmitted,
      })
    } finally {
      setSavingBilling(false)
      onClose()
    }
  }

  const isSplicing = typeDef?.id === 'splicing'
  const steps: Step[] = isSplicing ? ['details', 'splice', 'photos', 'billing'] : ['details', 'photos', 'billing']
  const stepIdx = steps.indexOf(step)
  const nextRequiredPhase = typeDef?.requiredPhotoPhases.find((phase) => !photos.some((p) => p.phase === phase)) ?? null
  const stepDisabled =
    step === 'details' ? Object.keys(detailsErrors()).length > 0 :
    step === 'splice' ? false :
    step === 'photos' ? (isSplicing ? spliceProofErrors().length > 0 : false) :
    !!billingErrors()
  const checklist: { label: string; done: boolean; step: Step }[] = [
    { label: t('addWork.field.workType'), done: !detailsErrors().workObjectType, step: 'details' },
    { label: t('addWork.field.comments'), done: !detailsErrors().comments, step: 'details' },
    { label: t('addWork.field.status'), done: !detailsErrors().status, step: 'details' },
    { label: t('addWork.field.crew'), done: !detailsErrors().crew, step: 'details' },
    { label: t('addWork.field.gps'), done: !detailsErrors().gps, step: 'details' },
    { label: t('addWork.steps.photos'), done: isSplicing ? spliceProofErrors().length === 0 : photosErrors().length === 0, step: 'photos' },
    { label: t('addWork.steps.billing'), done: !billingErrors(), step: 'billing' },
  ]

  return (
    <>
    <Modal
      dark
      open={open}
      onClose={requestClose}
      title={t('addWork.title', { type: typeDef?.label ?? 'Work Object' })}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <Button dark variant="ghost" onClick={() => (stepIdx === 0 ? requestClose() : setStep(steps[stepIdx - 1]))}>
            {stepIdx === 0 ? t('addWork.cancel') : t('addWork.back')}
          </Button>
          <Button dark
            onClick={() => (stepIdx === steps.length - 1 ? handleSave() : setStep(steps[stepIdx + 1]))}
            disabled={savingBilling || stepDisabled}
          >
            {stepIdx === steps.length - 1 ? (savingBilling ? t('addWork.saving') : t('addWork.save')) : t('addWork.next')}
          </Button>
        </div>
      }
    >
      {/* Step indicator */}
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
        {steps.map((s, i) => (
          <span key={s} className={i <= stepIdx ? 'text-brand-400' : 'text-slate-600'}>
            {i > 0 && <span className="mx-1.5 text-slate-700">/</span>}
            {t(`addWork.steps.${s}`)}
          </span>
        ))}
      </div>

      {/* Live completion checklist — always visible, jumps to the relevant step */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {checklist.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => setStep(item.step)}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
              item.done ? 'border-emerald-700/60 text-emerald-400' : 'border-amber-700/60 text-amber-400 hover:bg-amber-950/30'
            }`}
          >
            {item.done ? <Check size={10} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            {item.label}
          </button>
        ))}
      </div>

      {step === 'details' && (
        <div className="space-y-3">
          <Field dark label={t('addWork.field.workType')} required={REQUIRE_ADD_WORK_FIELDS} error={detailsErrors().workObjectType}>
            <Select dark
              value={markup.workObjectType ?? ''}
              onChange={(e) => {
                const newType = WORK_OBJECT_TYPE_MAP[e.target.value as WorkObjectTypeId]
                if (newType) onWorkTypeChange(newType)
              }}
              className={detailsErrors().workObjectType ? 'border-red-500/70' : undefined}
            >
              <option value="" disabled>{t('addWork.field.workType')}</option>
              {WORK_OBJECT_TYPES.map((wt) => <option key={wt.id} value={wt.id}>{wt.label}</option>)}
            </Select>
          </Field>
          <Field dark label={isSequentialAnnotation(typeDef?.id) ? 'Sequence' : typeDef?.id === 'feeder_fiber' ? 'Feeder ID' : t('addWork.field.label')}>
            <Input dark
              autoFocus={isSequentialAnnotation(typeDef?.id)}
              value={markup.featureName ?? markup.label ?? ''}
              onChange={(e) => patchMarkup({ featureName: e.target.value, label: e.target.value })}
              placeholder={
                (typeDef?.id && SEQUENCE_PLACEHOLDER[typeDef.id])
                ?? (typeDef?.id === 'feeder_fiber' ? 'Optional feeder ID' : t('addWork.field.labelPlaceholder'))
              }
            />
          </Field>
          <Field dark label={t('addWork.field.comments')} required={REQUIRE_ADD_WORK_FIELDS} error={detailsErrors().comments}>
            <Textarea dark
              value={markup.notes ?? ''}
              onChange={(e) => patchMarkup({ notes: e.target.value })}
              placeholder={typeDef?.requiresNotes ? t('addWork.field.commentsRequired') : t('addWork.field.commentsOptional')}
              className={detailsErrors().comments ? 'border-red-500/70' : undefined}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field dark label={t('addWork.field.status')} required={REQUIRE_ADD_WORK_FIELDS} error={detailsErrors().status}>
              <Select dark
                value={markup.status}
                onChange={(e) => patchMarkup({ status: e.target.value as MarkupStatus })}
                className={detailsErrors().status ? 'border-red-500/70' : undefined}
              >
                {(typeDef?.allowedStatuses ?? Object.keys(MARKUP_STATUS_META) as MarkupStatus[]).map((s) => (
                  <option key={s} value={s}>{MARKUP_STATUS_META[s].label}</option>
                ))}
              </Select>
            </Field>
            <Field dark label={t('addWork.field.crew')} required={REQUIRE_ADD_WORK_FIELDS} error={detailsErrors().crew} hint="Subcontractors bill against their own rate card instead of the project's, if they have one on file.">
              <Select dark
                value={markup.assignedSubcontractorId ? `sub:${markup.assignedSubcontractorId}` : markup.crewId ? `crew:${markup.crewId}` : ''}
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) { patchMarkup({ crewId: null, assignedSubcontractorId: null }); return }
                  const [kind, id] = v.split(':')
                  patchMarkup(kind === 'sub' ? { assignedSubcontractorId: id, crewId: null } : { crewId: id, assignedSubcontractorId: null })
                }}
                className={detailsErrors().crew ? 'border-red-500/70' : undefined}
              >
                <option value="">{t('addWork.field.unassigned')}</option>
                {crewOrSubOptions.length === 1 ? (
                  // Subcontractor session: only their own name, per the isolation
                  // principle already applied to the Subcontractor Dashboard —
                  // never show the internal crew roster or other companies.
                  <option value={`${crewOrSubOptions[0].kind === 'subcontractor' ? 'sub' : 'crew'}:${crewOrSubOptions[0].id}`}>
                    {crewOrSubOptions[0].name}
                  </option>
                ) : (
                  <>
                    <optgroup label="In-House Crews">
                      {crewOrSubOptions.filter((o) => o.kind === 'crew').map((o) => (
                        <option key={o.id} value={`crew:${o.id}`}>{o.name}</option>
                      ))}
                    </optgroup>
                    {crewOrSubOptions.some((o) => o.kind === 'subcontractor') && (
                      <optgroup label="Subcontractors">
                        {crewOrSubOptions.filter((o) => o.kind === 'subcontractor').map((o) => (
                          <option key={o.id} value={`sub:${o.id}`}>{o.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </>
                )}
              </Select>
            </Field>
          </div>
          <Field dark label={t('addWork.field.gps')} required={REQUIRE_ADD_WORK_FIELDS} error={detailsErrors().gps}>
            <div className="flex items-center gap-2 flex-wrap">
              <Button dark type="button" variant="secondary" onClick={captureGps} disabled={gpsStatus === 'capturing'}>
                <MapPin size={13} className="mr-1.5" />
                {gpsStatus === 'capturing' ? t('addWork.field.capturingGps') : t('addWork.field.captureGps')}
              </Button>
              {markup.capturedLat != null && markup.capturedLng != null && (
                <span className="text-[11px] text-slate-500">{markup.capturedLat.toFixed(5)}, {markup.capturedLng.toFixed(5)}</span>
              )}
              {gpsStatus === 'error' && !markup.gpsUnavailableConfirmed && (
                <>
                  <span className="text-[11px] text-red-400">{t('addWork.field.gpsError')}</span>
                  <Button dark type="button" variant="ghost" onClick={() => patchMarkup({ gpsUnavailableConfirmed: true })}>
                    {t('addWork.field.gpsUnavailableConfirm')}
                  </Button>
                </>
              )}
              {markup.gpsUnavailableConfirmed && (markup.capturedLat == null || markup.capturedLng == null) && (
                <span className="text-[11px] text-slate-500">{t('addWork.field.gpsUnavailableBadge')}</span>
              )}
            </div>
          </Field>
        </div>
      )}

      {step === 'splice' && (
        <SpliceEnclosureForm markupId={markup.id} projectId={markup.projectId} />
      )}

      {step === 'photos' && isSplicing && (
        <div className="space-y-3">
          <p className="rounded-md border border-[#2a2a2a] bg-white/[0.03] px-2.5 py-2 text-[11px] text-slate-400">
            Every enclosure needs a photo of it mounted on the line, plus one photo per tray (matching the tray count entered on the Splice step) before this item can be saved.
          </p>
          {spliceProofErrors().length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {spliceProofErrors().map((label) => (
                <span key={label} className="rounded-full border border-amber-700/60 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                  {label}
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {photos.filter((p) => p.spliceProofSlot).map((p) => (
              <div key={p.id} className="relative">
                <PhotoThumb photoId={p.id} />
                <span className="absolute bottom-0 inset-x-0 truncate rounded-b bg-black/70 px-1 text-center text-[8px] text-white">
                  {p.spliceProofSlot?.kind === 'enclosure_mounted' ? 'Enclosure' : `Tray ${(p.spliceProofSlot as { trayNumber: number }).trayNumber}`}
                </span>
                <button
                  onClick={() => deleteMarkupPhoto(p.id, effectiveActorId)}
                  className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white"
                >
                  <X size={8} />
                </button>
              </div>
            ))}
          </div>
          <Field dark label="Tag next photo as">
            <Select dark
              value={spliceSlotOverride ? (spliceSlotOverride.kind === 'enclosure_mounted' ? 'enclosure_mounted' : `tray:${spliceSlotOverride.trayNumber}`) : ''}
              onChange={(e) => {
                const v = e.target.value
                setSpliceSlotOverride(v === 'enclosure_mounted' ? { kind: 'enclosure_mounted' } : v.startsWith('tray:') ? { kind: 'tray', trayNumber: Number(v.split(':')[1]) } : null)
              }}
            >
              <option value="enclosure_mounted">Enclosure mounted on line</option>
              {Array.from({ length: (data.spliceEnclosures ?? []).find((s) => s.markupId === markup.id)?.trayCount ?? 0 }, (_, i) => i + 1).map((tray) => (
                <option key={tray} value={`tray:${tray}`}>Tray {tray}</option>
              ))}
            </Select>
          </Field>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            className="hidden"
            onChange={(e) => handlePhotoFiles(e.target.files, null, spliceSlotOverride ?? { kind: 'enclosure_mounted' })}
          />
          <div className="flex gap-2">
            <Button dark variant="secondary" onClick={() => fileInputRef.current?.click()}>
              <Camera size={13} className="mr-1.5" /> {t('addWork.photos.takePhoto')}
            </Button>
            <Button dark variant="secondary" onClick={() => fileInputRef.current?.click()}>
              <ImagePlus size={13} className="mr-1.5" /> {t('addWork.photos.upload')}
            </Button>
          </div>
        </div>
      )}

      {step === 'photos' && !isSplicing && (
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
                  onClick={() => deleteMarkupPhoto(p.id, effectiveActorId)}
                  className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white"
                >
                  <X size={8} />
                </button>
              </div>
            ))}
          </div>
          <Field dark label={t('addWork.photos.tagNextPhotoAs')}>
            <Select dark
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
            <Button dark variant="secondary" onClick={() => fileInputRef.current?.click()}>
              <Camera size={13} className="mr-1.5" /> {t('addWork.photos.takePhoto')}
            </Button>
            <Button dark variant="secondary" onClick={() => fileInputRef.current?.click()}>
              <ImagePlus size={13} className="mr-1.5" /> {t('addWork.photos.upload')}
            </Button>
          </div>
        </div>
      )}

      {step === 'billing' && (
        <div className="space-y-3">
          {billingErrors() && (
            <p className="rounded-md border border-red-800/50 bg-red-950/20 px-2.5 py-2 text-[11px] text-red-400">
              {billingErrors()}
            </p>
          )}
          {billingLines.length > 0 && (
                <ul className="space-y-1">
                  {billingLines.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 rounded bg-white/5 px-2 py-1 text-[11px]">
                      <span className="min-w-0 flex-1 truncate">{b.rateCode} — {b.description}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        <input
                          ref={(el) => {
                            if (el) billingQtyInputRefs.current.set(b.id, el)
                            else billingQtyInputRefs.current.delete(b.id)
                          }}
                          type="number"
                          value={b.quantity}
                          onChange={(e) => {
                            const q = Number(e.target.value)
                            updateMarkupBilling(b.id, { quantity: q, total: q * b.rate })
                          }}
                          className="w-14 rounded border border-[#2a3347] bg-[#141414] px-1 py-0.5 text-right text-[11px] text-slate-200 outline-none"
                        />
                        <span className="text-slate-500">
                          {role === 'field' || role === 'supervisor'
                            ? b.unitType
                            : role !== 'subcontractor'
                              ? `${b.unitType} × $${b.rate.toFixed(2)} = $${b.total.toFixed(2)}`
                              : subPayFactor != null
                                ? `${b.unitType} · Your pay: $${(b.total * subPayFactor).toFixed(2)}`
                                : b.unitType}
                        </span>
                      </span>
                      <button onClick={() => deleteMarkupBilling(b.id, effectiveActorId)} className="shrink-0 text-slate-600 hover:text-red-400">
                        <Trash2 size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {!assignedRateCard ? (
                <p className="rounded-md border border-amber-800/50 bg-amber-950/20 px-2.5 py-2 text-[11px] text-amber-400">
                  {t('addWork.billing.noRateCardAssigned')}
                </p>
              ) : (
                <>
                  <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
                    <Input dark
                      value={billingSearch}
                      onChange={(e) => setBillingSearch(e.target.value)}
                      placeholder={t('addWork.billing.searchPlaceholder')}
                      className="pl-7"
                    />
                  </div>
                  {!billingSearch.trim() && (
                    <div className="flex flex-wrap gap-1">
                      {(['suggested', 'recent', 'favorites', 'all'] as const).map((v) => (
                        v === 'suggested' && suggestedUnits.length === 0 ? null : (
                          <button
                            key={v}
                            onClick={() => setBillingView(v)}
                            className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition ${
                              billingView === v ? 'bg-brand-600/20 text-brand-300' : 'text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            {v === 'suggested' && <Sparkles size={11} />}
                            {v === 'recent' && <Clock size={11} />}
                            {v === 'favorites' && <Star size={11} />}
                            {v === 'suggested' ? t('addWork.billing.suggested', { type: typeDef?.label ?? '' })
                              : v === 'recent' ? t('addWork.billing.recentlyUsed')
                              : v === 'favorites' ? t('addWork.billing.favorites')
                              : t('addWork.billing.allCategories')}
                          </button>
                        )
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
                          <span>
                            {u.description}
                            {u.category && <span className="ml-1.5 text-slate-600">({u.category})</span>}
                          </span>
                          <span className="text-slate-500">
                            {u.unitCode}{displayRate(u.rate) ? ` · ${displayRate(u.rate)}/${u.uom}` : ''}
                          </span>
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
                        {billingView === 'suggested' ? t('addWork.billing.noSuggested')
                          : billingView === 'favorites' ? t('addWork.billing.noFavorites')
                          : billingView === 'recent' ? t('addWork.billing.noRecent')
                          : t('addWork.billing.noUnits')}
                      </li>
                    )}
                  </ul>
                </>
              )}
        </div>
      )}
    </Modal>
    <AddWorkDiscardConfirm
      open={showDiscardConfirm}
      onSaveDraft={saveDraft}
      onDiscard={discardDraft}
      onCancel={() => setShowDiscardConfirm(false)}
    />
    </>
  )
}
