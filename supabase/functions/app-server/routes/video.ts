import { successResponse, errorResponse } from '../../_shared/response.ts'
import { supabaseAdmin } from '../lib/env.ts'
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
    .order('is_top', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (videoError) {
    console.error('[app-server] Load feed failed:', videoError)
    return errorResponse('Failed to load feed', 1, 500)
  }

  await attachUserFlags(rows ?? [], user?.id ?? null)

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
  const { user } = await requireAuth(req)
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
    .select('like_count')
    .eq('id', body.video_id)
    .maybeSingle()

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
  const { user } = await requireAuth(req)
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
    .select('collect_count')
    .eq('id', body.video_id)
    .maybeSingle()

  return successResponse({
    collected: body.collected,
    collect_count: video?.collect_count ?? 0
  })
}
