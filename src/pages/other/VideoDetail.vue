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
            <li>累计邀请 3 人成功 → 永久解锁无限成人内容</li>
          </ul>
          <p>请前往 Bot，点击「邀请好友解锁🔞」获取你的专属邀请链接。</p>
        </div>
      </div>
      <!-- 正常详情播放 -->
      <VideoList
        v-else
        :items="videoItems"
        page="detail"
        :initial-index="initialIndex"
        :autoplay="true"
      />
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
import { reactive, onMounted, onUnmounted, onDeactivated, provide, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import VideoList from '@/components/video/VideoList.vue'
import BaseFooter from '@/components/BaseFooter.vue'
import Comment from '@/components/CommentNew.vue'
import Share from '@/components/Share.vue'
import { useBaseStore } from '@/store/pinia'
import { videoPlaybackManager } from '@/utils/videoPlaybackManager'
import bus, { EVENT_KEY } from '@/utils/bus'
import { getAdultQuota } from '@/api/videos'

defineOptions({
  name: 'VideoDetail'
})

const router = useRouter()
const baseStore = useBaseStore()

const state = reactive({
  videoItem: null,
  showComments: false,
  commentVideoId: '',
  isSharing: false,
  showAdultRules: false,
  // 滑动返回相关
  startY: 0,
  startX: 0,
  translateY: 0,
  isDragging: false
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
const initialIndex = computed(() => {
  if (Number.isInteger(baseStore.routeData?.index)) {
    return baseStore.routeData.index
  }
  return 0
})

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

onMounted(() => {
  // 从路由数据获取单个视频
  if (baseStore.routeData?.items?.length) {
    state.videoItem = baseStore.routeData.items[initialIndex.value]
  } else if (baseStore.routeData?.item) {
    state.videoItem = baseStore.routeData.item
  } else {
    console.error('[VideoDetail] 未找到视频数据')
    router.back()
    return
  }

  // 暂停其他页面的视频
  videoPlaybackManager.pauseAll()

  // 如果是成人视频，检查今日配额
  if (state.videoItem?.is_adult) {
    getAdultQuota().then((res) => {
      if (res.success && !res.data.unlimited && res.data.remaining <= 0) {
        state.showAdultRules = true
      }
    })
  }

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
  height: 100%;
  width: 100%;
  background: black;
  z-index: 1;

  .back-wrapper {
    position: fixed;
    left: 15rem;
    top: 10rem;
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
    height: calc(var(--vh, 1vh) * 100 - var(--footer-height));
    position: relative;
    transition: transform 0.2s ease-out;
    will-change: transform;

    &.no-transition {
      transition: none;
    }
  }
}
</style>
