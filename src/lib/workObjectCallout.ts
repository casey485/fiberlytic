// ---------------------------------------------------------------------------
// Live callout content for a Work Object — computed fresh from the markup's
// current fields on every render, not stored anywhere. This is what makes the
// Field Map callout "update automatically when the object is edited" and stay
// "linked by the same Work ID" for free: it's the same record, not a separate
// one kept in sync. Shared by both KmzMap.tsx (Leaflet) and PdfPrintMode.tsx.
// ---------------------------------------------------------------------------

import type { AppData, FieldMarkup, MarkupGeometry } from '../types'
import { MARKUP_STATUS_META } from '../types'
import { WORK_OBJECT_TYPE_MAP } from './workObjectTypes'

/** Only markups created via Add Work (have a workObjectType) get an auto-callout —
 *  plain freehand pen/measure/text/highlight annotations stay callout-free. */
export function isCalloutWorthy(markup: FieldMarkup): boolean {
  return !!markup.workObjectType
}

/** A callout needs one anchor point regardless of the source shape's geometry kind —
 *  a point already has one (`center`), a line/pen anchors at the average of its
 *  vertices, a rect/bounds shape anchors at its midpoint. */
export function geometryAnchor(geo: MarkupGeometry): [number, number] | null {
  if (geo.center) return geo.center
  if (geo.latlngs?.length) {
    const pts = geo.latlngs
    const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length
    const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length
    return [lat, lng]
  }
  if (geo.bounds) {
    const b = geo.bounds
    return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2]
  }
  return null
}

/** Deliberately field-crew-facing only — no Work ID, GPS, Notes, or any pricing/
 *  revenue figures. Billing Code is shown as code x quantity only, never a dollar
 *  amount. Just enough to know what was done, by whom, how much, and when, at a
 *  glance, without opening the full work details panel. */
export function buildWorkObjectCalloutLines(markup: FieldMarkup, data: AppData): string[] {
  const typeDef = markup.workObjectType ? WORK_OBJECT_TYPE_MAP[markup.workObjectType] : null
  const crewName = markup.crewId ? (data.crews ?? []).find((c) => c.id === markup.crewId)?.name : null
  const billingLines = (data.markupBilling ?? []).filter((b) => b.markupId === markup.id)

  const quantityLine = markup.quantity != null
    ? markup.quantity.toLocaleString()
    : '—'

  const billingCodeLines = billingLines.slice(0, 2).map((b) => `${b.rateCode} x ${b.quantity}`)
  const extraBillingLine = billingLines.length > 2 ? `+${billingLines.length - 2} more` : null

  return [
    typeDef?.label ?? markup.tool,
    `Crew: ${crewName ?? 'Unassigned'}`,
    `Quantity: ${quantityLine}`,
    `Date: ${new Date(markup.createdAt).toLocaleDateString()}`,
    `Billing Code: ${billingCodeLines.length > 0 ? billingCodeLines.join(', ') : '—'}`,
    ...(extraBillingLine ? [extraBillingLine] : []),
    `Status: ${MARKUP_STATUS_META[markup.status]?.label ?? markup.status}`,
  ]
}
