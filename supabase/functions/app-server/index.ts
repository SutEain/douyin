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
  handleVideoFollowing,
  handleVideoLike,
  handleVideoLikes,
  handleVideoMy,
  handleVideoDetail,
  handleBatchReview,
  handleApproveVideo,
  handleRecordView,
  handleVideoAdultFeed,
  handleGetAdultQuota
} from './routes/video.ts'
import {
  handleVideoComments,
  handleVideoCreateComment,
  handleCommentLike,
  handleCommentReplies
} from './routes/comments.ts'
import {
  handleFollowUser,
  handleGetUserProfile,
  handleAutoInit,
  handleRequestUpdate,
  handleVisitUserProfile,
  handleGetMyVisitors
} from './routes/user.ts'
import {
  handleSearchVideos,
  handleSearchAdultVideos,
  handleSearchUsers,
  handleHotSearch,
  handleGetSearchHistory,
  handleDeleteSearchHistory
} from './routes/search.ts'

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
    if (route === '/video/adult-feed' && method === 'GET') {
      return handleVideoAdultFeed(req)
    }
    if (route === '/video/following' && method === 'GET') {
      return handleVideoFollowing(req)
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
    if (route === '/video/batch-review' && method === 'POST') {
      return handleBatchReview(req)
    }
    if (route === '/video/approve' && method === 'POST') {
      return handleApproveVideo(req)
    }
    // 🎯 记录观看历史（播放时调用）
    if (route === '/video/view' && method === 'POST') {
      return handleRecordView(req)
    }
    if (route === '/video/adult-quota' && method === 'GET') {
      return handleGetAdultQuota(req)
    }
    if (route === '/video/comments' && method === 'GET') {
      return handleVideoComments(req)
    }
    if (route === '/video/comments' && method === 'POST') {
      return handleVideoCreateComment(req)
    }
    if (route === '/comment/replies' && method === 'GET') {
      return handleCommentReplies(req)
    }
    if (route === '/comment/like' && method === 'POST') {
      return handleCommentLike(req)
    }
    if (route === '/user/follow' && method === 'POST') {
      return handleFollowUser(req)
    }
    if (route === '/user/request-update' && method === 'POST') {
      return handleRequestUpdate(req)
    }
    if (route === '/user/visit' && method === 'POST') {
      return handleVisitUserProfile(req)
    }
    if (route === '/user/visitors' && method === 'GET') {
      return handleGetMyVisitors(req)
    }
    if (route === '/user/profile' && method === 'GET') {
      return handleGetUserProfile(req)
    }
    // 🎯 自动初始化用户
    if (route === '/user/auto-init' && method === 'POST') {
      return handleAutoInit(req)
    }

    // 🔍 搜索相关路由
    if (route === '/search/videos' && method === 'GET') {
      return handleSearchVideos(req)
    }
    if (route === '/search/adult' && method === 'GET') {
      return handleSearchAdultVideos(req)
    }
    if (route === '/search/users' && method === 'GET') {
      return handleSearchUsers(req)
    }
    if (route === '/search/hot' && method === 'GET') {
      return handleHotSearch(req)
    }
    if (route === '/search/history' && method === 'GET') {
      return handleGetSearchHistory(req)
    }
    if (route === '/search/history' && method === 'DELETE') {
      return handleDeleteSearchHistory(req)
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

  const { user, start_param } = validated

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

  // 🎯 处理邀请逻辑
  try {
    let inviterCode: string | null = null

    // 解析邀请码
    if (isNewUser && start_param) {
      if (start_param.startsWith('invite_')) {
        // 兼容旧逻辑
        const code = start_param.replace('invite_', '')
        if (/^\d+$/.test(code)) {
          inviterCode = code
        } else if (code.includes('-')) {
          // UUID 格式，直接当作 inviterId 使用
          const inviterId = code
          if (inviterId !== userId) {
            console.log('[Invite] 新用户通过旧邀请链接进入, inviterId =', inviterId)
            // 仅记录邀请关系，不做奖励计算（旧逻辑暂时这样处理，或可统一调用奖励逻辑）
            await supabaseAdmin.from('profiles').update({ invited_by: inviterId }).eq('id', userId)
          }
        }
      } else if (start_param.startsWith('video_') && start_param.includes('_i')) {
        // 新格式：video_xxx_i12345
        const parts = start_param.split('_i')
        if (parts.length > 1) {
          inviterCode = parts[1]
        }
      }
    }

    // 处理数字邀请码 (numeric_id)
    if (inviterCode && /^\d+$/.test(inviterCode)) {
      const numericId = parseInt(inviterCode)
      console.log('[Invite] 检测到数字邀请码:', numericId)

      // 查找邀请人
      const { data: inviterProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, invite_success_count, adult_permanent_unlock, adult_unlock_until')
        .eq('numeric_id', numericId)
        .maybeSingle()

      if (inviterProfile && inviterProfile.id !== userId) {
        const inviterId = inviterProfile.id
        console.log('[Invite] 找到邀请人:', inviterId)

        // 再次确认是否是新用户 (虽然外面有 isNewUser 标记，但双重保险)
        // isNewUser 变量是在 handleTelegramLogin 内部根据是否执行了 createUser 逻辑判断的，非常准确
        if (!isNewUser) {
          console.log('[Invite] 用户不是新注册，跳过邀请统计')
        } else {
          // 1. 标记被邀请人
          await supabaseAdmin.from('profiles').update({ invited_by: inviterId }).eq('id', userId)

          // 2. 更新邀请人奖励
          const now = new Date()
          const currentCount = inviterProfile.invite_success_count ?? 0
          const newCount = currentCount + 1

          let adultPermanentUnlock = inviterProfile.adult_permanent_unlock === true
          let adultUnlockUntil = inviterProfile.adult_unlock_until

          if (!adultPermanentUnlock) {
            if (newCount >= 3) {
              adultPermanentUnlock = true
              adultUnlockUntil = null
            } else {
              // 如果当前有解锁时间，在当前时间基础上增加
              const currentUnlock = adultUnlockUntil
                ? new Date(adultUnlockUntil).getTime()
                : now.getTime()
              // 确保不早于现在
              const baseTime = Math.max(currentUnlock, now.getTime())

              let addHours = 0
              if (newCount === 1) addHours = 24
              if (newCount === 2) addHours = 72 // 3天

              if (addHours > 0) {
                adultUnlockUntil = new Date(baseTime + addHours * 3600 * 1000).toISOString()
              }
            }
          }

          await supabaseAdmin
            .from('profiles')
            .update({
              invite_success_count: newCount,
              adult_permanent_unlock: adultPermanentUnlock,
              adult_unlock_until: adultUnlockUntil
            })
            .eq('id', inviterId)

          console.log('[Invite] 邀请处理成功，邀请人新人数:', newCount)

          // 3. 发送通知给邀请人 (通过 Bot API)
          if (TG_BOT_TOKEN) {
            const { data: inviterUser } = await supabaseAdmin
              .from('profiles')
              .select('tg_user_id')
              .eq('id', inviterId)
              .single()

            if (inviterUser?.tg_user_id) {
              let rewardText = ''
              if (newCount === 1) rewardText = '获得 24小时 🔞专区无限刷'
              else if (newCount === 2) rewardText = '获得 3天 🔞专区无限刷'
              else if (newCount >= 3) rewardText = '获得 永久 🔞专区无限刷'

              const msg =
                `🎉 <b>邀请成功！</b>\n\n` +
                `您已成功邀请 ${newCount} 人\n` +
                `🎁 ${rewardText}\n\n` +
                `继续邀请可获得更多奖励！`

              await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: inviterUser.tg_user_id,
                  text: msg,
                  parse_mode: 'HTML'
                })
              }).catch((e) => console.error('[Invite] 发送通知失败:', e))
            }
          }
        }
      } else {
        console.warn('[Invite] 未找到邀请人或不能邀请自己, code =', numericId)
      }
    }
  } catch (inviteError) {
    console.error('[Invite] 处理邀请逻辑失败:', inviteError)
  }

  // 🎯 步骤5: 更新用户信息（仅对已存在的用户）
  if (!isNewUser) {
    const avatarUrl = user.photo_url || existingProfile!.avatar_url

    // ✅ 重要：nickname 永远不要在“已存在用户登录”时被 initData 覆盖
    // ✅ 仅在创建用户时使用 initData 写 nickname/username
    console.log('[app-server] Profile 已存在，准备更新字段（不覆盖 nickname/username）:', {
      userId,
      tg_user_id: user.id,
      willUpdateAvatar: !!avatarUrl,
      willUpdateLang: !!user.language_code
    })

    await supabaseAdmin
      .from('profiles')
      .update({
        tg_username: user.username || null,
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
