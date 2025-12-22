import { supabaseAdmin } from '../lib/env.ts'
import { successResponse, errorResponse } from '../../_shared/response.ts'
import { requireAuth, parseJsonBody, HttpError } from '../lib/auth.ts'

export async function handleLiveRooms(req: Request): Promise<Response> {
  try {
    // 仅返回启用的直播间，用于前端展示（不要求登录）
    const { data, error } = await supabaseAdmin
      .from('live_rooms')
      .select('id, title, description, stream_url, cover_url, sort_order, is_active, updated_at')
      .eq('is_active', true)
      .order('sort_order', { ascending: false })
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('[live_rooms] query error:', error)
      return errorResponse('加载直播间失败', 1, 500)
    }

    return successResponse({ list: data ?? [] })
  } catch (e) {
    console.error('[live_rooms] unexpected error:', e)
    return errorResponse('Internal server error', 1, 500)
  }
}

type ProbeReqBody = {
  ids?: string[]
  id?: string
}

function isAdminUser(user: any): boolean {
  return user?.app_metadata?.role === 'admin'
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' })
  } finally {
    clearTimeout(timer)
  }
}

async function probeUrl(url: string): Promise<{ ok: boolean; status: number; msg: string }> {
  // 先 HEAD，部分源不支持再 GET 一小段
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (probe)'
        }
      },
      8000
    )
    const ok = res.status >= 200 && res.status < 400
    return { ok, status: res.status, msg: ok ? 'ok' : `http_${res.status}` }
  } catch (e: any) {
    // HEAD 可能被拒绝，尝试 GET
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            Range: 'bytes=0-1',
            'User-Agent': 'Mozilla/5.0 (probe)'
          }
        },
        8000
      )
      const ok = res.status >= 200 && res.status < 400
      return { ok, status: res.status, msg: ok ? 'ok' : `http_${res.status}` }
    } catch (e2: any) {
      const name = e2?.name || e?.name || 'Error'
      const message = e2?.message || e?.message || 'fetch failed'
      return { ok: false, status: 0, msg: `${name}: ${message}` }
    }
  }
}

export async function handleLiveRoomsProbe(req: Request): Promise<Response> {
  try {
    const { user } = await requireAuth(req)
    if (!isAdminUser(user)) {
      throw new HttpError('Forbidden', 403)
    }

    const body = await parseJsonBody<ProbeReqBody>(req)
    const ids = Array.isArray(body?.ids) ? body.ids : body?.id ? [body.id] : []
    const uniqIds = Array.from(new Set(ids.filter(Boolean)))
    if (!uniqIds.length) {
      return errorResponse('缺少 ids', 1, 400)
    }

    const { data: rooms, error: qErr } = await supabaseAdmin
      .from('live_rooms')
      .select('id, stream_url, check_count')
      .in('id', uniqIds)

    if (qErr) {
      console.error('[live_rooms_probe] query error:', qErr)
      return errorResponse('查询直播间失败', 1, 500)
    }

    const nowIso = new Date().toISOString()
    const results: any[] = []

    for (const r of rooms ?? []) {
      const url = (r as any).stream_url as string | null
      if (!url) {
        // 没填 stream_url 的直接标 unknown
        console.log('[live_rooms_probe] missing stream_url, id=', (r as any).id)
        const { error: uErr } = await supabaseAdmin
          .from('live_rooms')
          .update({
            status: 'unknown',
            last_checked_at: nowIso,
            check_count: ((r as any).check_count ?? 0) + 1,
            last_error: 'stream_url 为空'
          })
          .eq('id', (r as any).id)
        if (uErr) console.error('[live_rooms_probe] update error:', uErr)
        results.push({ id: (r as any).id, ok: false, status: 'unknown', error: 'stream_url 为空' })
        continue
      }

      console.log('[live_rooms_probe] probing', { id: (r as any).id, url })
      const probed = await probeUrl(url)
      const nextStatus = probed.ok ? 'online' : 'offline'
      const lastError = probed.ok ? null : probed.msg

      const { error: uErr } = await supabaseAdmin
        .from('live_rooms')
        .update({
          status: nextStatus,
          last_checked_at: nowIso,
          check_count: ((r as any).check_count ?? 0) + 1,
          last_error: lastError
        })
        .eq('id', (r as any).id)

      if (uErr) {
        console.error('[live_rooms_probe] update error:', uErr)
      }

      results.push({
        id: (r as any).id,
        ok: probed.ok,
        http_status: probed.status,
        status: nextStatus,
        error: lastError
      })
    }

    return successResponse({ results })
  } catch (e) {
    if (e instanceof HttpError) {
      return errorResponse(e.message, 1, e.status)
    }
    console.error('[live_rooms_probe] unexpected error:', e)
    return errorResponse('Internal server error', 1, 500)
  }
}
