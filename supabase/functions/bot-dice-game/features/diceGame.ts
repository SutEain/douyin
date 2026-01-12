import { supabase } from '../supabaseClient.ts'
import { sendMessage, answerCallbackQuery, editMessage, sendDiceWithRetry } from '../telegram.ts'
import { escapeHTML, sanitizeError } from '../utils/text.ts'

/**
 * 处理骰子比大小指令: tz [金额] [人数]
 */
export async function handleDiceCommand(chatId: number, text: string, message: any) {
  const diceGroupId = Deno.env.get('DICE_GROUP_ID')

  // 1. 验证权限 (仅限骰子游戏群)
  if (String(chatId) !== String(diceGroupId)) {
    // 不是骰子游戏群，直接返回（包括私聊和其他群组）
    return
  }

  const parts = text.trim().split(/\s+/)
  const amount = parseFloat(parts[1])
  const targetCount = parseInt(parts[2] || '2')

  if (isNaN(amount) || amount < 5 || amount > 10000) {
    // 🎯 仅在私聊提示规则，群组里输入错误直接忽略
    if (chatId > 0) {
      await sendMessage(chatId, '❌ 单局投注金额限制为 5 - 10000 抖币')
    }
    return
  }

  if (isNaN(targetCount) || targetCount < 2 || targetCount > 5) {
    if (chatId > 0) {
      await sendMessage(chatId, '❌ 游戏人数限 2 - 5 人')
    }
    return
  }

  try {
    // 2. 获取发起者信息
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

    // 3. 调用 RPC 创建房间
    const { data: res, error } = await supabase.rpc('create_dice_room', {
      p_owner_id: sender.id,
      p_group_id: chatId,
      p_bet_amount: amount,
      p_target_count: targetCount
    })

    if (error) throw error
    if (!res.success) {
      // 🎯 余额不足或创建失败，不在群组里刷屏报错，仅在私聊中提示
      if (chatId > 0) {
        await sendMessage(chatId, `❌ 创建失败: ${res.message}`)
      } else {
        console.log(`[DICE-BOT][Dice] 房间创建失败: ${res.message}, chatId=${chatId}`)
      }
      return
    }

    const roomId = res.room_id
    const diceText =
      `🎲 <b>新开局：骰子比大小</b>\n\n` +
      `👤 房主：<b>${escapeHTML(sender.nickname)}</b>\n` +
      `💰 赌注：<b>${amount}</b> 抖币\n` +
      `👥 目标人数：<b>${targetCount}</b> 人\n` +
      `⏳ 状态：等待加入 (1/${targetCount})\n\n` +
      `📜 <b>游戏规则：</b>\n` +
      `• 金额范围：5 - 10000 抖币\n` +
      `• 人数范围：2 - 5 人\n` +
      `• 抽水：系统自动抽取赢家总奖金的 2%\n` +
      `• 限制：本群同时只能存在 1 局游戏\n\n` +
      `1. ${escapeHTML(sender.nickname)} (房主)`

    await sendMessage(chatId, diceText, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💰 点击加入', callback_data: `dice_join_${roomId}` }],
          [{ text: '❌ 取消房间 (仅房主)', callback_data: `dice_cancel_${roomId}` }]
        ]
      }
    })
  } catch (err: any) {
    console.error('[DICE-BOT] Dice Command Error:', err)
    await sendMessage(chatId, `❌ 游戏发起失败: ${sanitizeError(err.message)}`)
  }
}

/**
 * 处理加入游戏回调
 */
export async function handleJoinDiceGame(
  chatId: number,
  messageId: number,
  callbackQueryId: string,
  roomId: string,
  tgUserId: number
) {
  try {
    // 1. 获取用户信息
    const { data: user } = await supabase
      .from('profiles')
      .select('id, nickname, is_banned, ban_reason')
      .eq('tg_user_id', tgUserId)
      .single()

    if (!user) {
      await answerCallbackQuery(callbackQueryId, '❌ 请先在私聊中激活机器人再参与游戏', true)
      return
    }

    if (user.is_banned) {
      const reason = user.ban_reason || '由于违反社区规范，您的账号已被封禁。'
      await answerCallbackQuery(callbackQueryId, `🚫 账号已封禁\n原因: ${reason}`, true)
      return
    }

    // 2. 调用 RPC 加入房间
    const { data: res, error } = await supabase.rpc('join_dice_room', {
      p_room_id: roomId,
      p_user_id: user.id
    })

    if (error) throw error
    if (!res.success) {
      await answerCallbackQuery(callbackQueryId, res.message, true)
      return
    }

    await answerCallbackQuery(callbackQueryId, '✅ 成功加入游戏！', false)

    // 3. 只有当 RPC 明确返回 is_full 时，才由当前请求触发开奖流程
    if (res.is_full) {
      console.log(`[DICE-BOT][Dice] 房间已满，准备开奖: ${roomId}`)

      // 先刷新一次房间信息和玩家列表用于显示
      const { data: room } = await supabase
        .from('dice_rooms')
        .select('*, owner:profiles!dice_rooms_owner_id_fkey(nickname)')
        .eq('id', roomId)
        .single()

      const { data: players } = await supabase
        .from('dice_room_players')
        .select('user:profiles!dice_room_players_user_id_fkey(nickname)')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })

      const playerList =
        players
          ?.map((p: any, i: number) => `${i + 1}. ${escapeHTML(p.user?.nickname || '匿名')}`)
          .join('\n') || ''

      const diceText =
        `🎲 <b>骰子比大小</b>\n\n` +
        `👤 房主：<b>${escapeHTML(room.owner?.nickname || '未知')}</b>\n` +
        `💰 赌注：<b>${room.bet_amount}</b> 抖币\n` +
        `👥 人数：<b>${room.current_count}/${room.target_count}</b>\n` +
        `⏳ 状态：🔥 <b>满员，正在依次开奖...</b>\n\n` +
        `📜 <b>游戏规则：</b>\n` +
        `• 限制：本群同时只能存在 1 局游戏\n\n` +
        `${playerList}`

      // 移除加入按钮并更新状态
      await editMessage(chatId, messageId, diceText, { reply_markup: { inline_keyboard: [] } })

      // 触发开奖流程
      await startRolling(chatId, roomId)
    } else {
      // 3. 未满员，仅更新人数和名单
      const { data: room } = await supabase
        .from('dice_rooms')
        .select('*, owner:profiles!dice_rooms_owner_id_fkey(nickname)')
        .eq('id', roomId)
        .single()

      const { data: players } = await supabase
        .from('dice_room_players')
        .select('user:profiles!dice_room_players_user_id_fkey(nickname)')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })

      const playerList =
        players
          ?.map((p: any, i: number) => `${i + 1}. ${escapeHTML(p.user?.nickname || '匿名')}`)
          .join('\n') || ''

      const diceText =
        `🎲 <b>骰子比大小</b>\n\n` +
        `👤 房主：<b>${escapeHTML(room.owner?.nickname || '未知')}</b>\n` +
        `💰 赌注：<b>${room.bet_amount}</b> 抖币\n` +
        `👥 人数：<b>${room.current_count}/${room.target_count}</b>\n` +
        `⏳ 状态：等待加入\n\n` +
        `📜 <b>游戏规则：</b>\n` +
        `• 限制：本群同时只能存在 1 局游戏\n\n` +
        `${playerList}`

      await editMessage(chatId, messageId, diceText, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💰 点击加入', callback_data: `dice_join_${roomId}` }],
            [{ text: '❌ 取消房间 (仅房主)', callback_data: `dice_cancel_${roomId}` }]
          ]
        }
      })
    }
  } catch (err: any) {
    console.error('[DICE-BOT] Join Dice Error:', err)
    await answerCallbackQuery(callbackQueryId, `❌ 加入异常: ${sanitizeError(err.message)}`, true)
  }
}

/**
 * 处理取消游戏回调
 */
export async function handleCancelDiceGame(
  chatId: number,
  messageId: number,
  callbackQueryId: string,
  roomId: string,
  tgUserId: number
) {
  try {
    // 1. 获取用户信息
    const { data: user } = await supabase
      .from('profiles')
      .select('id')
      .eq('tg_user_id', tgUserId)
      .single()

    if (!user) return

    // 2. 调用 RPC 取消房间
    const { data: res, error } = await supabase.rpc('cancel_dice_room', {
      p_room_id: roomId,
      p_user_id: user.id
    })

    if (error) throw error
    if (!res.success) {
      await answerCallbackQuery(callbackQueryId, res.message, true)
      return
    }

    await answerCallbackQuery(callbackQueryId, '✅ 房间已取消，本金已退还', false)
    await editMessage(chatId, messageId, '❌ <b>本局游戏已被房主取消。</b>')
  } catch (err: any) {
    console.error('[DICE-BOT] Cancel Dice Error:', err)
    await answerCallbackQuery(callbackQueryId, `❌ 操作失败: ${sanitizeError(err.message)}`, true)
  }
}

/**
 * 开奖流程
 */
async function startRolling(chatId: number, roomId: string) {
  try {
    // 1. 提前获取房间基础信息，避免中途房间被删或状态改变导致结算崩溃
    const { data: roomInfo, error: roomError } = await supabase
      .from('dice_rooms')
      .select('bet_amount, target_count, owner:profiles!dice_rooms_owner_id_fkey(nickname)')
      .eq('id', roomId)
      .single()

    if (roomError || !roomInfo) {
      throw new Error('无法获取房间信息，可能已被取消')
    }

    const { data: players } = await supabase
      .from('dice_room_players')
      .select('id, user_id, user:profiles!dice_room_players_user_id_fkey(nickname)')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })

    if (!players || players.length === 0) return

    // 2. 发送一条持久化的"战报看板"
    const progressMsgRes = await sendMessage(chatId, `🎲 <b>正在依次为玩家掷骰子...</b>`)
    const progressMsgId = progressMsgRes.ok ? progressMsgRes.result.message_id : null

    const results: any[] = []

    for (const player of players) {
      // 🎲 使用带重试机制的发送骰子函数（最多重试5次，指数退避）
      console.log(`[DiceGame] 🎲 开始为玩家 ${player.user?.nickname || '未知'} 发送骰子...`)
      const res = await sendDiceWithRetry(chatId, { emoji: '🎲' }, 5, 1000)

      if (!res.ok || !res.result?.dice) {
        const errorMsg = res.description || res.error_code || 'Unknown error'
        console.error(
          `[DiceGame] ❌ 无法为玩家 ${player.user?.nickname || '未知'} 发送骰子:`,
          errorMsg
        )
        throw new Error(`无法为玩家 ${player.user?.nickname || '未知'} 发送骰子: ${errorMsg}`)
      }

      const value = res.result.dice.value
      console.log(`[DiceGame] ✅ 玩家 ${player.user?.nickname || '未知'} 掷出: ${value} 点`)
      results.push({ id: player.id, user_id: player.user_id, name: player.user?.nickname, value })
      await supabase.from('dice_room_players').update({ roll_result: value }).eq('id', player.id)

      if (progressMsgId) {
        const currentBoard = results
          .map((r, i) => `${i + 1}. ${escapeHTML(r.name || '玩家')}: <b>${r.value}</b> 点`)
          .join('\n')
        const updateText = `🎲 <b>对局进行中...</b>\n\n${currentBoard}\n\n⏳ 正在等待下一位玩家...`
        await editMessage(chatId, progressMsgId, updateText)
      }
      await new Promise((r) => setTimeout(r, 1500))
    }

    // 4. 结算逻辑 (使用开头获取到的 roomInfo)
    const maxVal = Math.max(...results.map((r) => r.value))
    const winners = results.filter((r) => r.value === maxVal)

    const totalPrize = roomInfo.bet_amount * roomInfo.target_count
    const commission = Math.floor(totalPrize * 0.02)
    const netPrize = totalPrize - commission
    const perWinnerPrize = Math.floor(netPrize / winners.length)

    // 更新房间结果
    await supabase
      .from('dice_rooms')
      .update({
        status: 'finished',
        winner_ids: winners.map((w) => w.user_id),
        total_prize: totalPrize
      })
      .eq('id', roomId)

    // 发放奖励
    for (const winner of winners) {
      await supabase.rpc('claim_dice_reward', {
        p_user_id: winner.user_id,
        p_amount: perWinnerPrize,
        p_room_id: roomId
      })
    }

    // 5. 宣布最终结果
    const winnerNames = winners.map((w) => `<b>${escapeHTML(w.name || '玩家')}</b>`).join(', ')
    const scoreBoard = results
      .map((r, i) => {
        const isWinner = r.value === maxVal
        return `${i + 1}. ${escapeHTML(r.name || '玩家')}: <b>${r.value}</b> 点 ${isWinner ? '👑' : ''}`
      })
      .join('\n')

    const resultText =
      `🎊 <b>本局结算完成</b> 🎊\n\n` +
      `📊 <b>比分榜：</b>\n${scoreBoard}\n\n` +
      `🏆 赢家：${winnerNames}\n` +
      `💰 获得奖励：<b>${perWinnerPrize}</b> 抖币 (已扣除2%抽水)\n\n` +
      `感谢大家的参与！`

    if (progressMsgId) {
      await editMessage(chatId, progressMsgId, resultText)
    }
  } catch (err: any) {
    console.error('[DICE-BOT] Rolling Error:', err)
    await sendMessage(
      chatId,
      `🚨 <b>结算过程发生异常:</b>\n${sanitizeError(err.message)}\n\n💰 正在尝试为您自动退回本金...`
    )

    try {
      const { data: refundRes, error: refundError } = await supabase.rpc('refund_dice_room', {
        p_room_id: roomId
      })

      if (refundError || !refundRes?.success) {
        await sendMessage(
          chatId,
          `❌ <b>自动退款失败:</b> ${refundRes?.message || refundError?.message}\n请联系管理员处理房ID: <code>${roomId}</code>`
        )
      } else {
        await sendMessage(chatId, `✅ <b>退款成功！</b> 本金已原路退回您的余额。`)
      }
    } catch (finalErr: any) {
      console.error('[DICE-BOT] Critical Refund Error:', finalErr)
      await sendMessage(chatId, `🚨 <b>严重错误:</b> 无法完成退款，请务必保留截图联系管理员。`)
    }
  }
}
