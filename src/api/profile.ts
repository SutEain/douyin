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

/**
 * 验证URL是否安全（防止XSS攻击）
 */
function validateImageUrl(url: string | null | undefined): string | null {
  if (!url) return null

  const urlLower = String(url).toLowerCase().trim()

  // 🚨 禁止危险协议
  if (
    urlLower.startsWith('javascript:') ||
    urlLower.startsWith('file://') ||
    (urlLower.startsWith('data:') && !urlLower.startsWith('data:image/'))
  ) {
    throw new Error('头像URL包含不安全的协议，已拒绝')
  }

  // 只允许 http://、https:// 或安全的 data:image/ URL
  if (
    urlLower.startsWith('http://') ||
    urlLower.startsWith('https://') ||
    (urlLower.startsWith('data:image/') &&
      [
        'data:image/png',
        'data:image/jpeg',
        'data:image/jpg',
        'data:image/gif',
        'data:image/webp'
      ].some((type) => urlLower.startsWith(type)))
  ) {
    return url
  }

  // 允许相对路径
  if (url.startsWith('/') || url.includes('assets/img')) {
    return url
  }

  throw new Error('头像URL格式不正确')
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

  // 🚨 安全验证：验证头像和封面URL的安全性（防止XSS攻击）
  let safeAvatarUrl: string | null = null
  let safeCoverUrl: string | null = null

  if (avatar_url !== undefined) {
    safeAvatarUrl = validateImageUrl(avatar_url)
  }

  if (cover_url !== undefined) {
    safeCoverUrl = validateImageUrl(cover_url)
  }

  const safePayload = {
    nickname,
    username,
    bio,
    avatar_url: safeAvatarUrl,
    cover_url: safeCoverUrl,
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
