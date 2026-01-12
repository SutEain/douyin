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
    // 🎯 关键：准确识别降级对象
    // 降级对象的特点：version='fallback' 且 platform='unknown' 且没有 initData
    const isFallbackObject =
      tgWebApp.version === 'fallback' &&
      tgWebApp.platform === 'unknown' &&
      (!tgWebApp.initData || tgWebApp.initData.length === 0)

    // 如果是降级对象，说明是浏览器环境（降级对象只在浏览器环境中创建）
    if (isFallbackObject) {
      return true // 是浏览器环境
    }

    // 检查是否是真实的 Telegram WebApp
    const hasRealTelegramObj =
      (tgWebApp.version !== 'fallback' && tgWebApp.platform !== 'unknown') ||
      (tgWebApp.initData && tgWebApp.initData.length > 0) ||
      // 🎯 检查 platform 是否是有效的 Telegram 平台
      (tgWebApp.platform &&
        ['ios', 'android', 'tdesktop', 'web', 'macos', 'windows', 'linux'].includes(
          tgWebApp.platform
        ))

    if (hasRealTelegramObj) {
      return false // 有真实的 Telegram WebApp 对象，不是浏览器环境
    }

    // 🚨 如果既不是降级对象，也不是真实的 Telegram WebApp，可能是中间状态
    // 此时需要更严格的判断：检查是否有其他 Telegram 标识
    // 如果没有其他标识，且是降级对象的特征，认为是浏览器环境
    if (
      !tgWebApp.initData ||
      tgWebApp.initData.length === 0 ||
      tgWebApp.version === 'fallback' ||
      tgWebApp.platform === 'unknown'
    ) {
      // 没有 initData 且是降级特征，认为是浏览器环境
      return true
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
