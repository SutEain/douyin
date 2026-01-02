/**
 * 媒体文件URL处理工具
 */

// 期望配置为：
// - https://douyin-videos.xxx.com            (推荐，会自动拼 /tg/<file_id>)
// - https://douyin-videos.xxx.com/tg         (也支持)
// - https://douyin-videos.xxx.com/?file_id=  (历史兼容)
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

  // 3. 如果是 file_id，转换为 CDN 代理 URL
  if (!CF_WORKER_URL) {
    console.warn('[buildCdnUrl] CF Worker URL not configured')
    return ''
  }

  const base = String(CF_WORKER_URL).replace(/\/$/, '')
  // ... (保留原有的 query 和 /tg 逻辑)
  if (base.includes('?')) {
    const join = base.endsWith('?') || base.endsWith('&') ? '' : base.includes('=') ? '' : ''
    const sep = base.includes('file_id=') ? '' : base.includes('?') ? '&' : '?'
    return `${base}${join}${sep}file_id=${encodeURIComponent(fileIdOrUrl)}`
  }

  if (base.endsWith('/tg')) {
    return `${base}/${encodeURIComponent(fileIdOrUrl)}`
  }
  return `${base}/tg/${encodeURIComponent(fileIdOrUrl)}`
}

/**
 * 获取视频播放URL
 */
export function getVideoPlayUrl(record: any): string {
  // 优先使用 play_url（大文件OSS方案）
  if (record.play_url) {
    return buildCdnUrl(record.play_url)
  }

  // 其次使用 tg_file_id（Telegram小文件）
  if (record.tg_file_id) {
    return buildCdnUrl(record.tg_file_id)
  }

  return ''
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
      if (first.type === 'video' && first.cover_url) {
        return buildCdnUrl(first.cover_url)
      }
      // 否则用 file_id (图片或视频原文件，buildCdnUrl 会处理)
      return buildCdnUrl(first.file_id)
    }
  }

  // 4. 最后兜底：如果是视频且有 tg_file_id
  if (record.tg_file_id) {
    return buildCdnUrl(record.tg_file_id)
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
