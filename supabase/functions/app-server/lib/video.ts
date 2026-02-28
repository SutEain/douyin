import {
  DEFAULT_AVATAR,
  DEFAULT_COVER,
  TG_BOT_TOKEN,
  TG_FILE_PROXY_URL,
  supabaseAdmin
} from './env.ts'

// ✅ 计算年龄（从生日 YYYY-MM-DD）
function calculateAge(birthday: string): number {
  if (!birthday) return -1
  try {
    const birthDate = new Date(birthday)
    const today = new Date()
    let age = today.getFullYear() - birthDate.getFullYear()
    const monthDiff = today.getMonth() - birthDate.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--
    }
    return age > 0 ? age : -1
  } catch {
    return -1
  }
}

export async function mapVideoRow(row: any, profile: any) {
  try {
    const coverUrl = await buildCoverUrl(row, profile)
    const avatar = profile?.avatar_url || DEFAULT_AVATAR

    // 🎯 根据内容类型决定是否需要视频URL
    const contentType = row.content_type || 'video'
    const videoUrl = contentType === 'video' ? await buildVideoUrl(row) : null

    // 🎯 只有纯视频类型才需要检查视频URL，合辑(collection)中视频是动态加载的
    if (contentType === 'video' && !videoUrl) return null

    const authorCoverList = Array.isArray(profile?.cover_url)
      ? profile.cover_url
      : [
          {
            url_list: profile?.cover_url ? [profile.cover_url] : []
          }
        ]
    const authorCardEntries = Array.isArray(profile?.card_entries) ? profile.card_entries : []

    // 🎯 解析媒体列表，兼容 media_list 和 images 字段
    let mediaList: any[] = []
    const rawMedia = row.media_list || row.images
    if (rawMedia) {
      try {
        const parsed = typeof rawMedia === 'string' ? JSON.parse(rawMedia) : rawMedia
        if (Array.isArray(parsed)) {
          // 转换每个媒体项的 file_id 为完整 URL
          mediaList = await Promise.all(
            parsed.map(async (item: any) => {
              const mappedItem = { ...item }
              if (item.file_id) {
                // 🎯 优先使用已有的 play_url 或 url，支持相对路径和绝对路径
                const resolvedUrl = await convertMediaReferenceToUrl(item.play_url || item.url)
                if (resolvedUrl) {
                  // 🎯 同时更新 url 和 play_url，确保前端不论读取哪个字段都能拿到正确地址
                  mappedItem.url = resolvedUrl
                  mappedItem.play_url = resolvedUrl
                } else {
                  // 只有确实没有直链时才走代理
                  mappedItem.url = await buildTelegramFileUrl(item.file_id)
                }

                // 如果是视频且没有 play_url，尝试构建
                if (item.type === 'video' && !mappedItem.play_url) {
                  mappedItem.play_url = mappedItem.url
                }
              }
              // 如果有封面地址，也转换它
              if (item.cover_url) {
                const resolvedCover = await convertMediaReferenceToUrl(item.cover_url)
                if (resolvedCover) {
                  mappedItem.cover_url = resolvedCover
                } else if (item.type === 'video') {
                  mappedItem.cover_url = await buildTelegramFileUrl(item.cover_url)
                }
              }
              return mappedItem
            })
          )
        }
      } catch (e) {
        console.error('[mapVideoRow] 解析媒体列表失败:', e)
      }
    }

    return {
      aweme_id: typeof row.id === 'string' ? row.id : String(row.id),
      is_top: !!row.is_top,
      status: row.status || 'published',
      is_private: !!row.is_private,
      is_adult: !!row.is_adult,
      view_count: row.view_count ?? 0,
      content_type: contentType,
      media_list: mediaList, // 🎯 统一返回 media_list
      images: mediaList, // 兼容旧版前端
      desc: row.description || '',
      tags: row.tags || [],
      create_time: Math.floor(new Date(row.created_at).getTime() / 1000),
      city: row.location_city || '',
      address: row.location_country || '',
      isLoved: false,
      isCollect: false,
      isAttention: false,
      statistics: {
        digg_count: row.like_count ?? 0,
        comment_count: row.comment_count ?? 0,
        collect_count: row.collect_count ?? 0,
        share_count: row.share_count ?? 0
      },
      video: {
        duration: row.duration ?? 0,
        width: row.width ?? 0,
        height: row.height ?? 0,
        play_addr: {
          url_list: [videoUrl]
        },
        cover: {
          url_list: coverUrl ? [coverUrl] : [DEFAULT_COVER]
        },
        poster: coverUrl || DEFAULT_COVER
      },
      author: {
        nickname: profile?.nickname || profile?.username || '用户',
        unique_id: profile?.username || '',
        uid: profile?.id || String(row.tg_user_id ?? row.author_id ?? row.id),
        user_id: profile?.id || row.author_id || null,
        tg_user_id: profile?.tg_user_id ?? row.tg_user_id ?? null,
        avatar_thumb: {
          url_list: [avatar]
        },
        avatar_168x168: {
          url_list: [avatar]
        },
        avatar_300x300: {
          url_list: [avatar]
        },
        cover_url: authorCoverList.map((entry: any) => ({
          url_list: Array.isArray(entry?.url_list)
            ? entry.url_list
            : entry?.url_list
              ? [entry.url_list]
              : []
        })),
        card_entries: authorCardEntries,
        signature: profile?.bio || '',
        total_favorited: profile?.total_likes || 0,
        following_count: profile?.following_count || 0,
        mplatform_followers_count: profile?.follower_count || 0,
        follower_count: profile?.follower_count || 0,
        follow_status: 0,
        is_follow: false,
        user_age: profile?.birthday ? calculateAge(profile.birthday) : -1,
        gender: profile?.gender || 0,
        ip_location: profile?.country || '',
        province: profile?.province || '',
        city: profile?.city || '',
        country: profile?.country || '',
        numeric_id: profile?.numeric_id || null,
        show_collect: profile?.show_collect !== false,
        show_like: profile?.show_like !== false,
        show_tg_username: profile?.show_tg_username === true
      }
    }
  } catch (err) {
    console.error('[mapVideoRow] 严重错误:', err)
    return null // 容错：单个视频映射失败不影响整页
  }
}

export async function buildVideoUrl(row: any): Promise<string | null> {
  if (row.storage_type === 'telegram' && row.tg_file_id) {
    return buildTelegramFileUrl(row.tg_file_id)
  }

  return row.play_url || null
}

export async function buildCoverUrl(row: any, profile: any): Promise<string> {
  // 🎯 对于图片/相册/合辑类型，优先使用媒体数组中的第一项
  const contentType = row.content_type || 'video'
  if (contentType === 'image' || contentType === 'album' || contentType === 'collection') {
    let media: any[] = []
    const rawMedia = row.media_list || row.images
    if (rawMedia) {
      try {
        media = typeof rawMedia === 'string' ? JSON.parse(rawMedia) : rawMedia
        if (!Array.isArray(media)) media = []
      } catch {
        media = []
      }
    }
    if (media.length > 0) {
      const first = media[0]
      // 🎯 优先使用 R2 直链 (封面或播放地址)
      const r2Target = first.cover_url || first.play_url || first.url
      if (r2Target) {
        // 完整 URL 或相对路径都可以直接返回
        if (/^https?:\/\//i.test(r2Target) || r2Target.startsWith('/')) {
          return r2Target
        }
        // 🎯 HLS 视频特殊处理：如果 cover_url 是 thumb_{file_id}.jpg 格式，需要根据 play_url 构建路径
        if (
          first.type === 'video' &&
          first.play_url &&
          r2Target.startsWith('thumb_') &&
          r2Target.endsWith('.jpg')
        ) {
          const playUrl = first.play_url
          // 从 play_url 提取路径：/videos/{uuid}/{file_id}/index.m3u8 -> /videos/{uuid}
          const playUrlMatch = playUrl.match(/^(\/videos\/[^/]+)/)
          if (playUrlMatch) {
            const videoDir = playUrlMatch[1]
            return `${videoDir}/${r2Target}`
          }
        }
      }

      // 🎯 Telegram file_id 不再支持，直接跳过
      // 如果 media_list 中的 cover_url 是 file_id，会被跳过，继续检查 row.cover_url
    }
  }

  // 🎯 HLS 视频特殊处理：如果 cover_url 是 thumb_{file_id}.jpg 格式，需要根据 play_url 或视频 ID 构建路径
  // 🎯 也处理非 HLS 视频的 thumb_ 格式封面（可能是转换过程中的数据）
  if (row.cover_url) {
    const coverUrl = row.cover_url.trim()

    // 🎯 如果 cover_url 是 thumb_{file_id}.jpg 格式（没有路径前缀）
    if (coverUrl.startsWith('thumb_') && coverUrl.endsWith('.jpg') && !coverUrl.includes('/')) {
      let videoDir = null

      // 优先从 play_url 提取路径
      if (row.play_url) {
        const playUrlMatch = row.play_url.match(/^(\/videos\/[^/]+)/)
        if (playUrlMatch) {
          videoDir = playUrlMatch[1]
        }
      }

      // 如果 play_url 为空，从视频 ID 构建路径
      if (!videoDir && row.id) {
        videoDir = `/videos/${row.id}`
      }

      if (videoDir) {
        return `${videoDir}/${coverUrl}`
      }
    }
    // 情况2：cover_url 是 videos/{uuid}/thumb_{file_id}.jpg（没有前导斜杠）
    if (
      coverUrl.startsWith('videos/') &&
      coverUrl.includes('/thumb_') &&
      coverUrl.endsWith('.jpg')
    ) {
      return `/${coverUrl}`
    }
    // 情况3：cover_url 已经是完整路径 /videos/{uuid}/thumb_{file_id}.jpg
    if (
      coverUrl.startsWith('/videos/') &&
      coverUrl.includes('/thumb_') &&
      coverUrl.endsWith('.jpg')
    ) {
      return coverUrl
    }
  }

  const primary = await convertMediaReferenceToUrl(row.cover_url)
  if (primary) return primary

  const secondary = await convertMediaReferenceToUrl(row.thumbnail_url)
  if (secondary) return secondary

  if (row.tg_thumbnail_file_id) {
    const cdnUrl = await buildTelegramFileUrl(row.tg_thumbnail_file_id)
    if (cdnUrl) return cdnUrl
  }

  const profileCover = await convertMediaReferenceToUrl(profile?.cover_url)
  if (profileCover) return profileCover

  return DEFAULT_COVER
}

export async function buildTelegramFileUrl(fileId?: string): Promise<string | null> {
  if (!fileId) return null

  // 🎯 纯 R2 架构：不再生成指向失效 CDN 代理的链接
  // 直接返回 null，防止前端发起无效请求
  return null
}

export async function convertMediaReferenceToUrl(value?: string): Promise<string | null> {
  if (!value) return null
  const v = String(value).trim()
  // 🎯 完整 URL：直接返回
  if (/^https?:\/\//i.test(v)) return v
  // 🎯 相对路径（R2 存储路径）：直接返回，前端会通过 buildCdnUrl 处理
  if (v.startsWith('/')) return v
  // 🎯 兼容没有前导斜杠的 R2 路径
  if (v.startsWith('videos/')) return `/${v}`
  // 🎯 Telegram file_id：不再支持，返回 null
  return null
}

export async function getVideoAuthorProfile(row: any, cache: Map<string, any>) {
  let cacheKey: string | null = null
  if (row.author_id) {
    cacheKey = `id:${row.author_id}`
  } else if (row.tg_user_id) {
    cacheKey = `tg:${row.tg_user_id}`
  }

  if (cacheKey && cache.has(cacheKey)) {
    return cache.get(cacheKey)
  }

  // 🚨 安全修复：只查询必要字段，不查询敏感字段（balance_coins, is_admin等）
  // 注意：tg_user_id 保留，因为视频作者信息中需要显示
  const safeFields = PROFILE_SAFE_FIELDS

  let query
  if (row.author_id) {
    query = supabaseAdmin.from('profiles').select(safeFields).eq('id', row.author_id).maybeSingle()
  } else if (row.tg_user_id) {
    query = supabaseAdmin
      .from('profiles')
      .select(safeFields)
      .eq('tg_user_id', row.tg_user_id)
      .maybeSingle()
  }

  const { data } = query ? await query : { data: null }
  if (cacheKey) {
    cache.set(cacheKey, data)
  }
  // 🩺 诊断：profile 为空时打日志，便于排查「全部显示为 Telegram 用户 / 头像缺失」
  if (!data && (row.author_id || row.tg_user_id)) {
    console.warn(
      '[getVideoAuthorProfile] profile 未查到 video_id=%s author_id=%s tg_user_id=%s',
      row.id,
      row.author_id ?? null,
      row.tg_user_id ?? null
    )
  }
  return data
}

export async function getProfileById(id: string) {
  if (!id) return null
  // 🚨 安全修复：只查询必要字段，不查询敏感字段
  const { data } = await supabaseAdmin
    .from('profiles')
    .select(PROFILE_SAFE_FIELDS)
    .eq('id', id)
    .maybeSingle()
  return data
}

function hasAuthor(r: any): boolean {
  return getRowAuthorId(r) != null || getRowTgUserId(r) != null
}

/**
 * 为缺少 author_id/tg_user_id 的 row 从 videos 表补全，便于 getVideoAuthorProfile 能查到作者
 * RPC（get_sea_feed、get_adult_feed、get_video_tab_feed 等）可能不返回 tg_user_id，或库里 author_id 为空
 * 调用方：所有返回视频列表的接口，在 mapVideoRow 前调用
 */
export async function enrichRowsWithAuthorIds(
  rows: any[],
  logPrefix: string = 'Feed'
): Promise<void> {
  if (!rows?.length) return
  const needEnrich = rows.filter((r: any) => !hasAuthor(r))
  if (needEnrich.length === 0) return
  const ids = needEnrich.map((r: any) => r.id).filter(Boolean)
  if (ids.length === 0) return
  const { data: videoRows } = await supabaseAdmin
    .from('videos')
    .select('id, author_id, tg_user_id')
    .in('id', ids)
  const byId = new Map((videoRows || []).map((v: any) => [v.id, v]))
  for (const row of rows) {
    if (hasAuthor(row)) continue
    const v = byId.get(row.id)
    if (v) {
      row.author_id = v.author_id ?? row.author_id
      row.tg_user_id = v.tg_user_id ?? row.tg_user_id
    }
  }
  const gotFromDb = needEnrich.filter((r: any) => hasAuthor(r)).length
  console.log(
    `[${logPrefix}] 从 videos 表补全 author_id/tg_user_id 请求:${ids.length} 补全成功:${gotFromDb}`
  )
}

// 仅包含 profiles 表实际存在的列（无 card_entries，避免 42703）
const PROFILE_SAFE_FIELDS =
  'id, nickname, username, bio, avatar_url, cover_url, tg_user_id, numeric_id, follower_count, following_count, total_likes, video_count, created_at, updated_at, gender, birthday, country, province, city'

/**
 * 批量拉取本批视频行对应的作者 profile，避免逐条查导致漏查或 RPC/策略差异
 * 使用 service_role 直查 profiles 表，不经过 RLS
 * @returns Map: key 为 row 的 author_id 或 tg_user_id，value 为 profile；供 mapVideoRow(row, profileMap.get(row)) 使用
 */
export async function batchLoadAuthorProfiles(
  rows: any[],
  logPrefix: string = 'Feed'
): Promise<Map<string, any>> {
  const byId = new Map<string, any>()
  const byTgId = new Map<string, any>()
  if (!rows?.length) return byId

  const authorIds = [
    ...new Set(rows.map((r: any) => getRowAuthorId(r)).filter((id: any) => id != null && id !== ''))
  ]
  const tgUserIds = [
    ...new Set(rows.map((r: any) => getRowTgUserId(r)).filter((id: any) => id != null && id !== ''))
  ]

  // 🩺 诊断：确认本页 row 里是否有 author 信息
  if (authorIds.length === 0 && tgUserIds.length === 0 && rows.length > 0) {
    const first = rows[0]
    console.warn(
      `[${logPrefix}] 本页无任何 author_id/tg_user_id，首条 row 键:`,
      Object.keys(first).filter((k) => /author|tg/i.test(k))
    )
  }
  if (authorIds.length > 0) {
    console.log(`[${logPrefix}] 批量查 profiles 按 id，前3个:`, authorIds.slice(0, 3))
  }

  if (authorIds.length > 0) {
    const { data: listById, error: errId } = await supabaseAdmin
      .from('profiles')
      .select(PROFILE_SAFE_FIELDS)
      .in('id', authorIds.slice(0, 500))
    if (errId) {
      console.error(`[${logPrefix}] 批量查 profiles 按 id 失败:`, errId)
    } else {
      console.log(`[${logPrefix}] 按 id 查到 profiles 条数:`, listById?.length ?? 0)
      if (listById?.length) {
        const first = listById[0]
        console.log(
          `[${logPrefix}] 首条 profile id=%s nickname=%s`,
          first?.id ?? '(空)',
          first?.nickname ?? '(空)'
        )
        for (const p of listById) {
          if (p?.id) byId.set(String(p.id), p)
        }
      }
    }
  }
  if (tgUserIds.length > 0) {
    const { data: listByTg, error: errTg } = await supabaseAdmin
      .from('profiles')
      .select(PROFILE_SAFE_FIELDS)
      .in('tg_user_id', tgUserIds.slice(0, 500))
    if (errTg) {
      console.error(`[${logPrefix}] 批量查 profiles 按 tg_user_id 失败:`, errTg)
    } else if (listByTg?.length) {
      for (const p of listByTg) {
        if (p?.tg_user_id != null) byTgId.set(String(p.tg_user_id), p)
      }
    }
  }

  const totalLoaded = byId.size + byTgId.size
  const needCount = Math.max(authorIds.length, tgUserIds.length, 1)
  console.log(
    `[${logPrefix}] 批量 profile: author_ids=${authorIds.length} tg_user_ids=${tgUserIds.length} 查到=${totalLoaded}`
  )
  if (needCount > 0 && totalLoaded === 0) {
    console.warn(
      `[${logPrefix}] 未查到任何 profile，请检查 profiles 表与 videos.author_id/tg_user_id 是否一致`
    )
  }

  const merged = new Map<string, any>()
  for (const p of byId.values()) {
    if (p?.id) merged.set(`id:${p.id}`, p)
  }
  for (const p of byTgId.values()) {
    if (p?.tg_user_id != null) merged.set(`tg:${p.tg_user_id}`, p)
  }
  return merged
}

/** 从 RPC 返回的 row 中读取 author_id（兼容不同列名/大小写） */
export function getRowAuthorId(row: any): string | null | undefined {
  if (!row) return undefined
  const v = row.author_id ?? row.Author_Id ?? row.author_Id
  return v != null && v !== '' ? String(v) : undefined
}

/** 从 RPC 返回的 row 中读取 tg_user_id（兼容不同列名/大小写） */
export function getRowTgUserId(row: any): string | number | null | undefined {
  if (!row) return undefined
  const v = row.tg_user_id ?? row.Tg_User_Id ?? row.tg_User_Id
  return v != null && v !== '' ? v : undefined
}

/** 根据 row 从 batchLoadAuthorProfiles 返回的 map 里取 profile */
export function getProfileForRow(row: any, profileMap: Map<string, any>): any {
  if (!row) return null
  const authorId = getRowAuthorId(row)
  const byId = authorId ? profileMap.get(`id:${authorId}`) : null
  if (byId) return byId
  const tgId = getRowTgUserId(row)
  const byTg = tgId != null ? profileMap.get(`tg:${tgId}`) : null
  return byTg ?? null
}

export function applyRowFlags(mapped: any, row: any) {
  const flags = row?.__userFlags
  if (!flags) return

  if (typeof flags.isLoved === 'boolean') {
    mapped.isLoved = flags.isLoved
  }
  if (typeof flags.isCollect === 'boolean') {
    mapped.isCollect = flags.isCollect
  }
  if (typeof flags.isAttention === 'boolean') {
    mapped.isAttention = flags.isAttention
  }
  // ✅ 应用关注状态到 author
  if (typeof flags.followStatus === 'number' && mapped.author) {
    mapped.author.follow_status = flags.followStatus
    mapped.author.is_follow = flags.followStatus > 0
  }
}

export async function attachUserFlags(rows: any[], userId?: string | null) {
  if (!userId || !rows?.length) return

  // 获取当前用户的 profile 信息（需要知道 tg_user_id）
  const { data: currentUserProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, tg_user_id')
    .eq('id', userId)
    .maybeSingle()

  const videoIds = rows.map((row) => row.id).filter(Boolean)
  const authorIds = rows.map((row) => row.author_id).filter(Boolean)

  // ✅ 查询双向关注（我关注的 + 关注我的）
  const [likesRes, collectsRes, followsRes, followedByRes] = await Promise.all([
    videoIds.length
      ? supabaseAdmin
          .from('video_likes')
          .select('video_id')
          .eq('user_id', userId)
          .in('video_id', videoIds)
      : Promise.resolve({ data: [] }),
    videoIds.length
      ? supabaseAdmin
          .from('video_collections')
          .select('video_id')
          .eq('user_id', userId)
          .in('video_id', videoIds)
      : Promise.resolve({ data: [] }),
    // 我关注的人
    authorIds.length
      ? supabaseAdmin
          .from('follows')
          .select('followee_id')
          .eq('follower_id', userId)
          .in('followee_id', authorIds)
      : Promise.resolve({ data: [] }),
    // 关注我的人
    authorIds.length
      ? supabaseAdmin
          .from('follows')
          .select('follower_id')
          .eq('followee_id', userId)
          .in('follower_id', authorIds)
      : Promise.resolve({ data: [] })
  ])

  const likeSet = new Set(likesRes.data?.map((row: any) => row.video_id))
  const collectSet = new Set(collectsRes.data?.map((row: any) => row.video_id))
  const followSet = new Set(followsRes.data?.map((row: any) => row.followee_id))
  const followedBySet = new Set(followedByRes.data?.map((row: any) => row.follower_id))

  rows.forEach((row) => {
    // 判断是否是自己的视频
    const isOwnVideoByAuthorId = row.author_id === userId
    const isOwnVideoByTgId =
      currentUserProfile?.tg_user_id && row.tg_user_id === currentUserProfile.tg_user_id
    const isOwnVideo = isOwnVideoByAuthorId || isOwnVideoByTgId

    // 判断关注状态
    const isFollowing = row.author_id ? followSet.has(row.author_id) : false
    const isFollowedBy = row.author_id ? followedBySet.has(row.author_id) : false
    const isMutualFollow = isFollowing && isFollowedBy

    row.__userFlags = {
      isLoved: likeSet.has(row.id),
      isCollect: collectSet.has(row.id),
      isAttention: isOwnVideo || isFollowing,
      // ✅ 关注状态：0=未关注, 1=已关注, 2=互相关注
      followStatus: isOwnVideo ? -1 : isMutualFollow ? 2 : isFollowing ? 1 : 0
    }
  })
}

export function formatCommentRow(row: any) {
  const profile = row.profiles || {}

  // 🎯 格式化地理位置信息
  let ipLocation = ''
  if (profile.country && profile.city) {
    ipLocation = `${profile.country} · ${profile.city}`
  } else if (profile.country) {
    ipLocation = profile.country
  } else if (profile.city) {
    ipLocation = profile.city
  }

  return {
    comment_id: row.id,
    content: row.content,
    create_time: Math.floor(new Date(row.created_at).getTime() / 1000),
    digg_count: row.like_count ?? 0,
    user_digged: false,
    user_buried: false,
    showChildren: false,
    sub_comment_count: 0,
    children: [],
    nickname: profile.nickname || profile.username || '用户',
    avatar: profile.avatar_url || DEFAULT_AVATAR,
    user_id: row.user_id,
    ip_location: ipLocation // 🎯 添加地理位置
  }
}
