import { supabaseAdmin, TG_BOT_TOKEN } from './env.ts'

export async function checkAndSendNotification(
  targetUserId: string,
  type: 'like' | 'comment' | 'collect' | 'follow',
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
