/**
 * 媒体文件URL处理工具
 */

// 期望配置为：
// - https://douyin-videos.xxx.com            (推荐，会自动拼 /tg/<file_id>)
// 🎯 纯 R2 架构版本：不再使用 Telegram CDN 代理
// const CF_WORKER_URL = import.meta.env.VITE_TG_CDN_PROXY_URL || ''

/**
 * 判断是否是 Telegram file_id
 */
export function isTelegramFileId(str: string): boolean {
  if (!str) return false
  // Telegram file_id 通常不包含 http/https 且长度较长
  return !str.startsWith('http://') && !str.startsWith('https://') && str.length > 20
}

/**
 * 将 Telegram file_id 或相对路径转换为 CDN URL
 * 🎯 纯 R2 架构版本：不再使用 Telegram CDN 代理
 */
export function buildCdnUrl(fileIdOrUrl: string): string {
  if (!fileIdOrUrl) return ''

  // 1. 如果已经是完整URL，直接返回
  if (fileIdOrUrl.startsWith('http://') || fileIdOrUrl.startsWith('https://')) {
    return fileIdOrUrl
  }

  // 2. 如果是相对路径 (R2 转存路径)
  if (fileIdOrUrl.startsWith('/')) {
    const baseUrl =
      import.meta.env.VITE_APP_VIDEO_BASE_URL || import.meta.env.VITE_APP_API_BASE_URL || ''
    const base = String(baseUrl).replace(/\/$/, '')
    return `${base}${fileIdOrUrl}`
  }

  // 3. 🎯 如果是 file_id，在纯 R2 架构下不再代理
  // 后台预览也强制走 R2，如果没有搬家则显示为空，提示需要补救
  console.warn('[buildCdnUrl] 检测到未搬家的 Telegram file_id:', fileIdOrUrl)
  return ''
}

/**
 * 获取视频播放URL
 */
export function getVideoPlayUrl(record: any): string {
  // 1. 优先使用 play_url（R2 方案）
  if (record.play_url) {
    return buildCdnUrl(record.play_url)
  }

  // 🎯 纯 R2 架构不再支持 tg_file_id 播放
  return ''
}

/**
 * 获取封面URL
 */
export function getCoverUrl(record: any): string {
  // 1. 优先使用记录自带的 cover_url (R2)
  if (record.cover_url) {
    return buildCdnUrl(record.cover_url)
  }

  // 2. 📸 对于图片/相册/合集：提取媒体列表中的第一项
  const contentType = record.content_type || 'video'
  if (contentType === 'image' || contentType === 'album' || contentType === 'collection') {
    const mediaList = parseImages(record.media_list || record.images)
    if (mediaList.length > 0) {
      const first = mediaList[0]
      // 优先使用已经生成的 R2 地址 (play_url, cover_url, url)
      const target = first.cover_url || first.play_url || first.url
      if (target && (target.startsWith('/') || target.startsWith('http'))) {
        return buildCdnUrl(target)
      }
    }
  }

  // 🎯 彻底废弃 tg_thumbnail_file_id 和 tg_file_id 兜底
  return ''
}

/**
 * 解析媒体列表 (兼容 images 和 media_list)
 */
export function parseImages(images: any): Array<{
  type?: 'image' | 'video'
  file_id: string
  url?: string
  play_url?: string
  cover_url?: string
  width?: number
  height?: number
  order?: number
}> {
  if (!images) return []
  if (typeof images === 'string') {
    try {
      return JSON.parse(images)
    } catch {
      return []
    }
  }
  return Array.isArray(images) ? images : []
}

/**
 * 获取内容类型信息
 */
export function getContentTypeInfo(contentType: string): {
  text: string
  icon: string
  color: string
} {
  switch (contentType) {
    case 'image':
      return { text: '图片', icon: '🖼️', color: 'green' }
    case 'album':
      return { text: '相册', icon: '📷', color: 'blue' }
    case 'collection':
      return { text: '合集', icon: '📦', color: 'orange' }
    case 'video':
    default:
      return { text: '视频', icon: '🎬', color: 'purple' }
  }
}
