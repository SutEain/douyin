import { BOT_TOKEN, BOT_WORKER_URL } from '../env.ts'
import { supabase } from '../supabaseClient.ts'
import { getUserState, updateUserState } from '../state.ts'
import { getOrCreateProfile } from '../services/profile.ts'
import { extractTags, escapeHTML, sanitizeError } from '../utils/text.ts'
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
interface UploadExtraData {
  is_adult?: boolean
  is_sea?: boolean
  status?: string // 可选，例如直接设为 'published'
  is_auto_sync?: boolean // 🎯 标记是否为频道自动同步
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
    // 🎯 严格控制：禁止在群组中直接上传图片（仅允许私聊上传）
    if (chatId < 0) {
      console.log(`[handlePhoto] 忽略群组中的图片消息: chatId=${chatId}`)
      return
    }

    const photo = photoSizes[photoSizes.length - 1]
    console.log('[handlePhoto] 最大尺寸图片:', photo)

    const profile = await getOrCreateProfile(chatId, from)
    if (!profile) {
      await sendMessage(chatId, '❌ 账号初始化失败\n\n请先发送 /start 命令初始化账号')
      return
    }

    // 🎯 相册/合辑模式：使用数据库原子操作解决并发冲突
    if (mediaGroupId) {
      const newMediaItem = {
        type: 'image',
        file_id: photo.file_id,
        width: photo.width,
        height: photo.height,
        file_size: photo.file_size || 0
      }

      let description: string | null = null
      let tags: string[] = []
      if (caption && caption.length > 0) {
        description = String(caption).trim()
        tags = extractTags(caption)
      }

      const { data: result, error: rpcError } = await supabase.rpc('append_collection_media', {
        p_chat_id: chatId,
        p_media_group_id: mediaGroupId,
        p_new_item: newMediaItem,
        p_author_id: profile.id,
        p_caption: description,
        p_tags: tags.length > 0 ? tags : null,
        p_content_type: 'album' // 🎯 多图上传，初始类型设为相册 (album)
      })

      if (rpcError || result?.error) {
        console.error('[handlePhoto] 原子追加失败:', rpcError || result?.error)
        await sendMessage(
          chatId,
          '❌ 上传失败，请重试\n\n错误: ' +
            sanitizeError(escapeHTML(rpcError?.message || result?.error))
        )
        return
      }

      console.log(`[handlePhoto] 合辑更新成功: id=${result.id}, 当前数量=${result.media_count}`)

      // 🎯 触发 Worker 处理图片 (转存 R2)
      await triggerWorker(result.id, photo.file_id, chatId, 0)

      // 🎯 只要是新创建的记录，就显示编辑菜单
      if (result.is_new) {
        const { data: newPost } = await supabase
          .from('videos')
          .select('*')
          .eq('id', result.id)
          .single()
        if (newPost) {
          // 🎯 频道同步：如果是自动处理模式
          if (extraData?.status === 'ready' || extraData?.status === 'published') {
            const statusText =
              extraData.status === 'published' ? '已自动发布' : '已自动搬运并进入待发布状态'
            await sendMessage(chatId, `同步成功 📢：检测到您的频道发布了新相册，${statusText}。`)
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
        }
      } else {
        // 🎯 如果是已存在的记录且不是自动发布模式，尝试实时更新菜单
        if (!(extraData?.status === 'ready' || extraData?.status === 'published')) {
          try {
            const userState = await getUserState(chatId)
            if (userState.current_message_id && userState.draft_video_id === result.id) {
              const { data: updatedPost } = await supabase
                .from('videos')
                .select('*')
                .eq('id', result.id)
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
            console.warn('[handlePhoto] 实时更新菜单失败:', e)
          }
        }
      }
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

  const mediaItem = {
    type: 'image',
    file_id: photo.file_id,
    width: photo.width,
    height: photo.height,
    file_size: photo.file_size || 0,
    order: 0
  }

  const isAutoApprove = profile?.auto_approve || extraData?.status === 'published'

  const { data: draftPost, error } = await supabase
    .from('videos')
    .insert({
      tg_user_id: chatId,
      author_id: profile.id,
      title: '图片',
      description: description,
      tags: tags.length > 0 ? tags : null,
      content_type: 'image',
      media_list: JSON.stringify([mediaItem]),
      images: JSON.stringify([mediaItem]),
      cover_url: photo.file_id, // 🎯 封面暂时使用图片 file_id
      width: photo.width,
      height: photo.height,
      file_size: photo.file_size || 0,
      storage_type: 'r2_pending',
      is_private: false,
      is_adult: extraData?.is_adult || false,
      is_sea: extraData?.is_sea || false,
      status: extraData?.status || 'processing',
      is_auto_sync: extraData?.is_auto_sync || false, // 🎯 标记自动同步
      review_status: isAutoApprove ? 'auto_approved' : 'pending',
      published_at: isAutoApprove ? new Date().toISOString() : null
    })
    .select()
    .single()

  if (error) {
    console.error('保存图片记录失败:', error)
    await sendMessage(
      chatId,
      '❌ 上传失败，请重试\n\n错误: ' + sanitizeError(escapeHTML(error.message))
    )
    return
  }

  console.log(`[saveSinglePhoto] 图片记录已保存: ${draftPost.id}`)

  // 🎯 触发 Worker 处理图片 (转存 R2)
  await triggerWorker(draftPost.id, photo.file_id, chatId, 0)

  // 🎯 如果是频道同步（自动就绪/发布），则发送同步成功提示并退出
  if (extraData?.is_auto_sync) {
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

  try {
    // 🎯 严格控制：禁止在群组中直接上传视频（仅允许私聊上传）
    if (chatId < 0) {
      console.log(`[handleVideo] 忽略群组中的视频消息: chatId=${chatId}`)
      return
    }

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

    const sizeMB = (videoSize / 1024 / 1024).toFixed(1)

    // 🎯 媒体组模式 (合辑)：使用数据库原子操作解决并发冲突
    if (mediaGroupId) {
      console.log(`[handleVideo-MG] 进入媒体组处理: mgid=${mediaGroupId}, fileId=${video.file_id}`)
      const newMediaItem = {
        type: 'video',
        file_id: video.file_id,
        play_url: null,
        cover_url: video.thumbnail?.file_id || video.thumb?.file_id || '',
        width: video.width,
        height: video.height,
        duration: video.duration,
        file_size: video.file_size || 0
      }

      let description: string | null = null
      let tags: string[] = []
      if (caption && caption.length > 0) {
        description = String(caption).trim()
        tags = extractTags(caption)
      }

      console.log(`[handleVideo-MG] 准备执行 RPC append_collection_media...`)
      const { data: result, error: rpcError } = await supabase.rpc('append_collection_media', {
        p_chat_id: chatId,
        p_media_group_id: mediaGroupId,
        p_new_item: newMediaItem,
        p_author_id: profile.id,
        p_caption: description,
        p_tags: tags.length > 0 ? tags : null,
        p_content_type: 'collection'
      })

      if (rpcError || result?.error) {
        console.error('[handleVideo-MG] 原子追加失败:', rpcError || result?.error)
        await sendMessage(
          chatId,
          '❌ 上传失败，请重试\n\n错误: ' +
            sanitizeError(escapeHTML(rpcError?.message || result?.error))
        )
        return
      }

      console.log(
        `[handleVideo-MG] RPC 结果: id=${result.id}, is_new=${result.is_new}, count=${result.media_count}`
      )

      // 🎯 获取当前状态，决定是否发送新提示
      const userState = await getUserState(chatId)
      console.log(
        `[handleVideo-MG] 当前用户状态: draft_id=${userState.draft_video_id}, msgId=${userState.current_message_id}`
      )

      let targetMessageId = 0

      // 如果是新创建的记录，发送“处理中”提示
      if (result.is_new) {
        console.log(`[handleVideo-MG] 检测到新记录，发送处理中消息...`)
        const processingMsg = await sendMessage(
          chatId,
          `🔄 <b>正在处理合辑内容...</b>\n\n` +
            `📦 收到第 ${result.media_count} 个媒体项\n` +
            `⏳ 正在转码并同步数据...\n` +
            `💡 处理完成后会自动显示编辑菜单`
        )
        targetMessageId = processingMsg.ok ? processingMsg.result.message_id : 0
        console.log(
          `[handleVideo-MG] 新消息发送结果: ok=${processingMsg.ok}, msgId=${targetMessageId}`
        )

        await updateUserState(chatId, {
          state: 'idle',
          draft_video_id: result.id,
          current_message_id: targetMessageId
        })
        console.log(`[handleVideo-MG] 用户状态已更新为新记录.`)
      } else {
        // 如果合辑已存在，且用户正在看它的菜单，则复用菜单消息 ID，这样 Worker 完成后会直接原地刷新菜单
        targetMessageId =
          userState.draft_video_id === result.id ? Number(userState.current_message_id || 0) : 0
        console.log(`[handleVideo-MG] 合辑已存在，复用 msgId=${targetMessageId}`)
      }

      // 触发 Worker
      console.log(
        `[handleVideo-MG] 触发 Worker: videoId=${result.id}, fileId=${video.file_id}, targetMsgId=${targetMessageId}`
      )
      await triggerWorker(result.id, video.file_id, chatId, targetMessageId)
      return
    }

    console.log(`[handleVideo] 视频大小: ${sizeMB} MB, 准备转存 R2`)

    const videoMediaItem = {
      type: 'video',
      file_id: video.file_id,
      width: video.width,
      height: video.height,
      duration: video.duration,
      cover_url: video.thumbnail?.file_id || video.thumb?.file_id || '',
      order: 0
    }

    const isAutoApprove = profile?.auto_approve || extraData?.status === 'published'

    const { data: draftVideo, error } = await supabase
      .from('videos')
      .insert({
        tg_user_id: chatId,
        author_id: profile.id,
        title: mediaGroupId ? '未命名合集' : video.file_name || '未命名视频',
        description: description,
        tags: tags.length > 0 ? tags : null,
        play_url: null,
        cover_url: videoMediaItem.cover_url || video.file_id, // 🎯 这里的封面会被用于作品列表展示
        tg_file_id: video.file_id,
        tg_thumbnail_file_id: videoMediaItem.cover_url || null,
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
        is_auto_sync: extraData?.is_auto_sync || false, // 🎯 标记自动同步
        review_status: isAutoApprove ? 'auto_approved' : 'pending',
        published_at: isAutoApprove ? new Date().toISOString() : null,
        media_group_id: mediaGroupId,
        media_list: JSON.stringify([videoMediaItem]),
        images: JSON.stringify([videoMediaItem]),
        content_type: mediaGroupId ? 'collection' : 'video'
      })
      .select()
      .single()

    if (error) {
      console.error('保存视频记录失败:', error)
      await sendMessage(
        chatId,
        '❌ 上传失败，请重试\n\n错误: ' + sanitizeError(escapeHTML(error.message))
      )
      return
    }

    console.log(`[handleVideo] 视频记录已保存: ${draftVideo.id}, 状态: ${draftVideo.status}`)

    // 🎯 只有非自动同步时，才向用户发送提示消息
    if (!extraData?.is_auto_sync) {
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
    } else {
      console.log(`[handleVideo] 自动同步模式，静默启动 Worker.`)
      // 自动同步不需要给用户发“正在处理”消息，传 0 即可
      await triggerWorker(draftVideo.id, video.file_id, chatId, 0)
    }
  } catch (error) {
    console.error('[handleVideo] 处理视频失败:', error)
    console.error('[handleVideo] 错误堆栈:', error instanceof Error ? error.stack : String(error))
    try {
      await sendMessage(
        chatId,
        '❌ 处理失败，请重试\n\n错误: ' +
          sanitizeError(escapeHTML(error instanceof Error ? error.message : String(error)))
      )
    } catch (sendError) {
      console.error('[handleVideo] 发送错误消息也失败了:', sendError)
    }
  }
}
