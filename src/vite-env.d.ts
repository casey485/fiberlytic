/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Optional default map center as "lng,lat". Falls back to a US Midwest point. */
  readonly VITE_DEFAULT_CENTER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
