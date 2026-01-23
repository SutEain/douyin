import { supabase } from '../supabaseClient.ts'
import { editMessage, sendMessage } from '../telegram.ts'
import { safeTruncate } from '../utils/text.ts'
import { getUserState, updateUserState } from '../state.ts'

export type PanelResult =
  | { mode: 'edited'; messageId: number }
  | { mode: 'sent'; messageId: number }
  | { mode: 'failed' }

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
export async function handleMyVideos(
  chatId: number,
  preferredMessageId?: number
): Promise<PanelResult> {
  try {
    const userState = await getUserState(chatId)

    // ✅ 概览页不要 select 全量 rows：Supabase/PostgREST 默认最多返回 1000 行，会导致“总数=1000”假象
    const { count: totalCount, error: totalErr } = await supabase
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('tg_user_id', chatId)
    if (totalErr) {
      console.error('[MyVideos] total count failed:', totalErr)
      await sendMessage(chatId, '❌ 获取视频统计失败')
      return { mode: 'failed' }
    }

    const total = totalCount ?? 0
    if (total === 0) {
      const text = '📹 <b>我的视频</b>\n\n暂无视频\n\n<i>直接发送或转发视频给我即可上传</i>'
      const replyMarkup = {
        inline_keyboard: [[{ text: '⬅️ 返回首页', callback_data: 'back_home' }]]
      }
      const dashId = (userState as any)?.dashboard_message_id
      const candidates = [preferredMessageId, dashId].filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v)
      )
      for (const mid of candidates) {
        const edited = await editMessage(chatId, mid, text, { reply_markup: replyMarkup })
        if (edited?.ok) return { mode: 'edited', messageId: mid }
      }
      const sent = await sendMessage(chatId, text, { reply_markup: replyMarkup })
      if (sent?.ok) {
        await updateUserState(chatId, { dashboard_message_id: sent.result.message_id })
        return { mode: 'sent', messageId: sent.result.message_id }
      }
      return { mode: 'failed' }
    }

    const [{ count: processingCount }, { count: draftCount }, { count: publishedCount }] =
      await Promise.all([
        supabase
          .from('videos')
          .select('id', { count: 'exact', head: true })
          .eq('tg_user_id', chatId)
          .eq('status', 'processing'),
        supabase
          .from('videos')
          .select('id', { count: 'exact', head: true })
          .eq('tg_user_id', chatId)
          .in('status', ['draft', 'ready']),
        supabase
          .from('videos')
          .select('id', { count: 'exact', head: true })
          .eq('tg_user_id', chatId)
          .eq('status', 'published')
      ])

    const processing = processingCount ?? 0
    const drafts = draftCount ?? 0
    const published = publishedCount ?? 0

    // ✅ 统计已发布的浏览/点赞/评论总和：优先用聚合；如果上游不支持则分页累加
    let totalPlays = 0
    let totalLikes = 0
    let totalComments = 0
    try {
      // 🎯 优先使用 RPC 以获得最佳性能和兼容性
      const { data: stats, error: statsErr } = await supabase.rpc('get_user_video_stats', {
        p_user_id: chatId
      })

      if (statsErr) throw statsErr

      const row = Array.isArray(stats) ? stats[0] : stats
      totalPlays = Number(row?.total_views ?? 0) || 0
      totalLikes = Number(row?.total_likes ?? 0) || 0
      totalComments = Number(row?.total_comments ?? 0) || 0
    } catch (e) {
      console.warn('[MyVideos] RPC failed, fallback to paged sum:', e)
      const pageSize = 1000
      let from = 0
      for (;;) {
        const { data: rows, error: pageErr } = await supabase
          .from('videos')
          .select('view_count, like_count, comment_count')
          .eq('tg_user_id', chatId)
          .eq('status', 'published')
          .range(from, from + pageSize - 1)

        if (pageErr) {
          console.error('[MyVideos] sum page failed:', pageErr)
          break
        }
        const list: any[] = rows || []
        for (const r of list) {
          totalPlays += Number(r?.view_count ?? 0) || 0
          totalLikes += Number(r?.like_count ?? 0) || 0
          totalComments += Number(r?.comment_count ?? 0) || 0
        }
        if (list.length < pageSize) break
        from += pageSize
      }
    }

    console.log('[MyVideos] stats:', {
      chatId,
      total,
      processing,
      drafts,
      published,
      totalPlays,
      totalLikes,
      totalComments
    })

    const lines = [
      `📹 <b>我的作品</b>`,
      ``,
      `共 ${total} 个视频`,
      ``,
      `💡 <b>上传方式：</b> 直接发送/转发视频给我`
    ]
    if (processing > 0) {
      lines.push(`📤 上传中 ${processing} · 草稿 ${drafts} · 已发布 ${published}`)
    } else {
      lines.push(`草稿 ${drafts} · 已发布 ${published}`)
    }

    lines.push(``)
    lines.push(`📊 <b>数据总览</b>`)
    lines.push(`👀 浏览 ${totalPlays}    ❤️ 点赞 ${totalLikes}    💬 评论 ${totalComments}`)

    const keyboard: any[] = []
    if (processing > 0) {
      keyboard.push([
        { text: `📤 查看上传中的视频 (${processing})`, callback_data: 'my_processing' }
      ])
    }
    if (drafts > 0) {
      keyboard.push([{ text: `📝 继续编辑草稿 (${drafts})`, callback_data: 'my_drafts' }])
    }
    if (published > 0) {
      keyboard.push([{ text: `📺 我发布的视频 (${published})`, callback_data: 'my_published' }])
    }

    keyboard.push([{ text: '⬅️ 返回首页', callback_data: 'back_home' }])

    const text = lines.join('\n')
    const replyMarkup = { inline_keyboard: keyboard }

    const dashId = (userState as any)?.dashboard_message_id
    const candidates = [preferredMessageId, dashId].filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v)
    )
    for (const mid of candidates) {
      const edited = await editMessage(chatId, mid, text, { reply_markup: replyMarkup })
      if (edited?.ok) return { mode: 'edited', messageId: mid }
    }

    const sent = await sendMessage(chatId, text, { reply_markup: replyMarkup })
    if (sent?.ok) {
      await updateUserState(chatId, { dashboard_message_id: sent.result.message_id })
      return { mode: 'sent', messageId: sent.result.message_id }
    }
    return { mode: 'failed' }
  } catch (error) {
    console.error('获取视频列表错误:', error)
    await sendMessage(chatId, '❌ 获取视频列表时出错')
    return { mode: 'failed' }
  }
}

// 处理"我的视频"- 编辑模式（单面板模式下复用 handleMyVideos）
export async function handleMyVideosEdit(chatId: number, messageId: number): Promise<PanelResult> {
  return await handleMyVideos(chatId, messageId)
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

    // 🎯 修复：查询 limit 11 条，用于准确判断是否还有下一页
    // 如果返回了11条，说明还有更多；如果只返回10条或更少，说明没有更多了
    let query = supabase
      .from('videos')
      .select(
        'id, description, like_count, comment_count, view_count, is_private, published_at, tags'
      )
      .eq('tg_user_id', chatId)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(11)

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

    // 🎯 判断是否还有下一页：如果返回了11条，说明还有更多
    const hasMore = videos.length > 10
    // 只显示前10条
    const displayVideos = videos.slice(0, 10)

    const header: string[] = ['📺 <b>我发布的视频</b>', '']
    if (pubCtx.q) header.push(`🔎 关键字：<code>${pubCtx.q}</code>`)
    header.push(`📄 第 ${pageNo} 页 · 本页 ${displayVideos.length} 条`)
    header.push('')

    const keyboard: any[] = displayVideos.map((v) => {
      const privacyIcon = v.is_private ? '🔒 ' : ''
      const desc = v.description ? safeTruncate(v.description, 20) : '无描述'
      const stats = `👀${v.view_count || 0} ❤️${v.like_count || 0}`
      return [{ text: `${privacyIcon}${desc}  ${stats}`, callback_data: `view_video_${v.id}` }]
    })

    // 🎯 修复：使用最后一条显示的视频来构建 nextCursor
    // 如果还有更多数据（hasMore），则构建 nextCursor；否则为 null
    const last = displayVideos[displayVideos.length - 1] as any
    const nextCursor: PublishedCursor | null =
      hasMore && last?.published_at && last?.id
        ? { published_at: last.published_at, id: last.id }
        : null
    const hasNext = !!nextCursor

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
