import { supabase } from '../supabaseClient.ts'
import { sendMessage, answerCallbackQuery, editMessage } from '../telegram.ts'
import { escapeHTML, sanitizeError } from '../utils/text.ts'

/**
 * 🎯 简洁版：处理猜拳指令: cq [金额]
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
      .select('id, nickname, is_banned, ban_reason')
      .eq('tg_user_id', message.from.id)
      .single()

    if (!sender) {
      await sendMessage(chatId, '❌ 您尚未在系统中注册，请先在私聊中激活机器人。')
      return
    }

    if (sender.is_banned) {
      const reason = sender.ban_reason || '由于违反社区规范，您的账号已被封禁。'
      await sendMessage(chatId, `🚫 <b>您的账号已被封禁</b>\n\n原因: ${reason}`)
      return
    }

    // 3. 🎯 调用 RPC 创建房间（自动处理超时）
    const { data: res, error } = await supabase.rpc('create_rps_room', {
      p_owner_id: sender.id,
      p_group_id: chatId,
      p_bet_amount: amount
    })

    if (error) throw error
    if (!res.success) {
      if (chatId > 0) {
        await sendMessage(chatId, `❌ ${res.message}`)
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
          [{ text: '💰 点击加入', callback_data: `rps_join_${roomId}` }],
          [{ text: '❌ 取消房间 (仅房主)', callback_data: `rps_cancel_${roomId}` }]
        ]
      }
    })
  } catch (err: any) {
    console.error('[RPS-BOT-V2] RPS Command Error:', err)
    await sendMessage(chatId, `❌ 游戏发起失败: ${sanitizeError(err.message)}`)
  }
}

/**
 * 🎯 简洁版：处理加入游戏回调
 */
export async function handleJoinRpsGame(
  chatId: number,
  messageId: number,
  callbackQueryId: string,
  roomId: string,
  tgUserId: number
) {
  try {
    // 🔥 0. 如果是群组消息，验证用户是否在群组中（防止退群后仍能自动加入）
    if (chatId < 0) {
      const { BOT_TOKEN, TG_API_BASE } = await import('../env.ts')
      const getChatMemberUrl = `${TG_API_BASE}/bot${BOT_TOKEN}/getChatMember`

      try {
        const memberResponse = await fetch(getChatMemberUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            user_id: tgUserId
          })
        })

        const memberResult = await memberResponse.json()

        // 如果用户不在群组中（left, kicked, 或错误），拒绝加入
        if (
          !memberResult.ok ||
          (memberResult.result?.status &&
            ['left', 'kicked', 'restricted'].includes(memberResult.result.status))
        ) {
          console.log(
            `[RPS-BOT] User ${tgUserId} is not in group ${chatId}, status: ${memberResult.result?.status}`
          )
          await answerCallbackQuery(callbackQueryId, '❌ 您已不在群组中，无法加入游戏', true)
          return
        }
      } catch (checkError) {
        // 如果检查失败，记录日志但继续处理（避免因 API 问题影响正常用户）
        console.error('[RPS-BOT] Failed to check chat member:', checkError)
      }
    }

    const { data: user } = await supabase
      .from('profiles')
      .select('id, nickname, is_banned')
      .eq('tg_user_id', tgUserId)
      .single()

    if (!user) {
      await answerCallbackQuery(callbackQueryId, '❌ 请先在私聊中激活机器人再参与游戏', true)
      return
    }

    if (user.is_banned) {
      await answerCallbackQuery(callbackQueryId, '', false)
      return
    }

    // 🎯 调用 RPC 加入房间（自动处理超时）
    const { data: res, error } = await supabase.rpc('join_rps_room', {
      p_room_id: roomId,
      p_user_id: user.id
    })

    if (error) throw error
    if (!res.success) {
      // 🎯 判断是否是超时
      const isTimeout = res.message?.includes('超时') || res.message?.includes('房间已超时')
      if (isTimeout) {
        await answerCallbackQuery(callbackQueryId, res.message, false)
        // 🎯 超时：编辑原消息
        const timeoutMessage =
          `🪨✂️📄 <b>游戏已取消</b>\n\n` + `⏰ 房间已超时\n` + `💰 本金已自动退回所有玩家`
        await editMessage(chatId, messageId, timeoutMessage)
      } else {
        // 🔥 其他错误（如房间已满）：也编辑原消息
        await answerCallbackQuery(callbackQueryId, res.message, false)

        // 判断是否是房间已满
        const isFull = res.message?.includes('房间已满') || res.message?.includes('已满')
        if (isFull) {
          const fullMessage =
            `🪨✂️📄 <b>游戏已取消</b>\n\n` + `❌ 房间已满\n` + `💰 本金已自动退回所有玩家`
          await editMessage(chatId, messageId, fullMessage)
        } else {
          // 其他错误，显示原错误信息
          const errorMessage =
            `🪨✂️📄 <b>游戏已取消</b>\n\n` + `❌ ${res.message}\n` + `💰 本金已自动退回所有玩家`
          await editMessage(chatId, messageId, errorMessage)
        }
      }
      return
    }

    await answerCallbackQuery(callbackQueryId, '✅ 成功加入游戏！', false)

    // 更新消息，显示出手按钮
    await updateRpsRoomMessage(chatId, messageId, roomId)
  } catch (err: any) {
    console.error('[RPS-BOT] Join Error:', err)
    const isTimeout =
      err.message?.includes('超时') ||
      err.message?.includes('timeout') ||
      err.message?.includes('房间已超时')

    if (isTimeout) {
      await answerCallbackQuery(callbackQueryId, '⏰ 房间已超时', false)
      // 🎯 超时：编辑原消息
      const timeoutMessage =
        `🪨✂️📄 <b>游戏已取消</b>\n\n` + `⏰ 房间已超时\n` + `💰 本金已自动退回所有玩家`
      await editMessage(chatId, messageId, timeoutMessage)
    } else {
      await answerCallbackQuery(callbackQueryId, `❌ 操作失败: ${sanitizeError(err.message)}`, true)
    }
  }
}

/**
 * 🎯 简洁版：处理出手回调
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
    const { data: user } = await supabase
      .from('profiles')
      .select('id, nickname')
      .eq('tg_user_id', tgUserId)
      .single()

    if (!user) {
      await answerCallbackQuery(callbackQueryId, '❌ 用户信息不存在', true)
      return
    }

    // 🎯 调用 RPC 出手（如果双方都出手则自动结算）
    const { data: res, error } = await supabase.rpc('make_rps_choice', {
      p_room_id: roomId,
      p_user_id: user.id,
      p_choice: choice
    })

    if (error) throw error
    if (!res.success) {
      // 🎯 判断是否是超时
      const isTimeout = res.message?.includes('超时') || res.message?.includes('房间已超时')
      if (isTimeout) {
        await answerCallbackQuery(callbackQueryId, res.message, false)
        // 🎯 超时：编辑原消息
        const timeoutMessage =
          `🪨✂️📄 <b>游戏已取消</b>\n\n` + `⏰ 房间已超时\n` + `💰 本金已自动退回所有玩家`
        await editMessage(chatId, messageId, timeoutMessage, {
          reply_markup: { inline_keyboard: [] } // 移除按钮
        })
      } else {
        // 🔥 其他错误（如已出手）：显示提示并更新消息
        await answerCallbackQuery(callbackQueryId, res.message, false)
        // 更新消息以反映当前状态
        await updateRpsRoomMessage(chatId, messageId, roomId)
      }
      return
    }

    const choiceEmoji = choice === 'rock' ? '🪨' : choice === 'scissors' ? '✂️' : '📄'
    await answerCallbackQuery(callbackQueryId, `✅ 你选择了 ${choiceEmoji}`, false)

    // 🎯 如果双方都出手了，显示结果
    if (res.both_chosen) {
      console.log('[RPS-BOT] Both chosen, showing result:', {
        roomId,
        result: res.result,
        winner_prize: res.winner_prize
      })
      await showRpsResult(chatId, messageId, roomId, res)
    } else {
      // 更新消息，显示当前状态
      console.log('[RPS-BOT] Not both chosen yet, updating message')
      await updateRpsRoomMessage(chatId, messageId, roomId)
    }
  } catch (err: any) {
    console.error('[RPS-BOT] Choice Error:', err)
    const isTimeout =
      err.message?.includes('超时') ||
      err.message?.includes('timeout') ||
      err.message?.includes('房间已超时')

    if (isTimeout) {
      await answerCallbackQuery(callbackQueryId, '⏰ 房间已超时', false)
      // 🎯 超时：编辑原消息
      const timeoutMessage =
        `🪨✂️📄 <b>游戏已取消</b>\n\n` + `⏰ 房间已超时\n` + `💰 本金已自动退回所有玩家`
      await editMessage(chatId, messageId, timeoutMessage)
    } else {
      await answerCallbackQuery(callbackQueryId, `❌ 操作失败: ${sanitizeError(err.message)}`, true)
    }
  }
}

/**
 * 🎯 显示猜拳结果
 */
async function showRpsResult(chatId: number, messageId: number, roomId: string, result: any) {
  try {
    console.log('[RPS-BOT] showRpsResult called:', { roomId, result })

    // 🔥 简化查询，避免外键关联问题
    const { data: room, error: roomError } = await supabase
      .from('rps_rooms')
      .select(
        'owner_id, opponent_id, owner_choice, opponent_choice, winner_id, bet_amount, total_prize'
      )
      .eq('id', roomId)
      .single()

    if (roomError || !room) {
      console.error('[RPS-BOT] Room query error:', roomError)
      return
    }

    console.log('[RPS-BOT] Room data:', {
      owner_choice: room.owner_choice,
      opponent_choice: room.opponent_choice,
      winner_id: room.winner_id,
      result: result.result
    })

    // 获取玩家昵称
    const userIds: string[] = [room.owner_id]
    if (room.opponent_id) {
      userIds.push(room.opponent_id)
    }
    if (room.winner_id && !userIds.includes(room.winner_id)) {
      userIds.push(room.winner_id)
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, nickname')
      .in('id', userIds)

    const nicknameMap = new Map<string, string>()
    if (profiles) {
      profiles.forEach((p) => nicknameMap.set(p.id, p.nickname))
    }

    const ownerName = nicknameMap.get(room.owner_id) || '玩家A'
    const opponentName = nicknameMap.get(room.opponent_id) || '玩家B'
    const winnerName = room.winner_id ? nicknameMap.get(room.winner_id) || '未知' : null

    const ownerChoiceEmoji =
      room.owner_choice === 'rock' ? '🪨' : room.owner_choice === 'scissors' ? '✂️' : '📄'
    const opponentChoiceEmoji =
      room.opponent_choice === 'rock' ? '🪨' : room.opponent_choice === 'scissors' ? '✂️' : '📄'

    let resultText = ''
    if (result.result === 'draw') {
      resultText =
        `🎊 <b>本局结算完成</b> 🎊\n\n` +
        `👤 ${escapeHTML(ownerName)}: ${ownerChoiceEmoji}\n` +
        `👤 ${escapeHTML(opponentName)}: ${opponentChoiceEmoji}\n\n` +
        `🤝 <b>平局！</b>\n` +
        `💰 本金已退回双方`
    } else {
      const winnerPrize = result.winner_prize || (room.total_prize ? room.total_prize * 0.98 : 0)
      resultText =
        `🎊 <b>本局结算完成</b> 🎊\n\n` +
        `👤 ${escapeHTML(ownerName)}: ${ownerChoiceEmoji}\n` +
        `👤 ${escapeHTML(opponentName)}: ${opponentChoiceEmoji}\n\n` +
        `🏆 赢家：<b>${escapeHTML(winnerName || '未知')}</b>\n` +
        `💰 获得奖励：<b>${Number(winnerPrize).toFixed(2)}</b> 抖币 (已扣除2%抽水)`
    }

    await editMessage(chatId, messageId, resultText, {
      reply_markup: { inline_keyboard: [] } // 移除按钮
    })
  } catch (err: any) {
    console.error('[RPS-BOT-V2] Show Result Error:', err)
  }
}

/**
 * 🎯 更新猜拳房间消息
 */
async function updateRpsRoomMessage(chatId: number, messageId: number, roomId: string) {
  try {
    // 🔥 简化查询，避免外键关联问题
    const { data: room, error: roomError } = await supabase
      .from('rps_rooms')
      .select('owner_id, opponent_id, bet_amount, owner_choice, opponent_choice, status')
      .eq('id', roomId)
      .single()

    if (roomError || !room) {
      console.error('[RPS-BOT] Room query error:', roomError)
      return
    }

    // 获取玩家昵称
    const userIds: string[] = [room.owner_id]
    if (room.opponent_id) {
      userIds.push(room.opponent_id)
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, nickname')
      .in('id', userIds)

    const nicknameMap = new Map<string, string>()
    if (profiles) {
      profiles.forEach((p) => nicknameMap.set(p.id, p.nickname))
    }

    const ownerName = nicknameMap.get(room.owner_id) || '未知'
    const opponentName = room.opponent_id
      ? nicknameMap.get(room.opponent_id) || '未知'
      : '等待中...'

    const ownerStatus = room.owner_choice ? '✅ 已出手' : '⏳ 等待中'
    const opponentStatus = room.opponent_choice
      ? '✅ 已出手'
      : room.opponent_id
        ? '⏳ 等待中'
        : '⏳ 等待加入'

    const waitingText =
      `🪨✂️📄 <b>石头剪刀布对决</b>\n\n` +
      `👤 玩家A：<b>${escapeHTML(ownerName)}</b> ${ownerStatus}\n` +
      `👤 玩家B：<b>${escapeHTML(opponentName)}</b> ${opponentStatus}\n` +
      `💰 赌注：<b>${Number(room.bet_amount).toFixed(2)}</b> 抖币/人\n` +
      `🎁 奖池：<b>${(room.bet_amount * 2).toFixed(2)}</b> 抖币`

    const keyboard: any = {
      inline_keyboard: []
    }

    // 🔥 只要双方都加入且游戏未结束，就显示按钮（让用户自己选择，在 handleRpsChoice 中检查是否已出手）
    if (room.opponent_id && room.status === 'waiting') {
      keyboard.inline_keyboard = [
        [
          { text: '🪨 石头', callback_data: `rps_choice_${roomId}_rock` },
          { text: '✂️ 剪刀', callback_data: `rps_choice_${roomId}_scissors` },
          { text: '📄 布', callback_data: `rps_choice_${roomId}_paper` }
        ]
      ]
    }

    await editMessage(chatId, messageId, waitingText, { reply_markup: keyboard })
  } catch (err: any) {
    console.error('[RPS-BOT-V2] Update Message Error:', err)
  }
}

/**
 * 🎯 简洁版：处理取消房间回调
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
      .select('id')
      .eq('tg_user_id', tgUserId)
      .single()

    if (!user) {
      await answerCallbackQuery(callbackQueryId, '❌ 用户信息不存在', true)
      return
    }

    // 🎯 调用 RPC 取消房间
    const { data: res, error } = await supabase.rpc('cancel_rps_room', {
      p_room_id: roomId,
      p_user_id: user.id
    })

    if (error) throw error
    if (!res.success) {
      await answerCallbackQuery(callbackQueryId, res.message, true)
      return
    }

    await answerCallbackQuery(callbackQueryId, '✅ 房间已取消，本金已退回', false)

    // 更新消息
    await editMessage(chatId, messageId, `🪨✂️📄 <b>房间已取消</b>\n\n本金已退回。`)
  } catch (err: any) {
    console.error('[RPS-BOT-V2] Cancel Error:', err)
    await answerCallbackQuery(callbackQueryId, `❌ 操作失败: ${sanitizeError(err.message)}`, true)
  }
}
