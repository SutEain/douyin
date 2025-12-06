import { supabase, type TelegramLoginResponse } from '@/utils/supabase'

const getAppServerBase = () => {
  if (import.meta.env.VITE_APP_SERVER_URL) {
    return import.meta.env.VITE_APP_SERVER_URL.replace(/\/$/, '')
  }

  if (import.meta.env.DEV) {
    return '/api/app-server'
  }

  if (import.meta.env.VITE_SUPABASE_URL) {
    return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/app-server`
  }

  throw new Error('Missing app server URL configuration')
}

/**
 * Telegram 登录
 * @param initData Telegram WebApp initData
 */
export async function loginWithTelegram(initData: string): Promise<TelegramLoginResponse> {
  console.log('[loginWithTelegram] 🚀 开始登录流程')

  // 检查环境变量
  const hasAnonKey = !!import.meta.env.VITE_SUPABASE_ANON_KEY
  const hasAppServerUrl = !!import.meta.env.VITE_APP_SERVER_URL
  const hasSupabaseUrl = !!import.meta.env.VITE_SUPABASE_URL

  console.log('[loginWithTelegram] 📝 环境变量检查:', {
    hasAnonKey,
    hasAppServerUrl,
    hasSupabaseUrl,
    isDev: import.meta.env.DEV
  })

  if (!hasAnonKey) {
    console.error('[loginWithTelegram] ❌ 缺少 VITE_SUPABASE_ANON_KEY 环境变量')
    throw new Error('缺少必要的配置信息，请联系管理员')
  }

  const base = getAppServerBase()
  console.log('[loginWithTelegram] 🌐 API 地址:', base)

  const url = `${base}/auth/tg-login`
  console.log('[loginWithTelegram] 📡 发送登录请求:', url)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({ initData })
  })

  console.log('[loginWithTelegram] 📥 响应状态:', response.status, response.statusText)

  const result = await response.json()
  console.log('[loginWithTelegram] 📦 响应数据:', result)

  if (result.code !== 0) {
    console.error('[loginWithTelegram] ❌ 登录失败:', result.msg)
    throw new Error(result.msg || 'Login failed')
  }

  // 设置 Supabase session
  const { access_token, refresh_token } = result.data
  console.log('[loginWithTelegram] 🔑 设置 Session...')

  const { error } = await supabase.auth.setSession({
    access_token,
    refresh_token
  })

  if (error) {
    console.error('[loginWithTelegram] ❌ Session 设置失败:', error)
    throw new Error('Failed to set session')
  }

  console.log('[loginWithTelegram] ✅ 登录成功！')
  return result.data
}

/**
 * 退出登录
 */
export async function logout() {
  await supabase.auth.signOut()
}

/**
 * 获取当前用户
 */
export async function getCurrentUser() {
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

    if (sessionError?.message?.includes('user_not_found')) {
      console.warn('[Supabase] 清理失效会话')
      await supabase.auth.signOut()
      return null
    }

    if (sessionError) {
      throw sessionError
    }

    const session = sessionData?.session
    if (!session) {
      return null
    }

    return session.user ?? null
  } catch (err: any) {
    if (err?.message?.includes('user_not_found')) {
      await supabase.auth.signOut()
      return null
    }
    console.warn('getCurrentUser failed:', err)
    return null
  }
}

/**
 * 获取当前用户的 Profile
 */
export async function getCurrentProfile() {
  const user = await getCurrentUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    console.warn('getCurrentProfile failed:', error)
    return null
  }

  return data
}
