import { successResponse, errorResponse } from '../../_shared/response.ts'
import { supabaseAdmin } from '../lib/env.ts'
import { requireAuth, parseJsonBody, HttpError } from '../lib/auth.ts'
import { checkAndSendNotification } from '../lib/notification.ts'

export async function handleSendReward(req: Request): Promise<Response> {
  try {
    const { user, profile } = await requireAuth(req, { withProfile: true })
    const body = await parseJsonBody<{
      receiver_id: string
      gift_amount: number
      room_or_video_id: string
      gift_type: 'live' | 'video'
      gift_name: string
      gift_id?: number
      gift_icon?: string
      gift_qty?: number
      effect_url?: string
    }>(req)

    const {
      receiver_id,
      gift_amount: frontendGiftAmount, // 🎯 前端传来的金额，仅作参考，后端需重新计算
      room_or_video_id,
      gift_type,
      gift_name,
      gift_id,
      gift_icon,
      gift_qty: rawGiftQty,
      effect_url
    } = body

    // 🎯 核心安全加固：校验数量，限制最大为 999，且必须大于 0
    const gift_qty = Math.min(Math.max(Number(rawGiftQty) || 1, 1), 999)

    let finalReceiverId = receiver_id
    let finalGiftAmount = 0
    let finalGiftName = gift_name

    // 🎯 核心安全加固：必须从数据库获取真实的礼物价格，不能信任前端传来的金额
    if (gift_type === 'live' && gift_id) {
      const { data: giftData } = await supabaseAdmin
        .from('gifts')
        .select('price, name')
        .eq('id', gift_id)
        .maybeSingle()

      if (giftData) {
        finalGiftAmount = giftData.price * gift_qty
        finalGiftName = giftData.name
      } else {
        // 如果找不到礼物配置，且是直播打赏，拒绝请求
        throw new HttpError('礼物配置不存在', 400)
      }
    } else {
      // 视频打赏目前前端没传 gift_id，暂时信任 gift_amount，但也要校验
      finalGiftAmount = Number(frontendGiftAmount)
      if (isNaN(finalGiftAmount) || finalGiftAmount <= 0) {
        throw new HttpError('打赏金额无效', 400)
      }
    }

    // 🎯 优化：如果没传接收者 ID (通常是外部转播直播间)，尝试打赏给 ID 为 88888 的用户
    if (!finalReceiverId && gift_type === 'live') {
      console.log('[Reward] receiver_id 为空，查找官方账号 88888...')
      const { data: globalAnchor } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('numeric_id', 88888)
        .maybeSingle()

      if (globalAnchor) {
        finalReceiverId = globalAnchor.id
        console.log('[Reward] 已分配接收者为官方账号:', finalReceiverId)
      } else {
        // 兜底查找管理员
        const { data: adminProfile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('numeric_id', 10000)
          .maybeSingle()
        finalReceiverId = adminProfile?.id
      }
    }

    if (!finalReceiverId || !finalGiftAmount || !room_or_video_id || !gift_type || !finalGiftName) {
      throw new HttpError('Missing required parameters (receiver_id not found)', 400)
    }

    if (finalReceiverId === user.id && receiver_id) {
      throw new HttpError('不能打赏自己', 400)
    }

    // 1. 调用 RPC 处理打赏扣款和分账
    const { data: res, error: rpcError } = await supabaseAdmin.rpc('process_gift_reward', {
      sender_id: user.id,
      receiver_id: finalReceiverId,
      gift_amount: finalGiftAmount,
      room_or_video_id: room_or_video_id,
      gift_type: gift_type,
      gift_name: finalGiftName
    })

    if (rpcError) {
      console.error('[Reward] RPC Error:', rpcError)
      return errorResponse('打赏处理失败: ' + rpcError.message, 1, 500)
    }

    if (!res.success) {
      return errorResponse(res.message || '打赏失败', 1, 400)
    }

    // 2. 插入实时消息记录（后端代发，前端不可绕过）
    // 🎯 核心加固：所有的礼物特效（msg_type='gift'）必须由后端在这里统一代发
    // 配合数据库 RLS 策略，普通用户将无法直接从前端插入 'gift' 类型的消息，从而杜绝绕过余额打赏
    const { error: msgError } = await supabaseAdmin.from('live_broadcast_messages').insert({
      room_id: room_or_video_id,
      user_id: user.id,
      content: finalGiftName,
      msg_type: 'gift',
      payload: {
        gift_id: gift_id,
        gift_name: finalGiftName,
        gift_icon: gift_icon,
        amount: gift_qty, // 🎯 使用经过校验后的数量
        combo: gift_qty, // 🎯 使用经过校验后的数量
        effect_url: effect_url
      }
    })

    if (msgError) {
      console.error('[Reward] Insert gift message failed:', msgError)
    }

    // 3. 发送通知给作者/主播
    // 只有真实主播才发送通知，如果是转播间（管理员代收）则不发机器人通知
    if (receiver_id) {
      const senderName = profile.nickname || profile.username || '神秘用户'
      const targetType = gift_type === 'live' ? '直播间' : '作品'
      const notificationMsg = `💰 <b>${senderName}</b> 给你的${targetType}打赏了 <b>${finalGiftAmount}</b> 抖币！`

      // 如果是视频，带上跳转链接
      const startParam = gift_type === 'video' ? `video_${room_or_video_id}` : undefined

      // 异步发送通知
      checkAndSendNotification(finalReceiverId, 'gift', notificationMsg, startParam)
    }

    return successResponse({
      success: true,
      sender_balance: res.sender_balance,
      receiver_balance: res.receiver_balance
    })
  } catch (e: any) {
    console.error('[Reward] unexpected error:', e)
    if (e instanceof HttpError) {
      return errorResponse(e.message, 1, e.status)
    }
    return errorResponse(e.message || 'Internal server error', 1, 500)
  }
}
