import { supabaseAdmin } from './env.ts'

export class HttpError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

interface AuthOptions {
  withProfile?: boolean
}

/**
 * 🎯 获取客户端真实 IP
 */
export function getClientIp(req: Request): string | null {
  return (
    req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null
  )
}

/**
 * 🎯 校验管理员 IP 白名单
 * ⚠️ 临时禁用：暂时无法固定IP，已临时取消IP白名单限制
 */
export async function checkAdminIpWhitelist(req: Request) {
  // 🚨 临时禁用IP白名单检查
  console.warn(`[IP_WHITELIST] ⚠️ 警告：IP 白名单检查已临时禁用`)
  return

  // 以下代码暂时被禁用，需要时取消注释即可恢复
  /*
  const ip = getClientIp(req)
  if (!ip) return // 无法获取 IP 时不拦截 (边缘情况)

  // 从环境变量或数据库读取白名单 (优先 Secret)
  let whitelistStr = Deno.env.get('ADMIN_IP_WHITELIST')
  if (!whitelistStr) {
    const { data: setting } = await supabaseAdmin
      .from('system_settings')
      .select('value_text')
      .eq('id', 'admin_ip_whitelist')
      .maybeSingle()
    whitelistStr = setting?.value_text
  }

  // 🚨 安全加固：如果未配置白名单，默认拒绝（必须显式配置）
  if (!whitelistStr || whitelistStr.trim() === '') {
    console.warn(`[IP_BLOCK] 管理员访问被拒绝：IP=${ip}，原因：未配置 IP 白名单`)
    throw new HttpError(
      `管理员访问被拒绝：未配置 IP 白名单。请联系系统管理员配置 ADMIN_IP_WHITELIST。`,
      403
    )
  }

  // 如果配置为 '*'，则放行所有 IP（不推荐，仅用于开发环境）
  if (whitelistStr.trim() === '*') {
    console.warn(`[IP_WHITELIST] ⚠️ 警告：IP 白名单配置为 '*'，允许所有 IP 访问管理员接口`)
    return
  }

  const whitelist = whitelistStr
    .split(',')
    .map((i) => i.trim())
    .filter(Boolean)
  if (!whitelist.includes(ip)) {
    console.warn(`[IP_BLOCK] 非法访问尝试: IP=${ip}`)
    throw new HttpError(`您的 IP (${ip}) 不在白名单中，拒绝访问。`, 403)
  }
  */
}

/**
 * 🎯 强制要求管理员权限 (含 IP 校验)
 * 逻辑：
 * 1. 必须有有效的 JWT 会话
 * 2. 判定顺序：JWT Metadata -> 数据库 Profile 标记
 */
export async function requireAdminAuth(req: Request) {
  // 1. 获取基础 Auth 信息 (先不强制要求 Profile，防止 Profile not found 报错)
  const { user } = await requireAuth(req, { withProfile: false })

  let isAdmin = false
  let profile = null

  // 判定 A: 检查 JWT Metadata (最快、最直接)
  if (user?.app_metadata?.role === 'admin') {
    isAdmin = true
  }

  // 无论 Metadata 是否命中，都尝试拿一下 Profile 数据 (供后续逻辑使用)
  const { data: profileData } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  profile = profileData

  // 判定 B: 如果 Metadata 没中，查数据库 Profile 标记 (兼容性)
  if (!isAdmin && profile?.is_admin === true) {
    isAdmin = true
  }

  if (!isAdmin) {
    console.warn(
      `[UNAUTHORIZED_ADMIN_ACCESS] 用户试图访问管理接口: ID=${user.id}, Email=${user.email}`
    )
    throw new HttpError('Forbidden: Admin access required', 403)
  }

  // 🎯 执行 IP 白名单校验
  await checkAdminIpWhitelist(req)

  return { user, profile }
}

export async function requireAuth(req: Request, options: AuthOptions = {}) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HttpError('Missing authorization header', 401)
  }
  const accessToken = authHeader.replace(/Bearer\s+/i, '').trim()
  if (!accessToken) {
    throw new HttpError('Missing authorization header', 401)
  }

  const {
    data: { user },
    error
  } = await supabaseAdmin.auth.getUser(accessToken)

  if (error || !user || !user.id || user.id === 'undefined') {
    throw new HttpError('Invalid session', 401)
  }

  let profile = null
  if (options.withProfile) {
    const { data: profileData, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError || !profileData) {
      throw new HttpError('Profile not found', 404)
    }

    // 🎯 拦截封禁用户：禁止其进行任何需要 Profile 的写操作或核心操作
    if (profileData.is_banned) {
      const reason = profileData.ban_reason || '账号由于违反社区规范已被封禁'
      throw new HttpError(`Forbidden: ${reason}`, 403)
    }

    profile = profileData
  }

  return { accessToken, user, profile }
}

export async function tryGetAuth(req: Request, options: AuthOptions = {}) {
  try {
    return await requireAuth(req, options)
  } catch {
    return { accessToken: null, user: null, profile: null }
  }
}

export function parsePagination(url: URL, defaults = { pageNo: 0, pageSize: 15 }) {
  const pageNo = Math.max(
    parseInt(url.searchParams.get('pageNo') ?? String(defaults.pageNo), 10),
    0
  )
  const pageSize = Math.min(
    Math.max(parseInt(url.searchParams.get('pageSize') ?? String(defaults.pageSize), 10), 1),
    50
  )
  const from = pageNo * pageSize
  const to = from + pageSize - 1
  return { pageNo, pageSize, from, to }
}

export async function parseJsonBody<T = any>(req: Request): Promise<T> {
  try {
    return await req.json()
  } catch {
    throw new HttpError('Invalid request body', 400)
  }
}
