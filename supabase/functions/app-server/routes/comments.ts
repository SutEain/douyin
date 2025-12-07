import { successResponse, errorResponse } from '../../_shared/response.ts'
import { supabaseAdmin } from '../lib/env.ts'
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
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('[app-server] Load comments failed:', error)
    return errorResponse('Failed to load comments', 1, 500)
  }

  const list = (data ?? []).map((row) => {
    const formatted = formatCommentRow(row)
    formatted.user_id = row.user_id
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

  const comment = formatCommentRow({ ...data, profiles: profile })
  comment.user_id = user.id
  return successResponse(comment)
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
