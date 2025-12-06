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
  const base = getAppServerBase()
  const response = await fetch(`${base}/auth/tg-login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({ initData })
  })

  const result = await response.json()

  if (result.code !== 0) {
    throw new Error(result.msg || 'Login failed')
  }

  // 设置 Supabase session
  const { access_token, refresh_token } = result.data
  const { error } = await supabase.auth.setSession({
    access_token,
    refresh_token
  })
  
  if (error) {
    throw new Error('Failed to set session')
  }

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
