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
  return requestSupabaseVideoList(
    `${getAppServerBase()}/video/feed`,
    { pageNo, pageSize },
    { requireAuth: false, includeAuthIfAvailable: true }
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
  return requestSupabaseVideoList(`${getAppServerBase()}/video/likes`, params, { requireAuth: true })
}

export function collectedVideo(params?: any) {
  return requestSupabaseVideoList(`${getAppServerBase()}/video/collections`, params, { requireAuth: true })
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

export async function videoComments(params: { videoId: string; pageNo?: number; pageSize?: number }) {
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

export async function sendVideoComment(videoId: string, content: string) {
  return callAppServer('/video/comments', {
    method: 'POST',
    body: { video_id: videoId, content }
  })
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

async function requestSupabaseVideoList(
  endpoint: string,
  params?: Record<string, any>,
  options: { requireAuth?: boolean; includeAuthIfAvailable?: boolean } = {}
) {
  try {
    const requireAuth = options.requireAuth !== undefined ? options.requireAuth : true
    let accessToken: string | null = null

    if (requireAuth) {
      accessToken = await resolveAccessToken(true)
    } else if (options.includeAuthIfAvailable) {
      accessToken = await resolveAccessToken(false)
    }

    const search = new URLSearchParams()
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        search.set(key, String(value))
      }
    })
    const query = search.toString()

    const response = await fetch(`${endpoint}${query ? `?${query}` : ''}`, {
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      }
    })

    const payload = await response.json()
    if (response.ok && payload.code === 0) {
      return { success: true, data: payload.data }
    }

    throw new Error(payload?.msg || '加载我的视频失败')
  } catch (error: any) {
    console.error('[myVideo] request failed:', error)
    return {
      success: false,
      data: {
        list: [],
        total: 0,
        pageNo: params?.pageNo ?? 0,
        pageSize: params?.pageSize ?? 15,
        message: error?.message || '加载失败'
      }
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
