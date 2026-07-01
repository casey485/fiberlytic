// ---------------------------------------------------------------------------
// Offline sync queue for Work Object mutations. Modeled on
// features/printkmz/supabase.ts's degrade-gracefully pattern: there is no real
// sync target configured yet, so `flush()` drains the queue as a no-op success
// (same as saveSession() returning `{ ok: true, offline: true }` when Supabase
// isn't configured) rather than failing. Once a real backend exists, `onEntry`
// becomes a genuine network call and a failure there should leave the entry
// queued (bump `attempts`) instead of clearing it.
// ---------------------------------------------------------------------------

export type SyncEntity =
  | 'markup' | 'markupPhoto' | 'markupBilling' | 'markupVideo'
  | 'markupInspection' | 'markupAttachment' | 'fieldMapOverlay'
export type SyncOp = 'create' | 'update' | 'delete'

export interface SyncQueueEntry {
  id: string
  entity: SyncEntity
  /** The changed record's own id. */
  recordId: string
  /** The FieldMarkup this entry's sync status rolls up to (itself, for entity === 'markup'; null for 'fieldMapOverlay', which has no syncStatus field). */
  markupId: string | null
  op: SyncOp
  createdAt: string
  attempts: number
}

const QUEUE_KEY = 'fiberlytic:sync-queue:v1'
let seq = 0

function readQueue(): SyncQueueEntry[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeQueue(entries: SyncQueueEntry[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(entries)) } catch { /* blocked */ }
}

export function enqueue(entity: SyncEntity, recordId: string, markupId: string | null, op: SyncOp): void {
  const entries = readQueue()
  entries.push({
    id: `sq-${Date.now().toString(36)}-${(seq++).toString(36)}`,
    entity, recordId, markupId, op, createdAt: new Date().toISOString(), attempts: 0,
  })
  writeQueue(entries)
}

export function getQueue(): SyncQueueEntry[] {
  return readQueue()
}

export function getQueueLength(): number {
  return readQueue().length
}

export interface FlushResult {
  ok: boolean
  flushed: number
}

/** Drain the queue, handing each entry to `onEntry` so the caller can mark its record synced locally. */
export async function flush(onEntry: (entry: SyncQueueEntry) => void | Promise<void>): Promise<FlushResult> {
  const entries = readQueue()
  if (entries.length === 0) return { ok: true, flushed: 0 }
  for (const entry of entries) {
    await onEntry(entry)
  }
  writeQueue([])
  return { ok: true, flushed: entries.length }
}
