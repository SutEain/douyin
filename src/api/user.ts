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

// 🎯 可重试的错误类型
const RETRYABLE_ERRORS = [
  'Failed to fetch',
  'fetch failed',
  'NetworkError',
  'Network error',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'timeout',
  'AbortError'
]

// 🎯 判断错误是否可重试
function isRetryableError(error: any): boolean {
  if (!error) return false
  const errorMsg = error.message || error.toString() || ''
  const errorName = error.name || ''
  return (
    RETRYABLE_ERRORS.some((e) => errorMsg.includes(e)) ||
    RETRYABLE_ERRORS.some((e) => errorName.includes(e)) ||
    (error.status >= 500 && error.status < 600) || // 5xx 服务器错误
    error.status === 429 // 限流错误
  )
}

async function requestAppServer(
  path: string,
  method: string = 'GET',
  body?: any,
  retryCount = 0
): Promise<{ success: boolean; data?: any; message?: string }> {
  const maxRetries = 2 // 默认重试2次（总共3次尝试）
  const url = `${getAppServerBase()}${path}`
  const accessToken = await resolveAccessToken(true)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
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

  // 🎯 添加超时控制
  const controller = new AbortController()
  const timeoutMs = 20000 + retryCount * 5000 // 递增超时时间：20s, 25s, 30s
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  let resp: Response
  try {
    resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })
    clearTimeout(timeoutId)
  } catch (error: any) {
    clearTimeout(timeoutId)

    // 🎯 如果是可重试的错误且还有重试次数，进行重试
    if (isRetryableError(error) && retryCount < maxRetries) {
      const delay = (retryCount + 1) * 1000 // 递增延迟：1s, 2s
      console.warn(
        `[requestAppServer] 请求失败，${delay}ms 后重试 (${retryCount + 1}/${maxRetries}):`,
        error.message || error
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
      return requestAppServer(path, method, body, retryCount + 1)
    }

    // 不可重试或重试次数用完，返回错误
    if (error.name === 'AbortError') {
      return { success: false, message: '请求超时，请检查网络连接' }
    }
    // 🎯 处理网络错误（Failed to fetch 等）
    if (error.message?.includes('Failed to fetch') || error.message?.includes('fetch failed')) {
      return { success: false, message: '网络连接失败，请检查网络或 VPN 设置' }
    }
    // 其他网络错误
    return { success: false, message: error.message || '网络错误，请稍后重试' }
  }

  // 🎯 处理响应解析错误
  let payload: any
  try {
    const text = await resp.text()
    if (!text) {
      if (resp.status >= 500 && retryCount < maxRetries) {
        const delay = (retryCount + 1) * 1000
        console.warn(
          `[requestAppServer] 服务器错误 ${resp.status}，${delay}ms 后重试 (${retryCount + 1}/${maxRetries})`
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
        return requestAppServer(path, method, body, retryCount + 1)
      }
      return { success: false, message: '服务器返回空响应' }
    }
    payload = JSON.parse(text)
  } catch (parseError: any) {
    // JSON 解析失败
    if (resp.status >= 500 && retryCount < maxRetries) {
      const delay = (retryCount + 1) * 1000
      console.warn(
        `[requestAppServer] 服务器错误 ${resp.status}，${delay}ms 后重试 (${retryCount + 1}/${maxRetries})`
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
      return requestAppServer(path, method, body, retryCount + 1)
    }
    if (resp.status >= 500) {
      return { success: false, message: '服务器错误，请稍后重试' }
    }
    if (resp.status === 404) {
      return { success: false, message: '接口不存在' }
    }
    if (resp.status === 401 || resp.status === 403) {
      return { success: false, message: '登录已过期，请重新登录' }
    }
    return { success: false, message: '服务器响应格式错误' }
  }

  // 🎯 处理业务错误（code !== 0）
  if (!resp.ok || payload.code !== 0) {
    // 5xx 或限流错误可以重试
    if ((resp.status >= 500 || resp.status === 429) && retryCount < maxRetries) {
      const delay = (retryCount + 1) * 1000
      console.warn(
        `[requestAppServer] 服务器错误 ${resp.status}，${delay}ms 后重试 (${retryCount + 1}/${maxRetries})`
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
      return requestAppServer(path, method, body, retryCount + 1)
    }
    return { success: false, message: payload?.msg || '操作失败' }
  }

  return { success: true, data: payload.data }
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

  const headers: Record<string, string> = {
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  }
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
