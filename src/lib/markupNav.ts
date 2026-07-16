// ---------------------------------------------------------------------------
// Shared "open this redline on a map" navigation target — a markup drawn on
// a PDF print (coordSpace 'pdfPage') doesn't exist in the Leaflet Field
// Map's lat/lng space at all; sending it there scatters its raw page-point
// coordinates across a world map instead of showing the actual print. Every
// "Open Redline" / "Open on Map" action (QA/QC review, notifications,
// dashboards) should route through this so they all agree on where a given
// markup actually lives.
// ---------------------------------------------------------------------------

import type { FieldMarkup } from '../types'
import type { AppRole } from '../store/RoleContext'

export function redlineMapTarget(markup: FieldMarkup): { pathname: string; state: { focusMarkupId: string } } {
  if (markup.coordSpace === 'pdfPage' && markup.sourceProjectFileId) {
    return {
      pathname: `/kmz/${markup.projectId}/print/${markup.sourceProjectFileId}`,
      state: { focusMarkupId: markup.id },
    }
  }
  return {
    pathname: `/kmz/${markup.projectId}`,
    state: { focusMarkupId: markup.id },
  }
}

// Same isolation principle as the subcontractor-vs-subcontractor case, one
// level up: a subcontractor's billing/rate/quantity info is "what we make"
// data that an in-house crew must never see either — only admin has full
// visibility across both crews and subcontractors. A subcontractor session
// stays blind to anyone else's work (including other subcontractors' and
// in-house crews'); a field session stays blind to *any* subcontractor's
// work specifically, but keeps seeing every in-house crew's work as before —
// that visibility was never in question here, only subcontractor-authored
// work newly needs hiding from field.
export function isWorkHiddenFromSession(
  role: AppRole,
  activeSubcontractorId: string | null,
  markup: Pick<FieldMarkup, 'assignedSubcontractorId'>,
): boolean {
  if (role === 'subcontractor') return markup.assignedSubcontractorId !== activeSubcontractorId
  if (role === 'field') return markup.assignedSubcontractorId != null
  return false
}
