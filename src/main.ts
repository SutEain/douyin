import { createApp } from 'vue'

// ✅ 允许控制台输出（开发和排查阶段）
if (
  import.meta.env.PROD &&
  !window.location.search.includes('debug=1') &&
  !window.location.search.includes('console=1')
) {
  // 如果需要彻底禁用，可以取消下面的注释
  /*
  const noop = () => {}
  const consoleMethods: (keyof Console)[] = [
    'log',
    'info',
    'debug',
    // 'warn',
    // 'error',
    'trace',
    'table',
    'group',
    'groupCollapsed',
    'groupEnd',
    'time',
    'timeEnd',
    'count',
    'assert'
  ]
  // ...
  */
}

console.log('[Main] App Starting...')
console.log('[Main] Environment:', import.meta.env.MODE)
console.log('[Main] UserAgent:', navigator.userAgent)
console.log('[Main] Screen:', { width: window.innerWidth, height: window.innerHeight })

import App from './App.vue'
import './assets/less/index.less'
import router from './router'
import mixin from './utils/mixin'
import VueLazyload from '@jambonn/vue-lazyload'
import { createPinia } from 'pinia'
import { useClick } from '@/utils/hooks/useClick'
import bus, { EVENT_KEY } from '@/utils/bus'
import i18n from '@/locales'
import { startWatchTimeHeartbeat, stopWatchTimeHeartbeat } from '@/utils/watchTimeHeartbeat'

declare global {
  interface Window {
    TelegramGameProxy?: {
      receiveEvent?: (...args: any[]) => void
    }
    __rawConsole__?: Console
  }
}

if (typeof window !== 'undefined') {
  window.TelegramGameProxy = window.TelegramGameProxy || {}
  if (typeof window.TelegramGameProxy.receiveEvent !== 'function') {
    window.TelegramGameProxy.receiveEvent = () => {}
  }

  const fallbackImage = new URL('./assets/img/icon/img-loading.png', import.meta.url).href

  const handleGlobalError = (event: Event | ErrorEvent) => {
    const target = event?.target
    const errorEvent = event as ErrorEvent

    // 🎯 过滤浏览器扩展/开发者工具注入脚本的错误（inspector.js）
    if (
      errorEvent.filename?.includes('inspector.js') ||
      errorEvent.filename?.includes('extension://') ||
      errorEvent.message?.includes('responseText') ||
      errorEvent.message?.includes('responseType') ||
      errorEvent.message?.includes('arraybuffer')
    ) {
      // 静默忽略这些错误，不影响应用运行
      event.preventDefault?.()
      return false
    }

    if (target instanceof HTMLImageElement) {
      if (!target.dataset.fallbackApplied) {
        target.dataset.fallbackApplied = '1'
        target.src = fallbackImage
      }
      event.preventDefault?.()
      return false
    }

    if (target instanceof HTMLVideoElement) {
      // ✅ 不再打印"视频URL"，也不要 preventDefault 以免影响播放器/第三方库接管错误处理
      // 需要排查时可在 URL 加 ?dpdebug=1 看 DPPlayer 的详细日志
      return false
    }

    // ✅ 处理 <source> 标签加载失败（通常是网络问题，不应中断播放）
    if (target instanceof HTMLSourceElement) {
      // 同上：不拦截也不刷屏
      return false
    }

    // ✅ 过滤 Vercel Analytics/Speed Insights 脚本在本地环境的 404 报错（保持控制台整洁）
    if (target instanceof HTMLScriptElement) {
      const src = target.src || ''
      if (src.includes('_vercel/insights') || src.includes('_vercel/speed-insights')) {
        return false
      }
      // ✅ 优化：Telegram WebApp 脚本加载失败不阻止应用运行
      if (src.includes('telegram.org/js/telegram-web-app.js')) {
        console.warn('[Script Error] Telegram WebApp 脚本加载失败，使用降级方案')
        return false // 不阻止应用继续运行
      }
    }

    console.warn('[GlobalError]', errorEvent.message || errorEvent.error || event)
    event.preventDefault?.()
    return false
  }

  const handleRejection = (event: PromiseRejectionEvent) => {
    // Ignore AbortError as it's usually intentional (e.g. cancelling a fetch or play() interrupted)
    if (event.reason?.name === 'AbortError' || event.reason?.message?.includes('aborted')) {
      event.preventDefault?.()
      return
    }

    // 🎯 过滤浏览器扩展/开发者工具相关的错误
    const message = event.reason?.message || String(event.reason || '')
    if (
      message.includes('responseText') ||
      message.includes('responseType') ||
      message.includes('arraybuffer') ||
      message.includes('XMLHttpRequest')
    ) {
      // 静默忽略这些错误，不影响应用运行
      event.preventDefault?.()
      return
    }

    console.warn('[UnhandledRejection]', event.reason)
    event.preventDefault?.()
  }

  window.addEventListener('error', handleGlobalError, true)
  window.addEventListener('unhandledrejection', handleRejection)
}

window.isMoved = false
window.isMuted = true
window.showMutedNotice = true

const vClick = useClick()
const pinia = createPinia()
const app = createApp(App)
app.mixin(mixin)
const loadImage = new URL('./assets/img/icon/img-loading.png', import.meta.url).href
app.use(VueLazyload, {
  preLoad: 1.3,
  loading: loadImage,
  attempt: 1
})
app.use(pinia)
app.use(router)
app.use(i18n)
app.mount('#app')
app.directive('click', vClick)

// ✅ Vercel Web Analytics + Speed Insights（仅生产环境启用）
// - Web Analytics 脚本：/_vercel/insights/script.js
// - Speed Insights 脚本：/_vercel/speed-insights/script.js
if (import.meta.env.PROD) {
  Promise.allSettled([
    import('@vercel/analytics').then((m: any) => m?.inject?.({ framework: 'vue' })).catch(() => {}),
    import('@vercel/speed-insights')
      .then((m: any) => m?.injectSpeedInsights?.({ framework: 'vue' }))
      .catch(() => {})
  ])
}

//放到最后才可以使用pinia
setTimeout(() => {
  bus.emit(EVENT_KEY.HIDE_MUTED_NOTICE)
  window.showMutedNotice = false
}, 2000)
bus.on(EVENT_KEY.REMOVE_MUTED, () => {
  window.isMuted = false
})

// ✅ Telegram WebApp 初始化已经在 index.html 中提前处理
// 避免重复调用导致问题

// 🎯 启动观看时长心跳（打开app就开始计时，1分钟发送1次心跳）
startWatchTimeHeartbeat().catch((error) => {
  console.warn('[Main] Failed to start watch time heartbeat:', error)
})

// 页面卸载时停止心跳
window.addEventListener('beforeunload', () => {
  stopWatchTimeHeartbeat()
})
