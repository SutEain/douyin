import { supabase } from '../supabaseClient.ts'
import { sendMessage, answerCallbackQuery, editMessage, sendDiceWithRetry } from '../telegram.ts'
import { escapeHTML, sanitizeError } from '../utils/text.ts'
import { checkDiceTimeout } from './diceTimeout.ts'

/**
 * 处理骰子比大小指令: tz [金额] [人数]
 */
export async function handleDiceCommand(chatId: number, text: string, message: any) {
  const officialGroupId = Deno.env.get('OFFICIAL_GROUP_ID')

  // 1. 验证权限 (仅限官方群)
  if (String(chatId) !== String(officialGroupId)) {
    // 不是官方群，直接返回（包括私聊和其他群组）
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

    // 🎯 先异步检查过期房间并发送消息（不阻塞主流程）
    checkDiceTimeout().catch((e) => {
      console.error('[DICE-TIMEOUT] 检查过期房间异常:', e)
    })

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
        console.log(`[Dice] 房间创建失败: ${res.message}, chatId=${chatId}`)
      }
      return
    }

    const roomId = res.room_id
    const diceText =
      `🎲 <b>新开局：骰子比大小</b>\n\n` +
      `👤 房主：<b>${escapeHTML(sender.nickname)}</b>\n` +
      `💰 赌注：<b>${Number(amount).toFixed(2)}</b> 抖币\n` +
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
    console.error('Dice Command Error:', err)
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
      // 🚨 群组消息静默处理，不发送提示（chatId < 0 表示群组）
      if (chatId < 0) {
        // 群组中静默返回，不显示任何提示
        await answerCallbackQuery(callbackQueryId, '', false)
        return
      }
      // 私聊消息仍然发送提示
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

    // 🎯 异步检查过期房间并发送消息（不阻塞主流程）
    checkDiceTimeout().catch((e) => {
      console.error('[DICE-TIMEOUT] 检查过期房间异常:', e)
    })

    // 3. 只有当 RPC 明确返回 is_full 时，才由当前请求触发开奖流程
    if (res.is_full) {
      console.log(`[Dice] 房间已满，准备开奖: ${roomId}`)

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
        `💰 赌注：<b>${Number(room.bet_amount).toFixed(2)}</b> 抖币\n` +
        `👥 人数：<b>${room.current_count}/${room.target_count}</b>\n` +
        `⏳ 状态：🔥 <b>满员，正在依次开奖...</b>\n\n` +
        `📜 <b>游戏规则：</b>\n` +
        `• 限制：本群同时只能存在 1 局游戏\n\n` +
        `${playerList}`

      // 移除加入按钮并更新状态
      await editMessage(chatId, messageId, diceText, { reply_markup: { inline_keyboard: [] } })

      // 🎯 异步触发开奖流程，避免 Edge Function 超时（60秒限制）
      // 使用 fire-and-forget 模式，让开奖流程在后台执行
      startRolling(chatId, roomId).catch((err) => {
        console.error('[DiceGame] 开奖流程异常:', err)
        // 如果开奖失败，发送错误消息
        sendMessage(
          chatId,
          `🚨 <b>开奖过程发生异常:</b>\n${sanitizeError(err.message)}\n\n💰 正在尝试为您自动退回本金...`
        ).catch((e) => console.error('[DiceGame] 发送错误消息失败:', e))
      })
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
        `💰 赌注：<b>${Number(room.bet_amount).toFixed(2)}</b> 抖币\n` +
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
    console.error('Join Dice Error:', err)
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
      .select('id, nickname')
      .eq('tg_user_id', tgUserId)
      .single()

    if (!user) return

    // 2. 获取房间信息（用于判断取消原因）
    const { data: room } = await supabase
      .from('dice_rooms')
      .select('current_count, target_count, owner:profiles!dice_rooms_owner_id_fkey(nickname)')
      .eq('id', roomId)
      .single()

    // 3. 调用 RPC 取消房间
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

    // 4. 编辑原消息
    await editMessage(chatId, messageId, '❌ <b>本局游戏已被房主取消。</b>', {
      reply_markup: { inline_keyboard: [] }
    })

    // 5. 发送取消通知消息
    let cancelMessage = ''
    if (room && room.current_count === 1) {
      // 只有房主一人，没有人加入
      cancelMessage =
        `🎲 <b>骰子游戏已解散</b>\n\n` +
        `👤 房主：<b>${escapeHTML(room.owner.nickname)}</b>\n` +
        `❌ 原因：没有人加入\n` +
        `💰 本金已退回`
    } else {
      // 有其他玩家加入，但房主取消了
      cancelMessage =
        `🎲 <b>骰子游戏已解散</b>\n\n` +
        `👤 房主：<b>${escapeHTML(room?.owner?.nickname || user.nickname)}</b>\n` +
        `❌ 原因：房主取消游戏\n` +
        `💰 本金已退回所有玩家`
    }

    await sendMessage(chatId, cancelMessage)
  } catch (err: any) {
    console.error('Cancel Dice Error:', err)
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

    // 2. 发送一条持久化的“战报看板”
    const progressMsgRes = await sendMessage(chatId, `🎲 <b>正在依次为玩家掷骰子...</b>`)
    const progressMsgId = progressMsgRes.ok ? progressMsgRes.result.message_id : null

    const results: any[] = []

    for (const player of players) {
      // 🔥 使用带重试机制的发送骰子函数（最多重试7次，增加成功率）
      console.log(`[DiceGame] 🎲 开始为玩家 ${player.user?.nickname || '未知'} 发送骰子...`)
      const res = await sendDiceWithRetry(chatId, { emoji: '🎲' }, 7, 1000)

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
      // 🎯 减少等待时间，避免 Edge Function 超时
      await new Promise((r) => setTimeout(r, 1000))
    }

    // 4. 结算逻辑：统一走 RPC settle_dice_room，金额在库内计算，避免 JS 传错导致 1000万/1亿 等异常
    const rollResultsForRpc = results.map((r) => ({ user_id: r.user_id, value: r.value }))
    const { data: settleRes, error: settleError } = await supabase.rpc('settle_dice_room', {
      p_room_id: roomId,
      p_roll_results: JSON.stringify(rollResultsForRpc)
    })

    if (settleError || !settleRes?.success) {
      throw new Error(settleRes?.message || settleError?.message || '结算失败')
    }

    const maxVal = settleRes.max_value as number
    const perWinnerPrize = Number(settleRes.per_winner_prize)
    const isDrawNoCommission = settleRes.is_draw_no_commission === true

    // 5. 宣布最终结果
    const winnerNames = (settleRes.winners as string[])
      .map((winnerId) => {
        const r = results.find((x) => x.user_id === winnerId)
        return `<b>${escapeHTML(r?.name || '玩家')}</b>`
      })
      .join(', ')
    const scoreBoard = results
      .map((r, i) => {
        const isWinner = (settleRes.winners as string[]).includes(r.user_id)
        return `${i + 1}. ${escapeHTML(r.name || '玩家')}: <b>${r.value}</b> 点 ${isWinner ? '👑' : ''}`
      })
      .join('\n')

    const commissionText = isDrawNoCommission ? '(平局不抽水)' : '(已扣除2%抽水)'
    const resultText =
      `🎊 <b>本局结算完成</b> 🎊\n\n` +
      `📊 <b>比分榜：</b>\n${scoreBoard}\n\n` +
      `🏆 赢家：${winnerNames}\n` +
      `💰 获得奖励：<b>${perWinnerPrize.toFixed(2)}</b> 抖币 ${commissionText}\n\n` +
      `感谢大家的参与！`

    if (progressMsgId) {
      await editMessage(chatId, progressMsgId, resultText)
    }
  } catch (err: any) {
    console.error('Rolling Error:', err)

    try {
      const { data: refundRes, error: refundError } = await supabase.rpc('refund_dice_room', {
        p_room_id: roomId
      })

      if (refundError || !refundRes?.success) {
        await sendMessage(
          chatId,
          `🚨 <b>骰子游戏没结算 已退回</b>\n\n` +
            `❌ 原因：结算过程发生异常\n` +
            `💰 本金已退回所有玩家\n\n` +
            `⚠️ 如遇问题请联系管理员，房ID: <code>${roomId}</code>`
        )
      } else {
        await sendMessage(
          chatId,
          `🎲 <b>骰子游戏没结算 已退回</b>\n\n` +
            `❌ 原因：结算过程发生异常\n` +
            `💰 本金已退回所有玩家`
        )
      }
    } catch (finalErr: any) {
      console.error('Critical Refund Error:', finalErr)
      await sendMessage(
        chatId,
        `🚨 <b>骰子游戏没结算 已退回</b>\n\n` +
          `❌ 原因：结算过程发生异常\n` +
          `💰 正在处理退款，如未到账请联系管理员\n` +
          `房ID: <code>${roomId}</code>`
      )
    }
  }
}
