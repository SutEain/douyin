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
  const coverUrl = await buildCoverUrl(row, profile)
  const avatar = profile?.avatar_url || DEFAULT_AVATAR
  const videoUrl = await buildVideoUrl(row)

  if (!videoUrl) return null

  const authorCoverList = Array.isArray(profile?.cover_url)
    ? profile.cover_url
    : [
        {
          url_list: profile?.cover_url ? [profile.cover_url] : []
        }
      ]
  const authorCardEntries = Array.isArray(profile?.card_entries) ? profile.card_entries : []

  return {
    aweme_id: typeof row.id === 'string' ? row.id : String(row.id),
    is_top: !!row.is_top,
    status: row.status || 'published', // ✅ 添加视频状态 (draft/ready/published)
    is_private: !!row.is_private, // ✅ 添加私密标记
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
      // ✅ UserPanel 需要的额外字段（使用数据库实际字段名）
      signature: profile?.bio || '', // bio 就是签名
      total_favorited: profile?.total_likes || 0,
      following_count: profile?.following_count || 0,
      mplatform_followers_count: profile?.follower_count || 0, // 正确字段名：follower_count
      follower_count: profile?.follower_count || 0, // 正确字段名：follower_count
      follow_status: 0, // 0=未关注, 1=已关注, 2=互相关注 (由 applyRowFlags 更新)
      is_follow: false,
      // ✅ 年龄、性别、地区等信息
      user_age: profile?.birthday ? calculateAge(profile.birthday) : -1, // 从 birthday 计算年龄
      gender: profile?.gender || 0, // 0=未知, 1=男, 2=女
      ip_location: profile?.country || '',
      province: profile?.province || '',
      city: profile?.city || '',
      country: profile?.country || '',
      // 🎯 数字ID和隐私设置
      numeric_id: profile?.numeric_id || null,
      show_collect: profile?.show_collect !== false,
      show_like: profile?.show_like !== false,
      show_tg_username: profile?.show_tg_username === true
    }
  }
}

export async function buildVideoUrl(row: any): Promise<string | null> {
  if (row.storage_type === 'telegram' && row.tg_file_id) {
    return buildTelegramFileUrl(row.tg_file_id)
  }

  return row.play_url || null
}

export async function buildCoverUrl(row: any, profile: any): Promise<string> {
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

  if (TG_FILE_PROXY_URL) {
    const base = TG_FILE_PROXY_URL.endsWith('/')
      ? TG_FILE_PROXY_URL.slice(0, -1)
      : TG_FILE_PROXY_URL
    return `${base}?file_id=${encodeURIComponent(fileId)}`
  }

  if (!TG_BOT_TOKEN) {
    console.warn('[app-server] Missing TG_BOT_TOKEN, cannot build Telegram URL')
    return null
  }

  const apiUrl = `https://api.telegram.org/bot${TG_BOT_TOKEN}/getFile?file_id=${fileId}`
  const resp = await fetch(apiUrl)
  const data = await resp.json()
  if (!data.ok) {
    console.error('[app-server] getFile failed:', data)
    return null
  }
  const filePath = data.result.file_path
  return `https://api.telegram.org/file/bot${TG_BOT_TOKEN}/${filePath}`
}

export async function convertMediaReferenceToUrl(value?: string): Promise<string | null> {
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  return buildTelegramFileUrl(value)
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
