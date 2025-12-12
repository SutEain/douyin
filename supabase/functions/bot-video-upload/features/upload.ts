import { BOT_TOKEN, BOT_WORKER_URL } from '../env.ts'
import { supabase } from '../supabaseClient.ts'
import { getUserState, updateUserState } from '../state.ts'
import { getOrCreateProfile } from '../services/profile.ts'
import { extractTags, safeTruncate } from '../utils/text.ts'
import { editMessage, sendMessage } from '../telegram.ts'
import { getEditKeyboard, getEditMenuText } from './editor.ts'

// 🚫 媒体组拒绝缓存（避免同一组发送多条提示）
export const mediaGroupRejectCache = new Map<string, boolean>()

// 📸 图片信息接口
interface AlbumPhoto {
  file_id: string
  width: number
  height: number
  file_size?: number
  order?: number
}

// 🎯 触发 Worker 处理视频 (转存 R2)
export async function triggerWorker(
  videoId: string,
  fileId: string,
  chatId: number,
  messageId: number
) {
  if (!BOT_WORKER_URL) {
    console.error('❌ BOT_WORKER_URL 未配置')
    return
  }
  console.log(`[triggerWorker] 触发 Worker: video=${videoId}`)
  try {
    // Fire and forget (Worker 会异步处理)
    fetch(`${BOT_WORKER_URL}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_id: videoId,
        file_id: fileId,
        bot_token: BOT_TOKEN,
        chat_id: chatId,
        message_id: messageId
      })
    }).catch((e) => console.error('[triggerWorker] fetch error:', e))
  } catch (e) {
    console.error('[triggerWorker] 异常:', e)
  }
}

// 📸 处理图片上传（单图或相册）
// 使用数据库存储相册状态，解决 Edge Function 无状态问题
export async function handlePhoto(
  chatId: number,
  photoSizes: any[], // Telegram 会发送多个尺寸的图片
  caption?: string,
  from?: any,
  mediaGroupId?: string
) {
  console.log('[handlePhoto] 开始处理图片')
  console.log('[handlePhoto] chatId:', chatId)
  console.log('[handlePhoto] mediaGroupId:', mediaGroupId)

  try {
    const photo = photoSizes[photoSizes.length - 1]
    console.log('[handlePhoto] 最大尺寸图片:', photo)

    const profile = await getOrCreateProfile(chatId, from)
    if (!profile) {
      await sendMessage(chatId, '❌ 账号初始化失败\n\n请先发送 /start 命令初始化账号')
      return
    }

    // 🎯 相册模式：使用数据库存储
    if (mediaGroupId) {
      const { data: existingPost } = await supabase
        .from('videos')
        .select('*')
        .eq('tg_user_id', chatId)
        .eq('media_group_id', mediaGroupId)
        .single()

      if (existingPost) {
        const currentImages: AlbumPhoto[] =
          typeof existingPost.images === 'string'
            ? JSON.parse(existingPost.images)
            : existingPost.images || []

        const exists = currentImages.some((img) => img.file_id === photo.file_id)
        if (exists) {
          console.log('[handlePhoto] 图片已存在，跳过')
          return
        }

        currentImages.push({
          file_id: photo.file_id,
          width: photo.width,
          height: photo.height,
          order: currentImages.length
        })

        const { error: updateError } = await supabase
          .from('videos')
          .update({
            images: JSON.stringify(currentImages),
            title: `相册 (${currentImages.length}张)`,
            content_type: 'album'
          })
          .eq('id', existingPost.id)

        if (updateError) {
          console.error('[handlePhoto] 更新相册失败:', updateError)
          return
        }

        console.log(`[handlePhoto] 相册已更新，当前 ${currentImages.length} 张图片`)

        // 尝试更新用户的编辑菜单（如果还在同一条菜单上）
        try {
          const userState = await getUserState(chatId)
          if (userState.current_message_id && userState.draft_video_id === existingPost.id) {
            const { data: updatedPost } = await supabase
              .from('videos')
              .select('*')
              .eq('id', existingPost.id)
              .single()
            if (updatedPost) {
              await editMessage(
                chatId,
                userState.current_message_id,
                getEditMenuText(updatedPost),
                {
                  reply_markup: getEditKeyboard(updatedPost)
                }
              )
            }
          }
        } catch (e) {
          console.warn('[handlePhoto] 更新菜单失败:', e)
        }

        return
      }

      // 没有记录，创建新相册
      console.log('[handlePhoto] 创建新相册')

      let description: string | null = null
      let tags: string[] = []
      if (caption && caption.length > 0) {
        description = safeTruncate(caption, 300)
        tags = extractTags(caption)
      }

      const { data: newPost, error } = await supabase
        .from('videos')
        .insert({
          tg_user_id: chatId,
          author_id: profile.id,
          title: '相册 (1张)',
          description: description,
          tags: tags.length > 0 ? tags : null,
          content_type: 'album',
          media_group_id: mediaGroupId,
          images: JSON.stringify([
            {
              file_id: photo.file_id,
              width: photo.width,
              height: photo.height,
              order: 0
            }
          ]),
          width: photo.width,
          height: photo.height,
          storage_type: 'telegram',
          is_private: false,
          status: 'draft'
        })
        .select()
        .single()

      if (error) {
        console.error('[handlePhoto] 创建相册失败:', error)
        await sendMessage(chatId, '❌ 上传失败，请重试\n\n错误: ' + error.message)
        return
      }

      console.log(`[handlePhoto] 相册记录已创建: ${newPost.id}`)

      const menuResult = await sendMessage(chatId, getEditMenuText(newPost), {
        reply_markup: getEditKeyboard(newPost)
      })

      const messageId = menuResult.ok ? menuResult.result.message_id : null

      await updateUserState(chatId, {
        state: 'idle',
        draft_video_id: newPost.id,
        current_message_id: messageId
      })

      return
    }

    // 🎯 单图模式：直接保存
    await saveSinglePhoto(chatId, photo, caption, from, profile)
  } catch (error) {
    console.error('[handlePhoto] 处理图片失败:', error)
    await sendMessage(chatId, '❌ 图片上传失败，请重试')
  }
}

// 保存单张图片
export async function saveSinglePhoto(
  chatId: number,
  photo: any,
  caption?: string,
  from?: any,
  profile?: any
) {
  console.log('[saveSinglePhoto] 保存单张图片')

  let description: string | null = null
  let tags: string[] = []
  if (caption && caption.length > 0) {
    description = safeTruncate(caption, 300)
    tags = extractTags(caption)
  }

  if (!profile) {
    profile = await getOrCreateProfile(chatId, from)
    if (!profile) {
      await sendMessage(chatId, '❌ 账号初始化失败\n\n请先发送 /start 命令初始化账号')
      return
    }
  }

  const { data: draftPost, error } = await supabase
    .from('videos')
    .insert({
      tg_user_id: chatId,
      author_id: profile.id,
      title: '图片',
      description: description,
      tags: tags.length > 0 ? tags : null,
      content_type: 'image',
      images: JSON.stringify([
        {
          file_id: photo.file_id,
          width: photo.width,
          height: photo.height,
          order: 0
        }
      ]),
      width: photo.width,
      height: photo.height,
      file_size: photo.file_size || 0,
      storage_type: 'telegram',
      is_private: false,
      status: 'draft'
    })
    .select()
    .single()

  if (error) {
    console.error('保存图片记录失败:', error)
    await sendMessage(chatId, '❌ 上传失败，请重试\n\n错误: ' + error.message)
    return
  }

  console.log(`[saveSinglePhoto] 图片记录已保存: ${draftPost.id}`)

  const menuResult = await sendMessage(chatId, getEditMenuText(draftPost), {
    reply_markup: getEditKeyboard(draftPost)
  })

  const messageId = menuResult.ok ? menuResult.result.message_id : null

  await updateUserState(chatId, {
    state: 'idle',
    draft_video_id: draftPost.id,
    current_message_id: messageId
  })
}

// 处理视频上传
export async function handleVideo(
  chatId: number,
  video: any,
  caption?: string,
  from?: any,
  mediaGroupId?: string
) {
  console.log('[handleVideo] 开始处理视频')
  console.log('[handleVideo] chatId:', chatId)
  console.log('[handleVideo] video:', JSON.stringify(video).substring(0, 200))
  console.log('[handleVideo] caption:', caption)
  console.log('[handleVideo] mediaGroupId:', mediaGroupId)

  try {
    let description: string | null = null
    let tags: string[] = []

    if (caption && caption.length > 0) {
      description = safeTruncate(caption, 300)
      tags = extractTags(caption)
    }

    const profile = await getOrCreateProfile(chatId, from)

    if (!profile) {
      console.error('无法创建或获取用户 profile')
      await sendMessage(chatId, '❌ 账号初始化失败\n\n' + '请先发送 /start 命令初始化账号')
      return
    }

    // 🚫 拒绝媒体组（多视频/视频+图片混合）
    if (mediaGroupId) {
      console.log(`[handleVideo] 检测到 Media Group: ${mediaGroupId}，拒绝处理`)
      const cacheKey = `media_group_reject_${chatId}_${mediaGroupId}`
      const alreadyNotified = mediaGroupRejectCache.get(cacheKey)

      if (!alreadyNotified) {
        mediaGroupRejectCache.set(cacheKey, true)
        setTimeout(() => mediaGroupRejectCache.delete(cacheKey), 5000)

        await sendMessage(
          chatId,
          `⚠️ <b>暂不支持批量上传</b>\n\n` +
            `请一次只上传一条视频。\n\n` +
            `💡 如需上传多条视频，请分开发送。`
        )
      }
      return
    }

    const videoSize = video.file_size || 0
    const sizeMB = (videoSize / 1024 / 1024).toFixed(1)

    console.log(`[handleVideo] 视频大小: ${sizeMB} MB, 准备转存 R2`)

    const { data: draftVideo, error } = await supabase
      .from('videos')
      .insert({
        tg_user_id: chatId,
        author_id: profile.id,
        title: video.file_name || '未命名视频',
        description: description,
        tags: tags.length > 0 ? tags : null,
        play_url: null,
        cover_url: video.thumbnail?.file_id || video.thumb?.file_id || '',
        tg_file_id: video.file_id,
        tg_thumbnail_file_id: video.thumbnail?.file_id || video.thumb?.file_id,
        tg_unique_id: video.file_unique_id,
        storage_type: 'r2_pending',
        duration: video.duration,
        width: video.width,
        height: video.height,
        file_size: videoSize,
        is_private: false,
        status: 'processing'
      })
      .select()
      .single()

    if (error) {
      console.error('保存视频记录失败:', error)
      await sendMessage(chatId, '❌ 上传失败，请重试\n\n错误: ' + error.message)
      return
    }

    console.log(`[handleVideo] 视频记录已保存: ${draftVideo.id}, 状态: ${draftVideo.status}`)

    const processingMsg = await sendMessage(
      chatId,
      `🔄 <b>正在处理视频...</b>\n\n` +
        `📦 文件大小：${sizeMB} MB\n` +
        `⏳ 正在转码并同步数据...\n` +
        `💡 处理完成后会自动显示编辑菜单`
    )

    const processingMessageId = processingMsg.ok ? processingMsg.result.message_id : 0

    if (processingMessageId) {
      await triggerWorker(draftVideo.id, video.file_id, chatId, processingMessageId)
    } else {
      console.error('[handleVideo] 发送处理消息失败，无法触发 Worker')
    }
  } catch (error) {
    console.error('[handleVideo] 处理视频失败:', error)
    console.error('[handleVideo] 错误堆栈:', error instanceof Error ? error.stack : String(error))
    try {
      await sendMessage(
        chatId,
        '❌ 处理失败，请重试\n\n错误: ' + (error instanceof Error ? error.message : String(error))
      )
    } catch (sendError) {
      console.error('[handleVideo] 发送错误消息也失败了:', sendError)
    }
  }
}
