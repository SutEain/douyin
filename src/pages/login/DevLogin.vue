<template>
  <div class="dev-login">
    <div class="container">
      <div v-if="isLoading" class="logo">
        <img src="/images/icon/logo.svg" alt="Logo" class="logo-img" />
        <p class="loading-text">开发登录中...</p>
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
import { useRouter, useRoute } from 'vue-router'
import { useBaseStore } from '@/store/pinia'
import { supabase } from '@/utils/supabase'

const router = useRouter()
const route = useRoute()
const baseStore = useBaseStore()
const isLoading = ref(true)
const errorMessage = ref('')

onMounted(() => {
  initDevLogin()
})

const initDevLogin = async () => {
  try {
    // 获取 URL 参数中的 user_id
    const userId = route.query.id as string

    if (!userId) {
      errorMessage.value = '缺少用户 ID 参数，请使用 /login/dev?id=your_user_id'
      isLoading.value = false
      return
    }

    console.log('[DevLogin] 🛠️ 开发登录，user_id:', userId)

    // 调用开发登录 API
    const appServerUrl = import.meta.env.VITE_APP_SERVER_URL
    if (!appServerUrl) {
      errorMessage.value = '缺少 APP_SERVER_URL 配置'
      isLoading.value = false
      return
    }

    // 注意：路径是 /app-server/dev-login，不是 /dev-login
    const url = `${appServerUrl}/dev-login?user_id=${userId}`
    console.log('[DevLogin] 📡 请求地址:', url)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
      }
    })

    const result = await response.json()
    console.log('[DevLogin] 📦 响应数据:', result)

    if (result.code !== 0) {
      errorMessage.value = result.msg || '登录失败'
      isLoading.value = false
      return
    }

    // 🔑 设置 Supabase session（与 Telegram 登录逻辑一致）
    const { access_token, refresh_token, user } = result.data
    console.log('[DevLogin] 🔑 设置 Session...')

    const { error: sessionError } = await supabase.auth.setSession({
      access_token,
      refresh_token
    })

    if (sessionError) {
      console.error('[DevLogin] ❌ Session 设置失败:', sessionError)
      errorMessage.value = 'Session 设置失败'
      isLoading.value = false
      return
    }

    // 设置用户数据到 store
    baseStore.applyProfile(user)
    console.log('[DevLogin] ✅ 开发登录成功，用户:', user.nickname)

    // 跳转到首页
    router.replace('/home')
  } catch (error: any) {
    console.error('[DevLogin] ❌ 登录失败:', error)
    errorMessage.value = error?.message || '登录失败，请重试'
    isLoading.value = false
  }
}

const retry = () => {
  errorMessage.value = ''
  isLoading.value = true
  initDevLogin()
}
</script>

<style scoped lang="less">
.dev-login {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.container {
  text-align: center;
  color: white;
}

.logo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;

  .logo-img {
    width: 80px;
    height: 80px;
    animation: pulse 2s ease-in-out infinite;
  }

  .loading-text {
    font-size: 16px;
    opacity: 0.9;
  }
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.8;
  }
}

.error-box {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 30px;
  max-width: 320px;

  .error-icon {
    font-size: 48px;
    margin-bottom: 16px;
  }

  .error-text {
    font-size: 14px;
    line-height: 1.6;
    margin-bottom: 20px;
    opacity: 0.9;
  }

  .retry-btn {
    background: white;
    color: #667eea;
    border: none;
    padding: 12px 32px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    &:active {
      transform: translateY(0);
    }
  }
}
</style>
