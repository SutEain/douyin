import type { AuthProvider } from '@refinedev/core'
import { supabaseClient } from './supabaseClient'

export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      return {
        success: false,
        error: {
          name: '登录失败',
          message: error.message
        }
      }
    }

    if (data?.user) {
      // 🎯 检查是否是审核员或管理员
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('is_reviewer, is_admin')
        .eq('id', data.user.id)
        .single()

      if (!profile?.is_reviewer && !profile?.is_admin) {
        await supabaseClient.auth.signOut()
        return {
          success: false,
          error: {
            name: '权限不足',
            message: '您没有访问审核后台的权限'
          }
        }
      }

      return {
        success: true,
        redirectTo: '/'
      }
    }

    return {
      success: false,
      error: {
        name: '登录失败',
        message: '未知错误'
      }
    }
  },
  logout: async () => {
    const { error } = await supabaseClient.auth.signOut()
    if (error) return { success: false, error }
    return { success: true, redirectTo: '/login' }
  },
  check: async () => {
    const { data } = await supabaseClient.auth.getSession()
    const session = data?.session

    if (!session) {
      return {
        authenticated: false,
        redirectTo: '/login'
      }
    }

    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('is_reviewer, is_admin')
      .eq('id', session.user.id)
      .single()

    if (!profile?.is_reviewer && !profile?.is_admin) {
      return {
        authenticated: false,
        error: { message: '权限不足', name: 'PermissionError' },
        redirectTo: '/login'
      }
    }

    return { authenticated: true }
  },
  getPermissions: async () => {
    const { data } = await supabaseClient.auth.getUser()
    if (!data?.user) return null
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('is_reviewer, is_admin')
      .eq('id', data.user.id)
      .single()
    return profile?.is_admin ? 'admin' : 'reviewer'
  },
  getIdentity: async () => {
    const { data } = await supabaseClient.auth.getUser()
    if (!data?.user) return null
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('nickname, username, avatar_url')
      .eq('id', data.user.id)
      .single()

    return {
      ...data.user,
      name: profile?.nickname || profile?.username || data.user.email,
      avatar: profile?.avatar_url
    }
  },
  onError: async (error: any) => {
    if (error?.code === 'PGRST301') return { logout: true }
    return { error }
  }
}

