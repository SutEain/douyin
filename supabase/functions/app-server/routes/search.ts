import { successResponse, errorResponse } from '../../_shared/response.ts'
import { supabaseAdmin } from '../lib/env.ts'
import { mapVideoRow, getProfileById } from '../lib/video.ts'
import { HttpError, parsePagination, requireAuth, tryGetAuth } from '../lib/auth.ts'

/**
 * 视频搜索 (统一包含普通和成人视频)
 * GET /search/videos?keyword=xxx&pageNo=0&pageSize=20
 */
export async function handleSearchVideos(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const keyword = url.searchParams.get('keyword')?.trim()
  const { pageNo, pageSize, from, to } = parsePagination(url)

  if (!keyword) {
    return errorResponse('Keyword is required', 1, 400)
  }

  console.log('[search] 视频综合搜索:', { keyword, pageNo, pageSize })

  // 保存搜索历史
  const { user } = await tryGetAuth(req)
  if (user) {
    await saveSearchHistory(user.id, keyword, 'video').catch((err) => {
      console.error('[search] 保存搜索历史失败:', err)
    })
  }

  // 🎯 核心重构：取消 is_adult 过滤，实现全量视频模糊匹配
  // 匹配范围：标题(title) + 描述(description) + 标签(tags)
  const {
    data: rows,
    error,
    count
  } = await supabaseAdmin
    .from('videos')
    .select('*', { count: 'exact' })
    .eq('status', 'published')
    .or(
      `title.ilike.%${keyword}%,` +
        `description.ilike.%${keyword}%,` +
        `tags::text.ilike.%${keyword}%`
    )
    .order('like_count', { ascending: false }) // 优先展示高热度视频
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('[search] 视频搜索失败:', error)
    return errorResponse('Search failed', 1, 500)
  }

  // 批量获取附加信息 (评论、关注状态等)
  const videoIds = (rows ?? []).map((r) => r.id)
  const topCommentsMap = await batchGetTopComments(videoIds)

  let followingSet = new Set<string>()
  if (user && rows?.length) {
    const authorIds = rows.map((r) => r.author_id)
    followingSet = await batchCheckFollowStatus(user.id, authorIds)
  }

  const list = []
  for (const row of rows ?? []) {
    const profile = await getProfileById(row.author_id)
    if (profile) {
      const mapped = await mapVideoRow(row, profile)
      if (mapped) {
        const topComment = topCommentsMap.get(row.id)
        if (topComment) mapped.top_comment = topComment
        mapped.is_following = followingSet.has(row.author_id)
        list.push(mapped)
      }
    }
  }

  return successResponse({
    list,
    total: count ?? 0,
    pageNo,
    pageSize
  })
}

/**
 * 搜索用户
 * GET /search/users?keyword=xxx&pageNo=0&pageSize=20
 */
export async function handleSearchUsers(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const keyword = url.searchParams.get('keyword')?.trim()
  const { pageNo, pageSize, from, to } = parsePagination(url)

  if (!keyword) {
    return errorResponse('Keyword is required', 1, 400)
  }

  const { user } = await tryGetAuth(req)
  if (user) {
    await saveSearchHistory(user.id, keyword, 'user').catch(() => {})
  }

  // 搜索用户：昵称(模糊) + 数字ID(精确)
  let orQuery = `nickname.ilike.%${keyword}%`
  if (/^\d+$/.test(keyword)) {
    orQuery += `,numeric_id.eq.${keyword}`
  }

  const {
    data: rows,
    error,
    count
  } = await supabaseAdmin
    .from('profiles')
    .select('*', { count: 'exact' })
    .or(orQuery)
    .order('total_likes', { ascending: false })
    .range(from, to)

  if (error) return errorResponse('Search users failed', 1, 500)

  let followingSet = new Set<string>()
  if (user && rows?.length) {
    followingSet = await batchCheckFollowStatus(
      user.id,
      rows.map((r) => r.id)
    )
  }

  const list = (rows ?? []).map((row) => ({
    id: row.id,
    nickname: row.nickname,
    avatar_url: row.avatar_url,
    signature: row.signature,
    follower_count: row.follower_count || 0,
    video_count: row.video_count || 0,
    is_following: followingSet.has(row.id)
  }))

  return successResponse({ list, total: count ?? 0, pageNo, pageSize })
}

/**
 * 获取热门搜索词
 */
export async function handleHotSearch(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseInt(url.searchParams.get('limit') || '30')

  const { data: rows, error } = await supabaseAdmin
    .from('search_history')
    .select('keyword')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // 统计近7天
    .limit(5000)

  if (error) return errorResponse('Failed to get hot keywords', 1, 500)

  const keywordMap = new Map<string, number>()
  for (const row of rows ?? []) {
    keywordMap.set(row.keyword, (keywordMap.get(row.keyword) || 0) + 1)
  }

  const keywords = Array.from(keywordMap.entries())
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)

  return successResponse({ keywords })
}

/**
 * 获取搜索历史
 */
export async function handleGetSearchHistory(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const url = new URL(req.url)
  const limit = parseInt(url.searchParams.get('limit') || '15')

  const { data: rows, error } = await supabaseAdmin
    .from('search_history')
    .select('keyword, search_type')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return errorResponse('Failed to get history', 1, 500)

  return successResponse({
    history: (rows ?? []).map((row) => ({
      keyword: row.keyword,
      type: row.search_type
    }))
  })
}

/**
 * 删除搜索历史
 */
export async function handleDeleteSearchHistory(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const url = new URL(req.url)
  const keyword = url.searchParams.get('keyword')

  let query = supabaseAdmin.from('search_history').delete().eq('user_id', user.id)
  if (keyword) query = query.eq('keyword', keyword)

  const { error } = await query
  if (error) return errorResponse('Failed to delete history', 1, 500)

  return successResponse({ success: true })
}

// --- 内部辅助函数 ---

async function saveSearchHistory(userId: string, keyword: string, type: string) {
  await supabaseAdmin.from('search_history').upsert(
    {
      user_id: userId,
      keyword: keyword,
      search_type: type,
      created_at: new Date().toISOString()
    },
    { onConflict: 'user_id,keyword' }
  )
}

async function batchGetTopComments(videoIds: string[]) {
  const resultMap = new Map<string, any>()
  if (!videoIds.length) return resultMap

  const { data: comments } = await supabaseAdmin
    .from('video_comments')
    .select('video_id, content, like_count, profiles(nickname)')
    .in('video_id', videoIds)
    .order('like_count', { ascending: false })

  for (const c of comments ?? []) {
    if (!resultMap.has(c.video_id)) {
      resultMap.set(c.video_id, {
        content: c.content,
        like_count: c.like_count,
        author_nickname: (c.profiles as any)?.nickname || '用户'
      })
    }
  }
  return resultMap
}

async function batchCheckFollowStatus(followerId: string, followingIds: string[]) {
  const { data } = await supabaseAdmin
    .from('follows')
    .select('followee_id')
    .eq('follower_id', followerId)
    .in('followee_id', followingIds)
  return new Set((data ?? []).map((r) => r.followee_id))
}
