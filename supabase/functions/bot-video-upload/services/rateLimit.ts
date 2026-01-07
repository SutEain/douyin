import { supabase } from '../supabaseClient.ts'

export interface RateLimitConfig {
  maxAttempts: number // 最大尝试次数
  windowMs: number // 时间窗口（毫秒）
  lockDurationMs?: number // 锁定时长（毫秒），可选
}

/**
 * 检查速率限制（Bot 端）
 */
export async function checkRateLimit(
  identifier: string,
  type: 'ip' | 'tg_user_id',
  action: 'generate' | 'verify',
  config: RateLimitConfig
): Promise<{ allowed: boolean; remainingAttempts: number; lockedUntil: Date | null }> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - config.windowMs)

  const { data: rateLimit, error: fetchError } = await supabase
    .from('verification_rate_limits')
    .select('*')
    .eq('identifier', identifier)
    .eq('type', type)
    .eq('action', action)
    .maybeSingle()

  if (fetchError && fetchError.code !== 'PGRST116') {
    console.error('[RateLimit] 查询速率限制失败:', fetchError)
    return { allowed: true, remainingAttempts: config.maxAttempts, lockedUntil: null }
  }

  if (rateLimit?.locked_until) {
    const lockedUntil = new Date(rateLimit.locked_until)
    if (lockedUntil > now) {
      return {
        allowed: false,
        remainingAttempts: 0,
        lockedUntil: lockedUntil
      }
    }
  }

  const firstAttemptAt = rateLimit?.first_attempt_at ? new Date(rateLimit.first_attempt_at) : now

  let attemptCount = 0
  if (firstAttemptAt >= windowStart) {
    attemptCount = rateLimit?.attempt_count || 0
  }

  const updateData: any = {
    identifier,
    type,
    action,
    attempt_count: attemptCount + 1,
    last_attempt_at: now.toISOString(),
    locked_until: null
  }

  if (!rateLimit || firstAttemptAt < windowStart) {
    updateData.first_attempt_at = now.toISOString()
    attemptCount = 0
  }

  if (attemptCount >= config.maxAttempts) {
    if (config.lockDurationMs) {
      const lockedUntil = new Date(now.getTime() + config.lockDurationMs)
      updateData.locked_until = lockedUntil.toISOString()
      await supabase.from('verification_rate_limits').upsert(updateData, {
        onConflict: 'identifier,type,action'
      })
      return {
        allowed: false,
        remainingAttempts: 0,
        lockedUntil: lockedUntil
      }
    } else {
      await supabase.from('verification_rate_limits').upsert(updateData, {
        onConflict: 'identifier,type,action'
      })
      return {
        allowed: false,
        remainingAttempts: 0,
        lockedUntil: null
      }
    }
  }

  await supabase.from('verification_rate_limits').upsert(updateData, {
    onConflict: 'identifier,type,action'
  })

  return {
    allowed: true,
    remainingAttempts: config.maxAttempts - attemptCount - 1,
    lockedUntil: null
  }
}
