import { successResponse, errorResponse } from '../../_shared/response.ts'
import { supabaseAdmin } from '../lib/env.ts'
import { HttpError, getClientIp } from '../lib/auth.ts'
import { checkRateLimit } from '../lib/rateLimit.ts'

/**
 * 🔥 后台管理员登录（带频率限制）
 * 防止暴力破解攻击
 */
export async function handleAdminLogin(req: Request): Promise<Response> {
  try {
    const body = await req.json()
    const { email, password } = body

    if (!email || !password) {
      return errorResponse('Email and password are required', 1, 400)
    }

    // 🔥 先检查 IP 黑名单
    const clientIp = getClientIp(req) || 'unknown'
    if (clientIp !== 'unknown') {
      const { data: isBanned } = await supabaseAdmin.rpc('is_ip_banned', {
        p_ip_address: clientIp
      })
      if (isBanned === true) {
        console.warn(`[ADMIN_LOGIN_BLOCKED] 封禁的 IP 尝试登录: ${clientIp}`)
        return errorResponse('Forbidden', 1, 403)
      }
    }

    // 🔥 Edge Function 层面的频率限制（备用保护，如果 Supabase 平台限制没生效）
    const rateLimitResult = await checkRateLimit(clientIp, 'ip', 'admin_login', {
      maxAttempts: 2, // 10秒内最多2次登录尝试
      windowMs: 10000, // 10秒窗口
      lockDurationMs: undefined // 不锁定，直接永久封禁
    })

    if (!rateLimitResult.allowed) {
      // 🔥 直接永久封禁 IP（不临时锁定）
      try {
        const { autoBanIp } = await import('./ipBlacklist.ts')
        await autoBanIp(clientIp, '后台登录尝试过于频繁（10秒内超过2次），已永久封禁', null) // null 表示永久封禁
        console.warn(`[ADMIN_LOGIN_ATTACK] IP ${clientIp} 登录尝试过于频繁，已永久封禁`)
      } catch (banError) {
        console.error('[ADMIN_LOGIN_ATTACK] 自动封禁失败:', banError)
      }

      return errorResponse(`登录尝试过于频繁，您的 IP 已被永久封禁`, 1, 403)
    }

    // 🔥 尝试登录
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      // 🔥 记录登录失败日志（详细错误只在服务器日志中）
      console.warn(`[ADMIN_LOGIN_FAILED] IP: ${clientIp}, Email: ${email}, Error: ${error.message}`)
      return errorResponse('Authentication failed', 1, 401)
    }

    if (!data?.user) {
      console.warn(`[ADMIN_LOGIN_FAILED] IP: ${clientIp}, Email: ${email}, No user data`)
      return errorResponse('Authentication failed', 1, 401)
    }

    // 🔥 检查是否是管理员
    const role = data.user.app_metadata?.role
    if (role !== 'admin') {
      console.warn(`[ADMIN_LOGIN_UNAUTHORIZED] IP: ${clientIp}, Email: ${email}, Role: ${role}`)
      // 登出非管理员用户
      await supabaseAdmin.auth.signOut()
      return errorResponse('Forbidden', 1, 403)
    }

    // 🔥 登录成功，记录日志
    console.log(`[ADMIN_LOGIN_SUCCESS] IP: ${clientIp}, Email: ${email}, User ID: ${data.user.id}`)

    return successResponse({
      user: {
        id: data.user.id,
        email: data.user.email,
        role: role
      },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in: data.session.expires_in
      }
    })
  } catch (error: any) {
    console.error('[ADMIN_LOGIN_ERROR]', error)
    return errorResponse('Internal server error', 1, 500)
  }
}
