import { request } from '@/utils/request'
import { supabase } from '@/utils/supabase'
import { useVideoStore } from '@/stores/video'
import { useBaseStore } from '@/store/pinia'

export function historyOther(params?: any, data?: any) {
  return request({ url: '/video/historyOther', method: 'get', params, data })
}

// 🎯 获取观看历史（使用 Supabase Edge Function）
export async function historyVideo(params?: any) {
  try {
    const pageNo = params?.pageNo ?? 0
    const pageSize = params?.pageSize ?? 15
    const data = await callAppServer(`/video/history?pageNo=${pageNo}&pageSize=${pageSize}`, {
      method: 'GET',
      requireAuth: true
    })
    return { success: true, data }
  } catch (error: any) {
    console.error('[historyVideo] 请求失败:', error)
    return {
      success: false,
      message: error?.message || '获取观看历史失败',
      data: { list: [], total: 0 }
    }
  }
}

// 🎯 清空所有观看历史
export async function clearVideoHistory() {
  try {
    const data = await callAppServer('/video/history', {
      method: 'DELETE',
      requireAuth: true
    })
    return { success: true, data }
  } catch (error: any) {
    console.error('[clearVideoHistory] 清空观看历史失败:', error)
    return { success: false, message: error?.message || '清空观看历史失败' }
  }
}

export function recommendedVideo(params?: any) {
  const pageSize = params?.pageSize ?? 10
  const start = params?.start ?? 0
  const pageNo = Math.floor(start / pageSize)
  const seed = params?.seed ?? 0.5

  // 🎯 注入本地已看列表 (用于游客去重)
  const videoStore = useVideoStore()
  const baseStore = useBaseStore()
  const exclude_ids = videoStore.seenIds?.join(',')

  // 🎯 深链接由后端自动处理
  // 为确保稳定性，如果 store 中存在 startVideoId，则显式传递给后端
  const start_video_id = baseStore.startVideoId

  return requestSupabaseVideoList(
    `${getAppServerBase()}/video/feed`,
    { pageNo, pageSize, seed, exclude_ids, start_video_id },
    {
      requireAuth: false,
      includeAuthIfAvailable: true
    }
  )
}

export function recommendedLongVideo(params?: any) {
  const pageNo = params?.pageNo ?? 0
  const pageSize = params?.pageSize ?? 10
  const seed = params?.seed ?? 0.5

  // 🎯 注入本地已看列表
  const videoStore = useVideoStore()
  const exclude_ids = videoStore.seenIds?.join(',')

  return requestSupabaseVideoList(
    `${getAppServerBase()}/video/long-feed`,
    { pageNo, pageSize, seed, exclude_ids },
    { requireAuth: false, includeAuthIfAvailable: true }
  )
}

// 普通视频 Tab：只返回 content_type='video' 且 is_sea=false 的已发布内容，按 published_at 倒序
export function recommendedVideoTab(params?: any) {
  const pageNo = params?.pageNo ?? 0
  const pageSize = params?.pageSize ?? 10
  const seed = params?.seed ?? 0.5

  // 🎯 注入本地已看列表
  const videoStore = useVideoStore()
  const exclude_ids = videoStore.seenIds?.join(',')

  return requestSupabaseVideoList(
    `${getAppServerBase()}/video/video-tab-feed`,
    { pageNo, pageSize, seed, exclude_ids },
    { requireAuth: false, includeAuthIfAvailable: true }
  )
}

// 短剧 Tab：只返回 tags 包含"短剧"的已发布内容，按 published_at 倒序
export function shortDramaVideoTab(params?: any) {
  const pageNo = params?.pageNo ?? 0
  const pageSize = params?.pageSize ?? 10
  return requestSupabaseVideoList(
    `${getAppServerBase()}/video/short-drama-feed`,
    { pageNo, pageSize },
    { requireAuth: false, includeAuthIfAvailable: true }
  )
}

// 成人内容视频列表（仅 is_adult = true）
export function adultVideoFeed(params?: any) {
  const pageSize = params?.pageSize ?? 10
  const start = params?.start ?? 0
  const pageNo = Math.floor(start / pageSize)
  const seed = params?.seed ?? 0.5

  // 🎯 注入本地已看列表
  const videoStore = useVideoStore()
  const exclude_ids = videoStore.seenIds?.join(',')

  return requestSupabaseVideoList(
    `${getAppServerBase()}/video/adult-feed`,
    { pageNo, pageSize, seed, exclude_ids },
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

// 🎯 删除评论
export async function deleteVideoComment(commentId: string) {
  return callAppServer('/comment/delete', {
    method: 'POST',
    body: { comment_id: commentId }
  })
}

// 🧧 红包相关接口
export async function sendRedPacket(data: {
  room_id: string
  total_coins: number
  total_count: number
  packet_type: 'lucky' | 'equal'
  countdown_seconds: number
  claim_conditions: any
}) {
  return callAppServer('/live/red-packet/send', {
    method: 'POST',
    body: data
  })
}

export async function claimRedPacket(packetId: string) {
  return callAppServer('/live/red-packet/claim', {
    method: 'POST',
    body: { packet_id: packetId }
  })
}

export async function getActiveRedPackets(roomId: string) {
  return callAppServer(`/live/red-packet/active?room_id=${roomId}`, {
    method: 'GET',
    requireAuth: false,
    includeAuthIfAvailable: true
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

// 🎯 求更新：提醒作者更新作品（Bot 私信），同一用户对同一作者 24h 仅一次（后端限制）
export async function requestAuthorUpdate(targetId: string) {
  try {
    const data = await callAppServer('/user/request-update', {
      method: 'POST',
      body: { target_id: targetId }
    })
    return { success: true, data }
  } catch (error: any) {
    console.error('[requestAuthorUpdate] 请求失败:', error)
    return { success: false, message: error?.message || '求更新失败' }
  }
}

// 🎯 记录主页访客（进入别人主页时调用）
export async function recordProfileVisit(targetId: string) {
  try {
    const data = await callAppServer('/user/visit', {
      method: 'POST',
      body: { target_id: targetId }
    })
    return { success: true, data }
  } catch (error: any) {
    console.error('[recordProfileVisit] 请求失败:', error)
    return { success: false, message: error?.message || '记录访客失败' }
  }
}

// 🎯 获取我的访客列表
export async function getMyVisitors(limit = 100) {
  try {
    const data = await callAppServer(`/user/visitors?limit=${encodeURIComponent(String(limit))}`, {
      method: 'GET',
      requireAuth: true
    })
    return { success: true, data: data?.list ?? [] }
  } catch (error: any) {
    console.error('[getMyVisitors] 请求失败:', error)
    return { success: false, message: error?.message || '获取访客失败', data: [] }
  }
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
    // 🎯 优化：如果是游客（未登录），直接跳过历史记录，不抛出异常
    const token = await resolveAccessToken(false)
    if (!token) return

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
    // 仅在真正的请求失败时打印警告
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

// 🎯 累计观看时长（秒）
export async function incrementWatchTime(seconds: number, videoId?: string) {
  try {
    // 🎯 静默检查 token，未登录用户不打印任何日志（避免刷屏）
    const token = await resolveAccessToken(false)
    if (!token) {
      return { success: false, silent: true } // 标记为静默失败
    }

    console.log(
      `[WatchTime] 📤 上报观看时长: ${seconds}秒, videoId: ${videoId?.substring(0, 8) || 'null'}`
    )
    const data = await callAppServer('/video/watch-time', {
      method: 'POST',
      body: { seconds, video_id: videoId }, // 🎯 传入视频ID用于去重
      requireAuth: true
    })
    console.log(`[WatchTime] ✅ 上报成功`)
    return { success: true, data }
  } catch (error: any) {
    // 🎯 仅在真正的网络错误时打印警告（避免未登录时刷屏）
    console.warn('[WatchTime] ⚠️ 上报失败:', error?.message || error)
    return { success: false, message: error?.message || '累计观看时长失败' }
  }
}

// 🎯 获取观看时长奖励状态
export async function getWatchTimeStatus() {
  try {
    const token = await resolveAccessToken(false)
    if (!token) return { success: false }

    const data = await callAppServer('/video/watch-time/status', {
      method: 'GET',
      requireAuth: true
    })
    return { success: true, data }
  } catch (error: any) {
    console.error('[getWatchTimeStatus] 获取观看时长状态失败:', error)
    return { success: false, message: error?.message || '获取观看时长状态失败' }
  }
}

// 🎯 领取观看时长奖励
export async function claimWatchTimeReward() {
  try {
    const token = await resolveAccessToken(false)
    if (!token) return { success: false, message: '未登录' }

    const data = await callAppServer('/video/watch-time/claim', {
      method: 'POST',
      requireAuth: true
    })
    return { success: true, data }
  } catch (error: any) {
    console.error('[claimWatchTimeReward] 领取观看时长奖励失败:', error)
    return { success: false, message: error?.message || '领取失败' }
  }
}

export async function sendReward(payload: {
  receiver_id: string
  gift_amount: number
  room_or_video_id: string
  gift_type: 'live' | 'video'
  gift_name: string
  gift_id?: number
  gift_icon?: string
  gift_qty?: number
  effect_url?: string
}) {
  return callAppServer('/reward/send', {
    method: 'POST',
    body: payload
  })
}

// 🎯 缓存请求状态，防止死循环高频调用
const requestLock = new Map<string, number>()

async function requestSupabaseVideoList(
  endpoint: string,
  params?: Record<string, any>,
  options: { requireAuth?: boolean; includeAuthIfAvailable?: boolean } = {}
) {
  // 防止死循环请求：同一个接口 200ms 内只能请求一次（从 500ms 下调，提高补货成功率）
  const lockKey = `${endpoint}-${JSON.stringify(params)}`
  const now = Date.now()
  if (requestLock.has(lockKey) && now - requestLock.get(lockKey)! < 200) {
    console.warn('[API] 拦截到高频重复请求:', lockKey)
    return {
      success: false,
      data: { list: [], total: 0, message: '请求太频繁' }
    }
  }
  requestLock.set(lockKey, now)

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
    // 🎯 如果是强制要求的鉴权失败，直接返回，不再发起 fetch
    if (requireAuth) {
      return {
        success: false,
        data: {
          list: [],
          total: 0,
          pageNo: params?.pageNo ?? 0,
          pageSize: params?.pageSize ?? 15,
          message: error?.message || '请先登录'
        }
      }
    }
  }

  const search = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      search.set(key, String(value))
    }
  })
  const query = search.toString()

  // 🎯 构建请求头
  const headers: Record<string, string> = {
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  }

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
  try {
    const response = await fetch(url, { headers })
    const payload = await response.json()

    if (response.ok && payload.code === 0) {
      return { success: true, data: payload.data }
    }

    throw new Error(payload?.msg || `接口返回异常，状态码 ${response.status}`)
  } catch (error: any) {
    console.error('[requestSupabaseVideoList] 请求失败:', error)
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

  // 🎯 本地开发或预览模式下，优先使用相对路径（走 Vite 代理）
  if (import.meta.env.DEV || window.location.port === '5555' || window.location.port === '3000') {
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

  const headers: Record<string, string> = {
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  }
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

  // ✅ 优化：添加超时控制，防止长时间等待
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 20000) // 20 秒超时

  let response: Response
  try {
    response = await fetch(`${getAppServerBase()}${path}`, {
      method,
      headers,
      body:
        method !== 'GET' && options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    })
    clearTimeout(timeoutId)
  } catch (error: any) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请检查网络连接')
    }
    throw error
  }
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
