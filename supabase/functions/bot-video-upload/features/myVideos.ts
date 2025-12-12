import { supabase } from '../supabaseClient.ts'
import { editMessage, sendMessage } from '../telegram.ts'
import { safeTruncate } from '../utils/text.ts'
import { getUserState, updateUserState } from '../state.ts'

// ===== 已发布列表：搜索 + 游标翻页（稳定） =====
export type PublishedCursor = { published_at: string; id: string }
export type PublishedCtx = {
  q?: string
  cursorStack?: (PublishedCursor | null)[] // stack[0] = null，表示第一页
  nextCursor?: PublishedCursor | null // 当前页“下一页”游标
}

export function getPublishedCtx(userState: any): PublishedCtx {
  const ctx = userState?.context || {}
  const pub = ctx.published || {}
  return {
    q: typeof pub.q === 'string' ? pub.q : undefined,
    cursorStack: Array.isArray(pub.cursorStack) ? pub.cursorStack : [null],
    nextCursor:
      pub.nextCursor && pub.nextCursor.published_at && pub.nextCursor.id ? pub.nextCursor : null
  }
}

export async function setPublishedCtx(chatId: number, next: PublishedCtx) {
  const userState = await getUserState(chatId)
  const ctx = (userState as any)?.context || {}
  const merged = {
    ...ctx,
    published: {
      q: next.q || null,
      cursorStack: next.cursorStack && next.cursorStack.length ? next.cursorStack : [null],
      nextCursor: next.nextCursor || null
    }
  }
  await updateUserState(chatId, { context: merged })
}

function buildPublishedListKeyboard(opts: {
  hasPrev: boolean
  hasNext: boolean
  hasQuery: boolean
}) {
  const rows: any[] = []

  rows.push([{ text: '🔎 搜索', callback_data: 'published_search' }])
  if (opts.hasQuery) {
    rows.push([{ text: '❌ 清除搜索', callback_data: 'published_search_clear' }])
  }

  const pagerRow: any[] = []
  if (opts.hasPrev) pagerRow.push({ text: '⬅️ 上一页', callback_data: 'published_prev' })
  if (opts.hasNext) pagerRow.push({ text: '➡️ 下一页', callback_data: 'published_next' })
  if (pagerRow.length) rows.push(pagerRow)

  rows.push([{ text: '← 返回', callback_data: 'back_my_videos' }])

  return { inline_keyboard: rows }
}

function applyPublishedCursorFilter(builder: any, cursor: PublishedCursor | null) {
  if (!cursor) return builder
  const t = cursor.published_at
  const id = cursor.id
  return builder.or(`published_at.lt.${t},and(published_at.eq.${t},id.lt.${id})`)
}

function applyPublishedSearchFilter(builder: any, q?: string) {
  const keyword = q?.trim()
  if (!keyword) return builder
  const safe = keyword.replace(/[(),]/g, ' ').trim()
  const like = `%${safe}%`

  const tag = safe.startsWith('#') ? safe.slice(1).trim() : safe
  const safeTag = tag.replace(/[{},]/g, ' ').trim()

  const filter = safeTag
    ? `description.ilike.${like},tags.cs.{${safeTag}}`
    : `description.ilike.${like}`
  console.log('[PublishedSearch] filter:', filter)
  return builder.or(filter)
}

// 处理"我的视频"- 概览页（单面板模式）
export async function handleMyVideos(chatId: number) {
  try {
    const userState = await getUserState(chatId)

    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, status, like_count, comment_count, view_count')
      .eq('tg_user_id', chatId)

    if (error) {
      console.error('获取视频列表失败:', error)
      await sendMessage(chatId, '❌ 获取视频列表失败')
      return
    }

    if (!videos || videos.length === 0) {
      const text = '📹 <b>我的视频</b>\n\n暂无视频\n\n<i>发送或转发视频即可上传</i>'
      const replyMarkup = { inline_keyboard: [] as any[] }
      const dashId = (userState as any)?.dashboard_message_id
      if (dashId) {
        const edited = await editMessage(chatId, dashId, text, { reply_markup: replyMarkup })
        if (edited?.ok) return
      }
      const sent = await sendMessage(chatId, text, { reply_markup: replyMarkup })
      if (sent?.ok) {
        await updateUserState(chatId, { dashboard_message_id: sent.result.message_id })
      }
      return
    }

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

    const keyboard: any[] = []
    if (processing.length > 0) {
      keyboard.push([
        { text: `📤 查看上传中的视频 (${processing.length})`, callback_data: 'my_processing' }
      ])
    }
    if (drafts.length > 0) {
      keyboard.push([{ text: `📝 继续编辑草稿 (${drafts.length})`, callback_data: 'my_drafts' }])
    }
    if (published.length > 0) {
      keyboard.push([
        { text: `📺 我发布的视频 (${published.length})`, callback_data: 'my_published' }
      ])
    }

    const text = lines.join('\n')
    const replyMarkup = { inline_keyboard: keyboard }

    const dashId = (userState as any)?.dashboard_message_id
    if (dashId) {
      const edited = await editMessage(chatId, dashId, text, { reply_markup: replyMarkup })
      if (edited?.ok) return
    }

    const sent = await sendMessage(chatId, text, { reply_markup: replyMarkup })
    if (sent?.ok) {
      await updateUserState(chatId, { dashboard_message_id: sent.result.message_id })
    }
  } catch (error) {
    console.error('获取视频列表错误:', error)
    await sendMessage(chatId, '❌ 获取视频列表时出错')
  }
}

// 处理"我的视频"- 编辑模式（单面板模式下复用 handleMyVideos）
export async function handleMyVideosEdit(chatId: number, _messageId: number) {
  await handleMyVideos(chatId)
}

// ✅ 查看上传中的视频详情（processing）
export async function handleViewProcessing(chatId: number, messageId: number, videoId: string) {
  try {
    const { data: video, error } = await supabase
      .from('videos')
      .select('id, status, description, file_size, created_at')
      .eq('id', videoId)
      .eq('tg_user_id', chatId)
      .single()

    if (error || !video) {
      await editMessage(chatId, messageId, '❌ 获取上传状态失败', {
        reply_markup: { inline_keyboard: [[{ text: '⬅️ 返回', callback_data: 'my_processing' }]] }
      })
      return
    }

    const sizeMB = video.file_size ? (video.file_size / 1024 / 1024).toFixed(1) : '0.0'
    const desc = video.description ? safeTruncate(video.description, 60) : '未命名视频'

    const lines = [
      '📤 <b>上传处理中</b>',
      '',
      `📝 ${desc}`,
      `📦 文件大小：${sizeMB} MB`,
      `⏱️ 创建时间：${new Date(video.created_at).toLocaleString()}`,
      '',
      '💡 处理完成后会自动给你发“视频已就绪”的编辑菜单'
    ]

    await editMessage(chatId, messageId, lines.join('\n'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗑️ 删除此任务', callback_data: `delete_video_${video.id}` }],
          [{ text: '⬅️ 返回', callback_data: 'my_processing' }]
        ]
      }
    })
  } catch (e) {
    console.error('[handleViewProcessing] error:', e)
    await editMessage(chatId, messageId, '❌ 获取上传状态失败', {
      reply_markup: { inline_keyboard: [[{ text: '⬅️ 返回', callback_data: 'my_processing' }]] }
    })
  }
}

// ✅ 新增：查看上传中的视频列表
export async function handleMyProcessing(chatId: number, messageId: number) {
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
        reply_markup: { inline_keyboard: [[{ text: '⬅️ 返回', callback_data: 'my_videos' }]] }
      })
      return
    }

    if (!videos || videos.length === 0) {
      await editMessage(chatId, messageId, `暂无上传中的视频`, {
        reply_markup: { inline_keyboard: [[{ text: '⬅️ 返回', callback_data: 'my_videos' }]] }
      })
      return
    }

    const lines = [`📤 <b>上传中的视频 (${videos.length})</b>`, ``]

    const keyboard: any[] = videos.map((video, index) => {
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
        { text: '🗑️', callback_data: `delete_video_${video.id}` }
      ]
    })

    keyboard.push([{ text: '⬅️ 返回', callback_data: 'my_videos' }])
    lines.push(`💡 视频处理完成后会自动通知您`)

    await editMessage(chatId, messageId, lines.join('\n'), {
      reply_markup: { inline_keyboard: keyboard }
    })
  } catch (error) {
    console.error('处理上传中列表失败:', error)
    await editMessage(chatId, messageId, '❌ 查询失败', {
      reply_markup: { inline_keyboard: [[{ text: '⬅️ 返回', callback_data: 'my_videos' }]] }
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

// 处理"我发布的视频"列表（含搜索/游标翻页）
export async function handleMyPublished(chatId: number, messageId: number) {
  console.log('[handleMyPublished] 开始获取已发布视频, chatId:', chatId, 'messageId:', messageId)

  try {
    const userState = await getUserState(chatId)
    const pubCtx = getPublishedCtx(userState)
    const cursorStack =
      pubCtx.cursorStack && pubCtx.cursorStack.length ? pubCtx.cursorStack : [null]
    const currentCursor = cursorStack[cursorStack.length - 1] || null
    const pageNo = cursorStack.length

    let query = supabase
      .from('videos')
      .select(
        'id, description, like_count, comment_count, view_count, is_private, published_at, tags'
      )
      .eq('tg_user_id', chatId)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(10)

    console.log('[handleMyPublished] search.q:', pubCtx.q)
    console.log('[handleMyPublished] cursor:', currentCursor)

    query = applyPublishedSearchFilter(query, pubCtx.q)
    query = applyPublishedCursorFilter(query, currentCursor)

    const { data: videos, error } = await query

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
      const qLine = pubCtx.q ? `🔎 关键字：<code>${pubCtx.q}</code>\n\n` : ''
      await editMessage(chatId, messageId, `📺 <b>我发布的视频</b>\n\n${qLine}暂无匹配结果`, {
        reply_markup: buildPublishedListKeyboard({
          hasPrev: cursorStack.length > 1,
          hasNext: false,
          hasQuery: !!pubCtx.q
        })
      })
      return
    }

    const header: string[] = ['📺 <b>我发布的视频</b>', '']
    if (pubCtx.q) header.push(`🔎 关键字：<code>${pubCtx.q}</code>`)
    header.push(`📄 第 ${pageNo} 页 · 本页 ${videos.length} 条`)
    header.push('')

    const keyboard: any[] = videos.map((v) => {
      const privacyIcon = v.is_private ? '🔒 ' : ''
      const desc = v.description ? safeTruncate(v.description, 20) : '无描述'
      const stats = `👀${v.view_count || 0} ❤️${v.like_count || 0}`
      return [{ text: `${privacyIcon}${desc}  ${stats}`, callback_data: `view_video_${v.id}` }]
    })

    const last = videos[videos.length - 1] as any
    const nextCursor: PublishedCursor | null =
      last?.published_at && last?.id ? { published_at: last.published_at, id: last.id } : null
    const hasNext = videos.length === 10 && !!nextCursor

    await setPublishedCtx(chatId, { q: pubCtx.q, cursorStack, nextCursor })

    const controls = buildPublishedListKeyboard({
      hasPrev: cursorStack.length > 1,
      hasNext,
      hasQuery: !!pubCtx.q
    }).inline_keyboard
    const mergedKeyboard = [...keyboard, ...controls]

    console.log('[handleMyPublished] 准备编辑消息, 按钮数:', mergedKeyboard.length)

    await editMessage(chatId, messageId, header.join('\n'), {
      reply_markup: { inline_keyboard: mergedKeyboard }
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
export async function handleMyDrafts(chatId: number, messageId: number) {
  console.log('[handleMyDrafts] 开始获取草稿列表, chatId:', chatId, 'messageId:', messageId)

  try {
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
    const keyboard: any[] = videos.map((v) => {
      const desc = v.description ? safeTruncate(v.description, 20) : '无描述'
      return [
        { text: `📝 ${desc}`, callback_data: `edit_draft_${v.id}` },
        { text: '🗑️', callback_data: `delete_video_${v.id}` }
      ]
    })

    keyboard.push([{ text: '← 返回', callback_data: 'back_my_videos' }])

    await editMessage(chatId, messageId, lines.join('\n'), {
      reply_markup: { inline_keyboard: keyboard }
    })
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
