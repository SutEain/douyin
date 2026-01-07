/**
 * 前端媒体文件 URL 处理工具
 * 🎯 纯 R2 架构版本：不再使用 Telegram CDN 代理
 */

// 1. 获取视频/图片的 R2 基础域名
const VIDEO_BASE_URL = import.meta.env.VITE_APP_VIDEO_BASE_URL || ''

/**
 * 将路径或 ID 转换为最终的可访问 URL
 * 🎯 逻辑：只处理 R2 直链和相对路径，不再代理 Telegram file_id
 */
export function buildCdnUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return ''

  // 1. 如果是完整 URL (http/https)，直接返回
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    return pathOrUrl
  }

  // 2. 如果是相对路径 (R2 存储路径，如 /videos/xxx.mp4)
  if (pathOrUrl.startsWith('/')) {
    const base = VIDEO_BASE_URL.endsWith('/') ? VIDEO_BASE_URL.slice(0, -1) : VIDEO_BASE_URL
    return `${base}${pathOrUrl}`
  }

  // 3. 🎯 如果是 Telegram file_id (不以 / 或 http 开头)
  // 在纯 R2 架构下，前端不应该再通过代理去请求这些 ID
  // 我们返回空，强制用户等待 Worker 处理完成后的 R2 地址
  console.warn('[buildCdnUrl] 检测到未搬家的 Telegram file_id，请等待 Worker 处理:', pathOrUrl)
  return ''
}

/**
 * 获取封面URL
 */
export function getCoverUrl(record: any): string {
  // 1. 优先使用记录自带的 cover_url (Worker 处理后会填入 R2 地址)
  if (record.cover_url) {
    return buildCdnUrl(record.cover_url)
  }

  // 2. 📸 对于图片/相册/合集：尝试从媒体列表中提取第一项的 R2 地址
  const contentType = record.content_type || 'video'
  if (contentType === 'image' || contentType === 'album' || contentType === 'collection') {
    const mediaList = parseImages(record.media_list || record.images)
    if (mediaList.length > 0) {
      const first = mediaList[0]
      // 优先使用子项已经生成的 play_url 或 cover_url
      const target = first.cover_url || first.play_url || first.url
      if (target && (target.startsWith('/') || target.startsWith('http'))) {
        return buildCdnUrl(target)
      }
    }
  }

  // 3. 🎯 彻底废弃 tg_thumbnail_file_id 回退
  // 因为那个地址是临时的，Token 一换就废了，我们只信任 R2
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
