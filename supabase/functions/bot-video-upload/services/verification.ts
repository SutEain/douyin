import { supabase } from '../supabaseClient.ts'
import { checkRateLimit } from './rateLimit.ts'

/**
 * 生成 6 位数验证码（100000-999999）
 * 使用加密安全的随机数生成器
 */
function generateVerificationCode(): string {
  const min = 100000
  const max = 999999
  // 使用 Web Crypto API 生成加密安全的随机数
  const array = new Uint32Array(1)
  crypto.getRandomValues(array)
  const random = array[0] / (0xffffffff + 1)
  return String(Math.floor(random * (max - min + 1)) + min)
}

/**
 * 创建验证码并返回
 * @param tgUserId Telegram 用户 ID
 * @param tgUserInfo Telegram 用户信息
 * @returns 验证码字符串，如果失败返回 null
 */
export async function createVerificationCode(
  tgUserId: number,
  tgUserInfo?: { first_name?: string; last_name?: string; username?: string }
): Promise<string | null> {
  try {
    // 🎯 速率限制：每个用户每分钟最多生成 3 个验证码
    const rateLimitResult = await checkRateLimit(String(tgUserId), 'tg_user_id', 'generate', {
      maxAttempts: 3,
      windowMs: 60 * 1000, // 1 分钟
      lockDurationMs: 5 * 60 * 1000 // 超过限制锁定 5 分钟
    })

    if (!rateLimitResult.allowed) {
      const lockedMsg = rateLimitResult.lockedUntil
        ? `，已锁定至 ${new Date(rateLimitResult.lockedUntil).toLocaleTimeString()}`
        : ''
      console.warn(`[Verification] 速率限制：用户 ${tgUserId} 生成验证码过于频繁${lockedMsg}`)
      return null
    }

    // 生成验证码（确保唯一）
    let code: string
    let attempts = 0
    const maxAttempts = 10
    let isUnique = false

    while (!isUnique && attempts < maxAttempts) {
      code = generateVerificationCode()
      attempts++

      // 检查验证码是否已存在
      const { data: existing } = await supabase
        .from('verification_codes')
        .select('id')
        .eq('code', code)
        .maybeSingle()

      if (!existing) {
        isUnique = true // 找到唯一验证码
      }
    }

    if (!isUnique) {
      console.error('[Verification] 无法生成唯一验证码，尝试次数过多')
      return null
    }

    // 设置过期时间（5 分钟后）
    const expiresAt = new Date()
    expiresAt.setMinutes(expiresAt.getMinutes() + 5)

    // 插入验证码记录
    const { error } = await supabase
      .from('verification_codes')
      .insert({
        code,
        tg_user_id: tgUserId,
        tg_username: tgUserInfo?.username || null,
        tg_first_name: tgUserInfo?.first_name || null,
        tg_last_name: tgUserInfo?.last_name || null,
        expires_at: expiresAt.toISOString(),
        is_used: false
      })
      .select()
      .single()

    if (error) {
      console.error('[Verification] 创建验证码失败:', error)
      return null
    }

    console.log(`[Verification] 验证码已创建: ${code}, tg_user_id: ${tgUserId}`)
    return code
  } catch (error) {
    console.error('[Verification] 创建验证码异常:', error)
    return null
  }
}

/**
 * 验证验证码是否有效
 * @param code 验证码
 * @returns 验证码记录（包含 tg_user_id），如果无效返回 null
 */
export async function verifyCode(code: string): Promise<{
  id: string
  tg_user_id: number
  tg_username: string | null
  tg_first_name: string | null
  tg_last_name: string | null
} | null> {
  try {
    const { data, error } = await supabase
      .from('verification_codes')
      .select('id, tg_user_id, tg_username, tg_first_name, tg_last_name, expires_at, is_used')
      .eq('code', code)
      .maybeSingle()

    if (error) {
      console.error('[Verification] 查询验证码失败:', error)
      return null
    }

    if (!data) {
      console.log('[Verification] 验证码不存在:', code)
      return null
    }

    // 检查是否已使用
    if (data.is_used) {
      console.log('[Verification] 验证码已使用:', code)
      return null
    }

    // 检查是否过期
    const expiresAt = new Date(data.expires_at)
    if (expiresAt < new Date()) {
      console.log('[Verification] 验证码已过期:', code)
      return null
    }

    // 标记为已使用
    await supabase
      .from('verification_codes')
      .update({
        is_used: true,
        used_at: new Date().toISOString()
      })
      .eq('id', data.id)

    return {
      id: data.id,
      tg_user_id: data.tg_user_id,
      tg_username: data.tg_username,
      tg_first_name: data.tg_first_name,
      tg_last_name: data.tg_last_name
    }
  } catch (error) {
    console.error('[Verification] 验证验证码异常:', error)
    return null
  }
}
