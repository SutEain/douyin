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

  // 2. 检查主播余额
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('balance_coins')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    throw new HttpError('用户信息查询失败', 500)
  }

  if ((profile.balance_coins || 0) < total_coins) {
    throw new HttpError('余额不足', 400)
  }

  // 3. 执行发放逻辑（扣除余额并创建红包）
  const balanceAfter = (profile.balance_coins || 0) - total_coins
  const { error: updateBalanceError } = await supabaseAdmin
    .from('profiles')
    .update({ balance_coins: balanceAfter })
    .eq('id', user.id)

  if (updateBalanceError) {
    throw new HttpError('扣除余额失败', 500)
  }

  const unlockAt = new Date(Date.now() + countdown_seconds * 1000).toISOString()
  const expiresAt = new Date(Date.now() + (countdown_seconds + 3600) * 1000).toISOString()

  const { data: packet, error: insertError } = await supabaseAdmin
    .from('live_red_packets')
    .insert({
      room_id,
      sender_id: user.id,
      total_coins,
      total_count,
      packet_type,
      countdown_seconds,
      claim_conditions,
      remaining_coins: total_coins,
      remaining_count: total_count,
      status: 'pending',
      unlock_at: unlockAt,
      expires_at: expiresAt
    })
    .select()
    .single()

  if (insertError) {
    // 补偿逻辑
    await supabaseAdmin
      .from('profiles')
      .update({ balance_coins: profile.balance_coins })
      .eq('id', user.id)
    throw new HttpError('创建红包失败: ' + insertError.message, 500)
  }

  // 🎯 记录资金流水
  await supabaseAdmin.from('coin_transactions').insert({
    user_id: user.id,
    amount: -total_coins,
    balance_after: balanceAfter,
    type: 'red_packet_send',
    description: '直播间发放红包',
    related_id: packet.id
  })

  // 4. 发送一条系统消息到直播间
  await supabaseAdmin.from('live_broadcast_messages').insert({
    room_id,
    user_id: user.id,
    content: `发了一个${total_coins}抖币的红包，快来抢啊！`,
    msg_type: 'system',
    payload: {
      type: 'red_packet',
      packet_id: packet.id,
      unlock_at: unlockAt
    }
  })

  return successResponse({ packet })
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
