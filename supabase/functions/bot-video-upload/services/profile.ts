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
): Promise<{ id: string; numeric_id?: number; auto_approve?: boolean } | null> {
  try {
    console.log('========== [getOrCreateProfile] 开始 ==========')
    console.log('[getOrCreateProfile] tgUserId:', tgUserId)
    console.log('[getOrCreateProfile] tgUserInfo:', JSON.stringify(tgUserInfo, null, 2))

    // 🎯 步骤1：查询现有 profile
    console.log('[getOrCreateProfile] 🔍 步骤1：查询现有 profile...')
    const { data: existingProfile, error: queryError } = await supabase
      .from('profiles')
      .select('id, numeric_id, auto_approve')
      .eq('tg_user_id', tgUserId)
      .maybeSingle()

    if (queryError) {
      console.error('[getOrCreateProfile] ❌ 查询 profile 失败:', queryError)
      console.error('[getOrCreateProfile] 错误详情:', JSON.stringify(queryError, null, 2))
      return null
    }

    if (existingProfile) {
      console.log('[getOrCreateProfile] ✅ 找到已存在的 profile:', existingProfile.id)
      console.log('[getOrCreateProfile] profile 详情:', JSON.stringify(existingProfile, null, 2))
      return {
        id: existingProfile.id,
        numeric_id: existingProfile.numeric_id,
        auto_approve: existingProfile.auto_approve
      }
    }

    console.log('[getOrCreateProfile] ⚠️ Profile 不存在，开始创建流程...')

    // 🎯 步骤2：获取完整的 Telegram 用户信息
    console.log('[getOrCreateProfile] 🔍 步骤2：获取 Telegram 用户信息...')
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
      console.error('[getOrCreateProfile] ❌ 无法获取 Telegram 用户信息')
      return null
    }

    console.log('[getOrCreateProfile] ✅ 获取到用户信息:', JSON.stringify(tgUser, null, 2))

    // 🎯 步骤3：创建 auth 用户
    const uniqueEmail = `tg_${tgUser.id}@telegram.user`
    console.log('[getOrCreateProfile] 🔍 步骤3：创建 auth 用户...')
    console.log('[getOrCreateProfile] 用户邮箱:', uniqueEmail)
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
        console.error('[getOrCreateProfile] ⚠️ 创建 auth 用户返回错误:', error)
        console.error('[getOrCreateProfile] 错误状态码:', error.status)
        console.error('[getOrCreateProfile] 错误消息:', error.message)
        console.error('[getOrCreateProfile] 错误详情:', JSON.stringify(error, null, 2))

        if (error.status === 422 || error.message?.includes('email')) {
          console.log('[getOrCreateProfile] 🔍 检测到邮箱冲突，尝试查找已存在的用户...')
          const { data: users, error: listError } = await supabase.auth.admin.listUsers()

          if (listError) {
            console.error('[getOrCreateProfile] ❌ 列举用户失败:', listError)
            return null
          }

          console.log('[getOrCreateProfile] 获取到用户列表，共', users?.users?.length, '个用户')
          const existingUser = users?.users?.find((u) => u.email === uniqueEmail)

          if (existingUser) {
            userId = existingUser.id
            console.log('[getOrCreateProfile] ✅ 找到已存在的 auth 用户:', userId)
          } else {
            console.error('[getOrCreateProfile] ❌ 未找到匹配的 auth 用户，但报告邮箱冲突')
            return null
          }
        } else {
          console.error('[getOrCreateProfile] ❌ 创建 auth 用户失败（非邮箱冲突）')
          return null
        }
      } else {
        userId = authData.user.id
        console.log('[getOrCreateProfile] ✅ 成功创建 auth 用户:', userId)
      }
    } catch (err) {
      console.error('[getOrCreateProfile] ❌ 创建 auth 用户异常:', err)
      console.error(
        '[getOrCreateProfile] 异常堆栈:',
        err instanceof Error ? err.stack : '无堆栈信息'
      )
      return null
    }

    // 🎯 步骤4：创建/更新 profile
    console.log('[getOrCreateProfile] 🔍 步骤4：创建/更新 profile...')
    const avatarUrl = `https://t.me/i/userpic/320/${tgUser.id}.jpg`

    // 🎯 生成唯一的 username，避免冲突
    let username = tgUser.username || `user_${tgUser.id}`

    // 🎯 检查 username 是否已被占用（by 其他 tg_user_id）
    const { data: existingUsername } = await supabase
      .from('profiles')
      .select('tg_user_id')
      .eq('username', username)
      .maybeSingle()

    if (existingUsername && existingUsername.tg_user_id !== tgUser.id) {
      // 用户名已被其他账号占用，生成唯一后缀
      console.log('[getOrCreateProfile] ⚠️ username 冲突，生成唯一后缀...')
      const timestamp = Date.now().toString(36)
      username = `${username}_${timestamp}`
      console.log('[getOrCreateProfile] 新 username:', username)
    }

    const profileData = {
      id: userId!,
      tg_user_id: tgUser.id,
      tg_username: tgUser.username || null,
      nickname: tgUser.first_name + (tgUser.last_name ? ` ${tgUser.last_name}` : ''),
      username: username,
      avatar_url: avatarUrl,
      auth_provider: 'tg',
      lang: tgUser.language_code || 'zh-CN'
    }
    console.log('[getOrCreateProfile] profile 数据:', JSON.stringify(profileData, null, 2))

    const { data: profile, error: upsertError } = await supabase
      .from('profiles')
      .upsert(profileData, { onConflict: 'id' })
      .select('id, numeric_id, auto_approve')
      .single()

    if (upsertError) {
      console.error('[getOrCreateProfile] ❌ 创建 profile 失败:', upsertError)
      console.error('[getOrCreateProfile] 错误代码:', upsertError.code)
      console.error('[getOrCreateProfile] 错误消息:', upsertError.message)
      console.error('[getOrCreateProfile] 错误详情:', JSON.stringify(upsertError, null, 2))

      // 🎯 如果仍然是 username 冲突（极端情况：时间戳碰撞），使用随机字符串
      if (upsertError.code === '23505' && upsertError.message?.includes('username')) {
        console.log('[getOrCreateProfile] ⚠️ 再次 username 冲突，使用随机后缀重试...')
        const randomSuffix = Math.random().toString(36).substring(2, 8)
        profileData.username = `user_${tgUser.id}_${randomSuffix}`
        console.log('[getOrCreateProfile] 随机 username:', profileData.username)

        const { data: retryProfile, error: retryError } = await supabase
          .from('profiles')
          .upsert(profileData, { onConflict: 'id' })
          .select('id, numeric_id, auto_approve')
          .single()

        if (retryError) {
          console.error('[getOrCreateProfile] ❌ 重试后仍然失败:', retryError)
          return null
        }

        console.log('[getOrCreateProfile] ✅ 重试成功，profile:', retryProfile.id)
        console.log('========== [getOrCreateProfile] 结束（成功，经过重试）==========')
        return retryProfile
      }

      return null
    }

    console.log('[getOrCreateProfile] ✅ 成功创建 profile:', profile.id)
    console.log('[getOrCreateProfile] profile 详情:', JSON.stringify(profile, null, 2))
    console.log('========== [getOrCreateProfile] 结束（成功）==========')
    return profile
  } catch (error) {
    console.error('[getOrCreateProfile] ❌❌❌ 顶层异常捕获 ❌❌❌')
    console.error('[getOrCreateProfile] 异常类型:', error?.constructor?.name)
    console.error(
      '[getOrCreateProfile] 异常消息:',
      error instanceof Error ? error.message : String(error)
    )
    console.error(
      '[getOrCreateProfile] 异常堆栈:',
      error instanceof Error ? error.stack : '无堆栈信息'
    )
    console.error('[getOrCreateProfile] 异常详情:', JSON.stringify(error, null, 2))
    console.error('========== [getOrCreateProfile] 结束（失败）==========')
    return null
  }
}
