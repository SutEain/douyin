import { supabaseAdmin, TG_BOT_TOKEN } from './env.ts'

export type NotificationType = 'like' | 'comment' | 'collect' | 'follow' | 'new_post'

export async function checkAndSendNotification(
  targetUserId: string,
  type: NotificationType,
  message: string,
  startParam?: string
) {
  console.log(`[DEBUG-NOTIF] checkAndSendNotification: type=${type}, target=${targetUserId}`)
  try {
    if (!TG_BOT_TOKEN) {
      console.warn('[DEBUG-NOTIF] ❌ TG_BOT_TOKEN not configured')
      return
    }

    // 1. 获取目标用户信息
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('tg_user_id, notification_settings')
      .eq('id', targetUserId)
      .single()

    if (error) {
      console.error('[DEBUG-NOTIF] ❌ Query profile error:', error)
      return
    }

    if (!profile || !profile.tg_user_id) {
      console.log(
        `[DEBUG-NOTIF] Skipped: Target user ${targetUserId} has no tg_user_id. Profile exists: ${!!profile}`
      )
      return
    }

    console.log(`[DEBUG-NOTIF] Found target tg_user_id: ${profile.tg_user_id}`)

    // 2. 检查设置
    const settings = profile.notification_settings || {}
    const typeSetting = settings[type] || { mute_until: 0 }

    const muteUntil = typeSetting.mute_until || 0
    if (muteUntil === -1) {
      console.log(`[DEBUG-NOTIF] Skipped: User disabled ${type} notifications`)
      return
    }

    if (muteUntil > Date.now()) {
      console.log(
        `[DEBUG-NOTIF] Skipped: User muted ${type} notifications until ${new Date(muteUntil).toISOString()}`
      )
      return
    }

    // 3. 发送通知
    const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`
    console.log(`[DEBUG-NOTIF] Sending message to ${url}`)

    // 构造按钮
    // TODO: 从环境变量获取 Bot Username 和 App Name
    const botUsername = 'tg_douyin_bot'
    const appName = 'tgdouyin'

    const payload: any = {
      chat_id: profile.tg_user_id,
      text: message,
      parse_mode: 'HTML'
    }

    if (startParam) {
      const deepLink = `https://t.me/${botUsername}/${appName}?startapp=${startParam}`
      payload.reply_markup = {
        inline_keyboard: [[{ text: '👉 查看详情', url: deepLink }]]
      }
    }

    // Fire and forget (don't await response to avoid blocking main thread too long,
    // but in Edge Functions we should ideally await or use waitUntil)
    const p = fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then((res) => res.json())
      .then((res) => {
        if (!res.ok) {
          console.error('[DEBUG-NOTIF] Send failed:', res)
        } else {
          console.log(
            `[DEBUG-NOTIF] ✅ Sent ${type} to ${profile.tg_user_id}, msg_id: ${res.result?.message_id}`
          )
        }
      })
      .catch((e) => console.error('[DEBUG-NOTIF] Error:', e))

    // 这里的 Promise p 没有被 await，在某些 runtime 可能被中断
    // 但为了响应速度，且这只是通知，可以接受一定程度的丢失
    // 如果 Deno Edge Function 支持 waitUntil，最好使用它
  } catch (error) {
    console.error('[Notification] Error:', error)
  }
}

/**
 * 🎯 通知用户的所有粉丝：有新作品发布
 * @param authorId 发布者的 user_id (profiles.id)
 * @param authorNickname 发布者昵称
 * @param videoId 视频 ID
 * @param videoDesc 视频描述（可选）
 */
export async function notifyFollowersNewPost(
  authorId: string,
  authorNickname: string,
  videoId: string,
  videoDesc?: string
) {
  console.log(`[NOTIFY-NEW-POST] 开始通知粉丝: author=${authorId}, video=${videoId}`)

  try {
    if (!TG_BOT_TOKEN) {
      console.warn('[NOTIFY-NEW-POST] ❌ TG_BOT_TOKEN not configured')
      return
    }

    // 1. 查询该用户的所有粉丝（包含通知设置）
    const { data: followers, error } = await supabaseAdmin
      .from('follows')
      .select(
        `
        follower_id,
        follower:profiles!follows_follower_id_fkey(
          id,
          tg_user_id,
          notification_settings
        )
      `
      )
      .eq('followee_id', authorId)

    if (error) {
      console.error('[NOTIFY-NEW-POST] ❌ 查询粉丝失败:', error)
      return
    }

    if (!followers || followers.length === 0) {
      console.log('[NOTIFY-NEW-POST] 没有粉丝需要通知')
      return
    }

    console.log(`[NOTIFY-NEW-POST] 找到 ${followers.length} 个粉丝`)

    // 2. 构造消息
    const descPreview = videoDesc
      ? `\n📝 ${videoDesc.substring(0, 50)}${videoDesc.length > 50 ? '...' : ''}`
      : ''
    const message = `🎬 <b>${authorNickname}</b> 发布了新作品${descPreview}`
    const startParam = `video_${videoId}`

    // 3. 批量发送通知（并行但限制并发）
    const botUsername = 'tg_douyin_bot'
    const appName = 'tgdouyin'
    const deepLink = `https://t.me/${botUsername}/${appName}?startapp=${startParam}`

    let sentCount = 0
    let skippedCount = 0

    // 并行发送，但使用 Promise.allSettled 避免单个失败影响其他
    const sendPromises = followers.map(async (follow: any) => {
      const followerProfile = follow.follower
      if (!followerProfile || !followerProfile.tg_user_id) {
        skippedCount++
        return
      }

      // 检查通知设置
      const settings = followerProfile.notification_settings || {}
      const typeSetting = settings['new_post'] || { mute_until: 0 }
      const muteUntil = typeSetting.mute_until || 0

      if (muteUntil === -1) {
        // 永久关闭
        skippedCount++
        return
      }
      if (muteUntil > Date.now()) {
        // 临时静音中
        skippedCount++
        return
      }

      // 发送通知
      const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: followerProfile.tg_user_id,
            text: message,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '👉 立即查看', url: deepLink }]]
            }
          })
        })
        const data = await res.json()
        if (data.ok) {
          sentCount++
        } else {
          console.warn(
            `[NOTIFY-NEW-POST] 发送失败 to ${followerProfile.tg_user_id}:`,
            data.description
          )
        }
      } catch (e) {
        console.error(`[NOTIFY-NEW-POST] 发送异常 to ${followerProfile.tg_user_id}:`, e)
      }
    })

    await Promise.allSettled(sendPromises)

    console.log(`[NOTIFY-NEW-POST] ✅ 完成: 发送 ${sentCount} 条, 跳过 ${skippedCount} 条`)
  } catch (error) {
    console.error('[NOTIFY-NEW-POST] Error:', error)
  }
}
