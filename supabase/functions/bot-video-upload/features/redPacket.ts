import { supabase } from '../supabaseClient.ts'
import { sendMessage, answerCallbackQuery, editMessage } from '../telegram.ts'
import { escapeHTML, sanitizeError } from '../utils/text.ts'

// 🎯 批量更新机制：通过数据库控制更新频率（Edge Function 无状态，不能用内存变量）
const UPDATE_INTERVAL_MS = 5000 // 每5秒更新一次

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
    let targetTgUserId: number | null = null // 🎯 保存目标用户的 TG ID，用于 @ 提及

    // 3. 判断红包类型
    const replyTo = message.reply_to_message
    if (replyTo && replyTo.from && !replyTo.from.is_bot) {
      // 回复某人 -> 指定红包
      type = 'single'
      count = 1
      targetTgUserId = replyTo.from.id // 🎯 保存 TG ID
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
    // 🎯 专属红包不需要验证码，普通/拼手气红包需要验证码
    const { question, answer: verificationAnswer } =
      type === 'single' ? { question: '', answer: '' } : generateMathQuestion()

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
    let hbText = ''
    let keyboard: any = null

    if (type === 'single') {
      // 🎯 专属红包：使用 @ 提及，添加领取按钮
      const targetMention = targetTgUserId
        ? `<a href="tg://user?id=${targetTgUserId}">${escapeHTML(targetNickname || '未知')}</a>`
        : escapeHTML(targetNickname || '未知')

      hbText =
        `🧧 <b>${escapeHTML(sender.nickname)}</b> 给 ${targetMention} 发了一个专属红包\n` +
        `💰 金额：<b>${amount}</b> 抖币\n` +
        `⏳ 状态：<b>待领取</b>\n\n` +
        `👉 <b>点击下方按钮领取</b>\n\n` +
        `📜 <b>红包规则：</b>\n` +
        `• 仅指定用户可领取\n` +
        `• 24小时内未领取将自动退回\n\n` +
        `📢 祝你：好运连连，万事如意！`

      // 🎯 添加领取按钮（仅专属红包有按钮）
      keyboard = {
        inline_keyboard: [
          [
            {
              text: '🎁 点击领取红包',
              callback_data: `claim_hb:${res.packet_id}`
            }
          ]
        ]
      }
    } else if (type === 'lucky') {
      hbText =
        `🧧 <b>${escapeHTML(sender.nickname)}</b> 发了一个拼手气红包 (${count}份)\n` +
        `💰 总金额：<b>${amount}</b> 抖币\n` +
        `⏳ 剩余 <b>${count}</b>/${count} 份\n\n` +
        `👉 <b>领取方式：回复本消息并输入正确答案</b>\n` +
        `验证题目：<b>${question}</b>\n\n` +
        `📜 <b>红包规则：</b>\n` +
        `• 退款：24小时内未领完将自动退回余额\n\n` +
        `📢 祝大家：好运连连，万事如意！`
    } else {
      hbText =
        `🧧 <b>${escapeHTML(sender.nickname)}</b> 发了一个普通红包 (${count}份)\n` +
        `💰 总金额：<b>${amount}</b> 抖币\n` +
        `⏳ 剩余 <b>${count}</b>/${count} 份\n\n` +
        `👉 <b>领取方式：回复本消息并输入正确答案</b>\n` +
        `验证题目：<b>${question}</b>\n\n` +
        `📜 <b>红包规则：</b>\n` +
        `• 退款：24小时内未领完将自动退回余额\n\n` +
        `📢 祝大家：好运连连，万事如意！`
    }

    const sentMsg = keyboard
      ? await sendMessage(chatId, hbText, { reply_markup: keyboard })
      : await sendMessage(chatId, hbText)

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

    console.log(
      `[ReplyClaim] ✅ 抢包成功: userId=${user.id.substring(0, 8)}, amount=${res.amount}, packetId=${packet.id.substring(0, 8)}`
    )

    // 4. 抢成功，使用批量更新机制（基于剩余数量）
    // 重新获取最新红包状态来判断是否需要更新
    const { data: latestPacket } = await supabase
      .from('group_red_packets')
      .select('status, remaining_count, total_count')
      .eq('id', packet.id)
      .single()

    const isCompleted = latestPacket?.status === 'completed'
    const remainingCount = latestPacket?.remaining_count || 0
    const totalCount = latestPacket?.total_count || 1

    console.log(
      `[ReplyClaim] 📊 红包状态: 剩余=${remainingCount}/${totalCount}, 已完成=${isCompleted}`
    )

    await scheduleUpdateRedPacketMessage(
      chatId,
      replyToMessageId,
      packet.id,
      isCompleted,
      remainingCount,
      totalCount
    )
  } catch (err) {
    console.error('ReplyClaim Error:', err)
  }
}

/**
 * 🎯 批量更新红包消息（基于剩余数量）
 * Edge Function 是无状态的，不能用内存变量（Map）来控制更新频率
 * 改为基于剩余数量：每减少 N 个人更新一次
 * - 每20个人更新一次
 * - 红包抢完立即更新
 */
async function scheduleUpdateRedPacketMessage(
  chatId: number,
  messageId: number,
  packetId: string,
  isCompleted: boolean,
  remainingCount: number,
  totalCount: number
) {
  const key = `${chatId}_${messageId}`

  // 🎯 如果红包已抢完，立即更新
  if (isCompleted) {
    console.log(`[RedPacket] 🎉 红包抢完，立即更新: ${key}`)
    await updateRedPacketMessage(chatId, messageId, packetId)
    return
  }

  // 🎯 计算已领取人数
  const claimedCount = totalCount - remainingCount

  // 🎯 更新条件：
  // 1. 每20个人更新一次（claimed 是 20 的倍数）
  // 2. 第一个人抢到时也更新（claimedCount === 1）
  const shouldUpdate = claimedCount === 1 || claimedCount % 20 === 0

  if (shouldUpdate) {
    console.log(`[RedPacket] 📊 触发更新: ${key}, 已领=${claimedCount}/${totalCount}`)
    await updateRedPacketMessage(chatId, messageId, packetId)
  } else {
    console.log(
      `[RedPacket] ⏭️ 跳过更新: ${key}, 已领=${claimedCount}/${totalCount}，等待下一个批次`
    )
  }
}

/**
 * 抽取出的更新红包消息逻辑
 */
async function updateRedPacketMessage(chatId: number, messageId: number, packetId: string) {
  try {
    console.log(`[RedPacket] 📊 开始更新红包消息: packetId=${packetId.substring(0, 8)}`)

    // 🎯 强制刷新查询，添加时间戳避免缓存
    const timestamp = Date.now()
    const { data: packet } = await supabase
      .from('group_red_packets')
      .select(
        `
        *, 
        sender:profiles!group_red_packets_sender_id_fkey(nickname),
        target:profiles!group_red_packets_target_user_id_fkey(nickname, tg_user_id)
      `
      )
      .eq('id', packetId)
      .single()

    if (!packet) {
      console.log(`[RedPacket] ⚠️ 未找到红包: ${packetId.substring(0, 8)}`)
      return
    }

    const { data: claims, error: claimsError } = await supabase
      .from('group_red_packet_claims')
      .select('amount, created_at, user:profiles!group_red_packet_claims_user_id_fkey(nickname)')
      .eq('packet_id', packetId)
      .order('created_at', { ascending: true })

    console.log(
      `[RedPacket] 📊 查询结果: 已领取=${claims?.length || 0}人, 剩余=${packet.remaining_count}/${packet.total_count}, 状态=${packet.status}`
    )

    if (claimsError) {
      console.error(`[RedPacket] ❌ 查询领取记录失败:`, claimsError)
    }

    const senderName = packet.sender?.nickname || '未知'

    // 🎯 专属红包单独处理（不显示验证题目和领取记录列表）
    if (packet.type === 'single') {
      const isCompleted = packet.status === 'completed'
      const claimInfo = claims && claims.length > 0 ? claims[0] : null
      const claimerName = claimInfo?.user?.nickname || '未知'

      // 🎯 获取目标用户信息用于 @ 提及
      const targetUser = packet.target as any
      const targetNickname = targetUser?.nickname || '未知'
      const targetTgUserId = targetUser?.tg_user_id
      const targetMention = targetTgUserId
        ? `<a href="tg://user?id=${targetTgUserId}">${escapeHTML(targetNickname)}</a>`
        : escapeHTML(targetNickname)

      let hbText = ''
      let keyboard: any = null

      if (isCompleted) {
        // 已领取：移除按钮
        hbText =
          `🧧 <b>${escapeHTML(senderName)}</b> 给 ${targetMention} 的专属红包\n` +
          `💰 金额：<b>${packet.total_amount}</b> 抖币\n` +
          `📊 状态：✨ <b>已被领取</b> ✨\n\n` +
          `🎉 <b>${escapeHTML(claimerName)}</b> 领了 <code>${claimInfo?.amount || packet.total_amount}</code> 抖币`
        keyboard = { inline_keyboard: [] } // 🎯 移除所有按钮
      } else {
        // 待领取：保留按钮
        hbText =
          `🧧 <b>${escapeHTML(senderName)}</b> 给 ${targetMention} 的专属红包\n` +
          `💰 金额：<b>${packet.total_amount}</b> 抖币\n` +
          `📊 状态：<b>待领取</b>`
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
      }

      await editMessage(chatId, messageId, hbText, { reply_markup: keyboard })
      return
    }

    // 🎯 普通红包和拼手气红包的处理逻辑
    let hbTitle = ''
    if (packet.type === 'lucky') {
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

    // 💡 保持显示验证题目逻辑（只对未完成的普通/拼手气红包）
    let questionText = ''
    if (packet.status !== 'completed' && packet.verification_question) {
      questionText = `\n\n验证题目：<b>${packet.verification_question}</b>\n👉 <b>领取方式：回复本消息输入答案</b>`
    }

    // 🎯 智能分割消息：如果领取记录太多，分多条消息发送
    const baseText =
      `${hbTitle}\n` +
      `💰 总金额：<b>${packet.total_amount}</b> 抖币\n` +
      `📊 状态：${statusText}${questionText}`

    if (claims && claims.length > 0) {
      const MAX_MESSAGE_LENGTH = 4000 // 留96字符余量
      const currentText = baseText + '\n\n<b>领取记录：</b>\n'

      // 逐条添加领取记录
      const recordTexts: string[] = []
      for (let i = 0; i < claims.length; i++) {
        const c = claims[i]
        const name = c.user?.nickname || '匿名'
        const recordLine = `${i + 1}. ${escapeHTML(name)} 领了 <code>${c.amount}</code> 币\n`
        recordTexts.push(recordLine)
      }

      // 第一条消息：尽可能多地包含记录
      let firstMessageRecords = ''
      let splitIndex = 0

      for (let i = 0; i < recordTexts.length; i++) {
        const testText = currentText + firstMessageRecords + recordTexts[i]
        if (testText.length > MAX_MESSAGE_LENGTH) {
          // 超过限制，停止添加
          splitIndex = i
          break
        }
        firstMessageRecords += recordTexts[i]
        splitIndex = i + 1
      }

      // 编辑原消息
      const firstMessage = currentText + firstMessageRecords
      await editMessage(chatId, messageId, firstMessage)

      // 如果还有剩余记录，发送新消息
      if (splitIndex < recordTexts.length) {
        let additionalText = `<b>领取记录（续）：</b>\n`

        for (let i = splitIndex; i < recordTexts.length; i++) {
          const testText = additionalText + recordTexts[i]

          // 如果这条消息也快满了，先发送当前的，再开始新的
          if (testText.length > MAX_MESSAGE_LENGTH) {
            await sendMessage(chatId, additionalText, { reply_to_message_id: messageId })
            additionalText = `<b>领取记录（续${Math.floor(i / 50) + 1}）：</b>\n` + recordTexts[i]
          } else {
            additionalText += recordTexts[i]
          }
        }

        // 发送最后一批
        if (additionalText.length > 20) {
          await sendMessage(chatId, additionalText, { reply_to_message_id: messageId })
        }
      }
    } else {
      // 没有领取记录，直接编辑原消息
      await editMessage(chatId, messageId, baseText)
    }
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

    // 4. 使用批量更新机制（基于剩余数量）
    const { data: latestPacket } = await supabase
      .from('group_red_packets')
      .select('status, remaining_count, total_count')
      .eq('id', packetId)
      .single()

    const isCompleted = latestPacket?.status === 'completed'
    const remainingCount = latestPacket?.remaining_count || 0
    const totalCount = latestPacket?.total_count || 1

    await scheduleUpdateRedPacketMessage(
      chatId,
      messageId,
      packetId,
      isCompleted,
      remainingCount,
      totalCount
    )
  } catch (err: any) {
    console.error('Claim RedPacket Error:', err)
    await answerCallbackQuery(callbackQueryId, `❌ 抢红包异常: ${sanitizeError(err.message)}`, true)
  }
}
