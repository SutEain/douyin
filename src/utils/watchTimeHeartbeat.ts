// 🎯 观看时长心跳机制：打开app就开始计时，1分钟发送1次心跳

import { supabase } from './supabase'

// 获取 App Server 基础 URL
function getAppServerBase() {
  if (import.meta.env.VITE_APP_SERVER_URL) {
    return import.meta.env.VITE_APP_SERVER_URL.replace(/\/$/, '')
  }

  if (import.meta.env.DEV) {
    return '/api/app-server'
  }

  // 生产环境：从 Supabase URL 推断
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
  if (supabaseUrl) {
    return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/app-server`
  }

  return '/api/app-server'
}

// 解析访问令牌
async function resolveAccessToken(required: boolean = false): Promise<string | null> {
  try {
    const {
      data: { session }
    } = await supabase.auth.getSession()
    if (session?.access_token) {
      return session.access_token
    }
    if (required) {
      throw new Error('No access token available')
    }
    return null
  } catch (error) {
    if (required) {
      throw error
    }
    return null
  }
}

let heartbeatTimer: number | null = null
let isHeartbeatRunning = false

/**
 * 开始观看时长心跳
 * 打开app就开始计时，1分钟发送1次心跳
 */
export async function startWatchTimeHeartbeat() {
  if (isHeartbeatRunning) {
    return
  }

  try {
    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (!user) {
      console.warn('[WatchTime] 用户未登录，无法开始心跳')
      return
    }

    isHeartbeatRunning = true

    // 立即发送第一次心跳
    await sendHeartbeat(user.id)

    // 之后每1分钟发送一次心跳
    heartbeatTimer = window.setInterval(async () => {
      const {
        data: { user: currentUser }
      } = await supabase.auth.getUser()
      if (currentUser) {
        await sendHeartbeat(currentUser.id)
      } else {
        // 用户已登出，停止心跳
        stopWatchTimeHeartbeat()
      }
    }, 60000) // 1分钟 = 60000毫秒

    console.log('[WatchTime] 心跳已启动，每1分钟发送一次')
  } catch (error) {
    console.error('[WatchTime] 启动心跳失败:', error)
    isHeartbeatRunning = false
  }
}

/**
 * 停止观看时长心跳
 */
export function stopWatchTimeHeartbeat() {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  isHeartbeatRunning = false
  console.log('[WatchTime] 心跳已停止')
}

/**
 * 发送心跳
 */
async function sendHeartbeat(userId: string) {
  try {
    const token = await resolveAccessToken(false)
    if (!token) {
      console.warn('[WatchTime] 无法获取访问令牌，跳过心跳')
      return
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      Authorization: `Bearer ${token}`
    }

    const resp = await fetch(`${getAppServerBase()}/video/watch-time/heartbeat`, {
      method: 'POST',
      headers
    })

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}))
      // 如果是429（过于频繁），静默处理（可能是网络延迟导致）
      if (resp.status === 429) {
        console.warn('[WatchTime] 心跳过于频繁，可能是网络延迟')
        return
      }
      console.error('[WatchTime] 心跳失败:', resp.status, errorData)
      return
    }

    const data = await resp.json()
    // 后端返回格式：{code: 0, msg: 'ok', data: {success: true, ...}}
    if (data?.code === 0 && data?.data?.success) {
      console.log('[WatchTime] 心跳成功，累计时长:', data.data.total_seconds, '秒')
    } else {
      console.warn('[WatchTime] 心跳返回失败:', data)
    }
  } catch (error) {
    // 网络错误等，静默处理，不影响用户体验
    console.error('[WatchTime] 心跳异常:', error)
  }
}
