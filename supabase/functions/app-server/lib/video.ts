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
                // 🎯 优先使用已有的 play_url (R2 完整路径)，避免重新生成指向 CDN 的旧链接
                if (item.play_url && /^https?:\/\//i.test(item.play_url)) {
                  mappedItem.url = item.play_url
                } else if (item.url && /^https?:\/\//i.test(item.url)) {
                  mappedItem.url = item.url
                } else {
                  // 只有确实没有直链时才走代理
                  mappedItem.url = await buildTelegramFileUrl(item.file_id)
                }

                // 如果是视频且没有 play_url，尝试构建
                if (item.type === 'video' && !mappedItem.play_url) {
                  mappedItem.play_url = mappedItem.url
                }
              }
              // 如果是视频且有封面 file_id，也转换它
              if (
                item.type === 'video' &&
                item.cover_url &&
                !/^https?:\/\//i.test(item.cover_url)
              ) {
                mappedItem.cover_url = await buildTelegramFileUrl(item.cover_url)
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
        nickname: profile?.nickname || profile?.username || 'Telegram 用户',
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
      }

      // 🎯 Telegram file_id 不再支持，直接跳过
      // 如果 media_list 中的 cover_url 是 file_id，会被跳过，继续检查 row.cover_url
    }
  }

  // 🎯 HLS 视频特殊处理：如果 cover_url 是 thumb_{file_id}.jpg 格式，需要根据 play_url 构建路径
  if (row.is_hls && row.play_url && row.cover_url) {
    const playUrl = row.play_url
    const coverUrl = row.cover_url.trim()

    // 如果 play_url 是 HLS 格式：/videos/{uuid}/{file_id}/index.m3u8
    // 封面应该是：/videos/{uuid}/thumb_{file_id}.jpg
    if (playUrl.includes('.m3u8')) {
      // 情况1：cover_url 是 thumb_{file_id}.jpg（没有路径前缀）
      if (coverUrl.startsWith('thumb_') && coverUrl.endsWith('.jpg') && !coverUrl.includes('/')) {
        // 从 play_url 提取路径：/videos/{uuid}/{file_id}/index.m3u8 -> /videos/{uuid}
        const playUrlMatch = playUrl.match(/^(\/videos\/[^/]+)\//)
        if (playUrlMatch) {
          const videoDir = playUrlMatch[1]
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
  // 🎯 完整 URL：直接返回
  if (/^https?:\/\//i.test(value)) return value
  // 🎯 相对路径（R2 存储路径）：直接返回，前端会通过 buildCdnUrl 处理
  if (value.startsWith('/')) return value
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

  let query
  if (row.author_id) {
    query = supabaseAdmin.from('profiles').select('*').eq('id', row.author_id).maybeSingle()
  } else if (row.tg_user_id) {
    query = supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('tg_user_id', row.tg_user_id)
      .maybeSingle()
  }

  const { data } = query ? await query : { data: null }
  if (cacheKey) {
    cache.set(cacheKey, data)
  }
  return data
}

export async function getProfileById(id: string) {
  if (!id) return null
  const { data } = await supabaseAdmin.from('profiles').select('*').eq('id', id).maybeSingle()
  return data
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
