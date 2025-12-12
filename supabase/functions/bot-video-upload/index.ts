import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BOT_TOKEN = Deno.env.get('TG_BOT_TOKEN')!
const TG_API_BASE = Deno.env.get('TELEGRAM_API_BASE') || 'https://api.telegram.org'
const BOT_WORKER_URL = Deno.env.get('BOT_WORKER_URL')
const TG_FILE_PROXY_URL = Deno.env.get('TG_CDN_PROXY_URL') || Deno.env.get('TG_VIDEO_PROXY_URL')
// 本地开发用 SB_ 前缀，生产环境用 SUPABASE_ 前缀
const SUPABASE_URL = Deno.env.get('SB_URL') || Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY =
  Deno.env.get('SB_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// 🚫 媒体组拒绝缓存（避免同一组发送多条提示）
const mediaGroupRejectCache = new Map<string, boolean>()

// 📸 图片信息接口
interface AlbumPhoto {
  file_id: string
  width: number
  height: number
  file_size?: number
  order?: number
}

// 🎯 将 Telegram file_id 转换为 CDN URL
function buildTelegramFileUrl(fileId: string): string | null {
  if (!fileId) return null

  if (TG_FILE_PROXY_URL) {
    const base = TG_FILE_PROXY_URL.endsWith('/')
      ? TG_FILE_PROXY_URL.slice(0, -1)
      : TG_FILE_PROXY_URL
    return `${base}?file_id=${encodeURIComponent(fileId)}`
  }

  console.warn('[bot] 未配置 TG_FILE_PROXY_URL，无法生成缩略图 URL')
  return null
}

// 用户状态存储（使用数据库）
interface UserState {
  state: 'idle' | 'waiting_description' | 'waiting_tags' | 'waiting_location'
  draft_video_id?: string // UUID
  current_message_id?: number // 当前编辑的消息ID
}

// Telegram API 调用
async function sendMessage(chatId: number, text: string, options: any = {}) {
  console.log('[sendMessage] chatId:', chatId, 'textLength:', text.length)
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/sendMessage`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...options
      })
    })
    const result = await response.json()
    if (!result.ok) {
      console.error('[sendMessage] 失败:', result)
    } else {
      console.log('[sendMessage] 成功, message_id:', result.result?.message_id)
    }
    return result
  } catch (error) {
    console.error('[sendMessage] 异常:', error)
    throw error
  }
}

async function editMessage(chatId: number, messageId: number, text: string, options: any = {}) {
  console.log('[editMessage] chatId:', chatId, 'messageId:', messageId, 'textLength:', text.length)
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/editMessageText`
  try {
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      ...options
    }
    console.log('[editMessage] payload键盘:', options.reply_markup ? 'yes' : 'no')

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const result = await response.json()
    if (!result.ok) {
      console.error('[editMessage] 失败:', JSON.stringify(result))
      console.error('[editMessage] 请求payload:', JSON.stringify(payload).substring(0, 500))
    } else {
      console.log('[editMessage] 成功')
    }
    return result
  } catch (error) {
    console.error('[editMessage] 异常:', error)
    throw error
  }
}

async function deleteTelegramMessage(chatId: number, messageId: number) {
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/deleteMessage`
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId })
    })
  } catch (e) {
    console.error('[deleteMessage] Error:', e)
  }
}

async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/answerCallbackQuery`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text
    })
  })
}

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
  const title = map[type] || type

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

async function handleSettings(chatId: number) {
  const settings = await getUserSettings(chatId)
  await sendMessage(chatId, '🔔 <b>通知设置</b>\n\n点击下方按钮进行设置：', {
    reply_markup: getSettingsKeyboard(settings)
  })
}

async function handleSettingsCallback(chatId: number, messageId: number, data: string) {
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

// 🎯 处理 inline query（分享功能）
async function answerInlineQuery(inlineQueryId: string, results: any[]) {
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/answerInlineQuery`
  const payload = {
    inline_query_id: inlineQueryId,
    results,
    cache_time: 0
  }

  console.log('[answerInlineQuery] 准备发送请求')
  console.log('[answerInlineQuery] payload:', JSON.stringify(payload, null, 2))

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const result = await response.json()

    console.log('[answerInlineQuery] 响应状态:', response.status)
    console.log('[answerInlineQuery] 响应结果:', JSON.stringify(result, null, 2))

    if (!result.ok) {
      console.error('[answerInlineQuery] ❌ 失败! 错误码:', result.error_code)
      console.error('[answerInlineQuery] 错误描述:', result.description)
    } else {
      console.log('[answerInlineQuery] ✅ 成功返回卡片')
    }
    return result
  } catch (error) {
    console.error('[answerInlineQuery] ❌ 异常:', error)
    console.error(
      '[answerInlineQuery] 错误堆栈:',
      error instanceof Error ? error.stack : String(error)
    )
    throw error
  }
}

// 🎯 处理 inline query - 视频分享
async function handleInlineQuery(inlineQuery: any) {
  console.log('[InlineQuery] ========== 开始处理 ==========')
  console.log('[InlineQuery] 完整 inlineQuery:', JSON.stringify(inlineQuery, null, 2))

  const queryId = inlineQuery.id
  const query = inlineQuery.query || ''
  const userId = inlineQuery.from.id

  console.log('[InlineQuery] 解析参数:', { queryId, query, userId })

  // 检查查询格式：video_{videoId}
  if (!query.startsWith('video_')) {
    console.log('[InlineQuery] ❌ 查询格式不匹配，期望 video_xxx，实际:', query)
    await answerInlineQuery(queryId, [])
    return
  }

  let videoId = query.replace('video_', '')
  // 如果带有邀请码后缀 (video_xxxx_iyyy)，去除后缀以获取正确的 videoId
  if (videoId.includes('_i')) {
    videoId = videoId.split('_i')[0]
  }

  console.log('[InlineQuery] ✅ 提取视频ID:', videoId)

  // 从数据库获取视频信息
  console.log('[InlineQuery] 开始查询数据库...')
  const { data: video, error } = await supabase
    .from('videos')
    .select('id, description, status')
    .eq('id', videoId)
    .single()

  if (error || !video) {
    console.error('[InlineQuery] ❌ 视频查询失败:', error)
    await answerInlineQuery(queryId, [])
    return
  }

  // 获取分享者的 numeric_id 作为邀请码
  const { data: sharer } = await supabase
    .from('profiles')
    .select('numeric_id')
    .eq('tg_user_id', userId)
    .single()

  const inviteSuffix = sharer?.numeric_id ? `_i${sharer.numeric_id}` : ''

  console.log('[InlineQuery] ✅ 视频查询成功:', {
    id: video.id,
    status: video.status,
    has_desc: !!video.description,
    desc_preview: video.description?.substring(0, 30)
  })

  if (video.status !== 'published') {
    console.log('[InlineQuery] ❌ 视频未发布，状态:', video.status)
    await answerInlineQuery(queryId, [])
    return
  }

  // 构建深链接
  const deepLink = `https://t.me/tg_douyin_bot/tgdouyin?startapp=video_${videoId}${inviteSuffix}`
  console.log('[InlineQuery] 深链接:', deepLink)

  // 🎯 视频描述前50字作为超链接文字
  const linkText = video.description?.substring(0, 50) || '点击观看精彩视频'
  const fullDesc = video.description || '精彩视频'

  console.log('[InlineQuery] 超链接文字:', linkText)
  console.log('[InlineQuery] 完整描述:', fullDesc.substring(0, 100))

  // 🎯 构建分享卡片（暂不支持缩略图）
  const result = {
    type: 'article',
    id: '1',
    title: '🎬 分享视频',
    description: fullDesc.substring(0, 100),
    input_message_content: {
      message_text: `<a href="${deepLink}">${linkText}</a>`,
      parse_mode: 'HTML'
    }
    // 暂不添加 thumb_url（Telegram API 对缩略图格式要求严格）
  }

  console.log('[InlineQuery] 构建的卡片数据:', JSON.stringify(result, null, 2))
  console.log('[InlineQuery] 准备调用 answerInlineQuery...')

  await answerInlineQuery(queryId, [result])

  console.log('[InlineQuery] ========== 处理完成 ==========')
}

// 发送自毁消息（3秒后删除）
async function sendSelfDestructMessage(chatId: number, text: string, seconds: number = 3) {
  const result = await sendMessage(chatId, text)
  if (result.ok) {
    const messageId = result.result.message_id
    setTimeout(() => {
      deleteTelegramMessage(chatId, messageId)
    }, seconds * 1000)
  }
  return result
}

// 🎯 通知粉丝：有新作品发布
async function notifyFollowersNewPost(
  authorId: string,
  authorNickname: string,
  videoId: string,
  videoDesc?: string
) {
  console.log(`[NOTIFY-NEW-POST] 开始通知粉丝: author=${authorId}, video=${videoId}`)

  try {
    // 1. 查询该用户的所有粉丝（包含通知设置）
    const { data: followers, error } = await supabase
      .from('follows')
      .select(
        `
        follower_id,
        follower:profiles!follows_follower_id_fkey(
          id,
          tg_user_id,
          notification_settings
        )
      `
      )
      .eq('followee_id', authorId)

    if (error) {
      console.error('[NOTIFY-NEW-POST] ❌ 查询粉丝失败:', error)
      return
    }

    if (!followers || followers.length === 0) {
      console.log('[NOTIFY-NEW-POST] 没有粉丝需要通知')
      return
    }

    console.log(`[NOTIFY-NEW-POST] 找到 ${followers.length} 个粉丝`)

    // 2. 构造消息
    const descPreview = videoDesc
      ? `\n📝 ${videoDesc.substring(0, 50)}${videoDesc.length > 50 ? '...' : ''}`
      : ''
    const message = `🎬 <b>${authorNickname}</b> 发布了新作品${descPreview}`

    // 3. 构造深链
    // 获取作者的 numeric_id
    const { data: authorProfile } = await supabase
      .from('profiles')
      .select('numeric_id')
      .eq('id', authorId)
      .single()

    const inviteSuffix = authorProfile?.numeric_id ? `_i${authorProfile.numeric_id}` : ''

    const botUsername = 'tg_douyin_bot'
    const appName = 'tgdouyin'
    const deepLink = `https://t.me/${botUsername}/${appName}?startapp=video_${videoId}${inviteSuffix}`

    let sentCount = 0
    let skippedCount = 0

    // 4. 批量发送通知
    for (const follow of followers) {
      const followerProfile = (follow as any).follower
      if (!followerProfile || !followerProfile.tg_user_id) {
        skippedCount++
        continue
      }

      // 检查通知设置
      const settings = followerProfile.notification_settings || {}
      const typeSetting = settings['new_post'] || { mute_until: 0 }
      const muteUntil = typeSetting.mute_until || 0

      if (muteUntil === -1) {
        // 永久关闭
        skippedCount++
        continue
      }
      if (muteUntil > Date.now()) {
        // 临时静音中
        skippedCount++
        continue
      }

      // 发送通知
      try {
        const url = `${TG_API_BASE}/bot${BOT_TOKEN}/sendMessage`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: followerProfile.tg_user_id,
            text: message,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '👉 立即查看', url: deepLink }]]
            }
          })
        })
        const data = await res.json()
        if (data.ok) {
          sentCount++
        } else {
          console.warn(
            `[NOTIFY-NEW-POST] 发送失败 to ${followerProfile.tg_user_id}:`,
            data.description
          )
        }
      } catch (e) {
        console.error(`[NOTIFY-NEW-POST] 发送异常 to ${followerProfile.tg_user_id}:`, e)
      }
    }

    console.log(`[NOTIFY-NEW-POST] ✅ 完成: 发送 ${sentCount} 条, 跳过 ${skippedCount} 条`)
  } catch (error) {
    console.error('[NOTIFY-NEW-POST] Error:', error)
  }
}

// 获取持久化键盘
function getPersistentKeyboard() {
  return {
    keyboard: [[{ text: '📹 我的视频' }, { text: '👤 个人中心' }]],
    resize_keyboard: true,
    persistent: true
  }
}

// Nominatim 地理编码（返回国家+城市）
async function getLocationFromCoords(lat: number, lon: number) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?` +
    `lat=${lat}&lon=${lon}&format=json&accept-language=zh&addressdetails=1`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'DouyinClone/1.0 (supabase-edge-function)'
    }
  })

  if (!response.ok) {
    throw new Error('地理编码失败')
  }

  const data = await response.json()
  const address = data.address || {}

  return {
    country: address.country || '未知',
    country_code: (address.country_code || 'XX').toUpperCase(),
    city: address.city || address.town || address.village || address.state || null
  }
}

// 获取国旗 Emoji
function getFlag(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return '🌍'
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0))
  return String.fromCodePoint(...codePoints)
}

// 安全截断字符串（避免在emoji中间截断）
function safeTruncate(str: string, maxLength: number): string {
  if (!str) return str
  // 使用Array.from来正确处理emoji和其他Unicode字符
  const chars = Array.from(str)
  if (chars.length <= maxLength) {
    return str
  }
  return chars.slice(0, maxLength).join('') + '...'
}

// 生成编辑菜单
function getEditKeyboard(video: any) {
  const keyboard = []

  // 第一行：描述和标签
  keyboard.push([
    {
      text: video.description ? '✏️ 修改描述' : '📝 添加描述',
      callback_data: 'edit_description'
    },
    {
      text: video.tags && video.tags.length > 0 ? '✏️ 修改标签' : '🏷️ 添加标签',
      callback_data: 'edit_tags'
    }
  ])

  // 第二行：位置和隐私
  keyboard.push([
    {
      text: video.location_country ? '✏️ 修改位置' : '📍 添加位置',
      callback_data: 'edit_location'
    },
    {
      text: video.is_private ? '🔒 私密' : '🌍 公开',
      callback_data: 'toggle_privacy'
    }
  ])

  // 第三行：成人内容标记
  keyboard.push([
    {
      text: video.is_adult ? '🔞 成人内容：是' : '🔞 成人内容：否',
      callback_data: 'toggle_adult'
    }
  ])

  // 第三行：置顶设置（仅已发布视频可置顶）
  if (video.status === 'published') {
    keyboard.push([
      {
        text: video.is_top ? '📍 取消置顶' : '📌 置顶该视频',
        callback_data: 'toggle_pin'
      }
    ])
  }

  // 发布和草稿
  keyboard.push([
    {
      text: '✅ 立即发布',
      callback_data: 'publish'
    },
    {
      text: '💾 保存草稿',
      callback_data: 'save_draft'
    }
  ])

  // 删除按钮
  keyboard.push([
    {
      text: '🗑️ 删除视频',
      callback_data: `delete_video_${video.id}`
    }
  ])

  if (video.status !== 'published') {
    keyboard.push([
      {
        text: '⬅️ 返回草稿列表',
        callback_data: 'back_my_drafts'
      }
    ])
  }

  return { inline_keyboard: keyboard }
}

// 生成编辑菜单文本
function getEditMenuText(video: any): string {
  // 内容类型标题
  let titleText = '✅ <b>视频已就绪</b>'
  const contentType = video.content_type || 'video'
  if (contentType === 'image') {
    titleText = '✅ <b>图片已就绪</b>'
  } else if (contentType === 'album') {
    const images = typeof video.images === 'string' ? JSON.parse(video.images) : video.images || []
    titleText = `✅ <b>相册已就绪</b> (${images.length}张)`
  }

  // 描述
  let descText = '未设置'
  if (video.description) {
    descText = safeTruncate(video.description, 100)
  }

  // 标签
  let tagsText = '未设置'
  if (video.tags && video.tags.length > 0) {
    tagsText = video.tags.map((t: string) => '#' + t).join(' ')
  }

  // 位置
  let locationText = '未设置'
  if (video.location_country) {
    locationText = getFlag(video.location_country_code!) + ' ' + video.location_country
    if (video.location_city) {
      locationText += ' · ' + video.location_city
    }
  }

  // 隐私
  const privacyText = video.is_private ? '🔒 私密' : '🌍 公开'

  // 成人标记
  const adultText = video.is_adult ? '是' : '否'

  const lines = [
    titleText,
    '',
    '⚠️ <b>如果你上传的是成人向内容，请务必在下方勾选「成人内容：是」。</b>',
    '⛔ 严禁任何涉及儿童 / 未成年人的色情或暗示内容，一经发现将立刻封禁账号。',
    '📌 未正确标记成人内容的账号，后续将不再享受免审核，严重将限制上传。',
    '',
    `📝 描述：${descText}`,
    `🏷️ 标签：${tagsText}`,
    `📍 位置：${locationText}`,
    `🔐 隐私：${privacyText}`,
    `🔞 成人内容：${adultText}`,
    `📌 置顶：${video.is_top ? '已置顶' : '未置顶'}`
  ]

  return lines.join('\n')
}

// 获取或创建用户状态
async function getUserState(userId: number): Promise<UserState> {
  const { data } = await supabase.from('user_bot_states').select('*').eq('user_id', userId).single()

  if (data) {
    return data as UserState
  }

  // 创建新状态
  const { data: newState } = await supabase
    .from('user_bot_states')
    .insert({ user_id: userId, state: 'idle' })
    .select()
    .single()

  return newState as UserState
}

// 更新用户状态
async function updateUserState(userId: number, updates: Partial<UserState>) {
  await supabase.from('user_bot_states').upsert({
    user_id: userId,
    ...updates
  })
}

// 从文本中提取标签（#开头，最多5个）
function extractTags(text: string): string[] {
  if (!text) return []
  // 匹配 #标签（中文、英文、数字、下划线）
  const matches = text.match(/#[\w\u4e00-\u9fa5]+/g) || []
  // 去掉#号，去重，最多5个
  const tags = [...new Set(matches.map((t) => t.substring(1)))].slice(0, 5)
  return tags
}

// 获取 Telegram 用户信息
async function getTelegramUserInfo(userId: number) {
  try {
    const url = `${TG_API_BASE}/bot${BOT_TOKEN}/getChat`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: userId })
    })

    const result = await response.json()
    if (!result.ok) {
      console.error('获取 Telegram 用户信息失败:', result)
      return null
    }

    return {
      id: result.result.id,
      first_name: result.result.first_name || '用户',
      last_name: result.result.last_name,
      username: result.result.username,
      language_code: result.result.language_code
    }
  } catch (error) {
    console.error('获取 Telegram 用户信息异常:', error)
    return null
  }
}

// 获取或创建 Profile（在 /start 时调用）
// tgUserInfo: Telegram message.from 对象，包含用户完整信息
async function getOrCreateProfile(
  tgUserId: number,
  tgUserInfo?: { first_name: string; last_name?: string; username?: string; language_code?: string }
): Promise<{ id: string; numeric_id?: number } | null> {
  try {
    // 1. 先查找是否已存在
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('tg_user_id', tgUserId)
      .maybeSingle()

    if (existingProfile) {
      console.log('找到已存在的 profile:', existingProfile.id)
      return { id: existingProfile.id, numeric_id: existingProfile.numeric_id }
    }

    // 2. 不存在则创建
    console.log('Profile 不存在，开始创建...')

    // 优先使用传入的 tgUserInfo，如果没有则调用 API 获取
    const tgUser = tgUserInfo
      ? {
          id: tgUserId,
          first_name: tgUserInfo.first_name,
          last_name: tgUserInfo.last_name,
          username: tgUserInfo.username,
          language_code: tgUserInfo.language_code
        }
      : await getTelegramUserInfo(tgUserId)

    if (!tgUser) {
      console.error('无法获取 Telegram 用户信息')
      return null
    }

    // 3. 创建 auth 用户
    const uniqueEmail = `tg_${tgUser.id}@telegram.user`
    let userId: string

    try {
      const { data: authData, error } = await supabase.auth.admin.createUser({
        email: uniqueEmail,
        email_confirm: true,
        user_metadata: {
          tg_user_id: tgUser.id,
          tg_username: tgUser.username,
          tg_first_name: tgUser.first_name,
          tg_last_name: tgUser.last_name
        }
      })

      if (error) {
        // 如果邮箱已存在，获取已有用户
        if (error.status === 422 || error.message?.includes('email')) {
          const { data: users } = await supabase.auth.admin.listUsers()
          const existingUser = users?.users?.find((u) => u.email === uniqueEmail)
          if (existingUser) {
            userId = existingUser.id
            console.log('找到已存在的 auth 用户:', userId)
          } else {
            console.error('创建 auth 用户失败:', error)
            return null
          }
        } else {
          console.error('创建 auth 用户失败:', error)
          return null
        }
      } else {
        userId = authData.user.id
        console.log('成功创建 auth 用户:', userId)
      }
    } catch (err) {
      console.error('创建 auth 用户异常:', err)
      return null
    }

    // 4. 构建头像 URL
    // 使用 Telegram 公开 API（支持真实照片和默认 SVG）
    const avatarUrl = `https://t.me/i/userpic/320/${tgUser.id}.jpg`

    // 5. 创建或更新 profile
    const { data: profile, error: upsertError } = await supabase
      .from('profiles')
      .upsert(
        {
          id: userId!,
          tg_user_id: tgUser.id,
          tg_username: tgUser.username || null,
          nickname: tgUser.first_name + (tgUser.last_name ? ` ${tgUser.last_name}` : ''),
          username: tgUser.username || `user_${tgUser.id}`,
          avatar_url: avatarUrl, // ✅ 存储公开头像 URL
          auth_provider: 'tg',
          lang: tgUser.language_code || 'zh-CN'
        },
        { onConflict: 'id' }
      )
      .select('id, numeric_id')
      .single()

    if (upsertError) {
      console.error('创建 profile 失败:', upsertError)
      return null
    }

    console.log('✅ 成功创建 profile:', profile.id)
    return profile
  } catch (error) {
    console.error('getOrCreateProfile 异常:', error)
    return null
  }
}

// 🎯 触发 Worker 处理视频 (转存 R2)
async function triggerWorker(videoId: string, fileId: string, chatId: number, messageId: number) {
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
async function handlePhoto(
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
    // 获取最大尺寸的图片
    const photo = photoSizes[photoSizes.length - 1]
    console.log('[handlePhoto] 最大尺寸图片:', photo)

    // 获取用户 profile
    const profile = await getOrCreateProfile(chatId, from)
    if (!profile) {
      await sendMessage(chatId, '❌ 账号初始化失败\n\n请先发送 /start 命令初始化账号')
      return
    }

    // 🎯 相册模式：使用数据库存储
    if (mediaGroupId) {
      // 查询是否已有该 media_group_id 的记录
      const { data: existingPost } = await supabase
        .from('videos')
        .select('*')
        .eq('tg_user_id', chatId)
        .eq('media_group_id', mediaGroupId)
        .single()

      if (existingPost) {
        // 已有记录，追加图片
        const currentImages: AlbumPhoto[] =
          typeof existingPost.images === 'string'
            ? JSON.parse(existingPost.images)
            : existingPost.images || []

        // 检查是否已存在该图片（避免重复）
        const exists = currentImages.some((img) => img.file_id === photo.file_id)
        if (exists) {
          console.log('[handlePhoto] 图片已存在，跳过')
          return
        }

        // 追加新图片
        currentImages.push({
          file_id: photo.file_id,
          width: photo.width,
          height: photo.height,
          order: currentImages.length
        })

        // 更新数据库
        const { error: updateError } = await supabase
          .from('videos')
          .update({
            images: JSON.stringify(currentImages),
            title: `相册 (${currentImages.length}张)`,
            content_type: 'album' // 确保是相册类型
          })
          .eq('id', existingPost.id)

        if (updateError) {
          console.error('[handlePhoto] 更新相册失败:', updateError)
          return
        }

        console.log(`[handlePhoto] 相册已更新，当前 ${currentImages.length} 张图片`)

        // 🎯 更新编辑菜单（获取最新数据）
        const { data: updatedPost } = await supabase
          .from('videos')
          .select('*')
          .eq('id', existingPost.id)
          .single()

        if (updatedPost) {
          // 获取当前消息ID并更新菜单
          const { data: userState } = await supabase
            .from('user_bot_states')
            .select('current_message_id')
            .eq('user_id', chatId)
            .single()

          if (userState?.current_message_id) {
            try {
              await editMessage(
                chatId,
                userState.current_message_id,
                getEditMenuText(updatedPost),
                {
                  reply_markup: getEditKeyboard(updatedPost)
                }
              )
            } catch (e) {
              console.warn('[handlePhoto] 更新菜单失败:', e)
            }
          }
        }

        return
      }

      // 没有记录，创建新相册
      console.log('[handlePhoto] 创建新相册')

      // 处理 caption
      let description = null
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
          media_group_id: mediaGroupId, // 🎯 保存 media_group_id 用于后续匹配
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

      // 发送编辑菜单
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
async function saveSinglePhoto(
  chatId: number,
  photo: any,
  caption?: string,
  from?: any,
  profile?: any
) {
  console.log('[saveSinglePhoto] 保存单张图片')

  // 处理 caption
  let description = null
  let tags: string[] = []
  if (caption && caption.length > 0) {
    description = safeTruncate(caption, 300)
    tags = extractTags(caption)
  }

  // 获取用户 profile（如果没有传入）
  if (!profile) {
    profile = await getOrCreateProfile(chatId, from)
    if (!profile) {
      await sendMessage(chatId, '❌ 账号初始化失败\n\n请先发送 /start 命令初始化账号')
      return
    }
  }

  // 保存到数据库
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

  // 发送编辑菜单
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
async function handleVideo(
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
    // 处理 caption（转发视频可能带有文案）
    let description = null
    let tags: string[] = []

    if (caption && caption.length > 0) {
      // 截取前300字作为描述（安全截断，不破坏emoji）
      description = safeTruncate(caption, 300)
      // 自动提取标签
      tags = extractTags(caption)
    }

    // 查找或创建用户的 profile，获取 author_id
    const profile = await getOrCreateProfile(chatId, from)

    if (!profile) {
      console.error('无法创建或获取用户 profile')
      await sendMessage(chatId, '❌ 账号初始化失败\n\n' + '请先发送 /start 命令初始化账号')
      return
    }

    // 🚫 拒绝媒体组（多视频/视频+图片混合）
    if (mediaGroupId) {
      console.log(`[handleVideo] 检测到 Media Group: ${mediaGroupId}，拒绝处理`)
      // 使用 mediaGroupId 作为 key，避免重复发送提示
      const cacheKey = `media_group_reject_${chatId}_${mediaGroupId}`
      const alreadyNotified = mediaGroupRejectCache.get(cacheKey)

      if (!alreadyNotified) {
        mediaGroupRejectCache.set(cacheKey, true)
        // 5秒后清除缓存，避免内存泄漏
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

    // ✅ 统一使用 R2 转存流程 (Local Bot API 模式下，所有文件都在 VPS 本地，必须转存)
    const videoSize = video.file_size || 0
    const sizeMB = (videoSize / 1024 / 1024).toFixed(1)

    console.log(`[handleVideo] 视频大小: ${sizeMB} MB, 准备转存 R2`)

    // 保存到数据库
    const { data: draftVideo, error } = await supabase
      .from('videos')
      .insert({
        tg_user_id: chatId,
        author_id: profile.id,
        title: video.file_name || '未命名视频',
        description: description,
        tags: tags.length > 0 ? tags : null,
        play_url: null, // 待 Worker 填充
        cover_url: video.thumbnail?.file_id || video.thumb?.file_id || '',
        tg_file_id: video.file_id,
        tg_thumbnail_file_id: video.thumbnail?.file_id || video.thumb?.file_id,
        tg_unique_id: video.file_unique_id,
        storage_type: 'r2_pending', // ✅ 标记为等待 R2 转存
        duration: video.duration,
        width: video.width,
        height: video.height,
        file_size: videoSize,
        is_private: false,
        status: 'processing' // ✅ 标记为处理中
      })
      .select()
      .single()

    if (error) {
      console.error('保存视频记录失败:', error)
      await sendMessage(chatId, '❌ 上传失败，请重试\n\n错误: ' + error.message)
      return
    }

    console.log(`[handleVideo] 视频记录已保存: ${draftVideo.id}, 状态: ${draftVideo.status}`)

    // 发送处理中消息
    const processingMsg = await sendMessage(
      chatId,
      `🔄 <b>正在处理视频...</b>\n\n` +
        `📦 文件大小：${sizeMB} MB\n` +
        `⏳ 正在转码并同步数据...\n` +
        `💡 处理完成后会自动显示编辑菜单`
    )

    const processingMessageId = processingMsg.ok ? processingMsg.result.message_id : 0

    // 触发 Worker
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

// 处理回调按钮
async function handleCallback(
  chatId: number,
  messageId: number,
  data: string,
  callbackQueryId: string
) {
  console.log('[handleCallback] 开始处理回调')
  console.log('[handleCallback] chatId:', chatId, 'messageId:', messageId, 'data:', data)

  try {
    // 🎯 个人中心相关回调
    if (data === 'profile_invite_unlock') {
      await answerCallbackQuery(callbackQueryId)
      await handleInviteUnlock(chatId)
      return
    }
    if (data === 'profile_help') {
      await answerCallbackQuery(callbackQueryId)
      await handleHelp(chatId)
      return
    }
    if (data === 'profile_settings_notify') {
      await answerCallbackQuery(callbackQueryId)
      await handleSettings(chatId)
      return
    }
    if (data === 'profile_settings_privacy') {
      await answerCallbackQuery(callbackQueryId)
      await handlePrivacySettings(chatId)
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
        '🏷️ 请发送标签\n\n格式：多个标签用空格分隔\n例如：搞笑 日常 生活\n\n💡 发送 /cancel 可取消编辑',
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

    // 返回"我的视频"概览（编辑消息而不是删除重发）
    if (data === 'back_my_videos') {
      await answerCallbackQuery(callbackQueryId)
      await handleMyVideosEdit(chatId, messageId)
      return
    }

    // ✅ 查看上传中的视频列表
    if (data === 'my_processing') {
      await answerCallbackQuery(callbackQueryId)
      await handleMyProcessing(chatId, messageId)
      return
    }

    // 查看已发布视频列表
    if (data === 'my_published') {
      await answerCallbackQuery(callbackQueryId)
      await handleMyPublished(chatId, messageId)
      return
    }

    // 查看草稿列表
    if (data === 'my_drafts') {
      await answerCallbackQuery(callbackQueryId)
      await handleMyDrafts(chatId, messageId)
      return
    }

    // ✅ 返回我的视频（用于从上传中列表返回）
    if (data === 'my_videos') {
      await answerCallbackQuery(callbackQueryId)
      await handleMyVideosEdit(chatId, messageId)
      return
    }

    // ✅ 删除视频
    if (data.startsWith('delete_video_')) {
      const videoId = data.replace('delete_video_', '')
      await handleDeleteVideo(chatId, messageId, videoId, callbackQueryId)
      return
    }

    // 查看视频详情
    if (data.startsWith('view_video_')) {
      const videoId = data.replace('view_video_', '')
      await answerCallbackQuery(callbackQueryId)
      await handleViewVideo(chatId, messageId, videoId)
      return
    }

    // 编辑草稿（从草稿列表点击）
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
      const editResult = await editMessage(chatId, messageId, menuText, {
        reply_markup: keyboard
      })
      console.log('[handleCallback] 编辑消息结果:', {
        ok: editResult.ok,
        error: editResult.description
      })

      if (!editResult.ok) {
        console.error('[handleCallback] 编辑消息失败，尝试发送新消息...')
        const sendResult = await sendMessage(chatId, menuText, {
          reply_markup: keyboard
        })
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

    // 从数据库获取用户状态
    const userState = await getUserState(chatId)

    if (!userState.draft_video_id) {
      await answerCallbackQuery(callbackQueryId, '会话已过期，请从 我的视频 里继续编辑')
      return
    }

    // 获取草稿视频
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

        // 在主消息上显示提示
        await editMessage(
          chatId,
          messageId,
          '✏️ <b>编辑描述</b>\n\n' + '请输入视频描述（最多300字）\n' + '发送文字即可设置',
          {
            reply_markup: {
              inline_keyboard: [[{ text: '← 返回', callback_data: 'cancel_edit' }]]
            }
          }
        )
        break

      case 'edit_tags':
        await updateUserState(chatId, { state: 'waiting_tags' })
        await answerCallbackQuery(callbackQueryId)

        await editMessage(
          chatId,
          messageId,
          '🏷️ <b>编辑标签</b>\n\n' + '请输入标签，用空格分隔（3-5个）\n' + '例如: 旅游 风景 爬山',
          {
            reply_markup: {
              inline_keyboard: [[{ text: '← 返回', callback_data: 'cancel_edit' }]]
            }
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
            reply_markup: {
              inline_keyboard: [[{ text: '← 返回', callback_data: 'cancel_edit' }]]
            }
          }
        )
        break

      case 'toggle_privacy': {
        // 切换隐私设置
        await supabase.from('videos').update({ is_private: !video.is_private }).eq('id', video.id)

        await answerCallbackQuery(
          callbackQueryId,
          !video.is_private ? '已设置为私密' : '已设置为公开'
        )

        // 重新获取更新后的视频
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
        // 切换成人内容标记
        await supabase.from('videos').update({ is_adult: !video.is_adult }).eq('id', video.id)

        await answerCallbackQuery(
          callbackQueryId,
          !video.is_adult ? '已标记为成人内容，请确保未涉及任何未成年人。' : '已取消成人内容标记'
        )

        // 重新获取更新后的视频
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
        await publishVideo(chatId, messageId, video.id)
        break

      case 'save_draft':
        await answerCallbackQuery(callbackQueryId)
        await editMessage(
          chatId,
          messageId,
          '💾 <b>已保存为草稿</b>\n\n' + '点击底部「📹 我的视频」继续编辑'
        )
        // 清除用户状态
        await updateUserState(chatId, {
          state: 'idle',
          draft_video_id: null,
          current_message_id: null
        })
        break

      case 'cancel_edit':
        // 取消编辑，恢复主菜单
        await updateUserState(chatId, { state: 'idle' })
        await answerCallbackQuery(callbackQueryId, '✅ 已取消')

        // 重新显示编辑菜单
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

// 处理文本消息
async function handleText(chatId: number, text: string, userMessageId: number) {
  const userState = await getUserState(chatId)

  if (!userState.draft_video_id || !userState.current_message_id) return

  // 获取草稿视频
  const { data: video } = await supabase
    .from('videos')
    .select('*')
    .eq('id', userState.draft_video_id)
    .single()

  if (!video) return

  switch (userState.state) {
    case 'waiting_description': {
      // 删除用户消息
      await deleteTelegramMessage(chatId, userMessageId)

      if (text.length > 300) {
        await sendSelfDestructMessage(chatId, '❌ 描述最多 300 字，请重新输入')
        return
      }

      // 更新描述
      await supabase.from('videos').update({ description: text }).eq('id', video.id)

      // 重置状态
      await updateUserState(chatId, { state: 'idle' })

      // 重新获取视频并更新主消息
      const { data: updatedVideo } = await supabase
        .from('videos')
        .select('*')
        .eq('id', video.id)
        .single()

      await editMessage(chatId, userState.current_message_id, getEditMenuText(updatedVideo), {
        reply_markup: getEditKeyboard(updatedVideo)
      })
      break
    }

    case 'waiting_tags': {
      // 删除用户消息
      await deleteTelegramMessage(chatId, userMessageId)

      const tags = text
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0)
      if (tags.length < 3 || tags.length > 5) {
        await sendSelfDestructMessage(chatId, '❌ 请输入 3-5 个标签，用空格分隔')
        return
      }

      // 更新标签
      await supabase.from('videos').update({ tags }).eq('id', video.id)

      // 重置状态
      await updateUserState(chatId, { state: 'idle' })

      // 重新获取视频并更新主消息
      const { data: updatedVideo2 } = await supabase
        .from('videos')
        .select('*')
        .eq('id', video.id)
        .single()

      await editMessage(chatId, userState.current_message_id, getEditMenuText(updatedVideo2), {
        reply_markup: getEditKeyboard(updatedVideo2)
      })
      break
    }

    // 🎯 从视频详情页编辑描述
    case 'editing_description': {
      await deleteTelegramMessage(chatId, userMessageId)

      if (text.length > 300) {
        await sendSelfDestructMessage(chatId, '❌ 描述最多 300 字，请重新输入')
        return
      }

      // 更新描述
      await supabase.from('videos').update({ description: text }).eq('id', video.id)

      // 重置状态
      await updateUserState(chatId, {
        state: 'idle',
        draft_video_id: null,
        current_message_id: null
      })

      // 返回视频详情页
      await handleViewVideo(chatId, userState.current_message_id, video.id)
      break
    }

    // 🎯 从视频详情页编辑标签
    case 'editing_tags': {
      await deleteTelegramMessage(chatId, userMessageId)

      const tags = text
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0)
      if (tags.length < 1) {
        await sendSelfDestructMessage(chatId, '❌ 请至少输入 1 个标签')
        return
      }

      // 更新标签
      await supabase.from('videos').update({ tags }).eq('id', video.id)

      // 重置状态
      await updateUserState(chatId, {
        state: 'idle',
        draft_video_id: null,
        current_message_id: null
      })

      // 返回视频详情页
      await handleViewVideo(chatId, userState.current_message_id, video.id)
      break
    }

    // 🎯 从视频详情页编辑位置
    // 🎯 editing_location_detail 现在使用位置消息，不再处理文本
    case 'editing_location_detail': {
      await deleteTelegramMessage(chatId, userMessageId)
      await sendSelfDestructMessage(
        chatId,
        '❌ 请发送位置信息（不是文本）\n\n点击下方的 📎 附件按钮选择"位置"',
        5
      )
      return
    }

    // 🎯 waiting_location 状态已在 handleLocation 中处理
    case 'waiting_location': {
      await deleteTelegramMessage(chatId, userMessageId)
      await sendSelfDestructMessage(
        chatId,
        '❌ 请发送位置信息（不是文本）\n\n点击下方的 📎 附件按钮选择"位置"',
        5
      )
      return
    }

    case 'editing_location': {
      await deleteTelegramMessage(chatId, userMessageId)

      // 解析位置：格式1: "城市 国家", 格式2: "国家"
      const parts = text.trim().split(/\s+/)
      let city = null
      let country = null

      if (parts.length === 1) {
        country = parts[0]
      } else if (parts.length >= 2) {
        city = parts[0]
        country = parts.slice(1).join(' ')
      }

      if (!country) {
        await sendSelfDestructMessage(chatId, '❌ 请输入有效的位置信息')
        return
      }

      // 更新位置
      await supabase
        .from('videos')
        .update({
          location_city: city,
          location_country: country,
          location_country_code: null // 简化处理，不设置国家代码
        })
        .eq('id', video.id)

      // 重置状态
      await updateUserState(chatId, {
        state: 'idle',
        draft_video_id: null,
        current_message_id: null
      })

      // 返回视频详情页
      await handleViewVideo(chatId, userState.current_message_id, video.id)
      break
    }
  }
}

// 处理位置消息
async function handleLocation(chatId: number, location: any, userMessageId: number) {
  const userState = await getUserState(chatId)

  if (
    !userState.draft_video_id ||
    !userState.current_message_id ||
    (userState.state !== 'waiting_location' && userState.state !== 'editing_location_detail')
  ) {
    return
  }

  const isEditingDetail = userState.state === 'editing_location_detail'

  try {
    // 删除用户位置消息
    await deleteTelegramMessage(chatId, userMessageId)

    // 在主消息上显示"识别中"
    await editMessage(chatId, userState.current_message_id, '🔄 正在识别位置...')

    const locationData = await getLocationFromCoords(location.latitude, location.longitude)

    // 更新视频位置
    await supabase
      .from('videos')
      .update({
        location_country: locationData.country,
        location_country_code: locationData.country_code,
        location_city: locationData.city
      })
      .eq('id', userState.draft_video_id)

    // 重置状态
    await updateUserState(chatId, { state: 'idle' })

    // 重新获取视频
    const { data: updatedVideo } = await supabase
      .from('videos')
      .select('*')
      .eq('id', userState.draft_video_id)
      .single()

    // 🎯 根据来源返回不同页面
    if (isEditingDetail) {
      // 从视频详情页编辑：返回详情页
      await handleViewVideo(chatId, userState.current_message_id, userState.draft_video_id)
    } else {
      // 从草稿编辑：返回编辑菜单
      await editMessage(chatId, userState.current_message_id, getEditMenuText(updatedVideo), {
        reply_markup: getEditKeyboard(updatedVideo)
      })
    }
  } catch (error) {
    console.error('位置识别失败:', error)
    await sendSelfDestructMessage(
      chatId,
      '❌ 位置识别失败\n\n' +
        '可能原因：\n' +
        '• 位置在海洋/无人区\n' +
        '• 地理服务暂时不可用\n\n' +
        '请稍后重试'
    )

    // 重新获取视频
    const { data: video } = await supabase
      .from('videos')
      .select('*')
      .eq('id', userState.draft_video_id)
      .single()

    await updateUserState(chatId, { state: 'idle' })

    if (video && userState.current_message_id) {
      // 🎯 根据来源恢复不同页面
      if (isEditingDetail) {
        await handleViewVideo(chatId, userState.current_message_id, userState.draft_video_id)
      } else {
        await editMessage(chatId, userState.current_message_id, getEditMenuText(video), {
          reply_markup: getEditKeyboard(video)
        })
      }
    }
  }
}

// 处理"使用说明"
async function handleHelp(chatId: number) {
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

  await sendMessage(chatId, text)
}

// 处理"个人中心"
async function handleUserProfile(chatId: number) {
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

    // 计算解锁状态
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
        ]
      ]
    }

    await sendMessage(chatId, text, { reply_markup: keyboard })
  } catch (error) {
    console.error('handleUserProfile error:', error)
    await sendMessage(chatId, '❌ 系统错误，请稍后重试')
  }
}

// 处理"邀请解锁"
async function handleInviteUnlock(chatId: number) {
  try {
    // 1. 获取用户邀请链接和统计
    const { data: profile } = await supabase
      .from('profiles')
      .select('numeric_id, invite_success_count, adult_unlock_until, adult_permanent_unlock')
      .eq('tg_user_id', chatId)
      .single()

    const inviteLink = `https://t.me/tg_douyin_bot?start=${profile?.numeric_id || ''}`
    const count = profile?.invite_success_count || 0

    // 2. 计算解锁状态
    let statusText = '🔒 未解锁'
    if (profile?.adult_permanent_unlock) {
      statusText = '♾️ 永久解锁'
    } else if (profile?.adult_unlock_until && new Date(profile.adult_unlock_until) > new Date()) {
      const until = new Date(profile.adult_unlock_until)
      const now = new Date()
      const diffHours = Math.ceil((until.getTime() - now.getTime()) / (1000 * 3600))
      statusText = `🔓 已解锁 (剩余 ${diffHours} 小时)`
    }

    // 3. 构建文案
    const text =
      `🔞 <b>邀请解锁无限刷</b>\n\n` +
      `当前状态：${statusText}\n` +
      `已邀请人数：${count} 人\n\n` +
      `<b>专属邀请链接：</b>\n` +
      `${inviteLink}\n` +
      `(点击上方链接复制)\n\n` +
      `<b>🎁 解锁规则：</b>\n` +
      `• 邀请 1 人 → 解锁 24 小时无限刷\n` +
      `• 邀请 2 人 → 解锁 3 天无限刷\n` +
      `• 邀请 3 人 → 永久解锁无限刷\n\n` +
      `<i>💡 好友通过您的链接启动机器人即算邀请成功</i>\n\n` +
      `<i>💡 此解锁针对🔞的内容，推荐页内容无需解锁</i>`

    await sendMessage(chatId, text)
  } catch (error) {
    console.error('handleInviteUnlock error:', error)
    await sendMessage(chatId, '❌ 获取邀请信息失败，请稍后重试')
  }
}

// 处理邀请逻辑
async function handleInvitation(inviteeId: string, inviterNumericId: number) {
  try {
    console.log(`[handleInvitation] 开始处理邀请: invitee=${inviteeId}, code=${inviterNumericId}`)

    // 1. 查找邀请人
    const { data: inviter } = await supabase
      .from('profiles')
      .select('id, invite_success_count, adult_permanent_unlock, adult_unlock_until')
      .eq('numeric_id', inviterNumericId)
      .single()

    if (!inviter) {
      console.log('[handleInvitation] 邀请人不存在')
      return
    }

    if (inviter.id === inviteeId) {
      console.log('[handleInvitation] 不能邀请自己')
      return
    }

    // 2. 检查被邀请人是否已被邀请（避免重复）
    // 同时也检查 created_at 防止老用户刷量
    const { data: invitee } = await supabase
      .from('profiles')
      .select('invited_by, created_at')
      .eq('id', inviteeId)
      .single()

    if (invitee?.invited_by) {
      console.log('[handleInvitation] 该用户已被邀请过')
      return
    }

    // 🎯 限制：只有注册时间在最近 1 小时内的用户才算“新用户邀请”
    // 这样老用户点击链接就不会增加邀请次数了
    if (invitee?.created_at) {
      const createdAt = new Date(invitee.created_at).getTime()
      const now = Date.now()
      const diffMinutes = (now - createdAt) / 1000 / 60
      if (diffMinutes > 60) {
        console.log('[handleInvitation] 老用户点击邀请链接，忽略统计', diffMinutes, '分钟前注册')
        // 可选：给老用户发个提示？暂时不发，避免打扰
        return
      }
    }

    // 3. 更新被邀请人信息
    await supabase.from('profiles').update({ invited_by: inviter.id }).eq('id', inviteeId)

    // 4. 更新邀请人统计和解锁状态
    const newCount = (inviter.invite_success_count || 0) + 1
    const updates: any = { invite_success_count: newCount }

    // 解锁逻辑
    if (newCount >= 3) {
      updates.adult_permanent_unlock = true
      updates.adult_unlock_until = null // 永久解锁后清除时间限制
    } else {
      let durationHours = 0
      if (newCount === 1) durationHours = 24
      if (newCount === 2) durationHours = 72 // 3天

      // 如果已经是永久解锁，跳过
      if (!inviter.adult_permanent_unlock) {
        // 如果当前有解锁时间，在当前时间基础上增加
        const currentUnlock = inviter.adult_unlock_until
          ? new Date(inviter.adult_unlock_until).getTime()
          : Date.now()

        // 如果当前时间已经过期，则从现在开始算
        const baseTime = Math.max(currentUnlock, Date.now())
        updates.adult_unlock_until = new Date(baseTime + durationHours * 3600 * 1000).toISOString()
      }
    }

    await supabase.from('profiles').update(updates).eq('id', inviter.id)

    // 5. 通知邀请人
    // 需要获取邀请人的 tg_user_id
    const { data: inviterProfile } = await supabase
      .from('profiles')
      .select('tg_user_id')
      .eq('id', inviter.id)
      .single()

    if (inviterProfile?.tg_user_id) {
      let rewardText = ''
      if (newCount === 1) rewardText = '获得 24小时 无限刷'
      else if (newCount === 2) rewardText = '获得 3天 无限刷'
      else if (newCount >= 3) rewardText = '获得 永久 无限刷'

      await sendMessage(
        inviterProfile.tg_user_id,
        `🎉 <b>邀请成功！</b>\n\n` +
          `您已成功邀请 ${newCount} 人\n` +
          `🎁 ${rewardText}\n\n` +
          `继续邀请可获得更多奖励！`
      )
    }

    console.log('[handleInvitation] 邀请处理完成')
  } catch (error) {
    console.error('[handleInvitation] 异常:', error)
  }
}

// 处理"我的视频"- 概览页
async function handleMyVideos(chatId: number) {
  try {
    // 获取用户的所有视频统计
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, status, like_count, comment_count, view_count')
      .eq('tg_user_id', chatId)

    if (error) {
      console.error('获取视频列表失败:', error)
      await sendMessage(chatId, '❌ 获取视频列表失败', {
        reply_markup: getPersistentKeyboard()
      })
      return
    }

    if (!videos || videos.length === 0) {
      await sendMessage(
        chatId,
        '📹 <b>我的视频</b>\n\n' + '暂无视频\n\n' + '<i>发送或转发视频即可上传</i>',
        {
          reply_markup: getPersistentKeyboard()
        }
      )
      return
    }

    // ✅ 分类统计（包括 processing, draft, ready, published）
    const processing = videos.filter((v) => v.status === 'processing')
    const drafts = videos.filter((v) => v.status === 'draft' || v.status === 'ready')
    const published = videos.filter((v) => v.status === 'published')

    // 总数据统计（已发布的视频）
    const totalPlays = published.reduce((sum, v) => sum + (v.view_count || 0), 0)
    const totalLikes = published.reduce((sum, v) => sum + (v.like_count || 0), 0)
    const totalComments = published.reduce((sum, v) => sum + (v.comment_count || 0), 0)

    const lines = [`📹 <b>我的视频</b>`, ``, `共 ${videos.length} 个视频`]

    // ✅ 添加上传中统计（如果有）
    if (processing.length > 0) {
      lines.push(
        `📤 上传中 ${processing.length} · 草稿 ${drafts.length} · 已发布 ${published.length}`
      )
    } else {
      lines.push(`草稿 ${drafts.length} · 已发布 ${published.length}`)
    }

    lines.push(``)
    lines.push(`📊 <b>数据总览</b>`)
    lines.push(`👀 浏览 ${totalPlays}    ❤️ 点赞 ${totalLikes}    💬 评论 ${totalComments}`)

    // ✅ 构建按钮（如果有上传中的视频，优先显示）
    const keyboard = []

    if (processing.length > 0) {
      keyboard.push([
        {
          text: `📤 查看上传中的视频 (${processing.length})`,
          callback_data: 'my_processing'
        }
      ])
    }

    if (drafts.length > 0) {
      keyboard.push([
        {
          text: `📝 继续编辑草稿 (${drafts.length})`,
          callback_data: 'my_drafts'
        }
      ])
    }

    if (published.length > 0) {
      keyboard.push([
        {
          text: `📺 我发布的视频 (${published.length})`,
          callback_data: 'my_published'
        }
      ])
    }

    await sendMessage(chatId, lines.join('\n'), {
      reply_markup: { inline_keyboard: keyboard }
    })
  } catch (error) {
    console.error('获取视频列表错误:', error)
    await sendMessage(chatId, '❌ 获取视频列表时出错', {
      reply_markup: getPersistentKeyboard()
    })
  }
}

// ✅ 新增：查看上传中的视频列表
async function handleMyProcessing(chatId: number, messageId: number) {
  try {
    const { data: videos, error } = await supabase
      .from('videos')
      .select('*')
      .eq('tg_user_id', chatId)
      .eq('status', 'processing')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('查询上传中视频失败:', error)
      await editMessage(chatId, messageId, '❌ 查询失败', {
        reply_markup: {
          inline_keyboard: [[{ text: '⬅️ 返回', callback_data: 'my_videos' }]]
        }
      })
      return
    }

    if (!videos || videos.length === 0) {
      await editMessage(chatId, messageId, `暂无上传中的视频`, {
        reply_markup: {
          inline_keyboard: [[{ text: '⬅️ 返回', callback_data: 'my_videos' }]]
        }
      })
      return
    }

    // 构建消息
    const lines = [`📤 <b>上传中的视频 (${videos.length})</b>`, ``]

    // 构建按钮（每个视频一个删除按钮）
    const keyboard = videos.map((video, index) => {
      const sizeMB = (video.file_size / 1024 / 1024).toFixed(1)
      const timeAgo = getTimeAgo(video.created_at)
      const desc = video.description ? safeTruncate(video.description, 25) : '未命名视频'

      lines.push(`${index + 1}. ${desc}`)
      lines.push(`   📦 ${sizeMB} MB · ⏱️ ${timeAgo}`)
      lines.push(``)

      return [
        {
          text: `${index + 1}. ${desc} (${sizeMB} MB)`,
          callback_data: `view_processing_${video.id}`
        },
        {
          text: '🗑️',
          callback_data: `delete_video_${video.id}`
        }
      ]
    })

    keyboard.push([{ text: '⬅️ 返回', callback_data: 'my_videos' }])

    lines.push(`💡 视频处理完成后会自动通知您`)

    await editMessage(chatId, messageId, lines.join('\n'), {
      reply_markup: {
        inline_keyboard: keyboard
      }
    })
  } catch (error) {
    console.error('处理上传中列表失败:', error)
    await editMessage(chatId, messageId, '❌ 查询失败', {
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ 返回', callback_data: 'my_videos' }]]
      }
    })
  }
}

// 辅助函数：计算时间差
function getTimeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = Math.floor((now - then) / 1000) // 秒

  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

// 处理"我的视频"- 编辑模式（用于返回时）
async function handleMyVideosEdit(chatId: number, messageId: number) {
  try {
    const { data: videos } = await supabase
      .from('videos')
      .select('id, status, like_count, comment_count, view_count')
      .eq('tg_user_id', chatId)

    if (!videos || videos.length === 0) {
      await editMessage(
        chatId,
        messageId,
        '📼 <b>我的影片</b>\n\n暂无视频\n\n<i>发送或转发视频即可上传</i>'
      )
      return
    }

    // ✅ 分类统计（与 handleMyVideos 保持一致）
    const processing = videos.filter((v) => v.status === 'processing')
    const drafts = videos.filter((v) => v.status === 'draft' || v.status === 'ready')
    const published = videos.filter((v) => v.status === 'published')

    const totalPlays = published.reduce((sum, v) => sum + (v.view_count || 0), 0)
    const totalLikes = published.reduce((sum, v) => sum + (v.like_count || 0), 0)
    const totalComments = published.reduce((sum, v) => sum + (v.comment_count || 0), 0)

    const lines = [`📹 <b>我的视频</b>`, ``, `共 ${videos.length} 个视频`]

    if (processing.length > 0) {
      lines.push(
        `📤 上传中 ${processing.length} · 草稿 ${drafts.length} · 已发布 ${published.length}`
      )
    } else {
      lines.push(`草稿 ${drafts.length} · 已发布 ${published.length}`)
    }

    lines.push(``)
    lines.push(`📊 <b>数据总览</b>`)
    lines.push(`👀 浏览 ${totalPlays}    ❤️ 点赞 ${totalLikes}    💬 评论 ${totalComments}`)

    const keyboard = []

    if (processing.length > 0) {
      keyboard.push([
        {
          text: `📤 查看上传中的视频 (${processing.length})`,
          callback_data: 'my_processing'
        }
      ])
    }

    if (drafts.length > 0) {
      keyboard.push([
        {
          text: `📝 继续编辑草稿 (${drafts.length})`,
          callback_data: 'my_drafts'
        }
      ])
    }

    if (published.length > 0) {
      keyboard.push([
        {
          text: `📺 我发布的视频 (${published.length})`,
          callback_data: 'my_published'
        }
      ])
    }

    await editMessage(chatId, messageId, lines.join('\n'), {
      reply_markup: { inline_keyboard: keyboard }
    })
  } catch (error) {
    console.error('获取视频列表错误:', error)
  }
}

// 处理"我发布的视频"列表
async function handleMyPublished(chatId: number, messageId: number) {
  console.log('[handleMyPublished] 开始获取已发布视频, chatId:', chatId, 'messageId:', messageId)

  try {
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, description, like_count, comment_count, view_count, is_private')
      .eq('tg_user_id', chatId)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(10)

    console.log('[handleMyPublished] 查询结果:', {
      videosCount: videos?.length || 0,
      error: error?.message
    })

    if (error) {
      console.error('[handleMyPublished] 查询失败:', error)
      await editMessage(chatId, messageId, '❌ 获取视频失败\n\n' + error.message, {
        reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'back_my_videos' }]] }
      })
      return
    }

    if (!videos || videos.length === 0) {
      console.log('[handleMyPublished] 无已发布视频')
      await editMessage(chatId, messageId, '📺 暂无已发布的视频', {
        reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'back_my_videos' }]] }
      })
      return
    }

    const lines = ['📺 <b>我发布的视频</b>', '']

    // 🎯 构建按钮（每个视频一个按钮：查看详情，私密视频显示🔒）
    const keyboard = videos.map((v) => {
      const privacyIcon = v.is_private ? '🔒 ' : ''
      const desc = v.description ? safeTruncate(v.description, 20) : '无描述'
      const stats = `👀${v.view_count || 0} ❤️${v.like_count || 0}`
      return [
        {
          text: `${privacyIcon}${desc}  ${stats}`,
          callback_data: `view_video_${v.id}`
        }
      ]
    })

    keyboard.push([{ text: '← 返回', callback_data: 'back_my_videos' }])

    console.log('[handleMyPublished] 准备编辑消息, 按钮数:', keyboard.length)

    await editMessage(chatId, messageId, lines.join('\n'), {
      reply_markup: { inline_keyboard: keyboard }
    })

    console.log('[handleMyPublished] 完成')
  } catch (error) {
    console.error('[handleMyPublished] 发生错误:', error)
    console.error(
      '[handleMyPublished] 错误堆栈:',
      error instanceof Error ? error.stack : String(error)
    )
    try {
      await editMessage(
        chatId,
        messageId,
        '❌ 发生错误\n\n' + (error instanceof Error ? error.message : String(error)),
        {
          reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'back_my_videos' }]] }
        }
      )
    } catch (editError) {
      console.error('[handleMyPublished] 编辑消息也失败了:', editError)
    }
  }
}

// 处理"我的草稿"列表
async function handleMyDrafts(chatId: number, messageId: number) {
  console.log('[handleMyDrafts] 开始获取草稿列表, chatId:', chatId, 'messageId:', messageId)

  try {
    // ✅ 查询草稿和就绪状态的视频（不包括 processing）
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, description, created_at, status')
      .eq('tg_user_id', chatId)
      .in('status', ['draft', 'ready'])
      .order('created_at', { ascending: false })
      .limit(10)

    console.log('[handleMyDrafts] 查询结果:', {
      videosCount: videos?.length || 0,
      error: error?.message
    })

    if (error) {
      console.error('[handleMyDrafts] 查询失败:', error)
      await editMessage(chatId, messageId, '❌ 获取草稿失败\n\n' + error.message, {
        reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'back_my_videos' }]] }
      })
      return
    }

    if (!videos || videos.length === 0) {
      console.log('[handleMyDrafts] 无草稿')
      await editMessage(chatId, messageId, '📝 暂无草稿', {
        reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'back_my_videos' }]] }
      })
      return
    }

    const lines = ['📝 <b>我的草稿</b>', '']

    // ✅ 构建按钮（每个草稿两个按钮：编辑和删除）
    const keyboard = videos.map((v) => {
      const desc = v.description ? safeTruncate(v.description, 20) : '无描述'
      return [
        {
          text: `📝 ${desc}`,
          callback_data: `edit_draft_${v.id}`
        },
        {
          text: '🗑️',
          callback_data: `delete_video_${v.id}`
        }
      ]
    })

    keyboard.push([{ text: '← 返回', callback_data: 'back_my_videos' }])

    console.log('[handleMyDrafts] 准备编辑消息, 按钮数:', keyboard.length)

    await editMessage(chatId, messageId, lines.join('\n'), {
      reply_markup: { inline_keyboard: keyboard }
    })

    console.log('[handleMyDrafts] 完成')
  } catch (error) {
    console.error('[handleMyDrafts] 发生错误:', error)
    console.error(
      '[handleMyDrafts] 错误堆栈:',
      error instanceof Error ? error.stack : String(error)
    )
    try {
      await editMessage(
        chatId,
        messageId,
        '❌ 发生错误\n\n' + (error instanceof Error ? error.message : String(error)),
        {
          reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'back_my_videos' }]] }
        }
      )
    } catch (editError) {
      console.error('[handleMyDrafts] 编辑消息也失败了:', editError)
    }
  }
}

// 处理"查看视频详情"
async function handleViewVideo(chatId: number, messageId: number, videoId: string) {
  console.log('[handleViewVideo] 开始获取视频详情, chatId:', chatId, 'videoId:', videoId)

  try {
    const { data: video, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .single()

    console.log('[handleViewVideo] 查询结果:', { hasVideo: !!video, error: error?.message })

    if (error) {
      console.error('[handleViewVideo] 查询失败:', error)
      await editMessage(chatId, messageId, '❌ 获取视频失败\n\n' + error.message, {
        reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'my_published' }]] }
      })
      return
    }

    if (!video) {
      console.log('[handleViewVideo] 视频不存在')
      await editMessage(chatId, messageId, '❌ 视频不存在', {
        reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'my_published' }]] }
      })
      return
    }

    // 描述
    let descText = '未设置'
    if (video.description) {
      descText = safeTruncate(video.description, 200)
    }

    // 标签
    let tagsText = '未设置'
    if (video.tags && video.tags.length > 0) {
      tagsText = video.tags.map((t: string) => '#' + t).join(' ')
    }

    // 位置
    let locationText = '未设置'
    if (video.location_country) {
      locationText = getFlag(video.location_country_code!) + ' ' + video.location_country
      if (video.location_city) {
        locationText += ' · ' + video.location_city
      }
    }

    const lines = [
      `📺 <b>视频详情</b>`,
      ``,
      `📝 描述：${descText}`,
      `🏷️ 标签：${tagsText}`,
      `📍 位置：${locationText}`,
      `${video.is_private ? '🔒' : '🌍'} 状态：${video.is_private ? '私密' : '公开'}`,
      ``,
      `📊 <b>数据统计</b>`,
      `👀 浏览：${video.view_count || 0}`,
      `❤️ 点赞：${video.like_count || 0}`,
      `💬 评论：${video.comment_count || 0}`
    ]

    // 🎯 构建按钮（详情底部的完整编辑功能）
    const keyboard = []

    // 第一行：编辑描述和标签
    keyboard.push([
      {
        text: video.description ? '✏️ 修改描述' : '📝 添加描述',
        callback_data: `edit_desc_detail:${video.id}`
      },
      {
        text: video.tags && video.tags.length > 0 ? '✏️ 修改标签' : '🏷️ 添加标签',
        callback_data: `edit_tags_detail:${video.id}`
      }
    ])

    // 第二行：编辑位置和切换私密状态
    keyboard.push([
      {
        text: video.location_country ? '✏️ 修改位置' : '📍 添加位置',
        callback_data: `edit_location_detail:${video.id}`
      },
      {
        text: video.is_private ? '🌍 设为公开' : '🔒 设为私密',
        callback_data: `toggle_privacy_detail:${video.id}`
      }
    ])

    // 第三行：置顶功能（仅已发布视频）
    if (video.status === 'published') {
      keyboard.push([
        {
          text: video.is_top ? '📍 取消置顶' : '📌 置顶该视频',
          callback_data: `toggle_pin_detail:${video.id}`
        }
      ])
    }

    // 第四行：删除按钮
    keyboard.push([
      {
        text: '🗑️ 删除视频',
        callback_data: `delete_video_detail:${video.id}`
      }
    ])

    // 最后一行：返回按钮
    keyboard.push([{ text: '← 返回列表', callback_data: 'my_published' }])

    console.log('[handleViewVideo] 准备编辑消息')

    await editMessage(chatId, messageId, lines.join('\n'), {
      reply_markup: { inline_keyboard: keyboard }
    })

    console.log('[handleViewVideo] 完成')
  } catch (error) {
    console.error('[handleViewVideo] 发生错误:', error)
    console.error(
      '[handleViewVideo] 错误堆栈:',
      error instanceof Error ? error.stack : String(error)
    )
    try {
      await editMessage(
        chatId,
        messageId,
        '❌ 发生错误\n\n' + (error instanceof Error ? error.message : String(error)),
        {
          reply_markup: { inline_keyboard: [[{ text: '← 返回', callback_data: 'my_published' }]] }
        }
      )
    } catch (editError) {
      console.error('[handleViewVideo] 编辑消息也失败了:', editError)
    }
  }
}

// 发布视频（提交审核）
async function publishVideo(chatId: number, messageId: number, videoId: string) {
  try {
    // 1. 检查用户是否有自动审核权限，同时获取 id 和 nickname 用于通知
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, nickname, auto_approve')
      .eq('tg_user_id', chatId)
      .single()

    const autoApprove = profile?.auto_approve === true
    const authorId = profile?.id
    const authorNickname = profile?.nickname || '用户'

    // 2. 根据是否自动审核决定状态
    let newStatus: string
    let newReviewStatus: string
    let successMessage: string[]

    if (autoApprove) {
      // ✅ 老用户：自动通过审核，直接发布
      newStatus = 'published'
      newReviewStatus = 'auto_approved'
      successMessage = ['🎉 <b>发布成功！</b>', '', '视频已发布。']
    } else {
      // 🕐 新用户：需要人工审核
      newStatus = 'ready'
      newReviewStatus = 'pending'
      successMessage = [
        '✅ <b>提交成功！</b>',
        '',
        '您的内容已提交审核',
        '审核通过后将自动发布到首页',
        '',
        '💡 首次发布需要审核，后续发布将自动通过'
      ]
    }

    // 3. 更新视频状态
    const { data: video, error } = await supabase
      .from('videos')
      .update({
        status: newStatus,
        review_status: newReviewStatus,
        published_at: autoApprove ? new Date().toISOString() : null
      })
      .eq('id', videoId)
      .select()
      .single()

    if (error) {
      console.error('发布失败:', error)
      await editMessage(chatId, messageId, '❌ 发布失败\n\n' + '错误: ' + error.message)
      return
    }

    // 清除用户状态
    await updateUserState(chatId, { state: 'idle', draft_video_id: null, current_message_id: null })

    // 构建成功消息
    if (video.description) {
      const desc = safeTruncate(video.description, 50)
      successMessage.push(`📝 ${desc}`)
    }
    if (video.tags && video.tags.length > 0) {
      successMessage.push(`🏷️ ${video.tags.map((t: string) => '#' + t).join(' ')}`)
    }
    if (video.location_country) {
      let loc = getFlag(video.location_country_code!) + ' ' + video.location_country
      if (video.location_city) loc += ' · ' + video.location_city
      successMessage.push(`📍 ${loc}`)
    }

    await editMessage(chatId, messageId, successMessage.join('\n'))

    // 🎯 自动发布成功后，通知粉丝
    if (autoApprove && authorId) {
      // 异步通知，不阻塞主流程
      notifyFollowersNewPost(authorId, authorNickname, videoId, video.description).catch((e) => {
        console.error('[publishVideo] 通知粉丝失败:', e)
      })
    }
  } catch (error) {
    console.error('发布错误:', error)
    await editMessage(chatId, messageId, '❌ 发布时发生错误，请重试')
  }
}

async function toggleVideoPin(video: any) {
  if (video.is_top) {
    // 取消置顶
    await supabase.from('videos').update({ is_top: false }).eq('id', video.id)
  } else {
    // 置顶：先检查当前置顶视频数量
    const filterField = video.tg_user_id ? 'tg_user_id' : 'author_id'
    const filterValue = video.tg_user_id ?? video.author_id

    if (filterField && filterValue) {
      // 查询当前置顶视频数量
      const { data: pinnedVideos, error } = await supabase
        .from('videos')
        .select('id')
        .eq(filterField, filterValue)
        .eq('is_top', true)
        .eq('status', 'published')

      // 🎯 限制最多3个置顶视频
      if (pinnedVideos && pinnedVideos.length >= 3) {
        throw new Error('最多只能置顶3个视频')
      }
    }

    await supabase.from('videos').update({ is_top: true }).eq('id', video.id)
  }

  const { data: refreshed } = await supabase.from('videos').select('*').eq('id', video.id).single()

  return refreshed
}

// 删除视频
async function handleDeleteVideo(
  chatId: number,
  messageId: number,
  videoId: string,
  callbackQueryId: string
) {
  try {
    // 查询视频状态，确定返回哪个列表
    const { data: video } = await supabase
      .from('videos')
      .select('status')
      .eq('id', videoId)
      .eq('tg_user_id', chatId)
      .maybeSingle()

    if (!video) {
      await answerCallbackQuery(callbackQueryId, '视频不存在或无权限')
      return
    }

    const status = video.status

    // 删除视频
    const { error } = await supabase
      .from('videos')
      .delete()
      .eq('id', videoId)
      .eq('tg_user_id', chatId)

    if (error) {
      console.error('删除视频失败:', error)
      await answerCallbackQuery(callbackQueryId, '删除失败，请重试')
      return
    }

    await answerCallbackQuery(callbackQueryId, '已删除')

    // 根据原视频状态返回对应列表
    if (status === 'published') {
      await handleMyPublished(chatId, messageId)
    } else if (status === 'processing') {
      await handleMyProcessing(chatId, messageId)
    } else {
      // draft 或 ready
      await handleMyDrafts(chatId, messageId)
    }
  } catch (error) {
    console.error('删除视频错误:', error)
    await answerCallbackQuery(callbackQueryId, '删除失败')
  }
}

// 🎯 从视频详情页删除视频
async function handleDeleteVideoFromDetail(
  chatId: number,
  messageId: number,
  videoId: string,
  callbackQueryId: string
) {
  try {
    // 查询视频状态
    const { data: video } = await supabase
      .from('videos')
      .select('status')
      .eq('id', videoId)
      .eq('tg_user_id', chatId)
      .maybeSingle()

    if (!video) {
      await answerCallbackQuery(callbackQueryId, '视频不存在或无权限')
      return
    }

    // 删除视频
    const { error } = await supabase
      .from('videos')
      .delete()
      .eq('id', videoId)
      .eq('tg_user_id', chatId)

    if (error) {
      console.error('删除视频失败:', error)
      await answerCallbackQuery(callbackQueryId, '❌ 删除失败，请重试')
      return
    }

    await answerCallbackQuery(callbackQueryId, '✅ 已删除')

    // 返回到已发布视频列表
    await handleMyPublished(chatId, messageId)
  } catch (error) {
    console.error('删除视频错误:', error)
    await answerCallbackQuery(callbackQueryId, '❌ 删除失败')
  }
}

// 🎯 处理隐私设置
async function handlePrivacySettings(chatId: number) {
  try {
    // 获取用户隐私设置
    const { data: profile } = await supabase
      .from('profiles')
      .select('show_collect, show_like, show_tg_username')
      .eq('tg_user_id', chatId)
      .single()

    if (!profile) {
      await sendMessage(chatId, '❌ 获取隐私设置失败', {
        reply_markup: getPersistentKeyboard()
      })
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
      [
        {
          text: showCollect ? '🌍 收藏公开' : '🔒 收藏私密',
          callback_data: 'toggle_show_collect'
        }
      ],
      [
        {
          text: showLike ? '🌍 喜欢公开' : '🔒 喜欢私密',
          callback_data: 'toggle_show_like'
        }
      ],
      [
        {
          text: showTgUsername ? '✅ 显示Tg用户名' : '❌ 隐藏Tg用户名',
          callback_data: 'toggle_show_tg_username'
        }
      ]
    ]

    await sendMessage(chatId, lines.join('\n'), {
      reply_markup: { inline_keyboard: keyboard }
    })
  } catch (error) {
    console.error('获取隐私设置错误:', error)
    await sendMessage(chatId, '❌ 获取隐私设置失败', {
      reply_markup: getPersistentKeyboard()
    })
  }
}

// 🎯 处理隐私设置（编辑消息版本）
async function handlePrivacySettingsEdit(chatId: number, messageId: number) {
  try {
    // 获取用户隐私设置
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
      [
        {
          text: showCollect ? '🌍 收藏公开' : '🔒 收藏私密',
          callback_data: 'toggle_show_collect'
        }
      ],
      [
        {
          text: showLike ? '🌍 喜欢公开' : '🔒 喜欢私密',
          callback_data: 'toggle_show_like'
        }
      ],
      [
        {
          text: showTgUsername ? '✅ 显示Tg用户名' : '❌ 隐藏Tg用户名',
          callback_data: 'toggle_show_tg_username'
        }
      ]
    ]

    await editMessage(chatId, messageId, lines.join('\n'), {
      reply_markup: { inline_keyboard: keyboard }
    })
  } catch (error) {
    console.error('获取隐私设置错误:', error)
    await editMessage(chatId, messageId, '❌ 获取隐私设置失败')
  }
}

// 主服务
serve(async (req) => {
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
              // 必须是新用户才算有效邀请（通过检查是否已有 invited_by 来近似判断，或依赖 profile 的 created_at 如果有的话）
              // 但目前 handleInvitation 内部只检查了 invitee.invited_by 是否为空。
              // 为了防止老用户刷量，我们应该在这里加一个限制：只有当用户还没有 invited_by 时才调用。
              // 更好的做法是：如果是老用户点击，提示“您已经是老用户了”；如果是新用户，提示“邀请成功”。
              // 这里的 profile 是刚刚 getOrCreate 的。
              // 我们检查一下数据库里的 created_at (如果 profile 对象里没有，需要 fetch)
              // 由于 getOrCreateProfile 返回的可能不够全，我们在 handleInvitation 里做更严格的检查。

              // 如果 inviteCode 是数字且不是自己
              if (/^\d+$/.test(inviteCode) && String(inviteCode) !== String(profile.numeric_id)) {
                await handleInvitation(profile.id, parseInt(inviteCode))
              }
            }

            await sendMessage(
              chatId,
              '👋 <b>欢迎使用视频上传</b>\n\n' +
                '✅ 账号已准备就绪\n\n' +
                '直接发送或转发视频即可上传\n\n' +
                '支持功能：\n' +
                '• 自动识别转发文案\n' +
                '• 描述、标签、位置\n' +
                '• 隐私设置\n' +
                '• 草稿保存',
              {
                reply_markup: getPersistentKeyboard()
              }
            )
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
        // "我的视频"按钮
        else if (message.text === '📹 我的视频') {
          await handleMyVideos(chatId)
        }
        // "个人中心"按钮
        else if (message.text === '👤 个人中心') {
          await handleUserProfile(chatId)
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
})
