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
  const { data: rows, error: videoError, count } = await supabaseAdmin
    .from('videos')
    .select('*', { count: 'exact' })
    .eq(userField, userValue)
    .in('status', ['draft', 'ready', 'published'])  // ✅ 排除 processing
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

  const { data: rows, error: videoError, count } = await supabaseAdmin
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

  const { data: rows, error: videoError, count } = await supabaseAdmin
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

export async function handleVideoLikes(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const url = new URL(req.url)
  const { pageNo, pageSize, from, to } = parsePagination(url)

  const { data: likeRows, error, count } = await supabaseAdmin
    .from('video_likes')
    .select('video_id, created_at', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(from, to)

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

  await attachUserFlags(videos, user.id)

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
    pageNo,
    pageSize
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
  const { user } = await requireAuth(req)
  const url = new URL(req.url)
  const { pageNo, pageSize, from, to } = parsePagination(url)

  const { data: collectionRows, error, count } = await supabaseAdmin
    .from('video_collections')
    .select('video_id, created_at', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(from, to)

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

  await attachUserFlags(videos, user.id)

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
    pageNo,
    pageSize
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

