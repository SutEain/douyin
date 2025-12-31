import { supabaseAdmin } from '../lib/env.ts'
import { successResponse, errorResponse } from '../../_shared/response.ts'
import { requireAuth, parseJsonBody, HttpError } from '../lib/auth.ts'

/**
 * 主播发送红包
 * POST /live/red-packet/send
 */
export async function handleSendRedPacket(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const body = await parseJsonBody<{
    room_id: string
    total_coins: number
    total_count: number
    packet_type: 'lucky' | 'equal'
    countdown_seconds: number
    claim_conditions: any
  }>(req)

  const { room_id, total_coins, total_count, packet_type, countdown_seconds, claim_conditions } =
    body

  if (!room_id || !total_coins || !total_count) {
    throw new HttpError('参数不完整', 400)
  }

  // 1. 验证房间所有权
  const { data: room, error: roomError } = await supabaseAdmin
    .from('live_broadcast_rooms')
    .select('id, anchor_id')
    .eq('id', room_id)
    .single()

  if (roomError || !room) {
    throw new HttpError('直播间不存在', 404)
  }

  if (room.anchor_id !== user.id) {
    throw new HttpError('只有主播可以发放红包', 403)
  }

  const unlockAt = new Date(Date.now() + countdown_seconds * 1000).toISOString()
  const expiresAt = new Date(Date.now() + (countdown_seconds + 3600) * 1000).toISOString()

  // 2. 调用原子 RPC 发放红包 (内部处理：锁定、余额校验、扣除、记录流水、创建红包)
  const { data: res, error: rpcError } = await supabaseAdmin.rpc('send_live_red_packet', {
    p_room_id: room_id,
    p_sender_id: user.id,
    p_total_coins: total_coins,
    p_total_count: total_count,
    p_packet_type: packet_type,
    p_countdown_seconds: countdown_seconds,
    p_claim_conditions: claim_conditions,
    p_unlock_at: unlockAt,
    p_expires_at: expiresAt
  })

  if (rpcError) {
    console.error('[RedPacket] RPC Error:', rpcError)
    throw new HttpError('发放红包失败: ' + rpcError.message, 500)
  }

  if (!res.success) {
    throw new HttpError(res.message || '发放失败', 400)
  }

  const packetId = res.packet_id

  // 3. 发送一条系统消息到直播间
  await supabaseAdmin.from('live_broadcast_messages').insert({
    room_id,
    user_id: user.id,
    content: `发了一个${total_coins}抖币的红包，快来抢啊！`,
    msg_type: 'system',
    payload: {
      type: 'red_packet',
      packet_id: packetId,
      unlock_at: unlockAt
    }
  })

  return successResponse({ success: true, packet_id: packetId })
}

/**
 * 用户领取红包
 * POST /live/red-packet/claim
 */
export async function handleClaimRedPacket(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const body = await parseJsonBody<{ packet_id: string }>(req)

  if (!body.packet_id) {
    throw new HttpError('缺少 packet_id', 400)
  }

  // 调用数据库 RPC 抢红包
  const { data, error } = await supabaseAdmin.rpc('claim_live_red_packet', {
    p_packet_id: body.packet_id,
    p_user_id: user.id
  })

  if (error) {
    throw new HttpError('系统错误: ' + error.message, 500)
  }

  if (data.success === false) {
    return errorResponse(data.message || '领取失败', 1, 400)
  }

  return successResponse({ amount: data.amount })
}

/**
 * 获取直播间当前可领取的红包
 * GET /live/red-packet/active?room_id=xxx
 */
export async function handleGetActiveRedPackets(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const roomId = url.searchParams.get('room_id')

  if (!roomId) {
    throw new HttpError('缺少 room_id', 400)
  }

  const { data: packets, error } = await supabaseAdmin
    .from('live_red_packets')
    .select('*')
    .eq('room_id', roomId)
    .in('status', ['pending', 'active'])
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  if (error) {
    throw new HttpError('查询红包失败', 500)
  }

  return successResponse({ list: packets || [] })
}
