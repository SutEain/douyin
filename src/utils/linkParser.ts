/**
 * 链接解析工具
 * 用于在视频描述中识别和解析链接
 */

export interface ParsedLink {
  type: 'telegram_bot' | 'telegram_link' | 'url' | 'text'
  text: string
  url?: string
  botUsername?: string
  startParam?: string
}

/**
 * 解析文本中的链接
 * 支持格式：
 * - Markdown 风格链接: [文字](链接)
 * - Telegram Bot: @botname 或 @botname?start=xxx
 * - Telegram 链接: https://t.me/botname?start=xxx
 * - 普通链接: https://example.com
 */
export function parseLinks(text: string): ParsedLink[] {
  if (!text) return []

  const result: ParsedLink[] = []

  // 🎯 优先匹配 Markdown 风格链接 [文字](链接)
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  // 匹配 Telegram Bot (@botname 或 @botname?start=xxx)
  const telegramBotRegex = /@([a-zA-Z0-9_]{5,32})(\?start=([^\s)]+))?/g
  // 匹配 Telegram 链接 (https://t.me/botname?start=xxx)
  const telegramLinkRegex = /https?:\/\/(?:www\.)?t\.me\/([a-zA-Z0-9_]{5,32})(\?start=([^\s)]+))?/g
  // 匹配普通 URL（排除已经在 Markdown 链接中的）
  const urlRegex = /https?:\/\/[^\s)]+/g

  let lastIndex = 0
  const matches: Array<{
    type: string
    match: RegExpMatchArray
    index: number
    linkText?: string
  }> = []

  // 🎯 先收集 Markdown 风格链接（优先级最高）
  let match
  while ((match = markdownLinkRegex.exec(text)) !== null) {
    matches.push({
      type: 'markdown_link',
      match,
      index: match.index,
      linkText: match[1] // 保存链接文字
    })
  }
  markdownLinkRegex.lastIndex = 0

  // 收集其他匹配项（但要排除已经在 Markdown 链接中的）
  while ((match = telegramBotRegex.exec(text)) !== null) {
    // 检查是否在 Markdown 链接中
    const isInMarkdown = matches.some(
      (m) =>
        m.type === 'markdown_link' &&
        match.index >= m.index &&
        match.index < m.index + m.match[0].length
    )
    if (!isInMarkdown) {
      matches.push({ type: 'telegram_bot', match, index: match.index })
    }
  }
  telegramBotRegex.lastIndex = 0

  while ((match = telegramLinkRegex.exec(text)) !== null) {
    const isInMarkdown = matches.some(
      (m) =>
        m.type === 'markdown_link' &&
        match.index >= m.index &&
        match.index < m.index + m.match[0].length
    )
    if (!isInMarkdown) {
      matches.push({ type: 'telegram_link', match, index: match.index })
    }
  }
  telegramLinkRegex.lastIndex = 0

  while ((match = urlRegex.exec(text)) !== null) {
    const isInMarkdown = matches.some(
      (m) =>
        m.type === 'markdown_link' &&
        match.index >= m.index &&
        match.index < m.index + m.match[0].length
    )
    // 排除已经在 Markdown 链接中的，以及 Telegram 链接
    if (!isInMarkdown && !match[0].includes('t.me/')) {
      matches.push({ type: 'url', match, index: match.index })
    }
  }
  urlRegex.lastIndex = 0

  // 按位置排序
  matches.sort((a, b) => a.index - b.index)

  // 处理每个匹配项
  for (const { type, match, index, linkText } of matches) {
    // 添加匹配前的文本
    if (index > lastIndex) {
      const textPart = text.substring(lastIndex, index)
      if (textPart) {
        result.push({ type: 'text', text: textPart })
      }
    }

    // 添加链接
    if (type === 'markdown_link') {
      const url = match[2]
      // 判断链接类型
      if (url.startsWith('@') || url.includes('t.me/')) {
        // Telegram 链接
        const telegramMatch = url.match(/t\.me\/([a-zA-Z0-9_]{5,32})(\?start=([^\s)]+))?/)
        if (telegramMatch) {
          result.push({
            type: 'telegram_link',
            text: linkText || url,
            url: url.startsWith('@') ? `https://t.me/${url.substring(1)}` : url,
            botUsername: telegramMatch[1],
            startParam: telegramMatch[3] || undefined
          })
        } else {
          // 普通 Telegram Bot
          const botMatch = url.match(/@([a-zA-Z0-9_]{5,32})(\?start=([^\s)]+))?/)
          if (botMatch) {
            result.push({
              type: 'telegram_bot',
              text: linkText || url,
              url: `https://t.me/${botMatch[1]}${botMatch[3] ? `?start=${botMatch[3]}` : ''}`,
              botUsername: botMatch[1],
              startParam: botMatch[3] || undefined
            })
          } else {
            result.push({
              type: 'url',
              text: linkText || url,
              url
            })
          }
        }
      } else {
        // 普通链接
        result.push({
          type: 'url',
          text: linkText || url,
          url
        })
      }
    } else if (type === 'telegram_bot') {
      const botUsername = match[1]
      const startParam = match[3] || undefined
      const url = `https://t.me/${botUsername}${startParam ? `?start=${startParam}` : ''}`
      result.push({
        type: 'telegram_bot',
        text: match[0],
        url,
        botUsername,
        startParam
      })
    } else if (type === 'telegram_link') {
      const botUsername = match[1]
      const startParam = match[3] || undefined
      result.push({
        type: 'telegram_link',
        text: match[0],
        url: match[0],
        botUsername,
        startParam
      })
    } else if (type === 'url') {
      result.push({
        type: 'url',
        text: match[0],
        url: match[0]
      })
    }

    lastIndex = index + match[0].length
  }

  // 添加剩余的文本
  if (lastIndex < text.length) {
    const textPart = text.substring(lastIndex)
    if (textPart) {
      result.push({ type: 'text', text: textPart })
    }
  }

  return result.length > 0 ? result : [{ type: 'text', text }]
}

/**
 * 打开链接
 * 在 Telegram WebApp 中使用适当的 API
 */
export function openLink(link: ParsedLink) {
  if (!link.url) return

  const tgWebApp = (window as any).Telegram?.WebApp

  if (!tgWebApp) {
    // 非 Telegram 环境，使用普通方式打开
    window.open(link.url, '_blank', 'noopener,noreferrer')
    return
  }

  // Telegram 链接使用 openTelegramLink
  if (link.type === 'telegram_bot' || link.type === 'telegram_link') {
    try {
      tgWebApp.openTelegramLink(link.url)
    } catch (error) {
      console.error('打开 Telegram 链接失败:', error)
      // 降级处理
      window.open(link.url, '_blank', 'noopener,noreferrer')
    }
  } else {
    // 普通链接使用 openLink
    try {
      tgWebApp.openLink(link.url, { try_instant_view: false })
    } catch (error) {
      console.error('打开链接失败:', error)
      // 降级处理
      window.open(link.url, '_blank', 'noopener,noreferrer')
    }
  }
}
