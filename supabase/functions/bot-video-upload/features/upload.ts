import { BOT_TOKEN, BOT_WORKER_URL } from '../env.ts'
import { supabase } from '../supabaseClient.ts'
import { getUserState, updateUserState } from '../state.ts'
import { getOrCreateProfile } from '../services/profile.ts'
import { extractTags, safeTruncate, escapeHTML } from '../utils/text.ts'
import { editMessage, sendMessage } from '../telegram.ts'
import { getEditKeyboard, getEditMenuText } from './editor.ts'

// 🚫 媒体组拒绝缓存（避免同一组发送多条提示）
export const mediaGroupRejectCache = new Map<string, boolean>()

// 🎯 系统配置缓存（Edge Function 实例内缓存，60s）
const SYSTEM_SETTING_CACHE_TTL_MS = 60_000
let cachedBotMaxVideoSizeMB: { value: number; fetchedAt: number } | null = null

async function getBotMaxVideoSizeMB(): Promise<number> {
  const now = Date.now()
  if (
    cachedBotMaxVideoSizeMB &&
    now - cachedBotMaxVideoSizeMB.fetchedAt < SYSTEM_SETTING_CACHE_TTL_MS
  ) {
    return cachedBotMaxVideoSizeMB.value
  }

  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value_int')
      .eq('id', 'bot_max_video_size_mb')
      .maybeSingle()

    if (error) {
      console.error('[system_settings] 读取 bot_max_video_size_mb 失败:', error)
    }

    const mb = Number(data?.value_int)
    const value = Number.isFinite(mb) && mb > 0 ? mb : 200

    cachedBotMaxVideoSizeMB = { value, fetchedAt: now }
    return value
  } catch (e) {
    console.error('[system_settings] 读取 bot_max_video_size_mb 异常:', e)
    cachedBotMaxVideoSizeMB = { value: 200, fetchedAt: now }
    return 200
  }
}

// 📸 图片信息接口
interface AlbumPhoto {
  file_id: string
  width: number
  height: number
  file_size?: number
  order?: number
}

interface UploadExtraData {
  is_adult?: boolean
  is_sea?: boolean
  status?: string // 可选，例如直接设为 'published'
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
  mediaGroupId?: string,
  extraData?: UploadExtraData
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
          type: 'image',
          file_id: photo.file_id,
          width: photo.width,
          height: photo.height,
          order: currentImages.length
        })

        const { error: updateError } = await supabase
          .from('videos')
          .update({
            images: JSON.stringify(currentImages),
            title: `合集 (${currentImages.length}个内容)`,
            content_type: 'collection',
            // 🎯 只要当前没封面，就强制补齐封面
            ...(!existingPost.cover_url || existingPost.cover_url.length < 5
              ? { cover_url: photo.file_id }
              : {})
          })
          .eq('id', existingPost.id)

        if (updateError) {
          console.error('[handlePhoto] 更新相册失败:', updateError)
          return
        }

        console.log(`[handlePhoto] 相册已更新，当前 ${currentImages.length} 张图片`)

        // 🎯 频道同步：如果是自动处理模式
        if (extraData?.status === 'ready' || extraData?.status === 'published') {
          console.log(`[handlePhoto] 频道同步：自动处理模式，不更新菜单。id=${existingPost.id}`)

          // 🎯 解决重复通知问题：使用数据库 context 记录已通知的 mediaGroupId
          const userState = await getUserState(chatId)
          const context = userState.context || {}

          if (context.last_notified_mgid !== mediaGroupId) {
            // 第一次看到这个组，发送通知
            const statusText =
              extraData.status === 'published' ? '已自动发布' : '已自动搬运并进入待发布状态'
            await sendMessage(chatId, `同步成功 📢：检测到您的频道发布了新相册，${statusText}。`)
            // 更新 context 防止重复发送
            await updateUserState(chatId, {
              context: { ...context, last_notified_mgid: mediaGroupId }
            })
          }
          return
        }

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
        // ✅ 上传不做字数限制：完整保存 caption（feed 侧再做展示截断）
        description = String(caption).trim()
        tags = extractTags(caption)
      }

      const { data: newPost, error } = await supabase
        .from('videos')
        .insert({
          tg_user_id: chatId,
          author_id: profile.id,
          title: '合集 (1个内容)',
          description: description,
          tags: tags.length > 0 ? tags : null,
          content_type: 'collection',
          media_group_id: mediaGroupId,
          cover_url: photo.file_id, // 🎯 使用第一张图作为封面
          images: JSON.stringify([
            {
              type: 'image',
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
          is_adult: extraData?.is_adult || false,
          is_sea: extraData?.is_sea || false,
          status: extraData?.status || 'draft',
          review_status: extraData?.status === 'published' ? 'auto_approved' : 'pending',
          published_at: extraData?.status === 'published' ? new Date().toISOString() : null
        })
        .select()
        .single()

      if (error) {
        console.error('[handlePhoto] 创建相册失败:', error)
        await sendMessage(chatId, '❌ 上传失败，请重试\n\n错误: ' + escapeHTML(error.message))
        return
      }

      console.log(`[handlePhoto] 相册记录已创建: ${newPost.id}`)

      // 🎯 频道同步：如果是自动处理模式
      if (extraData?.status === 'ready' || extraData?.status === 'published') {
        console.log(`[handlePhoto] 频道同步：自动处理模式，不显示编辑菜单。id=${newPost.id}`)

        // 发送第一次通知并记录
        const statusText =
          extraData.status === 'published' ? '已自动发布' : '已自动搬运并进入待发布状态'
        await sendMessage(chatId, `同步成功 📢：检测到您的频道发布了新相册，${statusText}。`)

        const userState = await getUserState(chatId)
        await updateUserState(chatId, {
          context: { ...(userState.context || {}), last_notified_mgid: mediaGroupId }
        })
        return
      }

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
    await saveSinglePhoto(chatId, photo, caption, from, profile, extraData)
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
  profile?: any,
  extraData?: UploadExtraData
) {
  console.log('[saveSinglePhoto] 保存单张图片')

  let description: string | null = null
  let tags: string[] = []
  if (caption && caption.length > 0) {
    // ✅ 上传不做字数限制：完整保存 caption（feed 侧再做展示截断）
    description = String(caption).trim()
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
          type: 'image',
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
      is_adult: extraData?.is_adult || false,
      is_sea: extraData?.is_sea || false,
      status: extraData?.status || 'draft',
      review_status: extraData?.status === 'published' ? 'auto_approved' : 'pending',
      published_at: extraData?.status === 'published' ? new Date().toISOString() : null
    })
    .select()
    .single()

  if (error) {
    console.error('保存图片记录失败:', error)
    await sendMessage(chatId, '❌ 上传失败，请重试\n\n错误: ' + escapeHTML(error.message))
    return
  }

  console.log(`[saveSinglePhoto] 图片记录已保存: ${draftPost.id}`)

  // 🎯 如果是频道同步（自动就绪/发布），则跳过编辑菜单
  if (extraData?.status === 'ready' || extraData?.status === 'published') {
    console.log(`[saveSinglePhoto] 频道同步：自动处理模式，不显示编辑菜单。id=${draftPost.id}`)
    const statusText =
      extraData.status === 'published' ? '已自动发布' : '已自动搬运并进入待发布状态'
    await sendMessage(chatId, `同步成功 📢：检测到您的频道发布了新图片，${statusText}。`)
    return
  }

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
  mediaGroupId?: string,
  extraData?: UploadExtraData
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
      // ✅ 不做字数限制：完整保存 caption（展示截断在前端完成）
      description = String(caption).trim()
      tags = extractTags(caption)
    }

    const profile = await getOrCreateProfile(chatId, from)

    if (!profile) {
      console.error('无法创建或获取用户 profile')
      await sendMessage(chatId, '❌ 账号初始化失败\n\n' + '请先发送 /start 命令初始化账号')
      return
    }

    // 🚫 移除：不再对 mediaGroupId 进行拦截，允许转发自频道的视频（通常带 media_group_id）
    // 混合组拦截已经在 app.ts 中由 mediaGroupRejectCache 处理

    // 🚫 单视频大小限制：从系统设置读取（默认 200 MiB）
    const maxMb = await getBotMaxVideoSizeMB()
    console.log('[handleVideo] 当前单视频大小限制(MiB):', maxMb)
    const MAX_VIDEO_BYTES = maxMb * 1024 * 1024
    const videoSize = video.file_size || 0
    if (videoSize > MAX_VIDEO_BYTES) {
      const sizeMB = (videoSize / 1024 / 1024).toFixed(1)
      console.log('[handleVideo] 视频超限，拒绝接收:', { chatId, sizeMB, file_id: video.file_id })
      await sendMessage(
        chatId,
        `⚠️ <b>视频太大，无法接收</b>\n\n` +
          `当前：${sizeMB} MiB\n` +
          `限制：${maxMb} MiB\n\n` +
          `请压缩后再发送（分辨率/码率调低即可）。`
      )
      return
    }

    // 🎯 相册模式：如果是媒体组的一部分，尝试合并
    if (mediaGroupId) {
      const { data: existingPost } = await supabase
        .from('videos')
        .select('*')
        .eq('tg_user_id', chatId)
        .eq('media_group_id', mediaGroupId)
        .single()

      if (existingPost) {
        // 已经有记录了，追加到 images (相册模式)
        const currentMedia: any[] =
          typeof existingPost.images === 'string'
            ? JSON.parse(existingPost.images)
            : existingPost.images || []

        // 检查是否已存在
        const exists = currentMedia.some((m) => m.file_id === video.file_id)
        if (exists) {
          console.log('[handleVideo] 视频已存在于相册中，跳过')
          return
        }

        currentMedia.push({
          type: 'video',
          file_id: video.file_id,
          width: video.width,
          height: video.height,
          duration: video.duration,
          cover_url: video.thumbnail?.file_id || video.thumb?.file_id || '', // 🎯 给单项也存一份封面
          order: currentMedia.length
        })

        const { error: updateError } = await supabase
          .from('videos')
          .update({
            images: JSON.stringify(currentMedia),
            title: `合集 (${currentMedia.length}个内容)`,
            content_type: 'collection', // 统一标记为 collection，区分纯图文 album
            // 🎯 只要当前没封面，就强制补齐封面
            ...(!existingPost.cover_url || existingPost.cover_url.length < 5
              ? { cover_url: video.thumbnail?.file_id || video.thumb?.file_id || '' }
              : {})
          })
          .eq('id', existingPost.id)

        if (updateError) {
          console.error('[handleVideo] 更新合集失败:', updateError)
        }

        console.log(`[handleVideo] 合集已更新，当前 ${currentMedia.length} 个内容`)
        return
      }
    }

    const sizeMB = (videoSize / 1024 / 1024).toFixed(1)

    console.log(`[handleVideo] 视频大小: ${sizeMB} MB, 准备转存 R2`)

    const { data: draftVideo, error } = await supabase
      .from('videos')
      .insert({
        tg_user_id: chatId,
        author_id: profile.id,
        title: video.file_name || '未命名视频合集',
        description: description,
        tags: tags.length > 0 ? tags : null,
        play_url: null,
        cover_url: video.thumbnail?.file_id || video.thumb?.file_id || '', // 🎯 这里的封面会被用于作品列表展示
        tg_file_id: video.file_id,
        tg_thumbnail_file_id: video.thumbnail?.file_id || video.thumb?.file_id,
        tg_unique_id: video.file_unique_id,
        storage_type: 'r2_pending',
        duration: video.duration,
        width: video.width,
        height: video.height,
        file_size: videoSize,
        is_private: false,
        is_adult: extraData?.is_adult || false,
        is_sea: extraData?.is_sea || false,
        status: extraData?.status || 'processing',
        review_status: extraData?.status === 'published' ? 'auto_approved' : 'pending',
        published_at: extraData?.status === 'published' ? new Date().toISOString() : null,
        media_group_id: mediaGroupId,
        images: mediaGroupId
          ? JSON.stringify([
              {
                type: 'video',
                file_id: video.file_id,
                width: video.width,
                height: video.height,
                duration: video.duration,
                cover_url: video.thumbnail?.file_id || video.thumb?.file_id || '', // 🎯 给单项也存一份封面
                order: 0
              }
            ])
          : null,
        content_type: mediaGroupId ? 'collection' : 'video'
      })
      .select()
      .single()

    if (error) {
      console.error('保存视频记录失败:', error)
      await sendMessage(chatId, '❌ 上传失败，请重试\n\n错误: ' + escapeHTML(error.message))
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
        '❌ 处理失败，请重试\n\n错误: ' +
          escapeHTML(error instanceof Error ? error.message : String(error))
      )
    } catch (sendError) {
      console.error('[handleVideo] 发送错误消息也失败了:', sendError)
    }
  }
}
