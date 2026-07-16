// ---------------------------------------------------------------------------
// Remembers where the user last dragged a Work Object's (or manual callout's)
// callout box to, per markup, across reloads. Deliberately its own tiny
// localStorage store rather than part of AppData/DataContext — this is
// view-state, not domain data (same reasoning as workObjectPanelPosition.ts).
// Shared by both KmzMap.tsx (Leaflet) and PdfPrintMode.tsx.
//
// Keyed by `${viewKey}:${markupId}`, NOT markupId alone — a Map Cut piece and
// its master print are two structurally different renderings of the same
// underlying page (a small cropped view vs. the full sheet), so a raw
// screen-pixel offset that looks right on one is frequently nowhere near the
// shape on the other (confirmed live: a callout dragged/offset while viewing
// a zoomed-in cut piece landed far from its redline when the same markup was
// then viewed on the master). Scoping the saved offset per rendered surface
// (PdfPrintMode passes its own fileId; KmzMap.tsx — one shared Leaflet canvas
// per project, no piece/master duality — passes a constant 'map') means each
// surface starts from the sane default offset the first time it renders that
// markup, instead of inheriting a position tuned for a completely different
// view.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'fiberlytic:calloutPosition:v1'

type OffsetStore = Record<string, { offsetX: number; offsetY: number }>

function readStore(): OffsetStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeStore(store: OffsetStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // storage full/unavailable — non-fatal, position just won't persist
  }
}

export function getSavedCalloutOffset(viewKey: string, markupId: string): { offsetX: number; offsetY: number } | null {
  return readStore()[`${viewKey}:${markupId}`] ?? null
}

export function saveCalloutOffset(viewKey: string, markupId: string, offset: { offsetX: number; offsetY: number }) {
  const store = readStore()
  store[`${viewKey}:${markupId}`] = offset
  writeStore(store)
}
