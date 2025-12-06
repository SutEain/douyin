/**
 * 视频数据类型定义
 */

export interface VideoItem {
  aweme_id: string
  is_top?: boolean
  status?: 'draft' | 'ready' | 'published' | 'processing'
  is_private?: boolean
  desc: string
  tags?: string[]
  create_time: number
  city?: string
  address?: string
  isLoved?: boolean
  isCollect?: boolean
  isAttention?: boolean
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

