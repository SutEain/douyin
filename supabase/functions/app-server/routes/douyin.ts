import { successResponse, errorResponse } from '../../_shared/response.ts'
import { supabaseAdmin } from '../lib/env.ts'
import { requireAuth, parseJsonBody, HttpError } from '../lib/auth.ts'
import { TIKHUB_API_TOKEN } from '../lib/env.ts'

const SYSTEM_AUTHOR_ID = '647fd608-d277-4e15-b5ea-891b57dfd2b5'

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
  u = u.replace(/[^[0-9A-Za-z\-._~:/?#\]@!$&'()*+,;=%]+$/g, '')
  // 去掉尾部多余斜杠
  u = u.replace(/\/+$/g, '')
  return u
}

type ParseReq = { text?: string }

export async function handleAdminDouyinParse(req: Request): Promise<Response> {
  try {
    const { user } = await requireAuth(req)
    if (!isAdminUser(user)) throw new HttpError('Forbidden', 403)

    const body = await parseJsonBody<ParseReq>(req)
    const rawText = safeText(body?.text).trim()
    if (!rawText) return errorResponse('缺少 text', 1, 400)

    const extracted = extractDouyinUrlWithReason(rawText)
    const sourceUrl = extracted?.url || extractDouyinUrl(rawText)
    if (!sourceUrl) return errorResponse('未识别到抖音链接', 1, 400)
    const normalizedUrl = normalizeShareUrl(sourceUrl)

    if (!TIKHUB_API_TOKEN) {
      return errorResponse('Server misconfigured: missing TIKHUB_API_TOKEN', 1, 500)
    }

    // ✅ TikHub（付费接口）：根据分享链接获取单个作品数据
    // 文档：https://api.tikhub.io/#/Douyin-App-V3-API/fetch_one_video_by_share_url_api_v1_douyin_app_v3_fetch_one_video_by_share_url_get
    const api = `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video_by_share_url?share_url=${encodeURIComponent(
      normalizedUrl
    )}`

    // 🔎 关键日志：不打印 token，只打印链接规范化结果
    console.log('[admin_douyin_parse] share_url:', {
      extract_reason: extracted?.reason || 'unknown',
      raw_text_preview: rawText.slice(0, 180),
      sourceUrl,
      normalizedUrl,
      changed: sourceUrl !== normalizedUrl,
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
    // 兼容：有些返回是 aweme_detail，有些直接就是 aweme 对象
    const aweme = data?.aweme_detail || data?.aweme || data
    const video = aweme?.video || {}

    const playUrl =
      pickFirstUrl(video?.play_addr?.url_list) || pickFirstUrl(video?.play_addr_h264?.url_list)
    const coverUrl = pickFirstUrl(video?.cover?.url_list) // ✅ 你指定用 cover
    const desc = safeText(aweme?.desc)
    const awemeId = safeText(aweme?.aweme_id)
    const rawDuration = Number(video?.duration || aweme?.duration || 0)
    // 兼容：可能是毫秒，也可能是秒
    const durationSec =
      rawDuration > 10_000
        ? Math.max(0, Math.floor(rawDuration / 1000))
        : Math.max(0, Math.floor(rawDuration))
    const width = Number(video?.width || 0) || null
    const height = Number(video?.height || 0) || null
    const expire = Number(video?.cdn_url_expired || aweme?.cdn_url_expired || 0) || null

    if (!playUrl) {
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
