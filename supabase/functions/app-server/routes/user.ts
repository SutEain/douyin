import { successResponse, errorResponse } from '../../_shared/response.ts'
import { supabaseAdmin, DEFAULT_AVATAR } from '../lib/env.ts'
import { checkAndSendNotification } from '../lib/notification.ts'
import { HttpError, parseJsonBody, requireAuth, tryGetAuth } from '../lib/auth.ts'

export async function handleVisitUserProfile(req: Request): Promise<Response> {
  const { user, profile } = await requireAuth(req, { withProfile: true })
  const body = await parseJsonBody<{ target_id?: string }>(req)
  if (!body.target_id) {
    throw new HttpError('Missing target_id', 400)
  }
  if (body.target_id === user.id) {
    // 访问自己主页不记录
    return successResponse({ recorded: false, reason: 'self' })
  }

  const visitorId = user.id
  const visitedId = body.target_id
  const nickname = profile.nickname || profile.username || '用户'

  const now = new Date()
  const nowIso = now.toISOString()
  const cooldownMs = 24 * 3600 * 1000
  const cutoffIso = new Date(now.getTime() - cooldownMs).toISOString()

  console.log('[Visit] start', { visitorId, visitedId, nickname })

  // ✅ 24h 去重：同一访客在 24h 内访问同一主页，只保留最新一条
  const { error: delErr } = await supabaseAdmin
    .from('profile_visits')
    .delete()
    .eq('visitor_id', visitorId)
    .eq('visited_id', visitedId)
    .gte('created_at', cutoffIso)

  if (delErr) {
    console.error('[Visit] delete recent visits failed:', delErr)
  }

  const { error: insErr } = await supabaseAdmin
    .from('profile_visits')
    .insert({ visitor_id: visitorId, visited_id: visitedId, created_at: nowIso })

  if (insErr) {
    console.error('[Visit] insert visit failed:', insErr)
    return errorResponse('Failed to record visit', 1, 500)
  }

  // 🎯 通知限频：同一访客对同一主页 24h 仅一次
  const { data: lastRow, error: lastErr } = await supabaseAdmin
    .from('visit_notify_limits')
    .select('last_sent_at')
    .eq('visitor_id', visitorId)
    .eq('visited_id', visitedId)
    .maybeSingle()

  if (lastErr) {
    console.error('[Visit] query notify limit failed:', lastErr)
  } else if (lastRow?.last_sent_at) {
    const lastAt = new Date(lastRow.last_sent_at).getTime()
    if (!Number.isNaN(lastAt) && now.getTime() - lastAt < cooldownMs) {
      console.log('[Visit] notify cooldown hit', {
        visitorId,
        visitedId,
        last_sent_at: lastRow.last_sent_at
      })
      return successResponse({ recorded: true, notified: false, reason: 'cooldown_24h' })
    }
  }

  const { error: upsertErr } = await supabaseAdmin
    .from('visit_notify_limits')
    .upsert(
      { visitor_id: visitorId, visited_id: visitedId, last_sent_at: nowIso, updated_at: nowIso },
      { onConflict: 'visitor_id,visited_id' }
    )

  if (upsertErr) {
    console.error('[Visit] upsert notify limit failed:', upsertErr)
  }

  // 尊重 notification_settings.visit
  checkAndSendNotification(
    visitedId,
    'visit',
    `👀 <b>${nickname}</b>查看了你的主页`,
    undefined,
    visitorId
  )

  return successResponse({ recorded: true, notified: true })
}

export async function handleGetMyVisitors(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const userId = user.id

  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') || 100) || 100, 200)

  // 先拉一批，再在代码里按 visitor_id 去重取最新（因为我们只保证 24h 内去重）
  const { data: rows, error } = await supabaseAdmin
    .from('profile_visits')
    .select('visitor_id, created_at')
    .eq('visited_id', userId)
    .order('created_at', { ascending: false })
    .limit(300)

  if (error) {
    console.error('[Visitors] query profile_visits failed:', error)
    return errorResponse('Failed to load visitors', 1, 500)
  }

  const deduped: Array<{ visitor_id: string; created_at: string }> = []
  const seen = new Set<string>()
  for (const r of rows || []) {
    if (!r?.visitor_id || seen.has(r.visitor_id)) continue
    seen.add(r.visitor_id)
    deduped.push({ visitor_id: r.visitor_id, created_at: r.created_at })
    if (deduped.length >= limit) break
  }

  const visitorIds = deduped.map((r) => r.visitor_id)
  if (visitorIds.length === 0) {
    return successResponse({ list: [] })
  }

  const { data: profiles, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('id, nickname, username, bio, avatar_url')
    .in('id', visitorIds)

  if (pErr) {
    console.error('[Visitors] query visitor profiles failed:', pErr)
    return errorResponse('Failed to load visitors', 1, 500)
  }

  const profileMap = new Map<string, any>()
  for (const p of profiles || []) profileMap.set(p.id, p)

  // 关系：我是否关注 TA / TA 是否关注我（分两次查，避免复杂 or 语法差异）
  const iFollow = new Set<string>() // userId -> visitorId
  const theyFollow = new Set<string>() // visitorId -> userId

  const { data: rel1, error: relErr1 } = await supabaseAdmin
    .from('follows')
    .select('followee_id')
    .eq('follower_id', userId)
    .in('followee_id', visitorIds)

  if (relErr1) {
    console.error('[Visitors] query follows (iFollow) failed:', relErr1)
  } else {
    for (const r of rel1 || []) iFollow.add(r.followee_id)
  }

  const { data: rel2, error: relErr2 } = await supabaseAdmin
    .from('follows')
    .select('follower_id')
    .eq('followee_id', userId)
    .in('follower_id', visitorIds)

  if (relErr2) {
    console.error('[Visitors] query follows (theyFollow) failed:', relErr2)
  } else {
    for (const r of rel2 || []) theyFollow.add(r.follower_id)
  }

  const RELATE_ENUM = { FOLLOW_ME: 1, FOLLOW_EACH_OTHER: 2, FOLLOW_HE: 3 }

  const list = deduped
    .map((r) => {
      const p = profileMap.get(r.visitor_id)
      if (!p) return null
      const i = iFollow.has(r.visitor_id)
      const t = theyFollow.has(r.visitor_id)
      // visitor 模式下：我已关注=已关注；互相关注=互相关注；否则统一显示“关注”按钮
      const type =
        i && t ? RELATE_ENUM.FOLLOW_EACH_OTHER : i ? RELATE_ENUM.FOLLOW_HE : RELATE_ENUM.FOLLOW_ME
      return {
        id: p.id,
        name: p.nickname || p.username || '用户',
        nickname: p.nickname || '',
        signature: p.bio || '',
        avatar_url: p.avatar_url || '',
        visited_at: r.created_at,
        type
      }
    })
    .filter(Boolean)

  return successResponse({ list })
}

export async function handleRequestUpdate(req: Request): Promise<Response> {
  const { user, profile } = await requireAuth(req, { withProfile: true })
  const body = await parseJsonBody<{ target_id?: string }>(req)
  if (!body.target_id) {
    throw new HttpError('Missing target_id', 400)
  }
  if (body.target_id === user.id) {
    throw new HttpError('不能对自己求更新', 400)
  }

  const requesterId = user.id
  const targetId = body.target_id
  const nickname = profile.nickname || profile.username || '用户'

  console.log('[RequestUpdate] start', { requesterId, targetId, nickname })

  // 🎯 24h 限频：同一用户对同一作者，24小时内只能提醒一次
  const now = new Date()
  const nowIso = now.toISOString()
  const cooldownMs = 24 * 3600 * 1000
  const cutoff = new Date(now.getTime() - cooldownMs).toISOString()

  const { data: lastRow, error: lastErr } = await supabaseAdmin
    .from('request_update_limits')
    .select('last_sent_at')
    .eq('requester_id', requesterId)
    .eq('target_id', targetId)
    .maybeSingle()

  if (lastErr) {
    console.error('[RequestUpdate] query limit failed:', lastErr)
    // 不因为限频查询失败而阻断（但会继续发通知，可能导致重复）
  } else if (lastRow?.last_sent_at) {
    const lastAt = new Date(lastRow.last_sent_at).getTime()
    if (!Number.isNaN(lastAt) && now.getTime() - lastAt < cooldownMs) {
      console.log('[RequestUpdate] cooldown hit', {
        requesterId,
        targetId,
        last_sent_at: lastRow.last_sent_at
      })
      return successResponse({
        sent: false,
        reason: 'cooldown_24h'
      })
    }
  }

  // 先写入限频表（避免并发双击导致多发）
  const { error: upsertErr } = await supabaseAdmin.from('request_update_limits').upsert(
    {
      requester_id: requesterId,
      target_id: targetId,
      last_sent_at: nowIso,
      updated_at: nowIso
    },
    { onConflict: 'requester_id,target_id' }
  )

  if (upsertErr) {
    console.error('[RequestUpdate] upsert limit failed:', upsertErr)
    // 不阻断发送，但会失去限频效果
  }

  // 发送通知（尊重 notification_settings.request_update）
  checkAndSendNotification(
    targetId,
    'request_update',
    `🫵 <b>${nickname}</b>希望你快点更新作品`,
    undefined,
    requesterId
  )

  return successResponse({ sent: true })
}

export async function handleFollowUser(req: Request): Promise<Response> {
  try {
    const { user, profile } = await requireAuth(req, { withProfile: true })
    const body = await parseJsonBody<{ target_id?: string; follow?: boolean }>(req)

    console.log('[handleFollowUser] start:', {
      userId: user.id,
      targetId: body.target_id,
      follow: body.follow
    })

    if (!body.target_id || typeof body.follow !== 'boolean') {
      throw new HttpError('Missing target_id or follow flag', 400)
    }
    if (body.target_id === user.id) {
      throw new HttpError('不能关注自己', 400)
    }

    if (body.follow) {
      // 🎯 频率限制：1分钟关注不能超过 10 次
      const { count: recentFollows } = await supabaseAdmin
        .from('follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_id', user.id)
        .gte('created_at', new Date(Date.now() - 60000).toISOString())

      if (recentFollows !== null && recentFollows >= 10) {
        throw new HttpError('关注太频繁了，先休息下吧', 429)
      }

      // 关注用户
      const { error } = await supabaseAdmin.from('follows').upsert(
        { follower_id: user.id, followee_id: body.target_id },
        {
          onConflict: 'follower_id,followee_id',
          ignoreDuplicates: false // 确保如果已经存在，也会被触发（虽然数据没变）
        }
      )
      if (error) {
        console.error('[app-server] Follow user failed:', error)
        return errorResponse('Failed to follow user: ' + error.message, 1, 500)
      }

      // 发送通知
      const nickname = profile.nickname || profile.username || '用户'
      checkAndSendNotification(
        body.target_id,
        'follow',
        `➕ 用户 <b>${nickname}</b> 关注了你`,
        undefined, // 不带 startParam 或者 user_${user.id} 如果前端支持
        user.id
      )
    } else {
      // 取消关注
      const { error } = await supabaseAdmin
        .from('follows')
        .delete()
        .eq('follower_id', user.id)
        .eq('followee_id', body.target_id)
      if (error) {
        console.error('[app-server] Unfollow user failed:', error)
        return errorResponse('Failed to unfollow user: ' + error.message, 1, 500)
      }
    }

    // ✅ 查询关注状态（检查对方是否也关注了我）
    let followStatus = 0 // 0=未关注

    if (body.follow) {
      // 如果我刚关注了对方，检查对方是否也关注了我
      const { data: isFollowedBy } = await supabaseAdmin
        .from('follows')
        .select('id')
        .eq('follower_id', body.target_id)
        .eq('followee_id', user.id)
        .maybeSingle()

      followStatus = isFollowedBy ? 2 : 1 // 2=互相关注, 1=已关注
    }

    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('follower_count')
      .eq('id', body.target_id)
      .maybeSingle()

    return successResponse({
      follow: body.follow,
      follower_count: targetProfile?.follower_count ?? null,
      follow_status: followStatus // ✅ 返回关注状态
    })
  } catch (error: any) {
    console.error('[handleFollowUser] Unexpected error:', error)
    if (error instanceof HttpError) {
      return errorResponse(error.message, 1, error.status)
    }
    return errorResponse(error.message || 'Internal server error', 1, 500)
  }
}

// ✅ 获取用户详细信息（包括统计数据和关注状态）
export async function handleGetUserProfile(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const targetUserId = url.searchParams.get('user_id')

  if (!targetUserId) {
    throw new HttpError('Missing user_id parameter', 400)
  }

  // ✅ 可选认证：如果用户已登录，则返回关注状态；未登录也可以查看基本信息
  const authResult = await tryGetAuth(req)
  const currentUserId = authResult?.user?.id || null

  // 1️⃣ 查询目标用户的基本信息
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', targetUserId)
    .maybeSingle()

  if (profileError || !profile) {
    console.error('[app-server] Get profile failed:', profileError)
    return errorResponse('用户不存在', 1, 404)
  }

  // 2️⃣ 查询作品数量
  const { count: awemeCount } = await supabaseAdmin
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', targetUserId)
    .eq('status', 'published')

  // 3️⃣ 查询关注状态（如果当前用户已登录）
  let followStatus = 0 // 0=未关注, 1=已关注, 2=互相关注, -1=自己

  if (currentUserId) {
    if (currentUserId === targetUserId) {
      // 自己
      followStatus = -1
    } else {
      // 检查我是否关注了对方
      const { data: iFollowThem } = await supabaseAdmin
        .from('follows')
        .select('id')
        .eq('follower_id', currentUserId)
        .eq('followee_id', targetUserId)
        .maybeSingle()

      // 检查对方是否关注了我
      const { data: theyFollowMe } = await supabaseAdmin
        .from('follows')
        .select('id')
        .eq('follower_id', targetUserId)
        .eq('followee_id', currentUserId)
        .maybeSingle()

      if (iFollowThem && theyFollowMe) {
        followStatus = 2 // 互相关注
      } else if (iFollowThem) {
        followStatus = 1 // 已关注
      }
    }
  }

  // 4️⃣ 返回完整的用户信息
  return successResponse({
    user_id: profile.id,
    nickname: profile.nickname || profile.username || 'Telegram 用户',
    username: profile.username || '',
    bio: profile.bio || '',
    signature: profile.bio || '',
    gender: profile.gender || 0, // 0=未知, 1=男, 2=女
    birthday: profile.birthday || '',
    avatar_url: profile.avatar_url || DEFAULT_AVATAR,
    cover_url: profile.cover_url || '',
    country: profile.country || '',
    province: profile.province || '',
    city: profile.city || '',

    // 🎯 数字ID
    numeric_id: profile.numeric_id || null,

    // 🎯 隐私设置
    show_collect: profile.show_collect !== false, // 默认公开
    show_like: profile.show_like !== false, // 默认公开
    show_tg_username: profile.show_tg_username === true, // 默认隐藏

    // 统计数据
    total_favorited: profile.total_likes || 0,
    balance_coins: profile.balance_coins || 0,
    following_count: profile.following_count || 0,
    followers_count: profile.follower_count || 0,
    follower_count: profile.follower_count || 0,
    aweme_count: awemeCount || 0,

    // 关系状态
    follow_status: followStatus
  })
}

// 🎯 自动初始化用户（用于深链接等场景）
export async function handleAutoInit(req: Request): Promise<Response> {
  console.log('[AutoInit] 开始自动初始化用户')

  try {
    // 解析 Telegram initData
    const initData = req.headers.get('X-Telegram-Init-Data')
    if (!initData) {
      return errorResponse('缺少 Telegram 用户信息', 400)
    }

    const params = new URLSearchParams(initData)
    const userStr = params.get('user')
    if (!userStr) {
      return errorResponse('无法解析用户信息', 400)
    }

    const tgUser = JSON.parse(userStr)
    console.log('[AutoInit] Telegram 用户ID:', tgUser.id)

    // 查询用户是否已存在
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('tg_user_id', tgUser.id)
      .maybeSingle()

    if (existingProfile) {
      console.log('[AutoInit] ✅ 用户已存在:', existingProfile.id)
      return successResponse({
        id: existingProfile.id,
        tg_user_id: existingProfile.tg_user_id,
        username: existingProfile.username,
        nickname: existingProfile.nickname,
        avatar: existingProfile.avatar_url,
        numeric_id: existingProfile.numeric_id
      })
    }

    // 用户不存在，创建新用户
    console.log('[AutoInit] 用户不存在，开始创建')

    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: `tg_${tgUser.id}@telegram.placeholder`,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: {
        tg_user_id: tgUser.id,
        username: tgUser.username || '',
        first_name: tgUser.first_name || '',
        last_name: tgUser.last_name || ''
      }
    })

    if (authError || !authUser.user) {
      console.error('[AutoInit] ❌ 创建 auth 用户失败:', authError)
      return errorResponse('创建用户失败', 500)
    }

    // 创建 profile
    const nickname = tgUser.first_name || tgUser.username || 'Telegram 用户'
    const { data: newProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: authUser.user.id,
        tg_user_id: tgUser.id,
        username: tgUser.username || '',
        nickname: nickname,
        avatar_url: DEFAULT_AVATAR
      })
      .select()
      .single()

    if (profileError) {
      console.error('[AutoInit] ❌ 创建 profile 失败:', profileError)
      return errorResponse('创建用户资料失败', 500)
    }

    console.log('[AutoInit] ✅ 用户创建成功:', newProfile.id)

    // 🎯 步骤3: 新用户默认关注官方账号 88888 (抖音精选)
    try {
      const { data: officialUser } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('numeric_id', 88888)
        .maybeSingle()

      if (officialUser && officialUser.id !== newProfile.id) {
        console.log('[AutoInit] 新用户自动关注官方账号:', officialUser.id)
        await supabaseAdmin.from('follows').upsert(
          {
            follower_id: newProfile.id,
            followee_id: officialUser.id
          },
          { onConflict: 'follower_id,followee_id' }
        )
      }
    } catch (followErr) {
      console.error('[AutoInit] 自动关注官方账号失败:', followErr)
    }

    return successResponse({
      id: newProfile.id,
      tg_user_id: newProfile.tg_user_id,
      username: newProfile.username,
      nickname: newProfile.nickname,
      avatar: newProfile.avatar_url,
      numeric_id: newProfile.numeric_id
    })
  } catch (error) {
    console.error('[AutoInit] ❌ 初始化失败:', error)
    return errorResponse('初始化失败', 500)
  }
}
