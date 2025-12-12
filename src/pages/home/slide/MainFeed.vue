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
  currentIndex: 0,
  hasMore: true
})

// ========== Methods ==========
async function loadMore() {
  if (baseStore.loading) return
  if (!state.hasMore) {
    console.log('[MainFeed] 已无更多，跳过 loadMore', {
      listLen: state.list.length,
      total: state.totalSize
    })
    return
  }

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
      const totalNum = Number(res.data.total)
      state.totalSize = Number.isFinite(totalNum) ? totalNum : res.data.total

      state.list.push(...res.data.list)

      if (Number.isFinite(totalNum)) {
        const nextLen = state.list.length
        state.hasMore = nextLen < totalNum
      } else {
        state.hasMore = res.data.list.length >= state.pageSize
      }

      console.log('[MainFeed] 加载成功', {
        新增: res.data.list.length,
        总数: state.list.length,
        total: state.totalSize,
        hasMore: state.hasMore
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
watch(
  () => props.active,
  (isActive) => {
    console.log('[MainFeed] active 变化', isActive)
  }
)
</script>

<style scoped lang="less">
.main-feed {
  width: 100%;
  height: 100%;
  background: black;
}
</style>
