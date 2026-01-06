import { supabase } from '../supabaseClient.ts'
import { sendMessage, answerCallbackQuery, editMessage } from '../telegram.ts'
import { escapeHTML, sanitizeError } from '../utils/text.ts'

/**
 * 处理红包指令: hb 100 [份数] [sq]
 * 或者在回复某人时输入: hb 100
 */
export async function handleRedPacketCommand(chatId: number, text: string, message: any) {
  const officialGroupId = Deno.env.get('OFFICIAL_GROUP_ID')
  console.log(`[RedPacket-Cmd] chatId=${chatId}, officialGroupId=${officialGroupId}`)

  // 1. 验证群组权限
  if (String(chatId) !== String(officialGroupId)) {
    console.log(`[RedPacket-Cmd] 群组 ID 不匹配，跳过。`)
    // 如果不是在官方群，且不是私聊，则忽略
    if (chatId < 0) return // 群组消息，但不是官方群
  }

  const parts = text.trim().split(/\s+/)
  const cmd = parts[0].toLowerCase()
  if (cmd !== 'hb' && cmd !== '/hb') return

  console.log(`[RedPacket-Cmd] 开始解析金额...`)

  try {
    const amount = parseFloat(parts[1])
    if (isNaN(amount) || amount <= 0) {
      if (chatId > 0) await sendMessage(chatId, '❌ 请输入有效的红包金额，例如: `hb 100`')
      return
    }

    // 2. 获取发送者信息
    const { data: sender } = await supabase
      .from('profiles')
      .select('id, nickname, balance_coins')
      .eq('tg_user_id', message.from.id)
      .single()

    if (!sender) {
      await sendMessage(chatId, '❌ 您尚未在系统中注册，请先在私聊中激活机器人。')
      return
    }

    if (sender.balance_coins < amount) {
      await sendMessage(chatId, `❌ 余额不足 (当前: ${sender.balance_coins} 抖币)`)
      return
    }

    let type: 'single' | 'equal' | 'lucky' = 'equal'
    let count = 1
    let targetUserId: string | null = null
    let targetNickname: string | null = null

    // 3. 判断红包类型
    const replyTo = message.reply_to_message
    if (replyTo && replyTo.from && !replyTo.from.is_bot) {
      // 回复某人 -> 指定红包
      type = 'single'
      count = 1
      const { data: target } = await supabase
        .from('profiles')
        .select('id, nickname')
        .eq('tg_user_id', replyTo.from.id)
        .single()

      if (!target) {
        await sendMessage(chatId, '❌ 对方尚未激活机器人，无法发送指定红包。')
        return
      }
      targetUserId = target.id
      targetNickname = target.nickname
    } else {
      // 普通红包或拼手气
      count = parseInt(parts[2] || '1')
      if (isNaN(count) || count <= 0) count = 1

      if (parts[3]?.toLowerCase() === 'sq' || parts[2]?.toLowerCase() === 'sq') {
        type = 'lucky'
      } else if (count > 1) {
        type = 'equal'
      } else {
        type = 'equal' // 单人普通红包
      }
    }

    // 3.1 最小金额校验 (平均每份至少 1 抖币)
    if (amount / count < 1) {
      await sendMessage(
        chatId,
        `❌ 发送失败：平均每份红包金额不能低于 1 抖币 (当前平均: ${(amount / count).toFixed(2)})`
      )
      return
    }

    // 4. 调用 RPC 创建红包
    const { data: res, error } = await supabase.rpc('create_group_red_packet', {
      p_sender_id: sender.id,
      p_group_id: chatId,
      p_type: type,
      p_total_amount: amount,
      p_total_count: count,
      p_target_user_id: targetUserId
    })

    if (error) throw error
    if (!res.success) {
      await sendMessage(chatId, `❌ 创建红包失败: ${res.message}`)
      return
    }

    // 5. 发送红包消息
    let hbTitle = ''
    if (type === 'single') {
      hbTitle = `🧧 <b>${escapeHTML(sender.nickname)}</b> 给 <b>${escapeHTML(targetNickname || '')}</b> 发了一个专属红包`
    } else if (type === 'lucky') {
      hbTitle = `🧧 <b>${escapeHTML(sender.nickname)}</b> 发了一个拼手气红包 (${count}份)`
    } else {
      hbTitle = `🧧 <b>${escapeHTML(sender.nickname)}</b> 发了一个普通红包 (${count}份)`
    }

    const hbText =
      `${hbTitle}\n` +
      `💰 总金额：<b>${amount}</b> 抖币\n` +
      `⏳ 剩余 <b>${count}</b>/${count} 份\n\n` +
      `📜 <b>红包规则：</b>\n` +
      `• 最小限制：平均每份至少 1 抖币\n` +
      `• 退款：24小时内未领完将自动退回余额\n\n` +
      `📢 祝大家：好运连连，万事如意！`

    await sendMessage(chatId, hbText, {
      reply_markup: {
        inline_keyboard: [[{ text: '🧧 抢红包', callback_data: `hb_claim_${res.packet_id}` }]]
      }
    })
  } catch (err: any) {
    console.error('RedPacket Error:', err)
    await sendMessage(chatId, `❌ 红包发送异常: ${sanitizeError(err.message)}`)
  }
}

/**
 * 处理抢红包回调
 */
export async function handleClaimRedPacket(
  chatId: number,
  messageId: number,
  callbackQueryId: string,
  packetId: string,
  tgUserId: number
) {
  try {
    // 1. 获取抢红包者信息
    const { data: user } = await supabase
      .from('profiles')
      .select('id, nickname')
      .eq('tg_user_id', tgUserId)
      .single()

    if (!user) {
      await answerCallbackQuery(callbackQueryId, '❌ 请先在私聊中激活机器人再抢红包哦', true)
      return
    }

    // 2. 调用 RPC 抢红包
    const { data: res, error } = await supabase.rpc('claim_group_red_packet', {
      p_packet_id: packetId,
      p_user_id: user.id
    })

    if (error) throw error

    if (!res.success) {
      await answerCallbackQuery(callbackQueryId, res.message, true)
      return
    }

    // 3. 抢成功，通知用户
    const amount = res.amount
    await answerCallbackQuery(callbackQueryId, `🎊 恭喜！你抢到了 ${amount} 抖币！`, true)

    // 4. 如果红包领完了，或者有人领了（实时更新），更新消息展示领取情况
    // 为了体验更好，我们可以每次有人领都尝试更新一下消息（或者只在领完时更新）
    // 这里我们选择在领完时显示完整列表，平时只更新剩余份数

    const { data: packet } = await supabase
      .from('group_red_packets')
      .select('*, sender:profiles!group_red_packets_sender_id_fkey(nickname)')
      .eq('id', packetId)
      .single()

    if (!packet) return

    const { data: claims } = await supabase
      .from('group_red_packet_claims')
      .select('amount, created_at, user:profiles!group_red_packet_claims_user_id_fkey(nickname)')
      .eq('packet_id', packetId)
      .order('created_at', { ascending: true })

    const senderName = packet.sender?.nickname || '未知'
    let hbTitle = ''
    if (packet.type === 'single') {
      hbTitle = `🧧 <b>${escapeHTML(senderName)}</b> 的专属红包`
    } else if (packet.type === 'lucky') {
      hbTitle = `🧧 <b>${escapeHTML(senderName)}</b> 的拼手气红包`
    } else {
      hbTitle = `🧧 <b>${escapeHTML(senderName)}</b> 的普通红包`
    }

    let statusText = ''
    if (packet.status === 'completed') {
      statusText = '✨ <b>已被抢光</b> ✨'
    } else {
      statusText = `⏳ 剩余 <b>${packet.remaining_count}</b>/${packet.total_count} 份`
    }

    let claimListText = ''
    if (claims && claims.length > 0) {
      claimListText =
        '\n\n<b>领取记录：</b>\n' +
        claims
          .map((c: any, index: number) => {
            const name = c.user?.nickname || '匿名'
            return `${index + 1}. ${escapeHTML(name)} 领了 <code>${c.amount}</code> 币`
          })
          .join('\n')
    }

    const hbText =
      `${hbTitle}\n` +
      `💰 总金额：<b>${packet.total_amount}</b> 抖币\n` +
      `📊 状态：${statusText}` +
      `${claimListText}`

    // 如果领完了，移除按钮；没领完，保留按钮
    const options: any = {}
    if (packet.status !== 'completed') {
      options.reply_markup = {
        inline_keyboard: [[{ text: '🧧 抢红包', callback_data: `hb_claim_${packetId}` }]]
      }
    }

    await editMessage(chatId, messageId, hbText, options)
  } catch (err: any) {
    console.error('Claim RedPacket Error:', err)
    await answerCallbackQuery(callbackQueryId, `❌ 抢红包异常: ${sanitizeError(err.message)}`, true)
  }
}
