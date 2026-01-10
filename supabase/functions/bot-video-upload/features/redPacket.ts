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
    // 🎯 专属红包不需要验证码，普通/拼手气红包需要验证码（按钮模式）
    const mathQuestion = type === 'single' ? null : generateMathQuestion()
    const verificationAnswer = mathQuestion ? String(mathQuestion.answer) : ''
    const question = mathQuestion ? mathQuestion.question : ''

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

    const packetId = res.packet_id

    // 5. 发送红包消息
    let hbText = ''
    let keyboard: any = null

    if (type === 'single') {
      // 🎯 专属红包：使用 @ 提及，直接点击领取（不需要答题）
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
      // 🎯 普通红包/拼手气红包：回复消息答题模式
      const typeText = type === 'lucky' ? '拼手气红包' : '普通红包'

      hbText =
        `🧧 <b>${escapeHTML(sender.nickname)}</b> 发了一个${typeText} (${count}份)\n` +
        `💰 总金额：<b>${amount}</b> 抖币\n` +
        `⏳ 剩余 <b>${count}</b>/${count} 份\n\n` +
        `❓ <b>验证题目：${question}</b>\n` +
        `👉 <b>领取方式：回复本消息并输入正确答案</b>\n\n` +
        `📜 <b>红包规则：</b>\n` +
        `• 24小时内未领完将自动退回\n\n` +
        `📢 祝大家：好运连连，万事如意！`

      // 不使用按钮，用户需要回复消息
      keyboard = null
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
 * 生成数学题（加减乘除，结果0-100）
 */
function generateMathQuestion() {
  const operators = ['+', '-', '×', '÷']
  let a: number, b: number, op: string, correctAnswer: number
  let attempts = 0

  do {
    attempts++
    if (attempts > 100) {
      // 防止死循环，给个默认简单题
      a = 5
      b = 3
      op = '+'
      correctAnswer = 8
      break
    }

    op = operators[Math.floor(Math.random() * operators.length)]

    switch (op) {
      case '+':
        a = Math.floor(Math.random() * 50) + 1 // 1-50
        b = Math.floor(Math.random() * 50) + 1 // 1-50
        correctAnswer = a + b
        break

      case '-':
        // 确保结果为正数
        a = Math.floor(Math.random() * 90) + 10 // 10-99
        b = Math.floor(Math.random() * (a - 1)) + 1 // 1 到 a-1
        correctAnswer = a - b
        break

      case '×':
        // 限制乘法范围，避免结果太大
        a = Math.floor(Math.random() * 10) + 1 // 1-10
        b = Math.floor(Math.random() * 10) + 1 // 1-10
        correctAnswer = a * b
        break

      case '÷':
        // 确保整除
        b = Math.floor(Math.random() * 9) + 2 // 2-10
        correctAnswer = Math.floor(Math.random() * 10) + 1 // 1-10
        a = b * correctAnswer
        break

      default:
        a = 5
        b = 3
        op = '+'
        correctAnswer = 8
    }
  } while (correctAnswer < 0 || correctAnswer > 100)

  return {
    question: `${a} ${op} ${b} = ?`,
    answer: correctAnswer
  }
}

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
  console.log(
    `[RedPacket-Reply] 🎁 收到回复领取 tgUserId=${tgUserId}, answer=${text.trim()}, replyMsgId=${replyToMessageId}`
  )

  try {
    // 1. 获取对应的红包
    console.log(`[RedPacket-Reply] 步骤1: 查询红包 replyMsgId=${replyToMessageId}`)
    const { data: packet } = await supabase
      .from('group_red_packets')
      .select('id, verification_answer, status, remaining_count, total_count')
      .eq('group_id', chatId)
      .eq('origin_message_id', replyToMessageId)
      .single()

    if (!packet) {
      console.log(`[RedPacket-Reply] ⏭️ 不是红包消息或未找到`)
      return // 不是红包消息，或者没录入 ID
    }

    console.log(`[RedPacket-Reply] ✅ 找到红包 packetId=${packet.id}, status=${packet.status}`)

    if (packet.status !== 'active') {
      console.log(`[RedPacket-Reply] ⏭️ 红包状态不是 active: ${packet.status}`)
      return
    }

    // 2. 验证答案
    const userAnswer = text.trim()
    console.log(
      `[RedPacket-Reply] 步骤2: 验证答案 correct=${packet.verification_answer}, user=${userAnswer}`
    )

    if (packet.verification_answer && packet.verification_answer !== userAnswer) {
      console.log(`[RedPacket-Reply] ❌ 答案错误，静默处理`)
      // 答案错误，不予理睬或回复错误 (群组里回复太多会很吵，建议不理睬或者只针对第一个对的人发)
      return
    }

    console.log(`[RedPacket-Reply] ✅ 答案正确，开始调用 RPC`)

    // 3. 答案正确，尝试抢包
    console.log(`[RedPacket-Reply] 步骤3: 查询用户信息 tgUserId=${tgUserId}`)
    const { data: user } = await supabase
      .from('profiles')
      .select('id, nickname, is_banned, ban_reason')
      .eq('tg_user_id', tgUserId)
      .single()

    if (!user) {
      console.log(`[RedPacket-Reply] ❌ 用户不存在`)
      return
    }

    if (user.is_banned) {
      console.log(`[RedPacket-Reply] ❌ 用户已被封禁: ${user.ban_reason}`)
      return
    }

    console.log(`[RedPacket-Reply] ✅ 用户信息: userId=${user.id}, nickname=${user.nickname}`)

    // 调用 RPC 抢红包
    console.log(`[RedPacket-Reply] 步骤4: 调用 RPC claim_group_red_packet`)
    const { data: rpcResult, error: rpcError } = await supabase.rpc('claim_group_red_packet', {
      p_packet_id: packet.id,
      p_user_id: user.id
    })

    if (rpcError) {
      console.error(`[RedPacket-Reply] ❌ RPC 调用失败:`, rpcError)
      return
    }

    console.log(`[RedPacket-Reply] RPC 返回结果:`, rpcResult)

    // 🎯 RPC 返回的是数组，需要取第一个元素
    const res = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult

    if (!res || !res.success) {
      const errorMsg = res?.message || '领取失败'
      console.log(`[RedPacket-Reply] ❌ 领取失败: ${errorMsg}`)
      return
    }

    console.log(
      `[RedPacket-Reply] 🎊 领取成功! userId=${user.id}, amount=${res.amount}, isBestLuck=${res.is_best_luck}`
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

    // 🎯 加入更新队列（5秒批量更新机制）
    console.log(`[RedPacket-Reply] 加入更新队列 remaining=${remainingCount}/${totalCount}`)
    await supabase.from('red_packet_update_queue').upsert(
      {
        packet_id: packet.id,
        needs_update: true,
        remaining_count: remainingCount,
        total_count: totalCount
      },
      {
        onConflict: 'packet_id'
      }
    )

    // 🎯 只在红包抢完时立即更新（必须立即通知）
    if (isCompleted) {
      console.log(`[RedPacket-Reply] 🎉 红包抢完，立即更新消息`)
      try {
        await updateRedPacketMessageNow(chatId, replyToMessageId, packet.id)
        console.log(`[RedPacket-Reply] ✅ 立即更新完成`)
      } catch (updateErr) {
        console.error(`[RedPacket-Reply] ❌ 立即更新失败:`, updateErr)
      }
    } else {
      console.log(`[RedPacket-Reply] ⏳ 等待批量更新（每5秒一次）`)
    }
  } catch (err) {
    console.error('[RedPacket-Reply] ❌ 领取异常:', err)
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
 * 处理抢红包回调（新版：按钮模式 + 10秒冷却机制）
 */
export async function handleClaimRedPacket(
  chatId: number,
  messageId: number,
  callbackQueryId: string,
  packetId: string,
  tgUserId: number,
  userAnswer?: string
) {
  console.log(
    `[RedPacket] 🎁 开始处理领取请求: packetId=${packetId}, tgUserId=${tgUserId}, answer=${userAnswer}`
  )

  try {
    // 1. 获取抢红包者信息
    console.log(`[RedPacket] 步骤1: 查询用户信息 tgUserId=${tgUserId}`)
    const { data: user } = await supabase
      .from('profiles')
      .select('id, nickname, is_banned, ban_reason')
      .eq('tg_user_id', tgUserId)
      .single()

    if (!user) {
      console.log(`[RedPacket] ❌ 用户不存在: tgUserId=${tgUserId}`)
      await answerCallbackQuery(callbackQueryId, '❌ 请先在私聊中激活机器人', true)
      return
    }

    console.log(`[RedPacket] ✅ 用户信息: userId=${user.id}, nickname=${user.nickname}`)

    if (user.is_banned) {
      const reason = user.ban_reason || '由于违反社区规范，您的账号已被封禁。'
      console.log(`[RedPacket] ❌ 用户已封禁: userId=${user.id}, reason=${reason}`)
      await answerCallbackQuery(callbackQueryId, `🚫 账号已封禁\n${reason}`, true)
      return
    }

    // 2. 🎯 检查冷却期（答错后10秒内不能再点）
    console.log(`[RedPacket] 步骤2: 检查冷却期 packetId=${packetId}, userId=${user.id}`)
    const { data: wrongAttempt } = await supabase
      .from('red_packet_wrong_attempts')
      .select('can_retry_at, attempt_count')
      .eq('packet_id', packetId)
      .eq('user_id', user.id)
      .single()

    if (wrongAttempt) {
      const now = new Date()
      const canRetryAt = new Date(wrongAttempt.can_retry_at)
      if (now < canRetryAt) {
        const waitSeconds = Math.ceil((canRetryAt.getTime() - now.getTime()) / 1000)
        console.log(`[RedPacket] ⏳ 用户在冷却期: userId=${user.id}, 剩余${waitSeconds}秒`)
        await answerCallbackQuery(
          callbackQueryId,
          `⏳ 答案错误！请等待 ${waitSeconds} 秒后重试`,
          true
        )
        return
      }
      console.log(`[RedPacket] ✅ 冷却期已过`)
    }

    // 3. 获取红包信息
    console.log(`[RedPacket] 步骤3: 查询红包信息 packetId=${packetId}`)
    const { data: packet, error: packetError } = await supabase
      .from('group_red_packets')
      .select('verification_answer, status, remaining_count, type, target_user_id')
      .eq('id', packetId)
      .single()

    if (packetError) {
      console.error(`[RedPacket] ❌ 查询红包失败:`, packetError)
      await answerCallbackQuery(callbackQueryId, `❌ 查询失败: ${packetError.message}`, true)
      return
    }

    if (!packet) {
      console.log(`[RedPacket] ❌ 红包不存在: packetId=${packetId}`)
      await answerCallbackQuery(callbackQueryId, '❌ 红包不存在', true)
      return
    }

    console.log(
      `[RedPacket] ✅ 红包信息: type=${packet.type}, status=${packet.status}, remaining=${packet.remaining_count}, target_user_id=${packet.target_user_id}`
    )

    if (packet.status !== 'active') {
      const msg = packet.status === 'completed' ? '🎈 来晚了，红包已被抢光' : '❌ 红包已过期'
      console.log(`[RedPacket] ❌ 红包状态异常: status=${packet.status}`)
      await answerCallbackQuery(callbackQueryId, msg, true)
      return
    }

    // 4. 🎯 验证答案（专属红包不需要验证）
    console.log(
      `[RedPacket] 步骤4: 验证答案 type=${packet.type}, correctAnswer=${packet.verification_answer}, userAnswer=${userAnswer}`
    )

    if (
      packet.type !== 'single' &&
      packet.verification_answer &&
      packet.verification_answer !== userAnswer
    ) {
      // 答案错误，记录冷却时间
      console.log(`[RedPacket] ❌ 答案错误! userId=${user.id}, 记录冷却10秒`)
      await supabase.from('red_packet_wrong_attempts').upsert(
        {
          packet_id: packetId,
          user_id: user.id,
          tg_user_id: tgUserId,
          wrong_at: new Date().toISOString(),
          can_retry_at: new Date(Date.now() + 10000).toISOString(), // 10秒后
          attempt_count: (wrongAttempt?.attempt_count || 0) + 1
        },
        {
          onConflict: 'packet_id,user_id'
        }
      )

      await answerCallbackQuery(callbackQueryId, '❌ 答案错误！请等待10秒后重试', true)
      return
    }

    console.log(`[RedPacket] ✅ 答案验证通过，开始调用 RPC 领取红包`)

    // 5. 答案正确，调用 RPC 领取红包
    console.log(
      `[RedPacket] 步骤5: 调用 RPC claim_group_red_packet packetId=${packetId}, userId=${user.id}`
    )
    const { data: rpcResult, error } = await supabase.rpc('claim_group_red_packet', {
      p_packet_id: packetId,
      p_user_id: user.id
    })

    if (error) {
      console.error(`[RedPacket] ❌ RPC 调用失败:`, error)
      throw error
    }

    console.log(`[RedPacket] RPC 返回结果:`, rpcResult)

    // 🎯 RPC 返回的是数组，需要取第一个元素
    const res = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult

    if (!res || !res.success) {
      const errorMsg = res?.message || '领取失败'
      console.log(`[RedPacket] ❌ 领取失败: ${errorMsg}`)
      await answerCallbackQuery(callbackQueryId, errorMsg, true)
      return
    }

    // 6. 领取成功
    const amount = res.amount
    const isBestLuck = res.is_best_luck || false

    console.log(
      `[RedPacket] 🎊 领取成功! userId=${user.id}, amount=${amount}, isBestLuck=${isBestLuck}`
    )

    let successMsg = `🎊 恭喜！抢到 ${amount} 抖币！`
    if (isBestLuck) {
      successMsg = `🏆 恭喜！抢到 ${amount} 抖币！\n🎉 你是手气最佳！`
    }

    await answerCallbackQuery(callbackQueryId, successMsg, true)

    // 7. 删除错误记录（答对了就清除冷却）
    console.log(`[RedPacket] 步骤7: 清除冷却记录 userId=${user.id}`)
    await supabase
      .from('red_packet_wrong_attempts')
      .delete()
      .eq('packet_id', packetId)
      .eq('user_id', user.id)

    // 8. 🎯 标记需要更新（加入更新队列，不立即更新）
    const newRemaining = packet.remaining_count - 1
    console.log(
      `[RedPacket] 步骤8: 加入更新队列 oldRemaining=${packet.remaining_count}, newRemaining=${newRemaining}`
    )

    await supabase.from('red_packet_update_queue').upsert(
      {
        packet_id: packetId,
        needs_update: true,
        remaining_count: newRemaining,
        total_count: packet.remaining_count
      },
      {
        onConflict: 'packet_id'
      }
    )

    // 9. 🎯 如果红包抢完了，立即更新消息
    console.log(
      `[RedPacket] 步骤9: 检查是否需要立即更新 newRemaining=${newRemaining}, isZero=${newRemaining <= 0}, isLessThan10=${packet.remaining_count <= 10}`
    )

    if (newRemaining <= 0) {
      console.log(`[RedPacket] 🎉 红包已抢完，立即更新消息 chatId=${chatId}, msgId=${messageId}`)
      try {
        await updateRedPacketMessageNow(chatId, messageId, packetId)
        console.log(`[RedPacket] ✅ 立即更新完成`)
      } catch (updateErr) {
        console.error(`[RedPacket] ❌ 立即更新失败:`, updateErr)
      }
    } else if (packet.remaining_count <= 10) {
      console.log(`[RedPacket] 📊 剩余<10份，立即更新消息`)
      try {
        await updateRedPacketMessageNow(chatId, messageId, packetId)
        console.log(`[RedPacket] ✅ 立即更新完成`)
      } catch (updateErr) {
        console.error(`[RedPacket] ❌ 立即更新失败:`, updateErr)
      }
    } else {
      console.log(`[RedPacket] ⏳ 不触发立即更新，等待批量更新`)
    }

    console.log(`[RedPacket] ✅ 领取流程完成 userId=${user.id}`)
  } catch (err: any) {
    console.error('[RedPacket] ❌ 领取异常:', err)
    console.error('[RedPacket] 错误详情:', JSON.stringify(err, null, 2))
    await answerCallbackQuery(callbackQueryId, `❌ ${sanitizeError(err.message)}`, true)
  }
}

/**
 * 立即更新红包消息（用于抢完或剩余<10份时）
 */
async function updateRedPacketMessageNow(chatId: number, messageId: number, packetId: string) {
  console.log(
    `[RedPacket-Update] 🔄 开始更新红包消息 chatId=${chatId}, msgId=${messageId}, packetId=${packetId}`
  )

  try {
    // 先简单查询红包是否存在
    console.log(`[RedPacket-Update] 查询红包基本信息...`)
    const { data: basicPacket, error: basicError } = await supabase
      .from('group_red_packets')
      .select('id, type, status, sender_id')
      .eq('id', packetId)
      .single()

    if (basicError) {
      console.error(`[RedPacket-Update] ❌ 基本查询失败:`, basicError)
      return
    }

    if (!basicPacket) {
      console.log(`[RedPacket-Update] ❌ 红包不存在 packetId=${packetId}`)
      return
    }

    console.log(`[RedPacket-Update] ✅ 基本信息查询成功，开始查询完整信息...`)

    // 获取红包完整信息
    const { data: packet, error: queryError } = await supabase
      .from('group_red_packets')
      .select(
        `
        *,
        sender:profiles!group_red_packets_sender_id_fkey(nickname),
        claims:group_red_packet_claims!group_red_packet_claims_packet_id_fkey(
          amount,
          claimed_at,
          is_best_luck,
          user:profiles!group_red_packet_claims_user_id_fkey(nickname, tg_user_id)
        )
      `
      )
      .eq('id', packetId)
      .order('claimed_at', { foreignTable: 'group_red_packet_claims', ascending: true })
      .single()

    if (queryError) {
      console.error(`[RedPacket-Update] ❌ 查询红包失败:`, queryError)
      console.error(`[RedPacket-Update] 错误详情:`, JSON.stringify(queryError, null, 2))
      return
    }

    if (!packet) {
      console.log(`[RedPacket-Update] ❌ 红包不存在 packetId=${packetId}`)
      return
    }

    console.log(
      `[RedPacket-Update] ✅ 查询成功 type=${packet.type}, status=${packet.status}, claims=${packet.claims?.length || 0}`
    )

    // 构建消息文本
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

      await editMessage(chatId, messageId, hbText)
      return
    }

    // 普通红包和拼手气红包
    const statusText =
      packet.status === 'completed'
        ? '✨ <b>已被抢光</b> ✨'
        : `⏳ 剩余 <b>${packet.remaining_count}</b>/${packet.total_count} 份`

    // 🎯 手气最佳显示（仅拼手气红包）
    let bestLuckText = ''
    if (packet.type === 'lucky' && packet.claims && packet.claims.length > 0) {
      const bestClaim = packet.claims.find((c) => c.is_best_luck)
      if (bestClaim) {
        bestLuckText = `\n🏆 <b>手气最佳：</b>${escapeHTML(bestClaim.user?.nickname || '未知')} (${bestClaim.amount}抖币)\n`
      }
    }

    // 🎯 领取记录（紧凑型格式）
    let claimsText = ''
    if (packet.claims && packet.claims.length > 0) {
      const MAX_CHARS = 3900 // 留空间给标题和按钮
      claimsText = '\n🎁 <b>领取记录</b>：\n'

      let currentLength =
        hbText.length + statusText.length + bestLuckText.length + claimsText.length
      let displayCount = 0

      for (let i = 0; i < packet.claims.length; i++) {
        const c = packet.claims[i]
        const name = c.user?.nickname || '未知'
        const isBest = c.is_best_luck ? ' 🏆' : ''
        const line = `${i + 1}. ${escapeHTML(name)} - ${c.amount}抖币${isBest}\n`

        if (currentLength + line.length > MAX_CHARS) {
          // 超过限制，显示还有多少人
          const remaining = packet.claims.length - displayCount
          claimsText += `\n<i>... 还有 ${remaining} 人</i>`
          break
        }

        claimsText += line
        currentLength += line.length
        displayCount++
      }
    }

    // 🎯 题目显示（未完成时显示）
    let questionText = ''

    if (packet.status === 'active' && packet.verification_question) {
      questionText = `\n❓ <b>验证题目：${packet.verification_question}</b>\n👉 <b>领取方式：回复本消息并输入正确答案</b>\n`
    }

    // 组合最终消息
    hbText =
      `🧧 <b>${escapeHTML(senderName)}</b> 的${typeText} (${packet.total_count}份)\n` +
      `💰 总金额：<b>${packet.total_amount}</b> 抖币\n` +
      `${statusText}${bestLuckText}${questionText}${claimsText}`

    console.log(`[RedPacket-Update] 📤 发送编辑消息请求...`)
    await editMessage(chatId, messageId, hbText)

    console.log(`[RedPacket-Update] ✅ 消息更新成功`)

    // 更新队列状态
    await supabase
      .from('red_packet_update_queue')
      .update({
        needs_update: false,
        last_updated_at: new Date().toISOString()
      })
      .eq('packet_id', packetId)

    console.log(`[RedPacket-Update] ✅ 更新完成 packetId=${packetId}`)
  } catch (err: any) {
    console.error('[RedPacket-Update] ❌ 更新消息异常:', err)
    console.error('[RedPacket-Update] 错误详情:', JSON.stringify(err, null, 2))
  }
}
