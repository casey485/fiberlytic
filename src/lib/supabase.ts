// ---------------------------------------------------------------------------
// Main-app Supabase client — multi-tenant backend (Phase 1). Separate from
// src/features/printkmz/supabase.ts on purpose: that client is scoped to the
// printkmz feature's own tables and its own store, per that feature's
// documented independence from DataContext (see CLAUDE.md). This client is
// what AuthContext and DataContext's strangler-fig internals talk to.
//
// Degrades gracefully when unconfigured, same convention as src/lib/
// firebase.ts and printkmz/supabase.ts: the app keeps working off
// localStorage until VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are set.
// ---------------------------------------------------------------------------

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = !!(url && anonKey)

export const supabase: SupabaseClient | null = url && anonKey
  ? createClient(url, anonKey, {
      auth: {
        // Distinct storage key from printkmz's client (if that one is ever
        // configured too) — avoids the "Multiple GoTrueClient instances"
        // warning/collision from two clients sharing one localStorage slot.
        storageKey: 'fiberlytic-app-auth',
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null
