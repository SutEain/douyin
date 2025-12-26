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
    `<b>3. 邀请赚钱</b>\n` +
    `• 点击「个人中心」-「邀请赚钱」\n` +
    `• 邀请好友可获得 10 抖币/人，并解锁成人专区权限`

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
      .select(
        'numeric_id, invite_success_count, adult_unlock_until, adult_permanent_unlock, live_status, balance_coins'
      )
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
      `💰 <b>抖币余额：</b> <code>${Math.floor(profile.balance_coins || 0)}</code>\n` +
      `🔞 <b>成人权限：</b> ${statusText}\n` +
      `👥 <b>累计邀请：</b> ${profile.invite_success_count || 0} 人\n\n` +
      `<i>请选择下方操作：</i>`

    // 根据直播状态显示不同按钮
    let liveButton = { text: '🎥 申请开播', callback_data: 'profile_apply_live' }
    if (profile.live_status === 1) {
      liveButton = { text: '⏳ 直播审核中', callback_data: 'noop' }
    } else if (profile.live_status === 2) {
      liveButton = { text: '🎥 我要开播', callback_data: 'profile_start_live' }
    } else if (profile.live_status === 3) {
      liveButton = { text: '❌ 申请被拒(重申)', callback_data: 'profile_apply_live' }
    }

    const keyboard = {
      inline_keyboard: [
        [
          { text: '💰 我的钱包', callback_data: 'profile_wallet' },
          { text: '💸 邀请赚钱', callback_data: 'profile_invite_unlock' }
        ],
        [liveButton],
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
      `💸 <b>邀请好友赚钱</b>\n\n` +
      `每邀请 1 位新好友，您将获得：\n` +
      `💰 <b>10 抖币</b> (直接入账)\n` +
      `🔞 <b>成人专区解锁奖励：</b>\n` +
      `• 邀请 1 人：解锁 24 小时\n` +
      `• 邀请 2 人：解锁 3 天\n` +
      `• 邀请 3 人：<b>永久解锁</b>\n\n` +
      `--- 当前进度 ---\n` +
      `当前状态：${statusText}\n` +
      `已邀请人数：${count} 人\n\n` +
      `<b>您的专属邀请链接：</b>\n` +
      `${inviteLink}\n\n` +
      `<i>💡 好友通过您的链接启动机器人即算邀请成功。</i>`

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

// 🎯 处理"我要开播"
export async function handleStartLive(chatId: number, messageId?: number) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, numeric_id, nickname, username')
      .eq('tg_user_id', chatId)
      .single()

    if (!profile) {
      await sendMessage(chatId, '❌ 获取用户信息失败')
      return
    }

    // 调用 live-handler Edge Function 获取推流码
    const functionUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/live-handler`
    const resp = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        action: 'start',
        userId: profile.id,
        title: `${profile.nickname || profile.username || profile.numeric_id} 的直播间`
      })
    })

    const data = await resp.json()
    if (data.error) throw new Error(data.error)
    if (!data.rtmp_url || !data.stream_key) {
      throw new Error('服务器分配失败，请联系管理员检查直播节点配置')
    }

    const text =
      `🎥 <b>直播准备就绪！</b>\n\n` +
      `请将以下参数填入您的推流软件（如 OBS 或 Larix）：\n\n` +
      `📍 <b>服务器地址 (URL)：</b>\n<code>${data.rtmp_url}</code>\n\n` +
      `🔑 <b>推流密钥 (Stream Key)：</b>\n<code>${data.stream_key}</code>\n\n` +
      `⛔ <b>安全警告：</b>\n请勿将您的<b>服务器地址</b>和<b>推流密钥</b>泄露给任何人！\n一旦泄露，他人即可冒充您进行直播，造成账号风险。\n\n` +
      `<i>💡 建议使用 Larix Broadcaster 手机开播，体验更佳。</i>`

    const keyboard = {
      inline_keyboard: [
        [{ text: '🔄 重置/刷新推流密钥', callback_data: 'profile_refresh_live_key' }],
        [{ text: '⬅️ 返回个人中心', callback_data: 'user_profile' }]
      ]
    }

    if (messageId) {
      await editMessage(chatId, messageId, text, { reply_markup: keyboard })
    } else {
      await sendMessage(chatId, text, { reply_markup: keyboard })
    }
  } catch (error) {
    console.error('handleStartLive error:', error)
    await sendMessage(chatId, `❌ 开启直播失败: ${error.message}`)
  }
}

// 🎯 处理"申请开播"
export async function handleApplyLive(chatId: number, messageId?: number) {
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ live_status: 1 }) // 设为申请中
      .eq('tg_user_id', chatId)

    if (error) throw error

    const text =
      `✅ <b>申请提交成功！</b>\n\n` +
      `您的直播申请已进入审核队列，管理员将在 24 小时内完成审核。\n\n` +
      `💡 审核通过后，您将在「个人中心」看到「我要开播」按钮。`

    const keyboard = {
      inline_keyboard: [[{ text: '⬅️ 返回个人中心', callback_data: 'user_profile' }]]
    }

    if (messageId) {
      await editMessage(chatId, messageId, text, { reply_markup: keyboard })
    } else {
      await sendMessage(chatId, text, { reply_markup: keyboard })
    }
  } catch (error) {
    console.error('handleApplyLive error:', error)
    await sendMessage(chatId, '❌ 申请提交失败，请稍后重试')
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

// 🎯 处理"我的钱包"
export async function handleWallet(chatId: number, messageId?: number) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('balance_coins')
      .eq('tg_user_id', chatId)
      .single()

    const balance = Math.floor(profile?.balance_coins || 0)
    const text =
      `💰 <b>我的钱包</b>\n\n` +
      `当前余额：<code>${balance}</code> 抖币\n\n` +
      `💡 抖币可用于直播间送礼、短视频打赏。\n` +
      `💡 收到礼物的收益可按比例提现（即将上线）。`

    const keyboard = {
      inline_keyboard: [
        [{ text: '💳 立即充值', callback_data: 'profile_recharge' }],
        [{ text: '📜 账单记录', callback_data: 'profile_transactions' }],
        [{ text: '⬅️ 返回个人中心', callback_data: 'user_profile' }]
      ]
    }

    if (messageId) {
      await editMessage(chatId, messageId, text, { reply_markup: keyboard })
    } else {
      await sendMessage(chatId, text, { reply_markup: keyboard })
    }
  } catch (error) {
    console.error('handleWallet error:', error)
    await sendMessage(chatId, '❌ 获取钱包信息失败')
  }
}

// 🎯 处理"充值"
export async function handleRecharge(chatId: number, messageId?: number) {
  const text =
    `💳 <b>抖币充值</b>\n\n` +
    `请选择充值金额：\n\n` +
    `• 100 抖币 = 1.00 USDT\n` +
    `• 500 抖币 = 5.00 USDT\n` +
    `• 1000 抖币 = 10.00 USDT\n\n` +
    `💡 目前仅支持联系客服手动充值，请点击下方按钮联系客服。`

  const keyboard = {
    inline_keyboard: [
      [{ text: '🙋 联系客服充值', url: 'https://t.me/laidouyin' }],
      [{ text: '⬅️ 返回钱包', callback_data: 'profile_wallet' }]
    ]
  }

  if (messageId) {
    await editMessage(chatId, messageId, text, { reply_markup: keyboard })
  } else {
    await sendMessage(chatId, text, { reply_markup: keyboard })
  }
}

// 🎯 处理"账单记录"
export async function handleTransactions(chatId: number, messageId?: number) {
  try {
    // 1. 先获取用户 ID
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('tg_user_id', chatId)
      .single()

    if (!profile) throw new Error('User not found')

    // 2. 获取最近 10 条流水
    const { data: txs, error } = await supabase
      .from('coin_transactions')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) throw error

    let text = `📜 <b>最近 10 条账单记录</b>\n\n`
    if (!txs || txs.length === 0) {
      text += `<i>暂无记录</i>`
    } else {
      const typeMap: any = {
        recharge: '💳 充值',
        reward: '🎁 奖励',
        gift_out: '📤 送礼',
        gift_in: '📥 收到',
        withdraw: '💰 提现'
      }

      txs.forEach((t: any) => {
        const time = new Date(t.created_at).toLocaleString('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric'
        })
        const amount = t.amount > 0 ? `+${t.amount}` : `${t.amount}`
        text += `• [${time}] ${typeMap[t.type] || t.type}\n  金额：<code>${amount}</code> | 余额：<code>${t.balance_after}</code>\n`
        if (t.description) text += `  备注：${t.description}\n`
        text += `\n`
      })
    }

    const keyboard = {
      inline_keyboard: [[{ text: '⬅️ 返回钱包', callback_data: 'profile_wallet' }]]
    }

    if (messageId) {
      await editMessage(chatId, messageId, text, { reply_markup: keyboard })
    } else {
      await sendMessage(chatId, text, { reply_markup: keyboard })
    }
  } catch (error) {
    console.error('handleTransactions error:', error)
    await sendMessage(chatId, '❌ 获取账单失败')
  }
}
