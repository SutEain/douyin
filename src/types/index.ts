/**
 * 视频数据类型定义
 */

export interface VideoItem {
  aweme_id: string
  is_top?: boolean
  status?: 'draft' | 'ready' | 'published' | 'processing'
  is_private?: boolean
  // 成人内容标记
  is_adult?: boolean
  desc: string
  tags?: string[]
  create_time: number
  city?: string
  address?: string
  isLoved?: boolean
  isCollect?: boolean
  isAttention?: boolean
  // 🎯 内容类型：video=视频, image=单图, album=纯图文相册, collection=混排合集
  content_type?: 'video' | 'image' | 'album' | 'collection'
  // 🎯 媒体数组（用于 album 和 collection 类型）
  images?: Array<{
    type?: 'image' | 'video' // 默认为 image
    file_id: string
    url?: string // 完整链接
    play_url?: string // 视频播放链接
    cover_url?: string // 视频封面
    width?: number
    height?: number
    duration?: number
    order?: number
  }>
  statistics: {
    digg_count: number
    comment_count: number
    collect_count: number
    share_count: number
  }
  video: {
    duration: number
    width: number
    height: number
    play_addr: {
      url_list: string[]
    }
    cover?: {
      url_list: string[]
    }
    dynamic_cover?: {
      url_list: string[]
    }
    poster?: string
  }
  author: {
    nickname: string
    unique_id: string
    uid: string
    user_id?: string
    tg_user_id?: number | null
    avatar_thumb?: {
      url_list: string[]
    }
    avatar_168x168?: {
      url_list: string[]
    }
    avatar_300x300?: {
      url_list: string[]
    }
    cover_url?: Array<{
      url_list: string[]
    }>
    card_entries?: any[]
  }
}

export interface VideoListResponse {
  success: boolean
  data: {
    total: number
    list: VideoItem[]
  }
}
