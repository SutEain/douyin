import { supabaseAdmin } from '../lib/env.ts'
import { successResponse, errorResponse } from '../../_shared/response.ts'
import { requireAuth, requireAdminAuth, parseJsonBody, HttpError } from '../lib/auth.ts'

export async function handleLiveRoomDetail(req: Request): Promise<Response> {
  console.log('[live_detail] Request received:', req.url)
  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    console.log('[live_detail] Searching for room ID:', id)
    if (!id) throw new HttpError('Missing id', 400)

    // 1. 先尝试从自建直播表找
    const { data: selfRoom, error: selfError } = await supabaseAdmin
      .from('live_broadcast_rooms')
      .select(
        `
        id, title, status, viewer_count, custom_viewer_count, stream_key, anchor_id,
        node:live_broadcast_nodes(domain_name),
        anchor:profiles(id, nickname, avatar_url)
      `
      )
      .eq('id', id)
      .maybeSingle()

    if (selfError) {
      console.error('[live_detail] selfRoom query error:', selfError)
    }

    if (selfRoom) {
      console.log('[live_detail] Found in self-hosted:', selfRoom.id)
      // 🎯 优先使用自定义人数，如果没有则使用真实人数
      const displayViewerCount = selfRoom.custom_viewer_count ?? selfRoom.viewer_count ?? 0
      return successResponse({
        room: {
          id: selfRoom.id,
          title: selfRoom.title,
          status: selfRoom.status,
          viewer_count: displayViewerCount,
          real_viewer_count: selfRoom.viewer_count ?? 0, // 保留真实人数供后台查看
          custom_viewer_count: selfRoom.custom_viewer_count ?? null, // 🎯 返回自定义人数，前端需要知道是否有自定义
          stream_url: `https://${selfRoom.node?.domain_name}/LiveApp/streams/${selfRoom.stream_key}.m3u8`,
          cover_url: selfRoom.anchor?.avatar_url,
          is_self_hosted: true,
          anchor_id: selfRoom.anchor_id,
          anchor_info: selfRoom.anchor
        }
      })
    }

    // 2. 如果没找到，尝试从转播间表找
    const { data: externalRoom, error: externalError } = await supabaseAdmin
      .from('live_rooms')
      .select('id, title, description, stream_url, cover_url, status, last_checked_at')
      .eq('id', id)
      .maybeSingle()

    if (externalError) {
      console.error('[live_detail] externalRoom query error:', externalError)
    }

    if (externalRoom) {
      console.log(
        '[live_detail] Found in external:',
        externalRoom.id,
        'status:',
        externalRoom.status
      )

      // 🎯 核心优化：针对外部转播源进行实时“去广告/去占位”检测
      // 如果状态不是 online，或者距离上次检查超过 1 分钟，则进行快速探测
      let currentStatus = externalRoom.status || 'unknown'
      const lastChecked = (externalRoom as any).last_checked_at
        ? new Date((externalRoom as any).last_checked_at).getTime()
        : 0
      const now = Date.now()

      if (currentStatus !== 'online' || now - lastChecked > 60000) {
        console.log('[live_detail] Status outdated or not online, probing now...')
        const probed = await probeUrl(externalRoom.stream_url)
        currentStatus = probed.ok ? 'online' : 'offline'

        // 🎯 业务逻辑：如果探测到没开播，直接关闭该直播间 (is_active = false)
        // 这样其他用户在列表里就刷不到这个直播间了
        const updatePayload: any = {
          status: currentStatus,
          last_checked_at: new Date().toISOString(),
          last_error: probed.ok ? null : probed.msg
        }

        if (!probed.ok) {
          updatePayload.is_active = false
          console.log(`[live_detail] Room ${externalRoom.id} is offline, deactivating.`)
        }

        await supabaseAdmin.from('live_rooms').update(updatePayload).eq('id', externalRoom.id)
      }

      // 🎯 统一关联 ID 为 88888 的用户 (UUID: 11c77e88-545b-4aa3-bbb1-db87e7d637f0)
      const { data: globalAnchor } = await supabaseAdmin
        .from('profiles')
        .select('id, nickname, avatar_url')
        .eq('numeric_id', 88888)
        .maybeSingle()

      return successResponse({
        room: {
          id: externalRoom.id,
          title: externalRoom.title,
          description: externalRoom.description,
          stream_url: externalRoom.stream_url,
          cover_url: externalRoom.cover_url,
          status: currentStatus, // 🎯 返回最新探测的状态
          is_self_hosted: false,
          anchor_id: globalAnchor?.id || '11c77e88-545b-4aa3-bbb1-db87e7d637f0',
          anchor_info: globalAnchor || {
            id: '11c77e88-545b-4aa3-bbb1-db87e7d637f0',
            nickname: '抖音精选',
            avatar_url: ''
          }
        }
      })
    }

    console.warn('[live_detail] Room not found in either table:', id)
    return errorResponse('Room not found', 1, 404)
  } catch (e: any) {
    console.error('[live_detail] unexpected error:', e)
    return errorResponse(e.message || 'Internal server error', 1, 500)
  }
}

export async function handleLiveRooms(_req: Request): Promise<Response> {
  try {
    // 1. 获取后台维护的转播直播间 (live_rooms)
    const { data: externalRooms, error: externalError } = await supabaseAdmin
      .from('live_rooms')
      .select('id, title, description, stream_url, cover_url, sort_order, is_active, updated_at')
      .eq('is_active', true)
      .order('sort_order', { ascending: false })
      .order('updated_at', { ascending: false })

    if (externalError) {
      console.error('[live_rooms] external query error:', externalError)
    }

    // 2. 获取自建用户直播间 (live_broadcast_rooms)
    const { data: selfHostedRooms, error: selfHostedError } = await supabaseAdmin
      .from('live_broadcast_rooms')
      .select(
        `
        id,
        title,
        status,
        viewer_count,
        custom_viewer_count,
        stream_key,
        anchor_id,
        node:live_broadcast_nodes(domain_name),
        anchor:profiles(id, nickname, avatar_url)
      `
      )
      .eq('status', 'live')
      .order('created_at', { ascending: false })

    if (selfHostedError) {
      console.error('[live_rooms] self-hosted query error:', selfHostedError)
    }

    // 3. 转换自建直播间格式以匹配前端需求
    const formattedSelfHosted = (selfHostedRooms || []).map((r: any) => {
      // 🎯 优先使用自定义人数，如果没有则使用真实人数
      const displayViewerCount = r.custom_viewer_count ?? r.viewer_count ?? 0
      return {
        id: r.id,
        title: r.title,
        description: `正在直播 - ${r.anchor?.nickname || '主播'}`,
        stream_url: `https://${r.node?.domain_name}/LiveApp/streams/${r.stream_key}.m3u8`,
        cover_url: r.anchor?.avatar_url || '',
        is_active: true,
        updated_at: null,
        sort_order: 100, // 自建直播默认排序靠前
        is_self_hosted: true,
        anchor_id: r.anchor_id,
        viewer_count: displayViewerCount, // 使用显示人数
        anchor_info: {
          id: r.anchor_id,
          nickname: r.anchor?.nickname || '匿名',
          avatar_url: r.anchor?.avatar_url || ''
        }
      }
    })

    // 4. 合并列表并按照 sort_order 排序
    const combinedList = [...formattedSelfHosted, ...(externalRooms || [])]

    return successResponse({ list: combinedList })
  } catch (e) {
    console.error('[live_rooms] unexpected error:', e)
    return errorResponse('Internal server error', 1, 500)
  }
}

type ProbeReqBody = {
  ids?: string[]
  id?: string
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
    // 强制管理员认证 (含 IP 校验)
    await requireAdminAuth(req)

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
          is_active: probed.ok, // 🎯 自动一键开关：探测正常则打开，不正常则关闭
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
