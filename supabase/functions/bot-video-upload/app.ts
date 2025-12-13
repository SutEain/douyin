import { BOT_TOKEN } from './env.ts'
import { supabase } from './supabaseClient.ts'
import { updateUserState, type UserState } from './state.ts'
import { handleSettings } from './features/settings.ts'
import { handleInlineQuery } from './features/inlineShare.ts'
import {
  getPublishedCtx,
  handleMyDrafts,
  handleMyProcessing,
  handleMyPublished,
  handleMyVideos,
  handleMyVideosEdit,
  handleViewProcessing,
  setPublishedCtx
} from './features/myVideos.ts'
import { getPersistentKeyboard, getWelcomeKeyboard } from './keyboards.ts'
import { handleUserProfile } from './features/profileCenter.ts'
import { handleInvitation } from './features/invitation.ts'
import { getOrCreateProfile } from './services/profile.ts'
import { getEditKeyboard, getEditMenuText } from './features/editor.ts'
import { handlePhoto, handleVideo, mediaGroupRejectCache } from './features/upload.ts'
import { deleteTelegramMessage, sendMessage } from './telegram.ts'
import { handleCallback } from './routers/callback.ts'
import { handleLocation, handleText } from './routers/messages.ts'

// 主服务（由 index.ts 作为入口调用）
export async function handleRequest(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)

    // 健康检查
    if (url.pathname.includes('/health')) {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // 处理 Webhook
    if (req.method === 'POST') {
      const update = await req.json()

      // ✅ 处理 Worker 完成回调
      if (update.type === 'worker_complete') {
        console.log('[WorkerCallback] 收到完成通知:', update)
        const { chatId, messageId, videoId, success, error: workerError } = update

        try {
          // 1. 删除"处理中"消息
          if (messageId) {
            await deleteTelegramMessage(chatId, messageId)
          }

          if (!success) {
            await sendMessage(chatId, `❌ 处理失败\n\n${workerError || '未知错误'}`)
            return new Response('OK', { status: 200 })
          }

          // 2. 获取视频信息
          const { data: video } = await supabase
            .from('videos')
            .select('*')
            .eq('id', videoId)
            .single()

          if (!video) {
            await sendMessage(chatId, '❌ 视频信息同步失败')
            return new Response('OK', { status: 200 })
          }

          // 3. 发送编辑菜单
          const menuResult = await sendMessage(chatId, getEditMenuText(video), {
            reply_markup: getEditKeyboard(video)
          })

          const newMessageId = menuResult.ok ? menuResult.result.message_id : null

          // 4. 更新用户状态
          await updateUserState(chatId, {
            state: 'idle',
            draft_video_id: video.id,
            current_message_id: newMessageId
          })
        } catch (e) {
          console.error('[WorkerCallback] 处理异常:', e)
        }
        return new Response('OK', { status: 200 })
      }

      console.log('收到更新:', JSON.stringify(update).substring(0, 200))

      // 处理消息
      if (update.message) {
        const message = update.message
        const chatId = message.chat.id

        console.log('[DEBUG] 消息类型:', {
          hasText: !!message.text,
          hasVideo: !!message.video,
          hasPhoto: !!message.photo,
          hasLocation: !!message.location,
          mediaGroupId: message.media_group_id,
          text: message.text
        })

        // /start 命令 - 创建用户并显示欢迎消息
        if (message.text && message.text.startsWith('/start')) {
          // 创建或获取用户 profile（直接使用 message.from 数据，无需额外 API 调用）
          const profile = await getOrCreateProfile(chatId, message.from)

          if (profile) {
            // 🎯 处理邀请逻辑 (检查是否有参数 /start 12345)
            const parts = message.text.split(' ')
            if (parts.length > 1) {
              const inviteCode = parts[1]
              // 必须是新用户才算有效邀请
              if (/^\d+$/.test(inviteCode) && String(inviteCode) !== String(profile.numeric_id)) {
                await handleInvitation(profile.id, parseInt(inviteCode))
              }
            }

            // 1. 先发送底部菜单（Persistent Keyboard）
            await sendMessage(chatId, '开发阶段 bug反馈 @vip843', {
              reply_markup: getPersistentKeyboard()
            })

            // 2. 后发送欢迎消息（Inline Keyboard）
            const welcomeText =
              '👋 <b>欢迎来到 TG 抖音</b>\n\n' +
              '这里是 Telegram 最大的视频分享平台\n' +
              '趣闻 • 吃瓜 • 热点 • 🔞\n\n' +
              '🚀 <b>共建内容生态</b>\n' +
              '发现好玩的视频？直接转发给我\n' +
              '分享你的快乐，让更多人看到！\n\n' +
              '✅ 账号已就绪'

            const welcomeMarkup = getWelcomeKeyboard()

            // 记录消息ID，用于后续单面板交互（首页消息）
            let sentMessage
            if (welcomeMarkup) {
              const res = await sendMessage(chatId, welcomeText, {
                reply_markup: welcomeMarkup
              })
              sentMessage = res.ok ? res.result : null
            } else {
              const res = await sendMessage(chatId, welcomeText, {
                reply_markup: getPersistentKeyboard()
              })
              sentMessage = res.ok ? res.result : null
            }

            // 初始化 dashboard_message_id 为首页消息
            if (sentMessage) {
              await updateUserState(chatId, { dashboard_message_id: sentMessage.message_id })
            }
          } else {
            await sendMessage(
              chatId,
              '❌ 初始化失败，请稍后重试\n\n' + '如果问题持续，请联系管理员'
            )
          }
        }
        // /settings 命令
        else if (message.text === '/settings') {
          await handleSettings(chatId)
        }
        // "首页"按钮
        else if (message.text === '🏠 首页') {
          // 重新发送欢迎消息（首页）
          const welcomeText =
            '👋 <b>欢迎来到 TG 抖音</b>\n\n' +
            '这里是 Telegram 最大的视频分享平台\n' +
            '趣闻 • 吃瓜 • 热点 • 🔞\n\n' +
            '🚀 <b>共建内容生态</b>\n' +
            '发现好玩的视频？直接转发给我\n' +
            '分享你的见闻，让更多人看到！\n\n' +
            '✅ 账号已就绪'
          const welcomeMarkup = getWelcomeKeyboard()

          let sentMessage
          if (welcomeMarkup) {
            const res = await sendMessage(chatId, welcomeText, { reply_markup: welcomeMarkup })
            sentMessage = res.ok ? res.result : null
          }
          // 更新 dashboard message id
          if (sentMessage) {
            await updateUserState(chatId, { dashboard_message_id: sentMessage.message_id })
          }
        }
        // "个人中心"按钮
        else if (message.text === '👤 个人中心') {
          // 底部键盘点击 -> 始终新发一条消息，避免编辑上一条
          await handleUserProfile(chatId, undefined, { forceNew: true })
        }
        // 📸 图片消息
        else if (message.photo) {
          // 检查是否是混合相册（视频+图片）
          if (message.media_group_id) {
            const mixedCacheKey = `mixed_${chatId}_${message.media_group_id}`
            const hasVideo = mediaGroupRejectCache.get(mixedCacheKey + '_video')

            if (hasVideo) {
              // 已经有视频了，拒绝图片
              console.log('[MAIN] 检测到混合相册（视频+图片），忽略图片')
              return new Response('OK', { status: 200 })
            }

            // 标记这个组有图片
            mediaGroupRejectCache.set(mixedCacheKey + '_photo', true)
            setTimeout(() => mediaGroupRejectCache.delete(mixedCacheKey + '_photo'), 5000)
          }

          await handlePhoto(
            chatId,
            message.photo,
            message.caption,
            message.from,
            message.media_group_id
          )
        }
        // 🎬 视频消息
        else if (message.video) {
          // 检查是否是混合相册（视频+图片）
          if (message.media_group_id) {
            const mixedCacheKey = `mixed_${chatId}_${message.media_group_id}`
            const hasPhoto = mediaGroupRejectCache.get(mixedCacheKey + '_photo')

            // 标记这个组有视频
            mediaGroupRejectCache.set(mixedCacheKey + '_video', true)
            setTimeout(() => mediaGroupRejectCache.delete(mixedCacheKey + '_video'), 5000)

            if (hasPhoto) {
              // 已经有图片了，这是混合相册，拒绝并清理数据库中的相册记录
              const { data: albumPost } = await supabase
                .from('videos')
                .select('id')
                .eq('tg_user_id', chatId)
                .eq('media_group_id', message.media_group_id)
                .single()

              if (albumPost) {
                // 删除已创建的相册记录
                await supabase.from('videos').delete().eq('id', albumPost.id)
                console.log(`[MAIN] 已删除混合相册记录: ${albumPost.id}`)
              }

              // 发送拒绝提示（只发一次）
              const rejectKey = `media_group_reject_${chatId}_${message.media_group_id}`
              if (!mediaGroupRejectCache.get(rejectKey)) {
                mediaGroupRejectCache.set(rejectKey, true)
                setTimeout(() => mediaGroupRejectCache.delete(rejectKey), 5000)

                await sendMessage(
                  chatId,
                  `⚠️ <b>暂不支持视频和图片混合上传</b>\n\n` +
                    `请分开发送：\n` +
                    `• 视频单独发一条\n` +
                    `• 图片可以一起发（最多9张）`
                )
              }
              return new Response('OK', { status: 200 })
            }
          }

          await handleVideo(
            chatId,
            message.video,
            message.caption,
            message.from,
            message.media_group_id
          )
        }
        // 位置消息
        else if (message.location) {
          await handleLocation(chatId, message.location, message.message_id)
        }
        // 文本消息
        else if (message.text) {
          await handleText(chatId, message.text, message.message_id)
        }
      }
      // 处理回调查询
      else if (update.callback_query) {
        const callback = update.callback_query
        const chatId = callback.message.chat.id
        const messageId = callback.message.message_id
        const data = callback.data

        console.log('[DEBUG] 收到回调查询:', {
          chatId,
          messageId,
          data
        })

        await handleCallback(chatId, messageId, data, callback.id)
      }
      // 🎯 处理 inline query（分享功能）
      else if (update.inline_query) {
        console.log('[MAIN] ========== 收到 INLINE QUERY ==========')
        console.log('[MAIN] inline_query:', JSON.stringify(update.inline_query, null, 2))
        await handleInlineQuery(update.inline_query)
        console.log('[MAIN] ========== INLINE QUERY 处理完成 ==========')
      }

      return new Response('OK', { status: 200 })
    }

    return new Response('Bot is running', { status: 200 })
  } catch (error) {
    console.error('[MAIN] 处理请求时发生错误:', error)
    console.error('[MAIN] 错误堆栈:', error instanceof Error ? error.stack : String(error))
    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : String(error)
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
