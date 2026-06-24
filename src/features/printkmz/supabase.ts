import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DetectedObject, PrintSession } from './types'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null
export const isSupabaseConfigured = supabase !== null

/** Flatten a DetectedObject into the `print_objects` table row shape. */
function toRow(o: DetectedObject) {
  return {
    id: o.id,
    session_id: o.sessionId,
    type: o.type,
    label: o.label,
    status: o.status,
    lng: o.position.lng,
    lat: o.position.lat,
    path: o.path ?? null,
    feeder: o.feeder ?? null,
    section: o.section ?? null,
    fiber_count: o.fiberCount ?? null,
    footage: o.footage ?? null,
    span_length: o.spanLength ?? null,
    construction_method: o.constructionMethod,
    road_name: o.roadName ?? null,
    sheet: o.sheet ?? null,
    notes: o.notes ?? null,
    confidence: o.confidence,
    photos: o.photos,
    redlines: o.redlines,
    production_quantity: o.productionQuantity ?? null,
    billing_quantity: o.billingQuantity ?? null,
    crew_assignment: o.crewAssignment ?? null,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  }
}

export interface SaveResult {
  ok: boolean
  offline: boolean
  count: number
  error?: string
}

/**
 * Persist a session's objects to Supabase. When Supabase isn't configured this
 * is a no-op success flagged `offline: true` — the store still has everything in
 * localStorage, so the app keeps working.
 */
export async function saveSession(session: PrintSession): Promise<SaveResult> {
  if (!supabase) return { ok: true, offline: true, count: session.objects.length }

  try {
    await supabase.from('print_sessions').upsert({
      id: session.id,
      file_name: session.fileName,
      project_name: session.extraction.cover.projectName ?? null,
      city: session.extraction.cover.city ?? null,
      county: session.extraction.cover.county ?? null,
      state: session.extraction.cover.state ?? null,
      page_count: session.pageCount,
      center_lng: session.center.lng,
      center_lat: session.center.lat,
      extraction: session.extraction,
      legend: session.legend,
      created_at: session.createdAt,
    })

    const rows = session.objects.map(toRow)
    if (rows.length) {
      const { error } = await supabase.from('print_objects').upsert(rows)
      if (error) return { ok: false, offline: false, count: 0, error: error.message }
    }
    return { ok: true, offline: false, count: rows.length }
  } catch (e) {
    return { ok: false, offline: false, count: 0, error: e instanceof Error ? e.message : String(e) }
  }
}
