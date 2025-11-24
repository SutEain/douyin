import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
})

// 类型定义
export interface Profile {
  id: string
  username: string | null
  nickname: string | null
  bio: string | null
  avatar_url: string | null
  cover_url: string | null
  tg_user_id: number | null
  tg_username: string | null
  auth_provider: string
  lang: string
  email_verified: boolean
  follower_count: number
  following_count: number
  total_likes: number
  video_count: number
  last_active_at: string
  created_at: string
  updated_at: string
}

export interface TelegramLoginResponse {
  user_id: string
  access_token: string
  refresh_token: string
  expires_in: number
  user: Profile
  need_bind_email: boolean
}
