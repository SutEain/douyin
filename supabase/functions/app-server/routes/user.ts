import { successResponse, errorResponse } from '../../_shared/response.ts'
import { supabaseAdmin, DEFAULT_AVATAR } from '../lib/env.ts'
import { HttpError, parseJsonBody, requireAuth, tryGetAuth } from '../lib/auth.ts'

export async function handleFollowUser(req: Request): Promise<Response> {
  const { user } = await requireAuth(req)
  const body = await parseJsonBody<{ target_id?: string; follow?: boolean }>(req)
  if (!body.target_id || typeof body.follow !== 'boolean') {
    throw new HttpError('Missing target_id or follow flag', 400)
  }
  if (body.target_id === user.id) {
    throw new HttpError('不能关注自己', 400)
  }

  if (body.follow) {
    // 关注用户
    const { error } = await supabaseAdmin
      .from('follows')
      .upsert(
        { follower_id: user.id, followee_id: body.target_id },
        { onConflict: 'follower_id,followee_id' }
      )
    if (error) {
      console.error('[app-server] Follow user failed:', error)
      return errorResponse('Failed to follow user', 1, 500)
    }
  } else {
    // 取消关注
    const { error } = await supabaseAdmin
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('followee_id', body.target_id)
    if (error) {
      console.error('[app-server] Unfollow user failed:', error)
      return errorResponse('Failed to unfollow user', 1, 500)
    }
  }

  // ✅ 查询关注状态（检查对方是否也关注了我）
  let followStatus = 0  // 0=未关注
  
  if (body.follow) {
    // 如果我刚关注了对方，检查对方是否也关注了我
    const { data: isFollowedBy } = await supabaseAdmin
      .from('follows')
      .select('id')
      .eq('follower_id', body.target_id)
      .eq('followee_id', user.id)
      .maybeSingle()
    
    followStatus = isFollowedBy ? 2 : 1  // 2=互相关注, 1=已关注
  }

  const { data: targetProfile } = await supabaseAdmin
    .from('profiles')
    .select('follower_count')
    .eq('id', body.target_id)
    .maybeSingle()

  return successResponse({
    follow: body.follow,
    follower_count: targetProfile?.follower_count ?? null,
    follow_status: followStatus  // ✅ 返回关注状态
  })
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
    
    // 统计数据
    total_favorited: profile.total_likes || 0,
    following_count: profile.following_count || 0,
    followers_count: profile.follower_count || 0,
    follower_count: profile.follower_count || 0,
    aweme_count: awemeCount || 0,
    
    // 关系状态
    follow_status: followStatus
  })
}

