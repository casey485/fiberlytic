// ---------------------------------------------------------------------------
// Joins every field-submitted record (photos, videos, inspections,
// attachments) back to the Work Object (FieldMarkup) and project they belong
// to. None of those record types carry projectId directly — only markupId —
// so this is the one place that does the markupId -> FieldMarkup -> projectId
// join, shared by the Documentation browse page and the Closeout Package
// export so the two can never disagree about what's included.
// ---------------------------------------------------------------------------

import type { AppData, FieldMarkup, MarkupPhoto, MarkupVideo, MarkupInspection, MarkupAttachment, Photo, MarkupStatus, WorkObjectTypeId } from '../types'

export interface WorkObjectDocBundle {
  markup: FieldMarkup
  photos: MarkupPhoto[]
  videos: MarkupVideo[]
  inspections: MarkupInspection[]
  attachments: MarkupAttachment[]
}

export interface ProjectDocumentation {
  workObjects: WorkObjectDocBundle[]
  /** Project-level Photo[] (before/progress/after/issue/safety gallery) — a
   *  separate system from MarkupPhoto, not tied to any one Work Object (e.g.
   *  a site overview shot). See Photos.tsx. */
  generalPhotos: Photo[]
}

/** Builds the full, unfiltered documentation set for one project. Always
 *  excludes soft-deleted markups (deletedAt set) — every other reader of
 *  fieldMarkups in the app follows this same rule, and a closeout package
 *  or browse view is exactly the place a deleted redline's leftover photos
 *  must NOT resurface. */
export function buildProjectDocumentation(data: AppData, projectId: string): ProjectDocumentation {
  const markups = (data.fieldMarkups ?? []).filter((m) => m.projectId === projectId && !m.deletedAt)
  const markupIds = new Set(markups.map((m) => m.id))

  const photosByMarkup = new Map<string, MarkupPhoto[]>()
  for (const p of data.markupPhotos ?? []) {
    if (!markupIds.has(p.markupId)) continue
    const arr = photosByMarkup.get(p.markupId) ?? []
    arr.push(p)
    photosByMarkup.set(p.markupId, arr)
  }
  const videosByMarkup = new Map<string, MarkupVideo[]>()
  for (const v of data.markupVideos ?? []) {
    if (!markupIds.has(v.markupId)) continue
    const arr = videosByMarkup.get(v.markupId) ?? []
    arr.push(v)
    videosByMarkup.set(v.markupId, arr)
  }
  const inspectionsByMarkup = new Map<string, MarkupInspection[]>()
  for (const i of data.markupInspections ?? []) {
    if (!markupIds.has(i.markupId)) continue
    const arr = inspectionsByMarkup.get(i.markupId) ?? []
    arr.push(i)
    inspectionsByMarkup.set(i.markupId, arr)
  }
  const attachmentsByMarkup = new Map<string, MarkupAttachment[]>()
  for (const a of data.markupAttachments ?? []) {
    if (!markupIds.has(a.markupId)) continue
    const arr = attachmentsByMarkup.get(a.markupId) ?? []
    arr.push(a)
    attachmentsByMarkup.set(a.markupId, arr)
  }

  const workObjects: WorkObjectDocBundle[] = markups.map((markup) => ({
    markup,
    photos: photosByMarkup.get(markup.id) ?? [],
    videos: videosByMarkup.get(markup.id) ?? [],
    inspections: inspectionsByMarkup.get(markup.id) ?? [],
    attachments: attachmentsByMarkup.get(markup.id) ?? [],
  }))

  const generalPhotos = (data.photos ?? []).filter((p) => p.projectId === projectId)

  return { workObjects, generalPhotos }
}

export interface DocFilterCriteria {
  crewId: string | null
  subcontractorId: string | null
  workType: WorkObjectTypeId | null
  status: MarkupStatus | null
  dateFrom: string | null
  dateTo: string | null
}

export const EMPTY_DOC_FILTERS: DocFilterCriteria = {
  crewId: null, subcontractorId: null, workType: null, status: null, dateFrom: null, dateTo: null,
}

/** workDate falls back to the record's creation date — matches how the rest
 *  of the app treats an unset workDate (see FieldMarkup.workDate's own doc
 *  comment), so date-range filtering doesn't just silently drop older
 *  records that predate the workDate field. */
function effectiveWorkDate(m: FieldMarkup): string {
  return m.workDate ?? m.createdAt.slice(0, 10)
}

export function filterWorkObjects(workObjects: WorkObjectDocBundle[], criteria: DocFilterCriteria): WorkObjectDocBundle[] {
  return workObjects.filter(({ markup: m }) => {
    if (criteria.crewId && m.crewId !== criteria.crewId) return false
    if (criteria.subcontractorId && m.assignedSubcontractorId !== criteria.subcontractorId) return false
    if (criteria.workType && m.workObjectType !== criteria.workType) return false
    if (criteria.status && m.status !== criteria.status) return false
    const wd = effectiveWorkDate(m)
    if (criteria.dateFrom && wd < criteria.dateFrom) return false
    if (criteria.dateTo && wd > criteria.dateTo) return false
    return true
  })
}
