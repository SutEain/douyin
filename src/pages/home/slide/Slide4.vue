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
  retryCount: 0 // 🎯 记录连续空数据的重试次数
})

async function loadMore() {
  // 🛡️ 避免重复加载
  if (store.loading) return

  // 🎯 登录态校验兜底：如果 store 还没 init 完，稍微等一下
  if (!store.userinfo.uid) {
    console.log('[Slide4] 等待登录态就绪...')
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  store.loading = true

  const requestParams: any = {
    start: state.list.length,
    pageSize: state.pageSize
  }

  try {
    const res = await recommendedVideo(requestParams)
    store.loading = false

    if (res.success) {
      // 1. 配额检查
      if (res.data.reason === 'quota_exceeded') {
        state.hasMore = false
        state.quotaExceeded = true
        return
      }

      const newList = res.data.list || []
      const totalNum = Number(res.data.total)

      // 2. 更新 hasMore：只要返回了数据，或者 total 还没到，就认为还有
      if (newList.length > 0) {
        state.hasMore = res.data.hasMore !== false
        state.retryCount = 0 // 重置重试计数
      } else {
        // 💡 如果没给数据，且已经重试了 3 次，才彻底认为没了
        if (state.retryCount < 3) {
          state.retryCount++
          console.log(`[Slide4] 接口返回空，尝试自动重试第 ${state.retryCount} 次`)
          return loadMore()
        }
        state.hasMore = false
      }

      // 3. 去重合并
      const existingIds = new Set(state.list.map((v) => v.aweme_id || v.id))
      const uniqueNewList = newList.filter((v: any) => !existingIds.has(v.aweme_id || v.id))

      if (uniqueNewList.length > 0) {
        state.list.push(...uniqueNewList)
      } else if (newList.length > 0 && state.hasMore) {
        // 💡 重点：如果返回了数据但全是重复的，自动加载下一页，防止卡在 1 条
        console.log('[Slide4] 数据全部重复，自动追载下一页...')
        return loadMore()
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
