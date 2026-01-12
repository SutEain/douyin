/**
 * 环境检测工具函数
 * 🎯 用于严格检测是否在 Telegram WebApp (miniAPP) 环境中
 *
 * 重要原则：
 * - 在 miniAPP 环境中，绝对不允许显示 Web 版登录
 * - 宁可误判为 Telegram 环境，也不能误判为浏览器环境
 */

/**
 * 检测是否在浏览器环境（非 Telegram WebApp）
 *
 * @returns true = 浏览器环境（可以显示 Web 版登录）
 *          false = Telegram WebApp 环境（禁止显示 Web 版登录）
 */
export function isBrowserEnvironment(): boolean {
  // 开发环境强制认为是浏览器环境
  const host = window.location.hostname
  const isDev =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.test') ||
    host.endsWith('.local')

  if (isDev) {
    return true
  }

  // 🎯 优先检查 URL 中是否有 Telegram WebApp 数据（最可靠的标识）
  const hasTgData =
    window.location.href.includes('tgWebAppData') ||
    window.location.hash.includes('tgWebAppData') ||
    window.location.search.includes('tgWebAppData')

  if (hasTgData) {
    return false // 有 Telegram 数据，不是浏览器环境
  }

  // 🎯 检查 User Agent（Telegram WebApp 的 User Agent 通常包含 "Telegram"）
  const uaTelegram = /Telegram/i.test(navigator.userAgent)
  if (uaTelegram) {
    return false // Telegram User Agent，不是浏览器环境
  }

  // 🎯 检查 Referrer（从 Telegram 打开的应用会有 Telegram 相关的 referrer）
  const refTelegram = /t\.me|telegram\.org|telegram\.me|web\.telegram\.org/i.test(
    document.referrer || ''
  )
  if (refTelegram) {
    return false // Telegram Referrer，不是浏览器环境
  }

  // 🎯 检查是否是真实的 Telegram WebApp（排除降级对象）
  const tgWebApp = window.Telegram?.WebApp
  if (tgWebApp) {
    // 🚨 关键修复：即使 version 是 'fallback' 或 platform 是 'unknown'，
    // 只要存在 Telegram.WebApp 对象，就应该认为是 Telegram 环境
    // 因为降级对象只在浏览器环境中创建，如果存在说明可能是 Telegram 环境

    // 检查是否是真实的 Telegram WebApp（有 initData 或 platform 不是 'unknown'）
    const hasRealTelegramObj =
      (tgWebApp.version !== 'fallback' && tgWebApp.platform !== 'unknown') ||
      (tgWebApp.initData && tgWebApp.initData.length > 0) ||
      // 🎯 新增：检查 platform 是否是有效的 Telegram 平台
      (tgWebApp.platform &&
        ['ios', 'android', 'tdesktop', 'web', 'macos', 'windows', 'linux'].includes(
          tgWebApp.platform
        ))

    if (hasRealTelegramObj) {
      return false // 有真实的 Telegram WebApp 对象，不是浏览器环境
    }

    // 🚨 关键修复：如果 Telegram.WebApp 存在但可能是降级对象，
    // 需要进一步检查：如果 URL 中没有明确的浏览器标识，保守地认为是 Telegram 环境
    // 这样可以避免在 miniAPP 中误显示 Web 版登录
    const url = window.location.href.toLowerCase()
    const isExplicitBrowserUrl =
      url.includes('localhost') ||
      url.includes('127.0.0.1') ||
      url.includes('.test') ||
      url.includes('.local')

    if (!isExplicitBrowserUrl) {
      // 🎯 保守策略：如果 URL 不是明确的开发环境，且存在 Telegram.WebApp 对象，
      // 即使可能是降级对象，也认为是 Telegram 环境（避免误显示 Web 版登录）
      return false
    }
  }

  // 🎯 如果以上都不满足，认为是浏览器环境
  return true
}

/**
 * 检测是否在 Telegram WebApp 环境
 *
 * @returns true = Telegram WebApp 环境
 *          false = 浏览器环境
 */
export function isTelegramWebAppEnvironment(): boolean {
  return !isBrowserEnvironment()
}
