<template>
  <div class="main-feed">
    <VideoList
      v-if="state.list.length > 0"
      :items="state.list"
      page="home"
      :initial-index="0"
      :autoplay="props.active"
      @load-more="loadMore"
      @update:index="handleIndexChange"
    />
  </div>
</template>

<script setup lang="ts">
import { reactive, watch, onMounted } from 'vue'
import VideoList from '@/components/video/VideoList.vue'
import { recommendedVideo } from '@/api/videos'
import { useBaseStore } from '@/store/pinia'
import { useVideoStore } from '@/stores/video'
import type { VideoItem } from '@/types'

const props = defineProps({
  active: {
    type: Boolean,
    default: false
  }
})

const baseStore = useBaseStore()
const videoStore = useVideoStore()

const state = reactive({
  list: [] as VideoItem[],
  totalSize: 0,
  pageSize: 10,
  currentIndex: 0
})

// ========== Methods ==========
async function loadMore() {
  if (baseStore.loading) return
  if (state.totalSize > 0 && state.list.length >= state.totalSize) return
  
  console.log('[MainFeed] 加载更多视频', {
    current: state.list.length,
    total: state.totalSize
  })
  
  baseStore.loading = true
  
  try {
    const res = await recommendedVideo({
      start: state.list.length,
      pageSize: state.pageSize
    })
    
    if (res.success) {
      state.totalSize = res.data.total
      state.list.push(...res.data.list)
      console.log('[MainFeed] 加载成功', {
        新增: res.data.list.length,
        总数: state.list.length
      })
    }
  } catch (error) {
    console.error('[MainFeed] 加载失败', error)
  } finally {
    baseStore.loading = false
  }
}

function handleIndexChange(index: number) {
  state.currentIndex = index
  const currentItem = state.list[index]
  if (currentItem) {
    videoStore.setCurrentVideo(currentItem, index)
  }
}

// ========== 生命周期 ==========
onMounted(() => {
  console.log('[MainFeed] mounted')
  // 初始加载
  if (state.list.length === 0) {
    loadMore()
  }
})

// 监听 active 变化
watch(() => props.active, (isActive) => {
  console.log('[MainFeed] active 变化', isActive)
})
</script>

<style scoped lang="less">
.main-feed {
  width: 100%;
  height: 100%;
  background: black;
}
</style>

