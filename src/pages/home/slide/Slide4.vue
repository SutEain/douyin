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
        <p>暂无更多内容</p>
        <div class="retry-btn" @click="loadMore">点击重试</div>
      </div>
    </div>
  </SlideItem>
</template>

<script setup lang="ts">
import { onMounted, reactive, watch } from 'vue'
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
  pageSize: 10,
  hasMore: true
})

async function loadMore() {
  if (store.loading) return

  // 1. 🎯 核心重构：必须等待应用 Ready
  if (!store.isAppReady) {
    console.log('[Slide4] 等待 App Ready...')
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

  store.loading = true

  try {
    // 💡 首页推荐不需要传 pageNo，后端会自动根据历史推荐
    const res = await recommendedVideo({
      pageSize: state.pageSize
    })

    if (res.success) {
      const newList = res.data.list || []

      // 💡 前端去重
      const existingIds = new Set(state.list.map((v) => v.aweme_id || v.id))
      const uniqueNewList = newList.filter((v: any) => !existingIds.has(v.aweme_id || v.id))

      if (uniqueNewList.length > 0) {
        state.list.push(...uniqueNewList)
        state.hasMore = true
        console.log(`[Slide4] 成功加载 ${uniqueNewList.length} 条新内容`)
      } else if (newList.length > 0) {
        // 💡 如果全是重复，递归再取一次（后端会因为已观看排除逻辑最终给出新内容）
        console.log('[Slide4] 全是重复，尝试获取下一批...')
        store.loading = false
        return loadMore()
      } else {
        state.hasMore = false
      }
    }
  } catch (e) {
    console.error('[Slide4] 加载异常:', e)
  } finally {
    store.loading = false
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
