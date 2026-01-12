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
  seed: Math.random(), // 🎯 进场生成随机种子
  hasMore: true,
  loading: false // 🎯 恢复为 false，配合模板逻辑处理闪现
})

async function loadMore() {
  if (state.loading) return

  // 🎯 检查是否还有更多数据
  if (!state.hasMore) {
    console.log('[SlideAdult] 已无更多数据，跳过加载')
    return
  }

  // 1. 🎯 核心重构：允许并行加载
  const hasTGInitData = !!(window as any).Telegram?.WebApp?.initData

  if (!store.isAppReady && !hasTGInitData) {
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
    // 🎯 修复：使用已加载的数量作为 offset，而不是 pageNo
    // 后端使用加权随机算法 + Seed，每次请求会返回不同的随机内容
    // 后端已经通过 exclude_ids 排除了已观看的视频，所以我们可以使用已加载的数量作为 offset
    const res = await adultVideoFeed({
      start: state.list.length, // 🎯 使用已加载的数量作为 offset
      pageSize: state.pageSize,
      seed: state.seed // 🎯 传递种子，确保随机性
    })

    if (res.success) {
      const newList = res.data.list || []

      // 💡 前端去重（防止后端返回重复数据）
      const existingIds = new Set(state.list.map((v: any) => v.aweme_id || v.id))
      const uniqueNewList = newList.filter((v: any) => !existingIds.has(v.aweme_id || v.id))

      if (uniqueNewList.length > 0) {
        state.list.push(...uniqueNewList)
        // 🎯 根据返回的数据量判断是否还有更多
        state.hasMore = newList.length >= state.pageSize
        console.log('[SlideAdult] 加载成功', {
          新增: uniqueNewList.length,
          总数: state.list.length,
          hasMore: state.hasMore
        })
      } else if (newList.length > 0) {
        // 🎯 如果全是重复，说明后端可能返回了相同的数据，尝试增加 offset
        console.log('[SlideAdult] 返回的数据全是重复，尝试增加 offset')
        state.loading = false
        // 🎯 增加延迟，避免频繁请求
        setTimeout(() => loadMore(), 500)
        return
      } else {
        // 🎯 后端返回空列表，说明没有更多数据了
        state.hasMore = false
        console.log('[SlideAdult] 没有更多数据了')
      }
    } else {
      console.warn('[SlideAdult] 加载失败:', res)
      // 🎯 如果第一次加载就失败，允许重试
      if (state.list.length === 0) {
        state.hasMore = true
      } else {
        // 🎯 已有数据但加载失败，暂时标记为没有更多，避免无限重试
        state.hasMore = false
      }
    }
  } catch (e) {
    console.error('[SlideAdult] ❌ 加载异常:', e)
    // 🎯 异常情况下，如果已有数据，标记为没有更多；如果没有数据，允许重试
    if (state.list.length === 0) {
      state.hasMore = true
    } else {
      state.hasMore = false
    }
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
