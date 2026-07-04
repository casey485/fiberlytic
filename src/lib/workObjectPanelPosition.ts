// ---------------------------------------------------------------------------
// Remembers where the user last dragged a Work Object's floating properties
// panel to, per markup, across reloads. Deliberately its own tiny localStorage
// store rather than part of AppData/DataContext — this is view-state, not
// domain data (same reasoning as src/features/printkmz/store.ts). Simpler than
// that precedent's full subscribe/emit machinery: only one panel is ever
// mounted at a time, so there's no concurrent-consumer scenario to justify it.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'fiberlytic:workObjectPanelPos:v1'

type PositionStore = Record<string, { x: number; y: number }>

function readStore(): PositionStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeStore(store: PositionStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // storage full/unavailable — non-fatal, position just won't persist
  }
}

export function getSavedPanelPosition(markupId: string): { x: number; y: number } | null {
  return readStore()[markupId] ?? null
}

export function savePanelPosition(markupId: string, pos: { x: number; y: number }) {
  const store = readStore()
  store[markupId] = pos
  writeStore(store)
}
