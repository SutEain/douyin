<template>
  <div v-if="store.userinfo.is_banned" class="banned-overlay">
    <div class="banned-box">
      <div class="icon-wrap">
        <Icon icon="solar:danger-bold" class="icon" />
      </div>
      <div class="title">账号已被封禁</div>
      <div class="reason">
        {{ store.userinfo.ban_reason || '由于违反社区规范，您的账号已被封禁。' }}
      </div>
      <div class="tip">如有疑问，请通过 Telegram 联系管理员</div>
    </div>
  </div>
  <router-view v-else v-slot="{ Component, route }">
    <transition :name="transitionName">
      <keep-alive :exclude="store.excludeNames">
        <component :is="Component" :key="route.path" />
      </keep-alive>
    </transition>
  </router-view>
  <Call />
</template>
<script setup lang="ts">
/*
* try {navigator.control.gesture(false);} catch (e) {} //UC浏览器关闭默认手势事件
try {navigator.control.longpressMenu(false);} catch (e) {} //关闭长按弹出菜单
* */
import routes from './router/routes'
import Call from './components/Call.vue'
import { Icon } from '@iconify/vue'
import { useBaseStore } from '@/store/pinia'
import { onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const store = useBaseStore()
const router = useRouter()
const route = useRoute()
const transitionName = ref('go')

// 🎯 全局深链接处理
async function handleDeepLink() {
  console.log('[App.handleDeepLink] ========== 调用深链接处理 ==========')

  // 🎯 核心修复：如果 store 还没准备好，或者正在初始化，先等待
  if (!store.isAppReady) {
    console.log('[App.handleDeepLink] ⏳ 等待 store 就绪...')
    await new Promise((resolve) => {
      const unwatch = watch(
        () => store.isAppReady,
        (ready) => {
          if (ready) {
            unwatch()
            resolve(true)
          }
        }
      )
    })
  }

  console.log('[App.handleDeepLink] store.startLiveId:', store.startLiveId)

  if (store.startLiveId) {
    const roomId = store.startLiveId
    console.log('[App.handleDeepLink] ✅ 检测到直播间 ID:', roomId)
    store.clearStartLiveId()
    console.log('[App.handleDeepLink] 已清除 store.startLiveId')

    await router.isReady()
    console.log('[App.handleDeepLink] 路由已就绪')

    // 延迟一小会儿确保稳定
    setTimeout(() => {
      // 🎯 如果当前已经在直播页且 ID 相同，可能不会触发更新，所以这里强制处理
      if (route.path === '/home/live' && route.query.id === roomId) {
        console.log('[App.handleDeepLink] 📍 已在目标直播间，无需跳转')
        return
      }
      console.log('[App.handleDeepLink] 🚀 准备跳转到直播间:', `/home/live?id=${roomId}`)
      router.push({ path: '/home/live', query: { id: roomId } })
      console.log('[App.handleDeepLink] ✅ router.push 已调用')
    }, 100)
  } else {
    console.log('[App.handleDeepLink] ⚠️ 没有 startLiveId，跳过处理')
  }
}

// 🎯 监听 Store 中的深链接参数 (仅直播需要重定向，视频由首页 Feed 自动处理)
watch(
  () => store.startLiveId,
  (newId, oldId) => {
    console.log('[App.watch] startLiveId 变化:', { oldId, newId })
    if (newId) {
      console.log('[App.watch] ✅ 检测到新的直播间 ID，调用 handleDeepLink')
      handleDeepLink()
    } else {
      console.log('[App.watch] ⚠️ startLiveId 为空，不处理')
    }
  },
  { immediate: true }
)

// watch $route 决定使用哪种过渡
watch(
  () => route.path,
  (to, from) => {
    store.setMaskDialog({ state: false, mode: store.maskDialogMode })
    //底部tab的按钮，跳转是不需要用动画的
    let noAnimation = [
      '/',
      '/home',
      '/slide',
      '/me',
      '/shop',
      '/message',
      '/publish',
      '/home/live',
      'slide',
      '/test'
    ]
    if (noAnimation.indexOf(from) !== -1 && noAnimation.indexOf(to) !== -1) {
      return (transitionName.value = '')
    }
    const toDepth = routes.findIndex((v: RouteRecordRaw) => v.path === to)
    const fromDepth = routes.findIndex((v: RouteRecordRaw) => v.path === from)
    transitionName.value = toDepth > fromDepth ? 'go' : 'back'
  }
)

function resetVhAndPx() {
  const ua = navigator.userAgent
  const isAndroid = /Android/i.test(ua)
  const isTG = !!(window as any).Telegram?.WebApp?.initData

  // 🎯 核心逻辑：仅在安卓或 TG MiniApp 环境下使用 JS 动态计算高度
  // iOS 保持使用 CSS 原生的 100dvh 以获得最佳性能和丝滑体验
  if (isAndroid || isTG) {
    let innerHeight = window.innerHeight
    let vh = innerHeight * 0.01
    document.documentElement.style.setProperty('--vh', `${vh}px`)
  } else {
    // iOS 或其他环境使用 1dvh 作为基准
    document.documentElement.style.setProperty('--vh', '1dvh')
  }
}

onMounted(() => {
  console.log('[App.onMounted] ========== App 组件已挂载 ==========')
  
  // 🎯 增加平台识别类到 body
  const ua = navigator.userAgent
  const isAndroid = /Android/i.test(ua)
  const isIOS = /iPhone|iPad|iPod/i.test(ua)
  const isTG = !!(window as any).Telegram?.WebApp?.initData
  // 🎯 纯 Chrome：包含 Chrome 字符且不包含 Edge，且不是 TG MiniApp
  const isChrome = /Chrome/i.test(ua) && !/Edge/i.test(ua) && !isTG
  
  if (isAndroid) document.documentElement.classList.add('is-android')
  if (isIOS) document.documentElement.classList.add('is-ios')
  if (isChrome) document.documentElement.classList.add('is-chrome')
  if (isTG) {
    document.documentElement.classList.add('is-tg-miniapp')
    console.log('[TG-Debug] Telegram environment detected')
    
    const tgWebApp = (window as any).Telegram?.WebApp
    console.log('[TG-Debug] tgWebApp object:', tgWebApp)
    
    // 🎯 官方推荐方式：监听全屏状态变化
    const handleFullscreen = () => {
      // 🚀 核心改进：兼容官方 SDK 和 我们的降级 fallback 对象
      const isOfficialSDK = tgWebApp && tgWebApp.version !== 'fallback'
      
      let isFull = false
      if (isOfficialSDK) {
        isFull = !!tgWebApp.isFullscreen
      } else {
        // 如果是降级对象，官方属性肯定拿不到，此时必须用高度判定作为“官方不可用时”的唯一手段
        const screenH = window.screen.height
        const windowH = window.innerHeight
        isFull = isIOS && (screenH - windowH < 80)
      }

      const isExpanded = !!tgWebApp?.isExpanded
      const windowH = window.innerHeight
      const screenH = window.screen.height
      const viewportH = tgWebApp?.viewportHeight
      
      console.log('[TG-Debug] handleFullscreen called:', {
        isOfficialSDK,
        isFull,
        isExpanded,
        windowH,
        screenH,
        viewportH,
        diff: screenH - windowH,
        platform: tgWebApp?.platform
      })

      if (isFull) {
        console.log('[TG-Debug] Adding is-tg-fullscreen class')
        document.documentElement.classList.add('is-tg-fullscreen')
      } else {
        console.log('[TG-Debug] Removing is-tg-fullscreen class')
        document.documentElement.classList.remove('is-tg-fullscreen')
      }
    }

    // 初始状态同步
    setTimeout(() => {
      console.log('[TG-Debug] Initial sync after 100ms')
      handleFullscreen()
    }, 100)
    
    // 注册官方事件
    if (tgWebApp) {
      console.log('[TG-Debug] Registering events')
      tgWebApp.onEvent('fullscreenChanged', handleFullscreen)
      tgWebApp.onEvent('viewportChanged', handleFullscreen)
    } else {
      console.warn('[TG-Debug] tgWebApp is null, cannot register events')
    }

    // 持续监控一段时间，防止启动时的状态抖动
    [500, 1000, 2000, 5000].forEach(t => {
      setTimeout(() => {
        console.log(`[TG-Debug] Delayed sync at ${t}ms`)
        handleFullscreen()
      }, t)
    })
  }

  console.log('[App.onMounted] Window Height:', window.innerHeight)
  // 🎯 初始化应用（登录时自动创建用户，无需额外调用）
  console.log('[App.onMounted] 开始调用 store.init()')
  store.init()
  console.log('[App.onMounted] store.init() 已调用')

  resetVhAndPx()
  console.log('[App.onMounted] VH Set:', document.documentElement.style.getPropertyValue('--vh'))

  // 监听resize事件 视图大小发生变化就重新计算1vh的值
  window.addEventListener('resize', () => {
    resetVhAndPx()
  })
})
</script>

<style lang="less">
@import './assets/less/index';

* {
  user-select: none;
}

#app {
  height: 100%;
  width: 100%;
  position: relative;
  font-size: 14rem;
}

@media screen and (min-width: 500px) {
  #app {
    width: 500px !important;
    position: relative;
    left: 50%;
    transform: translateX(-50%);
  }
}

.go-enter-from {
  transform: translate3d(100%, 0, 0);
}

//最终状态
.back-enter-to,
.back-enter-from,
.go-enter-to,
.go-leave-from {
  transform: translate3d(0, 0, 0);
}

.go-leave-to {
  transform: translate3d(-100%, 0, 0);
}

.go-enter-active,
.go-leave-active,
.back-enter-active,
.back-leave-active {
  transition: all 0.3s;
}

.back-enter-from {
  transform: translate3d(-100%, 0, 0);
}

.back-leave-to {
  transform: translate3d(100%, 0, 0);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.banned-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 999999;
  background: #161823;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40rem;

  .banned-box {
    text-align: center;
    color: white;

    .icon-wrap {
      margin-bottom: 24rem;
      .icon {
        font-size: 80rem;
        color: #fe2c55;
      }
    }

    .title {
      font-size: 24rem;
      font-weight: bold;
      margin-bottom: 16rem;
    }

    .reason {
      font-size: 16rem;
      color: rgba(255, 255, 255, 0.8);
      line-height: 1.6;
      margin-bottom: 32rem;
      background: rgba(255, 255, 255, 0.05);
      padding: 20rem;
      border-radius: 12rem;
    }

    .tip {
      font-size: 14rem;
      color: rgba(255, 255, 255, 0.4);
    }
  }
}
</style>
