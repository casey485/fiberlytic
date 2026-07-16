import type { AppRole } from '../store/RoleContext'

/**
 * Resolves "who is performing this action" for history/audit-trail fields
 * (markupHistory.actor, MarkupBilling.qa*By, MarkupInspection.createdBy,
 * etc.) — these are free-form strings that already support a
 * `subcontractor:<id>` prefix (see actorLabel in lib/qaReview.ts), so every
 * role gets a real, resolvable identity here instead of silently falling
 * through to activeEmployeeId — a stale in-house employee id left over from
 * whenever this device last used In-House view, which misattributes a
 * subcontractor's actions to that employee.
 *
 * Do NOT use this for FieldMarkup.createdBy — see createdByActorId below.
 */
export function resolveActorId(
  role: AppRole,
  activeEmployeeId: string | null,
  activeSupervisorEmployeeId: string | null,
  activeSubcontractorId: string | null,
): string | null {
  if (role === 'supervisor') return activeSupervisorEmployeeId
  if (role === 'subcontractor') return activeSubcontractorId ? `subcontractor:${activeSubcontractorId}` : null
  return activeEmployeeId
}

/**
 * FieldMarkup.createdBy is Employee-only by convention (see
 * MarkupBilling.assignedSubcontractorId's doc comment) — a subcontractor
 * session must never stamp its own id (or a stale employee id) into this
 * field, or a subcontractor's redline gets misattributed to a real
 * employee, leaking its QA history into that employee's Field Dashboard
 * "Corrections Needed" list (which matches on markup.createdBy without
 * checking assignedSubcontractorId). Real subcontractor attribution lives
 * entirely in assignedSubcontractorId, set independently wherever a markup
 * is created.
 */
export function createdByActorId(role: AppRole, effectiveActorId: string | null): string | null {
  return role === 'subcontractor' ? null : effectiveActorId
}
