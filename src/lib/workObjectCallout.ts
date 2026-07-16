// ---------------------------------------------------------------------------
// Live callout content for a Work Object — computed fresh from the markup's
// current fields on every render, not stored anywhere. This is what makes the
// Field Map callout "update automatically when the object is edited" and stay
// "linked by the same Work ID" for free: it's the same record, not a separate
// one kept in sync. Shared by both KmzMap.tsx (Leaflet) and PdfPrintMode.tsx.
// ---------------------------------------------------------------------------

import type { AppData, FieldMarkup, MarkupGeometry } from '../types'
import { WORK_OBJECT_TYPE_MAP, isSequentialAnnotation, isCommentAnnotation } from './workObjectTypes'
import { DEFAULT_CALLOUT_DISPLAY_SETTINGS, type CalloutDisplaySettings } from './calloutDisplaySettings'
import { crewOrSubName } from './crewOrSub'

/** Only markups created via Add Work (have a workObjectType) get an auto-callout —
 *  plain freehand pen/measure/text/highlight annotations stay callout-free. */
export function isCalloutWorthy(markup: FieldMarkup): boolean {
  return !!markup.workObjectType
}

/** The point exactly halfway along a polyline's own path length (not a raw
 *  average of its vertices) — for a bendy multi-segment redline, a vertex
 *  average frequently lands off to one side of the actual path (pulled
 *  toward whichever stretch happens to have more vertices packed into it),
 *  which reads as the callout's leader line "not attached to" the line it's
 *  labeling. Walking the cumulative segment length guarantees the anchor is
 *  a point that's actually ON the line. */
function polylineMidpoint(pts: [number, number][]): [number, number] {
  if (pts.length === 1) return pts[0]
  const segLens: number[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    segLens.push(d)
    total += d
  }
  if (total === 0) return pts[0]
  let remaining = total / 2
  for (let i = 0; i < segLens.length; i++) {
    if (remaining <= segLens[i]) {
      const t = segLens[i] === 0 ? 0 : remaining / segLens[i]
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[i + 1]
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]
    }
    remaining -= segLens[i]
  }
  return pts[pts.length - 1]
}

/** A callout needs one anchor point regardless of the source shape's geometry kind —
 *  a point already has one (`center`), a line/pen anchors at the true midpoint of
 *  its own path (see polylineMidpoint), a rect/bounds shape anchors at its midpoint. */
export function geometryAnchor(geo: MarkupGeometry): [number, number] | null {
  if (geo.center) return geo.center
  if (geo.latlngs?.length) return polylineMidpoint(geo.latlngs)
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
  // Covers both in-house crew and subcontractor attribution — a subcontractor-
  // submitted redline has assignedSubcontractorId set and crewId null, so
  // looking up crewId alone always showed "Unassigned" for their work.
  const crewName = (markup.crewId || markup.assignedSubcontractorId)
    ? crewOrSubName(data, markup.crewId, markup.assignedSubcontractorId)
    : null
  const billingLines = (data.markupBilling ?? []).filter((b) => b.markupId === markup.id)

  // A sequential annotation's (Fiber Tick Mark / Fiber Loop / Snow Shoe) entire
  // purpose is "type a sequence code, see it on the map" — its callout always
  // leads with whatever was typed into the Label field instead of the usual
  // Work ID/type-label title, falling back to the normal rule only until a
  // label's actually been typed.
  const isSeqAnnotation = isSequentialAnnotation(markup.workObjectType)
  // A comment annotation (Restoration / QA-QC / Damage Report / Other /
  // Anchor-Down Guy) keeps the normal type-label title but is otherwise the
  // same "never billable, no crew/quantity" case as a sequential annotation —
  // its comment shows via the existing Notes row below (markup.notes).
  const isCmtAnnotation = isCommentAnnotation(markup.workObjectType)
  const title = isSeqAnnotation && markup.featureName
    ? markup.featureName
    : settings.workType ? (typeDef?.label ?? markup.tool) : (markup.workId ?? 'Work Object')

  const rows: { label: string; value: string }[] = []
  // These types have no crew/quantity/billing — pure annotations, never billed —
  // so their callout is just the sequence title above with nothing else
  // cluttering it (no "Crew: Unassigned" / "Billing Code: —" placeholder noise).

  if (!isSeqAnnotation && !isCmtAnnotation && settings.crew) rows.push({ label: 'Crew', value: crewName ?? 'Unassigned' })

  if (!isSeqAnnotation && !isCmtAnnotation && settings.quantity) {
    rows.push({ label: 'Quantity', value: markup.quantity != null ? markup.quantity.toLocaleString() : '—' })
  }

  if (settings.date) rows.push({ label: 'Date', value: formatWorkDate(markup) })

  if (!isSeqAnnotation && !isCmtAnnotation && settings.billingCode) {
    const codes = billingLines.slice(0, 2).map((b) => `${b.rateCode} x ${b.quantity}`)
    const extra = billingLines.length > 2 ? ` +${billingLines.length - 2} more` : ''
    rows.push({ label: 'Billing Code', value: codes.length > 0 ? `${codes.join(', ')}${extra}` : '—' })
  }

  // A comment annotation's whole purpose is "type a comment, see it on the
  // map" — like a sequential annotation's title, its comment always shows
  // regardless of the Notes display setting (which defaults off).
  if ((isCmtAnnotation || settings.notes) && markup.notes) {
    rows.push({ label: isCmtAnnotation ? 'Comment' : 'Notes', value: markup.notes })
  }

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
