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
 * 将 Telegram file_id 转换为 CDN URL
 */
export function buildCdnUrl(fileIdOrUrl: string): string {
  if (!fileIdOrUrl) return ''

  // 如果已经是完整 URL，直接返回
  if (fileIdOrUrl.startsWith('http://') || fileIdOrUrl.startsWith('https://')) {
    return fileIdOrUrl
  }

  // 如果是 file_id，转换为 CDN URL
  if (!CF_WORKER_URL) {
    console.warn('[buildCdnUrl] CF Worker URL not configured')
    return ''
  }

  const base = CF_WORKER_URL.endsWith('/') ? CF_WORKER_URL.slice(0, -1) : CF_WORKER_URL
  return `${base}?file_id=${encodeURIComponent(fileIdOrUrl)}`
}

/**
 * 解析 images 字段
 */
export function parseImages(
  images: any
): Array<{ file_id: string; width?: number; height?: number; order?: number }> {
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
export function getContentType(item: any): 'video' | 'image' | 'album' {
  return item?.content_type || 'video'
}
