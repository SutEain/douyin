import { supabase } from '../supabaseClient.ts'
import { getUserState, updateUserState } from '../state.ts'
import { deleteTelegramMessage, editMessage, sendMessage } from '../telegram.ts'
import { escapeHTML, sanitizeError } from '../utils/text.ts'
import { getEditKeyboard, getEditMenuText } from '../features/editor.ts'
import { handleViewVideo } from '../features/videoActions.ts'
import { handleMyPublished, setPublishedCtx } from '../features/myVideos.ts'
import { getLocationFromCoords } from '../utils/geo.ts'
import { sendSelfDestructMessage } from '../utils/telegramExtras.ts'

// 处理转发消息 (用于绑定频道)
export async function handleForward(chatId: number, message: any) {
  const userState = await getUserState(chatId)

  if (userState.state !== 'waiting_channel_forward') {
    // 如果不是在绑定状态，正常处理转发的内容 (搬运逻辑已经由 handleVideo/handlePhoto 处理)
    return
  }

  // 提取频道信息
  let channelId: number | null = null
  let channelTitle: string | null = null
  let channelUsername: string | null = null

  // 兼容新旧转发字段
  if (message.forward_origin?.type === 'channel') {
    channelId = message.forward_origin.chat.id
    channelTitle = message.forward_origin.chat.title
    channelUsername = message.forward_origin.chat.username
  } else if (message.forward_from_chat?.type === 'channel') {
    channelId = message.forward_from_chat.id
    channelTitle = message.forward_from_chat.title
    channelUsername = message.forward_from_chat.username
  }

  if (!channelId) {
    await sendSelfDestructMessage(chatId, '❌ 无法识别频道信息，请确保是从频道转发的消息。')
    return
  }

  try {
    // 1. 获取用户信息
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('tg_user_id', chatId)
      .single()

    if (!profile) throw new Error('User not found')

    // 2. 检查频道是否已被他人绑定
    const { data: existing } = await supabase
      .from('bound_channels')
      .select('user_id')
      .eq('id', channelId)
      .maybeSingle()

    if (existing && existing.user_id !== profile.id) {
      await sendMessage(chatId, '❌ 该频道已被其他用户绑定。')
      return
    }

    // 3. 验证机器人权限 (尝试发送 getChatMember)
    // 注意：这里需要调用 Telegram API
    // 简单起见，我们也可以尝试发送一个测试动作

    // 4. 保存绑定关系
    const { error } = await supabase.from('bound_channels').upsert({
      id: channelId,
      user_id: profile.id,
      title: channelTitle,
      username: channelUsername,
      sync_enabled: true
    })

    if (error) throw error

    await updateUserState(chatId, { state: 'idle' })

    const successText =
      `✅ <b>频道绑定成功！</b>\n\n` +
      `📺 <b>频道：</b> ${escapeHTML(channelTitle || '')}\n` +
      `🆔 <b>ID：</b> <code>${channelId}</code>\n\n` +
      `💡 您在该频道发布的视频/图片，机器人将自动同步到平台。\n` +
      `💡 请确保机器人拥有「发布消息」权限以获取内容。`

    await import('../features/profileCenter.ts')
    await sendMessage(chatId, successText, {
      reply_markup: {
        inline_keyboard: [[{ text: '查看我的频道', callback_data: 'profile_channels' }]]
      }
    })
  } catch (error: any) {
    console.error('handleForward error:', error)
    await sendMessage(chatId, `❌ 绑定失败: ${sanitizeError(error.message)}`)
  }
}

// 处理文本消息（编辑流程 + 已发布搜索 + 提现流程）
export async function handleText(
  chatId: number,
  text: string,
  userMessageId: number,
  rawMessage: any
) {
  const userState = await getUserState(chatId)

  // ✅ 指令匹配
  const lowerText = text.trim().toLowerCase()
  const isRedPacketCmd =
    lowerText === 'hb' ||
    lowerText.startsWith('hb ') ||
    lowerText === '/hb' ||
    lowerText.startsWith('/hb ')
  const isDiceCmd =
    lowerText === 'tz' ||
    lowerText.startsWith('tz ') ||
    lowerText === '/tz' ||
    lowerText.startsWith('/tz ')
  const isBalanceCmd = lowerText === 'ye' || lowerText === '/ye' || lowerText === '余额'
  const isCleanCmd = lowerText === '/clean_keyboard'

  // 🎯 严格控制：群组中仅允许指定指令，其他文本直接忽略
  if (chatId < 0 && !isRedPacketCmd && !isDiceCmd && !isBalanceCmd && !isCleanCmd) {
    return
  }

  // 1. 处理清除键盘
  if (chatId < 0 && isCleanCmd) {
    await sendMessage(chatId, '🧹 正在清理群组菜单...', {
      reply_markup: { remove_keyboard: true }
    })
    return
  }

  // 2. 处理查询余额
  if (isBalanceCmd) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('balance_coins, nickname, numeric_id')
      .eq('tg_user_id', rawMessage.from.id)
      .single()

    if (profile) {
      const balance = Math.floor(profile.balance_coins || 0)
      const nickname = profile.nickname || '未设置'
      const numericId = profile.numeric_id || '未知'

      const msg =
        `👤 <b>昵称:</b> ${escapeHTML(nickname)}\n` +
        `🆔 <b>ID:</b> <code>${numericId}</code>\n\n` +
        `💰 <b>抖币余额：</b> <code>${balance}</code> 抖币\n` +
        `——————————————\n` +
        `💎 <b>TG抖音官方频道 :</b> @avdy`

      await sendMessage(chatId, msg, { reply_to_message_id: userMessageId })
    } else {
      await sendMessage(chatId, '❌ 未找到您的账号信息，请先私聊机器人发送 /start', {
        reply_to_message_id: userMessageId
      })
    }
    return
  }

  // 3. 处理骰子游戏
  if (isDiceCmd) {
    console.log(`[Dice] 匹配到骰子指令，准备执行...`)
    const { handleDiceCommand } = await import('../features/diceGame.ts')
    await handleDiceCommand(chatId, text, rawMessage)
    return
  }

  // 4. 处理红包指令
  if (isRedPacketCmd) {
    console.log(`[RedPacket] 匹配到红包指令，准备执行...`)
    const { handleRedPacketCommand } = await import('../features/redPacket.ts')
    await handleRedPacketCommand(chatId, text, rawMessage)
    return
  }

  // ✅ 已发布搜索：不依赖 draft_video_id
  if (userState.state === 'waiting_published_search') {
    await deleteTelegramMessage(chatId, userMessageId)

    const keyword = text.trim()
    if (!userState.current_message_id) return

    if (keyword === '/cancel') {
      await updateUserState(chatId, { state: 'idle' })
      await handleMyPublished(chatId, userState.current_message_id)
      return
    }

    await setPublishedCtx(chatId, {
      q: keyword || undefined,
      cursorStack: [null],
      nextCursor: null
    })
    await updateUserState(chatId, { state: 'idle' })
    await handleMyPublished(chatId, userState.current_message_id)
    return
  }

  // ✅ 提现流程：输入金额
  if (userState.state === 'waiting_withdraw_amount') {
    await deleteTelegramMessage(chatId, userMessageId)
    if (!userState.current_message_id) return

    if (text.trim() === '/cancel') {
      await updateUserState(chatId, { state: 'idle' })
      const { handleWallet } = await import('../features/profileCenter.ts')
      await handleWallet(chatId, userState.current_message_id)
      return
    }

    const amount = parseInt(text.trim())
    if (isNaN(amount) || amount < 1000) {
      await sendSelfDestructMessage(chatId, '❌ 请输入有效的提现金额 (最少 1000 抖币)')
      return
    }

    // 检查余额
    const { data: profile } = await supabase
      .from('profiles')
      .select('balance_coins')
      .eq('tg_user_id', chatId)
      .single()

    if (!profile || (profile.balance_coins || 0) < amount) {
      await sendSelfDestructMessage(chatId, '❌ 余额不足')
      return
    }

    // 保存金额到上下文，进入下一步：输入地址
    const ctx = (userState as any).context || {}
    await updateUserState(chatId, {
      state: 'waiting_withdraw_address',
      context: { ...ctx, withdraw_amount: amount }
    })

    await editMessage(
      chatId,
      userState.current_message_id,
      `💰 <b>提现金额：</b> <code>${amount}</code> 抖币\n\n` +
        `请发送您的 <b>USDT-TRC20</b> 收款地址：\n\n` +
        `💡 发送 /cancel 可取消操作。`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: '⬅️ 取消', callback_data: 'profile_withdraw' }]]
        }
      }
    )
    return
  }

  // ✅ 提现流程：输入地址
  if (userState.state === 'waiting_withdraw_address') {
    await deleteTelegramMessage(chatId, userMessageId)
    if (!userState.current_message_id) return

    const address = text.trim()
    if (address === '/cancel') {
      await updateUserState(chatId, { state: 'idle' })
      const { handleWallet } = await import('../features/profileCenter.ts')
      await handleWallet(chatId, userState.current_message_id)
      return
    }

    // 简单的 TRC20 地址验证 (T开头，34位)
    if (!/^T[a-zA-Z0-9]{33}$/.test(address)) {
      await sendSelfDestructMessage(chatId, '❌ 请输入有效的 USDT-TRC20 地址 (T开头，34位)')
      return
    }

    // 保存地址到上下文，显示确认页面
    const ctx = (userState as any).context || {}
    const amount = Number(ctx.withdraw_amount)

    await updateUserState(chatId, {
      state: 'idle', // 输入完成，进入确认状态（由按钮触发最终提交）
      context: { ...ctx, withdraw_address: address }
    })

    const { handleWithdrawConfirmPage } = await import('../features/profileCenter.ts')
    await handleWithdrawConfirmPage(chatId, userState.current_message_id, amount, address)
    return
  }

  // ✅ 直播流程：设置标题
  if (userState.state === 'waiting_live_title') {
    await deleteTelegramMessage(chatId, userMessageId)
    if (!userState.current_message_id) return

    const title = text.trim()
    if (title === '/cancel') {
      await updateUserState(chatId, { state: 'idle' })
      const { handleUserProfile } = await import('../features/profileCenter.ts')
      await handleUserProfile(chatId, userState.current_message_id)
      return
    }

    if (title.length < 2 || title.length > 50) {
      await sendSelfDestructMessage(chatId, '❌ 直播标题长度请在 2-50 字之间')
      return
    }

    // 更新状态回 idle
    await updateUserState(chatId, { state: 'idle' })

    const { handleStartLive } = await import('../features/profileCenter.ts')
    await handleStartLive(chatId, userState.current_message_id, title)
    return
  }

  if (!userState.draft_video_id || !userState.current_message_id) return

  const { data: video } = await supabase
    .from('videos')
    .select('*')
    .eq('id', userState.draft_video_id)
    .single()

  if (!video) return

  switch (userState.state) {
    case 'waiting_description': {
      await deleteTelegramMessage(chatId, userMessageId)

      await supabase.from('videos').update({ description: text }).eq('id', video.id)
      await updateUserState(chatId, { state: 'idle' })

      const { data: updatedVideo } = await supabase
        .from('videos')
        .select('*')
        .eq('id', video.id)
        .single()
      await editMessage(chatId, userState.current_message_id, getEditMenuText(updatedVideo), {
        reply_markup: getEditKeyboard(updatedVideo)
      })
      break
    }

    case 'waiting_tags': {
      await deleteTelegramMessage(chatId, userMessageId)

      const tags = text
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0)
      if (tags.length < 3 || tags.length > 5) {
        await sendSelfDestructMessage(chatId, '❌ 请输入 3-5 个标签，用空格分隔')
        return
      }

      await supabase.from('videos').update({ tags }).eq('id', video.id)
      await updateUserState(chatId, { state: 'idle' })

      const { data: updatedVideo2 } = await supabase
        .from('videos')
        .select('*')
        .eq('id', video.id)
        .single()

      await editMessage(chatId, userState.current_message_id, getEditMenuText(updatedVideo2), {
        reply_markup: getEditKeyboard(updatedVideo2)
      })
      break
    }

    case 'editing_description': {
      await deleteTelegramMessage(chatId, userMessageId)

      await supabase.from('videos').update({ description: text }).eq('id', video.id)

      await updateUserState(chatId, {
        state: 'idle',
        draft_video_id: null,
        current_message_id: null
      })

      await handleViewVideo(chatId, userState.current_message_id, video.id)
      break
    }

    case 'editing_tags': {
      await deleteTelegramMessage(chatId, userMessageId)

      const tags = text
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0)
      if (tags.length < 1) {
        await sendSelfDestructMessage(chatId, '❌ 请至少输入 1 个标签')
        return
      }

      await supabase.from('videos').update({ tags }).eq('id', video.id)

      await updateUserState(chatId, {
        state: 'idle',
        draft_video_id: null,
        current_message_id: null
      })

      await handleViewVideo(chatId, userState.current_message_id, video.id)
      break
    }

    case 'editing_location_detail': {
      await deleteTelegramMessage(chatId, userMessageId)
      await sendSelfDestructMessage(
        chatId,
        '❌ 请发送位置信息（不是文本）\n\n点击下方的 📎 附件按钮选择"位置"',
        5
      )
      return
    }

    case 'waiting_location': {
      await deleteTelegramMessage(chatId, userMessageId)
      await sendSelfDestructMessage(
        chatId,
        '❌ 请发送位置信息（不是文本）\n\n点击下方的 📎 附件按钮选择"位置"',
        5
      )
      return
    }

    case 'editing_location': {
      await deleteTelegramMessage(chatId, userMessageId)

      const parts = text.trim().split(/\s+/)
      let city: string | null = null
      let country: string | null = null

      if (parts.length === 1) {
        country = parts[0]
      } else if (parts.length >= 2) {
        city = parts[0]
        country = parts.slice(1).join(' ')
      }

      if (!country) {
        await sendSelfDestructMessage(chatId, '❌ 请输入有效的位置信息')
        return
      }

      await supabase
        .from('videos')
        .update({
          location_city: city,
          location_country: country,
          location_country_code: null
        })
        .eq('id', video.id)

      await updateUserState(chatId, {
        state: 'idle',
        draft_video_id: null,
        current_message_id: null
      })

      await handleViewVideo(chatId, userState.current_message_id, video.id)
      break
    }
  }
}

// 处理位置消息
export async function handleLocation(chatId: number, location: any, userMessageId: number) {
  const userState = await getUserState(chatId)

  if (
    !userState.draft_video_id ||
    !userState.current_message_id ||
    (userState.state !== 'waiting_location' && userState.state !== 'editing_location_detail')
  ) {
    return
  }

  const isEditingDetail = userState.state === 'editing_location_detail'

  try {
    await deleteTelegramMessage(chatId, userMessageId)
    await editMessage(chatId, userState.current_message_id, '🔄 正在识别位置...')

    const locationData = await getLocationFromCoords(location.latitude, location.longitude)

    await supabase
      .from('videos')
      .update({
        location_country: locationData.country,
        location_country_code: locationData.country_code,
        location_city: locationData.city
      })
      .eq('id', userState.draft_video_id)

    await updateUserState(chatId, { state: 'idle' })

    const { data: updatedVideo } = await supabase
      .from('videos')
      .select('*')
      .eq('id', userState.draft_video_id)
      .single()

    if (isEditingDetail) {
      await handleViewVideo(chatId, userState.current_message_id, userState.draft_video_id)
    } else {
      await editMessage(chatId, userState.current_message_id, getEditMenuText(updatedVideo), {
        reply_markup: getEditKeyboard(updatedVideo)
      })
    }
  } catch (error) {
    console.error('位置识别失败:', error)
    await sendSelfDestructMessage(
      chatId,
      '❌ 位置识别失败\n\n' +
        '可能原因：\n' +
        '• 位置在海洋/无人区\n' +
        '• 地理服务暂时不可用\n\n' +
        '请稍后重试'
    )

    const { data: video } = await supabase
      .from('videos')
      .select('*')
      .eq('id', userState.draft_video_id)
      .single()

    await updateUserState(chatId, { state: 'idle' })

    if (video && userState.current_message_id) {
      if (isEditingDetail) {
        await handleViewVideo(chatId, userState.current_message_id, userState.draft_video_id)
      } else {
        await editMessage(chatId, userState.current_message_id, getEditMenuText(video), {
          reply_markup: getEditKeyboard(video)
        })
      }
    }
  }
}
