<template>
  <div class="telegram-login">
    <div class="container">
      <div class="logo">
        <h1>🎬 Douyin</h1>
        <p>短视频分享平台</p>
      </div>

      <div v-if="loading" class="loading">
        <div class="spinner"></div>
        <p>正在登录...</p>
      </div>

      <div v-else-if="error" class="error">
        <p>{{ error }}</p>
        <button @click="retryLogin" class="retry-btn">重试</button>
      </div>

      <div v-else class="welcome">
        <p>欢迎使用 Telegram 登录</p>
        <button @click="handleLogin" class="login-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"
            />
          </svg>
          使用 Telegram 登录
        </button>
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

const loading = ref(false)
const error = ref('')

// 检查是否在 Telegram WebApp 中
const isTelegramWebApp = () => {
  return window.Telegram?.WebApp !== undefined
}

// 获取 Telegram InitData
const getTelegramInitData = () => {
  if (!isTelegramWebApp()) {
    return null
  }
  return window.Telegram.WebApp.initData
}

// 处理登录
const handleLogin = async () => {
  loading.value = true
  error.value = ''

  try {
    const initData = getTelegramInitData()

    if (!initData) {
      // 不在 Telegram 环境中，显示提示
      error.value = '请在 Telegram 中打开此应用'
      loading.value = false
      return
    }

    // 调用登录 API
    const result = await loginWithTelegram(initData)

    // 更新用户状态
    baseStore.setUserinfo(result.user)

    // 跳转到首页
    router.push('/home')
  } catch (err: any) {
    console.error('Login error:', err)
    error.value = err.message || '登录失败，请重试'
    loading.value = false
  }
}

// 重试登录
const retryLogin = () => {
  error.value = ''
  handleLogin()
}

// 自动登录（如果在 Telegram 环境中）
onMounted(() => {
  if (isTelegramWebApp()) {
    // 扩展 Telegram WebApp
    window.Telegram.WebApp.expand()

    // 自动尝试登录
    handleLogin()
  }
})

// TypeScript 类型声明
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string
        initDataUnsafe: any
        expand: () => void
        close: () => void
        ready: () => void
      }
    }
  }
}
</script>

<style scoped lang="less">
.telegram-login {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;

  .container {
    text-align: center;
    padding: 40rem;
    max-width: 400rem;
  }

  .logo {
    margin-bottom: 40rem;

    h1 {
      font-size: 48rem;
      margin: 0 0 10rem 0;
      font-weight: bold;
    }

    p {
      font-size: 16rem;
      opacity: 0.9;
      margin: 0;
    }
  }

  .loading {
    .spinner {
      width: 40rem;
      height: 40rem;
      border: 4rem solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 20rem;
    }

    p {
      font-size: 16rem;
      opacity: 0.9;
    }
  }

  .error {
    p {
      color: #ffeb3b;
      font-size: 16rem;
      margin-bottom: 20rem;
    }

    .retry-btn {
      background: white;
      color: #667eea;
      border: none;
      padding: 12rem 30rem;
      border-radius: 25rem;
      font-size: 16rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;

      &:hover {
        transform: scale(1.05);
        box-shadow: 0 4rem 12rem rgba(0, 0, 0, 0.2);
      }

      &:active {
        transform: scale(0.95);
      }
    }
  }

  .welcome {
    p {
      font-size: 18rem;
      margin-bottom: 30rem;
      opacity: 0.9;
    }

    .login-btn {
      display: inline-flex;
      align-items: center;
      gap: 10rem;
      background: white;
      color: #667eea;
      border: none;
      padding: 15rem 40rem;
      border-radius: 30rem;
      font-size: 18rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
      box-shadow: 0 4rem 12rem rgba(0, 0, 0, 0.15);

      svg {
        flex-shrink: 0;
      }

      &:hover {
        transform: translateY(-2rem);
        box-shadow: 0 6rem 20rem rgba(0, 0, 0, 0.2);
      }

      &:active {
        transform: translateY(0);
      }
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
}
</style>
