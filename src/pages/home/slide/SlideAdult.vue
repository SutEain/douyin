<template>
  <SlideItem class="slide-item-class">
    <div class="video-container" style="background: black">
      <!-- Loading 状态 -->
      <div
        v-if="store.loading && state.list.length === 0 && !state.quotaExceeded"
        class="loading-state"
      >
        <div class="loading-spinner"></div>
        <p>加载中...</p>
      </div>

      <!-- 视频列表（配额用完时也使用 VideoList 的 no-more-page 样式） -->
      <VideoList
        v-else-if="state.list.length > 0 || state.quotaExceeded"
        :items="state.list"
        page="home"
        :initial-index="state.quotaExceeded && state.list.length === 0 ? state.list.length : 0"
        :autoplay="props.active && !state.quotaExceeded"
        :has-more="state.hasMore && !state.quotaExceeded"
        :no-more-subtext="adultRuleText"
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
  hasMore: true,
  quotaExceeded: false
})

const adultRuleText =
  '默认每日可观看 10 条成人内容。\n' +
  '使用专属邀请链接邀请新用户注册，\n可解锁无限成人内容：\n\n' +
  '• 成功邀请 1 人 → 解锁 24 小时无限刷\n' +
  '• 成功邀请 2 人 → 解锁 3 天无限刷\n' +
  '• 累计邀请 3 人 → 永久解锁无限刷'

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

  if (res.data?.reason === 'quota_exceeded' || res.reason === 'quota_exceeded') {
    state.quotaExceeded = true
    state.hasMore = false
    store.loading = false
    console.log('[SlideAdult] 🚫 配额已用完')
    return
  } else {
    state.quotaExceeded = false
  }

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
