// ---------------------------------------------------------------------------
// Shape/defaults for the "Download PDF" checkboxes — its own module (rather
// than living in FieldMapExportDialog.tsx) so non-component files (the two
// export renderers) can import it without pulling in a component export.
// ---------------------------------------------------------------------------

export interface FieldMapExportOptions {
  includeCallouts: boolean
  includePhotos: boolean
  includeLegend: boolean
  includeQuantities: boolean
  includeBillingCodes: boolean
  includeNotes: boolean
}

export const DEFAULT_EXPORT_OPTIONS: FieldMapExportOptions = {
  includeCallouts: true,
  includePhotos: false,
  includeLegend: true,
  includeQuantities: true,
  includeBillingCodes: true,
  includeNotes: false,
}
