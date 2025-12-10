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
        <p>暂无更多视频</p>
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
  hasMore: true // 🎯 新增
})

async function loadMore() {
  console.log('[Slide4] loadMore 被调用', {
    listLength: state.list.length,
    totalSize: state.totalSize,
    loading: store.loading,
    hasMore: state.hasMore
  })

  if (store.loading) {
    console.log('[Slide4] 正在加载中，跳过')
    return
  }
  if (!state.hasMore) {
    console.log('[Slide4] 没有更多数据，跳过')
    return
  }

  store.loading = true

  // 🎯 首次加载时，如果有深链接视频ID，传递给后端API
  const requestParams: any = {
    start: state.list.length,
    pageSize: state.pageSize
  }

  // 🎯 深链接由后端自动处理，前端无需传递参数
  console.log('[Slide4] 开始请求 API（深链接由后端自动处理）', requestParams)

  const res = await recommendedVideo(requestParams)

  console.log('[Slide4] API 响应', {
    success: res.success,
    total: res.data?.total,
    listLength: res.data?.list?.length,
    hasMore: res.data?.hasMore
  })

  store.loading = false

  if (res.success) {
    state.totalSize = res.data.total

    // 🎯 更新 hasMore 状态
    // 如果后端返回了 hasMore 则使用它，否则降级为判断返回数量是否足够
    state.hasMore = res.data.hasMore ?? res.data.list.length >= state.pageSize

    // 🎯 前端去重（过滤掉列表中已存在的视频）
    const existingIds = new Set(state.list.map((v) => v.aweme_id || v.id))
    const uniqueNewList = res.data.list.filter((v: any) => !existingIds.has(v.aweme_id || v.id))

    if (uniqueNewList.length > 0) {
      state.list.push(...uniqueNewList)
      console.log('[Slide4] ✅ 数据加载成功 (已去重)', {
        原始数量: res.data.list.length,
        有效新增: uniqueNewList.length,
        totalSize: state.totalSize,
        currentLength: state.list.length,
        hasMore: state.hasMore
      })
    } else {
      console.log('[Slide4] ⚠️ 获取的数据全部重复，未添加到列表')
      // 如果数据重复且后端说还有更多，可能需要再试一次？
      // 暂时不重试，避免死循环，等待用户再次下拉
    }
  } else {
    console.error('[Slide4] ❌ API 调用失败', res)
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

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
}
</style>
