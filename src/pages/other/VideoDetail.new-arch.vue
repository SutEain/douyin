<template>
  <div id="video-detail">
    <!-- 顶部返回按钮 -->
    <div class="back-wrapper">
      <Icon class="back-icon" icon="icon-park-outline:left" @click="router.back" />
    </div>

    <!-- 视频列表 -->
    <div class="content">
      <VideoList
        ref="listRef"
        :items="state.list"
        :initial-index="state.index"
        page="detail"
        :autoplay="true"
        @update:index="handleIndexChange"
        @load-more="loadMore"
      />
    </div>
    
    <!-- 底部导航 -->
    <BaseFooter :init-tab="5" />

    <!-- 评论弹窗 -->
    <Comment
      page-id="video-detail"
      :video-id="videoStore.commentVideoId"
      v-model="videoStore.showComments"
      @close="videoStore.closeComments()"
    />

    <!-- 分享弹窗 -->
    <Share
      v-model="state.isSharing"
      page-id="video-detail"
      :item="videoStore.currentVideo"
    />
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import VideoList from '@/components/video/VideoList.vue'
import BaseFooter from '@/components/BaseFooter.vue'
import Comment from '@/components/CommentNew.vue'
import Share from '@/components/Share.vue'
import { useBaseStore } from '@/store/pinia'
import { useVideoStore } from '@/stores/video'
import { useNav } from '@/utils/hooks/useNav'
import { videoManager } from '@/utils/videoManager'
import type { VideoItem } from '@/types'

defineOptions({
  name: 'VideoDetail'
})

const router = useRouter()
const nav = useNav()
const baseStore = useBaseStore()
const videoStore = useVideoStore()

const state = reactive({
  index: 0,
  list: [] as VideoItem[],
  isSharing: false
})

const listRef = ref()

function handleIndexChange(index: number) {
  state.index = index
  const currentItem = state.list[index]
  if (currentItem) {
    videoStore.setCurrentVideo(currentItem, index)
  }
}

function loadMore() {
  console.log('[VideoDetail] 加载更多')
}

onMounted(() => {
  console.log('[VideoDetail] mounted')
  
  if (baseStore.routeData?.list && Array.isArray(baseStore.routeData.list)) {
    state.index = baseStore.routeData.index || 0
    state.list = baseStore.routeData.list
  } else {
    console.warn('[VideoDetail] 没有视频数据，返回')
    router.back()
    return
  }
  
  videoManager.pauseAll()
})

onUnmounted(() => {
  console.log('[VideoDetail] unmounted')
})

onActivated(() => {
  console.log('[VideoDetail] activated')
  const currentItem = state.list[state.index]
  if (currentItem) {
    setTimeout(() => {
      videoManager.play(currentItem.aweme_id, 'detail')
    }, 100)
  }
})

onDeactivated(() => {
  console.log('[VideoDetail] deactivated')
  videoManager.pauseAll()
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

  .content {
    height: calc(var(--vh, 1vh) * 100 - var(--footer-height));
  }
}
</style>
