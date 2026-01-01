<template>
  <div class="long-video-container">
    <!-- Loading 状态 -->
    <div v-if="state.loading && state.list.length === 0" class="loading-state">
      <div class="loading-spinner"></div>
      <p>加载中...</p>
    </div>

    <!-- 视频/图文 列表流 -->
    <VideoList
      v-else-if="state.list.length > 0"
      :items="state.list"
      page="long-video"
      :initial-index="0"
      :autoplay="props.active"
      :has-more="state.hasMore"
      @load-more="loadMore"
    />

    <!-- 空状态提示 -->
    <div v-else class="empty-state">
      <p>暂无更多作品</p>
      <div class="retry-btn" @click="loadMore">点击重试</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, watch } from 'vue'
import VideoList from '@/components/video/VideoList.vue'
import { recommendedLongVideo } from '@/api/videos'
import { useBaseStore } from '@/store/pinia'
import type { VideoItem } from '@/types'

const props = defineProps({
  active: {
    type: Boolean,
    default: false
  }
})

const state = reactive({
  list: [] as VideoItem[],
  page: 0,
  pageSize: 10,
  hasMore: true,
  loading: false
})

async function loadMore() {
  if (state.loading) return

  // 1. 🎯 核心重构：等待 App Ready
  const store = useBaseStore()
  if (!store.isAppReady) {
    console.log('[LongVideo] 等待 App Ready...')
    const unwatch = watch(
      () => store.isAppReady,
      (ready) => {
        if (ready) {
          unwatch()
          loadMore()
        }
      }
    )
    return
  }

  state.loading = true

  try {
    // 💡 显式传递 pageNo 偏移，利用后端 get_sea_feed 的分页逻辑
    const res = await recommendedLongVideo({
      pageNo: state.page,
      pageSize: state.pageSize
    })

    if (res.success) {
      const newList = res.data.list || []

      // 💡 前端去重
      const existingIds = new Set(state.list.map((v) => v.aweme_id || v.id))
      const uniqueNewList = newList.filter((v: any) => !existingIds.has(v.aweme_id || v.id))

      if (uniqueNewList.length > 0) {
        state.list.push(...uniqueNewList)
        state.page++
        state.hasMore = true
      } else if (newList.length > 0) {
        // 如果全是重复，尝试下一页
        state.page++
        state.loading = false
        return loadMore()
      } else {
        state.hasMore = false
      }
    }
  } catch (error) {
    console.error('[LongVideo] ❌ 加载失败', error)
  } finally {
    state.loading = false
  }
}

onMounted(() => {
  loadMore()
})

// 监听激活状态，如果从其他 tab 切回来且列表为空，重试加载
watch(
  () => props.active,
  (val) => {
    if (val && state.list.length === 0 && !state.loading) {
      loadMore()
    }
  }
)
</script>

<style scoped lang="less">
.long-video-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: black;
  box-sizing: border-box;

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
