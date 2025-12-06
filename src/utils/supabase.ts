import { createClient } from '@supabase/supabase-js'

// 安全获取环境变量
const getEnv = (key: string) => {
  try {
    return import.meta.env[key]
  } catch (e) {
    console.error(`Error accessing env var ${key}:`, e)
    return undefined
  }
}

const supabaseUrl = getEnv('VITE_SUPABASE_URL')
const supabaseAnonKey = getEnv('VITE_SUPABASE_ANON_KEY')

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables')
  // 不抛出错误，而是创建一个虚构的 client 避免应用崩溃
  // 在实际调用时会失败，但至少 UI 能显示出来
}

export const supabase = createClient(supabaseUrl || 'https://example.supabase.co', supabaseAnonKey || 'anon-key', {
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
