import { BOT_TOKEN, TG_API_BASE, TG_MINIAPP_URL, TG_MINIAPP_TME_URL } from '../env.ts'
import { supabase } from '../supabaseClient.ts'

// 🎯 辅助函数：转义 HTML 特殊字符，防止 Telegram 解析报错
function escapeHTML(str: string): string {
  if (!str) return ''
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return m
    }
  })
}

// 🎯 处理 inline query（分享功能）
async function answerInlineQuery(inlineQueryId: string, results: any[]) {
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/answerInlineQuery`
  const payload = {
    inline_query_id: inlineQueryId,
    results,
    // ✅ 结果与用户相关（包含个人邀请码），必须 personal，避免缓存串号
    is_personal: true,
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

// 🎯 处理 inline query
export async function handleInlineQuery(inlineQuery: any) {
  console.log('[InlineQuery] ========== 开始处理 ==========')
  console.log('[InlineQuery] 完整 inlineQuery:', JSON.stringify(inlineQuery, null, 2))

  const queryId = inlineQuery.id
  const query = inlineQuery.query || ''
  const userId = inlineQuery.from.id

  console.log('[InlineQuery] 解析参数:', { queryId, query, userId })

  const trimmed = String(query).trim()

  // ✅ 1. 空查询：直接返回“个人专属推广卡”
  if (!trimmed) {
    console.log('[InlineQuery] ✅ 空查询，返回推广卡', { userId })

    const { data: sharer } = await supabase
      .from('profiles')
      .select('numeric_id')
      .eq('tg_user_id', userId)
      .single()

    const numericId = sharer?.numeric_id
    const startUrl = `https://t.me/dydy?start=${numericId || ''}`

    const welcomeText =
      '<b>👋 欢迎来到 TG 抖音 🚀</b>\n' +
      '<b>Telegram 最大的视频&amp;直播分享平台!</b>🌍\n\n' +
      '<b>🔥 这里有你想要的精彩内容 🔥</b>\n' +
      '📰 全球资讯 •  🍉 热门八卦 •  💥 网络热点  \n' +
      '🔞 成人专区 •  🎤 娱乐直播 •  🌏 东南亚板块\n' +
      '🌟 更多内容等你来探索！ \n\n' +
      '<b>🚀 诚邀您成为我们的“内容共建官”！</b>\n' +
      '📱 发现有趣视频？随手分享给我们  \n' +
      '🎯 你的分享，将被千万用户看见  \n' +
      '💎 优质内容创作者，更有专属福利\n\n' +
      '<b>💬 互动|分享|发现|快乐|尽在TG抖音！❤️</b>'

    const result = {
      type: 'article',
      id: `promo_${numericId || '0'}`,
      title: '🌟 送你专属邀请链接',
      description: '点击分享，解锁无限成人内容',
      input_message_content: {
        message_text: welcomeText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      },
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🚀 立即解锁无限内容',
              url: startUrl
            }
          ]
        ]
      }
    }

    await answerInlineQuery(queryId, [result])
    return
  }

  // ✅ 2. 直播分享：检查查询格式 live_{roomId}
  if (trimmed.startsWith('live_')) {
    let roomId = trimmed.replace('live_', '')
    if (roomId.includes('_i')) {
      roomId = roomId.split('_i')[0]
    }

    console.log('[InlineQuery] ✅ 提取直播间ID:', roomId)

    // 获取直播间信息和封面图
    const { data: selfRoom } = await supabase
      .from('live_broadcast_rooms')
      .select('id, title, anchor:profiles(avatar_url, nickname)')
      .eq('id', roomId)
      .maybeSingle()

    const { data: extRoom } = await supabase
      .from('live_rooms')
      .select('id, title, cover_url')
      .eq('id', roomId)
      .maybeSingle()

    const room = selfRoom || extRoom
    if (room) {
      const coverUrl = extRoom?.cover_url || selfRoom?.anchor?.avatar_url || ''
      const { data: sharer } = await supabase
        .from('profiles')
        .select('numeric_id')
        .eq('tg_user_id', userId)
        .single()
      const inviteSuffix = sharer?.numeric_id ? `_i${sharer.numeric_id}` : ''
      const tmeUrl = TG_MINIAPP_TME_URL || 'https://t.me/dydy/tgdouyin'
      const deepLink = `${tmeUrl}?startapp=live_${roomId}${inviteSuffix}`

      const result: any = {
        type: 'article',
        id: `live_${roomId}`,
        title: `📺 正在直播: ${room.title || '精彩内容'}`,
        description: selfRoom
          ? `主播: ${selfRoom.anchor?.nickname || '匿名'}`
          : '点击发送直播间卡片',
        input_message_content: {
          message_text: `📺 <b><a href="${deepLink}">${escapeHTML(room.title || '精彩内容')}</a></b>\n\n主播：${escapeHTML(selfRoom?.anchor?.nickname || '抖音精选')}\n\n来自 #TG抖音 🚀`,
          parse_mode: 'HTML',
          disable_web_page_preview: false
        },
        reply_markup: {
          inline_keyboard: [[{ text: '👉 立即进入直播间', url: deepLink }]]
        }
      }

      if (coverUrl && (coverUrl.startsWith('http://') || coverUrl.startsWith('https://'))) {
        result.thumb_url = coverUrl
      }

      await answerInlineQuery(queryId, [result])
      return
    }
  }

  // ✅ 3. 视频直接分享或搜索：检查查询格式 video_{videoId} 或直接是 UUID
  const isVideoDirect = trimmed.startsWith('video_')
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  let potentialVideoId = isVideoDirect ? trimmed.replace('video_', '') : trimmed

  if (potentialVideoId.includes('_i')) {
    potentialVideoId = potentialVideoId.split('_i')[0]
  }

  // 如果是 video_ 开头或者是标准的 UUID 格式，尝试直接查找该视频
  if (isVideoDirect || uuidRegex.test(potentialVideoId)) {
    console.log('[InlineQuery] 🎯 尝试直接查找视频 ID:', potentialVideoId)

    const { data: video } = await supabase
      .from('videos')
      .select('id, description, title, status, cover_url')
      .eq('id', potentialVideoId)
      .maybeSingle()

    if (video && video.status === 'published') {
      const { data: sharer } = await supabase
        .from('profiles')
        .select('numeric_id')
        .eq('tg_user_id', userId)
        .single()
      const inviteSuffix = sharer?.numeric_id ? `_i${sharer.numeric_id}` : ''
      const tmeUrl = TG_MINIAPP_TME_URL || 'https://t.me/dydy/tgdouyin'
      const deepLink = `${tmeUrl}?startapp=video_${video.id}${inviteSuffix}`

      const result: any = {
        type: 'article',
        id: `video_${video.id}`,
        title: video.title || '🎬 精彩视频分享',
        description: video.description || '点击打开观看',
        input_message_content: {
          message_text: `🎬 <b><a href="${deepLink}">${escapeHTML(video.title || '视频分享')}</a></b>\n\n${escapeHTML(video.description || '这段视频太精彩了，不容错过！')}\n\n来自 #TG抖音 🚀`,
          parse_mode: 'HTML',
          disable_web_page_preview: false
        },
        reply_markup: {
          inline_keyboard: [[{ text: '👉 立即观看', url: deepLink }]]
        }
      }

      if (
        video.cover_url &&
        (video.cover_url.startsWith('http://') || video.cover_url.startsWith('https://'))
      ) {
        result.thumb_url = video.cover_url
      }

      await answerInlineQuery(queryId, [result])
      return
    }
  }

  // ✅ 4. 关键词搜索：描述 + 标题 + 标签（全站已发布，按发布时间倒序）
  const keyword = trimmed
  console.log('[InlineQuery] 🔍 关键词搜索:', { userId, keyword })

  const { data: sharer } = await supabase
    .from('profiles')
    .select('numeric_id')
    .eq('tg_user_id', userId)
    .single()
  const inviteSuffix = sharer?.numeric_id ? `_i${sharer.numeric_id}` : ''

  // 这里的搜索逻辑需要更强大，同时搜索描述、标题和标签
  const safe = keyword.replace(/[()'"%,]/g, ' ').trim()
  const like = `%${safe}%`
  const tag = safe.startsWith('#') ? safe.slice(1).trim() : safe
  const safeTag = tag.replace(/[{},]/g, ' ').trim()

  // 构建更宽泛的 OR 过滤条件
  const filter = safeTag
    ? `description.ilike.${like},title.ilike.${like},tags.cs.{${safeTag}}`
    : `description.ilike.${like},title.ilike.${like}`

  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, title, description, status, published_at, cover_url, is_adult')
    .eq('status', 'published')
    .or(filter)
    .order('published_at', { ascending: false })
    .limit(20) // 增加到 20 条，方便用户滚动查找

  if (error || !videos || videos.length === 0) {
    console.log('[InlineQuery] ⚠️ 无搜索结果或发生错误:', error)
    await answerInlineQuery(queryId, [])
    return
  }

  const tmeUrl = TG_MINIAPP_TME_URL || 'https://t.me/dydy/tgdouyin'

  const results = videos.map((v: any, idx: number) => {
    const videoId = v.id
    const deepLink = `${tmeUrl}?startapp=video_${videoId}${inviteSuffix}`
    const fullDesc = v.description || ''
    const videoTitle = v.title || (fullDesc ? fullDesc.substring(0, 24) : `🎬 视频 ${idx + 1}`)
    const desc = fullDesc ? fullDesc.substring(0, 80) : '点击打开观看'

    const escapedTitle = escapeHTML(videoTitle)
    const escapedDesc = escapeHTML(fullDesc)

    const item: any = {
      type: 'article',
      id: `search_${videoId}`,
      title: videoTitle,
      description: desc,
      input_message_content: {
        message_text: `🎬 <b><a href="${deepLink}">${escapedTitle}</a></b>\n\n${escapedDesc || '这段视频太精彩了，不容错过！'}\n\n来自 #TG抖音 🚀`,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      },
      reply_markup: {
        inline_keyboard: [[{ text: '👉 立即观看', url: deepLink }]]
      }
    }

    if (v.cover_url && (v.cover_url.startsWith('http://') || v.cover_url.startsWith('https://'))) {
      item.thumb_url = v.cover_url
    }

    return item
  })

  await answerInlineQuery(queryId, results)
  console.log('[InlineQuery] ========== 处理完成 ==========')
}
