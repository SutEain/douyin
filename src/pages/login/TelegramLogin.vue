<template>
  <div class="telegram-login">
    <!-- 🎯 浏览器环境：显示 Telegram Login Widget -->
    <div v-if="isBrowserEnv" class="browser-login">
      <div class="content">
        <img src="../../assets/img/icon/avatar/0.png" class="placeholder-avatar" />
        <h2>登录后查看更多精彩</h2>
        <p>使用 Telegram 账号登录</p>
        <!-- Telegram Login Widget -->
        <div ref="widgetContainer" class="telegram-widget-container"></div>
        <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>
      </div>
    </div>

    <!-- 🎯 Telegram WebApp 环境：使用原有流程 -->
    <div v-else class="container">
      <div v-if="isLoading" class="logo">
        <img src="/images/icon/logo.svg" alt="Logo" class="logo-img" />
      </div>

      <div v-if="errorMessage" class="error-box">
        <p class="error-icon">⚠️</p>
        <p class="error-text">{{ errorMessage }}</p>
        <button class="retry-btn" @click="initTelegramLogin">点此重试</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { loginWithTelegram } from '@/api/auth'
import { useBaseStore } from '@/store/pinia'
import { supabase } from '@/utils/supabase'

const router = useRouter()
const baseStore = useBaseStore()
const isLoading = ref(true)
const errorMessage = ref('')
const widgetContainer = ref<HTMLElement | null>(null)

// 🎯 检测是否在浏览器环境（非 Telegram WebApp）
const isBrowserEnv = ref(false)

// 🎯 检测环境
function detectEnvironment() {
  // 开发环境强制认为是浏览器环境
  const host = window.location.hostname
  const isDev =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.test') ||
    host.endsWith('.local')

  if (isDev) {
    isBrowserEnv.value = true
    return
  }

  const uaTelegram = /Telegram/i.test(navigator.userAgent)
  const refTelegram = /t\.me|telegram\.org|telegram\.me|web\.telegram\.org/i.test(
    document.referrer || ''
  )

  // 🎯 检查是否是真实的 Telegram WebApp（排除降级对象）
  const tgWebApp = window.Telegram?.WebApp
  const hasRealTelegramObj =
    tgWebApp &&
    tgWebApp.version !== 'fallback' &&
    tgWebApp.platform !== 'unknown' &&
    tgWebApp.initData // 真实的 Telegram WebApp 会有 initData

  const hasTgData =
    window.location.href.includes('tgWebAppData') ||
    window.location.hash.includes('tgWebAppData') ||
    window.location.search.includes('tgWebAppData')

  // 如果完全没有 Telegram 相关标识，认为是浏览器环境
  isBrowserEnv.value = !hasTgData && !uaTelegram && !refTelegram && !hasRealTelegramObj
}

onMounted(async () => {
  // 🎯 如果已经有 session 了，说明是回退回来的，直接进入首页
  const { data } = await supabase.auth.getSession()
  if (data.session) {
    // 只有在当前确实还在登录页时才 replace，避免干扰正在进行的深链接跳转
    if (router.currentRoute.value.path === '/login/telegram') {
      router.replace('/')
    }
    return
  }

  // 检测环境
  detectEnvironment()

  if (isBrowserEnv.value) {
    // 浏览器环境：加载 Telegram Login Widget
    initBrowserLogin()
  } else {
    // Telegram WebApp 环境：使用原有流程
    initTelegramLogin()
  }
})

// ✅ 优先从 URL 解析 tgWebAppData（即使 Telegram.WebApp 还没注入，也能登录）
const getInitDataFromUrl = (): string | null => {
  try {
    const href = window.location.href || ''

    // 1) query: ?tgWebAppData=...
    try {
      const url = new URL(href)
      const q = url.searchParams.get('tgWebAppData')
      if (q) return decodeURIComponent(q)
    } catch {
      // ignore
    }

    // 2) hash: #tgWebAppData=...&tgWebAppVersion=...
    const hash = window.location.hash || ''
    if (hash.includes('tgWebAppData')) {
      const raw = hash.startsWith('#') ? hash.slice(1) : hash
      const params = new URLSearchParams(raw)
      const v = params.get('tgWebAppData')
      if (v) return decodeURIComponent(v)
    }

    return null
  } catch (e) {
    console.warn('[TelegramLogin] 解析 tgWebAppData 失败:', e)
    return null
  }
}

const initTelegramLogin = async () => {
  try {
    // ✅ 0) 优先从 URL 取 initData（避免 Telegram.WebApp 注入慢导致误判）
    const urlInitData = getInitDataFromUrl()
    if (urlInitData) {
      // @ts-ignore
      window.__TG_INIT_DATA__ = { raw: urlInitData, source: 'url' }

      const result = await loginWithTelegram(urlInitData)
      if (result?.user) {
        baseStore.applyProfile(result.user)
      }

      // 🎯 等待 session 写入
      await new Promise((resolve) => setTimeout(resolve, 100))
      await supabase.auth.getSession()

      // 🎯 彻底修复深链接跳转冲突：
      // 如果当前路由已经不再是登录页（说明深链接已经跳转成功），则绝不执行首页重定向
      if (router.currentRoute.value.path !== '/login/telegram') {
        return
      }

      router.replace('/')
      return
    }

    // ✅ 等待 Telegram WebApp 准备就绪
    const tg = await waitForTelegram()

    if (!tg) {
      errorMessage.value = '请在 Telegram 中打开此应用'
      isLoading.value = false
      return
    }

    // ✅ index.html 已经处理了 ready/expand/disableVerticalSwipes
    // 这里不需要重复调用

    // 获取 initData（等待一小段时间确保 initData 可用）
    await new Promise((resolve) => setTimeout(resolve, 100))
    const initData = getInitData()

    if (!initData) {
      errorMessage.value = '无法获取 Telegram 用户信息，请稍后重试'
      isLoading.value = false
      return
    }

    // 调用登录 API（内部会调用 setSession）
    const result = await loginWithTelegram(initData)

    if (result?.user) {
      baseStore.applyProfile(result.user)
    }

    // 🎯 等待 session 真正写入本地存储
    await new Promise((resolve) => setTimeout(resolve, 100))

    // 验证 session 是否可用
    await supabase.auth.getSession()

    // 🎯 彻底修复深链接跳转冲突：
    // 如果当前路由已经不再是登录页（说明深链接已经跳转成功），则绝不执行首页重定向
    if (router.currentRoute.value.path !== '/login/telegram') {
      return
    }

    // 登录成功，跳转到首页
    router.replace('/')
  } catch (error: any) {
    console.error('[TelegramLogin] ❌ 登录失败:', error)
    let msg = error?.message || '登录失败，请重试'
    if (msg === 'Failed to fetch') {
      msg = '网络连接失败，请检查网络或 VPN 设置'
    }
    errorMessage.value = msg
    isLoading.value = false
  }
}

// ✅ 等待 Telegram WebApp 加载完成
const waitForTelegram = (): Promise<any> => {
  return new Promise((resolve) => {
    // @ts-ignore
    if (window.Telegram?.WebApp) {
      // @ts-ignore
      resolve(window.Telegram.WebApp)
      return
    }

    // ✅ 优化：缩短等待时间，避免长时间阻塞导致 WebView 崩溃
    let attempts = 0
    const maxAttempts = 20 // 从 30 次减少到 20 次（2 秒）
    const checkInterval = setInterval(() => {
      attempts++
      // @ts-ignore
      if (window.Telegram?.WebApp?.initData) {
        clearInterval(checkInterval)
        // @ts-ignore
        resolve(window.Telegram.WebApp)
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval)
        console.warn('[TelegramLogin] 等待 WebApp SDK 超时，尝试使用 URL 参数')
        // ✅ 即使超时也返回降级对象，避免后续代码报错
        // @ts-ignore
        resolve(window.Telegram?.WebApp || null)
      }
    }, 100)
  })
}

const getInitData = (): string | null => {
  // 优先使用早期捕获 of initData
  try {
    // @ts-ignore
    if (window.__TG_INIT_DATA__?.raw) {
      // @ts-ignore
      return window.__TG_INIT_DATA__.raw
    }
  } catch (e) {
    // ignore
  }

  // ✅ 兜底：从 URL 解析 tgWebAppData
  const urlInitData = getInitDataFromUrl()
  if (urlInitData) {
    // @ts-ignore
    window.__TG_INIT_DATA__ = { raw: urlInitData, source: 'url' }
    return urlInitData
  }

  // 从 Telegram WebApp 获取
  try {
    // @ts-ignore
    const tg = window.Telegram?.WebApp
    if (tg?.initData) {
      return tg.initData
    }
  } catch (e) {
    // ignore
  }

  return null
}

// 🎯 浏览器环境：初始化 Telegram Login Widget
function initBrowserLogin() {
  isLoading.value = false

  // 获取 Bot Username
  const botUsername = (import.meta.env.VITE_TG_BOT_USERNAME || 'dydy').replace('@', '')

  // 加载 Telegram Widget Script
  const scriptId = 'telegram-widget-script'
  if (document.getElementById(scriptId)) {
    // 脚本已加载，直接创建 widget
    createWidget(botUsername)
    return
  }

  const script = document.createElement('script')
  script.id = scriptId
  script.src = 'https://telegram.org/js/telegram-widget.js?22'
  script.async = true
  script.onload = () => {
    createWidget(botUsername)
  }
  script.onerror = () => {
    errorMessage.value = '加载 Telegram 登录组件失败，请刷新页面重试'
  }
  document.head.appendChild(script)
}

// 🎯 创建 Telegram Login Widget
function createWidget(botUsername: string) {
  if (!widgetContainer.value) return

  // 清空容器
  widgetContainer.value.innerHTML = ''

  // 设置全局回调函数（必须在创建 widget 之前）
  ;(window as any).onTelegramAuth = async (user: any) => {
    try {
      isLoading.value = true
      errorMessage.value = ''

      console.log('[BrowserLogin] Telegram Widget 回调:', user)

      // 调用后端 API 处理 Widget 登录
      const result = await loginWithTelegramWidget(user)
      if (result?.user) {
        baseStore.applyProfile(result.user)
      }

      // 等待 session 写入
      await new Promise((resolve) => setTimeout(resolve, 100))
      await supabase.auth.getSession()

      // 跳转到首页
      router.replace('/')
    } catch (error: any) {
      console.error('[BrowserLogin] ❌ 登录失败:', error)
      errorMessage.value = error?.message || '登录失败，请重试'
      isLoading.value = false
    }
  }

  // 创建 widget script 标签（Telegram 会自动转换为 iframe）
  const widget = document.createElement('script')
  widget.setAttribute('src', 'https://telegram.org/js/telegram-widget.js?22')
  widget.setAttribute('data-telegram-login', botUsername)
  widget.setAttribute('data-size', 'large')
  widget.setAttribute('data-onauth', 'onTelegramAuth(user)')
  widget.setAttribute('data-request-access', 'write')
  widget.async = true

  widgetContainer.value.appendChild(widget)
}

// 🎯 浏览器端 Widget 登录 API
async function loginWithTelegramWidget(user: any): Promise<any> {
  const getAppServerBase = () => {
    if (import.meta.env.VITE_APP_SERVER_URL) {
      return import.meta.env.VITE_APP_SERVER_URL.replace(/\/$/, '')
    }
    if (import.meta.env.DEV) {
      return '/api/app-server'
    }
    if (import.meta.env.VITE_SUPABASE_URL) {
      return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/app-server`
    }
    throw new Error('Missing app server URL configuration')
  }

  const url = `${getAppServerBase()}/auth/tg-widget-login`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 20000)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ user }),
      signal: controller.signal
    })
    clearTimeout(timeoutId)
  } catch (error: any) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('登录请求超时，请检查网络连接')
    }
    throw new Error('网络连接失败，请检查网络或 VPN 设置')
  }

  const result = await response.json()

  if (result.code !== 0) {
    throw new Error(result.msg || 'Login failed')
  }

  // 设置 Supabase session
  const { access_token, refresh_token } = result.data
  const { error } = await supabase.auth.setSession({
    access_token,
    refresh_token
  })

  if (error) {
    throw new Error('Failed to set session')
  }

  return result.data
}

onUnmounted(() => {
  // 清理全局回调
  if ((window as any).onTelegramAuth) {
    delete (window as any).onTelegramAuth
  }
})
</script>

<style scoped lang="less">
.telegram-login {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #000;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;

  // 🎯 浏览器登录样式（参考 Me.vue）
  .browser-login {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    .content {
      text-align: center;
      padding: 0 40px;

      .placeholder-avatar {
        width: 100px;
        height: 100px;
        border-radius: 50%;
        margin-bottom: 20px;
        opacity: 0.5;
        border: 2px solid rgba(255, 255, 255, 0.2);
      }

      h2 {
        font-size: 20px;
        margin-bottom: 10px;
      }

      p {
        font-size: 14px;
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 30px;
      }

      .telegram-widget-container {
        display: flex;
        justify-content: center;
        margin-bottom: 20px;
      }

      .error-message {
        color: #ff6b6b;
        font-size: 14px;
        margin-top: 15px;
      }
    }
  }

  .container {
    width: 90%;
    max-width: 400px;
    text-align: center;
  }

  .logo {
    display: flex;
    justify-content: center;

    .logo-img {
      width: 180px;
      height: 180px;
      object-fit: contain;
      animation: breathe 2s ease-in-out infinite;
    }
  }

  @keyframes breathe {
    0%,
    100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(1.1);
      opacity: 0.8;
    }
  }

  .error-box {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(10px);
    padding: 30px;
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.1);

    .error-icon {
      font-size: 48px;
      margin: 0 0 15px 0;
    }

    .error-text {
      font-size: 16px;
      margin: 0 0 20px 0;
      opacity: 0.9;
      line-height: 1.5;
    }

    .env-info {
      background: rgba(0, 0, 0, 0.3);
      border-radius: 10px;
      padding: 15px;
      margin: 0 0 20px 0;
      text-align: left;
      font-size: 14px;

      .env-title {
        font-weight: 600;
        margin: 0 0 10px 0;
        text-align: center;
      }

      .env-item {
        padding: 5px 0;
        opacity: 0.9;

        &.missing {
          color: #ff6b6b;
          font-weight: 600;
        }
      }
    }

    .retry-btn {
      background: white;
      color: #000000;
      border: none;
      padding: 12px 30px;
      border-radius: 25px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;

      &:hover {
        transform: scale(1.05);
      }

      &:active {
        transform: scale(0.95);
      }
    }
  }
}
</style>
