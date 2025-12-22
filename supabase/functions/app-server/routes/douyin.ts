import { successResponse, errorResponse } from '../../_shared/response.ts'
import { supabaseAdmin } from '../lib/env.ts'
import { requireAuth, parseJsonBody, HttpError } from '../lib/auth.ts'
import { TIKHUB_API_TOKEN } from '../lib/env.ts'

// ✅ Admin 上传/抖音发布固定作者
const SYSTEM_AUTHOR_ID = '11c77e88-545b-4aa3-bbb1-db87e7d637f0'

function isAdminUser(user: any): boolean {
  return user?.app_metadata?.role === 'admin'
}

function extractDouyinUrl(text: string): string | null {
  if (!text) return null
  // 优先匹配 v.douyin.com 短链
  const m1 = text.match(/https?:\/\/v\.douyin\.com\/[^\s]+/i)
  if (m1?.[0]) return m1[0]

  // 其次匹配 share/video 长链
  const m2 = text.match(/https?:\/\/www\.iesdouyin\.com\/share\/video\/\d+\/[^ \n\r\t]*/i)
  if (m2?.[0]) return m2[0]

  // 兜底：任意 https url
  const m3 = text.match(/https?:\/\/[^\s]+/i)
  return m3?.[0] || null
}

function extractDouyinUrlWithReason(
  text: string
): { url: string; reason: 'v_douyin' | 'iesdouyin_share' | 'fallback' } | null {
  if (!text) return null
  const m1 = text.match(/https?:\/\/v\.douyin\.com\/[^\s]+/i)
  if (m1?.[0]) {
    // 防呆：短链 path 太短（例如只剩 "Rsz"）基本一定是截断/粘连导致，交给 fallback 再找一次
    const raw = m1[0]
    try {
      const u = new URL(raw)
      const seg = (u.pathname || '').replace(/^\/+/, '').split('/')[0] || ''
      if (seg.length >= 5) {
        return { url: raw, reason: 'v_douyin' }
      }
    } catch {
      // URL 解析失败就先返回，后面 normalize 会做兜底清洗
      return { url: raw, reason: 'v_douyin' }
    }
  }

  const m2 = text.match(/https?:\/\/www\.iesdouyin\.com\/share\/video\/\d+\/[^ \n\r\t]*/i)
  if (m2?.[0]) return { url: m2[0], reason: 'iesdouyin_share' }

  const m3 = text.match(/https?:\/\/[^\s]+/i)
  if (m3?.[0]) return { url: m3[0], reason: 'fallback' }
  return null
}

function pickFirstUrl(urlList: any): string | null {
  if (Array.isArray(urlList) && urlList.length) return String(urlList[0])
  return null
}

function pickBestPlayUrl(lists: any[]): string | null {
  const all: string[] = []
  for (const list of lists) {
    if (Array.isArray(list)) {
      for (const u of list) all.push(String(u))
    }
  }
  const urls = all.map((s) => String(s || '').trim()).filter((s) => /^https?:\/\//i.test(s))

  if (!urls.length) return null

  // ✅ 选择“更适合浏览器播放”的链接：
  // - 优先 douyin.com 的 /aweme/v1/play（通常是官方播放入口，兼容性更强）
  // - 其次 douyin.com 域
  // - 尽量避免 zjcdn 直链（后台浏览器环境经常 403）
  let best = urls[0]
  let bestScore = -1e9
  for (const u of urls) {
    let score = 0
    if (/\/aweme\/v1\/play\/?/i.test(u)) score += 100
    if (/https?:\/\/www\.douyin\.com\//i.test(u)) score += 80
    if (/https?:\/\/[^/]*douyin\.com\//i.test(u)) score += 40
    if (/zjcdn\.com/i.test(u)) score -= 30
    // 更短的链接通常更“入口化”（如 /aweme/v1/play），稍微加权
    score += Math.max(0, 2000 - u.length) / 2000
    if (score > bestScore) {
      bestScore = score
      best = u
    }
  }
  return best
}

function safeKeys(v: any, limit = 40): string[] {
  if (!v || typeof v !== 'object') return []
  try {
    return Object.keys(v).slice(0, limit)
  } catch {
    return []
  }
}

function safeText(v: any): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function normalizeShareUrl(input: string): string {
  let u = (input || '').trim()
  // 去掉常见尾部标点/引号/括号（抖音复制文案里经常带）
  u = u.replace(/[)\]'"”’）】]+$/g, '')
  u = u.replace(/[。．，、；;！!？?]+$/g, '')
  // 去掉尾部非 URL 合法字符（例如中文/emoji 等粘连）
  // 注意：字符类里 `[` 放在开头即可表示字面量，不需要写成 `\[`（eslint no-useless-escape）
  // 允许的 URL 字符：RFC3986 unreserved + reserved（常见 URL 组成）
  // 这里匹配“尾部不属于允许集合的字符”，用于清理粘连的中文/emoji/标点等
  u = u.replace(/[^0-9A-Za-z._~:/?#[\]@!$&'()*+,;=%-]+$/g, '')
  // 去掉尾部多余斜杠
  u = u.replace(/\/+$/g, '')
  return u
}

type ParseMode = 'app_v3_share' | 'app_v3_v2' | 'web_share'
type ParseReq = { text?: string; mode?: ParseMode }

function extractAwemeIdFromUrl(url: string): string | null {
  const m = String(url || '').match(/\/share\/video\/(\d+)\//i)
  return m?.[1] || null
}

async function resolveAwemeIdFromShareUrl(shareUrl: string): Promise<string | null> {
  // 1) 直接从长链里取
  const direct = extractAwemeIdFromUrl(shareUrl)
  if (direct) return direct

  // 2) v.douyin.com 短链：尝试拿 302 Location（免费请求抖音）
  try {
    const resp = await fetch(shareUrl, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (admin-douyin-parse-awemeid)' }
    })
    const loc = resp.headers.get('location') || resp.headers.get('Location')
    if (loc) {
      const id = extractAwemeIdFromUrl(loc)
      if (id) return id
    }
  } catch {
    // ignore
  }

  // 3) HEAD 失败：用 GET + manual 再试一次
  try {
    const resp = await fetch(shareUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (admin-douyin-parse-awemeid)' }
    })
    const loc = resp.headers.get('location') || resp.headers.get('Location')
    if (loc) {
      const id = extractAwemeIdFromUrl(loc)
      if (id) return id
    }
  } catch {
    // ignore
  }

  return null
}

export async function handleAdminDouyinParse(req: Request): Promise<Response> {
  try {
    const { user } = await requireAuth(req)
    if (!isAdminUser(user)) throw new HttpError('Forbidden', 403)

    const body = await parseJsonBody<ParseReq>(req)
    const rawText = safeText(body?.text).trim()
    if (!rawText) return errorResponse('缺少 text', 1, 400)
    const mode: ParseMode = (body?.mode as ParseMode) || 'app_v3_share'

    const extracted = extractDouyinUrlWithReason(rawText)
    const sourceUrl = extracted?.url || extractDouyinUrl(rawText)
    if (!sourceUrl) return errorResponse('未识别到抖音链接', 1, 400)
    const normalizedUrl = normalizeShareUrl(sourceUrl)

    if (!TIKHUB_API_TOKEN) {
      return errorResponse('Server misconfigured: missing TIKHUB_API_TOKEN', 1, 500)
    }

    // ✅ TikHub 上游选择（3种）
    // - app_v3_share: GET /api/v1/douyin/app/v3/fetch_one_video_by_share_url?share_url=...
    // - web_share:    GET /api/v1/douyin/web/fetch_one_video_by_share_url?share_url=...
    // - app_v3_v2:    GET /api/v1/douyin/app/v3/fetch_one_video_v2?aweme_id=...（需先从短链解出 aweme_id）
    let api = ''
    let awemeIdForV2: string | null = null
    if (mode === 'web_share') {
      api = `https://api.tikhub.io/api/v1/douyin/web/fetch_one_video_by_share_url?share_url=${encodeURIComponent(
        normalizedUrl
      )}`
    } else if (mode === 'app_v3_v2') {
      awemeIdForV2 = await resolveAwemeIdFromShareUrl(normalizedUrl)
      if (!awemeIdForV2) {
        return errorResponse('解析失败：未能从分享链接解析出 aweme_id', 1, 500)
      }
      api = `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video_v2?aweme_id=${encodeURIComponent(
        awemeIdForV2
      )}`
    } else {
      api = `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video_by_share_url?share_url=${encodeURIComponent(
        normalizedUrl
      )}`
    }

    // 🔎 关键日志：不打印 token，只打印链接规范化结果
    console.log('[admin_douyin_parse] share_url:', {
      mode,
      extract_reason: extracted?.reason || 'unknown',
      raw_text_preview: rawText.slice(0, 180),
      sourceUrl,
      normalizedUrl,
      changed: sourceUrl !== normalizedUrl,
      aweme_id_for_v2: awemeIdForV2,
      request: { method: 'GET', url: api }
    })

    let resp: Response | null = null
    let raw = ''
    let json: any = null
    const maxAttempts = 3 // 1 次 + 自动重试 2 次
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      resp = await fetch(api, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${TIKHUB_API_TOKEN}`,
          'User-Agent': 'Mozilla/5.0 (admin-douyin-parse)',
          Accept: 'application/json'
        }
      })

      raw = await resp.text().catch(() => '')
      try {
        json = raw ? JSON.parse(raw) : null
      } catch {
        json = null
      }

      if (resp.ok) break

      const requestId = json?.detail?.request_id || json?.request_id
      const msgZh = json?.detail?.message_zh || json?.message_zh
      console.error('[admin_douyin_parse] upstream attempt failed:', {
        attempt,
        maxAttempts,
        status: resp.status,
        request_id: requestId,
        message_zh: msgZh,
        body_preview: raw ? raw.slice(0, 500) : ''
      })

      if (attempt < maxAttempts) {
        // TikHub 400 也可能是临时失败（文案提示 retry），做一个很短的退避
        const backoffMs = 200 * attempt
        await new Promise((r) => setTimeout(r, backoffMs))
      }
    }

    if (!resp || !resp.ok) {
      return errorResponse('解析失败（上游异常）', 1, 502)
    }

    const upstreamRequestId = json?.detail?.request_id || json?.request_id || null
    const upstreamMsgZh = json?.detail?.message_zh || json?.message_zh || ''
    const upstreamMsg = json?.detail?.message || json?.message || ''

    // TikHub 通常用 code=200 表示成功
    const upstreamCode = Number(json?.code)
    if (Number.isFinite(upstreamCode) && upstreamCode !== 200) {
      const msg = json?.message_zh || json?.message || '解析失败（上游返回异常）'
      console.error('[admin_douyin_parse] upstream code not ok:', {
        code: upstreamCode,
        msg,
        body_preview: raw ? raw.slice(0, 500) : ''
      })
      return errorResponse(msg, 1, 502)
    }

    const data = json?.data || {}
    // 兼容：TikHub 返回结构可能是 data.aweme_details[] / data.aweme_detail / data 直接是 aweme
    let aweme: any = null
    let awemeSource = ''
    if (Array.isArray((data as any)?.aweme_details) && (data as any).aweme_details.length) {
      aweme = (data as any).aweme_details[0]
      awemeSource = 'data.aweme_details[0]'
    } else if ((data as any)?.aweme_detail) {
      aweme = (data as any).aweme_detail
      awemeSource = 'data.aweme_detail'
    } else if ((data as any)?.aweme) {
      aweme = (data as any).aweme
      awemeSource = 'data.aweme'
    } else {
      aweme = data
      awemeSource = 'data'
    }

    // 有些版本会再包一层 aweme_detail / aweme_info / aweme
    if (aweme?.aweme_detail) {
      aweme = aweme.aweme_detail
      awemeSource += '.aweme_detail'
    } else if (aweme?.aweme_info) {
      aweme = aweme.aweme_info
      awemeSource += '.aweme_info'
    } else if (aweme?.aweme) {
      aweme = aweme.aweme
      awemeSource += '.aweme'
    }

    const video = aweme?.video || {}

    const playAddrList = video?.play_addr?.url_list
    const playAddrH264List = video?.play_addr_h264?.url_list
    const playUrl = pickBestPlayUrl([playAddrList, playAddrH264List])
    const coverUrl = pickFirstUrl(video?.cover?.url_list) // ✅ 你指定用 cover
    const desc = safeText(aweme?.desc || aweme?.description)
    const awemeId = safeText(aweme?.aweme_id || aweme?.awemeId || aweme?.id)
    const rawDuration = Number(video?.duration || aweme?.duration || aweme?.video_duration || 0)
    // 兼容：可能是毫秒，也可能是秒
    const durationSec =
      rawDuration > 10_000
        ? Math.max(0, Math.floor(rawDuration / 1000))
        : Math.max(0, Math.floor(rawDuration))
    const width = Number(video?.width || 0) || null
    const height = Number(video?.height || 0) || null
    const expire = Number(video?.cdn_url_expired || aweme?.cdn_url_expired || 0) || null

    console.log('[admin_douyin_parse] parsed:', {
      upstream: {
        httpStatus: resp.status,
        request_id: upstreamRequestId,
        code: json?.code,
        message_zh: upstreamMsgZh,
        message: upstreamMsg
      },
      tikhub: {
        data_keys: safeKeys(data),
        aweme_details_len: Array.isArray((data as any)?.aweme_details)
          ? (data as any).aweme_details.length
          : 0,
        aweme_source: awemeSource
      },
      aweme_id: awemeId || null,
      aweme_keys: safeKeys(aweme),
      video_keys: safeKeys(video),
      play: {
        play_addr_len: Array.isArray(playAddrList) ? playAddrList.length : 0,
        play_addr_h264_len: Array.isArray(playAddrH264List) ? playAddrH264List.length : 0,
        play_url_preview: playUrl ? String(playUrl).slice(0, 120) : null
      },
      cover: {
        cover_len: Array.isArray(video?.cover?.url_list) ? video.cover.url_list.length : 0,
        cover_url_preview: coverUrl ? String(coverUrl).slice(0, 120) : null
      },
      meta: {
        duration_raw: rawDuration || 0,
        duration_sec: durationSec || 0,
        width,
        height,
        cdn_url_expired: expire
      },
      desc_preview: desc ? desc.slice(0, 80) : ''
    })

    if (!playUrl) {
      console.error('[admin_douyin_parse] play url missing:', {
        request_id: upstreamRequestId,
        aweme_source: awemeSource,
        aweme_id: awemeId || null,
        aweme_keys: safeKeys(aweme),
        video_keys: safeKeys(video),
        play_addr_len: Array.isArray(playAddrList) ? playAddrList.length : 0,
        play_addr_h264_len: Array.isArray(playAddrH264List) ? playAddrH264List.length : 0,
        body_preview: raw ? raw.slice(0, 800) : ''
      })
      return errorResponse('解析失败：未拿到播放地址', 1, 500)
    }

    return successResponse({
      source_url: sourceUrl,
      aweme_id: awemeId || null,
      description: desc || null,
      play_url: playUrl,
      cover_url: coverUrl || null,
      duration: durationSec || null,
      width,
      height,
      cdn_url_expired: expire
    })
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, 1, e.status)
    console.error('[admin_douyin_parse] unexpected error:', e)
    return errorResponse('Internal server error', 1, 500)
  }
}

type PublishReq = {
  source_url?: string
  play_url?: string
  cover_url?: string | null
  description?: string | null
  duration?: number | null
  width?: number | null
  height?: number | null
}

export async function handleAdminDouyinPublish(req: Request): Promise<Response> {
  try {
    const { user } = await requireAuth(req)
    if (!isAdminUser(user)) throw new HttpError('Forbidden', 403)

    const body = await parseJsonBody<PublishReq>(req)
    const sourceUrl = safeText(body?.source_url).trim()
    const playUrl = safeText(body?.play_url).trim()
    const coverUrl = body?.cover_url ? String(body.cover_url) : null
    const desc = body?.description ? String(body.description) : null
    const duration = typeof body?.duration === 'number' ? body.duration : null
    const width = typeof body?.width === 'number' ? body.width : null
    const height = typeof body?.height === 'number' ? body.height : null

    if (!sourceUrl) return errorResponse('缺少 source_url', 1, 400)
    if (!/^https?:\/\//i.test(sourceUrl)) return errorResponse('source_url 非法', 1, 400)
    if (!playUrl) return errorResponse('缺少 play_url', 1, 400)
    if (!/^https?:\/\//i.test(playUrl)) return errorResponse('play_url 非法', 1, 400)

    const now = new Date().toISOString()

    // ✅ Me 页 /video/my 优先按 tg_user_id 过滤；系统作者如果有 tg_user_id，需要同步写入 videos.tg_user_id
    const { data: authorProfile, error: authorErr } = await supabaseAdmin
      .from('profiles')
      .select('tg_user_id')
      .eq('id', SYSTEM_AUTHOR_ID)
      .maybeSingle()
    if (authorErr) {
      console.error('[admin_douyin_publish] load author profile failed:', authorErr)
      return errorResponse('保存失败（作者信息异常）', 1, 500)
    }
    const authorTgUserId = (authorProfile as any)?.tg_user_id ?? null

    // ✅ 直接发布：status=published + review_status=approved
    const insertRow: any = {
      author_id: SYSTEM_AUTHOR_ID,
      tg_user_id: authorTgUserId,
      title: '抖音精选',
      description: desc,
      play_url: playUrl,
      cover_url: coverUrl,
      duration: duration,
      width,
      height,
      tg_file_id: sourceUrl, // ✅ 你要求“源链接存到 tg_file_id”
      storage_type: 'douyin',
      content_type: 'video',
      status: 'published',
      review_status: 'approved',
      is_private: false,
      is_adult: false,
      is_shortdrama: false,
      published_at: now
    }

    const { data, error } = await supabaseAdmin
      .from('videos')
      .insert(insertRow)
      .select('id')
      .single()

    if (error) {
      console.error('[admin_douyin_publish] insert error:', error)
      return errorResponse('保存失败', 1, 500)
    }

    return successResponse({ id: data?.id })
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, 1, e.status)
    console.error('[admin_douyin_publish] unexpected error:', e)
    return errorResponse('Internal server error', 1, 500)
  }
}
