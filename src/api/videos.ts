import { request } from '@/utils/request'
import { supabase } from '@/utils/supabase'

export function historyOther(params?: any, data?: any) {
  return request({ url: '/video/historyOther', method: 'get', params, data })
}

export function historyVideo(params?: any, data?: any) {
  return request({ url: '/video/history', method: 'get', params, data })
}

export function recommendedVideo(params?: any) {
  const pageSize = params?.pageSize ?? 10
  const start = params?.start ?? 0
  const pageNo = Math.floor(start / pageSize)

  // 🎯 深链接由后端自动处理（通过 Telegram initData）
  return requestSupabaseVideoList(
    `${getAppServerBase()}/video/feed`,
    { pageNo, pageSize },
    {
      requireAuth: false,
      includeAuthIfAvailable: true
    }
  )
}

export function recommendedLongVideo(params?: any) {
  const pageNo = params?.pageNo ?? 0
  const pageSize = params?.pageSize ?? 10
  return requestSupabaseVideoList(
    `${getAppServerBase()}/video/feed`,
    { pageNo, pageSize },
    { requireAuth: false, includeAuthIfAvailable: true }
  )
}

// 成人内容视频列表（仅 is_adult = true）
export function adultVideoFeed(params?: any) {
  const pageSize = params?.pageSize ?? 10
  const start = params?.start ?? 0
  const pageNo = Math.floor(start / pageSize)

  return requestSupabaseVideoList(
    `${getAppServerBase()}/video/adult-feed`,
    { pageNo, pageSize },
    { requireAuth: false, includeAuthIfAvailable: true }
  )
}

// 关注流视频列表（需要登录）
export function followingVideo(params?: any) {
  const pageSize = params?.pageSize ?? 10
  const start = params?.start ?? 0
  const pageNo = Math.floor(start / pageSize)

  return requestSupabaseVideoList(
    `${getAppServerBase()}/video/following`,
    { pageNo, pageSize },
    { requireAuth: true }
  )
}

export function myVideo(params?: any) {
  return requestSupabaseVideoList(`${getAppServerBase()}/video/my`, params, { requireAuth: true })
}

export function authorVideos(userId: string, params?: { pageNo?: number; pageSize?: number }) {
  return requestSupabaseVideoList(
    `${getAppServerBase()}/video/author`,
    { user_id: userId, ...params },
    { requireAuth: false, includeAuthIfAvailable: true }
  )
}

export function likeVideo(params?: any) {
  return requestSupabaseVideoList(`${getAppServerBase()}/video/likes`, params, {
    requireAuth: true
  })
}

export function collectedVideo(params?: any) {
  return requestSupabaseVideoList(`${getAppServerBase()}/video/collections`, params, {
    requireAuth: true
  })
}

export function privateVideo(params?: any, data?: any) {
  return request({ url: '/video/private', method: 'get', params, data })
}

export async function toggleVideoLike(videoId: string, liked: boolean) {
  return callAppServer('/video/like', { method: 'POST', body: { video_id: videoId, liked } })
}

export async function toggleVideoCollect(videoId: string, collected: boolean) {
  return callAppServer('/video/collect', {
    method: 'POST',
    body: { video_id: videoId, collected }
  })
}

export async function videoComments(params: {
  videoId: string
  pageNo?: number
  pageSize?: number
}) {
  try {
    const search = new URLSearchParams({
      video_id: params.videoId,
      pageNo: String(params.pageNo ?? 0),
      pageSize: String(params.pageSize ?? 20)
    })
    const data = await callAppServer(`/video/comments?${search.toString()}`, {
      method: 'GET',
      requireAuth: false,
      includeAuthIfAvailable: true
    })
    return { success: true, data: data?.list ?? data }
  } catch (error: any) {
    return { success: false, data: [], message: error?.message || '加载失败' }
  }
}

export async function sendVideoComment(videoId: string, content: string, replyTo?: string | null) {
  const body: any = { video_id: videoId, content }
  if (replyTo) {
    body.reply_to = replyTo
  }
  return callAppServer('/video/comments', {
    method: 'POST',
    body
  })
}

// 🎯 评论点赞/取消点赞
export async function toggleCommentLike(commentId: string, liked: boolean) {
  return callAppServer('/comment/like', {
    method: 'POST',
    body: { comment_id: commentId, liked }
  })
}

// 🎯 获取评论的回复列表
export async function getCommentReplies(commentId: string) {
  try {
    const data = await callAppServer(`/comment/replies?comment_id=${commentId}`, {
      method: 'GET',
      requireAuth: false,
      includeAuthIfAvailable: true
    })
    return { success: true, data: data?.list ?? [] }
  } catch (error: any) {
    console.error('[getCommentReplies] 请求失败:', error)
    return { success: false, message: error?.message || '获取回复失败' }
  }
}

export async function toggleFollowUser(targetId: string, follow: boolean) {
  return callAppServer('/user/follow', {
    method: 'POST',
    body: { target_id: targetId, follow }
  })
}

// 获取指定用户的详细信息
export async function getUserProfile(userId: string) {
  try {
    const data = await callAppServer(`/user/profile?user_id=${userId}`, {
      method: 'GET',
      requireAuth: false,
      includeAuthIfAvailable: true
    })
    return { success: true, data }
  } catch (error: any) {
    console.error('[getUserProfile] 请求失败:', error)
    return { success: false, message: error?.message || '获取用户信息失败' }
  }
}

// 🎯 根据 video_id 获取单个视频详情
export async function getVideoById(videoId: string) {
  try {
    const data = await callAppServer(`/video/detail?video_id=${videoId}`, {
      method: 'GET',
      requireAuth: false,
      includeAuthIfAvailable: true
    })
    return { success: true, data }
  } catch (error: any) {
    console.error('[getVideoById] 请求失败:', error)
    return { success: false, message: error?.message || '获取视频失败' }
  }
}

// 🎯 记录观看历史（播放时调用）
// progress: 0-100 的百分比，completed: 是否完播
export async function recordVideoView(
  videoId: string,
  options?: { progress?: number; completed?: boolean }
) {
  try {
    await callAppServer('/video/view', {
      method: 'POST',
      body: {
        video_id: videoId,
        progress: options?.progress,
        completed: options?.completed
      },
      requireAuth: true
    })
  } catch (error) {
    // 静默失败，不影响用户体验
    console.warn('[recordVideoView] 记录观看历史失败:', error)
  }
}

// 🎯 获取成人内容观看配额
export async function getAdultQuota() {
  try {
    const data = await callAppServer('/video/adult-quota', {
      method: 'GET',
      requireAuth: true
    })
    return { success: true, data }
  } catch (error: any) {
    console.error('[getAdultQuota] 请求失败:', error)
    return { success: false, message: error?.message || '获取配额失败' }
  }
}

async function requestSupabaseVideoList(
  endpoint: string,
  params?: Record<string, any>,
  options: { requireAuth?: boolean; includeAuthIfAvailable?: boolean } = {}
) {
  const requireAuth = options.requireAuth !== undefined ? options.requireAuth : true
  let accessToken: string | null = null

  try {
    if (requireAuth) {
      accessToken = await resolveAccessToken(true)
    } else if (options.includeAuthIfAvailable) {
      accessToken = await resolveAccessToken(false)
    }
  } catch (error: any) {
    console.error('[requestSupabaseVideoList] 获取 accessToken 失败:', error)
  }

  const search = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      search.set(key, String(value))
    }
  })
  const query = search.toString()

  // 🎯 构建请求头
  const headers: Record<string, string> = {}

  // 添加认证令牌
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  // 🎯 添加 Telegram initData（用于后端解析深链接）
  try {
    // @ts-ignore
    const tgWebApp = window.Telegram?.WebApp
    if (tgWebApp && tgWebApp.initData) {
      headers['X-Telegram-Init-Data'] = tgWebApp.initData
      console.log('[API][requestSupabaseVideoList] 添加 Telegram initData 到请求头')
    }
  } catch (e) {
    // 忽略错误，不影响正常请求
  }

  const url = `${endpoint}${query ? `?${query}` : ''}`
  const maxRetries = 2
  let lastError: any = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, { headers })
      const payload = await response.json()

      if (response.ok && payload.code === 0) {
        return { success: true, data: payload.data }
      }

      lastError = new Error(payload?.msg || `接口返回异常，状态码 ${response.status}`)
      console.warn('[requestSupabaseVideoList] 非 0 返回，准备重试', {
        attempt,
        message: lastError.message
      })
    } catch (error: any) {
      lastError = error
      console.warn('[requestSupabaseVideoList] 请求失败，准备重试', {
        attempt,
        message: error?.message
      })
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)))
    }
  }

  console.error('[requestSupabaseVideoList] 重试仍失败', lastError)
  return {
    success: false,
    data: {
      list: [],
      total: 0,
      pageNo: params?.pageNo ?? 0,
      pageSize: params?.pageSize ?? 15,
      message: lastError?.message || '加载失败'
    }
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

interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: any
  requireAuth?: boolean
  includeAuthIfAvailable?: boolean
}

async function callAppServer(path: string, options: CallOptions = {}) {
  const method = options.method ?? 'GET'
  let accessToken: string | null = null
  if (options.requireAuth !== false) {
    accessToken = await resolveAccessToken(true)
  } else if (options.includeAuthIfAvailable) {
    accessToken = await resolveAccessToken(false)
  }

  const headers: Record<string, string> = {}
  if (method !== 'GET' && options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  // 🎯 添加 Telegram initData 到请求头（用于后端解析深链接）
  try {
    // @ts-ignore
    const tgWebApp = window.Telegram?.WebApp
    if (tgWebApp && tgWebApp.initData) {
      headers['X-Telegram-Init-Data'] = tgWebApp.initData
      console.log('[API] 添加 Telegram initData 到请求头')
    }
  } catch (e) {
    // 忽略错误，不影响正常请求
  }

  const response = await fetch(`${getAppServerBase()}${path}`, {
    method,
    headers,
    body: method !== 'GET' && options.body !== undefined ? JSON.stringify(options.body) : undefined
  })
  const payload = await response.json()
  if (response.ok && payload.code === 0) {
    return payload.data
  }
  throw new Error(payload?.msg || '操作失败')
}

async function resolveAccessToken(required: boolean) {
  const {
    data: { session }
  } = await supabase.auth.getSession()
  const token = session?.access_token ?? null
  if (!token && required) {
    throw new Error('请先在 Telegram 中登录')
  }
  return token
}
