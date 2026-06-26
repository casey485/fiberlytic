import { useSyncExternalStore } from 'react'
import type { DetectedObject, PrintSession } from './types'
import { saveSession } from './supabase'

const STORAGE_KEY = 'fiberlytic:printkmz:v1'

interface State {
  sessions: PrintSession[]
}

/**
 * Full-resolution page images are large (multiple MB) so they are NOT persisted —
 * they live here only for the current tab. Thumbnails on the session ARE persisted.
 */
export const pageImageCache = new Map<string, string[]>()

let state: State = load()
const listeners = new Set<() => void>()

/**
 * A session is only usable if it matches the CURRENT shape. Sessions saved by an
 * older build (e.g. before cover/legend existed) are dropped on load so the UI
 * can't crash reading fields that aren't there.
 */
function isValidSession(s: unknown): s is PrintSession {
  if (!s || typeof s !== 'object') return false
  const o = s as Record<string, unknown>
  const extraction = o.extraction as Record<string, unknown> | undefined
  const legend = o.legend as Record<string, unknown> | undefined
  const center = o.center as Record<string, unknown> | undefined
  return (
    typeof o.id === 'string' &&
    !!extraction &&
    !!extraction.cover &&
    typeof extraction.cover === 'object' &&
    !!legend &&
    Array.isArray(legend.rules) &&
    Array.isArray(o.objects) &&
    Array.isArray(o.thumbnails) &&
    !!center &&
    typeof center.lng === 'number'
  )
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<State>
      const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions.filter(isValidSession) : []
      return { sessions }
    }
  } catch {
    /* ignore corrupt storage */
  }
  return { sessions: [] }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* storage full — non-fatal for a prototype */
  }
}

function emit() {
  persist()
  for (const l of listeners) l()
}

function setState(next: State) {
  state = next
  emit()
}

function patchSession(id: string, fn: (s: PrintSession) => PrintSession) {
  setState({ ...state, sessions: state.sessions.map((s) => (s.id === id ? fn(s) : s)) })
}

// --- Actions -----------------------------------------------------------------

export const printStore = {
  getSessions: () => state.sessions,
  getSession: (id: string) => state.sessions.find((s) => s.id === id),

  createSession(session: PrintSession, fullPageImages?: string[]) {
    if (fullPageImages) pageImageCache.set(session.id, fullPageImages)
    setState({ ...state, sessions: [session, ...state.sessions] })
  },

  deleteSession(id: string) {
    pageImageCache.delete(id)
    setState({ ...state, sessions: state.sessions.filter((s) => s.id !== id) })
  },

  updateSession(id: string, patch: Partial<PrintSession>) {
    patchSession(id, (s) => ({ ...s, ...patch }))
  },

  setObjects(sessionId: string, objects: DetectedObject[]) {
    patchSession(sessionId, (s) => ({ ...s, objects }))
  },

  addObject(sessionId: string, object: DetectedObject) {
    patchSession(sessionId, (s) => ({ ...s, objects: [...s.objects, object] }))
  },

  updateObject(sessionId: string, objectId: string, patch: Partial<DetectedObject>) {
    patchSession(sessionId, (s) => ({
      ...s,
      objects: s.objects.map((o) =>
        o.id === objectId ? { ...o, ...patch, updatedAt: new Date().toISOString() } : o,
      ),
    }))
  },

  deleteObject(sessionId: string, objectId: string) {
    patchSession(sessionId, (s) => ({ ...s, objects: s.objects.filter((o) => o.id !== objectId) }))
  },

  /** Persist to Supabase (or no-op offline). Always returns a result. */
  save(sessionId: string) {
    const session = state.sessions.find((s) => s.id === sessionId)
    if (!session) return Promise.resolve({ ok: false, offline: false, count: 0, error: 'session not found' })
    return saveSession(session)
  },
}

// --- React binding -----------------------------------------------------------

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function usePrintSessions() {
  return useSyncExternalStore(subscribe, () => state.sessions)
}

export function usePrintSession(id: string | undefined) {
  return useSyncExternalStore(subscribe, () => (id ? state.sessions.find((s) => s.id === id) : undefined))
}
