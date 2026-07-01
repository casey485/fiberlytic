// ---------------------------------------------------------------------------
// Shared "submit billing to production" logic for a Work Object (FieldMarkup).
// Extracted so MarkupPanel's manual "Submit to Production" button and the
// Add Work modal's Save step both create exactly one ProductionEntry/
// ProductionLineItem set instead of maintaining two copies of this grouping
// logic.
// ---------------------------------------------------------------------------

import type { AppData, FieldMarkup, MarkupBilling, MarkupPhoto, ProductionEntry } from '../types'
import type { LineItemInput } from '../store/DataContext'
import { FEATURE_TOOL_LABELS } from './markupMeta'

function subtypeLabel(subtype: string): string {
  const parts = subtype.split('/')
  return parts[parts.length - 1]?.replace(/_/g, ' ') ?? subtype
}

export interface SubmitMarkupToProductionArgs {
  markup: FieldMarkup
  billingEntries: MarkupBilling[]
  photos: MarkupPhoto[]
  /** Current Name/Comments field values — may be unsaved local form state, so callers pass them explicitly rather than relying on markup.featureName/notes. */
  featureName: string
  notes: string
  activeEmployeeId: string | null
  data: AppData
  addProduction: (entry: Omit<ProductionEntry, 'id'>, lineItems?: LineItemInput[]) => string
  updateMarkupBilling: (id: string, patch: Partial<MarkupBilling>) => void
  updateMarkup: (id: string, patch: Partial<FieldMarkup>, actor?: string | null) => void
  addMarkup: (m: Omit<FieldMarkup, 'id' | 'createdAt'>) => string
}

export interface SubmitMarkupToProductionResult {
  calloutCenter: [number, number] | null
  calloutLabel: string | null
  calloutPhotoBlobKey: string | null
}

/** Returns null if there's nothing billable to submit (caller should no-op). */
export function submitMarkupToProduction(args: SubmitMarkupToProductionArgs): SubmitMarkupToProductionResult | null {
  const {
    markup, billingEntries, photos, featureName, notes, activeEmployeeId, data,
    addProduction, updateMarkupBilling, updateMarkup, addMarkup,
  } = args

  const billable = billingEntries.filter((b) => b.billable && b.total > 0)
  if (billable.length === 0) return null

  // Fallback crew: markup.crewId → active employee's crew → first project crew
  const resolvedCrewId = (() => {
    if (markup.crewId) return markup.crewId
    const emp = (data.employees ?? []).find((e) => e.id === activeEmployeeId)
    if (emp?.defaultCrewId) return emp.defaultCrewId
    const proj = data.projects.find((p) => p.id === markup.projectId)
    return proj?.crewIds?.[0] ?? ''
  })()

  const today = new Date().toISOString().slice(0, 10)
  const baseNotes = [
    markup.notes,
    markup.subtype ? `[${markup.subtype.replace(/_/g, ' ')}]` : null,
    `[markup:${markup.id}]`,
  ].filter(Boolean).join(' ')

  // Group billing lines by crew — each crew gets its own production entry
  const byCrewId = new Map<string, MarkupBilling[]>()
  for (const b of billable) {
    const key = b.crewId || resolvedCrewId || ''
    if (!byCrewId.has(key)) byCrewId.set(key, [])
    byCrewId.get(key)!.push(b)
  }

  let primaryCrewHandled = false
  for (const [bCrewId, lines] of byCrewId) {
    const crewLineItems: LineItemInput[] = lines.map((b) => ({
      unitCode:      b.rateCode || 'MISC',
      description:   b.description,
      uom:           b.unitType,
      quantity:      b.quantity,
      rateSnapshot:  b.rate,
      extendedTotal: b.total,
    }))
    addProduction(
      {
        date:      today,
        projectId: markup.projectId,
        crewId:    bCrewId,
        // Only the first/primary crew gets the measured footage to avoid double-counting
        footage:   !primaryCrewHandled ? Math.round(markup.lengthFt ?? 0) : 0,
        hours:     0,
        notes:     baseNotes,
        sourceMarkupId: markup.id,
      },
      crewLineItems,
    )
    primaryCrewHandled = true
  }

  // Mark billing lines as invoiced and markup as billed
  for (const b of billable) updateMarkupBilling(b.id, { invoiceStatus: 'invoiced' })
  updateMarkup(markup.id, { status: 'billed', updatedAt: new Date().toISOString() }, activeEmployeeId)

  // Drop a summary callout at the markup's center so the billed work is visible on the map
  const geo = markup.geometry
  const calloutCenter: [number, number] | null = (() => {
    if (geo.center) return geo.center as [number, number]
    if (geo.latlngs?.length) {
      const pts = geo.latlngs as [number, number][]
      const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length
      const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length
      return [lat, lng]
    }
    if (geo.bounds) {
      const b = geo.bounds as [[number, number], [number, number]]
      return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2]
    }
    return null
  })()

  if (!calloutCenter) return { calloutCenter: null, calloutLabel: null, calloutPhotoBlobKey: null }

  const toolLabel = FEATURE_TOOL_LABELS[markup.tool]
  const calloutName = featureName.trim()
    || (markup.subtype ? subtypeLabel(markup.subtype) : null)
    || toolLabel?.label
    || markup.tool
  const ftText = markup.lengthFt ? `${Math.round(markup.lengthFt).toLocaleString()} ft` : null
  const unitTypes = [...new Set(billable.map((b) => b.unitType))].join(' / ')
  const measureLine = [ftText, unitTypes].filter(Boolean).join(' · ')
  const dateLine = new Date(markup.createdAt).toLocaleDateString()
  const extraPhotos = photos.length > 1 ? `+${photos.length - 1} more photo${photos.length > 2 ? 's' : ''}` : null
  const calloutLabel = [
    calloutName,
    ...(measureLine ? [measureLine] : []),
    dateLine,
    ...(notes.trim() ? [notes.trim().slice(0, 60)] : []),
    ...(extraPhotos ? [extraPhotos] : []),
  ].join('\n')
  const firstPhoto = photos[0]
  const calloutPhotoBlobKey = firstPhoto ? `mkp-${firstPhoto.id}` : null

  addMarkup({
    projectId:   markup.projectId,
    tool:        'callout',
    subtype:     'billing_callout',
    color:       markup.color,
    weight:      2,
    fillColor:   null,
    fillOpacity: 0.15,
    opacity:     1,
    geometry:    { center: calloutCenter },
    label:       calloutLabel,
    fontSize:    11,
    featureType: calloutPhotoBlobKey,
    featureName: null,
    notes:       null,
    lengthFt:    null,
    quantity:    null,
    status:      'billed',
    layer:       'billing',
    crewId:      resolvedCrewId || null,
    updatedAt:   null,
    lockedAt:    null,
    createdBy:   activeEmployeeId ?? null,
  })

  return { calloutCenter, calloutLabel, calloutPhotoBlobKey }
}
