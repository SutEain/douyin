import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors } from '../_shared/cors.ts'
import { successResponse, errorResponse } from '../_shared/response.ts'
import { validateTelegramInitData } from '../_shared/telegram.ts'

console.log('Telegram Login Function Started')

serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // 获取环境变量
    const TG_BOT_TOKEN = Deno.env.get('TG_BOT_TOKEN')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!TG_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing environment variables')
      return errorResponse('Server configuration error', 1, 500)
    }

    // 解析请求体
    const { initData } = await req.json()

    if (!initData) {
      return errorResponse('Missing initData', 1, 400)
    }

    // 验证 Telegram InitData
    const validated = await validateTelegramInitData(initData, TG_BOT_TOKEN)

    if (!validated) {
      return errorResponse('Invalid Telegram data', 1, 401)
    }

    const { user } = validated

    // 创建 Supabase Admin 客户端
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // 查找用户（通过 tg_user_id）
    const { data: existingProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, nickname, tg_user_id')
      .eq('tg_user_id', user.id)
      .maybeSingle()

    if (profileError && profileError.code !== 'PGRST116') {
      console.error('Error querying profile:', profileError)
      return errorResponse('Database error', 1, 500)
    }

    let userId: string

    if (existingProfile) {
      // 用户已存在，更新 last_active_at
      userId = existingProfile.id

      await supabase
        .from('profiles')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', userId)

      console.log('Existing user logged in:', userId)
    } else {
      // 创建新用户
      // 1. 先在 auth.users 中创建用户
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: `tg_${user.id}@telegram.user`, // 临时邮箱
        email_confirm: true,
        user_metadata: {
          tg_user_id: user.id,
          tg_username: user.username,
          tg_first_name: user.first_name,
          tg_last_name: user.last_name
        }
      })

      if (authError || !authData.user) {
        console.error('Error creating auth user:', authError)
        return errorResponse('Failed to create user', 1, 500)
      }

      userId = authData.user.id

      // 2. 更新 profile（由触发器自动创建，我们只需更新 TG 信息）
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          tg_user_id: user.id,
          tg_username: user.username || null,
          nickname: user.first_name + (user.last_name ? ` ${user.last_name}` : ''),
          username: user.username || `user_${user.id}`,
          auth_provider: 'tg',
          lang: user.language_code || 'en',
          avatar_url: user.photo_url || null
        })
        .eq('id', userId)

      if (updateError) {
        console.error('Error updating profile:', updateError)
        // 不返回错误，因为用户已创建
      }

      console.log('New user created:', userId)
    }

    // 生成 session（使用 admin API）
    const { data: sessionData, error: sessionError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: `tg_${user.id}@telegram.user`
    })

    if (sessionError || !sessionData) {
      console.error('Error generating session:', sessionError)
      return errorResponse('Failed to generate session', 1, 500)
    }

    // 从 magic link 中提取 access_token 和 refresh_token
    // 注意：这是一个简化的实现，生产环境可能需要更安全的方式
    const url = new URL(sessionData.properties.action_link)
    const accessToken = url.searchParams.get('access_token')
    const refreshToken = url.searchParams.get('refresh_token')

    if (!accessToken || !refreshToken) {
      console.error('Missing tokens in magic link')
      return errorResponse('Failed to generate tokens', 1, 500)
    }

    // 获取用户完整信息
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single()

    return successResponse({
      user_id: userId,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      user: profile,
      need_bind_email: !existingProfile // 新用户需要绑定邮箱
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 1, 500)
  }
})
