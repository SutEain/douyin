/* global Deno */
// 文本工具

// 安全截断字符串（避免在emoji中间截断）
export function safeTruncate(str: string, maxLength: number): string {
  if (!str) return str
  const chars = Array.from(str)
  if (chars.length <= maxLength) {
    return str
  }
  return chars.slice(0, maxLength).join('') + '...'
}

// 从文本中提取标签（#开头，最多5个）
export function extractTags(text: string): string[] {
  if (!text) return []
  const matches = text.match(/#[\w\u4e00-\u9fa5]+/g) || []
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
  const token = Deno.env.get('DICE_BOT_TOKEN')
  let sanitized = message
  if (token) {
    sanitized = sanitized.replaceAll(token, '****:****')
  }
  sanitized = sanitized.replace(/\d{8,13}:[a-zA-Z0-9_-]{32,45}/g, '****:****')
  return sanitized
}
