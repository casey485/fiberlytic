// ---------------------------------------------------------------------------
// Shape/defaults for the Closeout Package's "what's included" checkboxes —
// mirrors fieldMapExportOptions.ts's own module split (kept separate from
// the page component so closeoutExport.ts can import it without pulling in
// a component).
// ---------------------------------------------------------------------------

export interface CloseoutPackageOptions {
  /** A summary table of every included Work Object — id, type, crew/sub, date, status, quantity. */
  includeWorkObjectSummary: boolean
  /** Photos attached to each Work Object, grouped under it. */
  includePhotos: boolean
  /** The project-level Photo[] gallery (before/progress/after/issue/safety) — separate from Work Object photos. */
  includeGeneralPhotos: boolean
  /** Videos can't be embedded in a PDF — this lists filenames/captions only, with a note that the files themselves are in the in-app Documentation folder. Off by default since it's a list of names, not real content. */
  includeVideos: boolean
  /** Pass/fail inspection results per Work Object. */
  includeInspections: boolean
  /** Attachment filenames per Work Object (not embedded — arbitrary file types can't be embedded in a PDF). */
  includeAttachments: boolean
  /** Each Work Object's free-text notes. */
  includeNotes: boolean
}

export const DEFAULT_CLOSEOUT_OPTIONS: CloseoutPackageOptions = {
  includeWorkObjectSummary: true,
  includePhotos: true,
  includeGeneralPhotos: true,
  includeVideos: false,
  includeInspections: true,
  includeAttachments: false,
  includeNotes: true,
}
