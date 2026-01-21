/// <reference types="https://deno.land/x/types/index.d.ts" />
import { supabase } from '../supabaseClient.ts'
import {
  sendMessage,
  answerCallbackQuery,
  editMessage,
  editMessageCaption,
  sendPhoto
} from '../telegram.ts'
import { escapeHTML, sanitizeError } from '../utils/text.ts'

// 🎯 批量更新机制：通过数据库控制更新频率（Edge Function 无状态，不能用内存变量）
const UPDATE_INTERVAL_MS = 5000 // 每5秒更新一次

/**
 * 处理红包指令: hb 100 [份数] [sq]
 * 或者在回复某人时输入: hb 100
 */
export async function handleRedPacketCommand(chatId: number, text: string, message: any) {
  const officialGroupId = Deno.env.get('OFFICIAL_GROUP_ID')
  const diceGroupId = Deno.env.get('DICE_GROUP_ID')
  console.log(
    `[RedPacket-Cmd] chatId=${chatId}, officialGroupId=${officialGroupId}, diceGroupId=${diceGroupId}`
  )

  // 1. 验证群组权限：允许在官方群或游戏群发红包
  const isOfficialGroup = String(chatId) === String(officialGroupId)
  const isDiceGroup = String(chatId) === String(diceGroupId)

  if (!isOfficialGroup && !isDiceGroup) {
    console.log(`[RedPacket-Cmd] 群组 ID 不匹配，跳过。`)
    // 如果不是在官方群或游戏群，且不是私聊，则忽略
    if (chatId < 0) return // 群组消息，但不是允许的群组
  }

  const parts = text.trim().split(/\s+/)
  const cmd = parts[0].toLowerCase()
  if (cmd !== 'hb' && cmd !== '/hb') return

  console.log(`[RedPacket-Cmd] 开始解析金额...`)

  try {
    // 🎯 必须包含 "db" 后缀，例如: hb 100db 或 hb 100db 10
    let amountStr = parts[1] || ''
    if (!amountStr.toLowerCase().endsWith('db')) {
      if (chatId > 0)
        await sendMessage(chatId, '❌ 金额必须包含 "db" 后缀，例如: `hb 100db` 或 `hb 100db 10`')
      return
    }
    amountStr = amountStr.slice(0, -2) // 移除 "db" 后缀
    const amount = parseFloat(amountStr)
    if (isNaN(amount) || amount <= 0) {
      if (chatId > 0)
        await sendMessage(chatId, '❌ 请输入有效的红包金额，例如: `hb 100db` 或 `hb 100db 10`')
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
      // 🚨 群组消息静默处理，不发送提示（chatId < 0 表示群组）
      if (chatId < 0) {
        return
      }
      // 私聊消息仍然发送提示
      const reason = sender.ban_reason || '由于违反社区规范，您的账号已被封禁。'
      await sendMessage(chatId, `🚫 <b>您的账号已被封禁</b>\n\n原因: ${reason}`, {
        reply_to_message_id: message.message_id
      })
      return
    }

    if (sender.balance_coins < amount) {
      await sendMessage(
        chatId,
        `❌ 余额不足 (当前: ${(Math.floor(sender.balance_coins * 100) / 100).toFixed(2)} 抖币)`
      )
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
      // 🎯 解析人数和类型参数，支持格式：
      // hb 100db 10 -> 普通红包，10份
      // hb 100db 10 sq -> 手气红包，10份
      // hb 100db sq -> 手气红包，1份（默认）
      let hasSq = false
      let parsedCount = 1

      // 检查是否有 "sq" 参数
      if (parts[2]?.toLowerCase() === 'sq' || parts[3]?.toLowerCase() === 'sq') {
        hasSq = true
      }

      // 解析人数（如果 parts[2] 不是 "sq"，则尝试解析为数字）
      if (parts[2] && parts[2].toLowerCase() !== 'sq') {
        parsedCount = parseInt(parts[2])
        if (isNaN(parsedCount) || parsedCount <= 0) parsedCount = 1
      }

      count = parsedCount

      // 🎯 人数限制：最多999人
      if (count > 999) {
        await sendMessage(chatId, '❌ 红包人数不能超过 999 人')
        return
      }

      if (hasSq) {
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
    // 🎯 专属红包不需要验证码，普通/拼手气红包需要验证码（按钮模式，题目在私聊发送）
    const verificationAnswer = type === 'single' ? '' : ''
    const question = type === 'single' ? '' : ''

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
      // 🎯 专属红包：使用 @ 提及，直接点击领取（不需要答题），使用图片发送
      const targetMention = targetTgUserId
        ? `<a href="tg://user?id=${targetTgUserId}">${escapeHTML(targetNickname || '未知')}</a>`
        : escapeHTML(targetNickname || '未知')

      hbText =
        `🧧 <b>${escapeHTML(sender.nickname)}</b> 给 ${targetMention} 发了一个专属红包\n` +
        `💰 金额：<b>${Number(amount).toFixed(2)}</b> 抖币\n` +
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

      // 🎯 使用图片发送（专属红包）
      // 图片 URL：https://zhlkanxfucnsatafeqdp.supabase.co/storage/v1/object/public/user-content/zshb.jpg
      try {
        const { SUPABASE_URL } = await import('../env.ts')

        // 构建图片 URL：优先使用环境变量配置的 CDN URL，否则使用 Supabase Storage
        // @ts-ignore: Deno 在 Edge Function 环境中可用
        const cdnBaseUrl = Deno.env.get('PUBLIC_ASSETS_CDN_URL') || Deno.env.get('CDN_BASE_URL')
        let imageUrl: string

        if (cdnBaseUrl) {
          // 方式1：使用环境变量配置的 CDN URL
          imageUrl = `${cdnBaseUrl.replace(/\/$/, '')}/storage/v1/object/public/user-content/zshb.jpg`
        } else {
          // 方式2：使用 Supabase Storage 公开 URL
          const supabaseProjectRef = SUPABASE_URL.replace('https://', '').split('.')[0]
          imageUrl = `https://${supabaseProjectRef}.supabase.co/storage/v1/object/public/user-content/zshb.jpg`
        }

        console.log(`[RedPacket] 专属红包尝试发送图片: ${imageUrl}`)
        const sentMsg = await sendPhoto(chatId, imageUrl, hbText, { reply_markup: keyboard })

        if (sentMsg.ok) {
          console.log(`[RedPacket] ✅ 专属红包图片发送成功`)
          // 更新原始消息 ID
          await supabase
            .from('group_red_packets')
            .update({ origin_message_id: sentMsg.result.message_id })
            .eq('id', res.packet_id)
          return
        } else {
          console.warn(`[RedPacket] 专属红包图片发送失败:`, sentMsg)
        }
      } catch (photoError) {
        console.warn('[RedPacket] 专属红包发送图片异常，回退到文本消息:', photoError)
        // 回退到文本消息
      }
    } else {
      // 🎯 普通红包/拼手气红包：按钮模式，点击后私聊发送计算题，使用图片发送
      const typeText = type === 'lucky' ? '拼手气红包' : '普通红包'

      hbText =
        `🧧 <b>${escapeHTML(sender.nickname)}</b> 发了一个${typeText} (${count}份)\n` +
        `💰 总金额：<b>${Number(amount).toFixed(2)}</b> 抖币\n` +
        `⏳ 剩余 <b>${count}</b>/${count} 份\n\n` +
        `👉 <b>点击下方按钮领取红包</b>\n` +
        `💡 点击后会私聊发送计算题，30秒内回答正确即可领取\n\n` +
        `📜 <b>红包规则：</b>\n` +
        `• 24小时内未领完将自动退回\n\n` +
        `📢 祝大家：好运连连，万事如意！`

      // 🎯 使用按钮，点击后私聊发送计算题
      // 获取机器人用户名用于跳转按钮
      const botUsername = Deno.env.get('TG_BOT_USERNAME') || 'dydy'
      const botUrl = `https://t.me/${botUsername.replace('@', '')}`

      keyboard = {
        inline_keyboard: [
          [
            {
              text: '🎁 点击领取红包',
              callback_data: `claim_hb:${packetId}`
            }
          ],
          [
            {
              text: '💬 回答问题',
              url: botUrl
            }
          ]
        ]
      }

      // 🎯 使用图片发送（普通/手气红包）
      // 图片 URL：https://zhlkanxfucnsatafeqdp.supabase.co/storage/v1/object/public/user-content/hb.jpg
      try {
        const { SUPABASE_URL } = await import('../env.ts')

        // 构建图片 URL：优先使用环境变量配置的 CDN URL，否则使用 Supabase Storage
        // @ts-ignore: Deno 在 Edge Function 环境中可用
        const cdnBaseUrl = Deno.env.get('PUBLIC_ASSETS_CDN_URL') || Deno.env.get('CDN_BASE_URL')
        let imageUrl: string

        if (cdnBaseUrl) {
          // 方式1：使用环境变量配置的 CDN URL
          imageUrl = `${cdnBaseUrl.replace(/\/$/, '')}/storage/v1/object/public/user-content/hb.jpg`
        } else {
          // 方式2：使用 Supabase Storage 公开 URL
          const supabaseProjectRef = SUPABASE_URL.replace('https://', '').split('.')[0]
          imageUrl = `https://${supabaseProjectRef}.supabase.co/storage/v1/object/public/user-content/hb.jpg`
        }

        console.log(`[RedPacket] 尝试发送图片: ${imageUrl}`)
        console.log(`[RedPacket] 📤 发送红包按钮:`, JSON.stringify(keyboard))
        const sentMsg = await sendPhoto(chatId, imageUrl, hbText, { reply_markup: keyboard })

        if (sentMsg.ok) {
          console.log(`[RedPacket] ✅ 图片发送成功, message_id=${sentMsg.result.message_id}`)
          // 更新原始消息 ID
          await supabase
            .from('group_red_packets')
            .update({ origin_message_id: sentMsg.result.message_id })
            .eq('id', res.packet_id)
          console.log(`[RedPacket] ✅ 已更新红包消息ID: ${sentMsg.result.message_id}`)
          return
        } else {
          console.warn(`[RedPacket] 图片发送失败:`, sentMsg)
        }
      } catch (photoError) {
        console.warn('[RedPacket] 发送图片异常，回退到文本消息:', photoError)
        // 回退到文本消息
      }
    }

    console.log(`[RedPacket] 📤 发送文本消息，按钮:`, keyboard ? JSON.stringify(keyboard) : '无')
    const sentMsg = keyboard
      ? await sendMessage(chatId, hbText, { reply_markup: keyboard })
      : await sendMessage(chatId, hbText)

    if (sentMsg.ok) {
      console.log(`[RedPacket] ✅ 文本消息发送成功, message_id=${sentMsg.result.message_id}`)
      // 更新原始消息 ID
      await supabase
        .from('group_red_packets')
        .update({ origin_message_id: sentMsg.result.message_id })
        .eq('id', res.packet_id)
      console.log(`[RedPacket] ✅ 已更新红包消息ID: ${sentMsg.result.message_id}`)
    }
  } catch (err: any) {
    console.error('RedPacket Error:', err)
    await sendMessage(chatId, `❌ 红包发送异常: ${sanitizeError(err.message)}`)
  }
}

/**
 * 🎯 Emoji数字映射表（0-9）
 */
const EMOJI_NUMBERS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣']

/**
 * 将数字转换为emoji数字字符串
 */
function numberToEmoji(num: number): string {
  if (num < 0) return '❌'
  if (num === 0) return EMOJI_NUMBERS[0]

  const digits = num.toString().split('')
  return digits.map((d) => EMOJI_NUMBERS[parseInt(d)]).join('')
}

/**
 * 将emoji数字字符串转换为数字
 */
function emojiToNumber(emojiStr: string): number | null {
  const emojiMap: Record<string, number> = {}
  EMOJI_NUMBERS.forEach((emoji, idx) => {
    emojiMap[emoji] = idx
  })

  const digits = emojiStr.split('').filter((c) => emojiMap[c] !== undefined)
  if (digits.length === 0) return null

  const numStr = digits.map((c) => emojiMap[c]).join('')
  return parseInt(numStr, 10)
}

/**
 * 🎯 生成emoji数学题（加减法，结果0-99，使用emoji数字）
 */
function generateEmojiMathQuestion() {
  const operators = ['➕', '➖'] // 只用加法和减法，更简单
  let a: number, b: number, op: string, correctAnswer: number
  let attempts = 0

  do {
    attempts++
    if (attempts > 100) {
      // 防止死循环，给个默认简单题
      a = 5
      b = 3
      op = '➕'
      correctAnswer = 8
      break
    }

    op = operators[Math.floor(Math.random() * operators.length)]

    if (op === '➕') {
      // 加法：确保结果不超过99
      a = Math.floor(Math.random() * 50) + 1 // 1-50
      b = Math.floor(Math.random() * Math.min(50, 99 - a)) + 1 // 1 到 (99-a)
      correctAnswer = a + b
    } else {
      // 减法：确保结果为正数且不超过99
      a = Math.floor(Math.random() * 90) + 10 // 10-99
      b = Math.floor(Math.random() * Math.min(a - 1, 50)) + 1 // 1 到 min(a-1, 50)
      correctAnswer = a - b
    }
  } while (correctAnswer < 0 || correctAnswer > 99)

  const aEmoji = numberToEmoji(a)
  const bEmoji = numberToEmoji(b)
  const questionEmoji = `${aEmoji} ${op} ${bEmoji} = ?`

  return {
    question: questionEmoji,
    questionText: `${a} ${op === '➕' ? '+' : '-'} ${b} = ?`, // 用于存储正确答案
    answer: correctAnswer
  }
}

/**
 * 生成数学题（加减乘除，结果0-100）- 保留用于兼容
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
    // 1. 获取对应的红包（添加 target_user_id 字段用于专属红包权限检查）
    console.log(`[RedPacket-Reply] 步骤1: 查询红包 replyMsgId=${replyToMessageId}`)
    const { data: packet } = await supabase
      .from('group_red_packets')
      .select('id, verification_answer, status, remaining_count, total_count, type, target_user_id')
      .eq('group_id', chatId)
      .eq('origin_message_id', replyToMessageId)
      .single()

    if (!packet) {
      console.log(`[RedPacket-Reply] ⏭️ 不是红包消息或未找到`)
      return // 不是红包消息，或者没录入 ID
    }

    console.log(
      `[RedPacket-Reply] ✅ 找到红包 packetId=${packet.id}, status=${packet.status}, type=${packet.type}`
    )

    if (packet.status !== 'active') {
      console.log(`[RedPacket-Reply] ⏭️ 红包状态不是 active: ${packet.status}`)
      return
    }

    // 🎯 禁止普通红包和手气红包在群聊中回复领取，只能在私聊中回答
    if (packet.type === 'equal' || packet.type === 'lucky') {
      console.log(
        `[RedPacket-Reply] 🚫 禁止在群聊中回复领取普通/手气红包，请在私聊中点击按钮后回答`
      )
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

    // 🎯 3.1 专属红包权限检查（在调用 RPC 之前检查，防止被他人误抢）
    if (packet.type === 'single' && packet.target_user_id && packet.target_user_id !== user.id) {
      console.log(
        `[RedPacket-Reply] ❌ 专属红包权限检查失败: target_user_id=${packet.target_user_id}, user_id=${user.id}`
      )
      // 静默处理，不回复消息（避免群聊中刷屏）
      return
    }

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

    // 🎯 立即更新消息（不再使用队列机制）
    console.log(`[RedPacket-Reply] 🔄 立即更新消息`)
    try {
      await updateRedPacketMessageNow(chatId, replyToMessageId, packet.id)
      console.log(`[RedPacket-Reply] ✅ 更新完成`)
    } catch (updateErr) {
      console.error(`[RedPacket-Reply] ❌ 更新失败:`, updateErr)
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
 * 🎯 统一的按钮显示判断函数
 * 确保所有更新函数使用相同的逻辑
 */
function shouldShowRedPacketButton(packet: any): boolean {
  if (!packet) {
    console.log(`[RedPacket-Button] ❌ 红包数据为空`)
    return false
  }

  const remainingCount = Number(packet.remaining_count) || 0
  const packetStatus = packet.status ?? 'unknown'
  const totalCount = Number(packet.total_count) || 0

  console.log(
    `[RedPacket-Button] 🔍 判断: status=${packetStatus}, remaining=${remainingCount}, total=${totalCount}`
  )

  // 按钮显示条件：
  // 1. status 必须是 'active'
  // 2. remaining_count 必须 > 0
  // 3. total_count 必须 > 0（防止数据异常）
  const shouldShow = packetStatus === 'active' && remainingCount > 0 && totalCount > 0

  if (shouldShow) {
    console.log(`[RedPacket-Button] ✅ 显示按钮`)
  } else {
    console.log(
      `[RedPacket-Button] ❌ 不显示按钮（status=${packetStatus}, remaining=${remainingCount}, total=${totalCount}）`
    )
  }

  return shouldShow
}

/**
 * 🎯 创建按钮键盘（仅用于普通/手气红包，专属红包不需要）
 */
function createRedPacketKeyboard(packetId: string, shouldShow: boolean): any {
  // 获取机器人用户名（直接从环境变量获取）
  const botUsername = Deno.env.get('TG_BOT_USERNAME') || 'dydy'
  const botUrl = `https://t.me/${botUsername.replace('@', '')}`

  if (shouldShow) {
    return {
      inline_keyboard: [
        [
          {
            text: '🎁 点击领取红包',
            callback_data: `claim_hb:${packetId}`
          }
        ],
        [
          {
            text: '💬 回答问题',
            url: botUrl
          }
        ]
      ]
    }
  } else {
    // 红包已领完，只显示跳转按钮（方便用户跳转到机器人）
    return {
      inline_keyboard: [
        [
          {
            text: '💬 回答问题',
            url: botUrl
          }
        ]
      ]
    }
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
        // 已领取：移除所有按钮（专属红包不需要跳转按钮）
        hbText =
          `🧧 <b>${escapeHTML(senderName)}</b> 给 ${targetMention} 的专属红包\n` +
          `💰 金额：<b>${Number(packet.total_amount).toFixed(2)}</b> 抖币\n` +
          `📊 状态：✨ <b>已被领取</b> ✨\n\n` +
          `🎉 <b>${escapeHTML(claimerName)}</b> 领了 <code>${Number(claimInfo?.amount || packet.total_amount).toFixed(2)}</code> 抖币`
        keyboard = { inline_keyboard: [] }
      } else {
        // 待领取：只保留领取按钮（专属红包不需要跳转按钮）
        hbText =
          `🧧 <b>${escapeHTML(senderName)}</b> 给 ${targetMention} 的专属红包\n` +
          `💰 金额：<b>${Number(packet.total_amount).toFixed(2)}</b> 抖币\n` +
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

    // 🎯 普通/手气红包不再显示题目（题目在私聊发送）

    // 🎯 使用统一的按钮判断函数
    const shouldShow = shouldShowRedPacketButton(packet)
    const keyboard = createRedPacketKeyboard(packetId, shouldShow)

    // 🎯 智能分割消息：如果领取记录太多，分多条消息发送
    const baseText =
      `${hbTitle}\n` +
      `💰 总金额：<b>${Number(packet.total_amount).toFixed(2)}</b> 抖币\n` +
      `📊 状态：${statusText}`

    if (claims && claims.length > 0) {
      const MAX_MESSAGE_LENGTH = 4000 // 留96字符余量
      const currentText = baseText + '\n\n<b>领取记录：</b>\n'

      // 逐条添加领取记录
      const recordTexts: string[] = []
      for (let i = 0; i < claims.length; i++) {
        const c = claims[i]
        const name = c.user?.nickname || '匿名'
        // 🎯 用🧧 emoji替代数字ID
        const recordLine = `🧧 ${escapeHTML(name)} 领了 <code>${Number(c.amount).toFixed(2)}</code> 币\n`
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

      // 编辑原消息（保留按钮）
      const firstMessage = currentText + firstMessageRecords
      // 🎯 尝试编辑消息：先尝试文本消息，如果失败则尝试图片消息的 caption
      let editResult = await editMessage(chatId, messageId, firstMessage, {
        reply_markup: keyboard
      })

      if (!editResult.ok) {
        // 如果编辑文本消息失败，可能是图片消息，尝试编辑 caption
        console.log(`[RedPacket] 文本消息编辑失败，尝试编辑图片 caption...`)
        editResult = await editMessageCaption(chatId, messageId, firstMessage, {
          reply_markup: keyboard
        })

        if (!editResult.ok) {
          console.error(`[RedPacket] ❌ 编辑消息失败:`, editResult)
        }
      }

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
      // 没有领取记录，直接编辑原消息（保留按钮）
      // 🎯 尝试编辑消息：先尝试文本消息，如果失败则尝试图片消息的 caption
      let editResult = await editMessage(chatId, messageId, baseText, { reply_markup: keyboard })

      if (!editResult.ok) {
        // 如果编辑文本消息失败，可能是图片消息，尝试编辑 caption
        console.log(`[RedPacket] 文本消息编辑失败，尝试编辑图片 caption...`)
        editResult = await editMessageCaption(chatId, messageId, baseText, {
          reply_markup: keyboard
        })

        if (!editResult.ok) {
          console.error(`[RedPacket] ❌ 编辑消息失败:`, editResult)
        }
      }
    }
  } catch (e) {
    console.error('Update HB Msg Error:', e)
  }
}

/**
 * 🎯 处理抢红包回调（新版：按钮模式 + 私聊答题）
 * - 专属红包：直接领取
 * - 普通/手气红包：点击按钮后私聊发送计算题，30秒内回答
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
      // 🚨 群组消息静默处理，不发送提示（chatId < 0 表示群组）
      if (chatId < 0) {
        // 群组中静默返回，不显示任何提示
        await answerCallbackQuery(callbackQueryId, '', false)
        return
      }
      // 私聊消息仍然发送提示
      const reason = user.ban_reason || '由于违反社区规范，您的账号已被封禁。'
      console.log(`[RedPacket] ❌ 用户已封禁: userId=${user.id}, reason=${reason}`)
      await answerCallbackQuery(callbackQueryId, `🚫 账号已封禁\n${reason}`, true)
      return
    }

    // 2. 获取红包信息（包含 origin_message_id）
    console.log(`[RedPacket] 步骤2: 查询红包信息 packetId=${packetId}`)
    const { data: packet, error: packetError } = await supabase
      .from('group_red_packets')
      .select('status, remaining_count, type, target_user_id, group_id, origin_message_id')
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

    // 🎯 确定要使用的 messageId（优先使用传入的，否则使用数据库中的）
    const actualMessageId = messageId || packet.origin_message_id

    console.log(
      `[RedPacket] ✅ 红包信息: type=${packet.type}, status=${packet.status}, remaining=${packet.remaining_count}, group_id=${packet.group_id}, messageId=${messageId}, origin_message_id=${packet.origin_message_id}, actualMessageId=${actualMessageId}`
    )

    if (packet.status !== 'active') {
      // 🎯 添加详细日志，记录状态不一致的情况
      console.error(
        `[RedPacket] ❌ 红包状态异常: packetId=${packetId}, status=${packet.status}, remaining=${packet.remaining_count}, group_id=${packet.group_id}, messageId=${messageId}, origin_message_id=${packet.origin_message_id}`
      )

      const msg =
        packet.status === 'completed'
          ? '🎈 来晚了，红包已被抢光'
          : packet.status === 'expired'
            ? '⏰ 红包已过期'
            : `❌ 红包状态异常（${packet.status}）`
      await answerCallbackQuery(callbackQueryId, msg, true)

      // 🎯 红包已领完或过期时，更新消息确保显示正确
      // 🎯 强制使用 origin_message_id，因为 callback query 的 messageId 可能不正确
      const updateMessageId = packet.origin_message_id || actualMessageId
      if (packet.group_id && updateMessageId) {
        console.log(
          `[RedPacket] 🔄 红包状态异常，更新消息以确保显示正确 packetId=${packetId}, groupId=${packet.group_id}, messageId=${messageId}, origin_message_id=${packet.origin_message_id}, updateMessageId=${updateMessageId}`
        )
        // 🎯 不等待更新完成，避免阻塞用户响应，但记录日志
        updateRedPacketMessageNow(packet.group_id, updateMessageId, packetId)
          .then(() => {
            console.log(`[RedPacket] ✅ 消息更新任务已提交 packetId=${packetId}`)
          })
          .catch((updateErr) => {
            console.error(`[RedPacket] ❌ 更新消息失败:`, updateErr)
            console.error(`[RedPacket] 更新失败详情:`, JSON.stringify(updateErr, null, 2))
          })
      } else {
        console.error(
          `[RedPacket] ❌ 无法更新消息：缺少必要参数 group_id=${packet.group_id}, messageId=${messageId}, origin_message_id=${packet.origin_message_id}, actualMessageId=${actualMessageId}, updateMessageId=${updateMessageId}`
        )
      }
      return
    }

    // 2.1 🎯 检查是否已经领取过（普通/手气红包）
    if (packet.type !== 'single') {
      const { data: existingClaim } = await supabase
        .from('group_red_packet_claims')
        .select('id')
        .eq('packet_id', packetId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (existingClaim) {
        console.log(`[RedPacket] ❌ 用户已领取过: userId=${user.id}`)
        await answerCallbackQuery(callbackQueryId, '❌ 你已经领取过这个红包了', true)
        return
      }
    }

    // 3. 🎯 专属红包：直接领取（不需要答题）
    if (packet.type === 'single') {
      // 检查是否是目标用户
      if (packet.target_user_id && packet.target_user_id !== user.id) {
        await answerCallbackQuery(callbackQueryId, '❌ 这是给别人的专属红包哦', true)
        return
      }

      // 直接调用 RPC 领取
      const { data: rpcResult, error } = await supabase.rpc('claim_group_red_packet', {
        p_packet_id: packetId,
        p_user_id: user.id
      })

      if (error) {
        console.error(`[RedPacket] ❌ RPC 调用失败:`, error)
        throw error
      }

      const res = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult

      if (!res || !res.success) {
        // 🎯 添加详细日志，记录 RPC 返回的错误
        console.error(
          `[RedPacket] ❌ RPC 返回失败: packetId=${packetId}, userId=${user.id}, message=${res?.message || '未知错误'}`
        )
        await answerCallbackQuery(callbackQueryId, res?.message || '领取失败', true)

        // 🎯 如果是因为红包已领完或状态异常，更新消息确保显示正确
        const errorMsg = res?.message || ''
        if (
          errorMsg.includes('已被抢光') ||
          errorMsg.includes('已失效') ||
          errorMsg.includes('已结束') ||
          errorMsg.includes('已过期')
        ) {
          const actualMsgId = messageId || packet.origin_message_id
          console.log(
            `[RedPacket] 🔄 RPC 返回红包已领完/失效，更新消息以确保显示正确 packetId=${packetId}, groupId=${packet.group_id}, messageId=${actualMsgId}`
          )
          if (packet.group_id && actualMsgId) {
            // 🎯 不等待更新完成，避免阻塞用户响应
            updateRedPacketMessageNow(packet.group_id, actualMsgId, packetId).catch((updateErr) => {
              console.error(`[RedPacket] ❌ 更新消息失败:`, updateErr)
              console.error(`[RedPacket] 更新失败详情:`, JSON.stringify(updateErr, null, 2))
            })
          } else {
            console.error(
              `[RedPacket] ❌ 无法更新消息：缺少必要参数 group_id=${packet.group_id}, messageId=${messageId}, origin_message_id=${packet.origin_message_id}, actualMsgId=${actualMsgId}`
            )
          }
        }
        return
      }

      await answerCallbackQuery(callbackQueryId, `🎊 恭喜！抢到 ${res.amount} 抖币！`, true)

      // 🎯 专属红包只有1份，领取后必须立即更新消息
      console.log(`[RedPacket] ✅ 专属红包领取成功，立即更新消息 packetId=${packetId}`)
      await updateRedPacketMessageNow(packet.group_id, messageId, packetId)

      return
    }

    // 4. 🎯 普通/手气红包：私聊发送计算题
    console.log(`[RedPacket] 步骤3: 生成计算题并私聊发送 packetId=${packetId}, userId=${user.id}`)

    // 🎯 防重复：检查用户是否已经在等待答案状态
    const { getUserState, updateUserState } = await import('../state.ts')
    const userState = await getUserState(tgUserId)

    if (userState.state === 'waiting_red_packet_answer') {
      const context = userState.context || {}
      const existingPacketId = context.packet_id

      // 如果是同一个红包，说明已经发送过验证码了
      if (existingPacketId === packetId) {
        console.log(`[RedPacket] ⚠️ 用户已在等待答案状态，避免重复发送验证码 packetId=${packetId}`)
        await answerCallbackQuery(callbackQueryId, '⏳ 验证码已发送，请在私聊中查看并回答', true)
        return
      } else {
        // 如果是不同的红包，清除旧状态
        console.log(`[RedPacket] 🔄 检测到用户有未完成的红包，清除旧状态`)
        await updateUserState(tgUserId, { state: 'idle' })
      }
    }

    // 🎯 立即 answerCallbackQuery，避免 Telegram 重复发送请求
    await answerCallbackQuery(callbackQueryId, '⏳ 正在发送验证码...', false)

    // 生成emoji计算题
    const mathQuestion = generateEmojiMathQuestion()
    const expiresAt = new Date(Date.now() + 30000) // 30秒后过期

    // 保存到用户状态（等待答案）
    await updateUserState(tgUserId, {
      state: 'waiting_red_packet_answer',
      context: {
        packet_id: packetId,
        group_id: packet.group_id,
        message_id: messageId,
        question: mathQuestion.questionText,
        answer: String(mathQuestion.answer),
        expires_at: expiresAt.toISOString()
      }
    })

    // 私聊发送计算题
    const questionMsg =
      `🧧 <b>红包领取验证</b>\n\n` +
      `📝 <b>计算题：</b>\n` +
      `${mathQuestion.question}\n\n` +
      `⏰ <b>请在30秒内回复答案</b>\n` +
      `💡 可以直接输入数字，也可以用emoji数字回答`

    await sendMessage(tgUserId, questionMsg)

    console.log(`[RedPacket] ✅ 已发送计算题，等待用户回答`)
  } catch (err: any) {
    console.error('[RedPacket] ❌ 领取异常:', err)
    await answerCallbackQuery(callbackQueryId, `❌ ${sanitizeError(err.message)}`, true)
  }
}

/**
 * 🎯 处理私聊中的红包答案回复
 */
export async function handleRedPacketAnswer(chatId: number, text: string, tgUserId: number) {
  console.log(`[RedPacket-Answer] 📝 收到答案回复: tgUserId=${tgUserId}, answer=${text.trim()}`)

  try {
    // 1. 获取用户状态
    const { getUserState, updateUserState } = await import('../state.ts')
    const userState = await getUserState(tgUserId)

    if (userState.state !== 'waiting_red_packet_answer') {
      return // 不是等待答案状态
    }

    const context = userState.context || {}
    const packetId = context.packet_id
    const groupId = context.group_id
    const messageId = context.message_id
    const correctAnswer = context.answer
    const expiresAt = context.expires_at

    if (!packetId || !groupId || !messageId) {
      console.log(`[RedPacket-Answer] ❌ 缺少必要信息`)
      await updateUserState(tgUserId, { state: 'idle' })
      return
    }

    // 2. 检查是否超时
    if (expiresAt && new Date(expiresAt) < new Date()) {
      console.log(`[RedPacket-Answer] ⏰ 答案超时`)
      await sendMessage(chatId, '⏰ 答题时间已过期，请重新点击红包按钮')
      await updateUserState(tgUserId, { state: 'idle' })
      return
    }

    // 3. 解析答案（支持数字和emoji）
    const userAnswerStr = text.trim()
    let userAnswer: number | null = null

    // 尝试解析为数字
    const numAnswer = parseInt(userAnswerStr, 10)
    if (!isNaN(numAnswer)) {
      userAnswer = numAnswer
    } else {
      // 尝试解析为emoji数字
      userAnswer = emojiToNumber(userAnswerStr)
    }

    if (userAnswer === null) {
      await sendMessage(chatId, '❌ 答案格式错误，请输入数字或emoji数字')
      return
    }

    // 4. 验证答案
    if (String(userAnswer) !== correctAnswer) {
      console.log(`[RedPacket-Answer] ❌ 答案错误: 用户=${userAnswer}, 正确答案=${correctAnswer}`)
      await sendMessage(chatId, `❌ 答案错误！正确答案是 ${correctAnswer}\n请重新点击红包按钮`)
      await updateUserState(tgUserId, { state: 'idle' })
      return
    }

    console.log(`[RedPacket-Answer] ✅ 答案正确，开始领取红包`)

    // 5. 获取用户信息
    const { data: user } = await supabase
      .from('profiles')
      .select('id, nickname')
      .eq('tg_user_id', tgUserId)
      .single()

    if (!user) {
      await sendMessage(chatId, '❌ 用户信息不存在')
      await updateUserState(tgUserId, { state: 'idle' })
      return
    }

    // 6. 调用 RPC 领取红包
    const { data: rpcResult, error } = await supabase.rpc('claim_group_red_packet', {
      p_packet_id: packetId,
      p_user_id: user.id
    })

    if (error) {
      console.error(`[RedPacket-Answer] ❌ RPC 调用失败:`, error)
      await sendMessage(chatId, `❌ 领取失败: ${error.message}`)
      await updateUserState(tgUserId, { state: 'idle' })
      return
    }

    const res = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult

    if (!res || !res.success) {
      // 🎯 添加详细日志，记录 RPC 返回的错误
      console.error(
        `[RedPacket-Answer] ❌ RPC 返回失败: packetId=${packetId}, userId=${user.id}, message=${res?.message || '未知错误'}`
      )
      await sendMessage(chatId, res?.message || '领取失败')

      // 🎯 如果是因为红包已领完或状态异常，更新消息确保显示正确
      const errorMsg = res?.message || ''
      if (
        errorMsg.includes('已被抢光') ||
        errorMsg.includes('已失效') ||
        errorMsg.includes('已结束') ||
        errorMsg.includes('已过期')
      ) {
        console.log(
          `[RedPacket-Answer] 🔄 RPC 返回红包已领完/失效，更新消息以确保显示正确 packetId=${packetId}`
        )
        try {
          await updateRedPacketMessageNow(groupId, messageId, packetId)
        } catch (updateErr) {
          console.error(`[RedPacket-Answer] ❌ 更新消息失败:`, updateErr)
        }
      }

      await updateUserState(tgUserId, { state: 'idle' })
      return
    }

    // 7. 领取成功
    const amount = res.amount
    const isBestLuck = res.is_best_luck || false

    let successMsg = `🎊 恭喜！抢到 ${amount} 抖币！`
    if (isBestLuck) {
      successMsg = `🏆 恭喜！抢到 ${amount} 抖币！\n🎉 你是手气最佳！`
    }

    await sendMessage(chatId, successMsg)

    // 8. 清除用户状态
    await updateUserState(tgUserId, { state: 'idle' })

    // 9. 更新群组红包消息（立即更新，不再使用队列）
    await updateRedPacketMessageNow(groupId, messageId, packetId)

    console.log(`[RedPacket-Answer] ✅ 领取成功: userId=${user.id}, amount=${amount}`)
  } catch (err: any) {
    console.error('[RedPacket-Answer] ❌ 处理异常:', err)
    const { updateUserState } = await import('../state.ts')
    await updateUserState(tgUserId, { state: 'idle' })
    await sendMessage(chatId, `❌ 处理异常: ${sanitizeError(err.message)}`)
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

    // 🎯 获取红包完整信息，明确指定所有需要的字段
    const { data: packet, error: queryError } = await supabase
      .from('group_red_packets')
      .select(
        `
        id, type, status, total_amount, total_count, remaining_amount, remaining_count, target_user_id,
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
      `[RedPacket-Update] ✅ 查询成功 type=${packet.type}, status=${packet.status}, remaining_count=${packet.remaining_count}, total_count=${packet.total_count}, claims=${packet.claims?.length || 0}`
    )

    // 构建消息文本
    const typeText =
      packet.type === 'lucky' ? '拼手气红包' : packet.type === 'single' ? '专属红包' : '普通红包'
    const senderName = packet.sender?.nickname || '未知'

    let hbText = ''

    // 专属红包特殊处理（不需要跳转按钮，因为不需要答题）
    if (packet.type === 'single') {
      const isCompleted = packet.status === 'completed'
      const claimInfo = packet.claims && packet.claims.length > 0 ? packet.claims[0] : null
      const claimerName = claimInfo?.user?.nickname || '未知'

      // 🎯 获取目标用户信息用于 @ 提及
      let targetMention = '未知'
      if (packet.target_user_id) {
        // 查询目标用户信息
        const { data: targetUser } = await supabase
          .from('profiles')
          .select('nickname, tg_user_id')
          .eq('id', packet.target_user_id)
          .single()

        if (targetUser) {
          const targetTgUserId = targetUser.tg_user_id
          const targetNickname = targetUser.nickname || '未知'
          targetMention = targetTgUserId
            ? `<a href="tg://user?id=${targetTgUserId}">${escapeHTML(targetNickname)}</a>`
            : escapeHTML(targetNickname)
        }
      }

      hbText =
        `🧧 <b>${escapeHTML(senderName)}</b> 给 ${targetMention} 的专属红包\n` +
        `💰 金额：<b>${Number(packet.total_amount).toFixed(2)}</b> 抖币\n` +
        `📊 状态：${isCompleted ? '✨ <b>已被领取</b> ✨' : '<b>待领取</b>'}\n\n`

      if (isCompleted) {
        hbText += `🎉 <b>${escapeHTML(claimerName)}</b> 领了 <code>${Number(claimInfo?.amount || packet.total_amount).toFixed(2)}</code> 抖币`
      }

      // 🎯 专属红包按钮逻辑（不需要跳转按钮）
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

      console.log(
        `[RedPacket-Update] 🔄 更新专属红包消息: isCompleted=${isCompleted}, keyboard=${JSON.stringify(keyboard)}`
      )
      // 🎯 专属红包是用图片发送的，需要使用 editMessageCaption 而不是 editMessage
      const { editMessageCaption } = await import('../telegram.ts')
      const editResult = await editMessageCaption(chatId, messageId, hbText, {
        reply_markup: keyboard
      })
      if (!editResult.ok) {
        console.error(`[RedPacket-Update] ❌ 专属红包消息更新失败:`, editResult)
      } else {
        console.log(`[RedPacket-Update] ✅ 专属红包消息更新完成`)
      }
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
        bestLuckText = `\n🏆 <b>手气最佳：</b>${escapeHTML(bestClaim.user?.nickname || '未知')} (${Number(bestClaim.amount).toFixed(2)}抖币)\n`
      }
    }

    // 🎯 领取记录（只显示金额最高的30条）
    let claimsText = ''
    if (packet.claims && packet.claims.length > 0) {
      // 🎯 按金额降序排序，只取前30条
      const sortedClaims = [...packet.claims].sort((a, b) => Number(b.amount) - Number(a.amount))
      const topClaims = sortedClaims.slice(0, 30)

      // 🎯 根据总人数显示不同的标题
      if (packet.claims.length > 30) {
        claimsText = `\n🎁 <b>领取记录（金额排名前30名，共${packet.claims.length}人领取）</b>：\n`
      } else {
        claimsText = '\n🎁 <b>领取记录</b>：\n'
      }

      for (let i = 0; i < topClaims.length; i++) {
        const c = topClaims[i]
        const name = c.user?.nickname || '未知'
        const isBest = c.is_best_luck ? ' 🏆' : ''
        // 🎯 用🧧 emoji替代数字ID
        claimsText += `🧧 ${escapeHTML(name)} - ${Number(c.amount).toFixed(2)}抖币${isBest}\n`
      }

      // 🎯 如果总人数超过30，显示还有多少人未显示
      if (packet.claims.length > 30) {
        claimsText += `\n<i>... 还有 ${packet.claims.length - 30} 人未显示（仅显示金额前30名）</i>`
      }
    }

    // 🎯 普通/手气红包不再显示题目（题目在私聊发送）

    // 组合最终消息
    hbText =
      `🧧 <b>${escapeHTML(senderName)}</b> 的${typeText} (${packet.total_count}份)\n` +
      `💰 总金额：<b>${Number(packet.total_amount).toFixed(2)}</b> 抖币\n` +
      `${statusText}${bestLuckText}${claimsText}`

    // 🎯 使用统一的按钮判断函数
    const shouldShow = shouldShowRedPacketButton(packet)
    const keyboard = createRedPacketKeyboard(packetId, shouldShow)

    console.log(
      `[RedPacket-Update] 📤 准备更新消息: status=${packet.status}, remaining=${packet.remaining_count}/${packet.total_count}, shouldShow=${shouldShow}`
    )

    // 🎯 添加重试机制：最多重试3次
    const MAX_RETRIES = 3
    let editResult: any = null
    let lastError: any = null

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // 🎯 尝试编辑消息：先尝试文本消息，如果失败则尝试图片消息的 caption
        editResult = await editMessage(chatId, messageId, hbText, { reply_markup: keyboard })

        if (editResult.ok) {
          console.log(
            `[RedPacket-Update] ✅ 消息更新成功 (尝试 ${attempt}/${MAX_RETRIES}) packetId=${packetId}`
          )
          break
        }

        // 如果编辑文本消息失败，可能是图片消息，尝试编辑 caption
        console.log(
          `[RedPacket-Update] ⚠️ 文本消息编辑失败 (尝试 ${attempt}/${MAX_RETRIES})，尝试编辑图片 caption...`
        )
        editResult = await editMessageCaption(chatId, messageId, hbText, { reply_markup: keyboard })

        if (editResult.ok) {
          console.log(
            `[RedPacket-Update] ✅ 图片caption更新成功 (尝试 ${attempt}/${MAX_RETRIES}) packetId=${packetId}`
          )
          break
        }

        lastError = editResult
        console.error(
          `[RedPacket-Update] ❌ 编辑消息失败 (尝试 ${attempt}/${MAX_RETRIES}):`,
          editResult
        )

        // 如果不是最后一次尝试，等待一下再重试
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt)) // 递增延迟：500ms, 1000ms, 1500ms
        }
      } catch (err: any) {
        lastError = err
        console.error(`[RedPacket-Update] ❌ 更新消息异常 (尝试 ${attempt}/${MAX_RETRIES}):`, err)
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
        }
      }
    }

    if (!editResult || !editResult.ok) {
      console.error(`[RedPacket-Update] ❌ 消息更新最终失败 (已重试 ${MAX_RETRIES} 次):`, lastError)
      console.error(
        `[RedPacket-Update] 📊 失败时的红包状态: status=${packet.status}, remaining=${packet.remaining_count}/${packet.total_count}`
      )
      return
    }
  } catch (err: any) {
    console.error('[RedPacket-Update] ❌ 更新消息异常:', err)
    console.error('[RedPacket-Update] 错误详情:', JSON.stringify(err, null, 2))
  }
}
