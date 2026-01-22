<template>
  <div
    class="album-swiper"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @mouseleave="onMouseUp"
  >
    <!-- 媒体容器 -->
    <div class="swiper-container" :style="swiperStyle" :class="{ transitioning: isTransitioning }">
      <div v-for="(media, index) in images" :key="index" class="swiper-slide">
        <!-- 🎬 视频类型 -->
        <template v-if="media.type === 'video'">
          <video
            :ref="setVideoRef(index)"
            :src="getMediaUrl(media)"
            class="slide-video"
            preload="auto"
            loop
            autoplay
            muted
            playsinline
            webkit-playsinline
            x5-playsinline
            x5-video-player-type="h5-page"
            :poster="getPosterUrl(media)"
            @loadstart="videoLoadingStates[index] = true"
            @canplay="onVideoCanplay(index)"
            @playing="onVideoPlaying(index)"
            @pause="onVideoPause(index)"
            @timeupdate="onVideoTimeUpdate(index)"
            @seeked="onVideoSeeked(index)"
            @error="onVideoError(index)"
            @click.stop="toggleVideoPlay(index)"
          />

          <!-- 加载中 -->
          <div v-if="videoLoadingStates[index]" class="video-loading">
            <Icon icon="eos-icons:loading" class="loading-icon" />
          </div>
          <!-- 暂停图标 -->
          <div
            v-if="
              index === currentIndex && !videoPlayingStates[index] && !videoLoadingStates[index]
            "
            class="pause-layer"
            @click.stop="toggleVideoPlay(index)"
          >
            <Icon icon="fluent:play-28-filled" class="pause-icon" />
          </div>
          <!-- 错误提示 -->
          <div v-if="videoErrorStates[index]" class="video-error" @click.stop="retryVideo(index)">
            <Icon icon="material-symbols:refresh" class="error-icon" />
            <span>播放失败，点击重试</span>
          </div>
        </template>

        <!-- 🖼️ 图片类型 -->
        <img
          v-else
          :src="getMediaUrl(media)"
          class="slide-image"
          @load="onImageLoad(index)"
          @error="onImageError(index)"
          draggable="false"
        />
      </div>
    </div>

    <!-- 左上角类型标识 + 页码（毛玻璃效果） -->
    <div class="content-type-badge">
      <span class="badge-text"
        >{{ getBadgeText() }} {{ currentIndex + 1 }}/{{ images.length }}</span
      >
    </div>

    <!-- 点击查看高清提示（仅对图片显示） -->
    <div
      v-if="images[currentIndex]?.type !== 'video'"
      class="hd-tip"
      @click.stop="openPreview(currentIndex)"
    >
      <Icon icon="mdi:magnify-plus" />
      <span>查看高清</span>
    </div>

    <!-- 底部指示器 -->
    <div class="swiper-pagination" v-if="images.length > 1">
      <div
        v-for="(_, index) in images"
        :key="index"
        class="pagination-dot"
        :class="{ active: index === currentIndex }"
        @click.stop="goToSlide(index)"
      ></div>
    </div>

    <!-- 高清预览弹窗 -->
    <ImagePreview v-model:visible="showPreview" :images="images" :initial-index="previewIndex" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, inject, onMounted, onUnmounted, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { buildCdnUrl } from '@/utils/media'
import ImagePreview from './ImagePreview.vue'

interface MediaItem {
  type?: 'image' | 'video'
  file_id: string
  url?: string
  play_url?: string
  cover_url?: string
  width?: number
  height?: number
  order?: number
}

interface Props {
  images: MediaItem[]
  isCurrent?: boolean // 🎯 是否是当前显示的 slot
  contentType?: 'video' | 'image' | 'album' | 'collection' // 🎯 父级内容类型
}

const props = withDefaults(defineProps<Props>(), {
  isCurrent: true,
  contentType: 'album'
})
const emit = defineEmits<{
  reachedLast: [] // 🎯 滑到最后一张时触发
}>()

const currentIndex = ref(0)
const showPreview = ref(false)
const previewIndex = ref(0)

// 🎯 注入全局播放/静音状态
const isMuted = inject('isMuted', ref(true))
const isParentPlaying = inject('isPlaying', ref(true))

// 🎯 视频 DOM 引用和播放状态
const videoRefs = new Map<number, HTMLVideoElement>()
const videoPlayingStates = reactive<Record<number, boolean>>({})
const videoLoadingStates = reactive<Record<number, boolean>>({})
const videoErrorStates = reactive<Record<number, boolean>>({})

function setVideoRef(index: number) {
  return (el: any) => {
    if (el) {
      videoRefs.set(index, el)
    } else {
      videoRefs.delete(index)
    }
  }
}

// 🎯 建立父级进度条同步
const albumSync = inject<any>('albumSync', null)

if (albumSync) {
  albumSync.onSeek = (time: number) => {
    console.log('[AlbumSwiper] onSeek called:', {
      time,
      currentIndex: currentIndex.value,
      isCurrent: props.isCurrent
    })
    const video = videoRefs.get(currentIndex.value)
    const currentMedia = props.images[currentIndex.value]

    // 🎯 只有当前激活的 slot 且是视频类型才处理
    if (!props.isCurrent) {
      console.log('[AlbumSwiper] onSeek ignored: not current slot')
      return
    }

    if (!video) {
      console.warn('[AlbumSwiper] onSeek failed: video not found', {
        currentIndex: currentIndex.value,
        mediaType: currentMedia?.type
      })
      return
    }

    if (currentMedia?.type !== 'video') {
      console.log('[AlbumSwiper] onSeek ignored: current media is not video', {
        mediaType: currentMedia?.type
      })
      return
    }

    console.log('[AlbumSwiper] Setting video currentTime:', {
      time,
      wasPlaying: videoPlayingStates[currentIndex.value]
    })
    video.currentTime = time

    // 🎯 如果父级在播放状态，则继续播放（不管之前的播放状态）
    if (isParentPlaying.value) {
      video.play().catch((err) => {
        console.error('[AlbumSwiper] onSeek play failed:', err)
      })
    }
  }

  // 🎯 暂停合辑视频（用于拖动进度条时）
  albumSync.onPause = () => {
    console.log('[AlbumSwiper] onPause called:', {
      currentIndex: currentIndex.value,
      isCurrent: props.isCurrent
    })
    if (!props.isCurrent) return

    const video = videoRefs.get(currentIndex.value)
    const currentMedia = props.images[currentIndex.value]

    if (video && currentMedia?.type === 'video') {
      video.pause()
      videoPlayingStates[currentIndex.value] = false
    }
  }
}

// 🎯 视频时间更新
function onVideoTimeUpdate(index: number) {
  const video = videoRefs.get(index)
  if (!video) return

  // 同步给父级进度条
  if (index === currentIndex.value && albumSync && props.isCurrent) {
    // 🎯 增加 isCurrent 判断，只有当前激活的 slot 才能同步进度，防止后台 slot 干扰
    albumSync.currentTime = video.currentTime
    albumSync.duration = video.duration
  }

  if (videoLoadingStates[index] && video.currentTime > 0.1) {
    videoLoadingStates[index] = false
  }
}

// 🎯 视频跳转完成
function onVideoSeeked(index: number) {
  videoLoadingStates[index] = false
}

// 🎯 重新尝试播放
function retryVideo(index: number) {
  const video = videoRefs.get(index)
  if (!video) return
  videoErrorStates[index] = false
  videoLoadingStates[index] = true
  const src = video.src
  video.src = ''
  video.load()
  video.src = src
  video.load()
  playVideo(index)
}

// 🎯 打开高清预览
function openPreview(index: number) {
  // 过滤掉视频，只预览图片
  const onlyImages = props.images.filter((m) => m.type !== 'video')
  const currentMedia = props.images[index]
  if (currentMedia?.type === 'video') return // 视频不预览

  const imgIndex = onlyImages.findIndex((img) => img.file_id === currentMedia.file_id)
  if (imgIndex !== -1) {
    previewIndex.value = imgIndex
    showPreview.value = true
  }
}

// 🎯 切换视频播放/暂停
function toggleVideoPlay(index: number) {
  const video = videoRefs.get(index)
  if (!video) return

  if (video.paused) {
    playVideo(index)
  } else {
    video.pause()
    videoPlayingStates[index] = false
  }
}

async function playVideo(index: number) {
  const video = videoRefs.get(index)
  if (!video) return

  try {
    // 暂停其他所有视频
    videoRefs.forEach((v, idx) => {
      if (idx !== index) {
        v.pause()
        videoPlayingStates[idx] = false
      }
    })

    // 🎯 确保静音状态正确，符合自动播放策略
    // 如果是第一次自动播放，强制静音通常能提高成功率
    video.muted = isMuted.value

    console.log(`[AlbumSwiper] Attempting to play video ${index}, muted: ${video.muted}`)

    const playPromise = video.play()
    if (playPromise !== undefined) {
      try {
        await playPromise
        videoPlayingStates[index] = true
        videoLoadingStates[index] = false
        videoErrorStates[index] = false
      } catch (e) {
        console.warn('[AlbumSwiper] Video play failed, retrying with mute:', e)
        // 如果失败且未静音，尝试静音播放
        if (!video.muted) {
          video.muted = true
          try {
            await video.play()
            videoPlayingStates[index] = true
            videoLoadingStates[index] = false
            videoErrorStates[index] = false
          } catch (e2) {
            console.error('[AlbumSwiper] Muted play also failed:', e2)
            videoErrorStates[index] = true
            videoLoadingStates[index] = false
          }
        } else {
          videoErrorStates[index] = true
          videoLoadingStates[index] = false
        }
      }
    } else {
      // 老旧环境
      videoPlayingStates[index] = true
      videoLoadingStates[index] = false
    }
  } catch (e) {
    console.warn('[AlbumSwiper] playVideo outer error:', e)
    videoErrorStates[index] = true
    videoLoadingStates[index] = false
  }
}

// 🎯 视频就绪回调
function onVideoCanplay(index: number) {
  videoLoadingStates[index] = false
  if (index === currentIndex.value) {
    const video = videoRefs.get(index)
    if (video && albumSync) {
      albumSync.duration = video.duration
      albumSync.currentTime = video.currentTime
    }
    if (isParentPlaying.value) {
      playVideo(index)
    }
  }
}

function onVideoPlaying(index: number) {
  videoPlayingStates[index] = true
  videoLoadingStates[index] = false
}

function onVideoPause(index: number) {
  videoPlayingStates[index] = false
}

function onVideoError(index: number) {
  console.error('[AlbumSwiper] Video error:', index)
  videoErrorStates[index] = true
  videoLoadingStates[index] = false
}

// 🎯 获取标识文本
function getBadgeText() {
  // 如果父级明确说是合集，则始终显示合集
  if (props.contentType === 'collection') return '合辑'

  const current = props.images[currentIndex.value]
  if (current?.type === 'video') return '合辑'
  return '相册'
}

// 🎯 处理 slot 角色切换：如果不是当前 slot，强制停止所有视频
watch(
  () => props.isCurrent,
  (isCurrent) => {
    if (!isCurrent) {
      console.log('[AlbumSwiper] Not current anymore, stopping all videos')
      videoRefs.forEach((v) => v.pause())
      Object.keys(videoPlayingStates).forEach((k) => (videoPlayingStates[Number(k)] = false))
    } else if (isParentPlaying.value) {
      // 重新变回 current 时，如果父级在播放，则恢复
      playVideo(currentIndex.value)
    }
  }
)

// 🎯 处理当前项切换
watch(currentIndex, (newIdx) => {
  const media = props.images[newIdx]

  // 重置进度条同步状态
  if (albumSync) {
    albumSync.currentTime = 0
    albumSync.duration = 0
  }

  if (media?.type === 'video' && isParentPlaying.value && props.isCurrent) {
    // 延迟一小会儿，等待 swiper 动画完成或 DOM 就绪
    setTimeout(() => {
      const video = videoRefs.get(newIdx)
      if (video && albumSync) {
        albumSync.duration = video.duration
        albumSync.currentTime = video.currentTime
      }
      playVideo(newIdx)
    }, 100)
  } else {
    // 滑走时，如果是视频则暂停
    videoRefs.forEach((v) => v.pause())
    Object.keys(videoPlayingStates).forEach((k) => (videoPlayingStates[Number(k)] = false))
  }
})

// 🎯 响应父级播放/暂停
watch(isParentPlaying, (playing) => {
  console.log('[AlbumSwiper] Parent playing state changed:', playing)
  const currentMedia = props.images[currentIndex.value]
  if (currentMedia?.type === 'video') {
    if (playing && props.isCurrent) {
      playVideo(currentIndex.value)
    } else {
      const video = videoRefs.get(currentIndex.value)
      video?.pause()
      videoPlayingStates[currentIndex.value] = false
    }
  }
})

// 🎯 响应音量开关（解决打开 App 第一个是合集时点开声音没反应的问题）
watch(isMuted, (muted) => {
  console.log('[AlbumSwiper] Muted state changed:', muted)
  const video = videoRefs.get(currentIndex.value)
  if (video) {
    video.muted = muted
    // 如果解除静音，尝试确保视频在播放
    if (!muted && isParentPlaying.value && props.isCurrent) {
      playVideo(currentIndex.value)
    }
  }
})

// 🎯 监听媒体列表变化（用于处理 Worker 完成后 play_url 从无到有的情况）
watch(
  () => props.images,
  (newImages) => {
    const currentMedia = newImages[currentIndex.value]
    if (currentMedia?.type === 'video' && currentMedia.play_url && isParentPlaying.value) {
      const video = videoRefs.get(currentIndex.value)
      // 如果当前视频正在加载或失败，且拿到了新链接，强制 reload
      if (
        video &&
        (!video.src || video.src.includes('undefined') || videoErrorStates[currentIndex.value])
      ) {
        console.log('[AlbumSwiper] Detected play_url update, reloading video...')
        video.load()
        playVideo(currentIndex.value)
      }
    }
  },
  { deep: true }
)

onMounted(() => {
  // 初始加载如果是视频，尝试播放（仅对当前 slot 生效）
  const currentMedia = props.images[currentIndex.value]
  if (currentMedia?.type === 'video' && isParentPlaying.value && props.isCurrent) {
    playVideo(currentIndex.value)
  }
})

onUnmounted(() => {
  videoRefs.forEach((v) => v.pause())
  videoRefs.clear()
})

const isTransitioning = ref(false)
const loadedImages = reactive<Set<number>>(new Set())

// 触摸状态
const touch = reactive({
  startX: 0,
  startY: 0,
  deltaX: 0,
  deltaY: 0,
  active: false,
  isHorizontal: false, // 🎯 是否判定为水平滑动（用于屏蔽父级的上下滑动）
  isVertical: false // 🎯 是否判定为垂直滑动（用于阻止左右滑动切换图片）
})

// 滑动容器样式
const swiperStyle = computed(() => {
  const baseOffset = -currentIndex.value * 100
  const dragOffset = touch.active ? (touch.deltaX / window.innerWidth) * 100 : 0
  return {
    transform: `translateX(${baseOffset + dragOffset}%)`
  }
})

function getMediaUrl(media: MediaItem) {
  // 🎯 优先使用 play_url 或 url (R2)，并确保补全 CDN 域名
  if (media.play_url || media.url) {
    return buildCdnUrl(media.play_url || media.url)
  }
  // 只有在没搬家的情况下才回退到 file_id (目前 buildCdnUrl 对 file_id 会返回空)
  return buildCdnUrl(media.file_id)
}

function getPosterUrl(media: MediaItem) {
  if (media.cover_url) return buildCdnUrl(media.cover_url)
  return ''
}

function onImageLoad(index: number) {
  loadedImages.add(index)
}

function onImageError(index: number) {
  console.error('[AlbumSwiper] 图片加载失败:', index)
}

function goToSlide(index: number) {
  if (index === currentIndex.value) return
  isTransitioning.value = true
  currentIndex.value = index
  setTimeout(() => {
    isTransitioning.value = false
  }, 300)
  // 🎯 滑到最后一张时触发完播事件
  if (index === props.images.length - 1) {
    emit('reachedLast')
  }
}

// 触摸事件
function onTouchStart(e: TouchEvent) {
  const t = e.touches[0]
  touch.startX = t.clientX
  touch.startY = t.clientY
  touch.deltaX = 0
  touch.deltaY = 0
  touch.active = true
  touch.isHorizontal = false
  touch.isVertical = false
  isTransitioning.value = false
}

function onTouchMove(e: TouchEvent) {
  if (!touch.active) return
  const t = e.touches[0]
  touch.deltaX = t.clientX - touch.startX
  touch.deltaY = t.clientY - touch.startY

  const absX = Math.abs(touch.deltaX)
  const absY = Math.abs(touch.deltaY)

  // 🎯 判定滑动方向：优先判断垂直滑动，如果垂直滑动明显，则阻止左右滑动
  if (!touch.isHorizontal && !touch.isVertical) {
    // 💡 如果垂直位移明显大于水平位移（2倍关系），且垂直位移超过 15px，认定为垂直滑动
    if (absY > 15 && absY > absX * 2) {
      touch.isVertical = true
    }
    // 💡 如果水平位移明显大于垂直位移（2倍关系），且水平位移超过 15px，认定为水平滑动
    else if (absX > 15 && absX > absY * 2) {
      touch.isHorizontal = true
    }
  }

  // 🎯 一旦判定为水平滑动，则阻止事件冒泡给父级（避免触发 feed 的上下滑动）
  if (touch.isHorizontal) {
    e.stopPropagation()
  }

  // 🎯 如果是垂直滑动，不处理水平滑动逻辑（边界处理）
  if (!touch.isVertical) {
    // 边界处理：第一张向右滑、最后一张向左滑时增加阻尼
    if (currentIndex.value === 0 && touch.deltaX > 0) {
      touch.deltaX = touch.deltaX * 0.3
    }
    if (currentIndex.value === props.images.length - 1 && touch.deltaX < 0) {
      touch.deltaX = touch.deltaX * 0.3
    }
  }
}

function onTouchEnd(e: TouchEvent) {
  if (!touch.active) return
  if (touch.isHorizontal) {
    e.stopPropagation()
  }
  touch.active = false
  finishSwipe()
}

// 🖱️ 鼠标事件
function onMouseDown(e: MouseEvent) {
  e.preventDefault() // 阻止拖拽图片
  touch.startX = e.clientX
  touch.deltaX = 0
  touch.active = true
  isTransitioning.value = false
}

function onMouseMove(e: MouseEvent) {
  if (!touch.active) return
  const currentX = e.clientX
  touch.deltaX = currentX - touch.startX

  // 边界处理
  if (currentIndex.value === 0 && touch.deltaX > 0) {
    touch.deltaX = touch.deltaX * 0.3
  }
  if (currentIndex.value === props.images.length - 1 && touch.deltaX < 0) {
    touch.deltaX = touch.deltaX * 0.3
  }
}

function onMouseUp() {
  if (!touch.active) return
  touch.active = false
  finishSwipe()
}

// 🎯 完成滑动（触摸和鼠标共用）
function finishSwipe() {
  // 🎯 如果是垂直滑动，不执行左右滑动切换，直接回弹
  if (touch.isVertical) {
    isTransitioning.value = true
    setTimeout(() => {
      isTransitioning.value = false
    }, 300)
    touch.deltaX = 0
    return
  }

  const threshold = window.innerWidth * 0.2 // 20% 阈值

  if (touch.deltaX < -threshold && currentIndex.value < props.images.length - 1) {
    // 向左滑 -> 下一张
    goToSlide(currentIndex.value + 1)
  } else if (touch.deltaX > threshold && currentIndex.value > 0) {
    // 向右滑 -> 上一张
    goToSlide(currentIndex.value - 1)
  } else {
    // 回弹
    isTransitioning.value = true
    setTimeout(() => {
      isTransitioning.value = false
    }, 300)
  }

  touch.deltaX = 0
}
</script>

<style scoped lang="less">
.album-swiper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: black;
  // 🎯 强制 GPU 渲染，解决 Windows 上滑动无动画问题
  will-change: transform;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  transform: translateZ(0);
}

.swiper-container {
  display: flex;
  height: 100%;
  will-change: transform;

  &.transitioning {
    transition: transform 0.3s ease-out;
  }
}

.swiper-slide {
  flex-shrink: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background: #000; // 🎯 确保背景是黑的，防止闪现
}

.slide-image,
.slide-video {
  width: 100%;
  height: 100%;
  object-fit: contain; // 🎯 统一使用 contain 保证画面完整
  display: block;
}

.pause-layer,
.video-loading,
.video-error {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 11;
}

.pause-layer,
.video-error {
  pointer-events: auto;
}

.video-loading {
  pointer-events: none;
  background: rgba(0, 0, 0, 0.2);
}

.video-error {
  flex-direction: column;
  gap: 12rem;
  background: rgba(0, 0, 0, 0.5);
  color: white;
  font-size: 14rem;
  cursor: pointer;

  .error-icon {
    font-size: 40rem;
    opacity: 0.8;
  }
}

.loading-icon {
  font-size: 40rem;
  color: rgba(255, 255, 255, 0.6);
}

.pause-icon {
  font-size: 60rem;
  color: rgba(255, 255, 255, 0.5);
  filter: drop-shadow(0 0 8px rgba(0, 0, 0, 0.3));
  pointer-events: none; // 图标不阻挡点击
}

.content-type-badge {
  position: absolute;
  top: 60px;
  left: 12px;
  // 🎯 毛玻璃效果
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 6px 12px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  z-index: 10;
  color: white;
  font-size: 13px;

  .badge-text {
    font-weight: 500;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
}

.swiper-pagination {
  position: absolute;
  bottom: 120px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  z-index: 10;
}

.pagination-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.4);
  transition: all 0.3s ease;
  cursor: pointer;

  &.active {
    background: white;
    width: 18px;
    border-radius: 3px;
  }
}

// 🎯 查看高清按钮
.hd-tip {
  position: absolute;
  bottom: 200px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 8px 16px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 80;
  color: white;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  &:active {
    transform: translateX(-50%) scale(0.95);
  }
}
</style>
