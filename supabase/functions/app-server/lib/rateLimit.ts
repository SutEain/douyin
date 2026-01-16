import { supabaseAdmin } from './env.ts'

export interface RateLimitConfig {
  maxAttempts: number // 最大尝试次数
  windowMs: number // 时间窗口（毫秒）
  lockDurationMs?: number // 锁定时长（毫秒），可选
}

/**
 * 检查速率限制
 * @param identifier 标识符（IP 地址或用户 ID）
 * @param type 类型：'ip' 或 'tg_user_id'
 * @param action 操作类型：'generate' 或 'verify'
 * @param config 速率限制配置
 * @returns { allowed: boolean, remainingAttempts: number, lockedUntil: Date | null }
 */
export async function checkRateLimit(
  identifier: string,
  type: 'ip' | 'tg_user_id',
  action: 'generate' | 'verify' | 'claim_watch_time' | string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remainingAttempts: number; lockedUntil: Date | null }> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - config.windowMs)

  // 查询或创建速率限制记录
  const { data: rateLimit, error: fetchError } = await supabaseAdmin
    .from('verification_rate_limits')
    .select('*')
    .eq('identifier', identifier)
    .eq('type', type)
    .eq('action', action)
    .maybeSingle()

  if (fetchError && fetchError.code !== 'PGRST116') {
    // PGRST116 是"未找到"错误，可以忽略
    console.error('[RateLimit] 查询速率限制失败:', fetchError)
    // 出错时默认允许（避免误伤）
    return { allowed: true, remainingAttempts: config.maxAttempts, lockedUntil: null }
  }

  // 检查是否被锁定
  if (rateLimit?.locked_until) {
    const lockedUntil = new Date(rateLimit.locked_until)
    if (lockedUntil > now) {
      return {
        allowed: false,
        remainingAttempts: 0,
        lockedUntil: lockedUntil
      }
    }
    // 锁定已过期，清除锁定
  }

  // 计算时间窗口内的尝试次数
  const firstAttemptAt = rateLimit?.first_attempt_at ? new Date(rateLimit.first_attempt_at) : now

  // 如果第一次尝试不在时间窗口内，重置计数
  let attemptCount = 0
  if (firstAttemptAt >= windowStart) {
    attemptCount = rateLimit?.attempt_count || 0
  }

  // 更新或创建记录
  const updateData: any = {
    identifier,
    type,
    action,
    attempt_count: attemptCount + 1,
    last_attempt_at: now.toISOString(),
    locked_until: null
  }

  // 如果是第一次尝试，设置 first_attempt_at
  if (!rateLimit || firstAttemptAt < windowStart) {
    updateData.first_attempt_at = now.toISOString()
    attemptCount = 0
  }

  // 如果超过限制，设置锁定
  if (attemptCount >= config.maxAttempts) {
    if (config.lockDurationMs) {
      const lockedUntil = new Date(now.getTime() + config.lockDurationMs)
      updateData.locked_until = lockedUntil.toISOString()
      await supabaseAdmin.from('verification_rate_limits').upsert(updateData, {
        onConflict: 'identifier,type,action'
      })
      return {
        allowed: false,
        remainingAttempts: 0,
        lockedUntil: lockedUntil
      }
    } else {
      // 没有锁定配置，只拒绝请求
      await supabaseAdmin.from('verification_rate_limits').upsert(updateData, {
        onConflict: 'identifier,type,action'
      })
      return {
        allowed: false,
        remainingAttempts: 0,
        lockedUntil: null
      }
    }
  }

  // 更新记录
  await supabaseAdmin.from('verification_rate_limits').upsert(updateData, {
    onConflict: 'identifier,type,action'
  })

  return {
    allowed: true,
    remainingAttempts: config.maxAttempts - attemptCount - 1,
    lockedUntil: null
  }
}
