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
  handleVideoMy
} from './routes/video.ts'
import { handleVideoComments, handleVideoCreateComment } from './routes/comments.ts'
import { handleFollowUser, handleGetUserProfile } from './routes/user.ts'

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

    if (route === '/video/my' && method === 'GET') {
      return handleVideoMy(req)
    }
    if (route === '/video/feed' && method === 'GET') {
      return handleVideoFeed(req)
    }
    if (route === '/video/author' && method === 'GET') {
      return handleVideoAuthor(req)
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

  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, username, nickname, tg_user_id, avatar_url, lang')
    .eq('tg_user_id', user.id)
    .maybeSingle()

  // ✅ 只查询用户，不创建（必须先通过Bot注册）
  if (!existingProfile) {
    console.log('[app-server] 用户未注册，tg_user_id:', user.id)
    return errorResponse(
      '请先通过 @douyinbot 开始使用', 
      'USER_NOT_REGISTERED', 
      403
    )
  }

  // ✅ 用户存在，更新基本信息
  const userId = existingProfile.id
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId)
  const userEmail = authUser?.user?.email || undefined

  const avatarUrl = user.photo_url || existingProfile.avatar_url

  await supabaseAdmin
    .from('profiles')
    .update({
      tg_username: user.username || existingProfile.username || null,
      nickname: user.first_name + (user.last_name ? ` ${user.last_name}` : ''),
      username: user.username || existingProfile.username || `user_${user.id}`,
      avatar_url: avatarUrl,
      lang: user.language_code || existingProfile.lang,
      last_active_at: new Date().toISOString()
    })
    .eq('id', userId)

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
