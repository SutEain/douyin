<template>
  <div class="video-player" ref="wrapperRef" :data-video-id="item.aweme_id">
    <!-- Loading 加载中 -->
    <Loading v-if="state.loading" style="position: absolute; z-index: 10" />
    <div v-if="state.loading" class="loading-text">加载中...</div>

    <!-- 视频元素 -->
    <video
      ref="videoRef"
      :poster="posterUrl"
      :muted="state.isMuted"
      :style="{ objectFit: videoFit }"
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
      @seeked="handleSeeked"
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
        <div class="progress-bar" :class="progressClass" ref="progressRef">
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
import Hls from 'hls.js'
import { Icon } from '@iconify/vue'
import Loading from '../Loading.vue'
import ItemToolbar from '../slide/ItemToolbar.vue'
import ItemDesc from '../slide/ItemDesc.vue'
import { videoManager } from '@/utils/videoManager'
import { useVideoStore } from '@/stores/video'
import { buildCdnUrl } from '@/utils/media'
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
let hls: Hls | null = null

// 🎯 倍速播放：默认 1.0，仅对当前视频生效
const playbackRate = ref<number>(1)
function setPlaybackRate(rate: number) {
  const safe = [0.5, 1, 1.25, 1.5, 2].includes(rate) ? rate : 1
  playbackRate.value = safe
  try {
    if (videoRef.value) videoRef.value.playbackRate = safe
  } catch (e) {
    console.warn('[VideoPlayer] 设置 playbackRate 失败:', e)
  }
}

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
  playX: 0, // 进度条像素位置
  step: 0, // 每秒对应的像素数
  progressBarRect: null as DOMRect | null,
  start: { x: 0 },
  last: { x: 0, time: 0 }
})

// ========== Computed ==========
const videoUrl = computed(() => {
  // 使用第一个可用的视频源
  const rawUrl = props.item.video?.play_addr?.url_list?.[0] || ''
  return buildCdnUrl(rawUrl)
})

const posterUrl = computed(() => {
  return (
    props.item.video?.dynamic_cover?.url_list?.[0] || props.item.video?.cover?.url_list?.[0] || ''
  )
})

const isPlaying = computed(() => {
  return videoStore.currentPlayingId === props.item.aweme_id
})

const videoFit = computed(() => {
  const { width, height } = props.item.video || {}
  // 如果是横屏视频 (宽 > 高)，使用 contain 以免剪掉太多内容，上下留黑边是正常的
  // 如果是竖屏视频 (高 >= 宽)，使用 cover 以填充全屏，消除左右黑边
  if (width && height && width > height) {
    return 'contain'
  }
  return 'cover'
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
provide(
  'item',
  computed(() => state.localItem)
)
provide(
  'position',
  computed(() => ({
    uniqueId: props.page,
    index: 0 // VideoList 会处理真实的 index
  }))
)
provide('isPlaying', isPlaying)
provide(
  'isMuted',
  computed(() => state.isMuted)
)
provide('playbackRate', playbackRate)
provide('setPlaybackRate', setPlaybackRate)

// ========== Methods ==========
function initVideo() {
  const url = videoUrl.value
  if (!videoRef.value || !url) return

  // 1. 清理旧的 Hls 实例
  if (hls) {
    hls.destroy()
    hls = null
  }

  // 2. 判断是否是 m3u8
  if (url.includes('.m3u8')) {
    if (Hls.isSupported()) {
      hls = new Hls({
        capLevelToPlayerSize: true,
        autoStartLoad: true
      })
      hls.loadSource(url)
      hls.attachMedia(videoRef.value)

      // 🎯 核心修复：深链进入时，等待 HLS 解析完成自动播放
      hls.once(Hls.Events.MANIFEST_PARSED, () => {
        if (props.autoplay) {
          console.log('[VideoPlayer] HLS 就绪，触发自动播放')
          play()
        }
      })

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.error('[VideoPlayer] HLS 网络错误，尝试恢复...')
              hls?.startLoad()
              break
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error('[VideoPlayer] HLS 媒体错误，尝试恢复...')
              hls?.recoverMediaError()
              break
            default:
              console.error('[VideoPlayer] HLS 致命错误，无法恢复')
              hls?.destroy()
              break
          }
        }
      })
    } else if (videoRef.value.canPlayType('application/vnd.apple.mpegurl')) {
      // 原生支持 (Safari)
      videoRef.value.src = url
      if (props.autoplay) play()
    }
  } else {
    // 普通 mp4
    videoRef.value.src = url
    if (props.autoplay) play()
  }
}

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
    state.loading = true // 开始跳转时显示加载
    videoRef.value.currentTime = state.currentTime
    // 立即尝试播放
    videoRef.value.play().catch(() => {})

    // 兜底：如果 2 秒内没触发 seeked，也强制关闭移动状态
    setTimeout(() => {
      state.isMoving = false
    }, 2000)
  }
}

function handleSeeked() {
  console.log('[VideoPlayer] seeked')
  state.isMoving = false
  state.loading = false
}

// ========== 生命周期 ==========
onMounted(() => {
  if (!videoRef.value) return

  initVideo()

  // 注册到视频管理器
  videoManager.register(props.item.aweme_id, videoRef.value, props.page)

  console.log('[VideoPlayer] mounted', {
    videoId: props.item.aweme_id.substring(0, 8),
    page: props.page,
    autoplay: props.autoplay
  })
})

onUnmounted(() => {
  console.log('[VideoPlayer] unmounted', {
    videoId: props.item.aweme_id.substring(0, 8),
    page: props.page
  })

  if (hls) {
    hls.destroy()
    hls = null
  }

  // 从视频管理器注销
  videoManager.unregister(props.item.aweme_id)
})

// 监听 item 变化
watch(
  () => props.item,
  (newItem) => {
    state.localItem = newItem
    // 🎯 切换到新视频时，重置倍速为 1.0（仅对当前视频生效）
    setPlaybackRate(1)
    // 重新初始化视频
    initVideo()
  }
)

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
