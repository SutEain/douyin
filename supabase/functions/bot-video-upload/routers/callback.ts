import { supabase } from '../supabaseClient.ts'
import { getUserState, updateUserState } from '../state.ts'
import { handleSettings, handleSettingsCallback } from '../features/settings.ts'
import {
  getPublishedCtx,
  handleMyDrafts,
  handleMyProcessing,
  handleMyPublished,
  handleMyVideosEdit,
  handleViewProcessing,
  setPublishedCtx
} from '../features/myVideos.ts'
import {
  handleHelp,
  handleInviteUnlock,
  handlePrivacySettings,
  handlePrivacySettingsEdit,
  handleUserProfile,
  handleApplyLive,
  handleWallet,
  handleRecharge,
  handleTransactions,
  handleCreateRechargeOrder,
  handleCancelRechargeOrder,
  handleWithdrawStart,
  handleWithdrawSubmit
} from '../features/profileCenter.ts'
import { getEditKeyboard, getEditMenuText, parseVideoAction } from '../features/editor.ts'
import {
  handleDeleteVideo,
  handleDeleteVideoFromDetail,
  handleViewVideo,
  notifyFollowersNewPost,
  publishVideo,
  toggleVideoPin
} from '../features/videoActions.ts'
import {
  answerCallbackQuery,
  editMessage,
  editMessageReplyMarkup,
  sendMessage
} from '../telegram.ts'

// 处理回调按钮
export async function handleCallback(
  chatId: number,
  messageId: number,
  data: string,
  callbackQueryId: string
) {
  console.log('[handleCallback] 开始处理回调')
  console.log('[handleCallback] chatId:', chatId, 'messageId:', messageId, 'data:', data)

  try {
    // ✅ “noop/禁用按钮”回调：只提示，不做任何动作
    if (data === 'noop') {
      await answerCallbackQuery(callbackQueryId, '⏳ 正在处理中，请稍等…')
      return
    }

    // 🎯 个人中心相关回调
    if (data === 'user_profile') {
      await answerCallbackQuery(callbackQueryId)
      await handleUserProfile(chatId, messageId)
      return
    }

    // 🎯 返回首页
    if (data === 'back_home') {
      await answerCallbackQuery(callbackQueryId)
      const { getWelcomeKeyboard } = await import('../keyboards.ts')

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

      if (welcomeMarkup) {
        await editMessage(chatId, messageId, welcomeText, {
          reply_markup: welcomeMarkup,
          disable_web_page_preview: true
        })
      }
      return
    }

    if (data === 'profile_invite_unlock') {
      await answerCallbackQuery(callbackQueryId)
      await handleInviteUnlock(chatId, messageId)
      return
    }

    if (data === 'profile_start_live') {
      // ✅ 防止连续点击：增加 5 秒冷却锁
      const userState = await getUserState(chatId)
      const now = Date.now()
      const ctx = (userState as any)?.context || {}
      const uiLocks = ctx.ui_locks || {}
      const until = Number(uiLocks.start_live_until || 0)
      if (until && until > now) {
        await answerCallbackQuery(callbackQueryId, '⏳ 正在处理中，请稍等…')
        return
      }

      await updateUserState(chatId, {
        context: { ...ctx, ui_locks: { ...uiLocks, start_live_until: now + 5000 } }
      })

      await answerCallbackQuery(callbackQueryId)
      const { handleAskLiveTitle } = await import('../features/profileCenter.ts')
      await handleAskLiveTitle(chatId, messageId)
      return
    }

    if (data === 'profile_refresh_live_key') {
      await answerCallbackQuery(callbackQueryId, '🔄 正在重置推流密钥...')

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('tg_user_id', chatId)
        .single()

      if (!profile) return

      const functionUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/live-handler`
      await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({ action: 'refresh', userId: profile.id })
      })

      const { handleStartLive } = await import('../features/profileCenter.ts')
      await handleStartLive(chatId, messageId)
      return
    }

    if (data === 'profile_apply_live') {
      await answerCallbackQuery(callbackQueryId)
      await handleApplyLive(chatId, messageId)
      return
    }

    if (data === 'profile_wallet') {
      await answerCallbackQuery(callbackQueryId)
      await handleWallet(chatId, messageId)
      return
    }

    if (data === 'profile_recharge') {
      await answerCallbackQuery(callbackQueryId)
      await handleRecharge(chatId, messageId)
      return
    }

    if (data === 'profile_withdraw') {
      await answerCallbackQuery(callbackQueryId)
      await handleWithdrawStart(chatId, messageId)
      return
    }

    if (data === 'withdraw_submit') {
      await answerCallbackQuery(callbackQueryId, '🚀 正在提交申请...')
      await handleWithdrawSubmit(chatId, messageId)
      return
    }

    if (data === 'profile_transactions') {
      await answerCallbackQuery(callbackQueryId)
      await handleTransactions(chatId, messageId)
      return
    }

    // 🎯 充值下单
    if (data.startsWith('recharge_order:')) {
      const amount = parseInt(data.split(':')[1])
      await answerCallbackQuery(callbackQueryId, '🚀 正在为您准备订单...')
      await handleCreateRechargeOrder(chatId, messageId, amount)
      return
    }

    // 🎯 取消订单
    if (data.startsWith('recharge_cancel:')) {
      const orderId = data.split(':')[1]
      await answerCallbackQuery(callbackQueryId, '🔄 正在取消订单...')
      await handleCancelRechargeOrder(chatId, messageId, orderId)
      return
    }

    // 🎯 上传视频引导
    if (data === 'upload_video') {
      await answerCallbackQuery(callbackQueryId)
      const uploadGuide =
        '📤 <b>上传视频</b>\n\n' +
        '点击输入框左侧的 📎 按钮\n' +
        '选择要分享的视频发送给我\n\n' +
        '<i>💡 选择1个视频发送给我</i>\n' +
        '<i>💡 选择多个图片作为合集发送</i>\n' +
        '<i>💡 转发其他频道的视频或图片相册给我</i>\n' +
        '<i>(不支持图片视频混合上传)</i>'
      await editMessage(chatId, messageId, uploadGuide, {
        reply_markup: {
          inline_keyboard: [[{ text: '⬅️ 返回首页', callback_data: 'back_home' }]]
        }
      })
      return
    }

    if (data === 'profile_help') {
      await answerCallbackQuery(callbackQueryId)
      await handleHelp(chatId, messageId)
      return
    }
    if (data === 'profile_settings_notify') {
      await answerCallbackQuery(callbackQueryId)
      await handleSettings(chatId, messageId)
      return
    }
    if (data === 'profile_settings_privacy') {
      await answerCallbackQuery(callbackQueryId)
      await handlePrivacySettings(chatId, messageId)
      return
    }

    // ✅ 上传中列表：查看单条处理任务
    if (data.startsWith('view_processing_')) {
      const videoId = data.replace('view_processing_', '')
      await answerCallbackQuery(callbackQueryId)
      await handleViewProcessing(chatId, messageId, videoId)
      return
    }

    // 🎯 通知设置
    if (data.startsWith('settings:')) {
      await handleSettingsCallback(chatId, messageId, data)
      await answerCallbackQuery(callbackQueryId)
      return
    }

    // 🎯 视频详情页 - 置顶/取消置顶
    if (data.startsWith('toggle_pin_detail:')) {
      const videoId = data.split(':')[1]
      const { data: detailVideo } = await supabase
        .from('videos')
        .select('*')
        .eq('id', videoId)
        .single()

      if (!detailVideo) {
        await answerCallbackQuery(callbackQueryId, '视频不存在')
        return
      }

      try {
        const updatedVideo = await toggleVideoPin(detailVideo)
        await answerCallbackQuery(
          callbackQueryId,
          updatedVideo.is_top ? '✅ 已置顶' : '✅ 已取消置顶'
        )
        await handleViewVideo(chatId, messageId, videoId)
      } catch (error) {
        await answerCallbackQuery(
          callbackQueryId,
          error instanceof Error ? error.message : '操作失败',
          true
        )
      }
      return
    }

    // 🎯 隐私设置 - 切换收藏公开/私密
    if (data === 'toggle_show_collect') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('show_collect')
        .eq('tg_user_id', chatId)
        .single()

      const newValue = !(profile?.show_collect !== false)
      await supabase.from('profiles').update({ show_collect: newValue }).eq('tg_user_id', chatId)

      await answerCallbackQuery(
        callbackQueryId,
        newValue ? '✅ 收藏已设为公开' : '🔒 收藏已设为私密'
      )
      await handlePrivacySettingsEdit(chatId, messageId)
      return
    }

    // 🎯 隐私设置 - 切换喜欢公开/私密
    if (data === 'toggle_show_like') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('show_like')
        .eq('tg_user_id', chatId)
        .single()

      const newValue = !(profile?.show_like !== false)
      await supabase.from('profiles').update({ show_like: newValue }).eq('tg_user_id', chatId)

      await answerCallbackQuery(
        callbackQueryId,
        newValue ? '✅ 喜欢已设为公开' : '🔒 喜欢已设为私密'
      )
      await handlePrivacySettingsEdit(chatId, messageId)
      return
    }

    // 🎯 隐私设置 - 切换Tg用户名显示/隐藏
    if (data === 'toggle_show_tg_username') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('show_tg_username')
        .eq('tg_user_id', chatId)
        .single()

      const newValue = !(profile?.show_tg_username === true)
      await supabase
        .from('profiles')
        .update({ show_tg_username: newValue })
        .eq('tg_user_id', chatId)

      await answerCallbackQuery(
        callbackQueryId,
        newValue ? '✅ Tg用户名已显示' : '❌ Tg用户名已隐藏'
      )
      await handlePrivacySettingsEdit(chatId, messageId)
      return
    }

    // 🎯 视频详情页 - 切换私密/公开
    if (data.startsWith('toggle_privacy_detail:')) {
      const videoId = data.split(':')[1]
      const { data: video } = await supabase
        .from('videos')
        .select('is_private')
        .eq('id', videoId)
        .single()

      if (!video) {
        await answerCallbackQuery(callbackQueryId, '视频不存在')
        return
      }

      const newPrivacy = !video.is_private
      await supabase.from('videos').update({ is_private: newPrivacy }).eq('id', videoId)

      await answerCallbackQuery(callbackQueryId, newPrivacy ? '🔒 已设为私密' : '🌍 已设为公开')
      await handleViewVideo(chatId, messageId, videoId)
      return
    }

    // 🎯 视频详情页 - 编辑描述
    if (data.startsWith('edit_desc_detail:')) {
      const videoId = data.split(':')[1]
      await answerCallbackQuery(callbackQueryId)
      await updateUserState(chatId, {
        state: 'editing_description',
        draft_video_id: videoId,
        current_message_id: messageId
      })
      await editMessage(
        chatId,
        messageId,
        '✏️ 请发送视频描述\n\n💡 提示：发送 /cancel 可取消编辑',
        {
          reply_markup: {
            inline_keyboard: [[{ text: '← 返回', callback_data: `view_video_${videoId}` }]]
          }
        }
      )
      return
    }

    // 🎯 视频详情页 - 编辑标签
    if (data.startsWith('edit_tags_detail:')) {
      const videoId = data.split(':')[1]
      await answerCallbackQuery(callbackQueryId)
      await updateUserState(chatId, {
        state: 'editing_tags',
        draft_video_id: videoId,
        current_message_id: messageId
      })
      await editMessage(
        chatId,
        messageId,
        '🏷️ 请发送标签\n\n格式：多个标签用空格分隔\n例如：吃瓜 东南亚 新闻\n\n💡 发送 /cancel 可取消编辑',
        {
          reply_markup: {
            inline_keyboard: [[{ text: '← 返回', callback_data: `view_video_${videoId}` }]]
          }
        }
      )
      return
    }

    // 🎯 视频详情页 - 编辑位置
    if (data.startsWith('edit_location_detail:')) {
      const videoId = data.split(':')[1]
      await answerCallbackQuery(callbackQueryId)
      await updateUserState(chatId, {
        state: 'editing_location_detail',
        draft_video_id: videoId,
        current_message_id: messageId
      })
      await editMessage(
        chatId,
        messageId,
        '📍 <b>编辑位置</b>\n\n' +
          '请点击下方的 📎 附件按钮，选择"位置"，发送您的实时位置或选择一个位置\n\n' +
          '💡 系统将自动识别国家和城市\n\n' +
          '发送 /cancel 可取消编辑',
        {
          reply_markup: {
            inline_keyboard: [[{ text: '← 返回', callback_data: `view_video_${videoId}` }]]
          }
        }
      )
      return
    }

    // 🎯 视频详情页 - 删除视频
    if (data.startsWith('delete_video_detail:')) {
      const videoId = data.split(':')[1]
      await handleDeleteVideoFromDetail(chatId, messageId, videoId, callbackQueryId)
      return
    }

    // ===== "我的视频"相关回调 =====
    if (data === 'back_my_videos') {
      await answerCallbackQuery(callbackQueryId)
      await handleMyVideosEdit(chatId, messageId)
      return
    }

    if (data === 'my_processing') {
      await answerCallbackQuery(callbackQueryId)
      await handleMyProcessing(chatId, messageId)
      return
    }

    if (data === 'my_published') {
      await answerCallbackQuery(callbackQueryId)
      await setPublishedCtx(chatId, { q: undefined, cursorStack: [null], nextCursor: null })
      await handleMyPublished(chatId, messageId)
      return
    }

    // ===== 已发布列表：搜索/翻页 =====
    if (data === 'published_search') {
      await answerCallbackQuery(callbackQueryId)
      await updateUserState(chatId, {
        state: 'waiting_published_search',
        current_message_id: messageId
      })
      await editMessage(
        chatId,
        messageId,
        '🔎 <b>搜索已发布视频</b>\n\n请输入关键字（将匹配描述 + 标签）\n\n💡 发送 /cancel 可取消',
        {
          reply_markup: {
            inline_keyboard: [[{ text: '← 取消', callback_data: 'published_search_cancel' }]]
          }
        }
      )
      return
    }

    if (data === 'published_search_cancel') {
      await answerCallbackQuery(callbackQueryId, '✅ 已取消')
      await updateUserState(chatId, { state: 'idle' })
      await handleMyPublished(chatId, messageId)
      return
    }

    if (data === 'published_search_clear') {
      await answerCallbackQuery(callbackQueryId)
      await setPublishedCtx(chatId, { q: undefined, cursorStack: [null], nextCursor: null })
      await handleMyPublished(chatId, messageId)
      return
    }

    if (data === 'published_next') {
      await answerCallbackQuery(callbackQueryId)
      const userState = await getUserState(chatId)
      const pubCtx = getPublishedCtx(userState)
      const stack = pubCtx.cursorStack && pubCtx.cursorStack.length ? pubCtx.cursorStack : [null]
      if (pubCtx.nextCursor) {
        stack.push(pubCtx.nextCursor)
        await setPublishedCtx(chatId, { q: pubCtx.q, cursorStack: stack, nextCursor: null })
      }
      await handleMyPublished(chatId, messageId)
      return
    }

    if (data === 'published_prev') {
      await answerCallbackQuery(callbackQueryId)
      const userState = await getUserState(chatId)
      const pubCtx = getPublishedCtx(userState)
      const stack = pubCtx.cursorStack && pubCtx.cursorStack.length ? pubCtx.cursorStack : [null]
      if (stack.length > 1) {
        stack.pop()
        await setPublishedCtx(chatId, { q: pubCtx.q, cursorStack: stack, nextCursor: null })
      }
      await handleMyPublished(chatId, messageId)
      return
    }

    if (data === 'my_drafts') {
      await answerCallbackQuery(callbackQueryId)
      await handleMyDrafts(chatId, messageId)
      return
    }

    if (data === 'my_videos') {
      // ✅ 防止连续点击：用户级点击锁（4秒）
      const userState = await getUserState(chatId)
      const now = Date.now()
      const ctx = (userState as any)?.context || {}
      const uiLocks = ctx.ui_locks || {}
      const until = Number(uiLocks.my_videos_until || 0)
      if (until && until > now) {
        await answerCallbackQuery(callbackQueryId, '⏳ 正在打开「我的视频」…')
        return
      }

      await updateUserState(chatId, {
        context: {
          ...ctx,
          ui_locks: {
            ...uiLocks,
            my_videos_until: now + 4000
          }
        }
      })

      await answerCallbackQuery(callbackQueryId, '⏳ 加载中…')

      // 尝试把“📹 我的视频”按钮替换为 loading（不改文本）
      try {
        const { getWelcomeKeyboard } = await import('../keyboards.ts')
        const kb = getWelcomeKeyboard()
        if (kb?.inline_keyboard?.length) {
          const cloned = JSON.parse(JSON.stringify(kb))
          // 第二行第一个按钮通常是“📹 我的视频”
          if (cloned.inline_keyboard?.[1]?.[0]?.callback_data === 'my_videos') {
            cloned.inline_keyboard[1][0] = { text: '⏳ 加载中…', callback_data: 'noop' }
          }
          await editMessageReplyMarkup(chatId, messageId, cloned)
        }
      } catch (e) {
        console.warn('[my_videos] update keyboard to loading failed:', e)
      }

      let result: any = null
      try {
        result = await handleMyVideosEdit(chatId, messageId)
      } finally {
        // 释放锁
        try {
          const latest = await getUserState(chatId)
          const latestCtx = (latest as any)?.context || {}
          const latestLocks = latestCtx.ui_locks || {}
          await updateUserState(chatId, {
            context: {
              ...latestCtx,
              ui_locks: {
                ...latestLocks,
                my_videos_until: 0
              }
            }
          })
        } catch (e) {
          console.warn('[my_videos] unlock failed:', e)
        }
      }

      // 如果这次没有成功编辑当前消息（例如编辑失败只能 send 新消息），就把按钮恢复，避免旧消息一直“加载中”
      try {
        if (!result || result.mode !== 'edited' || result.messageId !== messageId) {
          const { getWelcomeKeyboard } = await import('../keyboards.ts')
          const kb = getWelcomeKeyboard()
          if (kb) {
            await editMessageReplyMarkup(chatId, messageId, kb)
          }
        }
      } catch (e) {
        console.warn('[my_videos] restore keyboard failed:', e)
      }
      return
    }

    if (data.startsWith('delete_video_')) {
      const videoId = data.replace('delete_video_', '')
      await handleDeleteVideo(chatId, messageId, videoId, callbackQueryId)
      return
    }

    if (data.startsWith('view_video_')) {
      const videoId = data.replace('view_video_', '')
      await answerCallbackQuery(callbackQueryId)
      await handleViewVideo(chatId, messageId, videoId)
      return
    }

    if (data.startsWith('edit_draft_')) {
      console.log('[handleCallback] 处理 edit_draft_')
      const draftId = data.replace('edit_draft_', '')
      console.log('[handleCallback] draftId:', draftId)

      console.log('[handleCallback] 查询草稿...')
      const { data: draft, error: draftError } = await supabase
        .from('videos')
        .select('*')
        .eq('id', draftId)
        .eq('tg_user_id', chatId)
        .single()

      console.log('[handleCallback] 查询结果:', { hasDraft: !!draft, error: draftError?.message })

      if (draftError) {
        console.error('[handleCallback] 查询草稿失败:', draftError)
        await answerCallbackQuery(callbackQueryId, '查询失败: ' + draftError.message)
        return
      }

      if (!draft) {
        console.log('[handleCallback] 草稿不存在')
        await answerCallbackQuery(callbackQueryId, '草稿不存在或已删除')
        return
      }

      console.log('[handleCallback] 回复callback...')
      await answerCallbackQuery(callbackQueryId)

      console.log('[handleCallback] 生成编辑菜单文本...')
      const menuText = getEditMenuText(draft)
      console.log('[handleCallback] 菜单文本长度:', menuText.length)

      console.log('[handleCallback] 生成编辑键盘...')
      const keyboard = getEditKeyboard(draft)
      console.log('[handleCallback] 键盘按钮数:', keyboard.inline_keyboard.length)

      console.log('[handleCallback] 编辑消息...')
      const editResult = await editMessage(chatId, messageId, menuText, { reply_markup: keyboard })
      console.log('[handleCallback] 编辑消息结果:', {
        ok: editResult.ok,
        error: editResult.description
      })

      if (!editResult.ok) {
        console.error('[handleCallback] 编辑消息失败，尝试发送新消息...')
        const sendResult = await sendMessage(chatId, menuText, { reply_markup: keyboard })
        console.log('[handleCallback] 发送新消息结果:', { ok: sendResult.ok })
        if (sendResult.ok) {
          messageId = sendResult.result.message_id
        }
      }

      console.log('[handleCallback] 更新用户状态...')
      await updateUserState(chatId, {
        state: 'idle',
        draft_video_id: draft.id,
        current_message_id: messageId
      })

      console.log('[handleCallback] edit_draft 处理完成')
      return
    }

    // 继续编辑草稿（旧的回调，保持兼容）
    if (data.startsWith('continue_draft_')) {
      const draftId = data.replace('continue_draft_', '')

      const { data: draft } = await supabase
        .from('videos')
        .select('*')
        .eq('id', draftId)
        .eq('tg_user_id', chatId)
        .single()

      if (!draft) {
        await answerCallbackQuery(callbackQueryId, '草稿不存在或已删除')
        return
      }

      await answerCallbackQuery(callbackQueryId)

      const menuResult = await sendMessage(chatId, getEditMenuText(draft), {
        reply_markup: getEditKeyboard(draft)
      })
      const newMessageId = menuResult.ok ? menuResult.result.message_id : null

      await updateUserState(chatId, {
        state: 'idle',
        draft_video_id: draft.id,
        current_message_id: newMessageId
      })
      return
    }

    // ✅ “视频已就绪”菜单：带 videoId 的回调（支持并发多条菜单）
    const parsed = parseVideoAction(data)
    if (parsed) {
      const { action, videoId } = parsed

      const { data: video } = await supabase
        .from('videos')
        .select('*')
        .eq('id', videoId)
        .eq('tg_user_id', chatId)
        .single()

      if (!video) {
        await answerCallbackQuery(callbackQueryId, '视频不存在或无权限')
        return
      }

      switch (action) {
        case 'edit_description': {
          await updateUserState(chatId, {
            state: 'waiting_description',
            draft_video_id: videoId,
            current_message_id: messageId
          })
          await answerCallbackQuery(callbackQueryId)
          await editMessage(
            chatId,
            messageId,
            '✏️ 请发送视频描述\n\n💡 提示：发送 /cancel 可取消编辑',
            {
              reply_markup: {
                inline_keyboard: [[{ text: '← 返回', callback_data: `cancel_edit:${videoId}` }]]
              }
            }
          )
          return
        }
        case 'edit_tags': {
          await updateUserState(chatId, {
            state: 'waiting_tags',
            draft_video_id: videoId,
            current_message_id: messageId
          })
          await answerCallbackQuery(callbackQueryId)
          await editMessage(
            chatId,
            messageId,
            '🏷️ 请发送标签\n\n格式：多个标签用空格分隔\n例如：搞笑 日常 生活\n\n💡 发送 /cancel 可取消编辑',
            {
              reply_markup: {
                inline_keyboard: [[{ text: '← 返回', callback_data: `cancel_edit:${videoId}` }]]
              }
            }
          )
          return
        }
        case 'edit_location': {
          await updateUserState(chatId, {
            state: 'waiting_location',
            draft_video_id: videoId,
            current_message_id: messageId
          })
          await answerCallbackQuery(callbackQueryId)
          await editMessage(
            chatId,
            messageId,
            '📍 <b>设置位置</b>\n\n请发送位置信息\n点击输入框左侧 📎 → 位置',
            {
              reply_markup: {
                inline_keyboard: [[{ text: '← 返回', callback_data: `cancel_edit:${videoId}` }]]
              }
            }
          )
          return
        }
        case 'toggle_privacy': {
          await supabase.from('videos').update({ is_private: !video.is_private }).eq('id', video.id)
          await answerCallbackQuery(
            callbackQueryId,
            !video.is_private ? '已设置为私密' : '已设置为公开'
          )
          const { data: updatedVideo } = await supabase
            .from('videos')
            .select('*')
            .eq('id', video.id)
            .single()
          await editMessage(chatId, messageId, getEditMenuText(updatedVideo), {
            reply_markup: getEditKeyboard(updatedVideo)
          })
          return
        }
        case 'toggle_adult': {
          await supabase.from('videos').update({ is_adult: !video.is_adult }).eq('id', video.id)
          await answerCallbackQuery(
            callbackQueryId,
            !video.is_adult ? '已标记为成人内容，请确保未涉及任何未成年人。' : '已取消成人内容标记'
          )
          const { data: updatedVideo } = await supabase
            .from('videos')
            .select('*')
            .eq('id', video.id)
            .single()
          await editMessage(chatId, messageId, getEditMenuText(updatedVideo), {
            reply_markup: getEditKeyboard(updatedVideo)
          })
          return
        }
        case 'toggle_sea': {
          await supabase.from('videos').update({ is_sea: !video.is_sea }).eq('id', video.id)
          await answerCallbackQuery(
            callbackQueryId,
            !video.is_sea ? '已标记为东南亚板块' : '已取消东南亚板块标记'
          )
          const { data: updatedVideo } = await supabase
            .from('videos')
            .select('*')
            .eq('id', video.id)
            .single()
          await editMessage(chatId, messageId, getEditMenuText(updatedVideo), {
            reply_markup: getEditKeyboard(updatedVideo)
          })
          return
        }
        case 'toggle_pin': {
          await answerCallbackQuery(callbackQueryId)
          const updated = await toggleVideoPin(video)
          await editMessage(chatId, messageId, getEditMenuText(updated), {
            reply_markup: getEditKeyboard(updated)
          })
          return
        }
        case 'publish': {
          await answerCallbackQuery(callbackQueryId)
          await publishVideo(chatId, messageId, videoId, notifyFollowersNewPost)
          return
        }
        case 'save_draft': {
          await answerCallbackQuery(callbackQueryId)
          await editMessage(
            chatId,
            messageId,
            '💾 <b>已保存为草稿</b>\n\n点击底部「📹 我的视频」继续编辑'
          )
          await updateUserState(chatId, {
            state: 'idle',
            draft_video_id: null,
            current_message_id: null
          })
          return
        }
        case 'cancel_edit': {
          await updateUserState(chatId, { state: 'idle' })
          await answerCallbackQuery(callbackQueryId, '✅ 已取消')
          const { data: refreshed } = await supabase
            .from('videos')
            .select('*')
            .eq('id', videoId)
            .single()
          if (refreshed) {
            await editMessage(chatId, messageId, getEditMenuText(refreshed), {
              reply_markup: getEditKeyboard(refreshed)
            })
          }
          return
        }
      }
    }

    // 兼容旧状态（可能来自早期菜单）
    const userState = await getUserState(chatId)

    if (!userState.draft_video_id) {
      await answerCallbackQuery(callbackQueryId, '会话已过期，请从 我的视频 里继续编辑')
      return
    }

    const { data: video } = await supabase
      .from('videos')
      .select('*')
      .eq('id', userState.draft_video_id)
      .single()

    if (!video) {
      await answerCallbackQuery(callbackQueryId, '视频不存在，请重新上传')
      return
    }

    switch (data) {
      case 'edit_description':
        await updateUserState(chatId, { state: 'waiting_description' })
        await answerCallbackQuery(callbackQueryId)
        await editMessage(
          chatId,
          messageId,
          '✏️ <b>编辑描述</b>\n\n' + '请输入视频描述（最多300字）\n' + '发送文字即可设置',
          {
            reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'cancel_edit' }]] }
          }
        )
        break

      case 'edit_tags':
        await updateUserState(chatId, { state: 'waiting_tags' })
        await answerCallbackQuery(callbackQueryId)
        await editMessage(
          chatId,
          messageId,
          '🏷️ <b>编辑标签</b>\n\n' +
            '请输入标签，用空格分隔（3-5个）\n' +
            '例如: 突发新闻 吃瓜 东南亚',
          {
            reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'cancel_edit' }]] }
          }
        )
        break

      case 'edit_location':
        await updateUserState(chatId, { state: 'waiting_location' })
        await answerCallbackQuery(callbackQueryId)
        await editMessage(
          chatId,
          messageId,
          '📍 <b>设置位置</b>\n\n' + '请发送位置信息\n' + '点击输入框左侧 📎 → 位置',
          {
            reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'cancel_edit' }]] }
          }
        )
        break

      case 'toggle_privacy': {
        await supabase.from('videos').update({ is_private: !video.is_private }).eq('id', video.id)
        await answerCallbackQuery(
          callbackQueryId,
          !video.is_private ? '已设置为私密' : '已设置为公开'
        )
        const { data: updatedVideo } = await supabase
          .from('videos')
          .select('*')
          .eq('id', video.id)
          .single()
        await editMessage(chatId, messageId, getEditMenuText(updatedVideo), {
          reply_markup: getEditKeyboard(updatedVideo)
        })
        break
      }

      case 'toggle_adult': {
        await supabase.from('videos').update({ is_adult: !video.is_adult }).eq('id', video.id)
        await answerCallbackQuery(
          callbackQueryId,
          !video.is_adult ? '已标记为成人内容，请确保未涉及任何未成年人。' : '已取消成人内容标记'
        )
        const { data: updatedVideo } = await supabase
          .from('videos')
          .select('*')
          .eq('id', video.id)
          .single()
        await editMessage(chatId, messageId, getEditMenuText(updatedVideo), {
          reply_markup: getEditKeyboard(updatedVideo)
        })
        break
      }

      case 'toggle_pin': {
        await answerCallbackQuery(callbackQueryId)
        const videoAfterToggle = await toggleVideoPin(video)
        await editMessage(chatId, messageId, getEditMenuText(videoAfterToggle), {
          reply_markup: getEditKeyboard(videoAfterToggle)
        })
        break
      }

      case 'publish':
        await answerCallbackQuery(callbackQueryId)
        await publishVideo(chatId, messageId, video.id, notifyFollowersNewPost)
        break

      case 'save_draft':
        await answerCallbackQuery(callbackQueryId)
        await editMessage(
          chatId,
          messageId,
          '💾 <b>已保存为草稿</b>\n\n' + '点击底部「📹 我的视频」继续编辑'
        )
        await updateUserState(chatId, {
          state: 'idle',
          draft_video_id: null,
          current_message_id: null
        })
        break

      case 'cancel_edit':
        await updateUserState(chatId, { state: 'idle' })
        await answerCallbackQuery(callbackQueryId, '✅ 已取消')
        await editMessage(chatId, messageId, getEditMenuText(video), {
          reply_markup: getEditKeyboard(video)
        })
        break

      case 'back_my_drafts':
        await answerCallbackQuery(callbackQueryId)
        await handleMyDrafts(chatId, messageId)
        break
    }
  } catch (error) {
    console.error('[handleCallback] 处理回调失败:', error)
    console.error(
      '[handleCallback] 错误堆栈:',
      error instanceof Error ? error.stack : String(error)
    )
    console.error('[handleCallback] data:', data)
    try {
      await answerCallbackQuery(
        callbackQueryId,
        '操作失败: ' + (error instanceof Error ? error.message : String(error))
      )
    } catch (answerError) {
      console.error('[handleCallback] 回复callback也失败了:', answerError)
    }
  }
}
