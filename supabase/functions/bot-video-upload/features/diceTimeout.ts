import { supabase } from '../supabaseClient.ts'
import { sendMessage } from '../telegram.ts'
import { escapeHTML } from '../utils/text.ts'

/**
 * 检查并处理骰子游戏过期房间
 * 30秒内没有人加入 → 自动解散，退款
 */
export async function checkDiceTimeout() {
  try {
    // 调用 RPC 函数检查并处理过期房间
    const { data, error } = await supabase.rpc('check_and_refund_expired_dice_rooms')

    if (error) {
      console.error('[DICE-TIMEOUT] RPC 调用失败:', error)
      return
    }

    if (!data || data.length === 0) {
      // console.log('[DICE-TIMEOUT] 无过期房间')
      return
    }

    console.log(`[DICE-TIMEOUT] 检查完成: 解散了 ${data.length} 个过期房间`)

    // 处理每个被取消的房间，发送消息
    for (const roomInfo of data) {
      const roomId = roomInfo.room_id
      const groupId = roomInfo.group_id
      const messageId = roomInfo.message_id
      const currentCount = roomInfo.current_count
      const ownerNickname = roomInfo.owner_nickname

      if (!groupId) {
        console.log(`[DICE-TIMEOUT] 跳过房间 ${roomId}: 缺少 group_id`)
        continue
      }

      // 发送过期通知消息
      let timeoutMessage = ''
      if (currentCount === 1) {
        // 只有房主一人，没有人加入
        timeoutMessage =
          `🎲 <b>骰子游戏已解散</b>\n\n` +
          `👤 房主：<b>${escapeHTML(ownerNickname || '玩家')}</b>\n` +
          `❌ 原因：没有人加入\n` +
          `💰 本金已退回`
      } else {
        // 有其他玩家加入，但过期了
        timeoutMessage =
          `🎲 <b>骰子游戏已解散</b>\n\n` +
          `👤 房主：<b>${escapeHTML(ownerNickname || '玩家')}</b>\n` +
          `❌ 原因：游戏超时\n` +
          `💰 本金已退回所有玩家`
      }

      try {
        await sendMessage(groupId, timeoutMessage)
        console.log(`[DICE-TIMEOUT] 已发送过期消息: roomId=${roomId}, groupId=${groupId}`)
      } catch (err) {
        console.error(`[DICE-TIMEOUT] 发送消息失败: roomId=${roomId}`, err)
      }
    }
  } catch (err) {
    console.error('[DICE-TIMEOUT] 检查过期时发生异常:', err)
  }
}
