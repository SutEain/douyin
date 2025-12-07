import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { successResponse, errorResponse } from '../_shared/response.ts'
import { validateTelegramInitData } from '../_shared/telegram.ts'
import { supabaseAdmin, TG_BOT_TOKEN } from './lib/env.ts'
import { HttpError } from './lib/auth.ts'
import {
  handleVideoAuthor,
  handleVideoCollect,
  handleVideoCollections,
  handleVideoFeed,
  handleVideoLike,
  handleVideoLikes,
  handleVideoMy,
  handleVideoDetail
} from './routes/video.ts'
import { handleVideoComments, handleVideoCreateComment } from './routes/comments.ts'
import { handleFollowUser, handleGetUserProfile, handleAutoInit } from './routes/user.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const route = extractRoute(req.url)
    const method = req.method.toUpperCase()

    if (route === '/auth/tg-login' && method === 'POST') {
      return handleTelegramLogin(req)
    }

    // 🛠️ 开发登录（仅用于本地开发）
    if (route === '/dev-login' && method === 'GET') {
      return handleDevLogin(req)
    }

    if (route === '/video/my' && method === 'GET') {
      return handleVideoMy(req)
    }
    if (route === '/video/feed' && method === 'GET') {
      return handleVideoFeed(req)
    }
    if (route === '/video/author' && method === 'GET') {
      return handleVideoAuthor(req)
    }
    // 🎯 获取单个视频详情
    if (route === '/video/detail' && method === 'GET') {
      return handleVideoDetail(req)
    }
    if (route === '/video/likes' && method === 'GET') {
      return handleVideoLikes(req)
    }
    if (route === '/video/collections' && method === 'GET') {
      return handleVideoCollections(req)
    }
    if (route === '/video/like' && method === 'POST') {
      return handleVideoLike(req)
    }
    if (route === '/video/collect' && method === 'POST') {
      return handleVideoCollect(req)
    }
    if (route === '/video/comments' && method === 'GET') {
      return handleVideoComments(req)
    }
    if (route === '/video/comments' && method === 'POST') {
      return handleVideoCreateComment(req)
    }
    if (route === '/user/follow' && method === 'POST') {
      return handleFollowUser(req)
    }
    if (route === '/user/profile' && method === 'GET') {
      return handleGetUserProfile(req)
    }
    // 🎯 自动初始化用户
    if (route === '/user/auto-init' && method === 'POST') {
      return handleAutoInit(req)
    }

    return errorResponse('Not found', 1, 404)
  } catch (error) {
    if (error instanceof HttpError) {
      return errorResponse(error.message, 1, error.status)
    }
    console.error('[app-server] Unexpected error:', error)
    return errorResponse('Internal server error', 1, 500)
  }
})

function extractRoute(urlString: string) {
  const url = new URL(urlString)
  const segments = url.pathname.split('/').filter(Boolean)
  const funcIndex = segments.indexOf('app-server')
  const subSegments = funcIndex >= 0 ? segments.slice(funcIndex + 1) : []
  return '/' + subSegments.join('/')
}

async function handleTelegramLogin(req: Request): Promise<Response> {
  if (!TG_BOT_TOKEN) {
    return errorResponse('Server misconfigured', 1, 500)
  }

  let body: { initData?: string }
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid request body', 1, 400)
  }

  if (!body?.initData) {
    return errorResponse('Missing initData', 1, 400)
  }

  const validated = await validateTelegramInitData(body.initData, TG_BOT_TOKEN)
  if (!validated) {
    return errorResponse('Invalid Telegram data', 1, 401)
  }

  const { user } = validated

  // 🎯 步骤1: 查询 profile 是否存在
  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, username, nickname, tg_user_id, avatar_url, lang')
    .eq('tg_user_id', user.id)
    .maybeSingle()

  let userId: string
  let isNewUser = false

  if (!existingProfile) {
    console.log('[app-server] Profile 不存在，开始创建用户，tg_user_id:', user.id)

    // 🎯 步骤2: 创建 auth 用户（与 Bot 逻辑完全一致）
    const uniqueEmail = `tg_${user.id}@telegram.user` // ✅ 使用与 Bot 相同的邮箱格式
    let authUserId: string

    try {
      console.log('[app-server] 尝试创建 auth 用户, email:', uniqueEmail)
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: uniqueEmail,
        email_confirm: true,
        user_metadata: {
          tg_user_id: user.id,
          tg_username: user.username,
          tg_first_name: user.first_name,
          tg_last_name: user.last_name
        }
      })

      if (authError) {
        console.log('[app-server] createUser 失败:', authError.message)
        console.log('[app-server] error.status:', authError.status)

        // ✅ 如果邮箱已存在，获取已有用户（与 Bot 逻辑一致）
        if (authError.status === 422 || authError.message?.includes('email')) {
          console.log('[app-server] 邮箱冲突，查找已存在的 auth 用户')
          const { data: users } = await supabaseAdmin.auth.admin.listUsers()
          const existingUser = users?.users?.find((u) => u.email === uniqueEmail)

          if (existingUser) {
            authUserId = existingUser.id
            console.log('[app-server] ✅ 找到已存在的 auth 用户:', authUserId)
          } else {
            console.error('[app-server] ❌ 邮箱冲突但查询不到用户')
            return errorResponse('创建用户失败', 1, 500)
          }
        } else {
          console.error('[app-server] ❌ 创建 auth 用户失败:', authError)
          return errorResponse('创建用户失败', 1, 500)
        }
      } else {
        authUserId = authData.user.id
        console.log('[app-server] ✅ 成功创建 auth 用户:', authUserId)
      }
    } catch (err) {
      console.error('[app-server] ❌ 创建 auth 用户异常:', err)
      return errorResponse('创建用户失败', 1, 500)
    }

    // 🎯 步骤3: 补充 profile 完整信息（与 Bot 逻辑一致）
    const nickname = user.first_name + (user.last_name ? ` ${user.last_name}` : '')
    // 优先使用 Telegram 提供的头像 URL，否则使用公开 API
    const avatarUrl = user.photo_url || `https://t.me/i/userpic/320/${user.id}.jpg`
    console.log('[app-server] 头像 URL:', avatarUrl)

    console.log('[app-server] 触发器已创建基础 profile，使用 upsert 补充完整信息')
    const { data: profile, error: upsertError } = await supabaseAdmin
      .from('profiles')
      .upsert(
        {
          id: authUserId!,
          tg_user_id: user.id,
          tg_username: user.username || null,
          nickname: nickname,
          username: user.username || `user_${user.id}`,
          avatar_url: avatarUrl,
          auth_provider: 'tg',
          lang: user.language_code || 'zh-CN'
        },
        { onConflict: 'id' }
      )
      .select('id')
      .single()

    if (upsertError) {
      console.error('[app-server] ❌ upsert profile 失败:', upsertError)
      return errorResponse('创建用户资料失败', 1, 500)
    }

    console.log('[app-server] ✅ 成功创建 profile:', profile.id)
    userId = profile.id
    isNewUser = true
  } else {
    // ✅ 用户已存在
    console.log('[app-server] 用户已存在:', existingProfile.id)
    userId = existingProfile.id
  }

  // 🎯 步骤5: 更新用户信息（仅对已存在的用户）
  if (!isNewUser) {
    const avatarUrl = user.photo_url || existingProfile!.avatar_url

    await supabaseAdmin
      .from('profiles')
      .update({
        tg_username: user.username || existingProfile!.username || null,
        nickname: user.first_name + (user.last_name ? ` ${user.last_name}` : ''),
        username: user.username || existingProfile!.username || `user_${user.id}`,
        avatar_url: avatarUrl,
        lang: user.language_code || existingProfile!.lang,
        last_active_at: new Date().toISOString()
      })
      .eq('id', userId)

    console.log('[app-server] ✅ 用户信息已更新:', userId)
  }

  // 🎯 步骤6: 生成会话
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId)
  const userEmail = authUser?.user?.email || undefined

  const magicLinkEmail = userEmail || `tg_${user.id}@telegram.user`
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: magicLinkEmail
  })

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error('[app-server] generateLink failed:', linkError)
    return errorResponse('Failed to generate session link', 1, 500)
  }

  const { data: verifyData, error: verifyError } = await supabaseAdmin.auth.verifyOtp({
    type: 'magiclink',
    token_hash: linkData.properties.hashed_token
  })

  if (verifyError || !verifyData?.session) {
    console.error('[app-server] verifyOtp failed:', verifyError)
    return errorResponse('Failed to verify session', 1, 500)
  }

  const session = verifyData.session
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single()

  return successResponse({
    user_id: session.user.id,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    user: profile,
    need_bind_email: !existingProfile
  })
}

// ========================================
// 🛠️ 开发登录（仅用于本地开发）
// ========================================
async function handleDevLogin(req: Request): Promise<Response> {
  try {
    // 获取 user_id 参数
    const url = new URL(req.url)
    const userId = url.searchParams.get('user_id')

    if (!userId) {
      return errorResponse('缺少 user_id 参数', 1, 400)
    }

    console.log('[dev-login] 开发登录请求，user_id:', userId)

    // 查询用户数据
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error || !profile) {
      console.error('[dev-login] 用户不存在:', error)
      return errorResponse('用户不存在', 1, 404)
    }

    console.log('[dev-login] ✅ 获取用户数据成功:', profile.nickname)

    // 🔑 生成 session token（与 Telegram 登录逻辑一致）
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId)
    const userEmail = authUser?.user?.email || undefined

    const magicLinkEmail = userEmail || `dev_${userId}@dev.local`
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: magicLinkEmail
    })

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('[dev-login] generateLink failed:', linkError)
      return errorResponse('生成 session 失败', 1, 500)
    }

    const { data: verifyData, error: verifyError } = await supabaseAdmin.auth.verifyOtp({
      type: 'magiclink',
      token_hash: linkData.properties.hashed_token
    })

    if (verifyError || !verifyData?.session) {
      console.error('[dev-login] verifyOtp failed:', verifyError)
      return errorResponse('验证 session 失败', 1, 500)
    }

    const session = verifyData.session

    console.log('[dev-login] ✅ Session 生成成功')

    // 返回与 Telegram 登录相同的数据结构
    return successResponse({
      user_id: session.user.id,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      user: profile
    })
  } catch (error) {
    console.error('[dev-login] ❌ 错误:', error)
    return errorResponse(error.message || '服务器错误', 1, 500)
  }
}
