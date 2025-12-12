import { BOT_TOKEN, TG_API_BASE } from '../env.ts'
import { supabase } from '../supabaseClient.ts'

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
export async function handleInlineQuery(inlineQuery: any) {
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
