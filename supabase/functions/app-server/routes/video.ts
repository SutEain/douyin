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

  // 🎯 统一使用 author_id (UUID) 进行查询，这是 videos 表的标准关联字段
  const userValue = profile.id

  // ✅ 只返回已发布和草稿状态的视频（不包括 processing）
  const {
    data: rows,
    error: videoError,
    count
  } = await supabaseAdmin
    .from('videos')
    .select('*', { count: 'exact' })
    .eq('author_id', userValue)
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
            let videoId = startParam.replace('video_', '')
            // 去除邀请码后缀
            if (videoId.includes('_i')) {
              videoId = videoId.split('_i')[0]
            }
            startVideoId = videoId
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

  // 🎯 计算需要获取的数量（如果有深链视频，需要少获取一个）
  const targetCount = startVideo ? pageSize - 1 : pageSize

  let rows: any[] = []

  // 使用优化的 RPC 获取混合流（排除历史，随机推荐）
  // 🎯 深链打开时，保持原有过滤逻辑（排除历史、成人、东南亚），只是把深链作品放到第一个
  const { data, error } = await supabaseAdmin.rpc('get_optimized_video_feed', {
    p_user_id: user?.id || null,
    p_type: 'recommend',
    p_limit: targetCount
  })

  if (error) {
    console.error('[Feed] get_optimized_video_feed 失败:', error)
    // 降级：按时间倒序
    const { from, to } = parsePagination(url)
    const { data: fallbackData } = await supabaseAdmin
      .from('videos')
      .select('*')
      .eq('status', 'published')
      .eq('is_adult', false)
      .order('created_at', { ascending: false })
      .range(from, to)
    rows = fallbackData || []
  } else {
    rows = data || []
  }

  // 🎯 排除深链接视频（避免重复）
  if (startVideo) {
    rows = rows.filter((r) => r.id !== startVideoId)
  }

  // 🎯 合并：深链接视频在最前面（无论深链视频是什么类型，都放到第一个）
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
  // .eq('is_sea', false) // 🎯 允许东南亚内容

  return successResponse({
    list,
    total: count ?? 0,
    pageNo,
    pageSize,
    hasMore: list.length >= pageSize
  })
}

/**
 * 东南亚板块流：返回已发布、非成人且 is_sea=true 的作品（包括视频和图文），按发布时间倒序
 * GET /video/long-feed?pageNo=&pageSize=
 */
export async function handleVideoLongFeed(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pageNo, pageSize, from, to } = parsePagination(url)
  const { user } = await tryGetAuth(req)

  let rows: any[] = []
  let totalCount = 0

  if (user?.id) {
    // 🎯 已登录用户：排除已观看历史，按发布时间倒序
    const { data, error } = await supabaseAdmin.rpc('get_sea_feed', {
      p_user_id: user.id,
      p_page_no: pageNo,
      p_page_size: pageSize
    })

    if (error) {
      console.error('[LongFeed] get_sea_feed RPC 失败:', error)
      // 降级到普通查询
      const fallback = await supabaseAdmin
        .from('videos')
        .select('*', { count: 'exact' })
        .eq('status', 'published')
        .eq('is_adult', false)
        .eq('is_sea', true)
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(from, to)
      rows = fallback.data || []
      totalCount = fallback.count ?? 0
    } else {
      rows = data || []
      // 这里的 total 可能需要单独查一次，或者由 RPC 返回
      const { count } = await supabaseAdmin
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'published')
        .eq('is_adult', false)
        .eq('is_sea', true)
      totalCount = count ?? 0
    }
  } else {
    // 未登录用户：普通查询
    const { data, error, count } = await supabaseAdmin
      .from('videos')
      .select('*', { count: 'exact' })
      .eq('status', 'published')
      .eq('is_adult', false)
      .eq('is_sea', true)
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) {
      console.error('[LongFeed] 查询视频失败:', error)
      return errorResponse('Failed to load long feed', 1, 500)
    }
    rows = data || []
    totalCount = count ?? 0
  }

  await attachUserFlags(rows, user?.id ?? null)

  const profileCache = new Map<string, any>()
  const list: any[] = []
  for (const row of rows) {
    const authorProfile = await getVideoAuthorProfile(row, profileCache)
    const mapped = await mapVideoRow(row, authorProfile)
    if (mapped) {
      applyRowFlags(mapped, row)
      list.push(mapped)
    }
  }

  return successResponse({
    list,
    total: totalCount,
    pageNo,
    pageSize,
    hasMore: list.length >= pageSize
  })
}

/**
 * 普通视频 Tab：只返回 content_type = 'video' 且 is_sea = false 且 is_adult = false 的已发布作品，按发布时间倒序
 * GET /video/video-tab-feed?pageNo=&pageSize=
 *
 * 说明：
 * - 🎯 单独接口，不与 feed 流复用
 * - 允许未登录访问；如已登录则附加 like/collect/follow 等标记
 */
export async function handleVideoTabFeed(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pageNo, pageSize, from, to } = parsePagination(url)
  const { user } = await tryGetAuth(req)

  const { data, error, count } = await supabaseAdmin
    .from('videos')
    .select('*', { count: 'exact' })
    .eq('status', 'published')
    .eq('is_adult', false)
    .in('content_type', ['video', 'collection']) // 🎯 允许视频和合集
    // .eq('is_sea', false) // 🎯 允许东南亚内容
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('[VideoTabFeed] 查询视频失败:', error)
    return errorResponse('Failed to load video tab feed', 1, 500)
  }

  await attachUserFlags(data ?? [], user?.id ?? null)

  const profileCache = new Map<string, any>()
  const list: any[] = []
  for (const row of data ?? []) {
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
    pageSize,
    hasMore: list.length >= pageSize
  })
}

/**
 * 图文 Tab：只返回 content_type in ('image','album') 且 is_sea = false 且 is_adult = false 的已发布作品，按发布时间倒序
 * GET /video/graphic-feed?pageNo=&pageSize=
 *
 * 说明：
 * - 🎯 单独接口，不与 feed 流复用
 * - 允许未登录访问；如已登录则附加 like/collect/follow 等标记
 */
/**
 * 成人内容流：只返回 is_adult = true 的已发布视频，按时间倒序
 * GET /video/adult-feed?pageNo=&pageSize=
 */
export async function handleVideoAdultFeed(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pageNo, pageSize, from, to } = parsePagination(url)
  const { user } = await tryGetAuth(req)

  // 使用优化的 RPC 获取成人流（排除历史，时间倒序）
  let rows: any[] = []
  let total: number | null = null

  const { data, error } = await supabaseAdmin.rpc('get_optimized_video_feed', {
    p_user_id: user?.id || null,
    p_type: 'adult',
    p_limit: pageSize
  })

  if (error) {
    console.error('[AdultFeed] get_optimized_video_feed 失败，降级为简单查询:', error)
    const fallback = await supabaseAdmin
      .from('videos')
      .select('*', { count: 'exact' })
      .eq('status', 'published')
      .eq('is_adult', true)
      .order('created_at', { ascending: false })
      .range(from, to)

    if (fallback.error) {
      console.error('[AdultFeed] 简单查询也失败:', fallback.error)
      return errorResponse('Failed to load adult feed', 1, 500)
    }

    rows = fallback.data || []
    total = fallback.count ?? null
  } else {
    rows = data || []
  }

  await attachUserFlags(rows ?? [], user?.id || null)

  const profileCache = new Map<string, any>()
  const list: any[] = []
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
    total:
      total ?? (list.length >= pageSize ? (pageNo + 2) * pageSize : (pageNo + 1) * list.length),
    pageNo,
    pageSize,
    hasMore: list.length >= pageSize
  })
}

/**
 * 计算用户今日成人内容配额
 */
export async function getAdultQuota(userId: string) {
  // 读取用户配置
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('adult_daily_limit, adult_permanent_unlock, adult_unlock_until, invite_success_count')
    .eq('id', userId)
    .maybeSingle()

  // 默认每日上限 10 条
  const dailyLimit = profile?.adult_daily_limit ?? 10
  const unlockUntil = profile?.adult_unlock_until ? new Date(profile.adult_unlock_until) : null

  // 🎯 A方案修复：强制返回无限配额
  return {
    unlimited: true,
    limit: dailyLimit,
    used: 0,
    remaining: 999999,
    unlock_until: unlockUntil ? unlockUntil.toISOString() : null,
    permanent: true,
    invite_success_count: profile?.invite_success_count ?? 0
  }

  /* 原始限制逻辑已注释
  if (permanent || (unlockUntil && unlockUntil > now)) {
    return {
      unlimited: true,
      limit: dailyLimit,
      used: 0,
      remaining: Number.POSITIVE_INFINITY,
      unlock_until: unlockUntil ? unlockUntil.toISOString() : null,
      permanent,
      invite_success_count: profile?.invite_success_count ?? 0
    }
  }

  // 统计今天已观看的成人视频数量
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startISO = startOfDay.toISOString()

  const { data: historyRows } = await supabaseAdmin
    .from('watch_history')
    .select('video_id')
    .eq('user_id', userId)
    .gte('updated_at', startISO)

  const videoIds = Array.from(
    new Set((historyRows ?? []).map((row: any) => row.video_id).filter(Boolean))
  )

  let used = 0
  if (videoIds.length > 0) {
    const { count } = await supabaseAdmin
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .in('id', videoIds)
      .eq('is_adult', true)
      .eq('status', 'published')

    used = count ?? 0
  }

  const remaining = Math.max(0, dailyLimit - used)

  return {
    unlimited: false,
    limit: dailyLimit,
    used,
    remaining,
    unlock_until: null,
    permanent: false,
    invite_success_count: profile?.invite_success_count ?? 0
  }
  */
}

/**
 * 获取用户成人内容配额信息
 * GET /video/adult-quota
 */
export async function handleGetAdultQuota(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const quota = await getAdultQuota(user.id)
  return successResponse(quota)
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
    // 🎯 频率限制：1分钟点赞不能超过 15 次
    const { count: recentLikes } = await supabaseAdmin
      .from('video_likes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - 60000).toISOString())

    if (recentLikes !== null && recentLikes >= 15) {
      throw new HttpError('点赞太频繁了，先休息下吧', 429)
    }

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
      `video_${body.video_id}`,
      user.id
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
    // 🎯 频率限制：1分钟收藏不能超过 10 次
    const { count: recentCollects } = await supabaseAdmin
      .from('video_collections')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - 60000).toISOString())

    if (recentCollects !== null && recentCollects >= 10) {
      throw new HttpError('收藏太频繁了，先休息下吧', 429)
    }

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
      `video_${body.video_id}`,
      user.id
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

  if (
    !action ||
    !['approve', 'reject', 'set_adult', 'unset_adult', 'set_sea', 'unset_sea', 'delete'].includes(
      action
    )
  ) {
    return errorResponse(
      'action must be one of: approve, reject, set_adult, unset_adult, set_sea, unset_sea, delete',
      1,
      400
    )
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
        .select('id, status, author_id')
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
            status: shouldPublish ? 'published' : video.status,
            published_at: shouldPublish ? new Date().toISOString() : null
          })
          .eq('id', video.id)
      })

      const results = await Promise.all(updatePromises)

      // 🎯 任务 2: 处理作者的 auto_approve 提升
      const authorIds = Array.from(new Set((videos ?? []).map((v) => v.author_id).filter(Boolean)))
      if (authorIds.length > 0) {
        // 查找这些作者中还没有 auto_approve 权限的
        const { data: profilesToPromote } = await supabaseAdmin
          .from('profiles')
          .select('id, auto_approve')
          .in('id', authorIds)
          .or('auto_approve.eq.false,auto_approve.is.null')

        if (profilesToPromote && profilesToPromote.length > 0) {
          const promoteIds = profilesToPromote.map((p) => p.id)
          await supabaseAdmin.from('profiles').update({ auto_approve: true }).in('id', promoteIds)

          // 发送通知
          const approvalNotice =
            `🎉 <b>您的作品已通过审核！</b>\n\n` +
            `由于您的首个作品表现优秀，系统已为您开启<b>【免审核模式】</b>。今后您发布的作品将自动发布，无需等待人工审核。\n\n` +
            `📌 <b>发布规范提醒：</b>\n` +
            `1. <b>成人内容</b>：请务必将其分类到<b>【成人】</b>频道。\n` +
            `2. <b>东南亚内容</b>：请务必将其分类到<b>【东南亚】</b>频道。\n\n` +
            `良好的分类有助于您的作品获得更多精准流量。感谢您的配合！`

          for (const pid of promoteIds) {
            checkAndSendNotification(pid, 'request_update', approvalNotice).catch((e) =>
              console.error(`[batch-review] 通知作者 ${pid} 失败:`, e)
            )
          }
        }
      }

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
    } else if (action === 'reject') {
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
    } else if (action === 'delete') {
      // 批量删除视频
      const { error } = await supabaseAdmin.from('videos').delete().in('id', video_ids)

      if (error) {
        console.error('[batch-review] Batch delete error:', error)
        return errorResponse('Failed to delete videos', 1, 500)
      }

      console.log(`[batch-review] Successfully deleted ${video_ids.length} videos`)
      return successResponse({
        success: true,
        deleted: video_ids.length
      })
    } else {
      // 批量设置标记：set_adult, unset_adult, set_sea, unset_sea
      const updatePayload: Record<string, any> = {}
      if (action === 'set_adult') updatePayload.is_adult = true
      if (action === 'unset_adult') updatePayload.is_adult = false
      if (action === 'set_sea') updatePayload.is_sea = true
      if (action === 'unset_sea') updatePayload.is_sea = false

      const { error } = await supabaseAdmin.from('videos').update(updatePayload).in('id', video_ids)

      if (error) {
        console.error(`[batch-review] Batch ${action} error:`, error)
        return errorResponse(`Failed to perform batch action ${action}`, 1, 500)
      }

      console.log(`[batch-review] Successfully performed ${action} on ${video_ids.length} videos`)
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
    // 1. 查询视频信息（包含描述、is_auto_sync，用于通知）
    const { data: video, error: videoError } = await supabaseAdmin
      .from('videos')
      .select('id, status, author_id, tg_user_id, description, is_auto_sync')
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
      .select('id, auto_approve, nickname, tg_user_id')
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

        // 🎯 任务2：通知新用户已获得免审核权限，并提醒分类规范
        const approvalNotice =
          `🎉 <b>您的作品已通过审核！</b>\n\n` +
          `由于您的首个作品表现优秀，系统已为您开启<b>【免审核模式】</b>。今后您发布的作品将自动发布，无需等待人工审核。\n\n` +
          `📌 <b>发布规范提醒：</b>\n` +
          `1. <b>成人内容</b>：请务必将其分类到<b>【成人】</b>频道。\n` +
          `2. <b>东南亚内容</b>：请务必将其分类到<b>【东南亚】</b>频道。\n\n` +
          `良好的分类有助于您的作品获得更多精准流量。感谢您的配合！`

        checkAndSendNotification(profile.id, 'request_update', approvalNotice).catch((e) =>
          console.error('[approve] 发送免审核通知失败:', e)
        )
      }
    }

    // 🎯 4. 审核通过并发布后，发送通知
    if (shouldPublish && profile?.id) {
      // 🎯 如果是频道同步视频，发送专门的频道同步通知（只有发布成功才通知）
      if (video.is_auto_sync) {
        // 优先使用 video.tg_user_id，如果没有则使用 profile.tg_user_id
        const tgUserId = video.tg_user_id || profile.tg_user_id
        if (tgUserId) {
          const TG_BOT_TOKEN = Deno.env.get('TG_BOT_TOKEN')
          if (TG_BOT_TOKEN) {
            const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`
            fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: tgUserId,
                text: '同步成功 📢：检测到您的频道发布了新视频，已自动发布。',
                parse_mode: 'HTML'
              })
            }).catch((e: any) => {
              console.error('[approve] 发送频道同步通知失败:', e)
            })
          }
        }
      }

      // 通知粉丝有新作品发布
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
    // 🎯 使用原子 RPC v2 处理：
    // 1. 自动处理并发冲突 (FOR UPDATE 锁定)
    // 2. 自动增加视频 view_count (首次观看时)
    // 3. 自动更新 watch_history
    // 4. 自动触发任务进度 increment_task_progress (完播时)
    const { data, error } = await supabaseAdmin.rpc('record_video_view_v2', {
      p_user_id: user.id,
      p_video_id: video_id,
      p_progress: progress ?? 0,
      p_completed: completed === true
    })

    if (error) {
      console.error('[view] RPC record_video_view_v2 failed:', error)
      return errorResponse('Failed to record view', 1, 500)
    }

    return successResponse(data)
  } catch (error) {
    console.error('[view] Unexpected error:', error)
    return successResponse({ success: true }) // 即使失败也返回成功，不影响用户体验
  }
}

/**
 * 累计观看时长
 * POST /video/watch-time
 * body: { seconds: number, video_id?: string }
 */
export async function handleIncrementWatchTime(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const body = await parseJsonBody(req)
  const { seconds, video_id } = body

  if (!seconds || seconds <= 0) {
    return errorResponse('seconds must be a positive number', 1, 400)
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('increment_daily_watch_time', {
      p_user_id: user.id,
      p_seconds: Math.floor(seconds),
      p_video_id: video_id || null // 🎯 传入视频ID用于去重
    })

    if (error) {
      console.error('[watch-time] RPC increment_daily_watch_time failed:', error)
      return errorResponse('Failed to increment watch time', 1, 500)
    }

    return successResponse(data)
  } catch (error) {
    console.error('[watch-time] Unexpected error:', error)
    return successResponse({ success: true }) // 即使失败也返回成功，不影响用户体验
  }
}

/**
 * 获取观看时长奖励状态
 * GET /video/watch-time/status
 */
export async function handleGetWatchTimeStatus(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)

  try {
    const { data, error } = await supabaseAdmin.rpc('get_watch_time_reward_status', {
      p_user_id: user.id
    })

    if (error) {
      console.error('[watch-time] RPC get_watch_time_reward_status failed:', error)
      return errorResponse('Failed to get watch time status', 1, 500)
    }

    return successResponse(data)
  } catch (error) {
    console.error('[watch-time] Unexpected error:', error)
    return errorResponse('Internal server error', 1, 500)
  }
}

/**
 * 领取观看时长奖励
 * POST /video/watch-time/claim
 */
export async function handleClaimWatchTimeReward(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)

  try {
    const { data, error } = await supabaseAdmin.rpc('claim_watch_time_reward', {
      p_user_id: user.id
    })

    if (error) {
      console.error('[watch-time] RPC claim_watch_time_reward failed:', error)
      return errorResponse('Failed to claim reward', 1, 500)
    }

    if (data.success === false) {
      return errorResponse(data.message || '领取失败', 1, 400)
    }

    return successResponse(data)
  } catch (error) {
    console.error('[watch-time] Unexpected error:', error)
    return errorResponse('Internal server error', 1, 500)
  }
}
