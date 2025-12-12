import { supabase } from '../supabaseClient.ts'
import { deleteTelegramMessage, editMessage, sendMessage } from '../telegram.ts'

// 🔔 通知设置相关逻辑
const DEFAULT_NOTIFICATION_SETTINGS = {
  like: { mute_until: 0 },
  comment: { mute_until: 0 },
  collect: { mute_until: 0 },
  follow: { mute_until: 0 },
  new_post: { mute_until: 0 } // 🎯 关注的人发布新作品
}

async function getUserSettings(chatId: number) {
  const { data, error } = await supabase
    .from('profiles')
    .select('notification_settings')
    .eq('tg_user_id', chatId)
    .single()

  if (error || !data) return DEFAULT_NOTIFICATION_SETTINGS
  // Merge with default to ensure all keys exist
  return {
    like: { ...DEFAULT_NOTIFICATION_SETTINGS.like, ...(data.notification_settings?.like || {}) },
    comment: {
      ...DEFAULT_NOTIFICATION_SETTINGS.comment,
      ...(data.notification_settings?.comment || {})
    },
    collect: {
      ...DEFAULT_NOTIFICATION_SETTINGS.collect,
      ...(data.notification_settings?.collect || {})
    },
    follow: {
      ...DEFAULT_NOTIFICATION_SETTINGS.follow,
      ...(data.notification_settings?.follow || {})
    },
    new_post: {
      ...DEFAULT_NOTIFICATION_SETTINGS.new_post,
      ...(data.notification_settings?.new_post || {})
    }
  }
}

async function updateUserSettings(chatId: number, settings: any) {
  await supabase
    .from('profiles')
    .update({ notification_settings: settings })
    .eq('tg_user_id', chatId)
}

function getSettingsKeyboard(settings: any) {
  const getStatus = (key: string) => {
    const until = settings[key]?.mute_until || 0
    if (until === -1) return '❌ 永久关闭'
    if (until > Date.now()) {
      const h = Math.ceil((until - Date.now()) / 3600000)
      return `🔕 静音 ${h}h`
    }
    return '✅ 开启'
  }

  return {
    inline_keyboard: [
      [
        { text: `❤️ 点赞: ${getStatus('like')}`, callback_data: 'settings:menu:like' },
        { text: `💬 评论: ${getStatus('comment')}`, callback_data: 'settings:menu:comment' }
      ],
      [
        { text: `⭐ 收藏: ${getStatus('collect')}`, callback_data: 'settings:menu:collect' },
        { text: `➕ 关注: ${getStatus('follow')}`, callback_data: 'settings:menu:follow' }
      ],
      [
        {
          text: `🎬 关注博主的新作品: ${getStatus('new_post')}`,
          callback_data: 'settings:menu:new_post'
        }
      ],
      [{ text: '❌ 关闭', callback_data: 'settings:close' }]
    ]
  }
}

function getSubMenuKeyboard(type: string) {
  const map: any = {
    like: '❤️ 点赞',
    comment: '💬 评论',
    collect: '⭐ 收藏',
    follow: '➕ 关注',
    new_post: '🎬 新作品'
  }

  return {
    inline_keyboard: [
      [{ text: `✅ 开启`, callback_data: `settings:set:${type}:on` }],
      [
        { text: `🔕 静音 2小时`, callback_data: `settings:set:${type}:2h` },
        { text: `🔕 静音 24小时`, callback_data: `settings:set:${type}:24h` }
      ],
      [{ text: `❌ 永久关闭`, callback_data: `settings:set:${type}:off` }],
      [{ text: `<< 返回`, callback_data: `settings:main` }]
    ]
  }
}

export async function handleSettings(chatId: number) {
  const settings = await getUserSettings(chatId)
  await sendMessage(chatId, '🔔 <b>通知设置</b>\n\n点击下方按钮进行设置：', {
    reply_markup: getSettingsKeyboard(settings)
  })
}

export async function handleSettingsCallback(chatId: number, messageId: number, data: string) {
  const parts = data.split(':')
  const action = parts[1] // menu, set, main, close

  if (action === 'close') {
    await deleteTelegramMessage(chatId, messageId)
    return
  }

  if (action === 'main') {
    const settings = await getUserSettings(chatId)
    await editMessage(chatId, messageId, '🔔 <b>通知设置</b>\n\n点击下方按钮进行设置：', {
      reply_markup: getSettingsKeyboard(settings)
    })
    return
  }

  if (action === 'menu') {
    const type = parts[2]
    await editMessage(chatId, messageId, `⚙️ <b>设置: ${type}</b>\n\n请选择操作：`, {
      reply_markup: getSubMenuKeyboard(type)
    })
    return
  }

  if (action === 'set') {
    const type = parts[2]
    const value = parts[3]

    const settings = await getUserSettings(chatId)
    if (!settings[type]) settings[type] = {}

    if (value === 'on') settings[type].mute_until = 0
    else if (value === 'off') settings[type].mute_until = -1
    else if (value === '2h') settings[type].mute_until = Date.now() + 2 * 3600 * 1000
    else if (value === '24h') settings[type].mute_until = Date.now() + 24 * 3600 * 1000

    await updateUserSettings(chatId, settings)

    // 返回主菜单
    await editMessage(
      chatId,
      messageId,
      '🔔 <b>通知设置</b>\n\n✅ 设置已更新\n点击下方按钮进行设置：',
      {
        reply_markup: getSettingsKeyboard(settings)
      }
    )
  }
}
