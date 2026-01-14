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
  const { pageNo, pageSize, from } = parsePagination(url)
  const seed = parseFloat(url.searchParams.get('seed') || '0.5')

  // 🎯 解析排除列表 (从前端传入的已看 ID)
  const excludeIdsRaw = url.searchParams.get('exclude_ids')
  const excludeIds = excludeIdsRaw ? excludeIdsRaw.split(',').filter((id) => id.length === 36) : []

  const { user } = await tryGetAuth(req)

  // 🔍 诊断日志
  console.log('[Feed] ========== 请求开始 ==========')
  console.log('[Feed] 用户认证:', user ? `✅ ${user.id}` : '❌ 未登录')
  console.log('[Feed] 参数:', { pageNo, pageSize, seed, excludeCount: excludeIds.length })

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
        // 🎯 隐私保护：如果视频是私密的且当前用户不是作者，则不作为深链视频加载
        if (startRow.is_private && (!user || user.id !== startRow.author_id)) {
          console.log('[Feed] 深链接视频是私密的，且用户无权查看:', startVideoId)
        } else {
          startVideo = startRow
          console.log('[Feed] 深链接视频:', startVideoId)
        }
      }
    }
  }

  // 🎯 计算需要获取的数量（如果有深链视频，需要少获取一个）
  const targetCount = startVideo ? pageSize - 1 : pageSize

  let rows: any[] = []

  // 🎯 增加访客特征：如果用户未登录，优先使用 IP 作为指纹，确保不同用户看到的随机内容不一致
  const clientIp = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || 'anon'
  const visitorKey = user?.id || clientIp

  const rpcParams = {
    p_user_id: user?.id && user.id !== 'undefined' ? user.id : null,
    p_type: 'recommend',
    p_limit: targetCount,
    p_offset: from, // 🎯 恢复：始终使用 from 作为偏移
    p_seed: seed || 0.5,
    p_visitor_key: visitorKey && visitorKey !== 'undefined' ? visitorKey : 'anon',
    p_exclude_ids: excludeIds.length > 0 ? excludeIds : null
  }

  console.log('[Feed] 调用 RPC get_optimized_video_feed:', JSON.stringify(rpcParams))

  const { data, error } = await supabaseAdmin.rpc('get_optimized_video_feed', rpcParams)

  if (error) {
    console.error('[Feed] get_optimized_video_feed 失败:', error)
    // 降级：按时间倒序 + 随机偏移扰动（针对匿名用户）
    const randomOffset = user ? 0 : Math.floor(seed * 50)
    const { from: baseFrom, to: baseTo } = parsePagination(url)
    const from = baseFrom + randomOffset
    const to = baseTo + randomOffset

    const { data: fallbackData } = await supabaseAdmin
      .from('videos')
      .select('*')
      .eq('status', 'published')
      .eq('is_adult', false)
      .eq('is_private', false)
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
    .eq('is_private', false)

  // 🎯 优化 hasMore 判断：只要返回了数据，就认为可能还有更多（因为有排除列表逻辑）
  const hasMore = (rows?.length || 0) > 0

  return successResponse(
    {
      list,
      total: count ?? 0,
      pageNo,
      pageSize,
      hasMore
    },
    'ok',
    { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' }
  )
}

/**
 * 东南亚板块流：返回已发布、非成人且 is_sea=true 的作品（包括视频和图文），按发布时间倒序
 * GET /video/long-feed?pageNo=&pageSize=
 */
export async function handleVideoLongFeed(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pageNo, pageSize, from } = parsePagination(url)
  const seed = parseFloat(url.searchParams.get('seed') || '0.5')
  const { user } = await tryGetAuth(req)

  // 🎯 解析前端传入的排除列表
  const excludeIdsRaw = url.searchParams.get('exclude_ids')
  const clientExcludeIds = excludeIdsRaw
    ? excludeIdsRaw.split(',').filter((id) => id.length === 36)
    : []

  console.log('[LongFeed] 请求参数:', {
    pageNo,
    pageSize,
    seed,
    userId: user?.id,
    clientExcludeCount: clientExcludeIds.length
  })

  // 🎯 获取用户最近观看历史
  let backendExcludeIds: string[] = []
  if (user?.id) {
    const { data: historyData } = await supabaseAdmin
      .from('watch_history')
      .select('video_id')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(500)

    if (historyData) {
      backendExcludeIds = historyData.map((h: any) => h.video_id).filter(Boolean)
    }
  }

  const finalExcludeIds = Array.from(new Set([...clientExcludeIds, ...backendExcludeIds]))

  // 🎯 增加访客特征
  const clientIp = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || 'anon'
  const visitorKey = user?.id || clientIp

  const rpcParams = {
    p_user_id: user?.id && user.id !== 'undefined' ? user.id : null,
    p_exclude_ids: finalExcludeIds.length > 0 ? finalExcludeIds : null,
    p_limit: pageSize,
    p_offset: from, // 🎯 恢复：始终使用 from 作为偏移
    p_seed: seed || 0.5,
    p_visitor_key: visitorKey && visitorKey !== 'undefined' ? visitorKey : 'anon'
  }

  console.log('[LongFeed] 调用 RPC get_sea_feed:', JSON.stringify(rpcParams))

  const { data, error } = await supabaseAdmin.rpc('get_sea_feed', rpcParams)

  if (error) {
    console.error('[LongFeed] RPC调用失败:', error)
    return errorResponse('Failed to load long feed', 1, 500)
  }

  console.log('[LongFeed] RPC返回:', {
    count: data?.length || 0,
    firstScore: data?.[0]?.score,
    lastScore: data?.[data?.length - 1]?.score,
    returned_ids: data?.slice(0, 3).map((r: any) => r.id) // 打印返回的前3个ID用于调试
  })

  // 🎯 验证：检查返回的视频是否在排除列表中
  if (finalExcludeIds.length > 0 && data && data.length > 0) {
    const returnedIds = data.map((r: any) => r.id)
    const duplicates = returnedIds.filter((id: string) => finalExcludeIds.includes(id))
    if (duplicates.length > 0) {
      console.error('[LongFeed] ⚠️ 警告：返回的视频中包含已排除的视频:', duplicates)
    } else {
      console.log('[LongFeed] ✅ 验证通过：返回的视频都不在排除列表中')
    }
  }

  // 附加用户标记（点赞、收藏、关注状态）
  await attachUserFlags(data ?? [], user?.id ?? null)

  // 映射视频数据格式
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

  // 🎯 优化 hasMore 判断：只要本次 RPC 返回了数据，就认为可能还有更多（因为是排除式去重）
  const hasMore = (data?.length || 0) > 0

  return successResponse({
    list,
    total: null, // RPC模式下不返回总数，避免额外查询
    pageNo,
    pageSize,
    hasMore
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
  const { pageNo, pageSize, from } = parsePagination(url)
  const seed = parseFloat(url.searchParams.get('seed') || '0.5')
  const { user } = await tryGetAuth(req)

  // 🎯 解析前端传入的排除列表
  const excludeIdsRaw = url.searchParams.get('exclude_ids')
  const clientExcludeIds = excludeIdsRaw
    ? excludeIdsRaw.split(',').filter((id) => id.length === 36)
    : []

  console.log('[VideoTabFeed] 请求参数:', {
    pageNo,
    pageSize,
    seed,
    userId: user?.id,
    clientExcludeCount: clientExcludeIds.length
  })

  // 🎯 获取用户最近观看历史
  let backendExcludeIds: string[] = []
  if (user?.id) {
    const { data: historyData } = await supabaseAdmin
      .from('watch_history')
      .select('video_id')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(500)

    if (historyData) {
      backendExcludeIds = historyData.map((h: any) => h.video_id).filter(Boolean)
    }
  }

  const finalExcludeIds = Array.from(new Set([...clientExcludeIds, ...backendExcludeIds]))

  // 🎯 增加访客特征
  const clientIp = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || 'anon'
  const visitorKey = user?.id || clientIp

  const rpcParams = {
    p_user_id: user?.id && user.id !== 'undefined' ? user.id : null,
    p_exclude_ids: finalExcludeIds.length > 0 ? finalExcludeIds : null,
    p_limit: pageSize,
    p_offset: from, // 🎯 恢复：始终使用 from 作为偏移
    p_seed: seed || 0.5,
    p_visitor_key: visitorKey && visitorKey !== 'undefined' ? visitorKey : 'anon'
  }

  console.log('[VideoTabFeed] 调用 RPC get_video_tab_feed:', JSON.stringify(rpcParams))

  // 🎯 使用加权随机算法 (WRS) + Seed
  const { data, error } = await supabaseAdmin.rpc('get_video_tab_feed', rpcParams)

  if (error) {
    console.error('[VideoTabFeed] RPC调用失败:', error)
    return errorResponse('Failed to load video tab feed', 1, 500)
  }

  console.log('[VideoTabFeed] RPC返回:', {
    count: data?.length || 0,
    firstScore: data?.[0]?.score,
    lastScore: data?.[data?.length - 1]?.score
  })

  // 附加用户标记（点赞、收藏、关注状态）
  await attachUserFlags(data ?? [], user?.id ?? null)

  // 映射视频数据格式
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

  // 🎯 优化 hasMore 判断：只要本次 RPC 返回了数据，就认为可能还有更多（因为是排除式去重）
  const hasMore = (data?.length || 0) > 0

  return successResponse({
    list,
    total: null, // RPC模式下不返回总数，避免额外查询
    pageNo,
    pageSize,
    hasMore
  })
}

/**
 * 短剧 Tab：只返回 tags 包含"短剧"的已发布作品，按发布时间倒序
 * GET /video/short-drama-feed?pageNo=&pageSize=
 *
 * 说明：
 * - 🎯 单独接口，根据标签筛选
 * - 不过滤观看历史
 * - 允许未登录访问；如已登录则附加 like/collect/follow 等标记
 */
export async function handleShortDramaFeed(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pageNo, pageSize, from, to } = parsePagination(url)
  const { user } = await tryGetAuth(req)

  const { data, error, count } = await supabaseAdmin
    .from('videos')
    .select('*', { count: 'exact' })
    .eq('status', 'published')
    .eq('is_adult', false)
    .eq('is_private', false) // 🎯 增加私密过滤
    .contains('tags', ['短剧']) // 🎯 查询包含"短剧"标签的视频
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('[ShortDramaFeed] 查询短剧失败:', error)
    return errorResponse('Failed to load short drama feed', 1, 500)
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
    hasMore: (data?.length || 0) >= pageSize
  })
}

/**
 * 图文 Tab：只返回 content_type in ('image','album') 且 is_sea = false 且 is_adult = false 的已发布作品，按发布时间倒序
 * GET /video/graphic-feed?pageNo=&pageSize=
 */
export async function handleGraphicFeed(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pageNo, pageSize, from, to } = parsePagination(url)
  const { user } = await tryGetAuth(req)

  const { data, error, count } = await supabaseAdmin
    .from('videos')
    .select('*', { count: 'exact' })
    .eq('status', 'published')
    .eq('is_adult', false)
    .eq('is_private', false)
    .in('content_type', ['image', 'album'])
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('[GraphicFeed] 查询图文失败:', error)
    return errorResponse('Failed to load graphic feed', 1, 500)
  }

  await attachUserFlags(data ?? [], user?.id ?? null)

  const profileCache = new Map<string, any>()
  const list = []
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
    hasMore: (data?.length || 0) >= pageSize
  })
}

/**
 * 成人内容流：只返回 is_adult = true 的已发布视频，按时间倒序
 * GET /video/adult-feed?pageNo=&pageSize=
 */
export async function handleVideoAdultFeed(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pageNo, pageSize, from } = parsePagination(url)
  const seed = parseFloat(url.searchParams.get('seed') || '0.5')
  const { user } = await tryGetAuth(req)

  // 🎯 解析前端传入的排除列表
  const excludeIdsRaw = url.searchParams.get('exclude_ids')
  const clientExcludeIds = excludeIdsRaw
    ? excludeIdsRaw.split(',').filter((id) => id.length === 36)
    : []

  console.log('[AdultFeed] 请求参数:', {
    pageNo,
    pageSize,
    seed,
    userId: user?.id,
    clientExcludeCount: clientExcludeIds.length
  })

  // 🎯 获取用户最近观看历史
  let backendExcludeIds: string[] = []
  if (user?.id) {
    const { data: historyData } = await supabaseAdmin
      .from('watch_history')
      .select('video_id')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(500)

    if (historyData) {
      backendExcludeIds = historyData.map((h: any) => h.video_id).filter(Boolean)
    }
  }

  const finalExcludeIds = Array.from(new Set([...clientExcludeIds, ...backendExcludeIds]))

  // 🎯 增加访客特征
  const clientIp = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || 'anon'
  const visitorKey = user?.id || clientIp

  const rpcParams = {
    p_user_id: user?.id && user.id !== 'undefined' ? user.id : null,
    p_exclude_ids: finalExcludeIds.length > 0 ? finalExcludeIds : null,
    p_limit: pageSize,
    p_offset: from, // 🎯 恢复：始终使用 from 作为偏移
    p_seed: seed || 0.5,
    p_visitor_key: visitorKey && visitorKey !== 'undefined' ? visitorKey : 'anon'
  }

  console.log('[AdultFeed] 调用 RPC get_adult_feed:', JSON.stringify(rpcParams))

  const { data, error } = await supabaseAdmin.rpc('get_adult_feed', rpcParams)

  if (error) {
    console.error('[AdultFeed] RPC调用失败:', error)
    return errorResponse('Failed to load adult feed', 1, 500)
  }

  console.log('[AdultFeed] RPC返回:', {
    count: data?.length || 0,
    firstScore: data?.[0]?.score,
    lastScore: data?.[data?.length - 1]?.score,
    returned_ids: data?.slice(0, 3).map((r: any) => r.id) // 打印返回的前3个ID用于调试
  })

  // 🎯 验证：检查返回的视频是否在排除列表中
  if (finalExcludeIds.length > 0 && data && data.length > 0) {
    const returnedIds = data.map((r: any) => r.id)
    const duplicates = returnedIds.filter((id: string) => finalExcludeIds.includes(id))
    if (duplicates.length > 0) {
      console.error('[AdultFeed] ⚠️ 警告：返回的视频中包含已排除的视频:', duplicates)
    } else {
      console.log('[AdultFeed] ✅ 验证通过：返回的视频都不在排除列表中')
    }
  }

  // 附加用户标记（点赞、收藏、关注状态）
  await attachUserFlags(data ?? [], user?.id ?? null)

  // 映射视频数据格式
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

  // 🎯 优化 hasMore 判断：只要本次 RPC 返回了数据，就认为可能还有更多（因为是排除式去重）
  const hasMore = (data?.length || 0) > 0

  return successResponse({
    list,
    total: null, // RPC模式下不返回总数，避免额外查询
    pageNo,
    pageSize,
    hasMore
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

  const query = supabaseAdmin
    .from('videos')
    .select('*', { count: 'exact' })
    .eq('status', 'published')
    .eq('author_id', authorId)

  // 🎯 隐私保护：如果不是作者本人，只能看到公开视频
  if (user?.id !== authorId) {
    query.eq('is_private', false)
  }

  const {
    data: rows,
    error: videoError,
    count
  } = await query
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
  const url = new URL(req.url)
  const videoId = url.searchParams.get('video_id')

  if (!videoId) {
    throw new HttpError('Missing video_id', 400)
  }

  const { user } = await tryGetAuth(req)
  const query = supabaseAdmin.from('videos').select('*').eq('id', videoId).eq('status', 'published')

  // 🎯 隐私保护：如果不是作者本人，只能查看公开视频
  if (user?.id) {
    query.or(`is_private.eq.false,author_id.eq.${user.id}`)
  } else {
    query.eq('is_private', false)
  }

  const { data: row, error: videoError } = await query.maybeSingle()

  if (videoError || !row) {
    return errorResponse('Video not found', 1, 404)
  }

  await attachUserFlags([row], user?.id ?? null)
  const authorProfile = await getVideoAuthorProfile(row, new Map())
  const mapped = await mapVideoRow(row, authorProfile)

  if (!mapped) {
    return errorResponse('Failed to process video', 1, 500)
  }

  applyRowFlags(mapped, row)
  return successResponse(mapped)
}

export async function handleVideoLikes(req: Request): Promise<Response> {
  const { user } = await tryGetAuth(req)
  const url = new URL(req.url)
  const { pageNo, pageSize, from, to } = parsePagination(url)

  const targetUserId = url.searchParams.get('user_id')

  if (!targetUserId) {
    if (!user) {
      throw new HttpError('Missing user_id or authentication', 401)
    }
    return await queryUserLikes(user.id, user.id, { pageNo, pageSize, from, to })
  }

  const targetProfile = await getProfileById(targetUserId)
  if (!targetProfile || targetProfile.show_like !== true) {
    return successResponse({ list: [], total: 0, pageNo, pageSize })
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
    return errorResponse('Failed to load videos', 1, 500)
  }

  const videoIds = (likeRows ?? []).map((row) => row.video_id).filter(Boolean)
  let videos: any[] = []
  if (videoIds.length) {
    const query = supabaseAdmin
      .from('videos')
      .select('*')
      .in('id', videoIds)
      .eq('status', 'published')

    if (currentUserId) {
      query.or(`is_private.eq.false,author_id.eq.${currentUserId}`)
    } else {
      query.eq('is_private', false)
    }

    const { data: videoData } = await query
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
      return errorResponse('Failed to like video', 1, 500)
    }
  } else {
    const { error } = await supabaseAdmin
      .from('video_likes')
      .delete()
      .eq('user_id', user.id)
      .eq('video_id', body.video_id)
    if (error) {
      return errorResponse('Failed to unlike video', 1, 500)
    }
  }

  const { data: video } = await supabaseAdmin
    .from('videos')
    .select('like_count, author_id')
    .eq('id', body.video_id)
    .maybeSingle()

  if (body.liked && video && video.author_id && video.author_id !== user.id) {
    const nickname = profile.nickname || profile.username || '用户'
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

  const targetUserId = url.searchParams.get('user_id')

  if (!targetUserId) {
    if (!user) {
      throw new HttpError('Missing user_id or authentication', 401)
    }
    return await queryUserCollections(user.id, user.id, { pageNo, pageSize, from, to })
  }

  const targetProfile = await getProfileById(targetUserId)
  if (!targetProfile || targetProfile.show_collect !== true) {
    return successResponse({ list: [], total: 0, pageNo, pageSize })
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
    return errorResponse('Failed to load videos', 1, 500)
  }

  const videoIds = (collectionRows ?? []).map((row) => row.video_id).filter(Boolean)
  let videos: any[] = []
  if (videoIds.length) {
    const query = supabaseAdmin
      .from('videos')
      .select('*')
      .in('id', videoIds)
      .eq('status', 'published')

    if (currentUserId) {
      query.or(`is_private.eq.false,author_id.eq.${currentUserId}`)
    } else {
      query.eq('is_private', false)
    }

    const { data: videoData } = await query
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
      return errorResponse('Failed to collect video', 1, 500)
    }
  } else {
    const { error } = await supabaseAdmin
      .from('video_collections')
      .delete()
      .eq('user_id', user.id)
      .eq('video_id', body.video_id)
    if (error) {
      return errorResponse('Failed to remove collection', 1, 500)
    }
  }

  const { data: video } = await supabaseAdmin
    .from('videos')
    .select('collect_count, author_id')
    .eq('id', body.video_id)
    .maybeSingle()

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

export async function handleBatchReview(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  const { video_ids, action, reject_reason } = body

  if (!video_ids || !Array.isArray(video_ids) || video_ids.length === 0) {
    return errorResponse('video_ids is required', 1, 400)
  }

  if (action === 'approve') {
    const { data: videos } = await supabaseAdmin
      .from('videos')
      .select('id, status')
      .in('id', video_ids)
    const updatePromises = (videos ?? []).map((v) => {
      const shouldPublish = v.status === 'ready'
      return supabaseAdmin
        .from('videos')
        .update({
          review_status: 'approved',
          status: shouldPublish ? 'published' : v.status,
          published_at: shouldPublish ? new Date().toISOString() : null
        })
        .eq('id', v.id)
    })
    await Promise.all(updatePromises)
    return successResponse({ success: true, updated: video_ids.length })
  } else if (action === 'reject') {
    await supabaseAdmin
      .from('videos')
      .update({ review_status: 'rejected', reject_reason })
      .in('id', video_ids)
    return successResponse({ success: true })
  } else if (action === 'delete') {
    await supabaseAdmin.from('videos').delete().in('id', video_ids)
    return successResponse({ success: true })
  } else {
    const updatePayload: Record<string, any> = {}
    if (action === 'set_adult') updatePayload.is_adult = true
    if (action === 'unset_adult') updatePayload.is_adult = false
    if (action === 'set_sea') updatePayload.is_sea = true
    if (action === 'unset_sea') updatePayload.is_sea = false
    await supabaseAdmin.from('videos').update(updatePayload).in('id', video_ids)
    return successResponse({ success: true })
  }
}

export async function handleApproveVideo(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  const { video_id } = body
  if (!video_id) return errorResponse('video_id required', 1, 400)

  const { data: video } = await supabaseAdmin
    .from('videos')
    .select('id, status, author_id, description')
    .eq('id', video_id)
    .single()

  if (!video) return errorResponse('Not found', 1, 404)

  const shouldPublish = video.status === 'ready'
  await supabaseAdmin
    .from('videos')
    .update({
      review_status: 'approved',
      status: shouldPublish ? 'published' : video.status,
      published_at: shouldPublish ? new Date().toISOString() : null
    })
    .eq('id', video_id)

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, auto_approve, nickname')
    .eq('id', video.author_id)
    .single()

  if (profile && !profile.auto_approve) {
    await supabaseAdmin.from('profiles').update({ auto_approve: true }).eq('id', profile.id)
  }

  return successResponse({ success: true })
}

export async function handleRecordView(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const body = await parseJsonBody(req)
  const { video_id, progress, completed } = body
  if (!video_id) return errorResponse('video_id required', 1, 400)

  const { data, error } = await supabaseAdmin.rpc('record_video_view_v2', {
    p_user_id: user.id,
    p_video_id: video_id,
    p_progress: progress ?? 0,
    p_completed: completed === true
  })

  if (error) return errorResponse('Failed', 1, 500)
  return successResponse(data)
}

export async function handleVideoHistory(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const url = new URL(req.url)
  const { pageNo, pageSize, from, to } = parsePagination(url)

  const { data: rows, count } = await supabaseAdmin
    .from('watch_history')
    .select('video_id, updated_at, videos!inner(*)', { count: 'exact' })
    .eq('user_id', user.id)
    .eq('videos.status', 'published')
    .order('updated_at', { ascending: false })
    .range(from, to)

  const videos = (rows ?? []).map((r: any) => r.videos)
  await attachUserFlags(videos, user.id)

  const profileCache = new Map()
  const list = []
  for (const v of videos) {
    const author = await getVideoAuthorProfile(v, profileCache)
    const mapped = await mapVideoRow(v, author)
    if (mapped) {
      applyRowFlags(mapped, v)
      list.push(mapped)
    }
  }

  return successResponse({ list, total: count ?? 0, pageNo, pageSize })
}

export async function handleClearVideoHistory(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  await supabaseAdmin.from('watch_history').delete().eq('user_id', user.id)
  return successResponse({ success: true })
}

export async function handleIncrementWatchTime(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const body = await parseJsonBody(req)
  const { seconds, video_id } = body
  if (!seconds || seconds <= 0) return errorResponse('Invalid seconds', 1, 400)

  const { data, error } = await supabaseAdmin.rpc('increment_daily_watch_time', {
    p_user_id: user.id,
    p_seconds: Math.floor(seconds),
    p_video_id: video_id || null
  })

  if (error) return errorResponse('Failed', 1, 500)
  return successResponse(data)
}

export async function handleGetWatchTimeStatus(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const { data, error } = await supabaseAdmin.rpc('get_watch_time_reward_status', {
    p_user_id: user.id
  })
  if (error) return errorResponse('Failed', 1, 500)
  return successResponse(data)
}

export async function handleClaimWatchTimeReward(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const { data, error } = await supabaseAdmin.rpc('claim_watch_time_reward', {
    p_user_id: user.id
  })
  if (error) return errorResponse('Failed', 1, 500)
  return successResponse(data)
}
