import { request } from '@/utils/request'
import { myVideo } from '@/api/videos'
import { supabase } from '@/utils/supabase'

export function userinfo(params?: any, data?: any) {
  return request({ url: '/user/userinfo', method: 'get', params, data })
}

export function userVideoList(params?: any) {
  return myVideo(params)
}

export function panel(params?: any, data?: any) {
  return request({ url: '/user/panel', method: 'get', params, data })
}

export function friends(params?: any, data?: any) {
  return request({ url: '/user/friends', method: 'get', params, data })
}

export function userCollect(params?: any, data?: any) {
  return request({ url: '/user/collect', method: 'get', params, data })
}

export function recommendedPost(params?: any, data?: any) {
  return request({ url: '/post/recommended', method: 'get', params, data })
}

export function recommendedShop(params?: any, data?: any) {
  return request({ url: '/shop/recommended', method: 'get', params, data })
}

// 获取关注列表
export async function getFollowingList() {
  const { data: session } = await supabase.auth.getSession()
  if (!session?.session?.user) {
    return { success: false, message: '未登录', data: { list: [], total: 0 } }
  }

  const { data, error } = await supabase
    .from('follows')
    .select(`
      followee_id,
      created_at,
      profiles:followee_id (
        id,
        nickname,
        username,
        avatar_url,
        bio
      )
    `)
    .eq('follower_id', session.session.user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getFollowingList] Error:', error)
    return { success: false, message: error.message, data: { list: [], total: 0 } }
  }

  const list = (data || []).map((item: any) => ({
    user_id: item.profiles?.id,
    nickname: item.profiles?.nickname || item.profiles?.username || '用户',
    unique_id: item.profiles?.username || '',
    avatar: item.profiles?.avatar_url || '',
    signature: item.profiles?.bio || '',
    followed_at: item.created_at
  }))

  return { success: true, data: { list, total: list.length } }
}

// 获取粉丝列表
export async function getFollowersList() {
  const { data: session } = await supabase.auth.getSession()
  if (!session?.session?.user) {
    return { success: false, message: '未登录', data: { list: [], total: 0 } }
  }

  const { data, error } = await supabase
    .from('follows')
    .select(`
      follower_id,
      created_at,
      profiles:follower_id (
        id,
        nickname,
        username,
        avatar_url,
        bio
      )
    `)
    .eq('followee_id', session.session.user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getFollowersList] Error:', error)
    return { success: false, message: error.message, data: { list: [], total: 0 } }
  }

  const list = (data || []).map((item: any) => ({
    user_id: item.profiles?.id,
    nickname: item.profiles?.nickname || item.profiles?.username || '用户',
    unique_id: item.profiles?.username || '',
    avatar: item.profiles?.avatar_url || '',
    signature: item.profiles?.bio || '',
    followed_at: item.created_at
  }))

  return { success: true, data: { list, total: list.length } }
}
