// ---------------------------------------------------------------------------
// Shared photo-library row model + filters — normalizes the two independent
// photo systems (general project gallery `Photo` and Field-Map-redline
// `MarkupPhoto`) into one row shape, joined with project/crew/employee/
// subcontractor/markup, so the Photos page can browse, group, and filter
// both as a single library without merging their underlying data models.
// Mirrors the buildXRows + XFilterState + applyXFilters pattern already
// established by qaReview.ts.
// ---------------------------------------------------------------------------

import type { AppData, FieldMarkup, MarkupPhoto, Photo, Project, QaStatus, WorkObjectTypeId } from '../types'
import { WORK_OBJECT_TYPES } from './workObjectTypes'
import { worstQaStatus } from './analytics'
import { crewOrSubName } from './crewOrSub'

export type PhotoFolder = 'underground' | 'splicing' | 'aerial' | 'qaqc' | 'general'

export const PHOTO_FOLDER_LABELS: Record<PhotoFolder, string> = {
  underground: 'Underground',
  splicing: 'Splicing',
  aerial: 'Aerial',
  qaqc: 'QAQC',
  general: 'General',
}

const WORK_OBJECT_LABEL: Record<string, string> = Object.fromEntries(WORK_OBJECT_TYPES.map((w) => [w.id, w.label]))
export function workObjectTypeLabel(id: WorkObjectTypeId | null | undefined): string | null {
  return id ? (WORK_OBJECT_LABEL[id] ?? id) : null
}

/** Folder a photo belongs to, derived at read time from its source markup —
 *  'qa_qc' work objects always sort to QAQC regardless of workType; anything
 *  with no resolvable markup (a plain manual upload) falls to General. */
export function derivePhotoFolder(markup: FieldMarkup | undefined | null): PhotoFolder {
  if (!markup) return 'general'
  if (markup.workObjectType === 'qa_qc') return 'qaqc'
  if (markup.workType === 'underground' || markup.workType === 'aerial' || markup.workType === 'splicing') return markup.workType
  return 'general'
}

export interface PhotoLibraryRow {
  id: string
  kind: 'photo' | 'markupPhoto'
  url: string
  caption: string | null
  capturedAt: string | null
  project: Project | undefined
  folder: PhotoFolder
  workOrderId: string | null
  workType: string | null
  workObjectType: WorkObjectTypeId | null
  crewOrSubName: string
  employeeName: string | null
  lat: number | null
  lng: number | null
  qaStatus: QaStatus | null
  markupId: string | null
  markup: FieldMarkup | null
  productionEntryId: string | null
  clientId: string | null
  raw: Photo | MarkupPhoto
}

function employeeName(data: AppData, employeeId: string | null | undefined): string | null {
  if (!employeeId) return null
  return data.employees.find((e) => e.id === employeeId)?.name ?? null
}

/** QA status for a markup — the worst status among its billing lines, or
 *  null when the markup has never entered the QA pipeline at all (rather
 *  than defaulting to 'approved', which would misleadingly badge every
 *  never-submitted redline as reviewed). */
function markupQaStatus(data: AppData, markupId: string): QaStatus | null {
  const lines = (data.markupBilling ?? []).filter((b) => b.markupId === markupId && b.qaStatus)
  if (lines.length === 0) return null
  return worstQaStatus(lines)
}

export function buildPhotoLibrary(data: AppData): PhotoLibraryRow[] {
  const rows: PhotoLibraryRow[] = []

  for (const p of data.photos ?? []) {
    const markup = p.markupId ? (data.fieldMarkups ?? []).find((m) => m.id === p.markupId && !m.deletedAt) ?? null : null
    const project = data.projects.find((pr) => pr.id === p.projectId)
    rows.push({
      id: p.id,
      kind: 'photo',
      url: p.url,
      caption: p.caption || null,
      capturedAt: p.capturedAt ?? (p.date ? `${p.date}T00:00:00` : null),
      project,
      folder: derivePhotoFolder(markup),
      workOrderId: p.workOrderId ?? markup?.workId ?? null,
      workType: p.workType ?? markup?.workType ?? null,
      workObjectType: p.workObjectType ?? markup?.workObjectType ?? null,
      crewOrSubName: crewOrSubName(data, p.crewId, p.subcontractorId),
      employeeName: employeeName(data, p.employeeId),
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      qaStatus: markup ? markupQaStatus(data, markup.id) : null,
      markupId: p.markupId ?? null,
      markup,
      productionEntryId: p.productionEntryId ?? null,
      clientId: project?.clientId ?? null,
      raw: p,
    })
  }

  for (const mp of data.markupPhotos ?? []) {
    const markup = (data.fieldMarkups ?? []).find((m) => m.id === mp.markupId && !m.deletedAt)
    if (!markup) continue // synthetic AerialPole markupIds (`alf:<runId>:<n>`) have no FieldMarkup — not project-attributable, excluded from the library
    const project = data.projects.find((pr) => pr.id === markup.projectId)
    rows.push({
      id: mp.id,
      kind: 'markupPhoto',
      url: `idb:mkp-${mp.id}`,
      caption: mp.caption,
      capturedAt: mp.takenAt,
      project,
      folder: derivePhotoFolder(markup),
      workOrderId: markup.workId ?? null,
      workType: markup.workType ?? null,
      workObjectType: markup.workObjectType ?? null,
      crewOrSubName: crewOrSubName(data, mp.crewId ?? markup.crewId, mp.subcontractorId ?? markup.assignedSubcontractorId),
      employeeName: employeeName(data, mp.employeeId ?? markup.createdBy),
      lat: mp.lat,
      lng: mp.lng,
      qaStatus: markupQaStatus(data, markup.id),
      markupId: markup.id,
      markup,
      productionEntryId: null,
      clientId: project?.clientId ?? null,
      raw: mp,
    })
  }

  return rows.sort((a, b) => (b.capturedAt ?? '').localeCompare(a.capturedAt ?? ''))
}

export interface PhotoFilterState {
  projectId: string
  clientId: string
  crewOrSubId: string
  employeeId: string
  dateFrom: string
  dateTo: string
  workType: string
  qaStatus: QaStatus | ''
  workObjectType: WorkObjectTypeId | ''
  hasGps: boolean
}

export const EMPTY_PHOTO_FILTERS: PhotoFilterState = {
  projectId: '', clientId: '', crewOrSubId: '', employeeId: '',
  dateFrom: '', dateTo: '', workType: '', qaStatus: '', workObjectType: '', hasGps: false,
}

export function photoFiltersActive(f: PhotoFilterState): boolean {
  return Object.values(f).some((v) => v !== '' && v !== false)
}

export function applyPhotoFilters(rows: PhotoLibraryRow[], f: PhotoFilterState): PhotoLibraryRow[] {
  return rows.filter((r) => {
    if (f.projectId && r.project?.id !== f.projectId) return false
    if (f.clientId && r.clientId !== f.clientId) return false
    if (f.crewOrSubId && (r.markup?.crewId ?? (r.raw as Photo).crewId) !== f.crewOrSubId
      && (r.markup?.assignedSubcontractorId ?? (r.raw as Photo).subcontractorId) !== f.crewOrSubId) return false
    if (f.employeeId && (r.markup?.createdBy ?? (r.raw as Photo).employeeId) !== f.employeeId) return false
    if (f.workType && r.workType !== f.workType) return false
    if (f.qaStatus && r.qaStatus !== f.qaStatus) return false
    if (f.workObjectType && r.workObjectType !== f.workObjectType) return false
    if (f.hasGps && (r.lat == null || r.lng == null)) return false
    const d = r.capturedAt?.slice(0, 10) ?? null
    if (f.dateFrom && d && d < f.dateFrom) return false
    if (f.dateTo && d && d > f.dateTo) return false
    return true
  })
}
