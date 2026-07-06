// ---------------------------------------------------------------------------
// Live callout content for a Work Object — computed fresh from the markup's
// current fields on every render, not stored anywhere. This is what makes the
// Field Map callout "update automatically when the object is edited" and stay
// "linked by the same Work ID" for free: it's the same record, not a separate
// one kept in sync. Shared by both KmzMap.tsx (Leaflet) and PdfPrintMode.tsx.
// ---------------------------------------------------------------------------

import type { AppData, FieldMarkup, MarkupGeometry } from '../types'
import { WORK_OBJECT_TYPE_MAP } from './workObjectTypes'
import { DEFAULT_CALLOUT_DISPLAY_SETTINGS, type CalloutDisplaySettings } from './calloutDisplaySettings'

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

/** Structured callout content — a title (the box's identity) plus zero or more
 *  label/value rows, filtered by the user's Callout Display Settings. Replaces the
 *  old flat string[] so both renderers can lay this out as a clean label/value card
 *  instead of one pre-joined text blob. */
export interface CalloutContent {
  title: string | null
  rows: { label: string; value: string }[]
}

function formatWorkDate(markup: FieldMarkup): string {
  // markup.workDate is a date-only "YYYY-MM-DD" string — append a local-midnight
  // time so it doesn't shift a day backward in timezones behind UTC (createdAt is
  // already a full ISO datetime and needs no such adjustment).
  const iso = markup.workDate ? `${markup.workDate}T00:00:00` : markup.createdAt
  return new Date(iso).toLocaleDateString()
}

/** Deliberately field-crew-facing by default — no Work ID, GPS, Notes, or pricing/
 *  revenue figures unless the user opts into them via Callout Display Settings.
 *  Billing Code is shown as code x quantity only, never a dollar amount. Status is
 *  intentionally omitted entirely — it added noise without helping a field crew
 *  read the callout at a glance. */
export function buildWorkObjectCalloutContent(
  markup: FieldMarkup,
  data: AppData,
  settings: CalloutDisplaySettings = DEFAULT_CALLOUT_DISPLAY_SETTINGS,
): CalloutContent {
  const typeDef = markup.workObjectType ? WORK_OBJECT_TYPE_MAP[markup.workObjectType] : null
  const crewName = markup.crewId ? (data.crews ?? []).find((c) => c.id === markup.crewId)?.name : null
  const billingLines = (data.markupBilling ?? []).filter((b) => b.markupId === markup.id)

  const title = settings.workType ? (typeDef?.label ?? markup.tool) : (markup.workId ?? 'Work Object')

  const rows: { label: string; value: string }[] = []

  if (settings.crew) rows.push({ label: 'Crew', value: crewName ?? 'Unassigned' })

  if (settings.quantity) {
    rows.push({ label: 'Quantity', value: markup.quantity != null ? markup.quantity.toLocaleString() : '—' })
  }

  if (settings.date) rows.push({ label: 'Date', value: formatWorkDate(markup) })

  if (settings.billingCode) {
    const codes = billingLines.slice(0, 2).map((b) => `${b.rateCode} x ${b.quantity}`)
    const extra = billingLines.length > 2 ? ` +${billingLines.length - 2} more` : ''
    rows.push({ label: 'Billing Code', value: codes.length > 0 ? `${codes.join(', ')}${extra}` : '—' })
  }

  if (settings.notes && markup.notes) rows.push({ label: 'Notes', value: markup.notes })

  if (settings.photosIndicator) {
    const count = (data.markupPhotos ?? []).filter((p) => p.markupId === markup.id).length
    if (count > 0) rows.push({ label: 'Photos', value: `${count} attached` })
  }

  if (settings.gpsCoordinates) {
    const gps = markup.capturedLat != null && markup.capturedLng != null
      ? [markup.capturedLat, markup.capturedLng]
      : geometryAnchor(markup.geometry)
    if (gps) rows.push({ label: 'GPS', value: `${gps[0].toFixed(5)}, ${gps[1].toFixed(5)}` })
  }

  if (settings.createdBy) {
    const employee = markup.createdBy ? (data.employees ?? []).find((e) => e.id === markup.createdBy) : null
    rows.push({ label: 'Created By', value: employee?.name ?? '—' })
  }

  return { title, rows }
}

/** Flattened "Label: value" lines — kept for call sites that haven't moved to the
 *  structured card layout yet. */
export function calloutContentToLines(content: CalloutContent): string[] {
  return [
    ...(content.title ? [content.title] : []),
    ...content.rows.map((r) => `${r.label}: ${r.value}`),
  ]
}
