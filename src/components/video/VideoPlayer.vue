<template>
  <div 
    class="video-player" 
    ref="wrapperRef"
    :data-video-id="item.aweme_id"
  >
    <!-- Loading 加载中 -->
    <Loading v-if="state.loading" style="position: absolute; z-index: 10;" />
    <div v-if="state.loading" class="loading-text">加载中...</div>

    <!-- 视频元素 -->
    <video
      ref="videoRef"
      :src="videoUrl"
      :poster="posterUrl"
      :muted="state.isMuted"
      preload="auto"
      loop
      playsinline
      webkit-playsinline
      x5-playsinline
      x5-video-player-type="h5-page"
      @click="handleClick"
      @play="handlePlay"
      @pause="handlePause"
      @timeupdate="handleTimeUpdate"
      @waiting="handleWaiting"
      @canplay="handleCanPlay"
      @error="handleError"
    />
    <Icon icon="fluent:play-28-filled" class="pause-icon" v-if="!isPlaying" />
    
    <!-- 视频信息和工具栏 -->
    <div class="video-content" @click="handleClick">
      <!-- 拖动时隐藏其他内容 -->
      <div :style="{ opacity: state.isMoving ? 0 : 1 }" class="normal">
        <template v-if="!state.commentVisible">
          <ItemToolbar v-model:item="state.localItem" />
          <ItemDesc v-model:item="state.localItem" />
        </template>
      </div>

      <!-- 进度条触摸热区容器（大面积，方便拖动） -->
      <div 
        class="progress-container"
        @pointerdown.stop.prevent="handleProgressStart"
        @pointermove.stop.prevent="handleProgressMove"
        @pointerup.stop.prevent="handleProgressEnd"
      >
        <div
          class="progress-bar"
          :class="progressClass"
          ref="progressRef"
        >
          <div class="time" v-if="state.isMoving">
            <span class="currentTime">{{ formatTime(state.currentTime) }}</span>
            <span class="duration"> / {{ formatTime(state.duration) }}</span>
          </div>
          <template v-if="state.duration > 15 || state.isMoving || !isPlaying">
            <div class="bg"></div>
            <div class="progress-fill" :style="{ width: state.playX + 'px' }"></div>
            <div class="point" :style="{ left: state.playX + 'px' }"></div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted, watch, provide } from 'vue'
import { Icon } from '@iconify/vue'
import Loading from '../Loading.vue'
import ItemToolbar from '../slide/ItemToolbar.vue'
import ItemDesc from '../slide/ItemDesc.vue'
import { videoManager } from '@/utils/videoManager'
import { useVideoStore } from '@/stores/video'
import type { VideoItem } from '@/types'

// ========== Props ==========
interface Props {
  item: VideoItem
  page: 'home' | 'detail' | 'me'
  autoplay?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  autoplay: false
})

// ========== Store ==========
const videoStore = useVideoStore()

// ========== Refs ==========
const videoRef = ref<HTMLVideoElement>()
const wrapperRef = ref<HTMLDivElement>()
const progressRef = ref<HTMLDivElement>()

// ========== State ==========
const initialMuted = typeof window.isMuted === 'boolean' ? window.isMuted : true
if (window.isMuted === undefined) {
  window.isMuted = initialMuted
}

const state = reactive({
  loading: false,
  isMuted: initialMuted,
  duration: 0,
  currentTime: 0,
  isMoving: false,
  commentVisible: false,
  localItem: props.item,
  errorRetryCount: 0,
  // 进度条相关
  playX: 0,  // 进度条像素位置
  step: 0,   // 每秒对应的像素数
  progressBarRect: null as DOMRect | null,
  start: { x: 0 },
  last: { x: 0, time: 0 }
})

// ========== Computed ==========
const videoUrl = computed(() => {
  // 使用第一个可用的视频源
  return props.item.video?.play_addr?.url_list?.[0] || ''
})

const posterUrl = computed(() => {
  return props.item.video?.dynamic_cover?.url_list?.[0] || 
         props.item.video?.cover?.url_list?.[0] || 
         ''
})

const isPlaying = computed(() => {
  return videoStore.currentPlayingId === props.item.aweme_id
})

const progressClass = computed(() => {
  if (state.isMoving) {
    return 'move'
  } else {
    return isPlaying.value ? '' : 'stop'
  }
})

// ========== Provide 数据给子组件 ==========
// ItemDesc 和 ItemToolbar 需要通过 inject 获取这些值
provide('item', computed(() => state.localItem))
provide('position', computed(() => ({
  uniqueId: props.page,
  index: 0 // VideoList 会处理真实的 index
})))
provide('isPlaying', isPlaying)
provide('isMuted', computed(() => state.isMuted))

// ========== Methods ==========
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

async function play() {
  if (!videoRef.value) return
  
  state.loading = true
  
  try {
    await videoManager.play(props.item.aweme_id, props.page)
    videoStore.setCurrentPlaying(props.item.aweme_id, props.page)
    videoStore.setCurrentVideo(props.item)
  } catch (error) {
    console.error('[VideoPlayer] 播放失败', error)
    state.loading = false
  }
}

function pause() {
  if (!videoRef.value) return
  
  videoManager.pause(props.item.aweme_id)
  if (videoStore.currentPlayingId === props.item.aweme_id) {
    videoStore.clearPlaying()
  }
}

function handleClick() {
  if (isPlaying.value) {
    pause()
  } else {
    play()
  }
}

function handlePlay() {
  console.log('[AutoPlayDebug] handlePlay', {
    id: props.item.aweme_id?.substring(0, 8),
    page: props.page,
    muted: videoRef.value?.muted,
    globalMuted: (window as any)?.isMuted,
    readyState: videoRef.value?.readyState,
    paused: videoRef.value?.paused
  })
}

function handlePause() {
  console.log('[AutoPlayDebug] handlePause', {
    id: props.item.aweme_id?.substring(0, 8),
    page: props.page,
    muted: videoRef.value?.muted,
    globalMuted: (window as any)?.isMuted,
    readyState: videoRef.value?.readyState,
    paused: videoRef.value?.paused
  })
  state.loading = false
}

function handleTimeUpdate() {
  if (!videoRef.value) return
  
  state.currentTime = Math.ceil(videoRef.value.currentTime)
  state.playX = (state.currentTime - 1) * state.step
  
  // 视频开始播放后隐藏 loading
  if (state.loading && state.currentTime > 0.1) {
    state.loading = false
  }
}

function handleWaiting() {
  if (!videoRef.value?.paused) {
    state.loading = true
  }
}

function handleCanPlay() {
  // 视频可以播放
  if (!videoRef.value) return
  state.duration = videoRef.value.duration
  
  // 计算进度条参数
  if (progressRef.value) {
    state.progressBarRect = progressRef.value.getBoundingClientRect()
    state.step = state.progressBarRect.width / Math.floor(state.duration)
  }
}

function handleError(e: Event) {
  console.error('[VideoPlayer] 视频加载错误', {
    videoId: props.item.aweme_id.substring(0, 8),
    error: e,
    retryCount: state.errorRetryCount
  })
  
  state.loading = false
  
  // 重试一次
  if (state.errorRetryCount < 1 && videoRef.value) {
    state.errorRetryCount++
    setTimeout(() => {
      videoRef.value?.load()
    }, 1000)
  }
}

// ========== 进度条拖动 ==========
let isDragging = false

function handleProgressStart(e: PointerEvent) {
  if (!videoRef.value) return
  
  e.stopPropagation()
  isDragging = true
  state.start.x = e.pageX
  state.last.x = state.playX
  state.last.time = state.currentTime
}

function handleProgressMove(e: PointerEvent) {
  if (!isDragging) return
  
  e.stopPropagation()
  state.isMoving = true
  
  // 暂停播放
  if (videoRef.value && !videoRef.value.paused) {
    videoRef.value.pause()
  }
  
  // 计算拖动距离
  const dx = e.pageX - state.start.x
  state.playX = state.last.x + dx
  state.currentTime = state.last.time + Math.ceil(dx / state.step)
  
  // 限制范围
  if (state.currentTime <= 0) state.currentTime = 0
  if (state.currentTime >= state.duration) state.currentTime = state.duration
}

function handleProgressEnd(e: PointerEvent) {
  if (!isDragging) return
  
  e.stopPropagation()
  isDragging = false
  
  // 设置视频时间
  if (videoRef.value) {
    videoRef.value.currentTime = state.currentTime
    // 恢复播放
    setTimeout(() => {
      state.isMoving = false
      if (videoRef.value) {
        videoRef.value.play().catch(() => {})
      }
    }, 1000)
  }
}

// ========== 生命周期 ==========
onMounted(() => {
  if (!videoRef.value) return
  
  // 注册到视频管理器
  videoManager.register(props.item.aweme_id, videoRef.value, props.page)
  
  console.log('[VideoPlayer] mounted', {
    videoId: props.item.aweme_id.substring(0, 8),
    page: props.page,
    autoplay: props.autoplay
  })
  
  // 如果设置了自动播放
  if (props.autoplay) {
    setTimeout(() => play(), 100)
  }
})

onUnmounted(() => {
  console.log('[VideoPlayer] unmounted', {
    videoId: props.item.aweme_id.substring(0, 8),
    page: props.page
  })
  
  // 从视频管理器注销
  videoManager.unregister(props.item.aweme_id)
})

// 监听 item 变化
watch(() => props.item, (newItem) => {
  state.localItem = newItem
})

// 监听全局静音状态
watch(
  () => videoStore.isMuted,
  (muted) => {
  state.isMuted = muted
  if (videoRef.value) {
    videoRef.value.muted = muted
  }
  },
  { immediate: true }
)
</script>

<style scoped lang="less">
.video-player {
  position: relative;
  width: 100%;
  height: 100%;
  background: black;
  overflow: hidden;
  
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  
  .loading-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: white;
    font-size: 14px;
    margin-top: 40px;
    z-index: 11;
  }
  
  .video-content {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1;
    pointer-events: none;
    
    > * {
      pointer-events: auto;
    }
    
    .normal {
      transition: opacity 0.3s;
    }
  }
  
  // 进度条触摸热区容器（大面积，方便拖动）
  .progress-container {
    z-index: 5;
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 40rem;
    pointer-events: auto;
    touch-action: none;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .progress-bar {
    position: relative;
    bottom: 0;
    height: 10rem;
    width: 90%;
    display: flex;
    align-items: flex-end;
    margin-bottom: 2rem;

    .time {
      position: absolute;
      z-index: 9;
      font-size: 24px;
      bottom: 50px;
      left: 0;
      right: 0;
      color: white;
      text-align: center;

      .duration {
        color: darkgray;
      }
    }

    .bg {
      transition: height 0.3s;
      position: absolute;
      left: 0;
      bottom: 0;
      width: 100%;
      height: 2rem;
      background: #4f4f4f;
      border-radius: 1rem;
    }

    .progress-fill {
      transition: height 0.3s;
      position: absolute;
      left: 0;
      bottom: 0;
      height: 2rem;
      border-radius: 1rem 0 0 1rem;
      background: #777777;
      z-index: 1;
    }

    .point {
      transition: all 0.2s;
      position: absolute;
      bottom: 0;
      width: 4rem;
      height: 4rem;
      border-radius: 50%;
      background: gray;
      z-index: 2;
      transform: translate(-2rem, -1rem);
    }
  }
  
  // 拖动时的样式
  .move {
    .bg {
      height: 10rem;
      background: var(--active-main-bg);
    }

    .progress-fill {
      height: 10rem;
      background: var(--second-text-color);
    }

    .point {
      width: 12rem;
      height: 12rem;
    }
  }
  
  // 暂停时的样式
  .stop {
    .bg {
      height: 4rem;
    }

    .progress-fill {
      height: 4rem;
      background: white;
    }

    .point {
      width: 6rem;
      height: 6rem;
      background: white;
    }
  }

  // 暂停图标
  .pause-icon {
    // 强制覆盖全局 .pause-icon 样式，保证始终居中
    margin: 0 !important;
    right: auto !important;
    bottom: auto !important;
    animation: none !important;
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    font-size: 80rem;
    color: rgba(255, 255, 255, 0.5);
    z-index: 12;
    pointer-events: none;
    filter: drop-shadow(0 0 8px rgba(0, 0, 0, 0.3));
  }
}
</style>

