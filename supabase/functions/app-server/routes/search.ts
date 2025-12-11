import { successResponse, errorResponse } from '../../_shared/response.ts'
import { supabaseAdmin } from '../lib/env.ts'
import { mapVideoRow, getProfileById } from '../lib/video.ts'
import { getAdultQuota } from './video.ts'
import { HttpError, parsePagination, requireAuth, tryGetAuth } from '../lib/auth.ts'

/**
 * 搜索视频
 * GET /search/videos?keyword=xxx&pageNo=0&pageSize=20
 */
export async function handleSearchVideos(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const keyword = url.searchParams.get('keyword')?.trim()
  const { pageNo, pageSize, from, to } = parsePagination(url)

  if (!keyword) {
    return errorResponse('Keyword is required', 1, 400)
  }

  console.log('[search] 搜索视频:', { keyword, pageNo, pageSize })

  // 保存搜索历史（如果用户已登录），普通视频搜索
  const { user } = await tryGetAuth(req)
  if (user) {
    await saveSearchHistory(user.id, keyword, 'video').catch((err) => {
      console.error('[search] 保存搜索历史失败:', err)
    })
  }

  // 搜索视频：描述 + 标签
  const {
    data: rows,
    error,
    count
  } = await supabaseAdmin
    .from('videos')
    .select('*', { count: 'exact' })
    .eq('status', 'published')
    .eq('is_adult', false)
    .or(
      `description.ilike.%${keyword}%,` + `tags.cs.{${keyword}}` // 标签包含（精确匹配）
    )
    .order('like_count', { ascending: false })
    .order('comment_count', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('[search] 搜索视频失败:', error)
    return errorResponse('Search failed', 1, 500)
  }

  console.log('[search] 搜索结果:', { total: count, returned: rows?.length })

  // 🚀 优化：批量获取视频的热门评论（减少数据库查询）
  const videoIds = (rows ?? []).map((r) => r.id)
  const topCommentsMap = await batchGetTopComments(videoIds)

  // 🚀 批量获取关注状态
  let followingSet = new Set<string>()
  if (user && rows?.length) {
    const authorIds = rows.map((r) => r.author_id)
    followingSet = await batchCheckFollowStatus(user.id, authorIds)
  }

  // 格式化视频数据
  const list = []
  for (const row of rows ?? []) {
    const profile = await getProfileById(row.author_id)
    if (profile) {
      const mapped = await mapVideoRow(row, profile)
      if (mapped) {
        // 添加热门评论
        const topComment = topCommentsMap.get(row.id)
        if (topComment) {
          mapped.top_comment = topComment
        }
        // 添加关注状态
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
 * 搜索成人视频（18+）
 * GET /search/adult?keyword=xxx&pageNo=0&pageSize=20
 */
export async function handleSearchAdultVideos(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const keyword = url.searchParams.get('keyword')?.trim()
  const { pageNo, pageSize, from, to } = parsePagination(url)

  if (!keyword) {
    return errorResponse('Keyword is required', 1, 400)
  }

  console.log('[search] 搜索成人视频:', { keyword, pageNo, pageSize })

  // 必须登录才能搜索成人内容（实际上小程序都是登录的）
  const { user } = await requireAuth(req)

  // 保存搜索历史（类型 adult）
  await saveSearchHistory(user.id, keyword, 'adult').catch((err) => {
    console.error('[search] 保存成人搜索历史失败:', err)
  })

  // 🔒 检查是否解锁了无限成人内容
  const quota = await getAdultQuota(user.id)
  if (!quota.unlimited) {
    // 未解锁：直接返回 locked 状态，不执行搜索
    console.log('[search] 用户未解锁成人搜索:', { userId: user.id })
    return successResponse({
      list: [],
      total: 0,
      pageNo,
      pageSize,
      locked: true
    })
  }

  const {
    data: rows,
    error,
    count
  } = await supabaseAdmin
    .from('videos')
    .select('*', { count: 'exact' })
    .eq('status', 'published')
    .eq('is_adult', true)
    .or(`description.ilike.%${keyword}%,` + `tags.cs.{${keyword}}`)
    .order('like_count', { ascending: false })
    .order('comment_count', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('[search] 搜索成人视频失败:', error)
    return errorResponse('Search failed', 1, 500)
  }

  console.log('[search] 成人搜索结果:', { total: count, returned: rows?.length })

  // 批量获取热门评论
  const videoIds = (rows ?? []).map((r) => r.id)
  const topCommentsMap = await batchGetTopComments(videoIds)

  // 批量获取关注状态
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
        if (topComment) {
          mapped.top_comment = topComment
        }
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
 * 批量获取视频的热门评论
 */
async function batchGetTopComments(videoIds: string[]): Promise<Map<string, any>> {
  if (!videoIds.length) return new Map()

  // 查询所有视频的评论（点赞数 > 0 的）
  const { data: likedComments } = await supabaseAdmin
    .from('video_comments')
    .select(
      `
      id,
      video_id,
      content,
      like_count,
      created_at,
      profiles!video_comments_user_id_fkey (
        nickname,
        username
      )
    `
    )
    .in('video_id', videoIds)
    .gt('like_count', 0)
    .order('like_count', { ascending: false })

  // 查询所有视频的最新评论（作为备选）
  const { data: latestComments } = await supabaseAdmin
    .from('video_comments')
    .select(
      `
      id,
      video_id,
      content,
      like_count,
      created_at,
      profiles!video_comments_user_id_fkey (
        nickname,
        username
      )
    `
    )
    .in('video_id', videoIds)
    .order('created_at', { ascending: false })

  // 构建每个视频的热门评论映射
  const resultMap = new Map<string, any>()

  for (const videoId of videoIds) {
    // 优先使用点赞最高的评论
    const likedComment = (likedComments ?? []).find((c) => c.video_id === videoId)
    if (likedComment) {
      resultMap.set(videoId, {
        content: likedComment.content,
        like_count: likedComment.like_count || 0,
        author_nickname:
          likedComment.profiles?.nickname || likedComment.profiles?.username || '匿名用户'
      })
      continue
    }

    // 否则使用最新评论
    const latestComment = (latestComments ?? []).find((c) => c.video_id === videoId)
    if (latestComment) {
      resultMap.set(videoId, {
        content: latestComment.content,
        like_count: latestComment.like_count || 0,
        author_nickname:
          latestComment.profiles?.nickname || latestComment.profiles?.username || '匿名用户'
      })
    }
  }

  return resultMap
}

/**
 * 批量检查关注状态
 */
async function batchCheckFollowStatus(
  followerId: string,
  followingIds: string[]
): Promise<Set<string>> {
  if (!followerId || !followingIds.length) return new Set()

  // 去重
  const uniqueIds = [...new Set(followingIds)]

  const { data } = await supabaseAdmin
    .from('follows')
    .select('followee_id')
    .eq('follower_id', followerId)
    .in('followee_id', uniqueIds)

  return new Set((data ?? []).map((r) => r.followee_id))
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

  console.log('[search] 搜索用户:', { keyword, pageNo, pageSize })

  // 保存搜索历史（如果用户已登录）
  const { user } = await tryGetAuth(req)
  if (user) {
    await saveSearchHistory(user.id, keyword, 'user').catch((err) => {
      console.error('[search] 保存搜索历史失败:', err)
    })
  }

  // 搜索用户：昵称 + 数字ID(精确) - 移除 username 搜索以保护隐私
  let orQuery = `nickname.ilike.%${keyword}%`
  // 如果是纯数字，尝试匹配 numeric_id
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
    .order('total_likes', { ascending: false }) // 按获赞排序
    .order('follower_count', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('[search] 搜索用户失败:', error)
    return errorResponse('Search failed', 1, 500)
  }

  console.log('[search] 搜索结果:', { total: count, returned: rows?.length })

  // 🚀 批量获取关注状态
  let followingSet = new Set<string>()
  if (user && rows?.length) {
    const userIds = rows.map((r) => r.id)
    followingSet = await batchCheckFollowStatus(user.id, userIds)
  }

  // 格式化用户数据
  const list = (rows ?? []).map((row) => ({
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatar_url: row.avatar_url,
    signature: row.signature,
    follower_count: row.follower_count || 0,
    following_count: row.following_count || 0,
    video_count: row.video_count || 0,
    like_count: row.like_count || 0,
    is_following: followingSet.has(row.id)
  }))

  return successResponse({
    list,
    total: count ?? 0,
    pageNo,
    pageSize
  })
}

/**
 * 获取热门搜索词
 * GET /search/hot?limit=30
 */
export async function handleHotSearch(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseInt(url.searchParams.get('limit') || '30')

  console.log('[search] 获取热门搜索词, limit:', limit)

  // 统计近3天最热搜索词（只统计视频搜索）
  const { data: rows, error } = await supabaseAdmin
    .from('search_history')
    .select('keyword')
    .eq('search_type', 'video') // 🎯 只统计视频搜索
    .gte('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
    .limit(10000) // 先取足够多的数据用于统计

  if (error) {
    console.error('[search] 获取热门搜索词失败:', error)
    return errorResponse('Failed to get hot keywords', 1, 500)
  }

  // 统计关键词出现次数
  const keywordMap = new Map<string, number>()
  for (const row of rows ?? []) {
    const count = keywordMap.get(row.keyword) || 0
    keywordMap.set(row.keyword, count + 1)
  }

  // 排序并取前 N 个
  const keywords = Array.from(keywordMap.entries())
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)

  console.log('[search] 热门搜索词:', keywords.length)

  return successResponse({
    keywords
  })
}

/**
 * 获取搜索历史
 * GET /search/history?limit=10
 */
export async function handleGetSearchHistory(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const url = new URL(req.url)
  const limit = parseInt(url.searchParams.get('limit') || '10')

  const { data: rows, error } = await supabaseAdmin
    .from('search_history')
    .select('keyword, search_type, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[search] 获取搜索历史失败:', error)
    return errorResponse('Failed to get history', 1, 500)
  }

  return successResponse({
    history: (rows ?? []).map((row) => ({
      keyword: row.keyword,
      type: row.search_type
    }))
  })
}

/**
 * 删除搜索历史
 * DELETE /search/history?keyword=xxx  (删除单条)
 * DELETE /search/history              (清空全部)
 */
export async function handleDeleteSearchHistory(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const url = new URL(req.url)
  const keyword = url.searchParams.get('keyword')

  let query = supabaseAdmin.from('search_history').delete().eq('user_id', user.id)

  if (keyword) {
    // 删除单条
    query = query.eq('keyword', keyword)
    console.log('[search] 删除搜索历史:', keyword)
  } else {
    // 清空全部
    console.log('[search] 清空所有搜索历史')
  }

  const { error } = await query

  if (error) {
    console.error('[search] 删除搜索历史失败:', error)
    return errorResponse('Failed to delete history', 1, 500)
  }

  return successResponse({ success: true })
}

/**
 * 保存搜索历史（内部辅助函数）
 */
async function saveSearchHistory(
  userId: string,
  keyword: string,
  searchType: 'video' | 'user' | 'adult'
): Promise<void> {
  // 使用 upsert：如果已存在则更新 updated_at
  const { error } = await supabaseAdmin.from('search_history').upsert(
    {
      user_id: userId,
      keyword: keyword,
      search_type: searchType,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      onConflict: 'user_id,keyword',
      ignoreDuplicates: false
    }
  )

  if (error) {
    throw error
  }

  console.log('[search] 保存搜索历史成功:', { userId, keyword, searchType })
}
