import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { successResponse, errorResponse } from '../_shared/response.ts'
import {
  validateTelegramInitData,
  validateTelegramWidgetData,
  type TelegramWidgetData
} from '../_shared/telegram.ts'
import { supabaseAdmin, TG_BOT_TOKEN } from './lib/env.ts'
import { HttpError } from './lib/auth.ts'
import {
  handleVideoAuthor,
  handleVideoCollect,
  handleVideoCollections,
  handleVideoFeed,
  handleVideoLongFeed,
  handleVideoTabFeed,
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
  handleCommentReplies,
  handleDeleteComment
} from './routes/comments.ts'
import {
  handleFollowUser,
  handleGetUserProfile,
  handleAutoInit,
  handleRequestUpdate,
  handleVisitUserProfile,
  handleGetMyVisitors,
  handleCheckIn
} from './routes/user.ts'
import {
  handleSearchVideos,
  handleCombinedSearch,
  handleSearchUsers,
  handleHotSearch,
  handleGetSearchHistory,
  handleDeleteSearchHistory
} from './routes/search.ts'
import { handlePostRecommended } from './routes/post.ts'
import { handleLiveRooms, handleLiveRoomsProbe, handleLiveRoomDetail } from './routes/live.ts'
import {
  handleSendRedPacket,
  handleClaimRedPacket,
  handleGetActiveRedPackets
} from './routes/redPacket.ts'
import {
  handleAdminDouyinParse,
  handleAdminDouyinPublish,
  handleAdminDouyinRefresh
} from './routes/douyin.ts'
import { handleSendReward } from './routes/reward.ts'
import {
  handleAdminConfirmRecharge,
  handleGetRechargeInfo,
  handleCreateRechargeOrder,
  handleCancelRechargeOrder
} from './routes/recharge.ts'
import { handleAdminProcessWithdraw } from './routes/withdraw.ts'
import { handleAdminAutoWithdraw } from './routes/adminWithdraw.ts'

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

    if (route === '/auth/tg-widget-login' && method === 'POST') {
      return handleTelegramWidgetLogin(req)
    }

    if (route === '/video/my' && method === 'GET') {
      return handleVideoMy(req)
    }
    if (route === '/video/feed' && method === 'GET') {
      return handleVideoFeed(req)
    }
    if (route === '/video/long-feed' && method === 'GET') {
      return handleVideoLongFeed(req)
    }
    if (route === '/video/video-tab-feed' && method === 'GET') {
      return handleVideoTabFeed(req)
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
    if (route === '/comment/delete' && method === 'POST') {
      return handleDeleteComment(req)
    }
    if (route === '/user/follow' && method === 'POST') {
      return handleFollowUser(req)
    }
    if (route === '/user/checkin' && method === 'POST') {
      return handleCheckIn(req)
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
    // 💰 打赏/奖励
    if (route === '/reward/send' && method === 'POST') {
      return handleSendReward(req)
    }

    // 💰 充值确认 (仅 admin)
    if (route === '/recharge/confirm' && method === 'POST') {
      return handleAdminConfirmRecharge(req)
    }
    if (route === '/recharge/info' && method === 'GET') {
      return handleGetRechargeInfo(req)
    }
    if (route === '/recharge/create' && method === 'POST') {
      return handleCreateRechargeOrder(req)
    }
    if (route === '/recharge/cancel' && method === 'POST') {
      return handleCancelRechargeOrder(req)
    }

    // 💰 提现处理 (仅 admin)
    if (route === '/withdraw/process' && method === 'POST') {
      return handleAdminProcessWithdraw(req)
    }
    if (route === '/admin/withdraw/auto-payout' && method === 'POST') {
      return handleAdminAutoWithdraw(req)
    }

    // 🔍 搜索相关路由
    if (route === '/search/combined' && method === 'GET') {
      return handleCombinedSearch(req)
    }
    if (route === '/search/videos' && method === 'GET') {
      return handleSearchVideos(req)
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

    // 🧩 图文（壁纸）推荐
    if (route === '/post/recommended' && method === 'GET') {
      return handlePostRecommended(req)
    }

    // 📺 直播间列表（后台维护）
    if (route === '/live/rooms' && method === 'GET') {
      return handleLiveRooms(req)
    }
    if (route === '/live/detail' && method === 'GET') {
      return handleLiveRoomDetail(req)
    }
    // 🧧 红包相关路由
    if (route === '/live/red-packet/send' && method === 'POST') {
      return handleSendRedPacket(req)
    }
    if (route === '/live/red-packet/claim' && method === 'POST') {
      return handleClaimRedPacket(req)
    }
    if (route === '/live/red-packet/active' && method === 'GET') {
      return handleGetActiveRedPackets(req)
    }
    // 🧪 探测直播间在线状态（仅 admin）
    if (route === '/live/rooms/probe' && method === 'POST') {
      return handleLiveRoomsProbe(req)
    }

    // 🎬 后台：抖音解析/发布（仅 admin）
    if (route === '/admin/douyin/parse' && method === 'POST') {
      return handleAdminDouyinParse(req)
    }
    if (route === '/admin/douyin/publish' && method === 'POST') {
      return handleAdminDouyinPublish(req)
    }
    if (route === '/admin/douyin/refresh-links' && method === 'POST') {
      return handleAdminDouyinRefresh(req)
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

// 🎯 处理浏览器端 Telegram Login Widget 登录
async function handleTelegramWidgetLogin(req: Request): Promise<Response> {
  if (!TG_BOT_TOKEN) {
    return errorResponse('Server misconfigured', 1, 500)
  }

  let body: { user?: TelegramWidgetData }
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid request body', 1, 400)
  }

  if (!body?.user) {
    return errorResponse('Missing user data', 1, 400)
  }

  // 验证 Widget 数据
  const isValid = await validateTelegramWidgetData(body.user, TG_BOT_TOKEN)
  if (!isValid) {
    return errorResponse('Invalid Telegram widget data', 1, 401)
  }

  const user = body.user

  // 🎯 步骤1: 查询 profile 是否存在
  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, username, nickname, tg_user_id, avatar_url, lang')
    .eq('tg_user_id', user.id)
    .maybeSingle()

  let userId: string
  let isNewUser = false

  if (!existingProfile) {
    console.log('[app-server] Widget Login: Profile 不存在，开始创建用户，tg_user_id:', user.id)

    // 🎯 步骤2: 创建 auth 用户
    const uniqueEmail = `tg_${user.id}@telegram.user`
    let authUserId: string

    try {
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
        if (authError.status === 422 || authError.message?.includes('email')) {
          const { data: users } = await supabaseAdmin.auth.admin.listUsers()
          const existingUser = users?.users?.find((u) => u.email === uniqueEmail)
          if (existingUser) {
            authUserId = existingUser.id
          } else {
            return errorResponse('创建用户失败', 1, 500)
          }
        } else {
          return errorResponse('创建用户失败', 1, 500)
        }
      } else {
        authUserId = authData.user.id
      }
    } catch (err) {
      console.error('[app-server] ❌ 创建 auth 用户异常:', err)
      return errorResponse('创建用户失败', 1, 500)
    }

    // 🎯 步骤3: 创建 profile
    const nickname = user.first_name + (user.last_name ? ` ${user.last_name}` : '')
    const avatarUrl = user.photo_url || `https://t.me/i/userpic/320/${user.id}.jpg`

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
          lang: 'zh-CN' // Widget 不提供 language_code，使用默认值
        },
        { onConflict: 'id' }
      )
      .select('id')
      .single()

    if (upsertError) {
      console.error('[app-server] ❌ upsert profile 失败:', upsertError)
      return errorResponse('创建用户资料失败', 1, 500)
    }

    userId = profile.id
    isNewUser = true

    // 🎯 步骤4: 新用户默认关注官方账号
    try {
      const { data: officialUser } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('numeric_id', 88888)
        .maybeSingle()

      if (officialUser && officialUser.id !== userId) {
        await supabaseAdmin.from('follows').upsert(
          {
            follower_id: userId,
            followee_id: officialUser.id
          },
          { onConflict: 'follower_id,followee_id' }
        )
      }
    } catch (followErr) {
      console.error('[app-server] 自动关注官方账号失败:', followErr)
    }
  } else {
    userId = existingProfile.id
  }

  // 🎯 生成 session token
  const { data: sessionData, error: sessionError } = await supabaseAdmin.auth.admin.createSession({
    userId: userId
  })

  if (sessionError || !sessionData?.session) {
    console.error('[app-server] ❌ 创建 session 失败:', sessionError)
    return errorResponse('创建会话失败', 1, 500)
  }

  return successResponse({
    user: existingProfile || {
      id: userId,
      tg_user_id: user.id,
      username: user.username || `user_${user.id}`,
      nickname: user.first_name + (user.last_name ? ` ${user.last_name}` : ''),
      avatar_url: user.photo_url || `https://t.me/i/userpic/320/${user.id}.jpg`
    },
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
    expires_in: sessionData.session.expires_in || 3600,
    is_new_user: isNewUser
  })
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

    // 🎯 步骤4: 新用户默认关注官方账号 88888 (抖音精选)
    try {
      const { data: officialUser } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('numeric_id', 88888)
        .maybeSingle()

      if (officialUser && officialUser.id !== userId) {
        console.log('[app-server] 新用户自动关注官方账号:', officialUser.id)
        await supabaseAdmin.from('follows').upsert(
          {
            follower_id: userId,
            followee_id: officialUser.id
          },
          { onConflict: 'follower_id,followee_id' }
        )
      }
    } catch (followErr) {
      console.error('[app-server] 自动关注官方账号失败:', followErr)
    }
  } else {
    // ✅ 用户已存在
    console.log('[app-server] 用户已存在:', existingProfile.id)
    userId = existingProfile.id
  }

  // 🎯 处理邀请逻辑
  try {
    // 1. 获取当前用户的邀请状态
    const { data: myProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, invited_by, invite_rewarded, created_at')
      .eq('id', userId)
      .single()

    if (myProfile && !myProfile.invite_rewarded) {
      let inviterId = myProfile.invited_by
      let inviterCode: string | null = null

      // 如果当前没有邀请人，尝试从 start_param 解析
      if (!inviterId && start_param) {
        if (start_param.startsWith('invite_')) {
          const code = start_param.replace('invite_', '')
          if (/^\d+$/.test(code)) {
            inviterCode = code
          } else if (code.includes('-')) {
            inviterId = code
          }
        } else if (start_param.startsWith('video_') && start_param.includes('_i')) {
          const parts = start_param.split('_i')
          if (parts.length > 1) inviterCode = parts[1]
        } else if (start_param.startsWith('live_') && start_param.includes('_i')) {
          const parts = start_param.split('_i')
          if (parts.length > 1) inviterCode = parts[1]
        }

        if (inviterCode && /^\d+$/.test(inviterCode)) {
          const { data: invProfile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('numeric_id', parseInt(inviterCode))
            .maybeSingle()
          if (invProfile) inviterId = invProfile.id
        }
      }

      // 如果找到了合法的邀请人（且不是自己）
      if (inviterId && inviterId !== userId) {
        console.log('[Invite] 准备为邀请人发放奖励:', inviterId)

        // 🎯 核心安全检查：只有注册时间在 24 小时内的用户才算有效“转化”
        const createdAt = new Date(myProfile.created_at).getTime()
        const nowTime = Date.now()
        if (nowTime - createdAt > 24 * 3600 * 1000) {
          console.log('[Invite] 用户注册超过 24 小时，不计入奖励转化')
        } else {
          // 查找邀请人详细信息并锁定
          const { data: inviterProfile } = await supabaseAdmin
            .from('profiles')
            .select(
              'id, invite_success_count, adult_permanent_unlock, adult_unlock_until, balance_coins'
            )
            .eq('id', inviterId)
            .maybeSingle()

          if (inviterProfile) {
            // 标记当前用户已完成转化（防止重复奖励）
            await supabaseAdmin
              .from('profiles')
              .update({
                invited_by: inviterId,
                invite_rewarded: true
              })
              .eq('id', userId)

            // 发放奖励逻辑
            const now = new Date()
            const currentCount = inviterProfile.invite_success_count ?? 0
            const newCount = currentCount + 1

            const { data: setting } = await supabaseAdmin
              .from('system_settings')
              .select('value_int')
              .eq('id', 'invitation_reward_coins')
              .maybeSingle()
            const rewardCoins = setting?.value_int ?? 20

            let adultPermanentUnlock = inviterProfile.adult_permanent_unlock === true
            let adultUnlockUntil = inviterProfile.adult_unlock_until

            if (!adultPermanentUnlock) {
              if (newCount >= 3) {
                adultPermanentUnlock = true
                adultUnlockUntil = null
              } else {
                const currentUnlock = adultUnlockUntil
                  ? new Date(adultUnlockUntil).getTime()
                  : now.getTime()
                const baseTime = Math.max(currentUnlock, now.getTime())
                let addHours = 0
                if (newCount === 1) addHours = 24
                if (newCount === 2) addHours = 72
                if (addHours > 0) {
                  adultUnlockUntil = new Date(baseTime + addHours * 3600 * 1000).toISOString()
                }
              }
            }

            // 更新邀请人
            const { data: updatedInviter } = await supabaseAdmin
              .from('profiles')
              .update({
                invite_success_count: newCount,
                adult_permanent_unlock: adultPermanentUnlock,
                adult_unlock_until: adultUnlockUntil,
                balance_coins: (inviterProfile.balance_coins || 0) + rewardCoins
              })
              .eq('id', inviterId)
              .select('balance_coins')
              .single()

            // 交易流水
            await supabaseAdmin.from('coin_transactions').insert({
              user_id: inviterId,
              amount: rewardCoins,
              balance_after: updatedInviter?.balance_coins || 0,
              type: 'reward',
              description: `成功邀请新用户(进入App)奖励`,
              related_id: userId
            })

            // 发送通知
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
                  `🎉 <b>邀请转化成功！</b>\n\n` +
                  `新用户已进入 Mini App，您当前已累计邀请 ${newCount} 人\n` +
                  `🎁 ${rewardText}\n` +
                  `💰 获得 ${rewardCoins} 抖币奖励！\n\n` +
                  `继续邀请可获得更多奖励！`

                fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
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
        }
      }
    }
  } catch (inviteError) {
    console.error('[Invite] 处理邀请逻辑失败:', inviteError)
  }

  // 🎯 步骤5: 更新用户信息（仅对已存在的用户）
  if (!isNewUser) {
    // ✅ 优化头像更新逻辑：如果用户已经在系统中设置了自定义头像（存储在我们的 S3/Supabase 桶中），则不使用 Telegram 的 photo_url 覆盖它
    let avatarUrl = existingProfile!.avatar_url
    const isCustomAvatar =
      avatarUrl && (avatarUrl.includes('supabase.co') || avatarUrl.includes('user-content'))

    if (!isCustomAvatar && user.photo_url) {
      avatarUrl = user.photo_url
    }

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
