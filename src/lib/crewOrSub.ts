// ---------------------------------------------------------------------------
// Crew (in-house) and Subcontractor (outside company) are two separate
// entities, but for "who performed this work" they're the same kind of
// thing — some internal, some not. This is the one place that branching
// logic lives, instead of duplicating data.crews.find(...) vs
// data.subcontractors.find(...) at every display/filter/selector call site.
// ---------------------------------------------------------------------------

import type { AppData } from '../types'
import type { AppRole } from '../store/RoleContext'

export interface CrewOrSubOption {
  id: string
  name: string
  kind: 'crew' | 'subcontractor'
}

/** Every selectable "who did the work" option, admin-side — in-house crews
 *  plus active subcontractors as one combined list, for "All crews" style
 *  filters and aggregation tables. */
export function listCrewsAndSubcontractors(data: AppData): CrewOrSubOption[] {
  return [
    ...data.crews.map((c): CrewOrSubOption => ({ id: c.id, name: c.name, kind: 'crew' })),
    ...(data.subcontractors ?? []).filter((s) => s.active).map((s): CrewOrSubOption => ({ id: s.id, name: s.companyName, kind: 'subcontractor' })),
  ]
}

/** Resolves a display name from a (crewId, subcontractorId) pair — the two
 *  are mutually exclusive (never both set, same convention as
 *  FieldMarkup/MarkupBilling.assignedSubcontractorId). Falls back to
 *  'Unassigned' when neither is set, matching existing crew-lookup call
 *  sites' behavior for a missing/empty crewId. */
export function crewOrSubName(
  data: AppData,
  crewId: string | null | undefined,
  subcontractorId: string | null | undefined,
): string {
  if (subcontractorId) {
    return (data.subcontractors ?? []).find((s) => s.id === subcontractorId)?.companyName ?? 'Unknown subcontractor'
  }
  if (crewId) {
    return data.crews.find((c) => c.id === crewId)?.name ?? 'Unknown crew'
  }
  return 'Unassigned'
}

/** Every crew this employee belongs to in any capacity — their own
 *  defaultCrewId, any crew they foreman, or any crew whose active member
 *  roster lists them. An employee can be a foreman without ever having
 *  defaultCrewId set (foreman/member status and "my default crew" are
 *  independently-editable fields, not kept in sync) — code that only
 *  checked defaultCrewId used to silently treat a foreman as belonging to
 *  no crew at all, hiding prints/projects assigned to their own crew from
 *  them. Use this instead of reading defaultCrewId directly anywhere
 *  "which crew is this session" matters (print visibility, project
 *  visibility, etc.). */
export function employeeCrewIds(data: AppData, employeeId: string | null): Set<string> {
  if (!employeeId) return new Set()
  const employee = data.employees.find((e) => e.id === employeeId)
  if (!employee) return new Set()
  const ids = new Set<string>()
  if (employee.defaultCrewId) ids.add(employee.defaultCrewId)
  for (const crew of data.crews) {
    if (crew.foremanId === employee.id) ids.add(crew.id)
    if (crew.members.some((m) => m.employeeId === employee.id && m.active)) ids.add(crew.id)
  }
  return ids
}

/** Options for the Add Work "Crew" picker. Role-aware: a subcontractor
 *  session collapses to just that one company's own entry — they should
 *  never see another subcontractor's name or the internal crew roster,
 *  matching the isolation principle already applied to the Subcontractor
 *  Dashboard. Admin/field sessions see the full combined list. */
export function crewOrSubSelectorOptions(
  data: AppData,
  role: AppRole,
  activeSubcontractorId: string | null,
): CrewOrSubOption[] {
  if (role === 'subcontractor') {
    if (!activeSubcontractorId) return []
    const sub = (data.subcontractors ?? []).find((s) => s.id === activeSubcontractorId)
    return sub ? [{ id: sub.id, name: sub.companyName, kind: 'subcontractor' }] : []
  }
  return listCrewsAndSubcontractors(data)
}
