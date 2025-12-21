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

// 🎯 处理 inline query - 视频分享
export async function handleInlineQuery(inlineQuery: any) {
  console.log('[InlineQuery] ========== 开始处理 ==========')
  console.log('[InlineQuery] 完整 inlineQuery:', JSON.stringify(inlineQuery, null, 2))

  const queryId = inlineQuery.id
  const query = inlineQuery.query || ''
  const userId = inlineQuery.from.id

  console.log('[InlineQuery] 解析参数:', { queryId, query, userId })

  const trimmed = String(query).trim()

  // ✅ 空查询：直接返回“个人专属推广卡”
  if (!trimmed) {
    console.log('[InlineQuery] ✅ 空查询，返回推广卡', { userId })

    const { data: sharer } = await supabase
      .from('profiles')
      .select('numeric_id')
      .eq('tg_user_id', userId)
      .single()

    const numericId = sharer?.numeric_id
    const promoLink = numericId
      ? `https://t.me/tg_douyin_bot?start=${numericId}`
      : `https://t.me/tg_douyin_bot`

    const startUrl = TG_MINIAPP_URL || promoLink

    const welcomeText =
      '<b>👋 欢迎来到 TG 抖音 🚀</b>\n' +
      '<b>Telegram 最大的视频&amp;直播分享平台!</b>🌍\n\n' +
      '<b>🔥 这里有你想要的精彩内容 🔥</b>\n' +
      '📰 全球资讯 •  🍉 热门八卦 •  💥 网络热点  \n' +
      '🔞 成人专区 •  🎤 娱乐直播 •  🎬 热门短剧\n' +
      '🌟 更多内容等你来探索！ \n\n' +
      '<b>🚀 诚邀您成为我们的“内容共建官”！</b>\n' +
      '📱 发现有趣视频？随手分享给我们  \n' +
      '🎯 你的分享，将被千万用户看见  \n' +
      '💎 优质内容创作者，更有专属福利\n\n' +
      '<b>💬 互动|分享|发现|快乐|尽在TG抖音！❤️</b>'

    const result = {
      type: 'article',
      id: `promo_${numericId || '0'}`,
      title: '🌟  欢迎来到 TG 抖音',
      description: numericId ? `🔥Telegram 最大的视频&直播分享平台!` : '开始刷抖音吧',
      input_message_content: {
        message_text: welcomeText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      },
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 开始刷TG抖音', url: `https://t.me/tg_douyin_bot?start=${numericId || ''}` }]
        ]
      }
    }

    await answerInlineQuery(queryId, [result])
    return
  }

  // ✅ 关键词搜索：描述 + 标签（全站已发布，最多5条，按发布时间倒序）
  // 约定：只要不是 video_ 前缀，就按关键词搜索
  if (!trimmed.startsWith('video_')) {
    const keyword = trimmed
    console.log('[InlineQuery] ✅ 关键词搜索', { userId, keyword })

    // 获取分享者的邀请码（用于分享链接后缀）
    const { data: sharer } = await supabase
      .from('profiles')
      .select('numeric_id')
      .eq('tg_user_id', userId)
      .single()
    const inviteSuffix = sharer?.numeric_id ? `_i${sharer.numeric_id}` : ''
    const inviteLink = `https://t.me/tg_douyin_bot?start=${sharer?.numeric_id || ''}`

    // 关键词清洗（避免 PostgREST filter 语法被破坏）
    const safe = keyword.replace(/[(),]/g, ' ').trim()
    const like = `%${safe}%`

    // 标签关键词：去掉可能的 #，并清理可能影响 tags.cs 的字符
    const tag = safe.startsWith('#') ? safe.slice(1).trim() : safe
    const safeTag = tag.replace(/[{},]/g, ' ').trim()

    const filter = safeTag
      ? `description.ilike.${like},tags.cs.{${safeTag}}`
      : `description.ilike.${like}`
    console.log('[InlineQuery] search filter:', filter)

    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, description, status, published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(5)
      .or(filter)

    if (error) {
      console.error('[InlineQuery] ❌ 搜索失败:', error)
      await answerInlineQuery(queryId, [])
      return
    }

    if (!videos || videos.length === 0) {
      console.log('[InlineQuery] ⚠️ 无搜索结果')
      await answerInlineQuery(queryId, [])
      return
    }

    const results = videos.map((v: any, idx: number) => {
      const videoId = v.id
      const deepLink = `https://t.me/tg_douyin_bot/tgdouyin?startapp=video_${videoId}${inviteSuffix}`
      const fullDesc = v.description || ''
      const title = fullDesc ? fullDesc.substring(0, 24) : `🎬 视频 ${idx + 1}`
      const desc = fullDesc ? fullDesc.substring(0, 80) : '点击打开观看'
      const linkText = fullDesc ? fullDesc.substring(0, 50) : '点击观看精彩视频'

      return {
        type: 'article',
        id: `search_${videoId}`,
        title,
        description: desc,
        input_message_content: {
          message_text: `<a href="${deepLink}">${linkText}</a>`,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }
      }
    })

    await answerInlineQuery(queryId, results)
    return
  }

  // 检查查询格式：video_{videoId}
  if (!trimmed.startsWith('video_')) {
    console.log('[InlineQuery] ❌ 查询格式不匹配，期望 video_xxx，实际:', query)
    await answerInlineQuery(queryId, [])
    return
  }

  let videoId = trimmed.replace('video_', '')
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
