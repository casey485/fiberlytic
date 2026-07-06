// ---------------------------------------------------------------------------
// Remembers where the user last dragged a Work Object's (or manual callout's)
// callout box to, per markup, across reloads. Deliberately its own tiny
// localStorage store rather than part of AppData/DataContext — this is
// view-state, not domain data (same reasoning as workObjectPanelPosition.ts).
// Shared by both KmzMap.tsx (Leaflet) and PdfPrintMode.tsx — a markup's callout
// is the same logical box regardless of which page rendered it last.
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

export function getSavedCalloutOffset(markupId: string): { offsetX: number; offsetY: number } | null {
  return readStore()[markupId] ?? null
}

export function saveCalloutOffset(markupId: string, offset: { offsetX: number; offsetY: number }) {
  const store = readStore()
  store[markupId] = offset
  writeStore(store)
}
