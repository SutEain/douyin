import { request } from '@/utils/request'
import { myVideo } from '@/api/videos'
import { supabase } from '@/utils/supabase'

export function userinfo(params?: any, data?: any) {
  return request({ url: '/user/userinfo', method: 'get', params, data })
}

export function userVideoList(params?: any) {
  return myVideo(params)
}

export function panel(params?: any, data?: any) {
  return request({ url: '/user/panel', method: 'get', params, data })
}

export function friends(params?: any, data?: any) {
  return request({ url: '/user/friends', method: 'get', params, data })
}

export function userCollect(params?: any, data?: any) {
  return request({ url: '/user/collect', method: 'get', params, data })
}

export function recommendedPost(params?: any) {
  // ✅ 图文（壁纸）页：走 app-server，返回 note_card 结构（不再依赖 /imgs 的 mock 接口）
  return requestAppServerList('/post/recommended', params)
}

export function recommendedShop(params?: any, data?: any) {
  return request({ url: '/shop/recommended', method: 'get', params, data })
}

/**
 * 🎯 用户签到
 */
export async function checkIn() {
  return requestAppServer('/user/checkin', 'POST')
}

// ===== app-server 调用（与 videos.ts 保持一致的最小实现）=====
function getAppServerBase() {
  const explicit = import.meta.env.VITE_APP_SERVER_URL
  if (explicit) return explicit.replace(/\/$/, '')
  if (import.meta.env.DEV) return '/api/app-server'
  if (import.meta.env.VITE_SUPABASE_URL) {
    return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/app-server`
  }
  throw new Error('Missing VITE_APP_SERVER_URL configuration')
}

async function resolveAccessToken(required: boolean) {
  const {
    data: { session }
  } = await supabase.auth.getSession()
  const token = session?.access_token ?? null
  if (!token && required) throw new Error('请先在 Telegram 中登录')
  return token
}

async function requestAppServer(path: string, method: string = 'GET', body?: any) {
  const url = `${getAppServerBase()}${path}`
  const accessToken = await resolveAccessToken(true)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`
  }

  // Telegram initData
  try {
    // @ts-ignore
    const tgWebApp = window.Telegram?.WebApp
    if (tgWebApp && tgWebApp.initData) {
      headers['X-Telegram-Init-Data'] = tgWebApp.initData
    }
  } catch {
    // ignore
  }

  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })

  const payload = await resp.json()
  if (resp.ok && payload?.code === 0) {
    return { success: true, data: payload.data }
  }
  return { success: false, message: payload?.msg || '操作失败' }
}

async function requestAppServerList(path: string, params?: any) {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue
    search.set(k, String(v))
  }
  const url = `${getAppServerBase()}${path}${search.toString() ? `?${search.toString()}` : ''}`

  let accessToken: string | null = null
  // 图文推荐：允许未登录，但如果登录了就带上（方便未来扩展）
  try {
    accessToken = await resolveAccessToken(false)
  } catch {
    accessToken = null
  }

  const headers: Record<string, string> = {}
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  // Telegram initData（可选）
  try {
    // @ts-ignore
    const tgWebApp = window.Telegram?.WebApp
    if (tgWebApp && tgWebApp.initData) {
      headers['X-Telegram-Init-Data'] = tgWebApp.initData
    }
  } catch {
    // ignore
  }

  const resp = await fetch(url, { method: 'GET', headers })
  const payload = await resp.json()
  if (resp.ok && payload?.code === 0) {
    return { success: true, data: payload.data }
  }
  return { success: false, data: { list: [], total: 0 }, message: payload?.msg || '查询失败' }
}

// 获取关注列表
export async function getFollowingList() {
  const { data: session } = await supabase.auth.getSession()
  if (!session?.session?.user) {
    return { success: false, message: '未登录', data: { list: [], total: 0 } }
  }

  const { data, error } = await supabase
    .from('follows')
    .select(
      `
      followee_id,
      created_at,
      profiles:followee_id (
        id,
        nickname,
        username,
        avatar_url,
        bio
      )
    `
    )
    .eq('follower_id', session.session.user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getFollowingList] Error:', error)
    return { success: false, message: error.message, data: { list: [], total: 0 } }
  }

  const list = (data || []).map((item: any) => ({
    user_id: item.profiles?.id,
    nickname: item.profiles?.nickname || item.profiles?.username || '用户',
    unique_id: item.profiles?.username || '',
    avatar: item.profiles?.avatar_url || '',
    signature: item.profiles?.bio || '',
    followed_at: item.created_at
  }))

  return { success: true, data: { list, total: list.length } }
}

// 获取粉丝列表
export async function getFollowersList() {
  const { data: session } = await supabase.auth.getSession()
  if (!session?.session?.user) {
    return { success: false, message: '未登录', data: { list: [], total: 0 } }
  }

  const { data, error } = await supabase
    .from('follows')
    .select(
      `
      follower_id,
      created_at,
      profiles:follower_id (
        id,
        nickname,
        username,
        avatar_url,
        bio
      )
    `
    )
    .eq('followee_id', session.session.user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getFollowersList] Error:', error)
    return { success: false, message: error.message, data: { list: [], total: 0 } }
  }

  const list = (data || []).map((item: any) => ({
    user_id: item.profiles?.id,
    nickname: item.profiles?.nickname || item.profiles?.username || '用户',
    unique_id: item.profiles?.username || '',
    avatar: item.profiles?.avatar_url || '',
    signature: item.profiles?.bio || '',
    followed_at: item.created_at
  }))

  return { success: true, data: { list, total: list.length } }
}

/**
 * 获取任务中心数据（包含所有规则和当前用户进度）
 */
export async function getTasks() {
  const {
    data: { session }
  } = await supabase.auth.getSession()
  if (!session?.user) {
    return { success: false, message: '未登录', data: [] }
  }

  // 并行获取规则和进度
  const [rulesRes, progressRes] = await Promise.all([
    supabase
      .from('incentive_rules')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    supabase.from('user_incentive_progress').select('*').eq('user_id', session.user.id)
  ])

  if (rulesRes.error) return { success: false, message: rulesRes.error.message, data: [] }

  const progressMap = new Map((progressRes.data || []).map((p) => [p.rule_id, p]))

  const list = (rulesRes.data || []).map((rule) => {
    const progress = progressMap.get(rule.id)
    return {
      ...rule,
      current_progress: progress?.progress_value || 0,
      total_claims: progress?.cap_used || 0
    }
  })

  return { success: true, data: list }
}
