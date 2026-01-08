/**
 * 前端媒体文件 URL 处理工具
 * 🎯 纯 R2 架构版本：不再使用 Telegram CDN 代理
 */

// 1. 获取视频/图片的 R2 基础域名
const VIDEO_BASE_URL = import.meta.env.VITE_APP_VIDEO_BASE_URL || 'https://media.tgdouyin.com'

/**
 * 将路径或 ID 转换为最终的可访问 URL
 * 🎯 逻辑：确保所有相对路径都指向正确的媒体域名
 */
export function buildCdnUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return ''

  let result = ''
  // 1. 如果是完整 URL (http/https)，直接返回
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    result = pathOrUrl
  }
  // 2. 如果是相对路径 (R2 存储路径，如 /videos/xxx.mp4)
  else if (pathOrUrl.startsWith('/')) {
    const base = VIDEO_BASE_URL.endsWith('/') ? VIDEO_BASE_URL.slice(0, -1) : VIDEO_BASE_URL
    result = `${base}${pathOrUrl}`
  }
  // 3. 兼容没有前导斜杠的路径
  else if (pathOrUrl.startsWith('videos/')) {
    const base = VIDEO_BASE_URL.endsWith('/') ? VIDEO_BASE_URL : `${VIDEO_BASE_URL}/`
    result = `${base}${pathOrUrl}`
  }

  // 🎯 强制诊断日志：在控制台打印最终转换结果
  if (result) {
    console.log(`[MediaFix] URL 转换: ${pathOrUrl} -> ${result}`)
  }

  return result || pathOrUrl
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
