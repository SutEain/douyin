import { supabase } from '@/utils/supabase'
import { getCurrentUser } from '@/api/auth'

export type ProfileUpdatePayload = {
  nickname?: string | null
  username?: string | null
  bio?: string | null
  avatar_url?: string | null
  cover_url?: string | null
  gender?: number | null
  birthday?: string | null
  country?: string | null
  province?: string | null
  city?: string | null
  lang?: string | null
}

export async function updateProfile(payload: ProfileUpdatePayload) {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('请先登录后再编辑资料')
  }

  // ✅ 安全加固：显式指定允许修改的字段（白名单机制）
  // 杜绝 payload 中包含 is_admin, balance_coins 等敏感字段的参数攻击
  const {
    nickname,
    username,
    bio,
    avatar_url,
    cover_url,
    gender,
    birthday,
    country,
    province,
    city,
    lang
  } = payload

  const safePayload = {
    nickname,
    username,
    bio,
    avatar_url,
    cover_url,
    gender,
    birthday,
    country,
    province,
    city,
    lang,
    updated_at: new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(safePayload)
    .eq('id', user.id)
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return data
}
