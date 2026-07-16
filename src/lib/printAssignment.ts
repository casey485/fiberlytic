// ---------------------------------------------------------------------------
// Which crew/subcontractor a print (ProjectFile) is earmarked for, and
// whether a given session should see it at all — same "hidden unless it's
// yours" shape as markupNav.ts's isWorkHiddenFromSession, one level up (a
// whole document instead of one redline). Assignment is set from the
// Project tab (ProjectDetail.tsx), not from Map Cuts or the Field Map.
// ---------------------------------------------------------------------------

import type { ProjectFile, MapCutPackage } from '../types'
import type { AppRole } from '../store/RoleContext'

/** A piece's own assignment if it has one; otherwise inherited from the
 *  MapCutPackage that generated it (its "phase" default); otherwise
 *  unassigned. A plain uploaded PDF (no sourceMapCutPackageId) only ever has
 *  its own direct assignment — there's no package to inherit from. */
export function effectivePrintAssignment(
  file: ProjectFile,
  packages: MapCutPackage[],
): { crewId: string | null; subcontractorId: string | null } {
  if (file.assignedCrewId || file.assignedSubcontractorId) {
    return { crewId: file.assignedCrewId ?? null, subcontractorId: file.assignedSubcontractorId ?? null }
  }
  const pkg = file.sourceMapCutPackageId ? packages.find((p) => p.id === file.sourceMapCutPackageId) : null
  return { crewId: pkg?.defaultAssignedCrewId ?? null, subcontractorId: pkg?.defaultAssignedSubcontractorId ?? null }
}

/** Unassigned prints stay visible to everyone — assignment only narrows
 *  visibility once something is actually set, it's never a default-deny.
 *  A subcontractor session only ever sees prints assigned to them
 *  specifically (mirrors isWorkHiddenFromSession's redline rule exactly).
 *  A field/in-house session sees every unassigned or own-crew print, but
 *  never anything earmarked for a subcontractor. Admin/supervisor always
 *  see everything.
 *
 *  One exception to "unassigned stays visible": once a print has genuinely
 *  been cut into phases — at least one MapCutPackage sourced from it has
 *  actually produced real output (outputProjectFileId set) — the original/
 *  master file itself is never unassigned in any meaningful sense;
 *  assignment always lands on the phase *pieces*, never on the master (see
 *  effectivePrintAssignment; a master's own effective assignment is always
 *  null since it has no sourceMapCutPackageId to inherit from). Without
 *  this, a field/subcontractor session sees the whole uncut master AND
 *  their assigned piece — defeating the point of splitting it into phases
 *  in the first place. Field/subcontractor sessions only ever work off
 *  their assigned piece; the master stays admin/supervisor-only once it's
 *  been phased.
 *
 *  Deliberately requires outputProjectFileId, not just a MapCutPackage
 *  existing — opening the Map Cuts tool against a file (e.g. the scissors
 *  icon on Project Files, including on a phase's own already-generated
 *  file) creates a package immediately, before anything is drawn or
 *  generated. Hiding on package-existence alone meant merely opening the
 *  tool against an already-assigned phase's file — without ever generating
 *  anything — silently hid that phase from every subcontractor/field
 *  session, while Project Detail (admin-only, never gated by this rule)
 *  kept showing it as correctly assigned — a real, reported bug. */
export function isPrintHiddenFromSession(
  file: ProjectFile,
  packages: MapCutPackage[],
  role: AppRole,
  activeSubcontractorId: string | null,
  activeCrewIds: Set<string>,
): boolean {
  if (role === 'admin' || role === 'supervisor') return false
  if ((role === 'field' || role === 'subcontractor') && packages.some((p) => p.sourceProjectFileId === file.id && p.outputProjectFileId)) return true
  const eff = effectivePrintAssignment(file, packages)
  if (role === 'subcontractor') return eff.subcontractorId !== activeSubcontractorId
  if (role === 'field') {
    if (eff.subcontractorId) return true
    if (eff.crewId) return !activeCrewIds.has(eff.crewId)
    return false
  }
  return false
}

/** True if this subcontractor is the effective assignee of at least one PDF
 *  print in this project — a direct file assignment, or inherited from a
 *  phase's MapCutPackage default (see effectivePrintAssignment). This is
 *  deliberately independent of Project.subcontractorIds (the explicit
 *  "Crew & Subcontractor Assignment" checklist on the Project page): an
 *  admin who cuts a print into phases and assigns one phase to a
 *  subcontractor from the Project Files table has, in every practical
 *  sense, assigned that subcontractor to the job — but that action doesn't
 *  touch Project.subcontractorIds. Without this check, the project simply
 *  never appears in that subcontractor's Field Maps list or dashboard
 *  until an admin *also* remembers the separate, easy-to-miss checklist
 *  step, even though the print itself is already correctly gated to them
 *  once they do reach it. Call this as an OR alongside the explicit
 *  subcontractorIds check everywhere a subcontractor's visible-projects
 *  list is built, so either route is sufficient. */
export function projectAssignedToSubcontractor(
  projectId: string,
  subcontractorId: string,
  files: ProjectFile[],
  packages: MapCutPackage[],
): boolean {
  return files.some((f) => f.projectId === projectId && f.fileType === 'pdf'
    && effectivePrintAssignment(f, packages).subcontractorId === subcontractorId)
}

/** Crew equivalent of projectAssignedToSubcontractor — a phase assigned to
 *  a crew (directly or via its MapCutPackage default) makes the project
 *  visible to that crew even if the crew was never added to
 *  Project.crewIds and no crew member's Employee.currentProjectId points
 *  here yet. Same rationale as above, kept symmetric with the
 *  subcontractor case per this file's existing field/subcontractor
 *  parity. */
export function projectAssignedToCrew(
  projectId: string,
  crewId: string,
  files: ProjectFile[],
  packages: MapCutPackage[],
): boolean {
  return files.some((f) => f.projectId === projectId && f.fileType === 'pdf'
    && effectivePrintAssignment(f, packages).crewId === crewId)
}
