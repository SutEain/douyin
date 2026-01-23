// import { BOT_TOKEN } from './env.ts'
import { supabase } from './supabaseClient.ts'
import { getUserState, updateUserState } from './state.ts'
import { handleSettings } from './features/settings.ts'
import { handleInlineQuery } from './features/inlineShare.ts'
// import { handleMyVideosEdit, handleViewProcessing } from './features/myVideos.ts'
import { getPersistentKeyboard, getWelcomeKeyboard } from './keyboards.ts'
import { handleUserProfile } from './features/profileCenter.ts'
import { handleInvitation } from './features/invitation.ts'
import { getOrCreateProfile } from './services/profile.ts'
import { getEditKeyboard, getEditMenuText } from './features/editor.ts'
import { handlePhoto, handleVideo /*, mediaGroupRejectCache*/ } from './features/upload.ts'
import { deleteTelegramMessage, sendMessage, editMessage } from './telegram.ts'
import { sanitizeError } from './utils/text.ts'
import { handleCallback } from './routers/callback.ts'
import { handleLocation, handleText, handleForward } from './routers/messages.ts'
import { handleChannelPost } from './routers/channelPost.ts'

// 主服务（由 index.ts 作为入口调用）
export async function handleRequest(req: Request): Promise<Response> {
  console.log('[BOT-APP] Incoming request:', req.method, req.url)
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
      let update: any
      try {
        update = await req.json()
      } catch (e) {
        console.error('[BOT-APP] Failed to parse request JSON:', e)
        return new Response('Invalid JSON', { status: 400 })
      }

      // 🎯 优化：只打印消息类型，不序列化完整内容（高频消息影响性能）
      const updateType = Object.keys(update).find((k) => k !== 'update_id') || 'unknown'
      console.log('[BOT-APP] Update type:', updateType)

      // 🎯 1. 提取用户 ID 进行黑名单检查 (注意：在群组中 chat.id 是群 ID，from.id 才是用户 ID)
      const userIdToCheck =
        update.message?.from?.id ||
        update.edited_message?.from?.id ||
        update.callback_query?.from?.id ||
        update.inline_query?.from?.id

      if (userIdToCheck && update.type !== 'worker_complete') {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_banned, ban_reason')
          .eq('tg_user_id', userIdToCheck)
          .maybeSingle()

        if (profile?.is_banned) {
          console.log(
            `[BOT-BAN] 拦截到封禁用户操作: userId=${userIdToCheck}, updateType=${Object.keys(update).find((k) => k !== 'update_id')}`
          )
          const banReason = profile.ban_reason || '由于违反社区规范，您的账号已被封禁。'
          const banNotice = `🚫 <b>您的账号已被封禁</b>\n\n原因: ${banReason}\n\n如有疑问，请联系管理员。`

          // 确定发送通知的目标
          const targetChatId =
            update.message?.chat?.id ||
            update.edited_message?.chat?.id ||
            update.callback_query?.message?.chat?.id

          if ((update.message || update.edited_message) && targetChatId) {
            const msg = update.message || update.edited_message
            // 🚨 群组消息静默处理，不发送提示
            if (msg.chat.type !== 'private') {
              // 群组中静默返回，不发送任何提示
              return new Response('OK', { status: 200 })
            }
            // 私聊消息仍然发送提示
            await sendMessage(targetChatId, banNotice, {})
          } else if (update.callback_query) {
            // 弹出警告提示框（仅在私聊中）
            const callbackChatId = update.callback_query.message?.chat?.id
            if (callbackChatId && callbackChatId > 0) {
              // 私聊中的回调查询才提示
              const { answerCallbackQuery } = await import('./telegram.ts')
              await answerCallbackQuery(update.callback_query.id, {
                text: `🚫 账号已封禁\n原因: ${banReason}`,
                show_alert: true
              })
            }
            // 群组中的回调查询静默处理
          } else if (update.inline_query) {
            // 对于搜索分享，返回一个告知封禁的单条结果
            const { TG_BOT_TOKEN } = await import('./env.ts')
            await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/answerInlineQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                inline_query_id: update.inline_query.id,
                results: [
                  {
                    type: 'article',
                    id: 'banned',
                    title: '🚫 您的账号已被封禁',
                    description: banReason,
                    input_message_content: {
                      message_text: '🚫 抱歉，由于违反规范，我暂时无法使用机器人功能。'
                    }
                  }
                ],
                cache_time: 0
              })
            })
          }
          return new Response('OK', { status: 200 })
        }
      }

      // ✅ 2. 处理 Worker 完成回调
      if (update.type === 'worker_complete') {
        const {
          chatId,
          messageId,
          videoId,
          success,
          error: workerError,
          play_url,
          cover_url,
          file_id
        } = update
        console.log(
          `[WorkerCallback] 开始处理: videoId=${videoId}, fileId=${file_id}, success=${success}, msgId=${messageId}`
        )

        try {
          // 1. 获取用户当前状态
          const userState = await getUserState(chatId)
          console.log(
            `[WorkerCallback] 准备处理菜单. messageId=${messageId}, currentMsgId=${userState.current_message_id}`
          )

          if (!success) {
            if (messageId && messageId > 0) await deleteTelegramMessage(chatId, messageId)
            // 🎯 补救脚本场景：messageId 为 0 或 null 时，不发送错误通知（避免给频道同步用户发送重复通知）
            if (messageId && messageId > 0) {
              await sendMessage(
                chatId,
                `❌ 处理失败\n\n${sanitizeError(workerError || '未知错误')}`
              )
            } else {
              console.log(`[WorkerCallback] 补救脚本场景，跳过错误通知（messageId=${messageId}）`)
            }
            return new Response('OK', { status: 200 })
          }

          // 2. 获取并更新视频信息
          const { data: video } = await supabase
            .from('videos')
            .select('*')
            .eq('id', videoId)
            .single()

          if (!video) {
            console.error(`[WorkerCallback] 找不到视频记录: ${videoId}`)
            if (messageId && messageId > 0) await deleteTelegramMessage(chatId, messageId)
            // 🎯 补救脚本场景：messageId 为 0 或 null 时，不发送错误通知
            if (messageId && messageId > 0) {
              await sendMessage(chatId, '❌ 视频信息同步失败')
            } else {
              console.log(`[WorkerCallback] 补救脚本场景，跳过错误通知（messageId=${messageId}）`)
            }
            return new Response('OK', { status: 200 })
          }

          // 🎯 如果是合集 (collection) 或相册 (album)，进行数据补全
          if (video.content_type === 'collection' || video.content_type === 'album') {
            // 🎯 关键逻辑：即使回调 payload 没带 play_url，我们也尝试从数据库主记录中获取（Worker 刚填进去的）
            const effectivePlayUrl = play_url || video.play_url
            const effectiveCoverUrl = cover_url || video.cover_url

            if (effectivePlayUrl || effectiveCoverUrl) {
              const targetFileId = file_id || video.tg_file_id
              console.log(
                `[WorkerCallback] 尝试补全合集/相册媒体项: videoId=${videoId}, fileId=${targetFileId}, playUrl=${effectivePlayUrl}`
              )

              const { error: rpcError } = await supabase.rpc('update_collection_media_item', {
                p_video_id: videoId,
                p_file_id: targetFileId,
                p_play_url: effectivePlayUrl,
                p_cover_url: effectiveCoverUrl
              })

              if (rpcError) {
                console.error('[WorkerCallback] RPC 补全失败:', rpcError)
              } else {
                // 再次刷新 video 对象，确保后续菜单显示的 media_list 是最新的
                const { data: latestVideo } = await supabase
                  .from('videos')
                  .select('*')
                  .eq('id', videoId)
                  .single()
                if (latestVideo) {
                  Object.assign(video, latestVideo)
                  video.media_list =
                    typeof latestVideo.media_list === 'string'
                      ? JSON.parse(latestVideo.media_list)
                      : latestVideo.media_list
                  video.images = video.media_list
                }
              }
            }

            // 🎯 如果目前还是 processing 状态，强制检查并转换（对于相册，只要有图片成功了就可以展示）
            if (video.status === 'processing') {
              const isApproved =
                video.review_status === 'approved' || video.review_status === 'auto_approved'
              // 🎯 自动同步的相册/合集：处理完成后自动转换为 published
              // 🎯 非自动同步的相册/合集：根据审核状态转换
              const newStatus =
                video.is_auto_sync && isApproved ? 'published' : isApproved ? 'published' : 'ready'
              console.log(`[WorkerCallback] 转换相册状态: processing -> ${newStatus}`)
              const updatePayload: any = { status: newStatus }
              if (newStatus === 'published' && !video.published_at) {
                updatePayload.published_at = new Date().toISOString()
              }
              await supabase.from('videos').update(updatePayload).eq('id', videoId)
              video.status = newStatus
            }
          }

          // 🎯 自动同步的视频：处理完成后自动转换为 published，但不发送消息
          if (video.is_auto_sync && video.status === 'processing') {
            const isApproved =
              video.review_status === 'approved' || video.review_status === 'auto_approved'
            if (isApproved) {
              console.log(
                `[WorkerCallback] 自动同步视频处理完成，自动转换状态: processing -> published`
              )
              await supabase
                .from('videos')
                .update({ status: 'published', published_at: new Date().toISOString() })
                .eq('id', videoId)
              video.status = 'published'
            }
          }

          // 🎯 频道同步：只有明确标记为 is_auto_sync 的视频，且处于已发布状态，才发送通知
          // 🎯 频道同步用户严禁弹出编辑菜单
          if (video.is_auto_sync) {
            console.log(
              `[WorkerCallback] 检测到频道同步作品 (videoId=${videoId})，执行专用通知逻辑`
            )

            // 🎯 如果状态是 published（已发布成功），静默处理，不发送通知
            if (video.status === 'published') {
              console.log(`[WorkerCallback] 自动同步作品已发布，静默处理，不发送通知`)
              if (messageId && messageId > 0) await deleteTelegramMessage(chatId, messageId)
              return new Response('OK', { status: 200 })
            }

            // 🎯 如果状态是 ready（非免审用户，待审核），静默处理，不发送通知
            if (video.status === 'ready') {
              console.log(
                `[WorkerCallback] 频道同步非免审用户，状态为 ready，静默处理，等待审核通过后再通知`
              )
              if (messageId && messageId > 0) await deleteTelegramMessage(chatId, messageId)
              return new Response('OK', { status: 200 })
            }

            // 🎯 特殊情况：如果是频道同步但状态还是 processing（例如多图集合回调），也直接退出，不弹菜单
            if (video.status === 'processing') {
              console.log(
                `[WorkerCallback] 频道同步作品处理中 (videoId=${videoId})，静默等待后续回调`
              )
              return new Response('OK', { status: 200 })
            }

            // 🎯 兜底拦截：只要是频道同步，无论什么状态都不允许往下走弹出菜单
            console.log(`[WorkerCallback] 频道同步兜底拦截 (videoId=${videoId})`)
            return new Response('OK', { status: 200 })
          }

          // 🎯 如果视频状态还是 processing，不要显示"已就绪"菜单
          if (video.status === 'processing') {
            console.log(
              `[WorkerCallback] 视频状态仍为 processing，不显示已就绪菜单. videoId=${videoId}`
            )
            return new Response('OK', { status: 200 })
          }

          // 3. 发送或更新编辑菜单
          let finalMessageId = null
          const menuText = getEditMenuText(video)
          const menuKeyboard = getEditKeyboard(video)

          // 🎯 优先级 1：尝试编辑传入的 messageId (通常是“正在处理”消息)
          if (messageId && messageId > 0) {
            console.log(`[WorkerCallback] 尝试编辑处理中消息: ${messageId}`)
            const editResult = await editMessage(chatId, messageId, menuText, {
              reply_markup: menuKeyboard
            })
            if (editResult?.ok) {
              console.log(`[WorkerCallback] 编辑处理中消息成功.`)
              finalMessageId = messageId
            } else {
              // 如果编辑失败（可能是消息已被删除或内容相同），尝试判断原因
              console.log(`[WorkerCallback] 编辑处理中消息失败: ${editResult?.description}`)
              if (editResult?.description?.includes('not modified')) {
                finalMessageId = messageId
              }
            }
          }

          // 🎯 优先级 2：如果优先级 1 失败，尝试编辑用户当前活跃的菜单
          if (
            !finalMessageId &&
            userState.draft_video_id === video.id &&
            userState.current_message_id
          ) {
            console.log(`[WorkerCallback] 尝试编辑活跃菜单: ${userState.current_message_id}`)
            const editResult = await editMessage(
              chatId,
              Number(userState.current_message_id),
              menuText,
              {
                reply_markup: menuKeyboard
              }
            )
            if (editResult?.ok || editResult?.description?.includes('not modified')) {
              finalMessageId = userState.current_message_id
            }
          }

          // 🎯 优先级 3：如果都失败了，发送新消息
          if (!finalMessageId) {
            console.log(`[WorkerCallback] 发送新菜单消息...`)
            const menuResult = await sendMessage(chatId, menuText, {
              reply_markup: menuKeyboard
            })
            if (menuResult?.ok) {
              finalMessageId = menuResult.result.message_id
              // 如果我们发送了新消息，且之前的 messageId 还在，记得把它删了
              if (messageId && messageId !== finalMessageId) {
                await deleteTelegramMessage(chatId, messageId)
              }
            }
          }

          // 4. 更新用户状态
          if (finalMessageId) {
            await updateUserState(chatId, {
              state: 'idle',
              draft_video_id: video.id,
              current_message_id: finalMessageId
            })
          }
          console.log(`[WorkerCallback] 流程结束. finalMessageId=${finalMessageId}`)
        } catch (e) {
          console.error('[WorkerCallback] 处理异常:', e)
        }
        return new Response('OK', { status: 200 })
      }

      console.log('收到更新:', JSON.stringify(update).substring(0, 200))

      // 🎯 处理频道更新 (自动搬运)
      if (update.channel_post) {
        console.log('[MAIN] 收到频道更新 (channel_post)')
        await handleChannelPost(update.channel_post)
        return new Response('OK', { status: 200 })
      }

      // 处理消息
      if (update.message) {
        const message = update.message
        const chatId = message.chat.id

        // 🎯 严格权限控制：仅接受私聊、官方群或 dice 群的消息
        // 频道同步由 update.channel_post 独立处理，不受此影响
        const officialGroupId = Deno.env.get('OFFICIAL_GROUP_ID')
        const diceGroupId = Deno.env.get('DICE_GROUP_ID')
        const isAllowedGroup =
          String(chatId) === String(officialGroupId) || String(chatId) === String(diceGroupId)

        if (message.chat.type !== 'private' && !isAllowedGroup) {
          console.log(
            `[MAIN] 忽略非私聊且非允许群消息: chatId=${chatId}, type=${message.chat.type}`
          )
          return new Response('OK', { status: 200 })
        }

        // 🎯 处理转发消息 (用于绑定频道)
        if (
          (message.forward_origin || message.forward_from_chat) &&
          (await getUserState(chatId)).state === 'waiting_channel_forward'
        ) {
          console.log('[MAIN] 收到转发消息 (用于绑定频道)')
          await handleForward(chatId, message)
          return new Response('OK', { status: 200 })
        }

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
          const parts = message.text.split(' ')
          const startParam = parts.length > 1 ? parts[1] : null

          // 🎯 处理 Web 登录验证码生成
          if (startParam === 'web_login') {
            // 创建或获取用户 profile（直接使用 message.from 数据，无需额外 API 调用）
            const profile = await getOrCreateProfile(chatId, message.from)

            if (profile) {
              const { createVerificationCode } = await import('./services/verification.ts')
              const code = await createVerificationCode(chatId, message.from)

              if (code) {
                const loginMessage =
                  `🔐 <b>Web 登录验证码</b>\n\n` +
                  `您的验证码是：<code>${code}</code>\n\n` +
                  `请在网页上输入此验证码完成登录。\n` +
                  `⏰ 验证码有效期：5 分钟\n\n` +
                  `💡 提示：验证码仅可使用一次，使用后自动失效。`

                await sendMessage(chatId, loginMessage, {
                  parse_mode: 'HTML'
                })
              } else {
                await sendMessage(chatId, '❌ 生成验证码失败，请稍后重试')
              }
            } else {
              await sendMessage(chatId, '❌ 账号初始化失败，请稍后重试')
            }
            return new Response('OK', { status: 200 })
          }

          // 创建或获取用户 profile（直接使用 message.from 数据，无需额外 API 调用）
          const profile = await getOrCreateProfile(chatId, message.from)

          if (profile) {
            // 🎯 处理邀请逻辑 (检查是否有参数 /start 12345)
            if (
              startParam &&
              /^\d+$/.test(startParam) &&
              String(startParam) !== String(profile.numeric_id)
            ) {
              await handleInvitation(profile.id, parseInt(startParam))
            }

            // 1. 先发送底部菜单（Persistent Keyboard） - 仅限私聊
            if (message.chat.type === 'private') {
              await sendMessage(
                chatId,
                '👋 欢迎加入 [TG 抖音]  🔥\n 接受一切资源合作洽谈。成为股东，请联系 @Edison521',
                {
                  reply_markup: getPersistentKeyboard()
                }
              )
            }

            // 2. 后发送欢迎消息（Inline Keyboard）
            const welcomeText =
              '👋 欢迎来到 TG 抖音 🚀\n' +
              'Telegram 最大的视频&amp;直播分享平台!\n\n' +
              '<b>🔥 这里有你想要的精彩内容 🔥</b>\n\n' +
              '📰 全球资讯 •  🍉 热门八卦 •  💥 网络热点\n' +
              '🔞 成人专区 •  🎤 娱乐直播 •  🌏 东南亚板块\n' +
              '🌟 更多内容等你来探索！\n\n' +
              '<b>🚀 诚邀您成为我们的“内容共建官”！</b>\n' +
              '📱 发现有趣视频？随手分享给我们\n' +
              '🎯 你的分享，将被千万用户看见\n' +
              '💎 优质内容创作者，更有专属福利\n\n' +
              '<b>💬 互动|分享|发现|快乐|尽在TG抖音！❤️</b>\n' +
              '--------------------------------------\n' +
              '📢 TG抖音官方频道：@laidouyin\n' +
              '<b>🎬 TG 抖音-你的视界-由你定义！✨</b>'

            const welcomeMarkup = getWelcomeKeyboard()

            // 记录消息ID，用于后续单面板交互（首页消息）
            let sentMessage
            if (welcomeMarkup) {
              const res = await sendMessage(chatId, welcomeText, {
                reply_markup: welcomeMarkup,
                disable_web_page_preview: true
              })
              sentMessage = res?.ok ? res.result : null
            } else {
              const res = await sendMessage(chatId, welcomeText, {
                reply_markup: getPersistentKeyboard(),
                disable_web_page_preview: true
              })
              sentMessage = res?.ok ? res.result : null
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
        // /settings 命令 - 仅限私聊
        else if (message.text === '/settings') {
          if (message.chat.type !== 'private') {
            return new Response('OK', { status: 200 })
          }
          await handleSettings(chatId)
        }
        // "首页"按钮 - 仅限私聊
        else if (message.text === '🏠 首页') {
          if (message.chat.type !== 'private') {
            return new Response('OK', { status: 200 })
          }
          // 重新发送欢迎消息（首页）
          const welcomeText =
            '👋 欢迎来到 TG 抖音 🚀\n' +
            'Telegram 最大的视频&amp;直播分享平台!\n\n' +
            '<b>🔥 这里有你想要的精彩内容 🔥</b>\n\n' +
            '📰 全球资讯 •  🍉 热门八卦 •  💥 网络热点\n' +
            '🔞 成人专区 •  🎤 娱乐直播 •  🌏 东南亚精选\n' +
            '🌟 更多内容等你来探索！\n\n' +
            '<b>🚀 诚邀您成为我们的“内容共建官”！</b>\n' +
            '📱 发现有趣视频？随手分享给我们\n' +
            '🎯 你的分享，将被千万用户看见\n' +
            '💎 优质内容创作者，更有专属福利\n\n' +
            '<b>💬 互动|分享|发现|快乐|尽在TG抖音！❤️</b>\n' +
            '--------------------------------------\n' +
            '📢 TG抖音官方频道：@laidouyin\n' +
            '<b>🎬 TG 抖音-你的视界-由你定义！✨</b>'
          const welcomeMarkup = getWelcomeKeyboard()

          let sentMessage
          if (welcomeMarkup) {
            const res = await sendMessage(chatId, welcomeText, {
              reply_markup: welcomeMarkup,
              disable_web_page_preview: true
            })
            sentMessage = res?.ok ? res.result : null
          }
          // 更新 dashboard message id
          if (sentMessage) {
            await updateUserState(chatId, { dashboard_message_id: sentMessage.message_id })
          }
        }
        // "个人中心"按钮 - 仅限私聊
        else if (message.text === '👤 个人中心') {
          if (message.chat.type !== 'private') {
            return new Response('OK', { status: 200 })
          }
          // 底部键盘点击 -> 始终新发一条消息，避免编辑上一条
          await handleUserProfile(chatId, undefined, { forceNew: true })
        }
        // "Web版登录"按钮 - 仅限私聊
        else if (message.text === '🌐 Web版登录') {
          if (message.chat.type !== 'private') {
            return new Response('OK', { status: 200 })
          }
          const webUrl = 'https://tgdouyin.com'
          // 先发送纯文本网址，方便用户选择复制
          await sendMessage(chatId, webUrl)

          // 再发送说明消息和打开按钮
          const webLoginText =
            '🌐 <b>TG抖音 Web版登录</b>\n\n' +
            '📱 请在浏览器中打开上方网址进行登录\n\n' +
            '💡 您可以：\n' +
            '• 长按上方网址选择复制\n' +
            '• 或点击下方按钮直接在浏览器打开'

          await sendMessage(chatId, webLoginText, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '🌐 在浏览器打开',
                    url: webUrl
                  }
                ]
              ]
            }
          })
        }
        // 📸 图片消息 - 仅限私聊
        else if (
          message.photo ||
          (message.document && message.document.mime_type?.startsWith('image/'))
        ) {
          if (message.chat.type !== 'private') {
            return new Response('OK', { status: 200 })
          }
          const photo = message.photo || [message.document]
          console.log('[MAIN] 识别到图片上传:', {
            hasPhoto: !!message.photo,
            hasDoc: !!message.document
          })

          await handlePhoto(chatId, photo, message.caption, message.from, message.media_group_id)
        }
        // 🎬 视频消息 - 仅限私聊
        else if (
          message.video ||
          (message.document && message.document.mime_type?.startsWith('video/'))
        ) {
          if (message.chat.type !== 'private') {
            return new Response('OK', { status: 200 })
          }
          const video = message.video || message.document
          console.log('[MAIN] 识别到视频上传:', {
            hasVideo: !!message.video,
            hasDoc: !!message.document
          })

          await handleVideo(chatId, video, message.caption, message.from, message.media_group_id)
        }
        // 位置消息 - 仅限私聊
        else if (message.location) {
          if (message.chat.type !== 'private') {
            return new Response('OK', { status: 200 })
          }
          await handleLocation(chatId, message.location, message.message_id)
        }
        // 文本消息
        else if (message.text) {
          await handleText(chatId, message.text, message.message_id, message)
        }
      }
      // 处理回调查询
      else if (update.callback_query) {
        const callback = update.callback_query
        const chatId = callback.message?.chat?.id
        const messageId = callback.message?.message_id
        const data = callback.data

        // 🎯 严格权限控制：仅接受私聊、官方群或 dice 群的回调
        const officialGroupId = Deno.env.get('OFFICIAL_GROUP_ID')
        const diceGroupId = Deno.env.get('DICE_GROUP_ID')
        const isAllowedGroup =
          String(chatId) === String(officialGroupId) || String(chatId) === String(diceGroupId)

        if (callback.message?.chat?.type !== 'private' && !isAllowedGroup) {
          return new Response('OK', { status: 200 })
        }

        if (chatId && messageId && data) {
          console.log('[DEBUG] 收到回调查询:', {
            chatId,
            messageId,
            data
          })

          await handleCallback(chatId, messageId, data, callback.id, callback.from.id, callback)
        }
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
