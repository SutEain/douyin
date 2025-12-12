// 文本工具（仅重构，不改行为）

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
