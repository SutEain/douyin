import { errorResponse, successResponse } from '../../_shared/response.ts'
import { parsePagination, tryGetAuth } from '../lib/auth.ts'
import { supabaseAdmin } from '../lib/env.ts'
import { getVideoAuthorProfile, mapVideoRow, applyRowFlags, attachUserFlags } from '../lib/video.ts'

// 图文（壁纸）推荐：返回 note_card 结构，供 Community.vue + AlbumDetail.vue 使用
export async function handlePostRecommended(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pageNo, pageSize, from, to } = parsePagination(url)
  const { user } = await tryGetAuth(req)

  // 仅取图片/相册，过滤成人与东南亚板块（东南亚板块本身是 video，但这里也显式排除）
  const { data, error, count } = await supabaseAdmin
    .from('videos')
    .select('*', { count: 'exact' })
    .eq('status', 'published')
    .eq('is_adult', false)
    .eq('is_sea', false)
    .in('content_type', ['image', 'album'])
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('[PostRecommended] 查询图文失败:', error)
    return errorResponse('Failed to load posts', 1, 500)
  }

  await attachUserFlags(data ?? [], user?.id ?? null)

  const profileCache = new Map<string, any>()
  const list: any[] = []

  for (const row of data ?? []) {
    const authorProfile = await getVideoAuthorProfile(row, profileCache)
    const mapped = await mapVideoRow(row, authorProfile)
    if (!mapped) continue
    applyRowFlags(mapped, row)

    const coverUrl =
      mapped?.images?.[0]?.url || mapped?.video?.cover?.url_list?.[0] || mapped?.video?.poster || ''

    const imageList = Array.isArray(mapped.images)
      ? mapped.images
          .filter((img: any) => !!img?.url)
          .map((img: any) => ({
            info_list: [{ url: img.url }]
          }))
      : []

    const nickname = mapped?.author?.nickname || '用户'
    const avatar = mapped?.author?.avatar_168x168?.url_list?.[0] || ''
    const authorId = mapped?.author?.user_id || null

    const createTime = (() => {
      const iso = (row.published_at || row.created_at) as string | undefined
      if (!iso) return ''
      // 统一 MM-dd（与旧 UI 一致）
      const d = new Date(iso)
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return `${mm}-${dd}`
    })()

    list.push({
      id: mapped.aweme_id,
      // ✅ 复用视频的用户态标记（用于详情页点赞/收藏初始状态）
      isLoved: !!mapped.isLoved,
      isCollect: !!mapped.isCollect,
      // ✅ 关注态（用于详情页关注/取消关注）
      isAttention: !!mapped.isAttention,
      note_card: {
        aweme_id: mapped.aweme_id,
        cover: { url_default: coverUrl },
        image_list: imageList,
        display_title: mapped.desc || '',
        user: {
          id: authorId,
          avatar,
          nickname,
          nick_name: nickname // 兼容 AlbumDetail.vue 旧字段
        },
        interact_info: {
          liked_count: mapped.statistics?.digg_count ?? 0,
          comment_count: mapped.statistics?.comment_count ?? 0,
          collect_count: mapped.statistics?.collect_count ?? 0,
          share_count: mapped.statistics?.share_count ?? 0
        },
        comment_list: [],
        createTime
      }
    })
  }

  return successResponse({
    list,
    total: count ?? 0,
    pageNo,
    pageSize,
    hasMore: list.length >= pageSize
  })
}
