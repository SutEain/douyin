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

      <!-- 次数用完提示 -->
      <div v-else-if="state.quotaExceeded" class="empty-state">
        <p>今日次数已用完</p>
        <p style="font-size: 13px; margin-top: 10px; opacity: 0.7">明日更新或邀请好友</p>
      </div>

      <!-- 空状态提示 -->
      <div v-else class="empty-state">
        <p>暂无更多视频</p>
        <div class="retry-btn" @click="loadMore">点击重试</div>
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
import { _showNoticeDialog } from '@/utils'

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

  // ✅ 如果列表为空且手动重试，强制重置 hasMore
  if (state.list.length === 0) {
    state.hasMore = true
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
    hasMore: res.data?.hasMore,
    reason: res.data?.reason
  })

  store.loading = false

  if (res.success) {
    // 🎯 检查配额限制
    if (res.data.reason === 'quota_exceeded') {
      console.log('[Slide4] 🚫 配额已用完')
      state.hasMore = false
      state.quotaExceeded = true

      _showNoticeDialog(
        '今日次数已用完',
        '您今天的免费观看次数已用完，请明天再来，或邀请好友获取更多次数。',
        '',
        () => {},
        '知道了'
      )
      return
    }

    const totalNum = Number(res.data.total)
    state.totalSize = Number.isFinite(totalNum) ? totalNum : res.data.total

    // 🎯 更新 hasMore 状态：优先用 total；total 不可用再用 hasMore；最后用条数判断
    if (Number.isFinite(totalNum)) {
      const nextLen = state.list.length + res.data.list.length
      state.hasMore = nextLen < totalNum
    } else if (typeof res.data.hasMore === 'boolean') {
      state.hasMore = res.data.hasMore
    } else {
      state.hasMore = res.data.list.length >= state.pageSize
    }

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
