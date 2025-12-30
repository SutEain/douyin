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
    `• 在任何聊天窗口输入 <code>@tg_douyin_bot 关键词</code> 即可搜索并分享视频\n` +
    `• 也可以在视频详情页点击分享按钮，自动复制搜索指令\n\n` +
    `<b>3. 邀请赚钱</b>\n` +
    `• 点击「个人中心」-「邀请赚钱」\n` +
    `• 邀请好友使用机器人可获得 10 抖币/人奖励`

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
        'numeric_id, invite_success_count, adult_unlock_until, adult_permanent_unlock, live_status, balance_coins, is_admin'
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

    let text =
      `👤 <b>个人中心</b>\n\n` +
      `🆔 <b>用户ID：</b> <code>${profile.numeric_id}</code>\n` +
      `💰 <b>抖币余额：</b> <code>${Math.floor(profile.balance_coins || 0)}</code>\n` +
      `🔞 <b>成人权限：</b> ${statusText}\n` +
      `👥 <b>累计邀请：</b> ${profile.invite_success_count || 0} 人\n\n`

    // 📊 管理员统计数据
    if (profile.is_admin) {
      try {
        // 统计打开小程序的用户数（有播放记录的）
        const { count, error: countError } = await supabase
          .from('watch_history')
          .select('user_id', { count: 'exact', head: true })

        // 注意：Supabase JS select('user_id', {count: 'exact'}) 可能不直接支持 DISTINCT count
        // 这里的 count 是记录总数。为了统计去重后的用户数，我们可能需要一个自定义 RPC 或近似值。
        // 但由于 watch_history 记录很多，直接 select 可能比较慢。
        // 我们可以用一个更简单的统计：profiles 总数，或者最近活跃用户。
        // 用户要求是：“统计到打开小程序有多少用户。应该可以统计有播放历史的 就算”

        const { data: userData } = await supabase.rpc('get_active_user_count')

        const activeCount = userData !== null && userData !== undefined ? userData : '查询中...'

        text +=
          `📊 <b>管理统计：</b>\n` + `📱 <b>累计活跃用户：</b> <code>${activeCount}</code> 人\n\n`
      } catch (e) {
        console.error('Admin stats fetch error:', e)
      }
    }

    text += `<i>请选择下方操作：</i>`

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
        [{ text: '💰 我的钱包', callback_data: 'profile_wallet' }],
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

// 处理"邀请赚钱" (原邀请解锁)
export async function handleInviteUnlock(chatId: number, messageId?: number) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('numeric_id, invite_success_count, balance_coins')
      .eq('tg_user_id', chatId)
      .single()

    const inviteLink = `https://t.me/tg_douyin_bot?start=${profile?.numeric_id || ''}`
    const count = profile?.invite_success_count || 0
    const balance = Math.floor(profile?.balance_coins || 0)

    const text =
      `💰 <b>【TG抖音-暴富邀请令】轻松赚 USDT！</b>\n\n` +
      `💌 <b>已邀请人数：</b> ${count} 人 👥\n` +
      `💵 <b>奖励余额：</b> ${balance} 抖币 💰\n\n` +
      `🔗 <b>专属邀请链接：</b>\n` +
      `👉 <code>${inviteLink}</code>\n` +
      `（点击一键复制，立刻分享赚钱）\n\n` +
      `🎁 <b>每邀请 1 人，奖励 20 抖币！</b>\n` +
      `（抖币可用于直播间打赏，作品赞赏，兑换 USDT）\n\n` +
      `💡 <b>温馨提示：</b>\n` +
      `✨ 邀请成功自动发放至抖音账户 🎯\n` +
      `✨ 满 10U 即可提现 ✅\n\n` +
      `⚠️ <b>风控提示：</b>\n` +
      `❌ 严禁刷量/虚假用户，系统自动永久封禁！\n\n` +
      `🔥 <b>速速邀请好友，一起躺赚 USDT 吧！ 🎉</b>`

    const keyboard = {
      inline_keyboard: [
        [{ text: '📤 立即分享赚钱', switch_inline_query: '' }],
        [{ text: '⬅️ 返回首页', callback_data: 'back_home' }]
      ]
    }

    const options = {
      reply_markup: keyboard,
      disable_web_page_preview: true,
      parse_mode: 'HTML'
    }

    if (messageId) {
      await editMessage(chatId, messageId, text, options)
    } else {
      await sendMessage(chatId, text, options)
    }
  } catch (error) {
    console.error('handleInviteUnlock error:', error)
    await sendMessage(chatId, '❌ 获取邀请信息失败，请稍后重试')
  }
}

// 🎯 处理"我要开播"
export async function handleStartLive(chatId: number, messageId?: number, title?: string) {
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
        title: title || `${profile.nickname || profile.username || profile.numeric_id} 的直播间`
      })
    })

    const data = await resp.json()
    if (data.error) throw new Error(data.error)
    if (!data.rtmp_url || !data.stream_key) {
      throw new Error('服务器分配失败，请联系管理员检查直播节点配置')
    }

    const text =
      `🎥 <b>直播准备就绪！</b>\n\n` +
      `<b>直播标题：</b> ${title || profile.nickname || profile.username || profile.numeric_id}\n\n` +
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

// 🎯 处理"设置直播标题"
export async function handleAskLiveTitle(chatId: number, messageId?: number) {
  try {
    const { updateUserState } = await import('../state.ts')
    await updateUserState(chatId, {
      state: 'waiting_live_title',
      current_message_id: messageId
    })

    const text =
      `🎬 <b>设置直播间标题</b>\n\n` +
      `请输入您的直播间标题：\n\n` +
      `💡 好的标题能吸引更多观众哦！\n` +
      `💡 直接发送文字即可设置标题并开播\n\n` +
      `发送 /cancel 可取消操作。`

    const keyboard = {
      inline_keyboard: [[{ text: '⬅️ 取消并返回', callback_data: 'user_profile' }]]
    }

    if (messageId) {
      await editMessage(chatId, messageId, text, { reply_markup: keyboard })
    } else {
      await sendMessage(chatId, text, { reply_markup: keyboard })
    }
  } catch (error) {
    console.error('handleAskLiveTitle error:', error)
    await sendMessage(chatId, '❌ 系统错误，请稍后重试')
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
      `💡 审核通过后，您将在「个人中心」看到「我要开播」按钮。\n\n` +
      `🗣 <b>联系 <a href="tg://resolve?domain=Edison521">@Edison521</a> 申请通过</b>`

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
      `💡 收到礼物/打赏/邀请奖励的收益可按比例提现。`

    const keyboard = {
      inline_keyboard: [
        [{ text: '💳 立即充值', callback_data: 'profile_recharge' }],
        [{ text: '💰 抖币提现', callback_data: 'profile_withdraw' }],
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
  try {
    // 1. 先检查该用户是否有待支付的订单
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('tg_user_id', chatId)
      .single()

    if (profile) {
      const { data: pendingOrder } = await supabase
        .from('recharge_orders')
        .select('*')
        .eq('user_id', profile.id)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (pendingOrder) {
        // 如果有待支付订单，直接显示该订单信息
        const expiresAt = new Date(pendingOrder.expires_at)
        // 转换为北京时间显示 (UTC+8)
        const beijingTime = new Date(expiresAt.getTime() + 8 * 60 * 60 * 1000)
        const timeStr = `${beijingTime.getUTCHours().toString().padStart(2, '0')}:${beijingTime.getUTCMinutes().toString().padStart(2, '0')}`

        const coins = (pendingOrder.base_amount || 0) * 100
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${pendingOrder.trc20_address}`

        const text =
          `<a href="${qrUrl}">&#8205;</a>` +
          `⏳ <b>您有一个待支付的充值订单</b>\n\n` +
          `🔢 <b>订单编号：</b> <code>${pendingOrder.order_no || '-'}</code>\n` +
          `💰 <b>支付金额：</b> <code>${Number(pendingOrder.total_amount).toFixed(2)}</code> USDT\n` +
          `💎 <b>预计到账：</b> <code>${coins.toLocaleString()}</code> 抖币\n` +
          `📊 <b>充值比例：</b> 1 USDT = 100 抖币\n\n` +
          `📍 <b>收款地址 (TRC20)：</b>\n<code>${pendingOrder.trc20_address}</code>\n\n` +
          `⏰ <b>有效期：</b> 30 分钟 (请在北京时间 ${timeStr} 前完成支付)\n\n` +
          `⚠️ <b>请务必支付精确金额 (含尾数)，否则无法自动到账！</b>\n\n` +
          `<i>💡 支付完成后，请等待管理员确认。您可以在「资金流水」中查看进度。</i>`

        const keyboard = {
          inline_keyboard: [
            [{ text: '✅ 我已完成支付', callback_data: 'profile_wallet' }],
            [{ text: '❌ 取消订单', callback_data: `recharge_cancel:${pendingOrder.id}` }],
            [{ text: '⬅️ 返回钱包', callback_data: 'profile_wallet' }]
          ]
        }

        const options = { reply_markup: keyboard, disable_web_page_preview: false }
        if (messageId) {
          await editMessage(chatId, messageId, text, options)
        } else {
          await sendMessage(chatId, text, options)
        }
        return
      }
    }

    const text =
      `💳 <b>抖币充值</b>\n\n` +
      `请选择充值金额 (USDT-TRC20)：\n` +
      `<i>💡 汇率：1 USDT = 100 抖币</i>\n\n` +
      `• 10U  (1,000 抖币)\n` +
      `• 20U  (2,000 抖币)\n` +
      `• 50U  (5,000 抖币)\n` +
      `• 100U (10,000 抖币)\n\n` +
      `请点击下方按钮下单：`

    const amounts = [10, 20, 50, 100, 200, 500, 1000, 2000]
    const inline_keyboard: any[][] = []

    for (let i = 0; i < amounts.length; i += 2) {
      const row = [{ text: `${amounts[i]} USDT`, callback_data: `recharge_order:${amounts[i]}` }]
      if (i + 1 < amounts.length) {
        row.push({
          text: `${amounts[i + 1]} USDT`,
          callback_data: `recharge_order:${amounts[i + 1]}`
        })
      }
      inline_keyboard.push(row)
    }

    inline_keyboard.push([{ text: '⬅️ 返回钱包', callback_data: 'profile_wallet' }])

    const keyboard = { inline_keyboard }

    if (messageId) {
      await editMessage(chatId, messageId, text, { reply_markup: keyboard })
    } else {
      await sendMessage(chatId, text, { reply_markup: keyboard })
    }
  } catch (error) {
    console.error('handleRecharge error:', error)
    await sendMessage(chatId, '❌ 获取充值信息失败')
  }
}

// 🎯 处理创建充值订单
export async function handleCreateRechargeOrder(chatId: number, messageId: number, amount: number) {
  try {
    // 1. 获取用户信息
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('tg_user_id', chatId)
      .single()

    if (!profile) throw new Error('User not found')

    // 2. 获取收款地址
    const { data: setting } = await supabase
      .from('system_settings')
      .select('value_text')
      .eq('id', 'recharge_trc20_address')
      .single()

    const trcAddress = setting?.value_text
    if (!trcAddress) {
      throw new Error('未配置充值收款地址，请联系客服')
    }

    // 3. 计算浮动金额 (调用 SQL 函数)
    const { data: totalAmount, error: funcError } = await supabase.rpc('get_next_recharge_amount', {
      p_base_amount: amount
    })

    if (funcError) throw funcError

    const floatAmount = Number(totalAmount) - amount

    // 🎯 生成订单号：日期 + 6位随机数字
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '')
    const randomSuffix = Math.floor(Math.random() * 900000 + 100000)
    const orderNo = `${dateStr}${randomSuffix}`

    const now = new Date()
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000) // 30 分钟过期
    const lockedUntil = new Date(now.getTime() + 60 * 60 * 1000) // 1 小时占用

    // 转换为北京时间显示 (UTC+8)
    const beijingTime = new Date(expiresAt.getTime() + 8 * 60 * 60 * 1000)
    const timeStr = `${beijingTime.getUTCHours().toString().padStart(2, '0')}:${beijingTime.getUTCMinutes().toString().padStart(2, '0')}`

    const { data: order, error: insertError } = await supabase
      .from('recharge_orders')
      .insert({
        user_id: profile.id,
        order_no: orderNo,
        base_amount: amount,
        float_amount: floatAmount,
        total_amount: totalAmount,
        trc20_address: trcAddress,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        locked_until: lockedUntil.toISOString()
      })
      .select()
      .single()

    if (insertError) throw insertError

    // 🎯 计算到账抖币
    const coins = amount * 100
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${trcAddress}`

    // 5. 显示订单信息
    const text =
      `<a href="${qrUrl}">&#8205;</a>` + // 🎯 隐藏链接用于显示二维码预览
      `📝 <b>充值订单已创建</b>\n\n` +
      `🔢 <b>订单编号：</b> <code>${orderNo}</code>\n` +
      `💰 <b>支付金额：</b> <code>${Number(totalAmount).toFixed(2)}</code> USDT\n` +
      `💎 <b>预计到账：</b> <code>${coins.toLocaleString()}</code> 抖币\n` +
      `📊 <b>充值比例：</b> 1 USDT = 100 抖币\n\n` +
      `📍 <b>收款地址 (TRC20)：</b>\n<code>${trcAddress}</code>\n\n` +
      `⏰ <b>有效期：</b> 30 分钟 (请在北京时间 ${timeStr} 前完成支付)\n\n` +
      `⚠️ <b>请务必支付精确金额 (含尾数)，否则无法自动到账！</b>\n\n` +
      `<i>💡 支付完成后，请等待管理员确认。您可以在「资金流水」中查看进度。</i>`

    const keyboard = {
      inline_keyboard: [
        [{ text: '✅ 我已完成支付', callback_data: 'profile_wallet' }],
        [{ text: '❌ 取消订单', callback_data: `recharge_cancel:${order.id}` }],
        [{ text: '⬅️ 返回充值', callback_data: 'profile_recharge' }]
      ]
    }

    await editMessage(chatId, messageId, text, {
      reply_markup: keyboard,
      disable_web_page_preview: false
    })
  } catch (error: any) {
    console.error('handleCreateRechargeOrder error:', error)
    await editMessage(chatId, messageId, `❌ 创建订单失败: ${error.message}`, {
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ 返回重试', callback_data: 'profile_recharge' }]]
      }
    })
  }
}

// 🎯 处理取消充值订单
export async function handleCancelRechargeOrder(
  chatId: number,
  messageId: number,
  orderId: string
) {
  try {
    const { error } = await supabase
      .from('recharge_orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId)
      .eq('status', 'pending')

    if (error) throw error

    await editMessage(chatId, messageId, '✅ 订单已取消。', {
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ 返回充值', callback_data: 'profile_recharge' }]]
      }
    })
  } catch (error: any) {
    console.error('handleCancelRechargeOrder error:', error)
    await editMessage(chatId, messageId, `❌ 取消失败: ${error.message}`, {
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ 返回充值', callback_data: 'profile_recharge' }]]
      }
    })
  }
}

// 🎯 处理"提现"开始
export async function handleWithdrawStart(chatId: number, messageId?: number) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('balance_coins')
      .eq('tg_user_id', chatId)
      .single()

    const balance = Math.floor(profile?.balance_coins || 0)
    const minWithdraw = 1000 // 10U = 1000 抖币

    if (balance < minWithdraw) {
      const errorText =
        `❌ <b>提现金额不足</b>\n\n` +
        `当前余额：<code>${balance}</code> 抖币\n` +
        `最低提现额度为 <code>${minWithdraw}</code> 抖币 (10 USDT)。\n\n` +
        `💡 您可以通过邀请好友或作品打赏获取更多抖币。`

      const keyboard = {
        inline_keyboard: [[{ text: '⬅️ 返回钱包', callback_data: 'profile_wallet' }]]
      }

      if (messageId) {
        await editMessage(chatId, messageId, errorText, { reply_markup: keyboard })
      } else {
        await sendMessage(chatId, errorText, { reply_markup: keyboard })
      }
      return
    }

    // 更新用户状态，进入等待输入提现金额状态
    const { updateUserState } = await import('../state.ts')
    await updateUserState(chatId, {
      state: 'waiting_withdraw_amount',
      current_message_id: messageId
    })

    const text =
      `💰 <b>抖币提现</b>\n\n` +
      `当前可提现余额：<code>${balance}</code> 抖币\n\n` +
      `请输入您要提现的金额 (仅输入数字)：\n` +
      `<i>💡 最低提现额度为 1000 抖币</i>\n\n` +
      `发送 /cancel 可取消操作。`

    const keyboard = {
      inline_keyboard: [[{ text: '⬅️ 取消', callback_data: 'profile_wallet' }]]
    }

    if (messageId) {
      await editMessage(chatId, messageId, text, { reply_markup: keyboard })
    } else {
      await sendMessage(chatId, text, { reply_markup: keyboard })
    }
  } catch (error) {
    console.error('handleWithdrawStart error:', error)
    await sendMessage(chatId, '❌ 获取提现信息失败')
  }
}

// 🎯 处理提现确认页面
export async function handleWithdrawConfirmPage(
  chatId: number,
  messageId: number,
  amount: number,
  address: string
) {
  const usdt = (amount / 100).toFixed(2)
  const text =
    `⚠️ <b>请确认提现信息</b>\n\n` +
    `💰 <b>提现金额：</b> <code>${amount}</code> 抖币\n` +
    `💵 <b>折合金额：</b> <code>${usdt}</code> USDT\n` +
    `📍 <b>提现地址 (TRC20)：</b>\n<code>${address}</code>\n\n` +
    `<b>注意：</b>\n` +
    `1. 提交后金额将立即进入冻结状态。\n` +
    `2. 管理员审核通过后将按地址汇款。\n` +
    `3. 请务必核对地址，填写错误将导致资金丢失且无法找回！`

  const keyboard = {
    inline_keyboard: [
      [{ text: '✅ 确认提交申请', callback_data: 'withdraw_submit' }],
      [{ text: '❌ 取消并返回', callback_data: 'profile_wallet' }]
    ]
  }

  await editMessage(chatId, messageId, text, { reply_markup: keyboard })
}

// 🎯 处理正式提交提现
export async function handleWithdrawSubmit(chatId: number, messageId: number) {
  try {
    const { getUserState, updateUserState } = await import('../state.ts')
    const userState = await getUserState(chatId)
    const ctx = (userState as any)?.context || {}
    const amount = Number(ctx.withdraw_amount)
    const address = ctx.withdraw_address

    if (!amount || !address) {
      await answerWithdrawError(chatId, messageId, '提现信息不完整，请重新开始。')
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('tg_user_id', chatId)
      .single()

    if (!profile) throw new Error('User not found')

    // 生成订单号
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '')
    const randomSuffix = Math.floor(Math.random() * 900000 + 100000)
    const orderNo = `WD${dateStr}${randomSuffix}`

    // 调用 RPC 处理提现
    const { data: res, error: rpcError } = await supabase.rpc('process_withdraw_request', {
      p_user_id: profile.id,
      p_amount: amount,
      p_address: address,
      p_order_no: orderNo
    })

    if (rpcError) throw rpcError
    if (!res.success) {
      await answerWithdrawError(chatId, messageId, res.message || '提交失败')
      return
    }

    // 成功后清空状态
    await updateUserState(chatId, {
      state: 'idle',
      context: { ...ctx, withdraw_amount: null, withdraw_address: null }
    })

    const successText =
      `✅ <b>提现申请已提交！</b>\n\n` +
      `🔢 <b>订单编号：</b> <code>${orderNo}</code>\n` +
      `💰 <b>提现金额：</b> <code>${amount}</code> 抖币\n` +
      `📍 <b>提现地址：</b> <code>${address}</code>\n\n` +
      `管理员将1小时内完成审核并处理汇款，请耐心等待。您可以在「账单记录」中查看进度。`

    const keyboard = {
      inline_keyboard: [[{ text: '⬅️ 返回钱包', callback_data: 'profile_wallet' }]]
    }

    await editMessage(chatId, messageId, successText, { reply_markup: keyboard })
  } catch (error: any) {
    console.error('handleWithdrawSubmit error:', error)
    await editMessage(chatId, messageId, `❌ 提交失败: ${error.message}`, {
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ 返回重试', callback_data: 'profile_withdraw' }]]
      }
    })
  }
}

async function answerWithdrawError(chatId: number, messageId: number, msg: string) {
  await editMessage(chatId, messageId, `❌ ${msg}`, {
    reply_markup: {
      inline_keyboard: [[{ text: '⬅️ 返回重试', callback_data: 'profile_withdraw' }]]
    }
  })
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
