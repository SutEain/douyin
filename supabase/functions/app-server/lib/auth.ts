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

  if (error || !user) {
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
  const pageNo = Math.max(parseInt(url.searchParams.get('pageNo') ?? String(defaults.pageNo), 10), 0)
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

