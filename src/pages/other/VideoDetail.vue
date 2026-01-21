<template>
  <div
    id="video-detail"
    @touchstart="handleTouchStart"
    @touchmove="handleTouchMove"
    @touchend="handleTouchEnd"
  >
    <!-- 顶部返回按钮 -->
    <div class="back-wrapper">
      <Icon class="back-icon" icon="icon-park-outline:left" @click="router.back" />
    </div>

    <!-- 单个视频（改为三槽位循环结构） -->
    <div
      class="video-container"
      v-if="state.videoItem"
      :class="{ 'no-transition': state.isDragging }"
      :style="{ transform: `translateY(${state.translateY}px)` }"
    >
      <!-- 成人内容次数已用完：显示规则说明页 -->
      <div v-if="state.showAdultRules" class="adult-rules-page">
        <div class="rules-card">
          <h2>今日成人内容已达上限</h2>
          <p>默认每日可观看 5 条成人内容。</p>
          <p>使用你的专属邀请链接邀请新用户注册，可解锁无限成人内容：</p>
          <ul>
            <li>邀请 1 人成功 → 解锁 24 小时无限成人内容</li>
            <li>邀请 2 人成功 → 解锁 3 天无限成人内容</li>
            <li>邀请 3 人成功 → 永久解锁无限成人内容</li>
          </ul>
          <p>请前往 Bot，点击「邀请好友解锁🔞」获取你的专属邀请链接。</p>
        </div>
      </div>
    <!-- 正常详情播放 -->
    <div class="video-container has-footer-offset" v-else>
      <VideoList
        :items="dynamicVideoItems"
        page="detail"
        :initial-index="initialIndex"
        :autoplay="true"
        :has-more="hasMore"
        @load-more="handleLoadMore"
      />
    </div>
    </div>

    <!-- 🎯 加载中占位 -->
    <div v-else class="video-loading">
      <Loading style="width: 40rem" />
    </div>

    <!-- 底部导航 -->
    <BaseFooter :init-tab="5" />

    <!-- ✅ 使用 Teleport 将弹窗传送到 body，避免 transform 影响 fixed 定位 -->
    <Teleport to="body">
      <!-- 评论弹窗 -->
      <Comment
        page-id="video-detail"
        :video-id="state.commentVideoId"
        v-model="state.showComments"
        @close="state.showComments = false"
      />

      <!-- 分享弹窗 -->
      <Share v-model="state.isSharing" page-id="video-detail" :item="state.videoItem" />
    </Teleport>
  </div>
</template>

<script setup lang="jsx">
import { reactive, ref, onMounted, onUnmounted, onDeactivated, provide, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
import VideoList from '@/components/video/VideoList.vue'
import BaseFooter from '@/components/BaseFooter.vue'
import Comment from '@/components/CommentNew.vue'
import Share from '@/components/Share.vue'
import Loading from '@/components/Loading.vue'
import { _notice } from '@/utils'
import { useBaseStore } from '@/store/pinia'
import { videoPlaybackManager } from '@/utils/videoPlaybackManager'
import bus, { EVENT_KEY } from '@/utils/bus'
import { getAdultQuota, getVideoById, recommendedVideoTab } from '@/api/videos'

defineOptions({
  name: 'VideoDetail'
})

const route = useRoute()
const router = useRouter()
const baseStore = useBaseStore()

const state = reactive({
  videoItem: null,
  loading: false,
  showComments: false,
  commentVideoId: '',
  isSharing: false,
  showAdultRules: false,
  // 滑动返回相关
  startY: 0,
  startX: 0,
  translateY: 0,
  isDragging: false,
  // 加载更多相关
  pageNo: 0,
  hasMore: true,
  loadingMore: false
})

// ✅ 提供 item 和 position 给子组件（BaseVideo, ItemDesc, ItemToolbar）
provide(
  'item',
  computed(() => state.videoItem)
)
provide(
  'position',
  computed(() => ({ uniqueId: 'video_detail', index: 0 }))
)

const videoItems = computed(() => {
  if (baseStore.routeData?.items?.length) {
    return baseStore.routeData.items
  }
  return state.videoItem ? [state.videoItem] : []
})

// 🎯 动态更新 videoItems（支持追加新数据）
const dynamicVideoItems = ref([...videoItems.value])

watch(
  videoItems,
  (newItems) => {
    dynamicVideoItems.value = [...newItems]
  },
  { immediate: true }
)

const initialIndex = computed(() => {
  if (Number.isInteger(baseStore.routeData?.index)) {
    return baseStore.routeData.index
  }
  return 0
})

const hasMore = computed(() => state.hasMore && !state.loadingMore)

// 🎯 加载更多视频（从 videoTab 进入时）
async function handleLoadMore() {
  console.log('[VideoDetail] handleLoadMore 被触发', {
    hasRouteData: !!baseStore.routeData?.items?.length,
    loadingMore: state.loadingMore,
    hasMore: state.hasMore,
    currentPageNo: state.pageNo
  })

  // 如果不是从 videoTab 进入（没有 routeData.items），不加载
  if (!baseStore.routeData?.items?.length) {
    console.log('[VideoDetail] 不是从 videoTab 进入，跳过加载更多')
    return
  }

  if (state.loadingMore || !state.hasMore) {
    console.log('[VideoDetail] 跳过加载更多', {
      原因: state.loadingMore ? '正在加载中' : '没有更多数据'
    })
    return
  }

  state.loadingMore = true
  state.pageNo++

  console.log('[VideoDetail] 开始加载更多', {
    请求pageNo: state.pageNo,
    当前视频数: dynamicVideoItems.value.length
  })

  try {
    const res = await recommendedVideoTab({
      pageNo: state.pageNo,
      pageSize: 10
    })

    if (res.success && res.data?.list?.length > 0) {
      // 🎯 去重：避免重复添加已存在的视频
      const existingIds = new Set(dynamicVideoItems.value.map((v) => v.aweme_id || v.id))
      const newItems = res.data.list.filter((v) => !existingIds.has(v.aweme_id || v.id))

      if (newItems.length > 0) {
        dynamicVideoItems.value.push(...newItems)
        // 🎯 同步更新 baseStore.routeData.items，确保数据一致
        if (baseStore.routeData?.items) {
          baseStore.routeData.items.push(...newItems)
        }
      }

      // 🎯 判断是否还有更多
      state.hasMore = res.data.list.length >= 10

      console.log('[VideoDetail] 加载更多成功', {
        新增: newItems.length,
        总数: dynamicVideoItems.value.length,
        hasMore: state.hasMore
      })
    } else {
      state.hasMore = false
    }
  } catch (error) {
    console.error('[VideoDetail] 加载更多失败:', error)
  } finally {
    state.loadingMore = false
  }
}

function handleShowShare() {
  state.isSharing = true
}

function handleShowComments(item) {
  state.commentVideoId = item.aweme_id
  state.showComments = true
}

// 更新视频项（点赞、收藏等）
function updateItem({ position, item }) {
  if (position.uniqueId === 'video_detail') {
    state.videoItem = item
  }
}

// 外层滑动返回手势禁用，交给内部 VideoList 手势
function handleTouchStart() {}
function handleTouchMove() {}
function handleTouchEnd() {}

async function fetchVideoDetail(id) {
  state.loading = true
  try {
    const res = await getVideoById(id)
    if (res.success && res.data) {
      state.videoItem = res.data
    } else {
      _notice('视频加载失败')
      router.back()
    }
  } catch (e) {
    console.error('[VideoDetail] fetch error:', e)
    router.back()
  } finally {
    state.loading = false
  }
}

onMounted(() => {
  // 从路由数据获取单个视频
  if (baseStore.routeData?.items?.length) {
    state.videoItem = baseStore.routeData.items[initialIndex.value]
    // 🎯 修复：根据已有数据量初始化 pageNo，确保加载更多时不会重复
    // 假设每页 10 条，计算当前已加载的最大页数
    // 公式：已加载页数 = ceil(count / pageSize)，最大 pageNo = 已加载页数 - 1
    const currentItemsCount = baseStore.routeData.items.length
    const pageSize = 10
    const loadedPages = Math.ceil(currentItemsCount / pageSize)
    state.pageNo = loadedPages - 1
    console.log('[VideoDetail] 初始化 pageNo', {
      已有视频数: currentItemsCount,
      已加载页数: loadedPages,
      初始pageNo: state.pageNo,
      下次请求pageNo: state.pageNo + 1
    })
  } else if (baseStore.routeData?.item) {
    state.videoItem = baseStore.routeData.item
  } else if (baseStore.startVideoData) {
    // 🎯 优先使用全局预加载的数据（深链接）
    console.log('[VideoDetail] 使用预加载的深链视频数据')
    state.videoItem = baseStore.startVideoData
    baseStore.clearStartVideoId() // 使用后彻底清除
  } else {
    // 🎯 深链接兜底：如果路由没有传数据且没预加载，根据 ID 查后端
    const videoId = route.query.id
    if (videoId) {
      fetchVideoDetail(videoId)
    } else {
      console.error('[VideoDetail] 未找到视频数据且无 ID')
      router.back()
      return
    }
  }

  // 暂停其他页面的视频
  videoPlaybackManager.pauseAll()

  // 如果是成人视频，检查今日配额
  watch(
    () => state.videoItem,
    (item) => {
      if (item?.is_adult) {
        getAdultQuota().then((res) => {
          if (res.success && !res.data.unlimited && res.data.remaining <= 0) {
            state.showAdultRules = true
          }
        })
      }
    },
    { immediate: true }
  )

  // 监听事件
  bus.on(EVENT_KEY.UPDATE_ITEM, updateItem)
  bus.on(EVENT_KEY.SHOW_SHARE, handleShowShare)
  bus.on(EVENT_KEY.SHOW_COMMENTS, handleShowComments)
})

onUnmounted(() => {
  // 清理事件监听
  bus.off(EVENT_KEY.UPDATE_ITEM, updateItem)
  bus.off(EVENT_KEY.SHOW_SHARE, handleShowShare)
  bus.off(EVENT_KEY.SHOW_COMMENTS, handleShowComments)

  // 停止播放
  videoPlaybackManager.pauseAll()
})

onDeactivated(() => {
  videoPlaybackManager.pauseAll()
})
</script>

<style scoped lang="less">
#video-detail {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  height: calc(var(--vh, 1vh) * 100);
  width: 100%;
  background: black;
  z-index: 1;

  .back-wrapper {
    position: fixed;
    left: 15rem;
    top: calc(10rem + env(safe-area-inset-top)); // 🎯 适配刘海屏
    z-index: 999;

    .back-icon {
      font-size: 28rem;
      color: #fff;
      cursor: pointer;
      filter: drop-shadow(0 2rem 4rem rgba(0, 0, 0, 0.3));
    }
  }

  .video-container {
    width: 100%;
    /* 🎯 方案升级：核心修复视频遮挡字幕问题 */
    /* 使用 padding-bottom 预留出 Footer 的空间，配合 box-sizing: border-box */
    /* 这样 height: 100% 的子组件（视频）就正好止步于 Footer 上方 */
    height: 100%;
    box-sizing: border-box;
    position: relative;
    transition: transform 0.2s ease-out;
    will-change: transform;

    /* 🎯 定义底部偏移量 */
    &.has-footer-offset {
      padding-bottom: calc(var(--footer-height) + env(safe-area-inset-bottom));
      --footer-offset: 0rem; 

      /* 🎯 安卓 Chrome 环境下，额外增加偏移量以应对地址栏和导航栏遮挡 */
      :global(html.is-chrome.is-android) & {
        padding-bottom: calc(var(--footer-height) + env(safe-area-inset-bottom) + 35rem);
      }
    }

    &.no-transition {
      transition: none;
    }
  }

  .video-loading {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: black;
  }
}
</style>
