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
      .select('id, nickname, balance_coins, is_banned, ban_reason')
      .eq('tg_user_id', message.from.id)
      .single()

    if (!sender) {
      await sendMessage(chatId, '❌ 您尚未在系统中注册，请先在私聊中激活机器人。')
      return
    }

    if (sender.is_banned) {
      const reason = sender.ban_reason || '由于违反社区规范，您的账号已被封禁。'
      await sendMessage(chatId, `🚫 <b>您的账号已被封禁</b>\n\n原因: ${reason}`, {
        reply_to_message_id: message.message_id
      })
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

    // 4. 调用 RPC 创建红包 (先不传 origin_message_id)
    const { question, answer: verificationAnswer } = generateMathQuestion()

    const { data: res, error } = await supabase.rpc('create_group_red_packet', {
      p_sender_id: sender.id,
      p_group_id: chatId,
      p_type: type,
      p_total_amount: amount,
      p_total_count: count,
      p_target_user_id: targetUserId,
      p_verification_answer: verificationAnswer,
      p_verification_question: question
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
      `👉 <b>领取方式：回复本消息并输入正确答案</b>\n` +
      `验证题目：<b>${question}</b>\n\n` +
      `📜 <b>红包规则：</b>\n` +
      `• 退款：24小时内未领完将自动退回余额\n\n` +
      `📢 祝大家：好运连连，万事如意！`

    const sentMsg = await sendMessage(chatId, hbText)
    if (sentMsg.ok) {
      // 更新原始消息 ID
      await supabase
        .from('group_red_packets')
        .update({ origin_message_id: sentMsg.result.message_id })
        .eq('id', res.packet_id)
    }
  } catch (err: any) {
    console.error('RedPacket Error:', err)
    await sendMessage(chatId, `❌ 红包发送异常: ${sanitizeError(err.message)}`)
  }
}

/**
 * 生成数学题
 */
function generateMathQuestion() {
  const a = Math.floor(Math.random() * 9) + 1
  const b = Math.floor(Math.random() * 9) + 1
  return {
    question: `${a} + ${b} = ?`,
    answer: String(a + b)
  }
}

// 移除不再需要的 generateOptions 函数

/**
 * 处理回复消息抢红包
 */
export async function handleReplyClaimRedPacket(
  chatId: number,
  messageId: number, // 回复的消息 ID
  replyToMessageId: number, // 红包消息的 ID
  text: string,
  tgUserId: number
) {
  try {
    // 1. 获取对应的红包
    const { data: packet } = await supabase
      .from('group_red_packets')
      .select('id, verification_answer, status, remaining_count')
      .eq('group_id', chatId)
      .eq('origin_message_id', replyToMessageId)
      .single()

    if (!packet) return // 不是红包消息，或者没录入 ID

    if (packet.status !== 'active') return

    // 2. 验证答案
    const userAnswer = text.trim()
    if (packet.verification_answer && packet.verification_answer !== userAnswer) {
      // 答案错误，不予理睬或回复错误 (群组里回复太多会很吵，建议不理睬或者只针对第一个对的人发)
      return
    }

    // 3. 答案正确，尝试抢包
    // 这里我们直接复用部分逻辑，但不需要 callbackQueryId
    const { data: user } = await supabase
      .from('profiles')
      .select('id, nickname, is_banned, ban_reason')
      .eq('tg_user_id', tgUserId)
      .single()

    if (!user || user.is_banned) return

    // 调用 RPC 抢红包
    const { data: res, error } = await supabase.rpc('claim_group_red_packet', {
      p_packet_id: packet.id,
      p_user_id: user.id
    })

    if (error || !res?.success) {
      console.log(`[ReplyClaim] 抢包失败: ${res?.message || error?.message}`)
      return
    }

    // 4. 抢成功，静默更新红包主消息，不再发送新消息
    await updateRedPacketMessage(chatId, replyToMessageId, packet.id)
  } catch (err) {
    console.error('ReplyClaim Error:', err)
  }
}

/**
 * 抽取出的更新红包消息逻辑
 */
async function updateRedPacketMessage(chatId: number, messageId: number, packetId: string) {
  try {
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

    // 💡 保持显示验证题目逻辑
    let questionText = ''
    if (packet.status !== 'completed' && packet.verification_question) {
      questionText = `\n\n验证题目：<b>${packet.verification_question}</b>\n👉 <b>领取方式：回复本消息输入答案</b>`
    }

    const hbText =
      `${hbTitle}\n` +
      `💰 总金额：<b>${packet.total_amount}</b> 抖币\n` +
      `📊 状态：${statusText}${questionText}` +
      `${claimListText}`

    await editMessage(chatId, messageId, hbText)
  } catch (e) {
    console.error('Update HB Msg Error:', e)
  }
}

/**
 * 处理抢红包回调 (保留，以防万一或用于老红包)
 */
export async function handleClaimRedPacket(
  chatId: number,
  messageId: number,
  callbackQueryId: string,
  packetId: string,
  tgUserId: number,
  userAnswer?: string
) {
  try {
    // 1. 获取抢红包者信息
    const { data: user } = await supabase
      .from('profiles')
      .select('id, nickname, is_banned, ban_reason')
      .eq('tg_user_id', tgUserId)
      .single()

    if (!user) {
      await answerCallbackQuery(callbackQueryId, '❌ 请先在私聊中激活机器人再抢红包哦', true)
      return
    }

    if (user.is_banned) {
      const reason = user.ban_reason || '由于违反社区规范，您的账号已被封禁。'
      await answerCallbackQuery(callbackQueryId, `🚫 账号已封禁\n原因: ${reason}`, true)
      return
    }

    // 1.1 验证码校验
    const { data: packet } = await supabase
      .from('group_red_packets')
      .select('verification_answer, status, remaining_count')
      .eq('id', packetId)
      .single()

    if (!packet) {
      await answerCallbackQuery(callbackQueryId, '❌ 红包不存在', true)
      return
    }

    // 如果红包有验证码且用户提供的不匹配
    if (packet.verification_answer && packet.verification_answer !== userAnswer) {
      await answerCallbackQuery(callbackQueryId, '⚠️ 验证码错误，请看清题目再点哦！', true)
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

    // 4. 更新红包主消息展示领取情况
    await updateRedPacketMessage(chatId, messageId, packetId)
  } catch (err: any) {
    console.error('Claim RedPacket Error:', err)
    await answerCallbackQuery(callbackQueryId, `❌ 抢红包异常: ${sanitizeError(err.message)}`, true)
  }
}
