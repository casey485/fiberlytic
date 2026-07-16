import type { AppData } from '../types'
import { STORAGE_KEY } from '../store/DataContext'
import { triggerDownload } from './kmzExport'
import { localDateStr } from './format'

/**
 * Full app-data backup — everything EXCEPT file blobs (PDFs/KMZ/photos),
 * which live separately in IndexedDB (see lib/fileStore.ts) and aren't
 * included here; a device seeded from this backup still needs those
 * re-uploaded. Mirrors DataContext's own localStorage persistence shape
 * exactly, so the exported file can be dropped straight back into
 * localStorage on any device with no transformation.
 */
export function exportAllData(data: AppData): void {
  const slim = {
    ...data,
    projectFiles: data.projectFiles.map(({ dataUrl: _skip, ...rest }) => rest),
  }
  const json = JSON.stringify(slim, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const date = localDateStr()
  triggerDownload(blob, `fiberlytic-backup-${date}.json`)
}

export interface ImportResult {
  ok: boolean
  error?: string
}

/**
 * Overwrites THIS browser's entire stored dataset with the given backup
 * file's contents, then reloads so the app boots fresh from it — running
 * the exact same migrateData() pass a normal load does, so an older backup
 * still gets brought up to the current shape. Caller must confirm with the
 * user first: this fully replaces whatever's currently in this browser,
 * with no undo.
 */
export async function importAllData(file: File): Promise<ImportResult> {
  let text: string
  try {
    text = await file.text()
  } catch {
    return { ok: false, error: 'Could not read that file.' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' }
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as Record<string, unknown>).projects)) {
    return { ok: false, error: 'That file doesn\'t look like a Fiberlytic backup (missing "projects").' }
  }
  // Unlike the app's own normal-operation persistence effect (DataContext.tsx,
  // which quietly no-ops on a quota failure since it's writing the SAME data
  // that's already safely rendered on screen), a failure here must never be
  // silent: this write is the only thing standing between "your real data is
  // now showing" and the device's pre-existing placeholder data being left on
  // screen with no explanation. A large real dataset (years of production
  // history) can plausibly exceed a phone browser's localStorage quota, so
  // this is a real failure mode, not just defensive coding.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
  } catch {
    return {
      ok: false,
      error: 'This backup is too large for this browser to store (storage quota exceeded). Nothing was changed — this device still has whatever data it had before.',
    }
  }
  window.location.reload()
  return { ok: true }
}
