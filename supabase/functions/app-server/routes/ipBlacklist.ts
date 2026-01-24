import { successResponse, errorResponse } from '../../_shared/response.ts'
import { supabaseAdmin } from '../lib/env.ts'
import { requireAdminAuth, parseJsonBody, HttpError } from '../lib/auth.ts'

/**
 * 🔥 添加 IP 到黑名单
 */
export async function handleAddIpToBlacklist(req: Request): Promise<Response> {
  try {
    const { user } = await requireAdminAuth(req)
    const body = await parseJsonBody<{
      ip_address: string
      reason?: string
      expires_at?: string | null // ISO 8601 格式，null 表示永久封禁
      permanent?: boolean // 是否永久封禁（如果为 true，忽略 expires_at）
    }>(req)

    const { ip_address, reason, expires_at, permanent } = body

    if (!ip_address || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip_address)) {
      return errorResponse('Invalid IP address', 1, 400)
    }

    // 检查是否已存在
    const { data: existing } = await supabaseAdmin
      .from('ip_blacklist')
      .select('id, is_active')
      .eq('ip_address', ip_address)
      .maybeSingle()

    if (existing) {
      // 如果已存在但未激活，重新激活
      if (!existing.is_active) {
        const { error: updateError } = await supabaseAdmin
          .from('ip_blacklist')
          .update({
            is_active: true,
            reason: reason || existing.reason,
            expires_at: permanent === true ? null : expires_at || null, // 永久封禁时设为 null
            banned_by: user.id,
            banned_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)

        if (updateError) throw updateError

        console.log(`[IP_BLACKLIST] 重新激活 IP 封禁: ${ip_address} by ${user.id}`)
        return successResponse({ message: 'IP 已重新添加到黑名单' })
      } else {
        return errorResponse('IP 已在黑名单中', 1, 400)
      }
    }

    // 添加新的封禁记录
    const finalExpiresAt = permanent === true ? null : expires_at || null // 永久封禁时设为 null
    const { data, error } = await supabaseAdmin
      .from('ip_blacklist')
      .insert({
        ip_address,
        reason: reason || '管理员手动封禁',
        banned_by: user.id,
        expires_at: finalExpiresAt, // null 表示永久封禁
        is_active: true
      })
      .select()
      .single()

    if (error) throw error

    const banType = finalExpiresAt
      ? `临时封禁（${new Date(finalExpiresAt).toLocaleString()} 过期）`
      : '永久封禁'
    console.log(
      `[IP_BLACKLIST] 添加 IP 到黑名单: ${ip_address} by ${user.id}, reason: ${reason || '管理员手动封禁'}, 类型: ${banType}`
    )
    return successResponse({
      data: { ...data, ban_type: finalExpiresAt ? 'temporary' : 'permanent' },
      message: `IP 已添加到黑名单（${banType}）`
    })
  } catch (error: any) {
    console.error('[IP_BLACKLIST] 添加失败:', error)
    return errorResponse(error.message || 'Failed to add IP to blacklist', 1, 500)
  }
}

/**
 * 🔥 从黑名单移除 IP
 */
export async function handleRemoveIpFromBlacklist(req: Request): Promise<Response> {
  try {
    const { user } = await requireAdminAuth(req)
    const body = await parseJsonBody<{ ip_address: string }>(req)

    const { ip_address } = body

    if (!ip_address) {
      return errorResponse('IP address is required', 1, 400)
    }

    // 标记为非激活而不是删除（保留历史记录）
    const { error } = await supabaseAdmin
      .from('ip_blacklist')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('ip_address', ip_address)

    if (error) throw error

    console.log(`[IP_BLACKLIST] 移除 IP 黑名单: ${ip_address} by ${user.id}`)
    return successResponse({ message: 'IP 已从黑名单移除' })
  } catch (error: any) {
    console.error('[IP_BLACKLIST] 移除失败:', error)
    return errorResponse(error.message || 'Failed to remove IP from blacklist', 1, 500)
  }
}

/**
 * 🔥 获取黑名单列表
 */
export async function handleGetIpBlacklist(req: Request): Promise<Response> {
  try {
    const { user } = await requireAdminAuth(req)
    const url = new URL(req.url)
    const activeOnly = url.searchParams.get('active_only') === 'true'

    let query = supabaseAdmin
      .from('ip_blacklist')
      .select('*, banned_by_profile:profiles!ip_blacklist_banned_by_fkey(id, nickname, email)')
      .order('banned_at', { ascending: false })

    if (activeOnly) {
      query = query
        .eq('is_active', true)
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
    }

    const { data, error } = await query

    if (error) throw error

    return successResponse({ data })
  } catch (error: any) {
    console.error('[IP_BLACKLIST] 获取失败:', error)
    return errorResponse(error.message || 'Failed to get IP blacklist', 1, 500)
  }
}

/**
 * 🔥 自动封禁 IP（当检测到攻击时）
 * @param ip IP 地址
 * @param reason 封禁原因
 * @param durationHours 封禁时长（小时），0 或 null 表示永久封禁
 */
export async function autoBanIp(
  ip: string,
  reason: string,
  durationHours: number | null = 24
): Promise<boolean> {
  try {
    // 检查是否已存在
    const { data: existing } = await supabaseAdmin
      .from('ip_blacklist')
      .select('id, is_active')
      .eq('ip_address', ip)
      .maybeSingle()

    if (existing && existing.is_active) {
      // 已存在且激活，不需要重复添加
      return true
    }

    // 🔥 如果 durationHours 为 0 或 null，表示永久封禁
    const expiresAt =
      durationHours && durationHours > 0
        ? (() => {
            const date = new Date()
            date.setHours(date.getHours() + durationHours)
            return date.toISOString()
          })()
        : null

    if (existing) {
      // 重新激活
      await supabaseAdmin
        .from('ip_blacklist')
        .update({
          is_active: true,
          reason: reason,
          expires_at: expiresAt,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
    } else {
      // 添加新记录
      await supabaseAdmin.from('ip_blacklist').insert({
        ip_address: ip,
        reason: reason,
        expires_at: expiresAt, // null 表示永久封禁
        is_active: true
      })
    }

    const banDuration = expiresAt ? `${durationHours} 小时` : '永久'
    console.log(`[IP_BLACKLIST] 自动封禁 IP: ${ip}, reason: ${reason}, 封禁时长: ${banDuration}`)
    return true
  } catch (error: any) {
    console.error('[IP_BLACKLIST] 自动封禁失败:', error)
    return false
  }
}
