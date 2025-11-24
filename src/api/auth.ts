import { supabase, type TelegramLoginResponse } from '@/utils/supabase'

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

/**
 * Telegram 登录
 * @param initData Telegram WebApp initData
 */
export async function loginWithTelegram(initData: string): Promise<TelegramLoginResponse> {
  const response = await fetch(`${EDGE_FUNCTION_URL}/auth-tg-login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ initData })
  })

  const result = await response.json()

  if (result.code !== 0) {
    throw new Error(result.msg || 'Login failed')
  }

  // 设置 Supabase session
  const { access_token, refresh_token } = result.data
  await supabase.auth.setSession({
    access_token,
    refresh_token
  })

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
  const {
    data: { user }
  } = await supabase.auth.getUser()
  return user
}

/**
 * 获取当前用户的 Profile
 */
export async function getCurrentProfile() {
  const user = await getCurrentUser()
  if (!user) return null

  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  if (error) {
    console.error('Error fetching profile:', error)
    return null
  }

  return data
}
