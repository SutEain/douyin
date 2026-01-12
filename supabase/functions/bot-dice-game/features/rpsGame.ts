import { supabase } from '../supabaseClient.ts'
import {
  sendMessage,
  answerCallbackQuery,
  editMessage,
  editMessageReplyMarkup
} from '../telegram.ts'
import { escapeHTML, sanitizeError } from '../utils/text.ts'

/**
 * 处理猜拳指令: cq [金额]
 */
export async function handleRpsCommand(chatId: number, text: string, message: any) {
  const diceGroupId = Deno.env.get('DICE_GROUP_ID')

  // 1. 验证权限 (仅限游戏群)
  if (String(chatId) !== String(diceGroupId)) {
    return
  }

  const parts = text.trim().split(/\s+/)
  const amount = parseFloat(parts[1])

  if (isNaN(amount) || amount < 5 || amount > 10000) {
    if (chatId > 0) {
      await sendMessage(chatId, '❌ 单局投注金额限制为 5 - 10000 抖币')
    }
    return
  }

  try {
    // 2. 获取发起者信息
    const { data: sender } = await supabase
      .from('profiles')
      .select('id, nickname, tg_user_id, is_banned, ban_reason')
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
    const { data: res, error } = await supabase.rpc('create_rps_room', {
      p_owner_id: sender.id,
      p_group_id: chatId,
      p_bet_amount: amount
    })

    if (error) throw error
    if (!res.success) {
      if (chatId > 0) {
        await sendMessage(chatId, `❌ 创建失败: ${res.message}`)
      } else {
        console.log(`[RPS-BOT] 房间创建失败: ${res.message}, chatId=${chatId}`)
      }
      return
    }

    const roomId = res.room_id
    const rpsText =
      `🪨✂️📄 <b>石头剪刀布挑战</b>\n\n` +
      `👤 发起人：<b>${escapeHTML(sender.nickname)}</b>\n` +
      `💰 赌注：<b>${Number(amount).toFixed(2)}</b> 抖币\n` +
      `⏳ 状态：等待对手加入\n\n` +
      `📜 <b>游戏规则：</b>\n` +
      `• 金额范围：5 - 10000 抖币\n` +
      `• 1v1 对决，赢家独得奖金\n` +
      `• 抽水：赢家奖金抽取 2%\n` +
      `• 平局：退回本金，不抽水\n` +
      `• 限制：本群同时只能存在 1 局猜拳游戏`

    await sendMessage(chatId, rpsText, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💪 接受挑战', callback_data: `rps_join_${roomId}` }],
          [{ text: '❌ 取消 (仅发起人)', callback_data: `rps_cancel_${roomId}` }]
        ]
      }
    })
  } catch (err: any) {
    console.error('[RPS-BOT] RPS Command Error:', err)
    await sendMessage(chatId, `❌ 游戏发起失败: ${sanitizeError(err.message)}`)
  }
}

/**
 * 处理加入游戏回调
 */
export async function handleJoinRpsGame(
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
    const { data: res, error } = await supabase.rpc('join_rps_room', {
      p_room_id: roomId,
      p_user_id: user.id
    })

    if (error) throw error

    if (!res.success) {
      await answerCallbackQuery(callbackQueryId, `❌ ${res.message}`, true)
      return
    }

    // 3. 获取更新后的房间信息
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

    if (!room) throw new Error('房间不存在')

    await answerCallbackQuery(callbackQueryId, '✅ 成功加入游戏！请选择出手')

    // 4. 更新消息：显示出手按钮
    const updatedText =
      `🪨✂️📄 <b>石头剪刀布对决</b>\n\n` +
      `👤 玩家A：<b>${escapeHTML(room.owner.nickname)}</b>\n` +
      `👤 玩家B：<b>${escapeHTML(room.opponent.nickname)}</b>\n` +
      `💰 赌注：<b>${Number(room.bet_amount).toFixed(2)}</b> 抖币/人\n` +
      `🎁 奖池：<b>${(room.bet_amount * 2).toFixed(2)}</b> 抖币\n\n` +
      `⏳ 请双方选择出手！`

    await editMessage(chatId, messageId, updatedText, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🪨 石头', callback_data: `rps_choice_${roomId}_rock` },
            { text: '✂️ 剪刀', callback_data: `rps_choice_${roomId}_scissors` },
            { text: '📄 布', callback_data: `rps_choice_${roomId}_paper` }
          ]
        ]
      }
    })

    // 保存消息ID
    await supabase.from('rps_rooms').update({ message_id: messageId }).eq('id', roomId)
  } catch (err: any) {
    console.error('[RPS-BOT] Join Error:', err)
    await answerCallbackQuery(callbackQueryId, `❌ 加入失败: ${sanitizeError(err.message)}`, true)
  }
}

/**
 * 处理出手选择回调
 */
export async function handleRpsChoice(
  chatId: number,
  messageId: number,
  callbackQueryId: string,
  roomId: string,
  choice: string,
  tgUserId: number
) {
  try {
    // 1. 获取用户信息
    const { data: user } = await supabase
      .from('profiles')
      .select('id, nickname')
      .eq('tg_user_id', tgUserId)
      .single()

    if (!user) {
      await answerCallbackQuery(callbackQueryId, '❌ 用户信息不存在', true)
      return
    }

    // 2. 保存选择
    const { data: res, error } = await supabase.rpc('save_rps_choice', {
      p_room_id: roomId,
      p_user_id: user.id,
      p_choice: choice
    })

    if (error) throw error

    if (!res.success) {
      await answerCallbackQuery(callbackQueryId, `❌ ${res.message}`, true)
      return
    }

    await answerCallbackQuery(callbackQueryId, `✅ 你选择了 ${getChoiceEmoji(choice)}`)

    // 3. 获取房间信息
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

    if (!room) throw new Error('房间不存在')

    // 4. 更新消息显示
    const ownerStatus = room.owner_choice ? '✅ 已出手' : '⏳ 等待中'
    const opponentStatus = room.opponent_choice ? '✅ 已出手' : '⏳ 等待中'

    const waitingText =
      `🪨✂️📄 <b>石头剪刀布对决</b>\n\n` +
      `👤 玩家A：<b>${escapeHTML(room.owner.nickname)}</b> ${ownerStatus}\n` +
      `👤 玩家B：<b>${escapeHTML(room.opponent.nickname)}</b> ${opponentStatus}\n` +
      `💰 赌注：<b>${Number(room.bet_amount).toFixed(2)}</b> 抖币/人\n` +
      `🎁 奖池：<b>${(room.bet_amount * 2).toFixed(2)}</b> 抖币\n\n` +
      (room.owner_choice && !room.opponent_choice
        ? `⏳ 请 <b>${escapeHTML(room.opponent.nickname)}</b> 选择出手！`
        : !room.owner_choice && room.opponent_choice
          ? `⏳ 请 <b>${escapeHTML(room.owner.nickname)}</b> 选择出手！`
          : `⏳ 请双方选择出手！`)

    await editMessage(chatId, messageId, waitingText, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🪨 石头', callback_data: `rps_choice_${roomId}_rock` },
            { text: '✂️ 剪刀', callback_data: `rps_choice_${roomId}_scissors` },
            { text: '📄 布', callback_data: `rps_choice_${roomId}_paper` }
          ]
        ]
      }
    })

    // 5. 如果双方都出手了，触发结算
    if (res.both_chosen) {
      await settleRpsGame(chatId, messageId, roomId)
    }
  } catch (err: any) {
    console.error('[RPS-BOT] Choice Error:', err)
    await answerCallbackQuery(callbackQueryId, `❌ 操作失败: ${sanitizeError(err.message)}`, true)
  }
}

/**
 * 结算游戏
 */
async function settleRpsGame(chatId: number, messageId: number, roomId: string) {
  try {
    // 1. 调用结算 RPC
    const { data: res, error } = await supabase.rpc('settle_rps_room', {
      p_room_id: roomId
    })

    if (error) throw error

    // 2. 获取最终房间信息
    const { data: room } = await supabase
      .from('rps_rooms')
      .select(
        `
        *,
        owner:owner_id (nickname),
        opponent:opponent_id (nickname),
        winner:winner_id (nickname)
      `
      )
      .eq('id', roomId)
      .single()

    if (!room) throw new Error('房间不存在')

    // 3. 生成结果文案
    let resultText = ''

    if (res.result === 'draw') {
      // 平局
      resultText =
        `🤝 <b>石头剪刀布对决结果</b>\n\n` +
        `👤 ${escapeHTML(room.owner.nickname)} 出了：${getChoiceEmoji(room.owner_choice)}\n` +
        `👤 ${escapeHTML(room.opponent.nickname)} 出了：${getChoiceEmoji(room.opponent_choice)}\n\n` +
        `🤝 <b>平局！</b>\n` +
        `💰 本金已退回双方账户 (各 ${Number(room.bet_amount).toFixed(2)} 抖币)\n\n` +
        `再来一局决胜负？`
    } else {
      // 有赢家
      const winnerName = res.result === 'owner_win' ? room.owner.nickname : room.opponent.nickname
      const winnerChoice = res.result === 'owner_win' ? room.owner_choice : room.opponent_choice
      const loserName = res.result === 'owner_win' ? room.opponent.nickname : room.owner.nickname
      const loserChoice = res.result === 'owner_win' ? room.opponent_choice : room.owner_choice

      resultText =
        `🎉 <b>石头剪刀布对决结果</b>\n\n` +
        `👤 ${escapeHTML(room.owner.nickname)} 出了：${getChoiceEmoji(room.owner_choice)}\n` +
        `👤 ${escapeHTML(room.opponent.nickname)} 出了：${getChoiceEmoji(room.opponent_choice)}\n\n` +
        `🏆 赢家：<b>${escapeHTML(winnerName)}</b>\n` +
        `💰 奖金：<b>${Number(res.winner_prize).toFixed(2)}</b> 抖币（已发放）\n` +
        `💸 系统抽水：<b>${Number(res.commission).toFixed(2)}</b> 抖币 (2%)\n\n` +
        `感谢参与！再来一局？`
    }

    // 4. 更新消息
    await editMessage(chatId, messageId, resultText, {
      reply_markup: { inline_keyboard: [] } // 移除所有按钮
    })
  } catch (err: any) {
    console.error('[RPS-BOT] Settle Error:', err)
    await sendMessage(chatId, `❌ 结算失败: ${sanitizeError(err.message)}\n请联系管理员处理`)
  }
}

/**
 * 处理取消房间回调
 */
export async function handleCancelRpsRoom(
  chatId: number,
  messageId: number,
  callbackQueryId: string,
  roomId: string,
  tgUserId: number
) {
  try {
    const { data: user } = await supabase
      .from('profiles')
      .select('id, nickname')
      .eq('tg_user_id', tgUserId)
      .single()

    if (!user) {
      await answerCallbackQuery(callbackQueryId, '❌ 用户信息不存在', true)
      return
    }

    const { data: res, error } = await supabase.rpc('cancel_rps_room', {
      p_room_id: roomId,
      p_user_id: user.id
    })

    if (error) throw error

    if (!res.success) {
      await answerCallbackQuery(callbackQueryId, `❌ ${res.message}`, true)
      return
    }

    await answerCallbackQuery(callbackQueryId, '✅ 房间已取消，本金已退回')

    const cancelText =
      `🪨✂️📄 <b>石头剪刀布挑战</b>\n\n` + `❌ 游戏已被发起人取消\n` + `💰 本金已退回`

    await editMessage(chatId, messageId, cancelText, {
      reply_markup: { inline_keyboard: [] }
    })
  } catch (err: any) {
    console.error('[RPS-BOT] Cancel Error:', err)
    await answerCallbackQuery(callbackQueryId, `❌ 取消失败: ${sanitizeError(err.message)}`, true)
  }
}

/**
 * 获取选择对应的 emoji
 */
function getChoiceEmoji(choice: string): string {
  switch (choice) {
    case 'rock':
      return '🪨 石头'
    case 'scissors':
      return '✂️ 剪刀'
    case 'paper':
      return '📄 布'
    default:
      return '❓'
  }
}
