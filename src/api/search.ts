import { supabase } from '@/utils/supabase'

const APP_SERVER_URL = import.meta.env.VITE_APP_SERVER_URL

// 获取访问令牌
async function getAccessToken(required: boolean = true) {
  const {
    data: { session }
  } = await supabase.auth.getSession()
  const token = session?.access_token ?? null
  if (!token && required) {
    throw new Error('请先登录')
  }
  return token
}

/**
 * 搜索视频（普通）
 */
export async function searchVideos(keyword: string, pageNo = 0, pageSize = 20) {
  const accessToken = await getAccessToken(false) // 可选认证

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  if (window.Telegram?.WebApp?.initData) {
    headers['X-Telegram-Init-Data'] = window.Telegram.WebApp.initData
  }

  const response = await fetch(
    `${APP_SERVER_URL}/search/videos?keyword=${encodeURIComponent(
      keyword
    )}&pageNo=${pageNo}&pageSize=${pageSize}`,
    { headers }
  )

  if (!response.ok) {
    throw new Error(`Search videos failed: ${response.status}`)
  }

  const result = await response.json()

  if (result.code !== 0) {
    throw new Error(result.msg || 'Search videos failed')
  }

  return result.data
}

/**
 * 搜索成人视频（18+）
 */
export async function searchAdultVideos(keyword: string, pageNo = 0, pageSize = 20) {
  const accessToken = await getAccessToken(false) // 可选认证

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  if (window.Telegram?.WebApp?.initData) {
    headers['X-Telegram-Init-Data'] = window.Telegram.WebApp.initData
  }

  const response = await fetch(
    `${APP_SERVER_URL}/search/adult?keyword=${encodeURIComponent(
      keyword
    )}&pageNo=${pageNo}&pageSize=${pageSize}`,
    { headers }
  )

  if (!response.ok) {
    throw new Error(`Search adult videos failed: ${response.status}`)
  }

  const result = await response.json()

  if (result.code !== 0) {
    throw new Error(result.msg || 'Search adult videos failed')
  }

  return result.data
}

/**
 * 搜索用户
 */
export async function searchUsers(keyword: string, pageNo = 0, pageSize = 20) {
  const accessToken = await getAccessToken(false) // 可选认证

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  if (window.Telegram?.WebApp?.initData) {
    headers['X-Telegram-Init-Data'] = window.Telegram.WebApp.initData
  }

  const response = await fetch(
    `${APP_SERVER_URL}/search/users?keyword=${encodeURIComponent(keyword)}&pageNo=${pageNo}&pageSize=${pageSize}`,
    { headers }
  )

  if (!response.ok) {
    throw new Error(`Search users failed: ${response.status}`)
  }

  const result = await response.json()

  if (result.code !== 0) {
    throw new Error(result.msg || 'Search users failed')
  }

  return result.data
}

/**
 * 获取热门搜索词
 */
export async function getHotKeywords(limit = 30) {
  const response = await fetch(`${APP_SERVER_URL}/search/hot?limit=${limit}`, {
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`Get hot keywords failed: ${response.status}`)
  }

  const result = await response.json()

  if (result.code !== 0) {
    throw new Error(result.msg || 'Get hot keywords failed')
  }

  return result.data
}

/**
 * 获取搜索历史
 */
export async function getSearchHistory(limit = 10) {
  const accessToken = await getAccessToken(true) // 必须认证

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`
  }

  if (window.Telegram?.WebApp?.initData) {
    headers['X-Telegram-Init-Data'] = window.Telegram.WebApp.initData
  }

  const response = await fetch(`${APP_SERVER_URL}/search/history?limit=${limit}`, {
    headers
  })

  if (!response.ok) {
    throw new Error(`Get search history failed: ${response.status}`)
  }

  const result = await response.json()

  if (result.code !== 0) {
    throw new Error(result.msg || 'Get search history failed')
  }

  return result.data
}

/**
 * 删除搜索历史
 * @param keyword 要删除的关键词，如果不传则清空全部
 */
export async function deleteSearchHistory(keyword?: string) {
  const accessToken = await getAccessToken(true) // 必须认证

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`
  }

  if (window.Telegram?.WebApp?.initData) {
    headers['X-Telegram-Init-Data'] = window.Telegram.WebApp.initData
  }

  const url = keyword
    ? `${APP_SERVER_URL}/search/history?keyword=${encodeURIComponent(keyword)}`
    : `${APP_SERVER_URL}/search/history`

  const response = await fetch(url, {
    method: 'DELETE',
    headers
  })

  if (!response.ok) {
    throw new Error(`Delete search history failed: ${response.status}`)
  }

  const result = await response.json()

  if (result.code !== 0) {
    throw new Error(result.msg || 'Delete search history failed')
  }

  return result.data
}
