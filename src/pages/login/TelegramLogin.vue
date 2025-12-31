<template>
  <div class="telegram-login">
    <div class="container">
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
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { loginWithTelegram } from '@/api/auth'
import { useBaseStore } from '@/store/pinia'
import { supabase } from '@/utils/supabase'

const router = useRouter()
const baseStore = useBaseStore()
const isLoading = ref(true)
const errorMessage = ref('')

onMounted(() => {
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
      console.log(
        '[TelegramLogin] ✅ 从 URL tgWebAppData 获取到 initData, len=',
        urlInitData.length
      )

      console.log('[TelegramLogin] 🔐 准备登录（URL initData）...')
      const result = await loginWithTelegram(urlInitData)
      if (result?.user) {
        baseStore.applyProfile(result.user)
        console.log('[TelegramLogin] ✅ 登录成功（URL initData）')
      }

      // 🎯 等待 session 写入
      await new Promise((resolve) => setTimeout(resolve, 100))
      await supabase.auth.getSession()

      // 🎯 修复深链接跳转冲突：如果 store 中有深链接 ID，则不强制跳转到首页，让 App.vue 的全局监听处理
      if (baseStore.startLiveId || baseStore.startVideoId) {
        console.log('[TelegramLogin] 检测到深链接参数，跳过强制首页重定向')
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

    console.log('[TelegramLogin] 🔐 准备登录...')

    // 调用登录 API（内部会调用 setSession）
    const result = await loginWithTelegram(initData)

    if (result?.user) {
      baseStore.applyProfile(result.user)
      console.log('[TelegramLogin] ✅ 登录成功')
    }

    // 🎯 等待 session 真正写入本地存储
    console.log('[TelegramLogin] ⏳ 等待 session 写入...')
    await new Promise((resolve) => setTimeout(resolve, 100))

    // 验证 session 是否可用
    const {
      data: { session }
    } = await supabase.auth.getSession()
    if (session) {
      console.log(
        '[TelegramLogin] ✅ Session 已就绪:',
        session.access_token.substring(0, 20) + '...'
      )
    } else {
      console.warn('[TelegramLogin] ⚠️ Session 未找到，可能需要重新登录')
    }

    // 🎯 修复深链接跳转冲突：如果 store 中有深链接 ID，则不强制跳转到首页，让 App.vue 的全局监听处理
    if (baseStore.startLiveId || baseStore.startVideoId) {
      console.log('[TelegramLogin] 检测到深链接参数，跳过强制首页重定向')
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

    // 轮询检查（最多等待 5 秒）
    let attempts = 0
    // ✅ 延长等待：部分机型/网络下 Telegram 注入可能更慢
    const maxAttempts = 150 // 15s
    const checkInterval = setInterval(() => {
      attempts++
      // @ts-ignore
      if (window.Telegram?.WebApp) {
        clearInterval(checkInterval)
        // @ts-ignore
        resolve(window.Telegram.WebApp)
        // @ts-ignore
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval)
        resolve(null)
      }
    }, 100)
  })
}

const getInitData = (): string | null => {
  console.log('[TelegramLogin] 🔍 获取 initData...')

  // 优先使用早期捕获的 initData
  try {
    // @ts-ignore
    if (window.__TG_INIT_DATA__?.raw) {
      console.log('[TelegramLogin] ✅ 从 __TG_INIT_DATA__ 获取到 initData')
      // @ts-ignore
      return window.__TG_INIT_DATA__.raw
    }
  } catch (e) {
    console.warn('[TelegramLogin] __TG_INIT_DATA__ 不可用:', e)
  }

  // ✅ 兜底：从 URL 解析 tgWebAppData
  const urlInitData = getInitDataFromUrl()
  if (urlInitData) {
    console.log('[TelegramLogin] ✅ 从 URL tgWebAppData 获取到 initData')
    // @ts-ignore
    window.__TG_INIT_DATA__ = { raw: urlInitData, source: 'url' }
    return urlInitData
  }

  // 从 Telegram WebApp 获取
  try {
    // @ts-ignore
    const tg = window.Telegram?.WebApp
    if (tg?.initData) {
      console.log('[TelegramLogin] ✅ 从 Telegram.WebApp 获取到 initData')
      console.log('[TelegramLogin] initData 长度:', tg.initData.length)
      console.log('[TelegramLogin] initData 预览:', tg.initData.substring(0, 100) + '...')
      return tg.initData
    } else {
      console.warn('[TelegramLogin] ⚠️ Telegram.WebApp.initData 为空')
      console.log('[TelegramLogin] Telegram.WebApp 对象:', tg)
    }
  } catch (e) {
    console.error('[TelegramLogin] ❌ 获取 Telegram.WebApp 失败:', e)
  }

  console.error('[TelegramLogin] ❌ 无法获取 initData')
  return null
}
</script>

<style scoped lang="less">
.telegram-login {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #111111;
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
