import { BOT_TOKEN, TG_API_BASE } from '../env.ts'
import { supabase } from '../supabaseClient.ts'
import { updateUserState } from '../state.ts'
import { safeTruncate } from '../utils/text.ts'
import { getFlag } from '../utils/geo.ts'
import { answerCallbackQuery, editMessage } from '../telegram.ts'
import { handleMyDrafts, handleMyProcessing, handleMyPublished } from './myVideos.ts'

// 🎯 通知粉丝：有新作品发布
export async function notifyFollowersNewPost(
  authorId: string,
  authorNickname: string,
  videoId: string,
  videoDesc?: string
) {
  console.log(`[NOTIFY-NEW-POST] 开始通知粉丝: author=${authorId}, video=${videoId}`)

  try {
    const { data: followers, error } = await supabase
      .from('follows')
      .select(
        `
        follower_id,
        follower:profiles!follows_follower_id_fkey(
          id,
          tg_user_id,
          notification_settings
        )
      `
      )
      .eq('followee_id', authorId)

    if (error) {
      console.error('[NOTIFY-NEW-POST] ❌ 查询粉丝失败:', error)
      return
    }

    if (!followers || followers.length === 0) {
      console.log('[NOTIFY-NEW-POST] 没有粉丝需要通知')
      return
    }

    console.log(`[NOTIFY-NEW-POST] 找到 ${followers.length} 个粉丝`)

    const descPreview = videoDesc
      ? `\n📝 ${videoDesc.substring(0, 50)}${videoDesc.length > 50 ? '...' : ''}`
      : ''
    const message = `🎬 <b>${authorNickname}</b> 发布了新作品${descPreview}`

    const { data: authorProfile } = await supabase
      .from('profiles')
      .select('numeric_id')
      .eq('id', authorId)
      .single()

    const inviteSuffix = authorProfile?.numeric_id ? `_i${authorProfile.numeric_id}` : ''

    const botUsername = 'tg_douyin_bot'
    const appName = 'tgdouyin'
    const deepLink = `https://t.me/${botUsername}/${appName}?startapp=video_${videoId}${inviteSuffix}`

    let sentCount = 0
    let skippedCount = 0

    for (const follow of followers) {
      const followerProfile = (follow as any).follower
      if (!followerProfile || !followerProfile.tg_user_id) {
        skippedCount++
        continue
      }

      const settings = followerProfile.notification_settings || {}
      const typeSetting = settings['new_post'] || { mute_until: 0 }
      const muteUntil = typeSetting.mute_until || 0

      if (muteUntil === -1) {
        skippedCount++
        continue
      }
      if (muteUntil > Date.now()) {
        skippedCount++
        continue
      }

      try {
        const url = `${TG_API_BASE}/bot${BOT_TOKEN}/sendMessage`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: followerProfile.tg_user_id,
            text: message,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '👉 立即查看', url: deepLink }]]
            }
          })
        })
        const data = await res.json()
        if (data.ok) {
          sentCount++
        } else {
          console.warn(
            `[NOTIFY-NEW-POST] 发送失败 to ${followerProfile.tg_user_id}:`,
            data.description
          )
        }
      } catch (e) {
        console.error(`[NOTIFY-NEW-POST] 发送异常 to ${followerProfile.tg_user_id}:`, e)
      }
    }

    console.log(`[NOTIFY-NEW-POST] ✅ 完成: 发送 ${sentCount} 条, 跳过 ${skippedCount} 条`)
  } catch (error) {
    console.error('[NOTIFY-NEW-POST] Error:', error)
  }
}

// 处理"查看视频详情"
export async function handleViewVideo(chatId: number, messageId: number, videoId: string) {
  console.log('[handleViewVideo] 开始获取视频详情, chatId:', chatId, 'videoId:', videoId)

  try {
    const { data: video, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .single()

    console.log('[handleViewVideo] 查询结果:', { hasVideo: !!video, error: error?.message })

    if (error) {
      console.error('[handleViewVideo] 查询失败:', error)
      await editMessage(chatId, messageId, '❌ 获取视频失败\n\n' + error.message, {
        reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'my_published' }]] }
      })
      return
    }

    if (!video) {
      console.log('[handleViewVideo] 视频不存在')
      await editMessage(chatId, messageId, '❌ 视频不存在', {
        reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'my_published' }]] }
      })
      return
    }

    let descText = '未设置'
    if (video.description) {
      descText = safeTruncate(video.description, 200)
    }

    let tagsText = '未设置'
    if (video.tags && video.tags.length > 0) {
      tagsText = video.tags.map((t: string) => '#' + t).join(' ')
    }

    let locationText = '未设置'
    if (video.location_country) {
      locationText = getFlag(video.location_country_code!) + ' ' + video.location_country
      if (video.location_city) {
        locationText += ' · ' + video.location_city
      }
    }

    const lines = [
      `📺 <b>视频详情</b>`,
      ``,
      `📝 描述：${descText}`,
      `🏷️ 标签：${tagsText}`,
      `📍 位置：${locationText}`,
      `${video.is_private ? '🔒' : '🌍'} 状态：${video.is_private ? '私密' : '公开'}`,
      ``,
      `📊 <b>数据统计</b>`,
      `👀 浏览：${video.view_count || 0}`,
      `❤️ 点赞：${video.like_count || 0}`,
      `💬 评论：${video.comment_count || 0}`
    ]

    const keyboard: any[] = []
    keyboard.push([
      {
        text: video.description ? '✏️ 修改描述' : '📝 添加描述',
        callback_data: `edit_desc_detail:${video.id}`
      },
      {
        text: video.tags && video.tags.length > 0 ? '✏️ 修改标签' : '🏷️ 添加标签',
        callback_data: `edit_tags_detail:${video.id}`
      }
    ])

    keyboard.push([
      {
        text: video.location_country ? '✏️ 修改位置' : '📍 添加位置',
        callback_data: `edit_location_detail:${video.id}`
      },
      {
        text: video.is_private ? '🌍 设为公开' : '🔒 设为私密',
        callback_data: `toggle_privacy_detail:${video.id}`
      }
    ])

    if (video.status === 'published') {
      keyboard.push([
        {
          text: video.is_top ? '📍 取消置顶' : '📌 置顶该视频',
          callback_data: `toggle_pin_detail:${video.id}`
        }
      ])
    }

    keyboard.push([{ text: '🗑️ 删除视频', callback_data: `delete_video_detail:${video.id}` }])
    keyboard.push([{ text: '← 返回列表', callback_data: 'my_published' }])

    console.log('[handleViewVideo] 准备编辑消息')

    await editMessage(chatId, messageId, lines.join('\n'), {
      reply_markup: { inline_keyboard: keyboard }
    })

    console.log('[handleViewVideo] 完成')
  } catch (error) {
    console.error('[handleViewVideo] 发生错误:', error)
    console.error(
      '[handleViewVideo] 错误堆栈:',
      error instanceof Error ? error.stack : String(error)
    )
    try {
      await editMessage(
        chatId,
        messageId,
        '❌ 发生错误\n\n' + (error instanceof Error ? error.message : String(error)),
        {
          reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'my_published' }]] }
        }
      )
    } catch (editError) {
      console.error('[handleViewVideo] 编辑消息也失败了:', editError)
    }
  }
}

// 发布视频（提交审核）
export async function publishVideo(
  chatId: number,
  messageId: number,
  videoId: string,
  notify: typeof notifyFollowersNewPost
) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, nickname, auto_approve')
      .eq('tg_user_id', chatId)
      .single()

    const autoApprove = profile?.auto_approve === true
    const authorId = profile?.id
    const authorNickname = profile?.nickname || '用户'

    let newStatus: string
    let newReviewStatus: string
    let successMessage: string[]

    if (autoApprove) {
      newStatus = 'published'
      newReviewStatus = 'auto_approved'
      successMessage = ['🎉 <b>发布成功！</b>', '', '视频已发布。']
    } else {
      newStatus = 'ready'
      newReviewStatus = 'pending'
      successMessage = [
        '✅ <b>提交成功！</b>',
        '',
        '您的内容已提交审核',
        '审核通过后将自动发布到首页',
        '',
        '💡 首次发布需要审核，后续发布将自动通过'
      ]
    }

    const { data: video, error } = await supabase
      .from('videos')
      .update({
        status: newStatus,
        review_status: newReviewStatus,
        published_at: autoApprove ? new Date().toISOString() : null
      })
      .eq('id', videoId)
      .select()
      .single()

    if (error) {
      console.error('发布失败:', error)
      await editMessage(chatId, messageId, '❌ 发布失败\n\n' + '错误: ' + error.message)
      return
    }

    await updateUserState(chatId, { state: 'idle', draft_video_id: null, current_message_id: null })

    if (video.description) {
      const desc = safeTruncate(video.description, 50)
      successMessage.push(`📝 ${desc}`)
    }
    if (video.tags && video.tags.length > 0) {
      successMessage.push(`🏷️ ${video.tags.map((t: string) => '#' + t).join(' ')}`)
    }
    if (video.location_country) {
      let loc = getFlag(video.location_country_code!) + ' ' + video.location_country
      if (video.location_city) loc += ' · ' + video.location_city
      successMessage.push(`📍 ${loc}`)
    }

    await editMessage(chatId, messageId, successMessage.join('\n'))

    if (autoApprove && authorId) {
      notify(authorId, authorNickname, videoId, video.description).catch((e) => {
        console.error('[publishVideo] 通知粉丝失败:', e)
      })
    }
  } catch (error) {
    console.error('发布错误:', error)
    await editMessage(chatId, messageId, '❌ 发布时发生错误，请重试')
  }
}

export async function toggleVideoPin(video: any) {
  if (video.is_top) {
    await supabase.from('videos').update({ is_top: false }).eq('id', video.id)
  } else {
    const filterField = video.tg_user_id ? 'tg_user_id' : 'author_id'
    const filterValue = video.tg_user_id ?? video.author_id

    if (filterField && filterValue) {
      const { data: pinnedVideos } = await supabase
        .from('videos')
        .select('id')
        .eq(filterField, filterValue)
        .eq('is_top', true)
        .eq('status', 'published')

      if (pinnedVideos && pinnedVideos.length >= 3) {
        throw new Error('最多只能置顶3个视频')
      }
    }

    await supabase.from('videos').update({ is_top: true }).eq('id', video.id)
  }

  const { data: refreshed } = await supabase.from('videos').select('*').eq('id', video.id).single()
  return refreshed
}

// 删除视频
export async function handleDeleteVideo(
  chatId: number,
  messageId: number,
  videoId: string,
  callbackQueryId: string
) {
  try {
    const { data: video } = await supabase
      .from('videos')
      .select('status')
      .eq('id', videoId)
      .eq('tg_user_id', chatId)
      .maybeSingle()

    if (!video) {
      await answerCallbackQuery(callbackQueryId, '视频不存在或无权限')
      return
    }

    const status = video.status

    const { error } = await supabase
      .from('videos')
      .delete()
      .eq('id', videoId)
      .eq('tg_user_id', chatId)

    if (error) {
      console.error('删除视频失败:', error)
      await answerCallbackQuery(callbackQueryId, '删除失败，请重试')
      return
    }

    await answerCallbackQuery(callbackQueryId, '已删除')

    if (status === 'published') {
      await handleMyPublished(chatId, messageId)
    } else if (status === 'processing') {
      await handleMyProcessing(chatId, messageId)
    } else {
      await handleMyDrafts(chatId, messageId)
    }
  } catch (error) {
    console.error('删除视频错误:', error)
    await answerCallbackQuery(callbackQueryId, '删除失败')
  }
}

export async function handleDeleteVideoFromDetail(
  chatId: number,
  messageId: number,
  videoId: string,
  callbackQueryId: string
) {
  try {
    const { data: video } = await supabase
      .from('videos')
      .select('status')
      .eq('id', videoId)
      .eq('tg_user_id', chatId)
      .maybeSingle()

    if (!video) {
      await answerCallbackQuery(callbackQueryId, '视频不存在或无权限')
      return
    }

    const { error } = await supabase
      .from('videos')
      .delete()
      .eq('id', videoId)
      .eq('tg_user_id', chatId)

    if (error) {
      console.error('删除视频失败:', error)
      await answerCallbackQuery(callbackQueryId, '❌ 删除失败，请重试')
      return
    }

    await answerCallbackQuery(callbackQueryId, '✅ 已删除')
    await handleMyPublished(chatId, messageId)
  } catch (error) {
    console.error('删除视频错误:', error)
    await answerCallbackQuery(callbackQueryId, '❌ 删除失败')
  }
}
