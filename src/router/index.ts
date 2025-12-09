import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import routes from './routes'
import { useBaseStore } from '@/store/pinia'
import { IS_SUB_DOMAIN } from '@/config'

const router = createRouter({
  history: IS_SUB_DOMAIN ? createWebHashHistory() : createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    // console.log('savedPosition', savedPosition)
    if (savedPosition) {
      return savedPosition
    } else {
      return { top: 0 }
    }
  }
})
router.beforeEach((to, from) => {
  const baseStore = useBaseStore()

  // ✅ 调试日志
  console.log(
    `🔀 [Router] ${from.path} (${getDepth(from.path)}) -> ${to.path} (${getDepth(to.path)})`
  )

  //footer下面的5个按钮，对跳不要用动画
  const noAnimation = ['/', '/home', '/me', '/shop', '/message', '/publish', '/home/live', '/test']
  if (noAnimation.indexOf(from.path) !== -1 && noAnimation.indexOf(to.path) !== -1) {
    return true
  }

  const toDepth = getDepth(to.path)
  const fromDepth = getDepth(from.path)

  if (toDepth > fromDepth) {
    // 前进
    if (to.matched && to.matched.length) {
      const toComponentName = to.matched[0].components?.default.name
      baseStore.updateExcludeNames({ type: 'remove', value: toComponentName })
    }
  } else {
    // 后退
    if (from.matched && from.matched.length) {
      const fromComponentName = from.matched[0].components?.default.name
      // ✅ 保护 Home 组件不被销毁
      if (fromComponentName !== 'Home' && fromComponentName !== 'index') {
        baseStore.updateExcludeNames({ type: 'add', value: fromComponentName })
      }
    }
  }
  return true
})

function getDepth(path: string) {
  return routes.findIndex((v) => v.path === path)
}

export default router
