// 🎯 Presence 事件处理：记录用户在线/离线状态
// 直接更新 user_daily_watch_time 表，无需创建新表

import { supabaseAdmin } from '../../_shared/supabase.ts'
import { successResponse, errorResponse } from '../../_shared/response.ts'

export async function handlePresenceOnline(req: Request): Promise<Response> {
  try {
    const body = await req.json()
    const { user_id } = body

    if (!user_id) {
      return errorResponse('user_id required', 1, 400)
    }

    // 记录用户上线：更新 last_updated_at 为当前时间
    const { data, error } = await supabaseAdmin.rpc('update_watch_time_from_presence', {
      p_user_id: user_id,
      p_event_type: 'online'
    })

    if (error) {
      console.error('[Presence] Error recording online:', error)
      return errorResponse('Failed to record online', 1, 500)
    }

    return successResponse(data)
  } catch (error: any) {
    console.error('[Presence] Unexpected error:', error)
    return errorResponse('Internal server error', 1, 500)
  }
}

export async function handlePresenceOffline(req: Request): Promise<Response> {
  try {
    const body = await req.json()
    const { user_id } = body

    if (!user_id) {
      return errorResponse('user_id required', 1, 400)
    }

    // 记录用户下线：计算时长差并累加到 total_seconds
    const { data, error } = await supabaseAdmin.rpc('update_watch_time_from_presence', {
      p_user_id: user_id,
      p_event_type: 'offline'
    })

    if (error) {
      console.error('[Presence] Error recording offline:', error)
      return errorResponse('Failed to record offline', 1, 500)
    }

    return successResponse(data)
  } catch (error: any) {
    console.error('[Presence] Unexpected error:', error)
    return errorResponse('Internal server error', 1, 500)
  }
}
