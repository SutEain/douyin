<template>
  <div class="telegram-login">
    <div class="container">
      <div v-if="isLoading" class="logo">
        <img src="/images/icon/logo.svg" alt="Logo" class="logo-img" />
      </div>

      <div v-if="errorMessage" class="error-box">
        <p class="error-icon">⚠️</p>
        <p class="error-text">{{ errorMessage }}</p>
        <button @click="retry" class="retry-btn">重试</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { loginWithTelegram } from '@/api/auth'
import { useBaseStore } from '@/store/pinia'

const router = useRouter()
const baseStore = useBaseStore()
const isLoading = ref(true)
const errorMessage = ref('')

onMounted(() => {
  initTelegramLogin()
})

const initTelegramLogin = async () => {
  try {
    // 检查 Telegram 环境
    // @ts-ignore
    const tg = window.Telegram?.WebApp
    if (!tg) {
      errorMessage.value = '请在 Telegram 中打开此应用'
      isLoading.value = false
      return
    }

    // 初始化 Telegram WebApp
    try {
      tg.ready()
      tg.expand()
      // 禁止用户下滑收起 WebApp（支持的客户端会生效）
      if (typeof tg.disableVerticalSwipes === 'function') {
        tg.disableVerticalSwipes()
      }
    } catch (e) {
      // 初始化失败不影响登录
    }

    // 获取 initData
    const initData = getInitData()
    
    if (!initData) {
      errorMessage.value = '无法获取 Telegram 用户信息'
      isLoading.value = false
      return
    }

    // 调用登录 API
    const result = await loginWithTelegram(initData)

    if (result?.user) {
      baseStore.applyProfile(result.user)
    }

    // 登录成功，跳转到首页
      router.replace('/')
  } catch (error: any) {
    errorMessage.value = error?.message || '登录失败，请重试'
    isLoading.value = false
  }
}

const getInitData = (): string | null => {
  // 优先使用早期捕获的 initData
  try {
    // @ts-ignore
    if (window.__TG_INIT_DATA__?.raw) {
      // @ts-ignore
      return window.__TG_INIT_DATA__.raw
    }
  } catch (e) {
    // Ignore
  }

  // 从 Telegram WebApp 获取
  try {
    // @ts-ignore
    const tg = window.Telegram?.WebApp
    if (tg?.initData) {
      return tg.initData
    }
  } catch (e) {
    // Ignore
  }

  return null
}

const retry = () => {
  errorMessage.value = ''
  isLoading.value = true
  initTelegramLogin()
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
    0%, 100% {
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
      margin: 0 0 25px 0;
      opacity: 0.9;
      line-height: 1.5;
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