/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_SERVER_URL: string
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_TG_CDN_PROXY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
