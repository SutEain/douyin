import { createApp } from 'vue'
import App from './App.vue'
import './assets/less/index.less'
import router from './router'
import mixin from './utils/mixin'
import VueLazyload from '@jambonn/vue-lazyload'
import { createPinia } from 'pinia'
import { useClick } from '@/utils/hooks/useClick'
import bus, { EVENT_KEY } from '@/utils/bus'
import i18n from '@/locales'

declare global {
  interface Window {
    TelegramGameProxy?: {
      receiveEvent?: (...args: any[]) => void
    }
    __rawConsole__?: Console
  }
}

if (typeof window !== 'undefined') {
  // ✅ 已恢复 console 输出供调试使用
  if (!window.__rawConsole__) {
    window.__rawConsole__ = window.console
  }
  // const noop = () => {}
  // ;(window.console.log as any) = noop
  // ;(window.console.info as any) = noop
  // ;(window.console.debug as any) = noop
  // ;(window.console.warn as any) = noop
  // ;(window.console.error as any) = noop

  window.TelegramGameProxy = window.TelegramGameProxy || {}
  if (typeof window.TelegramGameProxy.receiveEvent !== 'function') {
    window.TelegramGameProxy.receiveEvent = () => {}
  }

  const fallbackImage = new URL('./assets/img/icon/img-loading.png', import.meta.url).href

  const handleGlobalError = (event: Event | ErrorEvent) => {
    const target = event?.target

    if (target instanceof HTMLImageElement) {
      if (!target.dataset.fallbackApplied) {
        target.dataset.fallbackApplied = '1'
        target.src = fallbackImage
      }
      event.preventDefault?.()
      return false
    }

    if (target instanceof HTMLVideoElement) {
      // ✅ 不再打印“视频URL”，也不要 preventDefault 以免影响播放器/第三方库接管错误处理
      // 需要排查时可在 URL 加 ?dpdebug=1 看 DPPlayer 的详细日志
      return false
    }

    // ✅ 处理 <source> 标签加载失败（通常是网络问题，不应中断播放）
    if (target instanceof HTMLSourceElement) {
      // 同上：不拦截也不刷屏
      return false
    }

    console.warn(
      '[GlobalError]',
      (event as ErrorEvent).message || (event as ErrorEvent).error || event
    )
    event.preventDefault?.()
    return false
  }

  const handleRejection = (event: PromiseRejectionEvent) => {
    // Ignore AbortError as it's usually intentional (e.g. cancelling a fetch or play() interrupted)
    if (event.reason?.name === 'AbortError' || event.reason?.message?.includes('aborted')) {
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
HTMLElement.prototype.addEventListener = new Proxy(HTMLElement.prototype.addEventListener, {
  apply(target, ctx, args) {
    const eventName = args[0]
    const listener = args[1]
    if (listener instanceof Function && eventName === 'click') {
      args[1] = new Proxy(listener, {
        apply(target1, ctx1, args1) {
          // console.log('e', args1)
          // console.log('click点击', window.isMoved)
          if (window.isMoved) return
          try {
            return target1.apply(ctx1, args1)
          } catch (e) {
            console.error(`[proxyPlayerEvent][${eventName}]`, listener, e)
          }
        }
      })
    }
    return target.apply(ctx, args)
  }
})

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
