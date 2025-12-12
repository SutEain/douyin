import { supabase } from '../supabaseClient.ts'
import { getUserState, updateUserState } from '../state.ts'
import { deleteTelegramMessage, editMessage } from '../telegram.ts'
import { getEditKeyboard, getEditMenuText } from '../features/editor.ts'
import { handleViewVideo } from '../features/videoActions.ts'
import { handleMyPublished, setPublishedCtx } from '../features/myVideos.ts'
import { getLocationFromCoords } from '../utils/geo.ts'
import { sendSelfDestructMessage } from '../utils/telegramExtras.ts'

// 处理文本消息（编辑流程 + 已发布搜索）
export async function handleText(chatId: number, text: string, userMessageId: number) {
  const userState = await getUserState(chatId)

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

      if (text.length > 300) {
        await sendSelfDestructMessage(chatId, '❌ 描述最多 300 字，请重新输入')
        return
      }

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

      if (text.length > 300) {
        await sendSelfDestructMessage(chatId, '❌ 描述最多 300 字，请重新输入')
        return
      }

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
