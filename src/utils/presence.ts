// 🎯 Presence 追踪工具：用于追踪用户在线时长
// 使用 Supabase Realtime Presence 自动追踪，无需频繁调用接口

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

let presenceChannel: any = null
let isTracking = false

/**
 * 开始追踪用户在线状态
 * 当用户上线时，调用后端记录上线时间
 * 当用户下线时，调用后端计算时长并累加
 */
export async function startPresenceTracking() {
  if (isTracking) {
    console.log('[Presence] Already tracking')
    return
  }

  try {
    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (!user) {
      console.log('[Presence] User not logged in, skip tracking')
      return
    }

    // 创建全局 Presence channel
    presenceChannel = supabase.channel('app_online_tracking', {
      config: {
        presence: {
          key: user.id // 使用 user_id 作为 presence key
        }
      }
    })

    // 监听 Presence 状态变化
    presenceChannel
      .on('presence', { event: 'sync' }, async () => {
        // sync 事件：同步所有在线用户状态
        const state = presenceChannel.presenceState()
        const myPresence = state[user.id]

        if (myPresence && myPresence.length > 0) {
          // 用户在线（首次同步或重连）
          console.log('[Presence] User synced (online)')
          await notifyPresenceOnline(user.id)
        }
      })
      .on('presence', { event: 'join' }, async ({ key }: any) => {
        // join 事件：用户上线
        if (key === user.id) {
          console.log('[Presence] User joined (online)')
          await notifyPresenceOnline(user.id)
        }
      })
      .on('presence', { event: 'leave' }, async ({ key }: any) => {
        // leave 事件：用户下线
        if (key === user.id) {
          console.log('[Presence] User left (offline)')
          await notifyPresenceOffline(user.id)
        }
      })
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Presence] Subscribed to presence tracking')
          // 订阅成功后，立即追踪当前状态
          presenceChannel.track({
            user_id: user.id,
            online_at: new Date().toISOString()
          })
          isTracking = true
        }
      })
  } catch (error) {
    console.error('[Presence] Error starting tracking:', error)
  }
}

/**
 * 停止追踪用户在线状态
 */
export async function stopPresenceTracking() {
  if (!isTracking || !presenceChannel) {
    return
  }

  try {
    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (user) {
      // 用户下线
      await notifyPresenceOffline(user.id)
    }

    // 取消追踪并移除 channel
    if (presenceChannel) {
      await presenceChannel.untrack()
      supabase.removeChannel(presenceChannel)
      presenceChannel = null
    }
    isTracking = false
    console.log('[Presence] Stopped tracking')
  } catch (error) {
    console.error('[Presence] Error stopping tracking:', error)
  }
}

/**
 * 通知后端用户上线
 */
async function notifyPresenceOnline(userId: string) {
  try {
    const token = await resolveAccessToken(false)
    if (!token) {
      return
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const resp = await fetch(`${getAppServerBase()}/presence/online`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ user_id: userId })
    })

    if (resp.ok) {
      console.log('[Presence] Online notification sent')
    } else {
      console.warn('[Presence] Failed to notify online:', resp.status)
    }
  } catch (error) {
    console.warn('[Presence] Error notifying online:', error)
  }
}

/**
 * 通知后端用户下线
 */
async function notifyPresenceOffline(userId: string) {
  try {
    const token = await resolveAccessToken(false)
    if (!token) {
      return
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const resp = await fetch(`${getAppServerBase()}/presence/offline`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ user_id: userId })
    })

    if (resp.ok) {
      const data = await resp.json()
      console.log(
        '[Presence] Offline notification sent, duration:',
        data.data?.duration_seconds,
        'seconds'
      )
    } else {
      console.warn('[Presence] Failed to notify offline:', resp.status)
    }
  } catch (error) {
    console.warn('[Presence] Error notifying offline:', error)
  }
}
