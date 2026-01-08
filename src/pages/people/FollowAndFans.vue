<template>
  <div class="FollowAndFans" id="FollowAndFans">
    <BaseHeader backMode="light">
      <template v-slot:center>
        <span class="f14">{{ store.userinfo.nickname }}</span>
      </template>
      <template v-slot:right>
        <div>
          <img
            src="../../assets/img/icon/people/add-user.png"
            style="width: 2rem"
            @click="nav('/people/find-acquaintance')"
          />
        </div>
      </template>
    </BaseHeader>

    <!-- ✅ 双层滚动结构：防止下拉时关闭 miniApp -->
    <div
      class="scroll-container"
      @scroll="handleScroll"
      @touchstart="handleTouchStart"
      ref="scrollContainer"
    >
      <div class="main" ref="mainContent">
        <div class="content">
          <div class="indicator-wrapper">
            <Indicator
              tabStyleWidth="50%"
              :tabTexts="['关注', '粉丝']"
              v-model:active-index="data.slideIndex"
            >
            </Indicator>
          </div>
          <SlideHorizontal v-model:index="data.slideIndex" :disableSwipe="true">
            <SlideItem class="tab1">
              <Search
                v-model="data.searchKey"
                placeholder="搜索用户备注或名字"
                :is-show-right-text="false"
              />
              <div class="is-search" v-if="data.searchKey">
                <div class="search-result" v-if="data.searchFollowing.length">
                  <People
                    :key="i"
                    v-for="(item, i) in data.searchFollowing"
                    :people="item"
                    :show-unfollow="true"
                    @unfollow="handleUnfollow(item.user_id)"
                    @clickAvatar="handleClickAvatar(item)"
                  ></People>
                </div>
                <div class="no-result" v-else>
                  <img src="../../assets/img/icon/no-result.png" alt="" />
                  <span class="n1">搜索结果为空</span>
                  <span class="n2">没有搜索到相关内容</span>
                </div>
              </div>
              <div class="no-search" v-else>
                <People
                  :key="i"
                  v-for="(item, i) in data.following"
                  :people="item"
                  :show-unfollow="true"
                  @unfollow="handleUnfollow(item.user_id)"
                  @clickAvatar="handleClickAvatar(item)"
                ></People>
                <NoMore v-if="data.following.length" />
              </div>
            </SlideItem>
            <SlideItem class="tab2">
              <People
                :key="i"
                v-for="(item, i) in data.followers"
                :people="item"
                @clickAvatar="handleClickAvatar(item)"
              ></People>
              <NoMore v-if="data.followers.length" />
            </SlideItem>
          </SlideHorizontal>
        </div>
      </div>
      <!-- ✅ 关闭 main -->
    </div>
    <!-- ✅ 关闭 scroll-container -->
  </div>
</template>
<script setup lang="ts">
import People from './components/People.vue'
import Search from '../../components/Search.vue'
import Indicator from '../../components/slide/Indicator.vue'
import { useBaseStore } from '@/store/pinia'
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNav } from '@/utils/hooks/useNav'
import { getFollowingList, getFollowersList } from '@/api/user'
import { toggleFollowUser } from '@/api/videos'
import { _notice } from '@/utils'

defineOptions({
  name: 'FollowAndFans'
})

const route = useRoute()
const router = useRouter()
const nav = useNav()
const store = useBaseStore()
const data = reactive({
  isSearch: false,
  searchKey: '',
  slideIndex: 0,
  following: [] as any[],
  followers: [] as any[],
  searchFollowing: [] as any[]
})

// UserPanel 相关状态 (已移除，改用路由跳转)
// const showUserPanel = ref(false)
// const selectedUser = ref<any>(null)

// ✅ 双层滚动结构的 refs
const scrollContainer = ref<HTMLElement | null>(null)
const mainContent = ref<HTMLElement | null>(null)
let startY = 0

// ✅ 滚动事件已移到 handleTouchMove 下方

// 🎯 处理触摸开始：记录起始位置
function handleTouchStart(e: TouchEvent) {
  startY = e.touches[0].clientY
  if (scrollContainer.value) {
    const scrollTop = scrollContainer.value.scrollTop
    const scrollHeight = scrollContainer.value.scrollHeight
    const clientHeight = scrollContainer.value.clientHeight
    console.log('[FollowAndFans] touchStart:', {
      startY,
      scrollTop,
      scrollHeight,
      clientHeight,
      canScroll: scrollHeight > clientHeight
    })
  }
}

// 🎯 处理触摸移动：只在顶部下拉时阻止默认行为，防止 Telegram 下拉关闭 miniApp
function handleTouchMove(e: TouchEvent) {
  if (!scrollContainer.value) {
    console.log('[FollowAndFans] touchMove: scrollContainer is null')
    return
  }

  const currentY = e.touches[0].clientY
  const deltaY = currentY - startY
  const scrollTop = scrollContainer.value.scrollTop
  const scrollHeight = scrollContainer.value.scrollHeight
  const clientHeight = scrollContainer.value.clientHeight

  // 🎯 调试日志
  const isAtTop = scrollTop <= 0
  const isPullingDown = deltaY > 0
  const shouldPrevent = isAtTop && isPullingDown

  console.log('[FollowAndFans] touchMove:', {
    currentY,
    deltaY,
    scrollTop,
    scrollHeight,
    clientHeight,
    isAtTop,
    isPullingDown,
    shouldPrevent,
    canScroll: scrollHeight > clientHeight
  })

  // 🎯 只在顶部且向下拉时阻止默认行为（防止 Telegram 下拉关闭 miniApp）
  // 其他情况（包括正常滚动）都不阻止，让浏览器正常处理
  if (shouldPrevent) {
    console.log('[FollowAndFans] preventDefault: 阻止下拉关闭 miniApp')
    e.preventDefault()
  }
  // 注意：不在底部阻止，允许正常滚动到底部
}

// 🎯 滚动事件调试
function handleScroll() {
  if (scrollContainer.value) {
    const scrollTop = scrollContainer.value.scrollTop
    const scrollHeight = scrollContainer.value.scrollHeight
    const clientHeight = scrollContainer.value.clientHeight
    const scrollPercent =
      scrollHeight > clientHeight
        ? ((scrollTop / (scrollHeight - clientHeight)) * 100).toFixed(1)
        : '0'

    // 只在关键位置打印日志，避免刷屏
    if (scrollTop === 0 || scrollTop + clientHeight >= scrollHeight - 5) {
      console.log('[FollowAndFans] scroll:', {
        scrollTop,
        scrollHeight,
        clientHeight,
        scrollPercent: scrollPercent + '%',
        isAtTop: scrollTop <= 0,
        isAtBottom: scrollTop + clientHeight >= scrollHeight - 5
      })
    }
  }
}

onMounted(async () => {
  data.slideIndex = ~~route.query.type
  await loadFollowing()
  await loadFollowers()

  // 🎯 等待 DOM 更新后检查滚动容器状态
  await new Promise((resolve) => setTimeout(resolve, 100))

  if (scrollContainer.value) {
    const scrollHeight = scrollContainer.value.scrollHeight
    const clientHeight = scrollContainer.value.clientHeight
    const canScroll = scrollHeight > clientHeight

    console.log('[FollowAndFans] mounted:', {
      scrollHeight,
      clientHeight,
      canScroll,
      computedStyle: {
        overflowY: window.getComputedStyle(scrollContainer.value).overflowY,
        touchAction: window.getComputedStyle(scrollContainer.value).touchAction,
        webkitOverflowScrolling: window.getComputedStyle(scrollContainer.value)
          .webkitOverflowScrolling,
        overscrollBehavior: window.getComputedStyle(scrollContainer.value).overscrollBehavior
      }
    })

    // 🎯 手动添加非 passive 的 touchmove 监听器（Vue 的 @touchmove 默认是 passive）
    scrollContainer.value.addEventListener('touchmove', handleTouchMove, { passive: false })

    // 🎯 添加滚动事件监听
    scrollContainer.value.addEventListener('scroll', handleScroll, { passive: true })
  } else {
    console.error('[FollowAndFans] mounted: scrollContainer is null!')
  }
})

onUnmounted(() => {
  // 🎯 清理事件监听器
  if (scrollContainer.value) {
    scrollContainer.value.removeEventListener('touchmove', handleTouchMove)
    scrollContainer.value.removeEventListener('scroll', handleScroll)
  }
})

async function loadFollowing() {
  const res = await getFollowingList()
  if (res.success) {
    data.following = res.data.list
  }
}

async function loadFollowers() {
  const res = await getFollowersList()
  if (res.success) {
    data.followers = res.data.list
  }
}

async function handleUnfollow(userId: string) {
  try {
    await toggleFollowUser(userId, false)
    _notice('已取消关注')
    await loadFollowing()
  } catch (error: any) {
    _notice(error?.message || '取消关注失败')
  }
}

// ✅ 处理头像点击，打开用户资料页（路由跳转）
function handleClickAvatar(user: any) {
  console.log('[FollowAndFans] 点击头像:', user)
  const userId = user.user_id || user.uid
  if (userId) {
    router.push(`/user/${userId}`)
  }
}

watch(
  () => data.searchKey,
  (newVal) => {
    if (newVal) {
      const keyword = newVal.toLowerCase()
      data.searchFollowing = data.following.filter((v) => {
        return (
          v.nickname?.toLowerCase().includes(keyword) ||
          v.unique_id?.toLowerCase().includes(keyword)
        )
      })
    } else {
      data.searchFollowing = []
    }
  }
)
</script>

<style scoped lang="less">
@import '../../assets/less/index';

.FollowAndFans {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;
  color: white;
  font-size: 14rem;
  overflow: hidden; // ✅ 外层禁止滚动
  overscroll-behavior: contain; // ✅ 防止下拉时拉动整个 miniApp
  overscroll-behavior-y: contain; // ✅ 明确指定 Y 轴
  display: flex;
  flex-direction: column;

  // ✅ 内层滚动容器
  .scroll-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch; // ✅ iOS 平滑滚动
    overscroll-behavior: contain; // ✅ 防止下拉时拉动整个 miniApp
    overscroll-behavior-y: contain; // ✅ 明确指定 Y 轴
    touch-action: pan-y; // ✅ 只允许垂直滚动
    will-change: scroll-position; // ✅ 优化 iOS 滚动性能
    background: var(--main-bg);

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .main {
    min-height: 100.1%; // ✅ 强制内容超出一点点，确保 iOS 下能触发滚动
    // 移除 touch-action，让滚动容器处理
  }

  .content {
    padding-top: var(--common-header-height);

    .indicator-wrapper {
      padding: 0 var(--page-padding);
      background: var(--main-bg);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .search-ctn {
      z-index: 9;
      left: 0;
      background: var(--main-bg);
      position: fixed;
      width: 100vw;
      box-sizing: border-box;
      padding: 10rem var(--page-padding) 0 var(--page-padding);
    }
  }

  .tab1,
  .tab2 {
    // ✅ 移除 overflow: auto，让外层的 scroll-container 处理滚动
    overflow: visible;
    padding: 0 var(--page-padding);
    box-sizing: border-box;

    // ✅ 覆盖 SlideHorizontal 的 touch-action，移除限制让滚动容器处理
    :deep(.slide-list) {
      touch-action: auto !important; // 移除 pan-y 限制，让父滚动容器处理
    }

    // ✅ 确保 SlideItem 高度自适应内容
    :deep(.slide-item) {
      height: auto !important;
      min-height: 100%;
    }
  }

  .tab1 {
    .title {
      display: flex;
      align-items: center;
      margin-bottom: 10rem;
      color: var(--second-text-color);
      font-size: 12rem;
    }

    .no-search {
      padding-top: 60rem;
    }

    .is-search {
      padding-top: 50rem;

      .no-result {
        display: flex;
        flex-direction: column;
        align-items: center;

        img {
          margin-top: 150rem;
          height: 150rem;
        }

        .n1 {
          margin-top: 40rem;
          font-size: 16rem;
        }

        .n2 {
          margin-top: 20rem;
          font-size: 12rem;
          color: var(--second-text-color);
        }
      }
    }
  }
}
</style>
