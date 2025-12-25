import { supabase } from '../supabaseClient.ts'
import { editMessage, sendMessage } from '../telegram.ts'
import { getPersistentKeyboard } from '../keyboards.ts'

// 处理"使用说明"
export async function handleHelp(chatId: number, messageId?: number) {
  const text =
    `📖 <b>使用说明</b>\n\n` +
    `<b>1. 上传视频</b>\n` +
    `• 直接发送视频文件给机器人\n` +
    `• 转发其他频道的视频给机器人\n` +
    `• 机器人会自动处理并保存\n\n` +
    `<b>2. 分享视频</b>\n` +
    `• 在任何聊天窗口输入 <code>@tg_douyin_bot video_</code> 即可搜索并分享您的视频\n` +
    `• 也可以在视频详情页点击分享按钮\n\n` +
    `<b>3. 邀请奖励</b>\n` +
    `• 点击「个人中心」-「获取邀请链接」\n` +
    `• 邀请好友使用机器人可获得成人内容解锁时长`

  const keyboard = {
    inline_keyboard: [[{ text: '⬅️ 返回个人中心', callback_data: 'user_profile' }]]
  }

  if (messageId) {
    await editMessage(chatId, messageId, text, { reply_markup: keyboard })
  } else {
    await sendMessage(chatId, text, { reply_markup: keyboard })
  }
}

// 处理"个人中心"
interface ProfileOptions {
  forceNew?: boolean // 强制新发一条消息（不编辑旧消息）
}

export async function handleUserProfile(
  chatId: number,
  messageId?: number,
  options?: ProfileOptions
) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('numeric_id, invite_success_count, adult_unlock_until, adult_permanent_unlock')
      .eq('tg_user_id', chatId)
      .single()

    if (!profile) {
      await sendMessage(chatId, '❌ 获取用户信息失败')
      return
    }

    let statusText = '🔒 未解锁'
    if (profile.adult_permanent_unlock) {
      statusText = '♾️ 永久解锁'
    } else if (profile.adult_unlock_until && new Date(profile.adult_unlock_until) > new Date()) {
      const until = new Date(profile.adult_unlock_until)
      const now = new Date()
      const diffHours = Math.ceil((until.getTime() - now.getTime()) / (1000 * 3600))
      statusText = `🔓 已解锁 (剩余 ${diffHours} 小时)`
    }

    const text =
      `👤 <b>个人中心</b>\n\n` +
      `🆔 <b>用户ID：</b> <code>${profile.numeric_id}</code>\n` +
      `🔞 <b>成人权限：</b> ${statusText}\n` +
      `👥 <b>累计邀请：</b> ${profile.invite_success_count || 0} 人\n\n` +
      `<i>请选择下方操作：</i>`

    const keyboard = {
      inline_keyboard: [
        [{ text: '🔞 获取邀请链接', callback_data: 'profile_invite_unlock' }],
        [{ text: '📖 使用说明', callback_data: 'profile_help' }],
        [
          { text: '🔔 通知设置', callback_data: 'profile_settings_notify' },
          { text: '⚙️ 隐私设置', callback_data: 'profile_settings_privacy' }
        ],
        [{ text: '⬅️ 返回首页', callback_data: 'back_home' }]
      ]
    }

    if (messageId && !options?.forceNew) {
      await editMessage(chatId, messageId, text, { reply_markup: keyboard })
    } else {
      // 如果没有传入 messageId，尝试获取 userState 里的 dashboard_message_id
      const { getUserState, updateUserState } = await import('../state.ts')
      const userState = await getUserState(chatId)
      const dashId = (userState as any)?.dashboard_message_id

      if (!options?.forceNew && dashId) {
        const edited = await editMessage(chatId, dashId, text, { reply_markup: keyboard })
        if (edited?.ok) return
      }

      const sent = await sendMessage(chatId, text, { reply_markup: keyboard })
      if (sent?.ok) {
        await updateUserState(chatId, { dashboard_message_id: sent.result.message_id })
      }
    }
  } catch (error) {
    console.error('handleUserProfile error:', error)
    await sendMessage(chatId, '❌ 系统错误，请稍后重试')
  }
}

// 处理"邀请解锁"
export async function handleInviteUnlock(chatId: number, messageId?: number) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('numeric_id, invite_success_count, adult_unlock_until, adult_permanent_unlock')
      .eq('tg_user_id', chatId)
      .single()

    const inviteLink = `https://t.me/tg_douyin_bot?start=${profile?.numeric_id || ''}`
    const count = profile?.invite_success_count || 0

    let statusText = '🔒 未解锁'
    if (profile?.adult_permanent_unlock) {
      statusText = '♾️ 永久解锁'
    } else if (profile?.adult_unlock_until && new Date(profile.adult_unlock_until) > new Date()) {
      const until = new Date(profile.adult_unlock_until)
      const now = new Date()
      const diffHours = Math.ceil((until.getTime() - now.getTime()) / (1000 * 3600))
      statusText = `🔓 已解锁 (剩余 ${diffHours} 小时)`
    }

    const text =
      `🔞 <b>解锁无限刷</b>\n\n` +
      `当前状态：${statusText}\n` +
      `已邀请人数：${count} 人\n\n` +
      `<b>专属邀请链接：</b>\n` +
      `${inviteLink}\n` +
      `(点击上方链接复制)\n\n` +
      `<b>邀请好友折现金即将上线</b>\n\n` +
      `<i>💡 好友通过您的链接启动机器人即算邀请成功</i>\n\n`

    const keyboard = {
      inline_keyboard: [
        [{ text: '📤 分享给好友', switch_inline_query: '' }],
        [{ text: '⬅️ 返回首页', callback_data: 'back_home' }]
      ]
    }

    if (messageId) {
      await editMessage(chatId, messageId, text, { reply_markup: keyboard })
    } else {
      await sendMessage(chatId, text, { reply_markup: keyboard })
    }
  } catch (error) {
    console.error('handleInviteUnlock error:', error)
    await sendMessage(chatId, '❌ 获取邀请信息失败，请稍后重试')
  }
}

// 🎯 处理隐私设置
export async function handlePrivacySettings(chatId: number, messageId?: number) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('show_collect, show_like, show_tg_username')
      .eq('tg_user_id', chatId)
      .single()

    if (!profile) {
      if (messageId) {
        await editMessage(chatId, messageId, '❌ 获取隐私设置失败')
      } else {
        await sendMessage(chatId, '❌ 获取隐私设置失败', {
          reply_markup: getPersistentKeyboard()
        })
      }
      return
    }

    const showCollect = profile.show_collect !== false // 默认公开
    const showLike = profile.show_like !== false // 默认公开
    const showTgUsername = profile.show_tg_username === true // 默认隐藏

    const lines = [
      '⚙️ <b>隐私设置</b>',
      '',
      '控制您的个人信息展示',
      '',
      `${showCollect ? '🌍' : '🔒'} 收藏列表：${showCollect ? '公开' : '私密'}`,
      `${showLike ? '🌍' : '🔒'} 喜欢列表：${showLike ? '公开' : '私密'}`,
      `${showTgUsername ? '✅' : '❌'} Telegram 用户名：${showTgUsername ? '显示' : '隐藏'}`,
      '',
      '💡 私密后，其他用户无法查看对应列表'
    ]

    const keyboard = [
      [{ text: showCollect ? '🌍 收藏公开' : '🔒 收藏私密', callback_data: 'toggle_show_collect' }],
      [{ text: showLike ? '🌍 喜欢公开' : '🔒 喜欢私密', callback_data: 'toggle_show_like' }],
      [
        {
          text: showTgUsername ? '✅ 显示Tg用户名' : '❌ 隐藏Tg用户名',
          callback_data: 'toggle_show_tg_username'
        }
      ],
      [{ text: '⬅️ 返回个人中心', callback_data: 'user_profile' }]
    ]

    if (messageId) {
      await editMessage(chatId, messageId, lines.join('\n'), {
        reply_markup: { inline_keyboard: keyboard }
      })
    } else {
      await sendMessage(chatId, lines.join('\n'), {
        reply_markup: { inline_keyboard: keyboard }
      })
    }
  } catch (error) {
    console.error('获取隐私设置错误:', error)
    if (messageId) {
      await editMessage(chatId, messageId, '❌ 获取隐私设置失败')
    } else {
      await sendMessage(chatId, '❌ 获取隐私设置失败', {
        reply_markup: getPersistentKeyboard()
      })
    }
  }
}

// 🎯 处理隐私设置（编辑消息版本）
export async function handlePrivacySettingsEdit(chatId: number, messageId: number) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('show_collect, show_like, show_tg_username')
      .eq('tg_user_id', chatId)
      .single()

    if (!profile) {
      await editMessage(chatId, messageId, '❌ 获取隐私设置失败')
      return
    }

    const showCollect = profile.show_collect !== false
    const showLike = profile.show_like !== false
    const showTgUsername = profile.show_tg_username === true

    const lines = [
      '⚙️ <b>隐私设置</b>',
      '',
      '控制您的个人信息展示',
      '',
      `${showCollect ? '🌍' : '🔒'} 收藏列表：${showCollect ? '公开' : '私密'}`,
      `${showLike ? '🌍' : '🔒'} 喜欢列表：${showLike ? '公开' : '私密'}`,
      `${showTgUsername ? '✅' : '❌'} Telegram 用户名：${showTgUsername ? '显示' : '隐藏'}`,
      '',
      '💡 私密后，其他用户无法查看对应列表'
    ]

    const keyboard = [
      [{ text: showCollect ? '🌍 收藏公开' : '🔒 收藏私密', callback_data: 'toggle_show_collect' }],
      [{ text: showLike ? '🌍 喜欢公开' : '🔒 喜欢私密', callback_data: 'toggle_show_like' }],
      [
        {
          text: showTgUsername ? '✅ 显示Tg用户名' : '❌ 隐藏Tg用户名',
          callback_data: 'toggle_show_tg_username'
        }
      ],
      [{ text: '⬅️ 返回个人中心', callback_data: 'user_profile' }]
    ]

    await editMessage(chatId, messageId, lines.join('\n'), {
      reply_markup: { inline_keyboard: keyboard }
    })
  } catch (error) {
    console.error('获取隐私设置错误:', error)
    await editMessage(chatId, messageId, '❌ 获取隐私设置失败')
  }
}
