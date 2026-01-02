<template>
  <SlideItem class="slide-item-class">
    <div class="video-container" style="background: black">
      <!-- Loading 状态 -->
      <div v-if="state.loading && state.list.length === 0" class="loading-state">
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
  page: 0,
  pageSize: 10,
  hasMore: true,
  loading: false // 🎯 改为局部 loading，避免多个 Tab 竞争 store.loading
})

async function loadMore() {
  if (state.loading) return

  // 1. 🎯 核心重构：等待 App Ready
  if (!store.isAppReady) {
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
    // 💡 核心策略：如果已登录，后端会排除已观看，此时必须永远传 start: 0 才能不跳过新内容
    // 💡 如果未登录，后端是简单时间倒序，此时需要正常分页
    const res = await adultVideoFeed({
      start: store.userinfo.uid ? 0 : state.page * state.pageSize,
      pageSize: state.pageSize
    })

    if (res.success) {
      const newList = res.data.list || []
      const existingIds = new Set(state.list.map((v: any) => v.aweme_id || v.id))
      const uniqueNewList = newList.filter((v: any) => !existingIds.has(v.aweme_id || v.id))

      if (uniqueNewList.length > 0) {
        state.list.push(...uniqueNewList)
        state.page++
        state.hasMore = true
      } else if (newList.length > 0) {
        // 全是重复，尝试下一页
        state.page++
        state.loading = false
        setTimeout(() => loadMore(), 300)
        return
      } else {
        state.hasMore = false
      }
    } else {
      console.warn('[SlideAdult] 加载失败:', res.message)
      if (state.list.length === 0) {
        state.hasMore = true
      }
    }
  } catch (e) {
    console.error('[SlideAdult] 加载异常:', e)
  } finally {
    state.loading = false
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
