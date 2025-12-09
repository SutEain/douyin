import { successResponse, errorResponse } from '../../_shared/response.ts'
import { supabaseAdmin } from '../lib/env.ts'
import { checkAndSendNotification } from '../lib/notification.ts'
import { formatCommentRow } from '../lib/video.ts'
import { parseJsonBody, parsePagination, requireAuth } from '../lib/auth.ts'
import { HttpError } from '../lib/auth.ts'

export async function handleVideoComments(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const videoId = url.searchParams.get('video_id')
  if (!videoId) {
    throw new HttpError('Missing video_id', 400)
  }
  const { pageNo, pageSize, from, to } = parsePagination(url, { pageNo: 0, pageSize: 20 })

  const { data, error, count } = await supabaseAdmin
    .from('video_comments')
    .select(
      `
      id,
      video_id,
      user_id,
      content,
      like_count,
      created_at,
      reply_to,
      profiles:user_id (
        id,
        nickname,
        username,
        avatar_url,
        country,
        city
      )
    `,
      { count: 'exact' }
    )
    .eq('video_id', videoId)
    .eq('review_status', 'approved')
    .is('deleted_at', null)
    .is('reply_to', null)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('[app-server] Load comments failed:', error)
    return errorResponse('Failed to load comments', 1, 500)
  }

  // 🎯 查询每个主评论的回复数量
  const commentIds = (data ?? []).map((row) => row.id)
  const replyCounts = new Map<string, number>()

  if (commentIds.length > 0) {
    const { data: replyData } = await supabaseAdmin
      .from('video_comments')
      .select('reply_to', { count: 'exact' })
      .in('reply_to', commentIds)
      .eq('review_status', 'approved')
      .is('deleted_at', null)

    // 统计每个评论的回复数
    for (const reply of replyData ?? []) {
      if (reply.reply_to) {
        replyCounts.set(reply.reply_to, (replyCounts.get(reply.reply_to) || 0) + 1)
      }
    }
  }

  const list = (data ?? []).map((row) => {
    const formatted = formatCommentRow(row)
    formatted.user_id = row.user_id
    formatted.sub_comment_count = replyCounts.get(row.id) || 0 // 🎯 设置真实的回复数量
    return formatted
  })
  return successResponse({
    list,
    total: count ?? 0,
    pageNo,
    pageSize
  })
}

export async function handleVideoCreateComment(req: Request): Promise<Response> {
  const { user, profile } = await requireAuth(req, { withProfile: true })
  const body = await parseJsonBody<{ video_id?: string; content?: string; reply_to?: string }>(req)

  const content = body.content?.trim()
  if (!body.video_id || !content) {
    throw new HttpError('Missing video_id or content', 400)
  }

  const { data, error } = await supabaseAdmin
    .from('video_comments')
    .insert({
      video_id: body.video_id,
      user_id: user.id,
      content,
      reply_to: body.reply_to ?? null,
      review_status: 'approved'
    })
    .select('id, video_id, user_id, content, like_count, created_at')
    .single()

  if (error) {
    console.error('[app-server] Create comment failed:', error)
    return errorResponse('Failed to send comment', 1, 500)
  }

  // 发送通知
  if (data) {
    ;(async () => {
      try {
        const nickname = profile.nickname || profile.username || '用户'
        const shortContent = content.length > 20 ? content.substring(0, 20) + '...' : content

        if (body.reply_to) {
          // 回复评论：通知原评论作者
          const { data: parent } = await supabaseAdmin
            .from('video_comments')
            .select('user_id')
            .eq('id', body.reply_to)
            .single()

          if (parent && parent.user_id !== user.id) {
            await checkAndSendNotification(
              parent.user_id,
              'comment',
              `💬 用户 <b>${nickname}</b> 回复了你的评论：${shortContent}`,
              `video_${body.video_id}`
            )
          }
        } else {
          // 直接评论：通知视频作者
          const { data: video } = await supabaseAdmin
            .from('videos')
            .select('author_id')
            .eq('id', body.video_id)
            .single()

          if (video && video.author_id !== user.id) {
            await checkAndSendNotification(
              video.author_id,
              'comment',
              `💬 用户 <b>${nickname}</b> 评论了你的作品：${shortContent}`,
              `video_${body.video_id}`
            )
          }
        }
      } catch (e) {
        console.error('[Comment Notification] Error:', e)
      }
    })()
  }

  const comment = formatCommentRow({ ...data, profiles: profile })
  comment.user_id = user.id
  return successResponse(comment)
}

// 🎯 获取评论的回复列表
export async function handleCommentReplies(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const commentId = url.searchParams.get('comment_id')

  if (!commentId) {
    throw new HttpError('Missing comment_id', 400)
  }

  // 1. 查询回复列表
  const { data, error } = await supabaseAdmin
    .from('video_comments')
    .select(
      `
      id,
      video_id,
      user_id,
      content,
      like_count,
      created_at,
      reply_to,
      profiles:user_id (
        id,
        nickname,
        username,
        avatar_url,
        country,
        city
      )
    `
    )
    .eq('reply_to', commentId)
    .eq('review_status', 'approved')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[app-server] Load replies failed:', error)
    return errorResponse('Failed to load replies', 1, 500)
  }

  // 2. 查询父评论的作者信息（回复目标）
  const { data: parentComment } = await supabaseAdmin
    .from('video_comments')
    .select(
      `
      user_id,
      profiles:user_id (
        nickname,
        username
      )
    `
    )
    .eq('id', commentId)
    .single()

  const replyToNickname =
    parentComment?.profiles?.nickname || parentComment?.profiles?.username || '用户'

  const list = (data ?? []).map((row) => {
    const formatted = formatCommentRow(row)
    formatted.user_id = row.user_id
    formatted.reply_to_user = replyToNickname // 🎯 添加回复目标用户名
    return formatted
  })

  return successResponse({ list })
}

// 🎯 评论点赞/取消点赞
export async function handleCommentLike(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const body = await parseJsonBody<{ comment_id?: string; liked?: boolean }>(req)

  if (!body.comment_id || typeof body.liked !== 'boolean') {
    throw new HttpError('Missing comment_id or liked flag', 400)
  }

  if (body.liked) {
    // 点赞
    const { error } = await supabaseAdmin
      .from('comment_likes')
      .upsert(
        { user_id: user.id, comment_id: body.comment_id },
        { onConflict: 'user_id,comment_id' }
      )

    if (error) {
      console.error('[app-server] Like comment failed:', error)
      return errorResponse('Failed to like comment', 1, 500)
    }

    // 更新点赞数
    await supabaseAdmin.rpc('increment_comment_likes', { comment_id: body.comment_id })
  } else {
    // 取消点赞
    const { error } = await supabaseAdmin
      .from('comment_likes')
      .delete()
      .eq('user_id', user.id)
      .eq('comment_id', body.comment_id)

    if (error) {
      console.error('[app-server] Unlike comment failed:', error)
      return errorResponse('Failed to unlike comment', 1, 500)
    }

    // 更新点赞数
    await supabaseAdmin.rpc('decrement_comment_likes', { comment_id: body.comment_id })
  }

  // 查询更新后的点赞数
  const { data: comment } = await supabaseAdmin
    .from('video_comments')
    .select('like_count')
    .eq('id', body.comment_id)
    .single()

  return successResponse({
    liked: body.liked,
    like_count: comment?.like_count ?? 0
  })
}
