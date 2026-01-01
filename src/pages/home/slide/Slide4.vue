<template>
  <SlideItem class="slide-item-class">
    <div class="video-container" style="background: black">
      <!-- Loading 状态 -->
      <div v-if="store.loading && state.list.length === 0" class="loading-state">
        <div class="loading-spinner"></div>
        <p>加载中...</p>
      </div>

      <!-- 视频列表 -->
      <VideoList
        v-else-if="state.list.length > 0"
        :items="state.list"
        page="home"
        :initial-index="0"
        :autoplay="props.active"
        :has-more="state.hasMore"
        @load-more="loadMore"
      />

      <!-- 次数用完提示 -->
      <div v-else-if="state.quotaExceeded" class="empty-state">
        <p>今日次数已用完</p>
        <p style="font-size: 13px; margin-top: 10px; opacity: 0.7">明日更新或邀请好友</p>
      </div>

      <!-- 空状态提示 -->
      <div v-else class="empty-state">
        <p>暂无更多视频</p>
        <div class="retry-btn" @click="loadMore">点击重试</div>
      </div>
    </div>
  </SlideItem>
</template>

<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import SlideItem from '@/components/slide/SlideItem.vue'
import VideoList from '@/components/video/VideoList.vue'
import { recommendedVideo } from '@/api/videos'
import { useBaseStore } from '@/store/pinia'
import type { VideoItem } from '@/types'
import { _showNoticeDialog } from '@/utils'

const store = useBaseStore()
const props = defineProps({
  active: {
    type: Boolean,
    default: false
  }
})

const state = reactive({
  list: [] as VideoItem[],
  totalSize: 0,
  pageSize: 10,
  hasMore: true,
  quotaExceeded: false,
  pageNo: 0, // 🎯 独立记录页码，支持强制翻页重试
  retryCount: 0
})

async function loadMore() {
  if (store.loading) return

  if (!store.userinfo.uid) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  store.loading = true

  const requestParams: any = {
    start: state.pageNo * state.pageSize, // 💡 使用独立页码，确保重试时是下一页
    pageSize: state.pageSize
  }

  try {
    const res = await recommendedVideo(requestParams)
    store.loading = false

    if (res.success) {
      if (res.data.reason === 'quota_exceeded') {
        state.hasMore = false
        state.quotaExceeded = true
        return
      }

      const newList = res.data.list || []

      // 💡 过滤重复数据
      const existingIds = new Set(state.list.map((v) => v.aweme_id || v.id))
      const uniqueNewList = newList.filter((v: any) => !existingIds.has(v.aweme_id || v.id))

      if (uniqueNewList.length > 0) {
        state.list.push(...uniqueNewList)
        state.pageNo++ // 成功获得新数据，页码加1
        state.retryCount = 0
        state.hasMore = true // 💡 永远认为还有更多，保持滑动流
      } else if (newList.length > 0) {
        // 💡 如果这一页全是重复的，强制翻下一页再试一次
        if (state.retryCount < 8) {
          state.retryCount++
          state.pageNo++
          console.log(
            `[Slide4] 第 ${state.pageNo} 页全是重复，自动穿透到下一页 (重试 ${state.retryCount})`
          )
          return loadMore()
        }
      } else {
        // 返回空列表，尝试翻页重试
        if (state.retryCount < 5) {
          state.retryCount++
          state.pageNo++
          return loadMore()
        }
      }
    }
  } catch (e) {
    store.loading = false
    console.error('[Slide4] 加载异常', e)
  }
}

onMounted(() => {
  console.log('[Slide4] onMounted - 开始首次加载')
  loadMore()
})
</script>

<style scoped lang="less">
.slide-item-class {
  position: relative;

  .video-container {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
  }

  .loading-state,
  .empty-state {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    color: white;
    font-size: 16px;
    background: #000;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 15px;
  }

  .retry-btn {
    margin-top: 20px;
    padding: 8px 24px;
    background: #fe2c55;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.2s;

    &:active {
      opacity: 0.8;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
}
</style>
