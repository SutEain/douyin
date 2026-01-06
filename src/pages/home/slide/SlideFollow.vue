<template>
  <SlideItem class="slide-item-class">
    <div class="video-container" style="background: black">
      <!-- 视频列表 -->
      <VideoList
        v-if="state.list.length > 0"
        :items="state.list"
        page="home"
        :initial-index="0"
        :autoplay="props.active"
        :has-more="state.hasMore"
        @load-more="loadMore"
      />

      <!-- 空状态提示 (只有在不加载且明确没更多时显示) -->
      <div v-else-if="!state.loading && !state.hasMore" class="empty-state">
        <p>你还没有关注或关注的人还没有发布作品</p>
        <div class="retry-btn" @click="loadMore">点击刷新</div>
      </div>

      <!-- Loading 状态 (初始加载或请求中) -->
      <div v-else class="loading-state">
        <div class="loading-spinner"></div>
        <p>加载中...</p>
      </div>
    </div>
  </SlideItem>
</template>

<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import SlideItem from '@/components/slide/SlideItem.vue'
import VideoList from '@/components/video/VideoList.vue'
import { followingVideo } from '@/api/videos'
import { useBaseStore } from '@/store/pinia'
import type { VideoItem } from '@/types'

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
  loading: false // 🎯 改为局部 loading
})

async function loadMore() {
  if (state.loading || !state.hasMore) {
    return
  }

  state.loading = true

  const params = {
    start: state.list.length,
    pageSize: state.pageSize
  }

  console.log('[SlideFollow] 请求关注流数据:', params)

  const res = await followingVideo(params)

  state.loading = false

  if (res.success) {
    state.totalSize = res.data.total
    state.hasMore = state.list.length + res.data.list.length < res.data.total

    state.list.push(...(res.data.list || []))

    console.log('[SlideFollow] ✅ 加载成功:', {
      total: state.totalSize,
      current: state.list.length,
      hasMore: state.hasMore
    })
  } else {
    console.error('[SlideFollow] ❌ API 调用失败:', res)
    if (state.list.length === 0) {
      state.hasMore = true
    }
  }
}

onMounted(() => {
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

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
}
</style>
