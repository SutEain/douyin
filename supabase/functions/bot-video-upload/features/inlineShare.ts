import { BOT_TOKEN, TG_API_BASE, TG_MINIAPP_URL } from '../env.ts'
import { supabase } from '../supabaseClient.ts'

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
    const startUrl = `https://t.me/tg_douyin_bot?start=${numericId || ''}`

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
      const deepLink = `${TG_MINIAPP_URL}?startapp=live_${roomId}${inviteSuffix}`

      const result = {
        type: 'article',
        id: `live_${roomId}`,
        title: `📺 正在直播: ${room.title || '精彩内容'}`,
        description: selfRoom
          ? `主播: ${selfRoom.anchor?.nickname || '匿名'}`
          : '点击进入直播间互动',
        thumb_url: coverUrl,
        input_message_content: {
          message_text: `<b>📺 正在直播: ${room.title || '精彩内容'}</b>\n\n快进入直播间一起互动吧！🚀`,
          parse_mode: 'HTML',
          disable_web_page_preview: false
        },
        reply_markup: {
          inline_keyboard: [[{ text: '🚀 立即进入直播间', url: deepLink }]]
        }
      }

      await answerInlineQuery(queryId, [result])
      return
    }
  }

  // ✅ 3. 视频分享：检查查询格式 video_{videoId}
  if (trimmed.startsWith('video_')) {
    let videoId = trimmed.replace('video_', '')
    if (videoId.includes('_i')) {
      videoId = videoId.split('_i')[0]
    }

    console.log('[InlineQuery] ✅ 提取视频ID:', videoId)

    const { data: video } = await supabase
      .from('videos')
      .select('id, description, status, cover_url')
      .eq('id', videoId)
      .single()

    if (video && video.status === 'published') {
      const { data: sharer } = await supabase
        .from('profiles')
        .select('numeric_id')
        .eq('tg_user_id', userId)
        .single()
      const inviteSuffix = sharer?.numeric_id ? `_i${sharer.numeric_id}` : ''
      const deepLink = `${TG_MINIAPP_URL}?startapp=video_${videoId}${inviteSuffix}`

      const result = {
        type: 'article',
        id: `video_${videoId}`,
        title: '🎬 精彩视频分享',
        description: video.description || '点击打开观看',
        thumb_url: video.cover_url || '',
        input_message_content: {
          message_text: `<b>🎬 视频分享</b>\n\n${video.description || '这段视频太精彩了，不容错过！'}\n\n👇 点击下方按钮立即观看`,
          parse_mode: 'HTML',
          disable_web_page_preview: false
        },
        reply_markup: {
          inline_keyboard: [[{ text: '👉 立即播放', url: deepLink }]]
        }
      }

      await answerInlineQuery(queryId, [result])
      return
    }
  }

  // ✅ 4. 关键词搜索：描述 + 标签（全站已发布，最多5条，按发布时间倒序）
  const keyword = trimmed
  console.log('[InlineQuery] ✅ 关键词搜索', { userId, keyword })

  const { data: sharer } = await supabase
    .from('profiles')
    .select('numeric_id')
    .eq('tg_user_id', userId)
    .single()
  const inviteSuffix = sharer?.numeric_id ? `_i${sharer.numeric_id}` : ''

  const safe = keyword.replace(/[(),]/g, ' ').trim()
  const like = `%${safe}%`
  const tag = safe.startsWith('#') ? safe.slice(1).trim() : safe
  const safeTag = tag.replace(/[{},]/g, ' ').trim()

  const filter = safeTag
    ? `description.ilike.${like},tags.cs.{${safeTag}}`
    : `description.ilike.${like}`

  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, description, status, published_at, cover_url')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(5)
    .or(filter)

  if (error || !videos || videos.length === 0) {
    console.log('[InlineQuery] ⚠️ 无搜索结果')
    await answerInlineQuery(queryId, [])
    return
  }

  const results = videos.map((v: any, idx: number) => {
    const videoId = v.id
    const deepLink = `${TG_MINIAPP_URL}?startapp=video_${videoId}${inviteSuffix}`
    const fullDesc = v.description || ''
    const title = fullDesc ? fullDesc.substring(0, 24) : `🎬 视频 ${idx + 1}`
    const desc = fullDesc ? fullDesc.substring(0, 80) : '点击打开观看'

    return {
      type: 'article',
      id: `search_${videoId}`,
      title,
      description: desc,
      thumb_url: v.cover_url || '',
      input_message_content: {
        message_text: `<b>🎬 搜到精彩视频</b>\n\n${fullDesc}\n\n👇 点击下方按钮立即观看`,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      },
      reply_markup: {
        inline_keyboard: [[{ text: '👉 立即查看', url: deepLink }]]
      }
    }
  })

  await answerInlineQuery(queryId, results)
  console.log('[InlineQuery] ========== 处理完成 ==========')
}
