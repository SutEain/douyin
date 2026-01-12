import { AuthBindings } from '@refinedev/core'
import { supabaseClient } from './supabaseClient'

export const authProvider: AuthBindings = {
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
      // 检查用户是否为审核员
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('is_reviewer, is_admin, nickname')
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

    if (error) {
      return {
        success: false,
        error: {
          name: '登出失败',
          message: error.message
        }
      }
    }

    return {
      success: true,
      redirectTo: '/login'
    }
  },
  check: async () => {
    const { data } = await supabaseClient.auth.getSession()
    const { session } = data

    if (!session) {
      return {
        authenticated: false,
        redirectTo: '/login',
        error: {
          message: '请先登录',
          name: '未登录'
        }
      }
    }

    // 检查用户是否为审核员
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('is_reviewer, is_admin')
      .eq('id', session.user.id)
      .single()

    if (!profile?.is_reviewer && !profile?.is_admin) {
      await supabaseClient.auth.signOut()
      return {
        authenticated: false,
        redirectTo: '/login',
        error: {
          message: '您没有访问审核后台的权限',
          name: '权限不足'
        }
      }
    }

    return {
      authenticated: true
    }
  },
  getPermissions: async () => {
    const { data } = await supabaseClient.auth.getUser()

    if (data?.user) {
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('is_reviewer, is_admin')
        .eq('id', data.user.id)
        .single()

      return profile?.is_admin ? 'admin' : 'reviewer'
    }

    return null
  },
  getIdentity: async () => {
    const { data } = await supabaseClient.auth.getUser()

    if (data?.user) {
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('nickname, username, avatar_url')
        .eq('id', data.user.id)
        .single()

      return {
        id: data.user.id,
        name: profile?.nickname || profile?.username || data.user.email || 'User',
        avatar: profile?.avatar_url
      }
    }

    return null
  },
  onError: async (error) => {
    console.error(error)
    return { error }
  }
}
