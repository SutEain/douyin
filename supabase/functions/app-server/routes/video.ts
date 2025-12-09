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

  console.log('\n========== [深链接调试] handleVideoFeed START ==========')
  console.log('[Feed] 完整请求URL:', req.url)
  console.log('[Feed] 解析参数:', { pageNo, pageSize, from, to })
  console.log('[Feed] 用户ID:', user?.id || 'anonymous')

  // 🎯 方式1: 从 URL 参数获取（前端传递）
  let startVideoId = url.searchParams.get('start_video_id')
  console.log('[Feed] URL 参数 start_video_id:', startVideoId || '无')

  // 🎯 方式2: 从 Telegram initData 解析（100% 可靠）
  if (!startVideoId && pageNo === 0) {
    console.log('[Feed] 🎯 尝试从 Telegram initData 解析 start_param')
    const initData = req.headers.get('X-Telegram-Init-Data')

    if (initData) {
      console.log('[Feed] ✅ 检测到 Telegram initData')
      try {
        const params = new URLSearchParams(initData)
        const startParam = params.get('start_param')
        console.log('[Feed] start_param:', startParam || '无')

        if (startParam && startParam.startsWith('video_')) {
          startVideoId = startParam.replace('video_', '')
          console.log('[Feed] ✅ 从 initData 解析到 video_id:', startVideoId)
        }
      } catch (e) {
        console.error('[Feed] ❌ 解析 initData 失败:', e)
      }
    } else {
      console.log('[Feed] 未检测到 Telegram initData 请求头')
    }
  }

  console.log('[Feed] 最终 start_video_id:', startVideoId || '无')
  console.log('[Feed] 是否首次加载:', pageNo === 0)
  console.log('[Feed] 是否触发深链接逻辑:', pageNo === 0 && !!startVideoId)

  let startVideo: any = null
  const adjustedFrom = from
  let adjustedTo = to

  // 🎯 如果是首次加载（pageNo=0）且有 start_video_id
  if (pageNo === 0 && startVideoId) {
    console.log('\n[深链接] ========== 步骤1: 获取深链接视频 ==========')
    console.log('[深链接] 目标视频ID:', startVideoId)

    // 获取深链接视频
    const { data: startRow, error: startError } = await supabaseAdmin
      .from('videos')
      .select('*')
      .eq('id', startVideoId)
      .eq('status', 'published')
      .maybeSingle()

    if (startError) {
      console.error('[深链接] ❌ 查询失败:', {
        错误代码: startError.code,
        错误消息: startError.message,
        详情: startError.details
      })
    } else if (startRow) {
      console.log('[深链接] ✅ 查询成功:', {
        视频ID: startRow.id,
        标题: startRow.description?.substring(0, 30) + '...',
        状态: startRow.status,
        作者ID: startRow.user_id,
        创建时间: startRow.created_at
      })
      startVideo = startRow

      // 🎯 调整推荐视频的数量：总共返回 pageSize 个，深链接占1个，推荐占 pageSize-1 个
      adjustedTo = from + pageSize - 2 // -1 是因为 range 包含结束位置，再 -1 是因为深链接占1个
      console.log('[深链接] 调整推荐视频范围:', {
        原始范围: `${from}-${to}`,
        调整后范围: `${adjustedFrom}-${adjustedTo}`,
        原因: '深链接占1个位置'
      })
    } else {
      console.log('[深链接] ⚠️ 视频不存在或未发布:', {
        视频ID: startVideoId,
        可能原因: ['ID不存在', '状态不是published', '已被删除']
      })
    }
  }

  console.log('\n[推荐视频] ========== 步骤2: 查询推荐视频 ==========')

  // 🎯 构建查询，如果有深链接视频则排除它（避免重复）
  let query = supabaseAdmin.from('videos').select('*', { count: 'exact' }).eq('status', 'published')

  if (startVideo) {
    console.log('[推荐视频] 🎯 排除深链接视频，避免重复:', startVideoId)
    query = query.neq('id', startVideoId)
  } else {
    console.log('[推荐视频] 无需排除，正常查询')
  }

  console.log('[推荐视频] 查询条件:', {
    状态: 'published',
    排除ID: startVideo ? startVideoId : '无',
    排序: 'created_at desc', // 只按时间倒序
    范围: `${adjustedFrom}-${adjustedTo}`
  })

  const {
    data: rows,
    error: videoError,
    count
  } = await query
    .order('created_at', { ascending: false }) // 只按时间倒序，不考虑置顶
    .range(adjustedFrom, adjustedTo)

  if (videoError) {
    console.error('[推荐视频] ❌ 查询失败:', {
      错误代码: videoError.code,
      错误消息: videoError.message,
      详情: videoError.details
    })
    return errorResponse('Failed to load feed', 1, 500)
  }

  console.log('[推荐视频] ✅ 查询成功:', {
    返回数量: rows?.length || 0,
    总数: count,
    第一个ID: rows?.[0]?.id || '无',
    最后一个ID: rows?.[rows.length - 1]?.id || '无'
  })

  console.log('\n[数据合并] ========== 步骤3: 合并数据 ==========')

  // 🎯 合并深链接视频和推荐视频
  const allRows = startVideo ? [startVideo, ...(rows ?? [])] : (rows ?? [])

  console.log('[数据合并] 合并结果:', {
    有深链接: !!startVideo,
    深链接ID: startVideo?.id || '无',
    推荐视频数: rows?.length || 0,
    合并后总数: allRows.length
  })

  if (startVideo) {
    const allIds = allRows.map((r) => r.id)
    const hasDuplicate = new Set(allIds).size !== allIds.length
    console.log('[数据合并] 去重检查:', {
      总ID数: allIds.length,
      唯一ID数: new Set(allIds).size,
      是否有重复: hasDuplicate ? '❌ 有重复!' : '✅ 无重复'
    })
    if (hasDuplicate) {
      console.warn('[数据合并] ⚠️ 检测到重复ID，列表:', allIds)
    }
  }

  console.log('\n[用户标记] 开始附加用户标记...')
  await attachUserFlags(allRows, user?.id ?? null)

  console.log('[数据映射] 开始映射视频数据...')
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

  console.log('[数据映射] 映射完成:', {
    原始数据: allRows.length,
    映射成功: list.length,
    映射失败: allRows.length - list.length
  })

  console.log('\n[最终返回] ========== 返回数据给前端 ==========')
  console.log('[最终返回] 返回结构:', {
    list长度: list.length,
    total: count ?? 0,
    pageNo,
    pageSize,
    第一个视频ID: list[0]?.aweme_id || '无',
    第一个视频标题: list[0]?.desc?.substring(0, 30) || '无',
    前3个视频ID: list.slice(0, 3).map((v) => v.aweme_id)
  })
  console.log('========== [深链接调试] handleVideoFeed END ==========\n')

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
