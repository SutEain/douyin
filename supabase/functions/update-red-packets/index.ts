/**
 * 批量更新红包消息 Edge Function
 *
 * 定时任务：每5秒触发一次
 * 作用：避免 Telegram API 速率限制（30次/秒）
 *
 * 触发方式：
 * 1. Supabase Cron Jobs（推荐）
 * 2. 外部定时器（如 Cloudflare Workers Cron）
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TG_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

/**
 * 发送 Telegram API 请求
 */
async function telegramRequest(method: string, params: any) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
  return await response.json()
}

/**
 * 编辑消息
 */
async function editMessage(chatId: number, messageId: number, text: string, replyMarkup?: any) {
  return await telegramRequest('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    reply_markup: replyMarkup
  })
}

/**
 * 编辑图片消息的 caption
 */
async function editMessageCaption(
  chatId: number,
  messageId: number,
  caption: string,
  replyMarkup?: any
) {
  return await telegramRequest('editMessageCaption', {
    chat_id: chatId,
    message_id: messageId,
    caption,
    parse_mode: 'HTML',
    reply_markup: replyMarkup
  })
}

/**
 * HTML 转义
 */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 更新单个红包消息
 */
async function updateSingleRedPacket(packetId: string, groupId: number, messageId: number) {
  try {
    console.log(`[Update] 🔄 开始更新红包 packetId=${packetId}`)

    // 获取红包完整信息
    const { data: packet, error } = await supabase
      .from('group_red_packets')
      .select(
        `
        *,
        sender:profiles!group_red_packets_sender_id_fkey(nickname),
        claims:group_red_packet_claims!group_red_packet_claims_packet_id_fkey(
          amount,
          claimed_at,
          is_best_luck,
          user:profiles!group_red_packet_claims_user_id_fkey(nickname)
        )
      `
      )
      .eq('id', packetId)
      .order('claimed_at', { foreignTable: 'group_red_packet_claims', ascending: true })
      .single()

    if (error) {
      console.error(`[Update] ❌ 查询红包失败:`, error)
      console.error(`[Update] 错误详情:`, JSON.stringify(error, null, 2))
      return false
    }

    if (!packet) {
      console.error(`[Update] ❌ 红包不存在: packetId=${packetId}`)
      return false
    }

    console.log(`[Update] ✅ 查询成功 type=${packet.type}, claims=${packet.claims?.length || 0}`)

    const typeText =
      packet.type === 'lucky' ? '拼手气红包' : packet.type === 'single' ? '专属红包' : '普通红包'
    const senderName = packet.sender?.nickname || '未知'

    let hbText = ''

    // 专属红包特殊处理
    if (packet.type === 'single') {
      const isCompleted = packet.status === 'completed'
      const claimInfo = packet.claims && packet.claims.length > 0 ? packet.claims[0] : null
      const claimerName = claimInfo?.user?.nickname || '未知'

      hbText =
        `🧧 <b>${escapeHTML(senderName)}</b> 的专属红包\n` +
        `💰 金额：<b>${packet.total_amount}</b> 抖币\n` +
        `⏳ 状态：${isCompleted ? '<b>已领取</b> ✅' : '<b>待领取</b> ⏰'}\n\n`

      if (isCompleted) {
        hbText += `🎁 <b>${escapeHTML(claimerName)}</b> 已领取红包`
      }

      // 🎯 专属红包按钮逻辑
      let keyboard: any = null
      if (!isCompleted) {
        keyboard = {
          inline_keyboard: [
            [
              {
                text: '🎁 点击领取红包',
                callback_data: `claim_hb:${packetId}`
              }
            ]
          ]
        }
      } else {
        keyboard = { inline_keyboard: [] }
      }

      // 🎯 尝试编辑消息：先尝试文本消息，如果失败则尝试图片消息的 caption
      let editResult = await editMessage(groupId, messageId, hbText, keyboard)

      if (!editResult.ok) {
        // 如果编辑文本消息失败，可能是图片消息，尝试编辑 caption
        console.log(`[Update] 专属红包文本消息编辑失败，尝试编辑图片 caption...`)
        editResult = await editMessageCaption(groupId, messageId, hbText, keyboard)

        if (!editResult.ok) {
          console.error(`[Update] ❌ 专属红包编辑消息失败:`, editResult)
          return false
        }
      }

      return true
    }

    // 普通红包和拼手气红包
    const statusText =
      packet.status === 'completed'
        ? '✨ <b>已被抢光</b> ✨'
        : `⏳ 剩余 <b>${packet.remaining_count}</b>/${packet.total_count} 份`

    // 手气最佳显示（仅拼手气红包）
    let bestLuckText = ''
    if (packet.type === 'lucky' && packet.claims && packet.claims.length > 0) {
      const bestClaim = packet.claims.find((c) => c.is_best_luck)
      if (bestClaim) {
        bestLuckText = `\n🏆 <b>手气最佳：</b>${escapeHTML(bestClaim.user?.nickname || '未知')} (${bestClaim.amount}抖币)\n`
      }
    }

    // 领取记录（紧凑型格式）
    let claimsText = ''
    if (packet.claims && packet.claims.length > 0) {
      const MAX_CHARS = 3900
      claimsText = '\n🎁 <b>领取记录</b>：\n'

      let currentLength = statusText.length + bestLuckText.length + claimsText.length + 200 // 预留空间
      let displayCount = 0

      for (let i = 0; i < packet.claims.length; i++) {
        const c = packet.claims[i]
        const name = c.user?.nickname || '未知'
        const isBest = c.is_best_luck ? ' 🏆' : ''
        const line = `${i + 1}. ${escapeHTML(name)} - ${c.amount}抖币${isBest}\n`

        if (currentLength + line.length > MAX_CHARS) {
          const remaining = packet.claims.length - displayCount
          claimsText += `\n<i>... 还有 ${remaining} 人</i>`
          break
        }

        claimsText += line
        currentLength += line.length
        displayCount++
      }
    }

    // 🎯 普通/手气红包不再显示题目（题目在私聊发送）

    // 🎯 根据红包状态决定是否显示按钮
    let keyboard: any = null
    if (packet.status === 'active' && packet.remaining_count > 0) {
      // 红包未完成且有剩余，保留按钮
      keyboard = {
        inline_keyboard: [
          [
            {
              text: '🎁 点击领取红包',
              callback_data: `claim_hb:${packetId}`
            }
          ]
        ]
      }
    } else {
      // 红包已完成，移除按钮
      keyboard = { inline_keyboard: [] }
    }

    // 组合最终消息
    hbText =
      `🧧 <b>${escapeHTML(senderName)}</b> 的${typeText} (${packet.total_count}份)\n` +
      `💰 总金额：<b>${packet.total_amount}</b> 抖币\n` +
      `${statusText}${bestLuckText}${claimsText}`

    // 🎯 尝试编辑消息：先尝试文本消息，如果失败则尝试图片消息的 caption
    let editResult = await editMessage(groupId, messageId, hbText, keyboard)

    if (!editResult.ok) {
      // 如果编辑文本消息失败，可能是图片消息，尝试编辑 caption
      console.log(`[Update] 文本消息编辑失败，尝试编辑图片 caption...`)
      const { editMessageCaption } = await import('../bot-video-upload/telegram.ts')
      editResult = await editMessageCaption(groupId, messageId, hbText, keyboard)

      if (!editResult.ok) {
        console.error(`[Update] ❌ 编辑消息失败:`, editResult)
        return false
      }
    }

    console.log(`[Update] ✅ 更新成功: ${packetId}`)
    return true
  } catch (err: any) {
    console.error(`[Update] ❌ 更新失败: ${packetId}`, err.message)
    return false
  }
}

/**
 * 主函数
 */
Deno.serve(async (req) => {
  try {
    console.log('[BatchUpdate] 🔄 开始批量更新红包消息...')

    // 直接查询需要更新的红包队列
    const { data: queue, error } = await supabase
      .from('red_packet_update_queue')
      .select(
        `
        packet_id,
        group_red_packets!inner(group_id, origin_message_id)
      `
      )
      .eq('needs_update', true)
      .lt('last_updated_at', new Date(Date.now() - 5000).toISOString())
      .limit(10)

    if (error) {
      console.error('[BatchUpdate] ❌ 查询失败:', error)
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500
      })
    }

    if (!queue || queue.length === 0) {
      console.log('[BatchUpdate] ✅ 无需更新的红包')
      return new Response(JSON.stringify({ success: true, updated: 0 }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    console.log(`[BatchUpdate] 📝 发现 ${queue.length} 个红包需要更新`)

    let successCount = 0

    // 逐个更新（间隔200ms，避免速率限制）
    for (const item of queue) {
      const redPacket = item.group_red_packets
      if (!redPacket) {
        console.log(`[BatchUpdate] ⏭️ 跳过：红包数据不完整`)
        continue
      }

      const success = await updateSingleRedPacket(
        item.packet_id,
        redPacket.group_id,
        redPacket.origin_message_id
      )

      if (success) {
        successCount++
        // 标记已更新
        await supabase
          .from('red_packet_update_queue')
          .update({
            needs_update: false,
            last_updated_at: new Date().toISOString()
          })
          .eq('packet_id', item.packet_id)
      }

      // 间隔200ms，避免触发TG速率限制
      await new Promise((r) => setTimeout(r, 200))
    }

    console.log(`[BatchUpdate] ✅ 完成！成功更新 ${successCount}/${queue.length} 个红包`)

    return new Response(
      JSON.stringify({
        success: true,
        total: queue.length,
        updated: successCount
      }),
      {
        headers: { 'Content-Type': 'application/json' }
      }
    )
  } catch (err: any) {
    console.error('[BatchUpdate] ❌ 异常:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    })
  }
})
