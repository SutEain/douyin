import { BOT_TOKEN, TG_API_BASE } from '../env.ts'
import { supabase } from '../supabaseClient.ts'

// 获取 Telegram 用户信息
export async function getTelegramUserInfo(userId: number) {
  try {
    const url = `${TG_API_BASE}/bot${BOT_TOKEN}/getChat`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: userId })
    })

    const result = await response.json()
    if (!result.ok) {
      console.error('获取 Telegram 用户信息失败:', result)
      return null
    }

    return {
      id: result.result.id,
      first_name: result.result.first_name || '用户',
      last_name: result.result.last_name,
      username: result.result.username,
      language_code: result.result.language_code
    }
  } catch (error) {
    console.error('获取 Telegram 用户信息异常:', error)
    return null
  }
}

// 获取或创建 Profile（在 /start 时调用）
// tgUserInfo: Telegram message.from 对象，包含用户完整信息
export async function getOrCreateProfile(
  tgUserId: number,
  tgUserInfo?: { first_name: string; last_name?: string; username?: string; language_code?: string }
): Promise<{ id: string; numeric_id?: number } | null> {
  try {
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('tg_user_id', tgUserId)
      .maybeSingle()

    if (existingProfile) {
      console.log('找到已存在的 profile:', existingProfile.id)
      return { id: existingProfile.id, numeric_id: existingProfile.numeric_id }
    }

    console.log('Profile 不存在，开始创建...')

    const tgUser = tgUserInfo
      ? {
          id: tgUserId,
          first_name: tgUserInfo.first_name,
          last_name: tgUserInfo.last_name,
          username: tgUserInfo.username,
          language_code: tgUserInfo.language_code
        }
      : await getTelegramUserInfo(tgUserId)

    if (!tgUser) {
      console.error('无法获取 Telegram 用户信息')
      return null
    }

    const uniqueEmail = `tg_${tgUser.id}@telegram.user`
    let userId: string

    try {
      const { data: authData, error } = await supabase.auth.admin.createUser({
        email: uniqueEmail,
        email_confirm: true,
        user_metadata: {
          tg_user_id: tgUser.id,
          tg_username: tgUser.username,
          tg_first_name: tgUser.first_name,
          tg_last_name: tgUser.last_name
        }
      })

      if (error) {
        if (error.status === 422 || error.message?.includes('email')) {
          const { data: users } = await supabase.auth.admin.listUsers()
          const existingUser = users?.users?.find((u) => u.email === uniqueEmail)
          if (existingUser) {
            userId = existingUser.id
            console.log('找到已存在的 auth 用户:', userId)
          } else {
            console.error('创建 auth 用户失败:', error)
            return null
          }
        } else {
          console.error('创建 auth 用户失败:', error)
          return null
        }
      } else {
        userId = authData.user.id
        console.log('成功创建 auth 用户:', userId)
      }
    } catch (err) {
      console.error('创建 auth 用户异常:', err)
      return null
    }

    const avatarUrl = `https://t.me/i/userpic/320/${tgUser.id}.jpg`

    const { data: profile, error: upsertError } = await supabase
      .from('profiles')
      .upsert(
        {
          id: userId!,
          tg_user_id: tgUser.id,
          tg_username: tgUser.username || null,
          nickname: tgUser.first_name + (tgUser.last_name ? ` ${tgUser.last_name}` : ''),
          username: tgUser.username || `user_${tgUser.id}`,
          avatar_url: avatarUrl,
          auth_provider: 'tg',
          lang: tgUser.language_code || 'zh-CN'
        },
        { onConflict: 'id' }
      )
      .select('id, numeric_id')
      .single()

    if (upsertError) {
      console.error('创建 profile 失败:', upsertError)
      return null
    }

    console.log('✅ 成功创建 profile:', profile.id)
    return profile
  } catch (error) {
    console.error('getOrCreateProfile 异常:', error)
    return null
  }
}
