// 🎯 Presence 事件处理：记录用户在线/离线状态
// 直接更新 user_daily_watch_time 表，无需创建新表

import { supabaseAdmin } from '../lib/env.ts'
import { successResponse, errorResponse } from '../../_shared/response.ts'
import { tryGetAuth } from '../lib/auth.ts'

export async function handlePresenceOnline(req: Request): Promise<Response> {
  try {
    // 🎯 可选认证：如果用户已登录，验证 user_id 是否匹配
    const authResult = await tryGetAuth(req)
    const body = await req.json()
    const { user_id } = body

    if (!user_id) {
      return errorResponse('user_id required', 1, 400)
    }

    // 🔥 如果用户已登录，验证 user_id 是否匹配（防止伪造）
    if (authResult.user && authResult.user.id !== user_id) {
      console.warn(`[Presence] User ID mismatch: auth=${authResult.user.id}, body=${user_id}`)
      return errorResponse('Forbidden', 1, 403)
    }

    // 记录用户上线：更新 last_updated_at 为当前时间
    const { data, error } = await supabaseAdmin.rpc('update_watch_time_from_presence', {
      p_user_id: user_id,
      p_event_type: 'online'
    })

    if (error) {
      console.error('[Presence] Error recording online:', error)
      // 🔥 静默失败，不影响用户体验
      return successResponse({ success: false })
    }

    return successResponse(data)
  } catch (error: any) {
    console.error('[Presence] Unexpected error:', error)
    // 🔥 静默失败，不影响用户体验
    return successResponse({ success: false })
  }
}

export async function handlePresenceOffline(req: Request): Promise<Response> {
  try {
    // 🎯 可选认证：如果用户已登录，验证 user_id 是否匹配
    const authResult = await tryGetAuth(req)
    const body = await req.json()
    const { user_id } = body

    if (!user_id) {
      return errorResponse('user_id required', 1, 400)
    }

    // 🔥 如果用户已登录，验证 user_id 是否匹配（防止伪造）
    if (authResult.user && authResult.user.id !== user_id) {
      console.warn(`[Presence] User ID mismatch: auth=${authResult.user.id}, body=${user_id}`)
      return errorResponse('Forbidden', 1, 403)
    }

    // 记录用户下线：计算时长差并累加到 total_seconds
    const { data, error } = await supabaseAdmin.rpc('update_watch_time_from_presence', {
      p_user_id: user_id,
      p_event_type: 'offline'
    })

    if (error) {
      console.error('[Presence] Error recording offline:', error)
      // 🔥 静默失败，不影响用户体验
      return successResponse({ success: false })
    }

    return successResponse(data)
  } catch (error: any) {
    console.error('[Presence] Unexpected error:', error)
    // 🔥 静默失败，不影响用户体验
    return successResponse({ success: false })
  }
}
