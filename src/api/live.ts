import { supabase } from '../utils/supabase'

export interface LiveRoom {
  id: string
  title: string | null
  description?: string | null
  stream_url: string
  cover_url: string | null
  sort_order: number | null
  is_active: boolean
  updated_at: string | null
  is_self_hosted?: boolean
  anchor_id?: string
  anchor_info?: {
    nickname: string
    avatar_url: string
  }
}

function getAppServerBase() {
  const explicit = import.meta.env.VITE_APP_SERVER_URL
  if (explicit) {
    return explicit.replace(/\/$/, '')
  }

  if (import.meta.env.DEV) {
    return '/api/app-server'
  }

  if (import.meta.env.VITE_SUPABASE_URL) {
    return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/app-server`
  }

  throw new Error('Missing VITE_APP_SERVER_URL configuration')
}

async function resolveAccessToken() {
  const {
    data: { session }
  } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

/**
 * 获取混合直播列表（包括自建和后台转播）
 */
export async function fetchLiveRooms(): Promise<LiveRoom[]> {
  const headers: Record<string, string> = {}

  // 有 token 就带上（兼容后端未来加鉴权/限流）
  const accessToken = await resolveAccessToken()
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  // 添加 Telegram initData（用于后端解析深链接/埋点等）
  try {
    // @ts-ignore
    const tgWebApp = window.Telegram?.WebApp
    if (tgWebApp && tgWebApp.initData) {
      headers['X-Telegram-Init-Data'] = tgWebApp.initData
    }
  } catch {
    // ignore
  }

  const resp = await fetch(`${getAppServerBase()}/live/rooms`, { headers })
  const payload = await resp.json().catch(() => null)

  if (!resp.ok) {
    throw new Error(payload?.msg || `接口异常：${resp.status}`)
  }

  if (payload?.code !== 0) {
    throw new Error(payload?.msg || '加载失败')
  }

  const list = payload?.data?.list
  return Array.isArray(list) ? (list as LiveRoom[]) : []
}
