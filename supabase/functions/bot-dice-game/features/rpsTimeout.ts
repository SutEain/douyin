import { supabase } from '../supabaseClient.ts'
import { editMessage, sendMessage } from '../telegram.ts'
import { escapeHTML } from '../utils/text.ts'

/**
 * 检查并处理猜拳游戏超时
 * 1. 等待加入阶段：30秒无人加入 → 自动解散，退款
 * 2. 出手阶段：60秒内双方必须出手，超时则自动解散，退款
 */
export async function checkRpsTimeout() {
  try {
    // 调用 RPC 函数检查并处理超时房间
    const { data, error } = await supabase.rpc('check_rps_timeout')

    if (error) {
      console.error('[RPS-TIMEOUT] RPC 调用失败:', error)
      return
    }

    if (!data || data.cancelled_count === 0) {
      // console.log('[RPS-TIMEOUT] 无超时房间')
      return
    }

    console.log(
      `[RPS-TIMEOUT] 检查完成: 解散了 ${data.cancelled_count} 个超时房间`,
      data.refunded_rooms
    )

    // 处理每个被取消的房间，更新群组消息
    for (const roomInfo of data.refunded_rooms || []) {
      const roomId = roomInfo.room_id
      const reason = roomInfo.reason
      const groupId = roomInfo.group_id
      const messageId = roomInfo.message_id

      if (!messageId || !groupId) {
        console.log(`[RPS-TIMEOUT] 跳过房间 ${roomId}: 缺少 message_id 或 group_id`)
        continue
      }

      // 获取房间详细信息（需要用户昵称）
      const { data: room } = await supabase
        .from('rps_rooms')
        .select(
          `
          *,
          owner:owner_id (nickname),
          opponent:opponent_id (nickname)
        `
        )
        .eq('id', roomId)
        .single()

      if (!room) {
        console.log(`[RPS-TIMEOUT] 跳过房间 ${roomId}: 房间信息查询失败`)
        continue
      }

      // 根据超时阶段生成不同的消息
      let timeoutText = ''
      let timeoutMessage = ''

      if (reason === 'waiting') {
        // 等待加入阶段超时
        timeoutText =
          `🪨✂️📄 <b>石头剪刀布挑战</b>\n\n` +
          `👤 发起人：<b>${escapeHTML(room.owner.nickname)}</b>\n` +
          `💰 赌注：<b>${room.bet_amount}</b> 抖币\n\n` +
          `⏰ <b>游戏已超时解散</b>\n` +
          `原因：等待对手加入超过 30 秒\n` +
          `💸 本金已退回发起人账户`

        timeoutMessage =
          `🪨✂️📄 <b>猜拳游戏已解散</b>\n\n` +
          `👤 发起人：<b>${escapeHTML(room.owner.nickname)}</b>\n` +
          `❌ 原因：没有人加入\n` +
          `💰 本金已退回`
      } else if (reason === 'playing') {
        // 出手阶段超时
        timeoutText =
          `🪨✂️📄 <b>石头剪刀布对决</b>\n\n` +
          `👤 玩家A：<b>${escapeHTML(room.owner.nickname)}</b>\n` +
          `👤 玩家B：<b>${escapeHTML(room.opponent.nickname)}</b>\n` +
          `💰 赌注：<b>${room.bet_amount}</b> 抖币/人\n\n` +
          `⏰ <b>游戏已超时解散</b>\n` +
          `原因：双方出手超过 60 秒\n` +
          `💸 本金已退回双方账户`

        // 判断谁未出拳
        const { data: choices } = await supabase
          .from('rps_choices')
          .select('user_id')
          .eq('room_id', roomId)

        const ownerChose = choices?.some((c) => c.user_id === room.owner_id)
        const opponentChose = choices?.some((c) => c.user_id === room.opponent_id)

        let whoNotChose = ''
        if (!ownerChose && !opponentChose) {
          whoNotChose = '双方均未出拳'
        } else if (!ownerChose) {
          whoNotChose = `${escapeHTML(room.owner.nickname)}未出拳`
        } else if (!opponentChose) {
          whoNotChose = `${escapeHTML(room.opponent.nickname)}未出拳`
        }

        timeoutMessage =
          `🪨✂️📄 <b>猜拳游戏已解散</b>\n\n` +
          `👤 玩家A：<b>${escapeHTML(room.owner.nickname)}</b>\n` +
          `👤 玩家B：<b>${escapeHTML(room.opponent.nickname)}</b>\n` +
          `❌ 原因：${whoNotChose || '超时未出拳'}\n` +
          `💰 本金已退回双方账户`
      }

      // 编辑群组消息
      try {
        await editMessage(groupId, messageId, timeoutText, {
          reply_markup: { inline_keyboard: [] } // 移除所有按钮
        })
        console.log(`[RPS-TIMEOUT] 已更新群组消息: roomId=${roomId}, messageId=${messageId}`)

        // 发送超时通知消息
        if (timeoutMessage) {
          await sendMessage(groupId, timeoutMessage)
        }
      } catch (err) {
        console.error(`[RPS-TIMEOUT] 编辑消息失败: roomId=${roomId}`, err)
      }
    }
  } catch (err) {
    console.error('[RPS-TIMEOUT] 检查超时时发生异常:', err)
  }
}
