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

async function fetchFirstBytes(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxBytes: number
): Promise<{ res: Response; bytes: Uint8Array }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' })
    const reader = res.body?.getReader?.()
    if (!reader) return { res, bytes: new Uint8Array() }

    const chunks: Uint8Array[] = []
    let total = 0
    while (total < maxBytes) {
      const { value, done } = await reader.read()
      if (done) break
      if (value && value.length) {
        chunks.push(value)
        total += value.length
      }
    }

    // 读够就尽快断开，避免下载完整直播流
    try {
      await reader.cancel()
    } catch {
      /* noop */
    }
    try {
      controller.abort()
    } catch {
      /* noop */
    }

    const out = new Uint8Array(Math.min(total, maxBytes))
    let offset = 0
    for (const c of chunks) {
      const len = Math.min(c.length, out.length - offset)
      if (len <= 0) break
      out.set(c.subarray(0, len), offset)
      offset += len
    }
    return { res, bytes: out }
  } finally {
    clearTimeout(timer)
  }
}

function sniffBytes(buf: Uint8Array): { kind: 'flv' | 'mp4' | 'm3u8' | 'unknown'; detail: string } {
  if (!buf || buf.length === 0) return { kind: 'unknown', detail: 'empty' }

  // FLV 文件头：'FLV'
  if (buf.length >= 3 && buf[0] === 0x46 && buf[1] === 0x4c && buf[2] === 0x56) {
    return { kind: 'flv', detail: 'magic=FLV' }
  }

  // m3u8 常见以 '#EXTM3U' 开头（文本）
  if (buf.length >= 7) {
    const head = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 256)))
    if (head.startsWith('#EXTM3U')) return { kind: 'm3u8', detail: 'head=#EXTM3U' }
  }

  // MP4：一般是 [4 bytes size] + 'ftyp'
  if (buf.length >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return { kind: 'mp4', detail: 'box=ftyp' }
  }

  return { kind: 'unknown', detail: 'no_magic' }
}

function classifyM3U8Text(text: string): { ok: boolean; reason: string } {
  const t = (text || '').trim()
  const lower = t.toLowerCase()

  // 你的业务规则：默认 mp4/占位/广告测试 m3u8 视为离线
  if (t.includes('#EXT-X-ENDLIST')) return { ok: false, reason: 'vod:endlist' }
  if (lower.includes('#ext-x-playlist-type:vod')) return { ok: false, reason: 'vod:playlist_type' }

  // allinone 的“下播占位/测试”示例：jsdelivr + testvideo + playad*.ts
  if (lower.includes('cdn.jsdelivr.net/gh/feiyang666999/testvideo'))
    return { ok: false, reason: 'placeholder:testvideo' }
  if (lower.includes('/playad') || lower.includes('playad'))
    return { ok: false, reason: 'placeholder:playad' }

  // 默认认为是 live m3u8（没有 endlist 且非占位特征）
  return { ok: true, reason: 'live:m3u8' }
}

async function probeUrl(
  url: string
): Promise<{ ok: boolean; status: number; msg: string; contentType?: string; kind?: string }> {
  // ✅ 先 GET（不带 Range），更贴近真实播放请求：
  // - 有些源对 HEAD / Range 会返回 404，但普通 GET 可以返回 FLV
  // - 我们只读前 4KB 做 sniff，然后主动中断连接，避免下载整条流
  try {
    const { res, bytes } = await fetchFirstBytes(
      url,
      {
        method: 'GET',
        headers: {
          Accept: '*/*',
          'User-Agent': 'Mozilla/5.0 (probe)'
        }
      },
      8000,
      4096
    )
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    const ok = res.status >= 200 && res.status < 400
    if (!ok) return { ok: false, status: res.status, msg: `http_${res.status}`, contentType: ct }

    // ✅ 先 sniff 再参考 Content-Type：
    // 很多解析服务会“固定返回 video/x-flv”，但实际 body 可能是默认 mp4/错误页。
    // 你定义的规则里，mp4 必须判离线，因此 sniff 优先级最高。
    const sniff = sniffBytes(bytes)
    if (sniff.kind === 'flv')
      return { ok: true, status: res.status, msg: 'ok:flv(sniff)', contentType: ct, kind: 'flv' }
    if (sniff.kind === 'm3u8') {
      const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096)))
      const classified = classifyM3U8Text(text)
      if (classified.ok) {
        return {
          ok: true,
          status: res.status,
          msg: `ok:m3u8(sniff;${classified.reason})`,
          contentType: ct,
          kind: 'm3u8'
        }
      }
      return {
        ok: false,
        status: res.status,
        msg: `offline:m3u8(${classified.reason})`,
        contentType: ct,
        kind: 'm3u8'
      }
    }
    if (sniff.kind === 'mp4')
      return {
        ok: false,
        status: res.status,
        msg: 'offline:mp4(sniff)',
        contentType: ct,
        kind: 'mp4'
      }

    // sniff 不出来时，再用 Content-Type 做兜底判断
    if (ct.includes('video/mp4')) {
      return { ok: false, status: res.status, msg: 'offline:mp4(ct)', contentType: ct, kind: 'mp4' }
    }
    if (ct.includes('video/x-flv') || ct.includes('application/x-flv')) {
      return { ok: true, status: res.status, msg: 'ok:flv(ct)', contentType: ct, kind: 'flv' }
    }
    if (ct.includes('application/vnd.apple.mpegurl') || ct.includes('application/x-mpegurl')) {
      return { ok: true, status: res.status, msg: 'ok:m3u8(ct)', contentType: ct, kind: 'm3u8' }
    }

    // 兜底：未知类型按离线处理，避免误报在线
    return {
      ok: false,
      status: res.status,
      msg: `offline:unknown(${sniff.detail}${ct ? `;ct=${ct}` : ''})`,
      contentType: ct,
      kind: sniff.kind
    }
  } catch (e: any) {
    // GET 失败才回退 HEAD（有些源 GET 需要特殊条件，这里保底）
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: 'HEAD',
          headers: {
            Accept: '*/*',
            'User-Agent': 'Mozilla/5.0 (probe)'
          }
        },
        8000
      )
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      const ok = res.status >= 200 && res.status < 400
      if (!ok) return { ok: false, status: res.status, msg: `http_${res.status}`, contentType: ct }

      if (ct.includes('video/x-flv') || ct.includes('application/x-flv')) {
        return { ok: true, status: res.status, msg: 'ok:flv(head)', contentType: ct, kind: 'flv' }
      }
      if (ct.includes('application/vnd.apple.mpegurl') || ct.includes('application/x-mpegurl')) {
        return { ok: true, status: res.status, msg: 'ok:m3u8(head)', contentType: ct, kind: 'm3u8' }
      }
      if (ct.includes('video/mp4')) {
        return {
          ok: false,
          status: res.status,
          msg: 'offline:mp4(head)',
          contentType: ct,
          kind: 'mp4'
        }
      }
      return {
        ok: false,
        status: res.status,
        msg: `offline:unknown(head;ct=${ct || 'empty'})`,
        contentType: ct
      }
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
      const lastError = probed.ok
        ? null
        : `${probed.msg}${probed.contentType ? `;ct=${probed.contentType}` : ''}${probed.kind ? `;kind=${probed.kind}` : ''}`

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
