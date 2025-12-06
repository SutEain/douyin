import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

export const SUPABASE_URL =
  Deno.env.get('SB_URL') || Deno.env.get('SUPABASE_URL') || 'https://example.supabase.co'
export const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SB_SERVICE_ROLE_KEY') ||
  Deno.env.get('SB_SERVICE_KEY') ||
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  ''

export const TG_BOT_TOKEN = Deno.env.get('TG_BOT_TOKEN')
export const TG_FILE_PROXY_URL = Deno.env.get('TG_CDN_PROXY_URL') || Deno.env.get('TG_VIDEO_PROXY_URL')

export const DEFAULT_COVER =
  Deno.env.get('DEFAULT_VIDEO_COVER') ||
  'https://dummyimage.com/540x960/101010/ffffff.png&text=Video'
export const DEFAULT_AVATAR =
  Deno.env.get('DEFAULT_AVATAR_URL') ||
  'https://dummyimage.com/200x200/1f1f1f/ffffff.png&text=Avatar'

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

