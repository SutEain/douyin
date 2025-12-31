<template>
  <router-view v-slot="{ Component, route }">
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
import { useBaseStore } from '@/store/pinia.js'
import { onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const store = useBaseStore()
const router = useRouter()
const route = useRoute()
const transitionName = ref('go')

// 🎯 全局深链接处理
async function handleDeepLink() {
  if (store.startLiveId) {
    const roomId = store.startLiveId
    store.clearStartLiveId()

    await router.isReady()

    // 延迟一小会儿确保稳定
    setTimeout(() => {
      router.push({ path: '/home/live', query: { id: roomId } })
    }, 100)
  } else if (store.startVideoId) {
    const videoId = store.startVideoId
    store.clearStartVideoId()

    await router.isReady()

    setTimeout(() => {
      router.push({ path: '/video-detail', query: { id: videoId } })
    }, 100)
  }
}

// 🎯 监听 Store 中的深链接参数
watch(
  () => store.startLiveId,
  (newId) => {
    if (newId) handleDeepLink()
  },
  { immediate: true }
)
watch(
  () => store.startVideoId,
  (newId) => {
    if (newId) handleDeepLink()
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
  let innerHeight = window.innerHeight
  // 🎯 优先使用 Telegram SDK 提供的视口高度，解决 iOS 状态栏/动态高度问题
  const tg = (window as any).Telegram?.WebApp
  if (tg?.viewportHeight) {
    innerHeight = tg.viewportHeight
  }
  let vh = innerHeight * 0.01
  document.documentElement.style.setProperty('--vh', `${vh}px`)

  // 🎯 动态计算顶部安全距离 (解决全屏 vs 90% 视图)
  if (tg) {
    const isIOS =
      /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      tg.platform === 'ios' ||
      tg.platform === 'macos'

    // 如果高度占比较大（全屏模式），增加额外边距
    // 如果高度占比较小（90% 紧凑模式），边距设为 0
    // 用户要求全屏时再下来 2 个字体高度 (2 * 14rem = 28rem)
    // 加上原来的基础，我们设置全屏时额外增加 28rem
    // 🎯 只要视口高度超过屏幕的 70%，我们就认为它是全屏模式（Telegram 紧凑模式通常 < 70%）
    const isFullscreen = tg.isExpanded || tg.viewportHeight > window.screen.height * 0.7
    let extraPadding = 0

    if (isIOS) {
      if (isFullscreen) {
        // 🎯 全屏模式：仅使用安全区域，不再额外加 28px
        extraPadding = 0
      } else {
        // 🎯 紧凑模式：强制为 0，防止下垂
        extraPadding = -20 // 尝试负值抵消 env() 如果 env 依然生效
      }
    }

    // 💡 改进方案：我们直接控制是否启用 safe-area
    document.documentElement.style.setProperty('--tg-extra-padding', `${extraPadding}rem`)
    document.documentElement.classList.toggle('is-tg-fullscreen', isFullscreen)
  }
}

onMounted(() => {
  // 🎯 初始化应用（登录时自动创建用户，无需额外调用）
  store.init()
  resetVhAndPx()
  // ⏳ 50ms 后再次计算，确保 Telegram SDK 完全准备好视口数据
  setTimeout(resetVhAndPx, 50)
  setTimeout(resetVhAndPx, 500) // 再次兜底

  // 🎯 监听 Telegram 视口变化事件
  const tg = (window as any).Telegram?.WebApp
  if (tg) {
    tg.onEvent('viewportChanged', resetVhAndPx)
    // 监听展开事件
    tg.onEvent('settingsCustomButtonClicked', resetVhAndPx) // 兜底
  }

  // 监听resize事件 视图大小发生变化就重新计算1vh的值
  // ⚠️ 注意：移动端键盘弹出也会触发 resize，不能在这里刷新页面
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
</style>
