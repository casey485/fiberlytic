// ---------------------------------------------------------------------------
// Pure filtering logic for "Download PDF" — shared by both export paths
// (KmzMap's Leaflet snapshot and PdfPrintMode's paginated print export) so the
// scope/filter rules (entire project / current page / selected pages /
// selected redlines / date range / crew / work type / billing code) aren't
// duplicated between them.
// ---------------------------------------------------------------------------

import type { FieldMarkup, MarkupBilling, WorkObjectTypeId } from '../types'
import { localDateStr } from './format'

export interface ExportFilterCriteria {
  /** When set, only these markup ids are included (the "selected redlines only" scope). */
  redlineIds?: Set<string> | null
  /** When set, only markups whose sourceProjectFileId/pageIndex falls in this set
   *  are included (PdfPrintMode's "current page"/"selected pages" scope). Ignored
   *  by the Leaflet (KmzMap) export path, which has no page concept. */
  pageIndexes?: Set<number> | null
  dateFrom?: string | null
  dateTo?: string | null
  crewId?: string | null
  /** Mutually exclusive with crewId — the "Crew or Subcontractor" filter
   *  emits exactly one of the two, never both, same convention as
   *  FieldMarkup.assignedSubcontractorId elsewhere. */
  subcontractorId?: string | null
  workType?: WorkObjectTypeId | null
  /** Matched against any of the markup's billing lines' rateCode (case-insensitive substring). */
  billingCode?: string | null
}

export const EMPTY_EXPORT_CRITERIA: ExportFilterCriteria = {}

function workDateOf(m: FieldMarkup): string {
  return m.workDate ?? localDateStr(new Date(m.createdAt))
}

/** Every redline belongs in the export, whether or not it was ever run
 *  through Add Work — a plain hand-drawn line/shape with no workObjectType
 *  and no billing line is still a real redline someone drew on the map, and
 *  needs to show up in the Work Object Summary just as much as a fully
 *  billed one (buildReportRows/drawWorkObjectSummaryPage already fall back
 *  to the markup's tool/label when there's no Work Object type, so nothing
 *  downstream assumes one exists). Only soft-deleted markups are never
 *  candidates regardless of the criteria below. */
export function filterMarkupsForExport(
  markups: FieldMarkup[],
  billing: MarkupBilling[],
  criteria: ExportFilterCriteria,
): FieldMarkup[] {
  const billingByMarkup = new Map<string, MarkupBilling[]>()
  for (const b of billing) {
    if (!billingByMarkup.has(b.markupId)) billingByMarkup.set(b.markupId, [])
    billingByMarkup.get(b.markupId)!.push(b)
  }

  return markups.filter((m) => {
    if (m.deletedAt) return false
    if (criteria.redlineIds && !criteria.redlineIds.has(m.id)) return false
    if (criteria.pageIndexes && !criteria.pageIndexes.has(m.pageIndex ?? -1)) return false
    if (criteria.dateFrom && workDateOf(m) < criteria.dateFrom) return false
    if (criteria.dateTo && workDateOf(m) > criteria.dateTo) return false
    if (criteria.crewId && m.crewId !== criteria.crewId) return false
    if (criteria.subcontractorId && m.assignedSubcontractorId !== criteria.subcontractorId) return false
    if (criteria.workType && m.workObjectType !== criteria.workType) return false
    if (criteria.billingCode) {
      const lines = billingByMarkup.get(m.id) ?? []
      const needle = criteria.billingCode.toLowerCase()
      if (!lines.some((b) => b.rateCode.toLowerCase().includes(needle))) return false
    }
    return true
  })
}
