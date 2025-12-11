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

      <!-- 空状态提示 -->
      <div v-else class="empty-state">
        <p>暂无更多成人内容</p>
      </div>
    </div>
  </SlideItem>
</template>

<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import SlideItem from '@/components/slide/SlideItem.vue'
import VideoList from '@/components/video/VideoList.vue'
import { adultVideoFeed } from '@/api/videos'
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
  hasMore: true
})

async function loadMore() {
  console.log('[SlideAdult] loadMore 被调用', {
    listLength: state.list.length,
    totalSize: state.totalSize,
    loading: store.loading,
    hasMore: state.hasMore
  })

  if (store.loading) {
    console.log('[SlideAdult] 正在加载中，跳过')
    return
  }
  if (!state.hasMore) {
    console.log('[SlideAdult] 没有更多数据，跳过')
    return
  }

  store.loading = true

  const requestParams: any = {
    start: state.list.length,
    pageSize: state.pageSize
  }

  console.log('[SlideAdult] 开始请求 API', requestParams)

  const res = await adultVideoFeed(requestParams)

  console.log('[SlideAdult] API 响应', {
    success: res.success,
    total: res.data?.total,
    listLength: res.data?.list?.length
  })

  store.loading = false

  if (res.success) {
    state.totalSize = res.data.total
    state.hasMore = res.data.list.length >= state.pageSize

    const existingIds = new Set(state.list.map((v) => v.aweme_id || v.id))
    const uniqueNewList = res.data.list.filter((v: any) => !existingIds.has(v.aweme_id || v.id))

    if (uniqueNewList.length > 0) {
      state.list.push(...uniqueNewList)
      console.log('[SlideAdult] ✅ 数据加载成功 (已去重)', {
        原始数量: res.data.list.length,
        有效新增: uniqueNewList.length,
        totalSize: state.totalSize,
        currentLength: state.list.length,
        hasMore: state.hasMore
      })
    } else {
      console.log('[SlideAdult] ⚠️ 获取的数据全部重复，未添加到列表')
    }
  } else {
    console.error('[SlideAdult] ❌ API 调用失败', res)
  }
}

onMounted(() => {
  console.log('[SlideAdult] onMounted - 开始首次加载')
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
