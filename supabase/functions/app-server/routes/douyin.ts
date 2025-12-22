import { successResponse, errorResponse } from '../../_shared/response.ts'
import { supabaseAdmin } from '../lib/env.ts'
import { requireAuth, parseJsonBody, HttpError } from '../lib/auth.ts'

const SYSTEM_AUTHOR_ID = '647fd608-d277-4e15-b5ea-891b57dfd2b5'

function isAdminUser(user: any): boolean {
  return user?.app_metadata?.role === 'admin'
}

function extractDouyinUrl(text: string): string | null {
  if (!text) return null
  // 优先匹配 v.douyin.com 短链
  const m1 = text.match(/https?:\/\/v\.douyin\.com\/[0-9A-Za-z]+\/?/i)
  if (m1?.[0]) return m1[0]

  // 其次匹配 share/video 长链
  const m2 = text.match(/https?:\/\/www\.iesdouyin\.com\/share\/video\/\d+\/[^ \n\r\t]*/i)
  if (m2?.[0]) return m2[0]

  // 兜底：任意 https url
  const m3 = text.match(/https?:\/\/[^\s]+/i)
  return m3?.[0] || null
}

function pickFirstUrl(urlList: any): string | null {
  if (Array.isArray(urlList) && urlList.length) return String(urlList[0])
  return null
}

function safeText(v: any): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

type ParseReq = { text?: string }

export async function handleAdminDouyinParse(req: Request): Promise<Response> {
  try {
    const { user } = await requireAuth(req)
    if (!isAdminUser(user)) throw new HttpError('Forbidden', 403)

    const body = await parseJsonBody<ParseReq>(req)
    const rawText = safeText(body?.text).trim()
    if (!rawText) return errorResponse('缺少 text', 1, 400)

    const sourceUrl = extractDouyinUrl(rawText)
    if (!sourceUrl) return errorResponse('未识别到抖音链接', 1, 400)

    const api = `https://douyin.wtf/api/hybrid/video_data?url=${encodeURIComponent(sourceUrl)}`
    const resp = await fetch(api, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (admin-douyin-parse)' }
    })
    if (!resp.ok) {
      console.error('[admin_douyin_parse] upstream failed:', { status: resp.status })
      return errorResponse('解析失败（上游异常）', 1, 502)
    }
    const json: any = await resp.json()
    const data = json?.data || {}
    const aweme = data?.aweme_detail || data
    const video = aweme?.video || {}

    const playUrl =
      pickFirstUrl(video?.play_addr?.url_list) || pickFirstUrl(video?.play_addr_h264?.url_list)
    const coverUrl = pickFirstUrl(video?.cover?.url_list) // ✅ 你指定用 cover
    const desc = safeText(aweme?.desc)
    const awemeId = safeText(aweme?.aweme_id)
    const durationMs = Number(video?.duration || 0)
    const durationSec = durationMs ? Math.max(0, Math.floor(durationMs / 1000)) : 0
    const width = Number(video?.width || 0) || null
    const height = Number(video?.height || 0) || null
    const expire = Number(video?.cdn_url_expired || 0) || null

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
