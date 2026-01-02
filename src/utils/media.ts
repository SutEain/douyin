/**
 * 前端媒体文件 URL 处理工具
 */

// CF Worker CDN URL（从环境变量获取）
const CF_WORKER_URL = import.meta.env.VITE_TG_CDN_PROXY_URL || ''

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
 */
export function buildCdnUrl(fileIdOrUrl: string): string {
  if (!fileIdOrUrl) return ''

  // 1. 🎯 如果已经是完整 URL（包含 R2 域名或直链），直接返回，不再走 Worker 代理
  if (fileIdOrUrl.startsWith('http://') || fileIdOrUrl.startsWith('https://')) {
    return fileIdOrUrl
  }

  // 2. 🎯 如果是相对路径 (R2 转存路径，如 /videos/xxx.mp4)
  if (fileIdOrUrl.startsWith('/')) {
    // 优先使用视频 R2 域名 (VITE_APP_VIDEO_BASE_URL)
    const baseUrl = import.meta.env.VITE_APP_VIDEO_BASE_URL || ''
    if (baseUrl) {
      const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
      return `${base}${fileIdOrUrl}`
    }
  }

  // 3. 🎯 只有确实是 file_id 且没有直链时，才走 Worker 代理（用于查看正在处理中或未搬家的老视频）
  if (!CF_WORKER_URL) {
    console.warn('[buildCdnUrl] CF Worker URL not configured')
    return ''
  }

  const base = CF_WORKER_URL.endsWith('/') ? CF_WORKER_URL.slice(0, -1) : CF_WORKER_URL
  return `${base}?file_id=${encodeURIComponent(fileIdOrUrl)}`
}

/**
 * 获取封面URL
 */
export function getCoverUrl(record: any): string {
  // 1. 优先使用记录自带的 cover_url
  if (record.cover_url) {
    return buildCdnUrl(record.cover_url)
  }

  // 2. 其次使用缩略图 file_id
  if (record.tg_thumbnail_file_id) {
    return buildCdnUrl(record.tg_thumbnail_file_id)
  }

  // 3. 📸 对于图片/相册/合集：提取媒体列表中的第一项
  const contentType = record.content_type || 'video'
  if (contentType === 'image' || contentType === 'album' || contentType === 'collection') {
    const mediaList = parseImages(record.media_list || record.images)
    if (mediaList.length > 0) {
      const first = mediaList[0]
      // 如果第一项是视频，优先用视频封面
      if (first.type === 'video' && (first.cover_url || first.url)) {
        return buildCdnUrl(first.cover_url || first.url)
      }
      return buildCdnUrl(first.file_id)
    }
  }

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
  duration?: number
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
 * 获取内容类型
 */
export function getContentType(item: any): 'video' | 'image' | 'album' | 'collection' {
  return item?.content_type || 'video'
}
