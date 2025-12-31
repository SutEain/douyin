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
import BaseMask from '@/components/BaseMask.vue'
import { BASE_URL } from '@/config'

const store = useBaseStore()
const router = useRouter()
const route = useRoute()
const transitionName = ref('go')

// 🎯 全局深链接处理
async function handleDeepLink() {
  console.log(
    '[DeepLink][App] handleDeepLink 触发, startLiveId:',
    store.startLiveId,
    'startVideoId:',
    store.startVideoId
  )

  if (store.startLiveId) {
    const roomId = store.startLiveId
    console.log('[DeepLink][App] 检测到直播深链接，准备跳转:', roomId)
    store.clearStartLiveId()

    console.log('[DeepLink][App] 等待 router.isReady()...')
    await router.isReady()
    console.log('[DeepLink][App] router.isReady() 完成，当前路由:', route.fullPath)

    // 延迟一小会儿确保稳定
    setTimeout(() => {
      console.log('[DeepLink][App] 执行 router.push 到直播间:', roomId)
      router
        .push({ path: '/home/live', query: { id: roomId } })
        .then(() => {
          console.log('[DeepLink][App] router.push 直播间完成')
        })
        .catch((err) => {
          console.error('[DeepLink][App] router.push 直播间失败:', err)
        })
    }, 100)
  } else if (store.startVideoId) {
    const videoId = store.startVideoId
    console.log('[DeepLink][App] 检测到视频深链接，准备跳转:', videoId)
    store.clearStartVideoId()

    console.log('[DeepLink][App] 等待 router.isReady()...')
    await router.isReady()

    setTimeout(() => {
      console.log('[DeepLink][App] 执行 router.push 到视频详情:', videoId)
      router
        .push({ path: '/video-detail', query: { id: videoId } })
        .then(() => {
          console.log('[DeepLink][App] router.push 视频完成')
        })
        .catch((err) => {
          console.error('[DeepLink][App] router.push 视频失败:', err)
        })
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
  let vh = window.innerHeight * 0.01
  document.documentElement.style.setProperty('--vh', `${vh}px`)
  //document.documentElement.style.fontSize = document.documentElement.clientWidth / 375 + 'px'
}

onMounted(() => {
  // 🎯 初始化应用（登录时自动创建用户，无需额外调用）
  store.init()
  resetVhAndPx()
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
