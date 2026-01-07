/* global Deno */
// 文本工具

// 安全截断字符串（避免在emoji中间截断）
export function safeTruncate(str: string, maxLength: number): string {
  if (!str) return str
  // 使用 Array.from 正确处理 emoji 和其他 Unicode 字符
  const chars = Array.from(str)
  if (chars.length <= maxLength) {
    return str
  }
  return chars.slice(0, maxLength).join('') + '...'
}

// 从文本中提取标签（#开头，最多5个）
export function extractTags(text: string): string[] {
  if (!text) return []
  // 匹配 #标签（中文、英文、数字、下划线）
  const matches = text.match(/#[\w\u4e00-\u9fa5]+/g) || []
  // 去掉#号，去重，最多5个
  const tags = [...new Set(matches.map((t) => t.substring(1)))].slice(0, 5)
  return tags
}

// 转义 HTML 特殊字符
export function escapeHTML(str: string): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * 脱敏错误消息，防止 Token 泄漏
 */
export function sanitizeError(message: string): string {
  if (!message) return message
  // 从环境变量获取 Token (如果可用)
  const token = Deno.env.get('DICE_BOT_TOKEN')
  let sanitized = message
  if (token) {
    sanitized = sanitized.replaceAll(token, '****:****')
  }
  // 使用正则匹配可能的 Telegram Token 格式 (10位左右数字:40位左右字符)
  // 格式如: 1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ1234567890
  sanitized = sanitized.replace(/\d{8,13}:[a-zA-Z0-9_-]{32,45}/g, '****:****')
  return sanitized
}
