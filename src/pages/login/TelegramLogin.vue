<template>
  <div class="telegram-login">
    <div class="container">
      <div v-if="isLoading" class="logo">
        <img src="/images/icon/logo.svg" alt="Logo" class="logo-img" />
      </div>

      <div v-if="errorMessage" class="error-box">
        <p class="error-icon">⚠️</p>
        <p class="error-text">{{ errorMessage }}</p>
        <div class="action-buttons">
          <button class="retry-btn" @click="initTelegramLogin">点击重试登录</button>
          <button v-if="isBrowserEnv" class="verify-code-btn" @click="goToVerifyCodeLogin">
            使用验证码登录
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { loginWithTelegram } from '@/api/auth'
import { useBaseStore } from '@/store/pinia'
import { supabase } from '@/utils/supabase'
import { isBrowserEnvironment } from '@/utils/env'

const router = useRouter()
const baseStore = useBaseStore()
const isLoading = ref(true)
const errorMessage = ref('')

// 🎯 检测是否在浏览器环境（用于显示验证码登录按钮）
const isBrowserEnv = computed(() => isBrowserEnvironment())

onMounted(async () => {
  // 🎯 清理可能残留的 Telegram Widget 全局回调（防止旧代码干扰）
  try {
    if ((window as any).onTelegramAuth) {
      delete (window as any).onTelegramAuth
    }
  } catch (e) {
    // ignore
  }

  // 🎯 如果已经有 session 了，说明是回退回来的，直接进入首页
  const { data } = await supabase.auth.getSession()
  if (data.session) {
    // 只有在当前确实还在登录页时才 replace，避免干扰正在进行的深链接跳转
    if (router.currentRoute.value.path === '/login/telegram') {
      if (typeof router.replace === 'function') {
        router.replace('/')
      }
    }
    return
  }

  // 🎯 只使用 Telegram WebApp 登录流程（Widget 已弃用）
  initTelegramLogin()
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
    // ignore
    return null
  }
}

const initTelegramLogin = async () => {
  try {
    // 🎯 重置状态
    isLoading.value = true
    errorMessage.value = ''

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

      // 🎯 确保 router.replace 方法存在
      if (typeof router.replace === 'function') {
        router.replace('/')
      } else {
        errorMessage.value = '路由错误，请刷新页面重试'
        isLoading.value = false
      }
      return
    }

    // ✅ 等待 Telegram WebApp 准备就绪
    const tg = await waitForTelegram()

    if (!tg) {
      if (isBrowserEnv.value) {
        errorMessage.value = '此页面需要在 Telegram 中打开。如果您在浏览器中，请使用验证码登录。'
      } else {
        errorMessage.value = '请在 Telegram 中打开此应用'
      }
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
    // 🎯 确保 router.replace 方法存在
    if (typeof router.replace === 'function') {
      router.replace('/')
    } else {
      errorMessage.value = '路由错误，请刷新页面重试'
      isLoading.value = false
    }
  } catch (error: any) {
    // 🎯 检查是否是 "re is not a function" 错误（可能是 router.replace 被误写）
    const errorMsg = error?.message || String(error) || ''
    if (errorMsg.includes('re is not a function')) {
      errorMessage.value = '页面错误，请刷新页面重试'
    } else {
      let msg = errorMsg || '登录失败，请重试'
      if (msg === 'Failed to fetch') {
        msg = '网络连接失败，请检查网络或 VPN 设置'
      }
      errorMessage.value = msg
    }
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

// 🎯 跳转到验证码登录页面（浏览器环境）
function goToVerifyCodeLogin() {
  router.push('/login/verification-code')
}
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

    .action-buttons {
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: center;
    }

    .retry-btn,
    .verify-code-btn {
      background: white;
      color: #000000;
      border: none;
      padding: 12px 30px;
      border-radius: 25px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
      width: 100%;
      max-width: 280px;

      &:hover {
        transform: scale(1.05);
      }

      &:active {
        transform: scale(0.95);
      }
    }

    .verify-code-btn {
      background: rgba(255, 255, 255, 0.1);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.3);

      &:hover {
        background: rgba(255, 255, 255, 0.15);
      }
    }
  }
}
</style>
