import { successResponse, errorResponse } from '../../_shared/response.ts'
import { supabaseAdmin } from '../lib/env.ts'
import { checkAndSendNotification } from '../lib/notification.ts'
import {
  applyRowFlags,
  attachUserFlags,
  getProfileById,
  getVideoAuthorProfile,
  mapVideoRow
} from '../lib/video.ts'
import { HttpError, parseJsonBody, parsePagination, requireAuth, tryGetAuth } from '../lib/auth.ts'

export async function handleVideoMy(req: Request): Promise<Response> {
  const { user, profile } = await requireAuth(req, { withProfile: true })
  const url = new URL(req.url)
  const { pageNo, pageSize, from, to } = parsePagination(url)

  const userField = profile.tg_user_id ? 'tg_user_id' : 'author_id'
  const userValue = profile.tg_user_id ?? profile.id

  // ✅ 只返回已发布和草稿状态的视频（不包括 processing）
  const {
    data: rows,
    error: videoError,
    count
  } = await supabaseAdmin
    .from('videos')
    .select('*', { count: 'exact' })
    .eq(userField, userValue)
    .in('status', ['draft', 'ready', 'published']) // ✅ 排除 processing
    .order('is_top', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (videoError) {
    console.error('[app-server] Load videos failed:', videoError)
    return errorResponse('Failed to load videos', 1, 500)
  }

  await attachUserFlags(rows ?? [], user.id)

  const list = []
  for (const row of rows ?? []) {
    const mapped = await mapVideoRow(row, profile)
    if (mapped) {
      applyRowFlags(mapped, row)
      list.push(mapped)
    }
  }

  return successResponse({
    list,
    total: count ?? 0,
    pageNo,
    pageSize
  })
}

export async function handleVideoFeed(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pageNo, pageSize } = parsePagination(url)
  const { user } = await tryGetAuth(req)

  // 🔍 诊断日志
  console.log('[Feed] ========== 请求开始 ==========')
  console.log('[Feed] 用户认证:', user ? `✅ ${user.id}` : '❌ 未登录')
  console.log('[Feed] 分页参数:', { pageNo, pageSize })

  let startVideo: any = null
  let startVideoId: string | null = null

  // 🎯 深链接处理（仅首页第一次加载）
  if (pageNo === 0) {
    startVideoId = url.searchParams.get('start_video_id')
    if (!startVideoId) {
      const initData = req.headers.get('X-Telegram-Init-Data')
      if (initData) {
        try {
          const params = new URLSearchParams(initData)
          const startParam = params.get('start_param')
          if (startParam?.startsWith('video_')) {
            startVideoId = startParam.replace('video_', '')
          }
        } catch (e) {
          console.error('[Feed] 解析 initData 失败:', e)
        }
      }
    }

    if (startVideoId) {
      const { data: startRow } = await supabaseAdmin
        .from('videos')
        .select('*')
        .eq('id', startVideoId)
        .eq('status', 'published')
        .maybeSingle()

      if (startRow) {
        startVideo = startRow
        console.log('[Feed] 深链接视频:', startVideoId)
      }
    }
  }

  // 🎯 计算需要获取的数量
  const targetCount = startVideo ? pageSize - 1 : pageSize
  const recommendCount = Math.ceil(targetCount * 0.7)
  const normalCount = targetCount - recommendCount

  let rows: any[] = []

  if (user?.id) {
    // 已登录用户：使用 get_feed_mix（严格排除观看历史）
    const { data, error } = await supabaseAdmin.rpc('get_feed_mix', {
      p_user_id: user.id,
      p_recommend_count: recommendCount,
      p_normal_count: normalCount,
      p_history_limit: 500 // 增加历史限制
    })

    if (error) {
      console.error('[Feed] get_feed_mix 失败:', error)
      const { data: fallbackData } = await supabaseAdmin
        .from('videos')
        .select('*')
        .eq('status', 'published')
        .eq('is_adult', false)
        .order('created_at', { ascending: false })
        .limit(pageSize)
      rows = fallbackData || []
    } else {
      // 🎯 即使 RPC 返回了成人内容，这里也强制过滤掉
      rows = (data || []).filter((r: any) => !r.is_adult)
    }
  } else {
    // 未登录用户：按时间倒序
    const { data } = await supabaseAdmin
      .from('videos')
      .select('*')
      .eq('status', 'published')
      .eq('is_adult', false)
      .order('created_at', { ascending: false })
      .limit(pageSize)
    rows = data || []
  }

  // 🎯 排除深链接视频（避免重复）
  if (startVideo) {
    rows = rows.filter((r) => r.id !== startVideoId)
  }

  // 🎯 合并：深链接视频在最前面
  const allRows = startVideo ? [startVideo, ...rows] : rows

  console.log('[Feed] 结果:', {
    深链接: !!startVideo,
    推荐数: rows.filter((r) => r.is_recommended).length,
    普通数: rows.filter((r) => !r.is_recommended).length,
    总数: allRows.length
  })

  // 附加用户标记
  await attachUserFlags(allRows, user?.id ?? null)

  // 映射视频数据
  const profileCache = new Map<string, any>()
  const list = []
  for (const row of allRows) {
    const authorProfile = await getVideoAuthorProfile(row, profileCache)
    const mapped = await mapVideoRow(row, authorProfile)
    if (mapped) {
      applyRowFlags(mapped, row)
      list.push(mapped)
    }
  }

  // 获取总数（用于分页）
  const { count } = await supabaseAdmin
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published')
    .eq('is_adult', false)

  return successResponse({
    list,
    total: count ?? 0,
    pageNo,
    pageSize,
    hasMore: list.length >= pageSize
  })
}

/**
 * 关注流：按时间倒序，包含成人内容
 * GET /video/following?pageNo=&pageSize=
 */
export async function handleVideoFollowing(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const url = new URL(req.url)
  const { pageNo, pageSize, from, to } = parsePagination(url)

  // 查询当前用户关注的作者
  const { data: follows, error: followError } = await supabaseAdmin
    .from('follows')
    .select('followee_id')
    .eq('follower_id', user.id)

  if (followError) {
    console.error('[FollowFeed] 查询关注列表失败:', followError)
    return errorResponse('Failed to load following feed', 1, 500)
  }

  const followeeIds = (follows ?? []).map((f) => f.followee_id).filter(Boolean)
  if (!followeeIds.length) {
    return successResponse({
      list: [],
      total: 0,
      pageNo,
      pageSize
    })
  }

  // 按发布时间倒序拉取关注作者的公开作品（包含成人内容）
  const {
    data: rows,
    error: videoError,
    count
  } = await supabaseAdmin
    .from('videos')
    .select('*', { count: 'exact' })
    .in('author_id', followeeIds)
    .eq('status', 'published')
    .eq('is_private', false)
    .order('published_at', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (videoError) {
    console.error('[FollowFeed] 查询视频失败:', videoError)
    return errorResponse('Failed to load following feed', 1, 500)
  }

  await attachUserFlags(rows ?? [], user.id)

  const profileCache = new Map<string, any>()
  const list = []
  for (const row of rows ?? []) {
    const authorProfile = await getVideoAuthorProfile(row, profileCache)
    const mapped = await mapVideoRow(row, authorProfile)
    if (mapped) {
      applyRowFlags(mapped, row)
      list.push(mapped)
    }
  }

  return successResponse({
    list,
    total: count ?? 0,
    pageNo,
    pageSize
  })
}

export async function handleVideoAuthor(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const authorId = url.searchParams.get('user_id')
  if (!authorId) {
    throw new HttpError('Missing user_id', 400)
  }
  const { pageNo, pageSize, from, to } = parsePagination(url)
  const { user } = await tryGetAuth(req)

  const {
    data: rows,
    error: videoError,
    count
  } = await supabaseAdmin
    .from('videos')
    .select('*', { count: 'exact' })
    .eq('status', 'published')
    .eq('author_id', authorId)
    .order('is_top', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (videoError) {
    console.error('[app-server] Load author videos failed:', videoError)
    return errorResponse('Failed to load videos', 1, 500)
  }

  await attachUserFlags(rows ?? [], user?.id ?? null)
  const authorProfile = await getProfileById(authorId)

  const list = []
  for (const row of rows ?? []) {
    const mapped = await mapVideoRow(row, authorProfile)
    if (mapped) {
      applyRowFlags(mapped, row)
      list.push(mapped)
    }
  }

  return successResponse({
    list,
    total: count ?? 0,
    pageNo,
    pageSize
  })
}

// 🎯 根据 video_id 获取单个视频详情
export async function handleVideoDetail(req: Request): Promise<Response> {
  console.log('[app-server][VideoDetail] ========== 开始处理视频详情请求 ==========')

  const url = new URL(req.url)
  const videoId = url.searchParams.get('video_id')

  console.log('[app-server][VideoDetail] 请求 URL:', req.url)
  console.log('[app-server][VideoDetail] video_id 参数:', videoId)

  if (!videoId) {
    console.error('[app-server][VideoDetail] ❌ 缺少 video_id 参数')
    throw new HttpError('Missing video_id', 400)
  }

  console.log('[app-server][VideoDetail] video_id 长度:', videoId.length)
  console.log('[app-server][VideoDetail] video_id 类型:', typeof videoId)

  const { user } = await tryGetAuth(req)
  console.log('[app-server][VideoDetail] 当前用户:', user?.id || '未登录')

  console.log('[app-server][VideoDetail] 📡 查询数据库...')
  const { data: row, error: videoError } = await supabaseAdmin
    .from('videos')
    .select('*')
    .eq('id', videoId)
    .eq('status', 'published')
    .maybeSingle()

  if (videoError) {
    console.error('[app-server][VideoDetail] ❌ 数据库查询失败:', videoError)
    console.error('[app-server][VideoDetail] 错误详情:', JSON.stringify(videoError, null, 2))
    return errorResponse('Failed to load video', 1, 500)
  }

  if (!row) {
    console.error('[app-server][VideoDetail] ❌ 视频不存在')
    console.error('[app-server][VideoDetail] 查询的 video_id:', videoId)
    return errorResponse('Video not found', 1, 404)
  }

  console.log('[app-server][VideoDetail] ✅ 找到视频')
  console.log('[app-server][VideoDetail] 视频ID:', row.id)
  console.log('[app-server][VideoDetail] 视频描述:', row.description)
  console.log('[app-server][VideoDetail] 作者ID:', row.author_id)
  console.log('[app-server][VideoDetail] 视频状态:', row.status)
  console.log('[app-server][VideoDetail] 视频原始数据:', JSON.stringify(row, null, 2))

  console.log('[app-server][VideoDetail] 📝 附加用户标记...')
  await attachUserFlags([row], user?.id ?? null)

  console.log('[app-server][VideoDetail] 👤 获取作者信息...')
  const authorProfile = await getVideoAuthorProfile(row, new Map())
  console.log(
    '[app-server][VideoDetail] 作者信息:',
    authorProfile ? `${authorProfile.nickname} (${authorProfile.id})` : '未找到'
  )

  console.log('[app-server][VideoDetail] 🔄 映射视频数据...')
  const mapped = await mapVideoRow(row, authorProfile)

  if (!mapped) {
    console.error('[app-server][VideoDetail] ❌ 映射视频数据失败')
    return errorResponse('Failed to process video', 1, 500)
  }

  console.log('[app-server][VideoDetail] ✅ 映射成功')
  console.log('[app-server][VideoDetail] 映射后的 aweme_id:', mapped.aweme_id)
  console.log('[app-server][VideoDetail] 映射后的描述:', mapped.desc)
  console.log('[app-server][VideoDetail] 映射后的作者:', mapped.author?.nickname)

  applyRowFlags(mapped, row)

  console.log('[app-server][VideoDetail] ✅ 返回视频数据')
  console.log('[app-server][VideoDetail] 完整映射数据:', JSON.stringify(mapped, null, 2))
  console.log('[app-server][VideoDetail] ========== 处理完成 ==========')

  return successResponse(mapped)
}

export async function handleVideoLikes(req: Request): Promise<Response> {
  const { user } = await tryGetAuth(req)
  const url = new URL(req.url)
  const { pageNo, pageSize, from, to } = parsePagination(url)

  // 🎯 支持查询指定用户的喜欢列表
  const targetUserId = url.searchParams.get('user_id')

  // 如果没有指定user_id，则必须登录，查询自己的
  if (!targetUserId) {
    if (!user) {
      throw new HttpError('Missing user_id or authentication', 401)
    }
    // 查询自己的喜欢列表，无需隐私检查
    return await queryUserLikes(user.id, user.id, { pageNo, pageSize, from, to })
  }

  // 查询别人的喜欢列表，需要检查隐私设置
  const targetProfile = await getProfileById(targetUserId)
  if (!targetProfile || targetProfile.show_like !== true) {
    // 如果隐私设置不允许，返回空列表
    return successResponse({
      list: [],
      total: 0,
      pageNo,
      pageSize
    })
  }

  return await queryUserLikes(targetUserId, user?.id ?? null, { pageNo, pageSize, from, to })
}

async function queryUserLikes(
  targetUserId: string,
  currentUserId: string | null,
  pagination: { pageNo: number; pageSize: number; from: number; to: number }
): Promise<Response> {
  const {
    data: likeRows,
    error,
    count
  } = await supabaseAdmin
    .from('video_likes')
    .select('video_id, created_at', { count: 'exact' })
    .eq('user_id', targetUserId)
    .order('created_at', { ascending: false })
    .range(pagination.from, pagination.to)

  if (error) {
    console.error('[app-server] Load liked videos failed:', error)
    return errorResponse('Failed to load videos', 1, 500)
  }

  const videoIds = (likeRows ?? []).map((row) => row.video_id).filter(Boolean)
  let videos: any[] = []
  if (videoIds.length) {
    const { data: videoData, error: videoError } = await supabaseAdmin
      .from('videos')
      .select('*')
      .in('id', videoIds)
      .eq('status', 'published')
    if (videoError) {
      console.error('[app-server] Fetch liked videos failed:', videoError)
      return errorResponse('Failed to load videos', 1, 500)
    }
    const videoMap = new Map((videoData ?? []).map((row) => [row.id, row]))
    videos = videoIds.map((id) => videoMap.get(id)).filter(Boolean)
  }

  await attachUserFlags(videos, currentUserId)

  const profileCache = new Map<string, any>()
  const list = []
  for (const row of videos ?? []) {
    const authorProfile = await getVideoAuthorProfile(row, profileCache)
    const mapped = await mapVideoRow(row, authorProfile)
    if (mapped) {
      mapped.isLoved = true
      applyRowFlags(mapped, row)
      list.push(mapped)
    }
  }

  return successResponse({
    list,
    total: count ?? 0,
    pageNo: pagination.pageNo,
    pageSize: pagination.pageSize
  })
}

export async function handleVideoLike(req: Request): Promise<Response> {
  const { user, profile } = await requireAuth(req, { withProfile: true })
  const body = await parseJsonBody<{ video_id?: string; liked?: boolean }>(req)
  if (!body.video_id || typeof body.liked !== 'boolean') {
    throw new HttpError('Missing video_id or liked flag', 400)
  }

  if (body.liked) {
    const { error } = await supabaseAdmin
      .from('video_likes')
      .upsert({ user_id: user.id, video_id: body.video_id }, { onConflict: 'user_id,video_id' })
    if (error) {
      console.error('[app-server] Like video failed:', error)
      return errorResponse('Failed to like video', 1, 500)
    }
  } else {
    const { error } = await supabaseAdmin
      .from('video_likes')
      .delete()
      .eq('user_id', user.id)
      .eq('video_id', body.video_id)
    if (error) {
      console.error('[app-server] Unlike video failed:', error)
      return errorResponse('Failed to unlike video', 1, 500)
    }
  }

  const { data: video } = await supabaseAdmin
    .from('videos')
    .select('like_count, author_id, description')
    .eq('id', body.video_id)
    .maybeSingle()

  // 🔍 调试日志：点赞通知前置检查
  console.log('[DEBUG-LIKE] 检查通知条件:', {
    liked: body.liked,
    hasVideo: !!video,
    authorId: video?.author_id,
    currentUserId: user.id,
    isSelf: video?.author_id === user.id
  })

  // 发送通知
  if (body.liked && video && video.author_id && video.author_id !== user.id) {
    const nickname = profile.nickname || profile.username || '用户'
    // 异步发送
    checkAndSendNotification(
      video.author_id,
      'like',
      `❤️ 用户 <b>${nickname}</b> 赞了你的作品`,
      `video_${body.video_id}`
    )
  }

  return successResponse({
    liked: body.liked,
    like_count: video?.like_count ?? 0
  })
}

export async function handleVideoCollections(req: Request): Promise<Response> {
  const { user } = await tryGetAuth(req)
  const url = new URL(req.url)
  const { pageNo, pageSize, from, to } = parsePagination(url)

  // 🎯 支持查询指定用户的收藏列表
  const targetUserId = url.searchParams.get('user_id')

  // 如果没有指定user_id，则必须登录，查询自己的
  if (!targetUserId) {
    if (!user) {
      throw new HttpError('Missing user_id or authentication', 401)
    }
    // 查询自己的收藏列表，无需隐私检查
    return await queryUserCollections(user.id, user.id, { pageNo, pageSize, from, to })
  }

  // 查询别人的收藏列表，需要检查隐私设置
  const targetProfile = await getProfileById(targetUserId)
  if (!targetProfile || targetProfile.show_collect !== true) {
    // 如果隐私设置不允许，返回空列表
    return successResponse({
      list: [],
      total: 0,
      pageNo,
      pageSize
    })
  }

  return await queryUserCollections(targetUserId, user?.id ?? null, { pageNo, pageSize, from, to })
}

async function queryUserCollections(
  targetUserId: string,
  currentUserId: string | null,
  pagination: { pageNo: number; pageSize: number; from: number; to: number }
): Promise<Response> {
  const {
    data: collectionRows,
    error,
    count
  } = await supabaseAdmin
    .from('video_collections')
    .select('video_id, created_at', { count: 'exact' })
    .eq('user_id', targetUserId)
    .order('created_at', { ascending: false })
    .range(pagination.from, pagination.to)

  if (error) {
    console.error('[app-server] Load collected videos failed:', error)
    return errorResponse('Failed to load videos', 1, 500)
  }

  const videoIds = (collectionRows ?? []).map((row) => row.video_id).filter(Boolean)
  let videos: any[] = []
  if (videoIds.length) {
    const { data: videoData, error: videoError } = await supabaseAdmin
      .from('videos')
      .select('*')
      .in('id', videoIds)
      .eq('status', 'published')
    if (videoError) {
      console.error('[app-server] Fetch collected videos failed:', videoError)
      return errorResponse('Failed to load videos', 1, 500)
    }
    const videoMap = new Map((videoData ?? []).map((row) => [row.id, row]))
    videos = videoIds.map((id) => videoMap.get(id)).filter(Boolean)
  }

  await attachUserFlags(videos, currentUserId)

  const profileCache = new Map<string, any>()
  const list = []
  for (const row of videos ?? []) {
    const authorProfile = await getVideoAuthorProfile(row, profileCache)
    const mapped = await mapVideoRow(row, authorProfile)
    if (mapped) {
      mapped.isCollect = true
      applyRowFlags(mapped, row)
      list.push(mapped)
    }
  }

  return successResponse({
    list,
    total: count ?? 0,
    pageNo: pagination.pageNo,
    pageSize: pagination.pageSize
  })
}

export async function handleVideoCollect(req: Request): Promise<Response> {
  const { user, profile } = await requireAuth(req, { withProfile: true })
  const body = await parseJsonBody<{ video_id?: string; collected?: boolean }>(req)
  if (!body.video_id || typeof body.collected !== 'boolean') {
    throw new HttpError('Missing video_id or collected flag', 400)
  }

  if (body.collected) {
    const { error } = await supabaseAdmin
      .from('video_collections')
      .upsert({ user_id: user.id, video_id: body.video_id }, { onConflict: 'user_id,video_id' })
    if (error) {
      console.error('[app-server] Collect video failed:', error)
      return errorResponse('Failed to collect video', 1, 500)
    }
  } else {
    const { error } = await supabaseAdmin
      .from('video_collections')
      .delete()
      .eq('user_id', user.id)
      .eq('video_id', body.video_id)
    if (error) {
      console.error('[app-server] Un-collect video failed:', error)
      return errorResponse('Failed to remove collection', 1, 500)
    }
  }

  const { data: video } = await supabaseAdmin
    .from('videos')
    .select('collect_count, author_id, description')
    .eq('id', body.video_id)
    .maybeSingle()

  // 发送通知
  if (body.collected && video && video.author_id && video.author_id !== user.id) {
    const nickname = profile.nickname || profile.username || '用户'
    checkAndSendNotification(
      video.author_id,
      'collect',
      `⭐ 用户 <b>${nickname}</b> 收藏了你的作品`,
      `video_${body.video_id}`
    )
  }

  return successResponse({
    collected: body.collected,
    collect_count: video?.collect_count ?? 0
  })
}

/**
 * 批量审核视频
 * POST /video/batch-review
 */
export async function handleBatchReview(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  const { video_ids, action, reject_reason } = body

  if (!video_ids || !Array.isArray(video_ids) || video_ids.length === 0) {
    return errorResponse('video_ids is required and must be a non-empty array', 1, 400)
  }

  if (!action || !['approve', 'reject'].includes(action)) {
    return errorResponse('action must be either "approve" or "reject"', 1, 400)
  }

  if (action === 'reject' && !reject_reason) {
    return errorResponse('reject_reason is required when rejecting', 1, 400)
  }

  console.log(`[batch-review] ${action} ${video_ids.length} videos`)

  try {
    if (action === 'approve') {
      // 批量通过：先查询所有视频的状态
      const { data: videos, error: queryError } = await supabaseAdmin
        .from('videos')
        .select('id, status')
        .in('id', video_ids)

      if (queryError) {
        console.error('[batch-review] Query videos error:', queryError)
        return errorResponse('Failed to query videos', 1, 500)
      }

      // 批量更新：ready → published, 其他状态保持
      const updatePromises = (videos ?? []).map((video) => {
        const shouldPublish = video.status === 'ready'
        return supabaseAdmin
          .from('videos')
          .update({
            review_status: 'approved',
            status: shouldPublish ? 'published' : video.status
          })
          .eq('id', video.id)
      })

      const results = await Promise.all(updatePromises)

      // 检查是否有错误
      const errors = results.filter((r) => r.error)
      if (errors.length > 0) {
        console.error('[batch-review] Some updates failed:', errors)
        return errorResponse(`${errors.length} videos failed to update`, 1, 500)
      }

      console.log(`[batch-review] Successfully approved ${video_ids.length} videos`)
      return successResponse({
        success: true,
        updated: video_ids.length
      })
    } else {
      // 批量拒绝
      const { error } = await supabaseAdmin
        .from('videos')
        .update({
          review_status: 'rejected',
          reject_reason: reject_reason
        })
        .in('id', video_ids)

      if (error) {
        console.error('[batch-review] Batch reject error:', error)
        return errorResponse('Failed to reject videos', 1, 500)
      }

      console.log(`[batch-review] Successfully rejected ${video_ids.length} videos`)
      return successResponse({
        success: true,
        updated: video_ids.length
      })
    }
  } catch (error) {
    console.error('[batch-review] Unexpected error:', error)
    return errorResponse('Internal server error', 1, 500)
  }
}

/**
 * 单个视频审核通过（含自动审核逻辑）
 * POST /video/approve
 */
export async function handleApproveVideo(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  const { video_id } = body

  if (!video_id) {
    return errorResponse('video_id is required', 1, 400)
  }

  console.log(`[approve] Processing video: ${video_id}`)

  try {
    // 1. 查询视频信息（包含描述，用于通知）
    const { data: video, error: videoError } = await supabaseAdmin
      .from('videos')
      .select('id, status, author_id, tg_user_id, description')
      .eq('id', video_id)
      .single()

    if (videoError || !video) {
      console.error('[approve] Video not found:', videoError)
      return errorResponse('Video not found', 1, 404)
    }

    // 2. 更新视频状态
    const shouldPublish = video.status === 'ready'
    const { error: updateError } = await supabaseAdmin
      .from('videos')
      .update({
        review_status: 'approved',
        status: shouldPublish ? 'published' : video.status,
        published_at: shouldPublish ? new Date().toISOString() : null
      })
      .eq('id', video_id)

    if (updateError) {
      console.error('[approve] Update video failed:', updateError)
      return errorResponse('Failed to approve video', 1, 500)
    }

    // 3. 检查并更新用户的自动审核权限
    let autoApproveEnabled = false
    const authorField = video.tg_user_id ? 'tg_user_id' : 'id'
    const authorValue = video.tg_user_id ?? video.author_id

    // 查询用户当前的 auto_approve 状态和昵称
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, auto_approve, nickname')
      .eq(authorField, authorValue)
      .single()

    if (profile && !profile.auto_approve) {
      // 用户还没有自动审核权限，这是他的第一个通过的视频
      // 设置 auto_approve = true
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({ auto_approve: true })
        .eq('id', profile.id)

      if (profileError) {
        console.error('[approve] Failed to update auto_approve:', profileError)
        // 不影响主流程，只记录日志
      } else {
        autoApproveEnabled = true
        console.log(`[approve] Enabled auto_approve for user: ${profile.id}`)
      }
    }

    // 🎯 4. 审核通过并发布后，通知粉丝
    if (shouldPublish && profile?.id) {
      const { notifyFollowersNewPost } = await import('../lib/notification.ts')
      notifyFollowersNewPost(
        profile.id,
        profile.nickname || '用户',
        video_id,
        video.description
      ).catch((e: any) => {
        console.error('[approve] 通知粉丝失败:', e)
      })
    }

    console.log(`[approve] Successfully approved video: ${video_id}`)
    return successResponse({
      success: true,
      auto_approve_enabled: autoApproveEnabled
    })
  } catch (error) {
    console.error('[approve] Unexpected error:', error)
    return errorResponse('Internal server error', 1, 500)
  }
}

/**
 * 记录观看历史
 * POST /video/view
 * body: { video_id: string, progress?: number, completed?: boolean }
 * progress: 0-100 的百分比
 */
export async function handleRecordView(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const body = await parseJsonBody(req)
  const { video_id, progress, completed } = body

  if (!video_id) {
    return errorResponse('video_id is required', 1, 400)
  }

  try {
    // 先查询是否已存在记录
    const { data: existing } = await supabaseAdmin
      .from('watch_history')
      .select('id, progress, completed')
      .eq('user_id', user.id)
      .eq('video_id', video_id)
      .maybeSingle()

    if (existing) {
      // 已存在，更新记录（只更新更大的进度，完播状态只能从 false -> true）
      const updateData: Record<string, any> = {
        updated_at: new Date().toISOString()
      }
      // 只更新更大的进度值
      if (progress !== undefined && (existing.progress === null || progress > existing.progress)) {
        updateData.progress = Math.min(100, Math.max(0, progress))
      }
      // 完播状态只能设为 true，不能撤销
      if (completed === true && !existing.completed) {
        updateData.completed = true
      }

      await supabaseAdmin.from('watch_history').update(updateData).eq('id', existing.id)
    } else {
      // 不存在，插入新记录
      const { error: insertError } = await supabaseAdmin.from('watch_history').insert({
        user_id: user.id,
        video_id: video_id,
        progress: progress !== undefined ? Math.min(100, Math.max(0, progress)) : 0,
        completed: completed === true
      })

      // 🎯 首次观看，view_count + 1
      if (!insertError) {
        await supabaseAdmin.rpc('increment_view_count', { p_video_id: video_id })
      }
    }

    return successResponse({ success: true })
  } catch (error) {
    console.error('[view] Unexpected error:', error)
    return successResponse({ success: true }) // 即使失败也返回成功，不影响用户体验
  }
}
