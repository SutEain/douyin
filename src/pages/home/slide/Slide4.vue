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
        <p>暂无更多内容</p>
        <div class="retry-btn" @click="loadMore">点击重试</div>
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
  page: 0, // 🎯 增加页码计数，用于辅助后端逻辑（如跳过深链接首位）
  pageSize: 10,
  hasMore: true,
  loading: false // 🎯 恢复为 false，配合模板逻辑处理闪现
})

async function loadMore() {
  if (state.loading) return

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

  state.loading = true

  try {
    // 💡 即使后端是随机流，传一个变化的 start 也能帮助后端区分请求阶段
    const res = await recommendedVideo({
      start: state.page * state.pageSize,
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
        console.log(`[Slide4] 成功加载 ${uniqueNewList.length} 条新内容，总计 ${state.list.length}`)

        // 💡 强力补货策略：如果列表里的有效视频太少（不足5条），无法支撑流畅滑动
        // 则不论后端返回了多少，都强制再请求一次，直到攒够 5 条或后端彻底没数据
        if (state.list.length < 5 && newList.length > 0) {
          console.log(`[Slide4] 内容不足 ${state.list.length}/5，自动补货...`)
          state.loading = false
          // 🎯 延迟一小会儿再补货，避开 API 频率限制锁
          setTimeout(() => loadMore(), 300)
          return
        }
      } else if (newList.length > 0) {
        // 💡 如果全是重复，自动穿透到下一页
        state.page++
        console.log('[Slide4] 全是重复，尝试获取下一批...')
        state.loading = false
        setTimeout(() => loadMore(), 300)
        return
      } else {
        state.hasMore = false
      }
    } else {
      console.warn('[Slide4] 加载失败:', res.message)
      // 如果第一次加载就失败，标记 hasMore 为 true 允许重试
      if (state.list.length === 0) {
        state.hasMore = true
      }
    }
  } catch (e) {
    console.error('[Slide4] 加载异常:', e)
  } finally {
    state.loading = false
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
