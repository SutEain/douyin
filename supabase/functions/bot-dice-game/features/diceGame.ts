import { supabase } from '../supabaseClient.ts'
import { sendMessage, answerCallbackQuery, editMessage, sendDiceWithRetry } from '../telegram.ts'
import { escapeHTML, sanitizeError } from '../utils/text.ts'

// 🔥 防重复执行：跟踪正在执行的游戏
const runningGames = new Set<string>()

/**
 * 🎯 简洁版：处理骰子比大小指令: tz [金额] [人数]
 */
export async function handleDiceCommand(chatId: number, text: string, message: any) {
  const diceGroupId = Deno.env.get('DICE_GROUP_ID')

  // 1. 验证权限 (仅限骰子游戏群)
  if (String(chatId) !== String(diceGroupId)) {
    return
  }

  const parts = text.trim().split(/\s+/)
  const amount = parseFloat(parts[1])
  const targetCount = parseInt(parts[2] || '2')

  if (isNaN(amount) || amount < 5 || amount > 10000) {
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
    const { data: res, error } = await supabase.rpc('create_dice_room', {
      p_owner_id: sender.id,
      p_group_id: chatId,
      p_bet_amount: amount,
      p_target_count: targetCount
    })

    if (error) throw error
    if (!res.success) {
      if (chatId > 0) {
        await sendMessage(chatId, `❌ ${res.message}`)
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

    const sentMsg = await sendMessage(chatId, diceText, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💰 点击加入', callback_data: `dice_join_${roomId}` }],
          [{ text: '❌ 取消房间 (仅房主)', callback_data: `dice_cancel_${roomId}` }]
        ]
      }
    })

    // 🎯 保存 message_id（如果需要）
    if (sentMsg.ok) {
      // 可以保存到数据库，但简化版不需要
    }
  } catch (err: any) {
    console.error('[DICE-BOT-V2] Dice Command Error:', err)
    await sendMessage(chatId, `❌ 游戏发起失败: ${sanitizeError(err.message)}`)
  }
}

/**
 * 🎯 简洁版：处理加入游戏回调
 */
export async function handleJoinDiceGame(
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
            `[DICE-BOT] User ${tgUserId} is not in group ${chatId}, status: ${memberResult.result?.status}`
          )
          await answerCallbackQuery(callbackQueryId, '❌ 您已不在群组中，无法加入游戏', true)
          return
        }
      } catch (checkError) {
        // 如果检查失败，记录日志但继续处理（避免因 API 问题影响正常用户）
        console.error('[DICE-BOT] Failed to check chat member:', checkError)
      }
    }

    // 1. 获取用户信息
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

    // 2. 🎯 调用 RPC 加入房间（自动处理超时和满员）
    const { data: res, error } = await supabase.rpc('join_dice_room', {
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
          `🎲 <b>游戏已取消</b>\n\n` + `⏰ 房间已超时\n` + `💰 本金已自动退回所有玩家`
        await editMessage(chatId, messageId, timeoutMessage)
      } else {
        await answerCallbackQuery(callbackQueryId, res.message, true)
      }
      return
    }

    await answerCallbackQuery(callbackQueryId, '✅ 成功加入游戏！', false)

    // 3. 🎯 如果房间满了，自动开始游戏
    if (res.is_full) {
      await startDiceGame(chatId, messageId, roomId)
    } else {
      // 更新消息显示当前人数
      await updateDiceRoomMessage(chatId, messageId, roomId)
    }
  } catch (err: any) {
    console.error('[DICE-BOT] Join Error:', err)
    const isTimeout =
      err.message?.includes('超时') ||
      err.message?.includes('timeout') ||
      err.message?.includes('房间已超时')

    if (isTimeout) {
      await answerCallbackQuery(callbackQueryId, '⏰ 房间已超时', false)
      // 🎯 超时：编辑原消息
      const timeoutMessage =
        `🎲 <b>游戏已取消</b>\n\n` + `⏰ 房间已超时\n` + `💰 本金已自动退回所有玩家`
      await editMessage(chatId, messageId, timeoutMessage)
    } else {
      await answerCallbackQuery(callbackQueryId, `❌ 操作失败: ${sanitizeError(err.message)}`, true)
    }
  }
}

/**
 * 🎯 简洁版：开始游戏（发送骰子并结算）
 */
async function startDiceGame(chatId: number, messageId: number, roomId: string) {
  // 🔥 防重复执行：如果游戏已经在执行，直接返回
  if (runningGames.has(roomId)) {
    console.log(`[DICE-BOT] Game already running for room: ${roomId}`)
    return
  }

  runningGames.add(roomId)

  try {
    console.log(`[DICE-BOT] 🎮 开始游戏流程，房间ID: ${roomId}`)

    // 1. 🔥 先快速检查房间状态，如果已结算则直接返回（防止并发）
    const { data: quickCheck } = await supabase
      .from('dice_rooms')
      .select('status')
      .eq('id', roomId)
      .single()

    if (quickCheck?.status === 'finished') {
      console.log(`[DICE-BOT] Room already finished: ${roomId}`)
      return
    }

    // 2. 获取房间和玩家信息（简化查询，避免外键关联问题）
    const { data: room, error: roomError } = await supabase
      .from('dice_rooms')
      .select('bet_amount, target_count, status, created_at, owner_id')
      .eq('id', roomId)
      .single()

    // 🎯 如果房间不存在
    if (roomError || !room) {
      console.error('[DICE-BOT] Room not found:', roomError, 'Room ID:', roomId)

      // 🔥 检查是否是查询错误（比如权限问题）
      if (roomError?.code === 'PGRST116' || roomError?.message?.includes('No rows')) {
        // 房间确实不存在，可能是被删除了
        const timeoutMessage =
          `🎲 <b>游戏已取消</b>\n\n` + `❌ 房间不存在或已被删除\n` + `💰 本金已自动退回所有玩家`
        await editMessage(chatId, messageId, timeoutMessage)
      } else {
        // 其他查询错误
        console.error('[DICE-BOT] Query error:', roomError)
        const timeoutMessage =
          `🎲 <b>游戏已取消</b>\n\n` + `❌ 无法获取房间信息\n` + `💰 本金已自动退回所有玩家`
        await editMessage(chatId, messageId, timeoutMessage)
      }
      return
    }

    console.log(`[DICE-BOT] Room found: status=${room.status}, target_count=${room.target_count}`)

    // 🎯 🔥 修复：允许 waiting 或 rolling 状态（因为 join_dice_room 会将状态改为 rolling）
    if (room.status === 'cancelled') {
      // 如果是已取消状态，说明已经退款了
      const timeoutMessage =
        `🎲 <b>游戏已取消</b>\n\n` + `⏰ 房间已取消\n` + `💰 本金已自动退回所有玩家`
      await editMessage(chatId, messageId, timeoutMessage)
      return
    }

    if (room.status === 'finished') {
      // 如果是已完成状态，不应该进入这里，但以防万一
      console.warn(`[DICE-BOT] Room already finished. Room ID: ${roomId}`)
      return
    }

    // 🔥 修复：允许 waiting 或 rolling 状态继续执行
    if (room.status !== 'waiting' && room.status !== 'rolling') {
      console.warn(
        `[DICE-BOT] Room status is ${room.status}, not waiting or rolling. Room ID: ${roomId}`
      )
      const timeoutMessage =
        `🎲 <b>游戏已取消</b>\n\n` +
        `❌ 房间状态异常 (${room.status})\n` +
        `💰 本金已自动退回所有玩家`
      await editMessage(chatId, messageId, timeoutMessage)
      return
    }

    // 🎯 检查房间是否超时（双重检查）
    const roomAge = Date.now() - new Date(room.created_at).getTime()
    if (roomAge > 30000) {
      console.warn(`[DICE-BOT] Room timeout detected. Room ID: ${roomId}, Age: ${roomAge}ms`)
      const timeoutMessage =
        `🎲 <b>游戏已取消</b>\n\n` + `⏰ 房间已超时\n` + `💰 本金已自动退回所有玩家`
      await editMessage(chatId, messageId, timeoutMessage)
      return
    }

    // 2. 获取玩家信息（简化查询）
    const { data: players, error: playersError } = await supabase
      .from('dice_room_players')
      .select('id, user_id')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })

    if (playersError) {
      console.error('[DICE-BOT] Players query error:', playersError)
      throw new Error('无法获取玩家信息')
    }

    if (!players || players.length === 0) {
      throw new Error('没有玩家')
    }

    // 3. 获取玩家昵称
    const playerIds = players.map((p) => p.user_id)
    const { data: playerProfiles } = await supabase
      .from('profiles')
      .select('id, nickname')
      .in('id', playerIds)

    // 创建昵称映射
    const nicknameMap = new Map<string, string>()
    if (playerProfiles) {
      playerProfiles.forEach((p) => nicknameMap.set(p.id, p.nickname))
    }

    // 合并玩家信息和昵称
    const playersWithNicknames = players.map((p) => ({
      ...p,
      user: { nickname: nicknameMap.get(p.user_id) || '未知' }
    }))

    // 获取房主昵称
    const ownerName = nicknameMap.get(room.owner_id) || '未知'

    // 4. 🔥 编辑原消息，显示游戏开始，并移除按钮
    const startMessage =
      `🎲 <b>游戏进行中...</b>\n\n` +
      `👤 房主：<b>${escapeHTML(ownerName)}</b>\n` +
      `💰 赌注：<b>${Number(room.bet_amount).toFixed(2)}</b> 抖币\n` +
      `👥 参与人数：<b>${playersWithNicknames.length}</b> 人\n\n` +
      `⏳ 正在依次为玩家掷骰子...`

    await editMessage(chatId, messageId, startMessage, {
      reply_markup: { inline_keyboard: [] } // 🔥 移除所有按钮
    })

    // 5. 发送进度消息
    const progressMsg = await sendMessage(chatId, `🎲 <b>正在依次为玩家掷骰子...</b>`)
    const progressMsgId = progressMsg.ok ? progressMsg.result.message_id : null

    // 6. 🎯 为每个玩家发送骰子并收集结果
    const rollResults: Array<{ user_id: string; value: number }> = []

    for (let i = 0; i < playersWithNicknames.length; i++) {
      const player = playersWithNicknames[i]
      const playerName = player.user?.nickname || '未知'

      try {
        console.log(
          `[DICE-BOT] 🎲 开始为玩家 ${playerName} (${i + 1}/${playersWithNicknames.length}) 发送骰子...`
        )

        // 🔥 发送骰子（最多重试7次，增加成功率）
        const res = await sendDiceWithRetry(chatId, { emoji: '🎲' }, 7, 1000)

        if (!res.ok || !res.result?.dice) {
          // 🎯 如果失败，使用随机值（简化处理）
          const fallbackValue = Math.floor(Math.random() * 6) + 1
          const errorMsg = res.description || res.error_code || 'Unknown error'
          console.warn(
            `[DICE-BOT] ⚠️ 玩家 ${playerName} 发送骰子失败 (${errorMsg})，使用随机值: ${fallbackValue}`
          )
          rollResults.push({ user_id: player.user_id, value: fallbackValue })
        } else {
          const value = res.result.dice.value
          console.log(`[DICE-BOT] ✅ 玩家 ${playerName} 掷出: ${value} 点`)
          rollResults.push({ user_id: player.user_id, value })
        }

        // 更新进度消息
        if (progressMsgId) {
          const currentBoard = rollResults
            .map((r, idx) => {
              const p = playersWithNicknames.find((p) => p.user_id === r.user_id)
              return `${idx + 1}. ${escapeHTML(p?.user?.nickname || '玩家')}: <b>${r.value}</b> 点`
            })
            .join('\n')
          await editMessage(
            chatId,
            progressMsgId,
            `🎲 <b>对局进行中...</b>\n\n${currentBoard}\n\n⏳ 正在等待下一位玩家...`
          )
        }

        // 等待（最后一个不需要等待）
        if (i < playersWithNicknames.length - 1) {
          await new Promise((r) => setTimeout(r, 1000))
        }
      } catch (err: any) {
        console.error(`[DICE-BOT] ❌ 处理玩家 ${playerName} 时发生错误:`, err)
        // 🎯 使用随机值继续，避免游戏卡住
        const fallbackValue = Math.floor(Math.random() * 6) + 1
        console.warn(
          `[DICE-BOT] ⚠️ 玩家 ${playerName} 投骰子异常，使用随机值: ${fallbackValue}，继续游戏`
        )
        rollResults.push({ user_id: player.user_id, value: fallbackValue })
      }
    }

    // 7. 🔥 在结算前再次检查房间状态（防止在发送骰子过程中房间被超时处理）
    const { data: finalRoomCheck } = await supabase
      .from('dice_rooms')
      .select('status, created_at')
      .eq('id', roomId)
      .single()

    if (!finalRoomCheck) {
      throw new Error('房间不存在')
    }

    // 🔥 修复：允许 waiting 或 rolling 状态（因为状态可能已经是 rolling）
    if (finalRoomCheck.status === 'cancelled') {
      const roomAge = Date.now() - new Date(finalRoomCheck.created_at).getTime()
      console.warn(
        `[DICE-BOT] Room was cancelled before settlement. Room ID: ${roomId}, Age: ${roomAge}ms`
      )
      throw new Error('房间已取消')
    }

    if (finalRoomCheck.status === 'finished') {
      console.warn(`[DICE-BOT] Room already finished before settlement. Room ID: ${roomId}`)
      throw new Error('房间已结算')
    }

    // 🔥 修复：允许 waiting 或 rolling 状态继续结算
    if (finalRoomCheck.status !== 'waiting' && finalRoomCheck.status !== 'rolling') {
      console.warn(
        `[DICE-BOT] Room status changed to ${finalRoomCheck.status} before settlement. Room ID: ${roomId}`
      )
      const roomAge = Date.now() - new Date(finalRoomCheck.created_at).getTime()
      if (roomAge > 30000) {
        throw new Error('房间已超时')
      } else {
        throw new Error(`房间状态不正确: ${finalRoomCheck.status}`)
      }
    }

    // 8. 🎯 调用 RPC 结算（原子操作）
    const { data: settleRes, error: settleError } = await supabase.rpc('settle_dice_room', {
      p_room_id: roomId,
      p_roll_results: JSON.stringify(rollResults) // 传递 JSON 字符串
    })

    if (settleError || !settleRes?.success) {
      console.error(`[DICE-BOT] ❌ 结算失败:`, settleError || settleRes?.message)

      // 🔥 如果错误是"房间状态不正确"，再次检查房间状态
      if (settleRes?.message?.includes('房间状态不正确')) {
        const { data: errorRoomCheck } = await supabase
          .from('dice_rooms')
          .select('status, created_at')
          .eq('id', roomId)
          .single()

        if (errorRoomCheck) {
          const roomAge = Date.now() - new Date(errorRoomCheck.created_at).getTime()
          console.warn(
            `[DICE-BOT] ⚠️ 结算时房间状态检查: status=${errorRoomCheck.status}, age=${roomAge}ms`
          )
          if (roomAge > 30000 || errorRoomCheck.status === 'cancelled') {
            throw new Error('房间已超时')
          }
        }
      }
      throw new Error(settleRes?.message || settleError?.message || '结算失败')
    }

    console.log(`[DICE-BOT] ✅ 结算成功，赢家: ${settleRes.winners?.length || 0} 人`)

    // 9. 显示最终结果
    const winnerNames = settleRes.winners
      .map((winnerId: string) => {
        const p = playersWithNicknames.find((p) => p.user_id === winnerId)
        return `<b>${escapeHTML(p?.user?.nickname || '玩家')}</b>`
      })
      .join(', ')

    const scoreBoard = rollResults
      .map((r, i) => {
        const p = playersWithNicknames.find((p) => p.user_id === r.user_id)
        const isWinner = settleRes.winners.includes(r.user_id)
        return `${i + 1}. ${escapeHTML(p?.user?.nickname || '玩家')}: <b>${r.value}</b> 点 ${isWinner ? '👑' : ''}`
      })
      .join('\n')

    // 🔥 2人平局时不抽水，显示不同的文案
    const commissionText = settleRes.is_draw_no_commission ? '(平局不抽水)' : '(已扣除2%抽水)'

    const resultText =
      `🎊 <b>本局结算完成</b> 🎊\n\n` +
      `📊 <b>比分榜：</b>\n${scoreBoard}\n\n` +
      `🏆 赢家：${winnerNames}\n` +
      `💰 获得奖励：<b>${settleRes.per_winner_prize.toFixed(2)}</b> 抖币 ${commissionText}\n\n` +
      `感谢大家的参与！`

    // 🔥 只编辑进度消息（第二条）显示最终结果，不编辑原消息（第一条）
    if (progressMsgId && progressMsgId !== messageId) {
      // 编辑进度消息显示结果
      await editMessage(chatId, progressMsgId, resultText)
    } else {
      // 如果没有进度消息，才编辑原消息
      await editMessage(chatId, messageId, resultText, {
        reply_markup: { inline_keyboard: [] } // 移除所有按钮
      })
    }
  } catch (err: any) {
    console.error('[DICE-BOT] Start Game Error:', err)

    // 🎯 判断是否是超时错误
    const isTimeout =
      err.message?.includes('超时') ||
      err.message?.includes('timeout') ||
      err.message?.includes('房间已超时') ||
      err.message?.includes('无法获取房间信息') ||
      err.message?.includes('房间状态不正确')

    // 🔥 如果是"房间状态不正确"，再次检查房间实际状态
    if (err.message?.includes('房间状态不正确')) {
      try {
        const { data: errorRoomCheck } = await supabase
          .from('dice_rooms')
          .select('status, created_at')
          .eq('id', roomId)
          .single()

        if (errorRoomCheck) {
          const roomAge = Date.now() - new Date(errorRoomCheck.created_at).getTime()
          // 如果房间已取消或超时，当作超时处理
          if (errorRoomCheck.status === 'cancelled' || roomAge > 30000) {
            const timeoutMessage =
              `🎲 <b>游戏已取消</b>\n\n` + `⏰ 房间已超时\n` + `💰 本金已自动退回所有玩家`
            await editMessage(chatId, messageId, timeoutMessage)
            return
          }
        }
      } catch (checkErr) {
        console.error('[DICE-BOT] Failed to check room status in error handler:', checkErr)
      }
    }

    if (isTimeout) {
      // 🎯 超时：编辑原消息
      const timeoutMessage =
        `🎲 <b>游戏已取消</b>\n\n` + `⏰ 房间已超时\n` + `💰 本金已自动退回所有玩家`
      await editMessage(chatId, messageId, timeoutMessage)
    } else {
      // 🎯 其他错误：发送新消息
      await sendMessage(
        chatId,
        `🚨 <b>游戏结算失败</b>\n\n` +
          `❌ 原因：${sanitizeError(err.message)}\n` +
          `💰 本金已自动退回所有玩家\n` +
          `房ID: <code>${roomId}</code>`
      )
    }
  } finally {
    // 🔥 清理：移除正在执行的标记
    runningGames.delete(roomId)
  }
}

/**
 * 🎯 更新房间消息
 */
async function updateDiceRoomMessage(chatId: number, messageId: number, roomId: string) {
  try {
    // 🔥 简化查询，避免外键关联问题
    const { data: room, error: roomError } = await supabase
      .from('dice_rooms')
      .select('owner_id, bet_amount, target_count, current_count, status')
      .eq('id', roomId)
      .single()

    if (roomError || !room) {
      console.error('[DICE-BOT] Room query error:', roomError)
      return
    }

    // 获取玩家信息
    const { data: players } = await supabase
      .from('dice_room_players')
      .select('user_id')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })

    if (!players || players.length === 0) {
      return
    }

    // 获取玩家昵称
    const playerIds = players.map((p) => p.user_id)
    const { data: playerProfiles } = await supabase
      .from('profiles')
      .select('id, nickname')
      .in('id', playerIds)

    const nicknameMap = new Map<string, string>()
    if (playerProfiles) {
      playerProfiles.forEach((p) => nicknameMap.set(p.id, p.nickname))
    }

    // 获取房主昵称
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('id', room.owner_id)
      .single()

    const ownerName = ownerProfile?.nickname || '未知'

    // 构建玩家列表
    const playerList = players
      .map((p, i) => {
        const nickname = nicknameMap.get(p.user_id) || '玩家'
        const isOwner = p.user_id === room.owner_id
        return `${i + 1}. ${escapeHTML(nickname)}${isOwner ? ' (房主)' : ''}`
      })
      .join('\n')

    const diceText =
      `🎲 <b>新开局：骰子比大小</b>\n\n` +
      `👤 房主：<b>${escapeHTML(ownerName)}</b>\n` +
      `💰 赌注：<b>${Number(room.bet_amount).toFixed(2)}</b> 抖币\n` +
      `👥 目标人数：<b>${room.target_count}</b> 人\n` +
      `⏳ 状态：等待加入 (${room.current_count}/${room.target_count})\n\n` +
      `📜 <b>游戏规则：</b>\n` +
      `• 金额范围：5 - 10000 抖币\n` +
      `• 人数范围：2 - 5 人\n` +
      `• 抽水：系统自动抽取赢家总奖金的 2%\n` +
      `• 限制：本群同时只能存在 1 局游戏\n\n` +
      `<b>已加入玩家：</b>\n${playerList}`

    // 🔥 如果房间已满员，移除加入按钮
    const keyboard: any = {
      inline_keyboard: [[{ text: '❌ 取消房间 (仅房主)', callback_data: `dice_cancel_${roomId}` }]]
    }

    // 只有未满员时才显示加入按钮
    if (room.current_count < room.target_count && room.status === 'waiting') {
      keyboard.inline_keyboard.unshift([
        { text: '💰 点击加入', callback_data: `dice_join_${roomId}` }
      ])
    }

    await editMessage(chatId, messageId, diceText, { reply_markup: keyboard })
  } catch (err: any) {
    console.error('[DICE-BOT-V2] Update Message Error:', err)
  }
}

/**
 * 🎯 简洁版：处理取消游戏回调
 */
export async function handleCancelDiceGame(
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
    const { data: res, error } = await supabase.rpc('cancel_dice_room', {
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
    await editMessage(chatId, messageId, `🎲 <b>房间已取消</b>\n\n本金已退回所有玩家。`)
  } catch (err: any) {
    console.error('[DICE-BOT-V2] Cancel Error:', err)
    await answerCallbackQuery(callbackQueryId, `❌ 操作失败: ${sanitizeError(err.message)}`, true)
  }
}
