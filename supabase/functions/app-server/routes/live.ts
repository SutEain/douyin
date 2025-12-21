import { supabaseAdmin } from '../lib/env.ts'
import { successResponse, errorResponse } from '../../_shared/response.ts'

export async function handleLiveRooms(req: Request): Promise<Response> {
  try {
    // 仅返回启用的直播间，用于前端展示（不要求登录）
    const { data, error } = await supabaseAdmin
      .from('live_rooms')
      .select('id, title, description, stream_url, cover_url, sort_order, is_active, updated_at')
      .eq('is_active', true)
      .order('sort_order', { ascending: false })
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('[live_rooms] query error:', error)
      return errorResponse('加载直播间失败', 1, 500)
    }

    return successResponse({ list: data ?? [] })
  } catch (e) {
    console.error('[live_rooms] unexpected error:', e)
    return errorResponse('Internal server error', 1, 500)
  }
}
