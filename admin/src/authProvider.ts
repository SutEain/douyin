import type { AuthProvider } from '@refinedev/core'
import { supabaseClient } from './supabaseClient'

export const authProvider: AuthProvider = {
  login: async ({ email, password }: { email: string; password: string }) => {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      return {
        success: false,
        error
      }
    }

    if (data?.user) {
      // 🎯 检查是否是管理员
      const role = data.user.app_metadata?.role
      if (role !== 'admin') {
        // 不是管理员，登出
        await supabaseClient.auth.signOut()
        return {
          success: false,
          error: {
            name: 'PermissionError',
            message: '您没有管理员权限'
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
        name: 'LoginError',
        message: '登录失败'
      }
    }
  },
  logout: async () => {
    const { error } = await supabaseClient.auth.signOut()

    if (error) {
      return {
        success: false,
        error
      }
    }

    return {
      success: true,
      redirectTo: '/login'
    }
  },
  check: async () => {
    try {
      const { data } = await supabaseClient.auth.getSession()
      const { session } = data

      if (!session) {
        return {
          authenticated: false,
          redirectTo: '/login',
          logout: true
        }
      }

      // 🎯 检查管理员权限
      const role = session.user?.app_metadata?.role
      if (role !== 'admin') {
        return {
          authenticated: false,
          error: { message: '无管理员权限', name: 'PermissionError' },
          logout: true,
          redirectTo: '/login'
        }
      }

      return {
        authenticated: true
      }
    } catch (error: unknown) {
      const err = (error as Error) || new Error('检查认证失败')
      return {
        authenticated: false,
        error: err,
        logout: true,
        redirectTo: '/login'
      }
    }
  },
  getPermissions: async () => {
    const { data } = await supabaseClient.auth.getUser()
    return data?.user?.app_metadata?.role || 'user'
  },
  getIdentity: async () => {
    const { data } = await supabaseClient.auth.getUser()

    if (data?.user) {
      return {
        ...data.user,
        name: data.user.email,
        role: data.user.app_metadata?.role
      }
    }

    return null
  },
  onError: async (error: any) => {
    if (error?.code === 'PGRST301') {
      return {
        logout: true
      }
    }

    return { error }
  }
}
