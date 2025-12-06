<template>
  <div
    :class="['tri-video-list', { 'comments-open': videoStore.showComments }]"
    ref="containerRef"
    :data-page="page"
    @touchstart.stop="onTouchStart"
    @touchmove.stop.prevent="onTouchMove"
    @touchend.stop="onTouchEnd"
    @wheel.prevent="onWheel"
  >
    <div
      v-for="slot in slots"
      :key="slot.key"
      class="slot"
      :class="slot.role"
      data-slot-role="slot"
      data-progress="true"
      data-progress-bar="true"
    >
      <video
        :ref="setSlotRef(slot.key)"
        preload="auto"
        loop
        playsinline
        webkit-playsinline
        x5-playsinline
        x5-video-player-type="h5-page"
        :muted="slot.muted"
        @play="onPlay(slot)"
        @pause="onPause(slot)"
        @error="onError(slot)"
        @click="togglePlay(slot)"
      />
      <div v-if="slot.role === 'current' && isPausedOverlay" class="pause-layer">
        <Icon icon="fluent:play-28-filled" class="pause-icon" />
      </div>
    </div>

    <div class="overlay" v-if="currentItem">
      <ItemToolbar v-model:item="currentItemLocal" @update:item="handleItemUpdate" />
      <ItemDesc v-model:item="currentItemLocal" @update:item="handleItemUpdate" />

      <!-- 进度条：直接放在 overlay 内的最上层 -->
      <div
        class="video-progress"
        @pointerdown.stop.prevent="handleProgressStart"
        data-progress="video-progress"
      >
        <div class="progress-time" v-if="playState.isMoving" data-progress="time">
          {{ formatTime(playState.currentTime) }} / {{ formatTime(playState.duration) }}
        </div>
        <div class="progress-track" :ref="setProgressRef" data-progress="track">
          <div
            class="progress-bar"
            :style="{ width: progressPercent + '%' }"
            data-progress="bar"
          ></div>
          <div
            class="progress-thumb"
            :style="{ left: progressPercent + '%' }"
            data-progress="thumb"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, reactive, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import ItemToolbar from '../slide/ItemToolbar.vue'
import ItemDesc from '../slide/ItemDesc.vue'
import type { VideoItem } from '../../types'
import { useVideoStore } from '@/stores/video'

const DEBUG_PREFIX = '[AutoPlayDebug]'
const SLOT_KEYS = ['slotA', 'slotB', 'slotC'] as const

interface SlotState {
  key: (typeof SLOT_KEYS)[number]
  role: 'prev' | 'current' | 'next'
  videoIndex: number | null
  muted: boolean
}

interface Props {
  items: VideoItem[]
  page: 'home' | 'detail' | 'me'
  initialIndex?: number
  autoplay?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  initialIndex: 0,
  autoplay: true
})

const emit = defineEmits<{
  'update:index': [index: number]
  loadMore: []
}>()

const videoStore = useVideoStore()

const containerRef = ref<HTMLDivElement>()
const currentIndex = ref(props.initialIndex)
const userRequestedSound = ref(!videoStore.isMuted)
const slots = reactive<SlotState[]>([
  {
    key: 'slotA',
    role: 'prev',
    videoIndex: props.initialIndex - 1 >= 0 ? props.initialIndex - 1 : null,
    muted: true
  },
  { key: 'slotB', role: 'current', videoIndex: props.initialIndex, muted: true },
  {
    key: 'slotC',
    role: 'next',
    videoIndex: props.initialIndex + 1 < props.items.length ? props.initialIndex + 1 : null,
    muted: true
  }
])
const slotRefs = new Map<string, HTMLVideoElement>()
const boundVideos = new WeakSet<HTMLVideoElement>()
const progressRef = ref<HTMLElement | null>(null)
const playState = reactive({
  duration: 0,
  currentTime: 0,
  playX: 0,
  step: 0,
  isMoving: false,
  startX: 0,
  lastX: 0,
  lastTime: 0
})

const touch = reactive({
  startY: 0,
  deltaY: 0,
  active: false,
  threshold: 50 // 触发切换的阈值
})
let wheelLock = false

const currentItem = computed(() => props.items[currentIndex.value])
// ✅ 初始化时也要深拷贝，避免共享引用
const currentItemLocal = ref<VideoItem | null>(
  currentItem.value ? JSON.parse(JSON.stringify(currentItem.value)) : null
)
const isPlaying = ref(false)
const isPausedOverlay = computed(() => !isPlaying.value)

// 进度百分比
const progressPercent = computed(() => {
  if (!playState.duration || playState.duration <= 0) return 0
  return Math.min(100, Math.max(0, (playState.currentTime / playState.duration) * 100))
})

provide(
  'item',
  computed(() => currentItemLocal.value)
)
provide(
  'position',
  computed(() => ({
    uniqueId: props.page,
    index: currentIndex.value
  }))
)
provide(
  'isPlaying',
  computed(() => isPlaying.value)
)
provide(
  'isMuted',
  computed(() => videoStore.isMuted)
)

function setSlotRef(key: string) {
  return (el: HTMLVideoElement | null) => {
    if (el) {
      slotRefs.set(key, el)
      // 防止重复绑定事件导致日志重复
      if (!boundVideos.has(el)) {
        const log = (event: string) => {
          const slot = slots.find((s) => s.key === key)
          console.log(`${DEBUG_PREFIX} video:${event}`, {
            slot: slot?.role,
            key,
            videoIndex: slot?.videoIndex,
            id:
              slot?.videoIndex != null
                ? props.items[slot.videoIndex]?.aweme_id?.substring(0, 8)
                : 'none',
            readyState: el.readyState,
            paused: el.paused,
            muted: el.muted
          })
        }
        ;['loadstart', 'loadeddata', 'canplay', 'playing', 'waiting', 'stalled', 'ended'].forEach(
          (evt) => {
            el.addEventListener(evt, () => log(evt))
          }
        )
        boundVideos.add(el)
      }
    } else {
      slotRefs.delete(key)
    }
  }
}

function getSlotByRole(role: SlotState['role']) {
  return slots.find((s) => s.role === role)
}

function setProgressRef(el: HTMLElement | null) {
  progressRef.value = el
}

function updateSlotSource(slot: SlotState, preloadOnly = false) {
  const video = slotRefs.get(slot.key)
  if (!video) return

  // 如果不是current，先暂停
  if (slot.role !== 'current' && !video.paused) {
    console.log('[updateSlotSource] 暂停非current视频', {
      slotKey: slot.key,
      role: slot.role,
      oldIndex: slot.videoIndex
    })
    video.pause()
  }

  const idx = slot.videoIndex
  if (idx == null || !props.items[idx]) {
    video.removeAttribute('src')
    video.load()
    return
  }
  const url = props.items[idx].video?.play_addr?.url_list?.[0]
  const poster = props.items[idx].video?.cover?.url_list?.[0] || ''
  if (!url) {
    console.warn(`${DEBUG_PREFIX} source:empty`, { slot: slot.role, key: slot.key, idx })
  }
  if (url) {
    video.src = url
    if (poster) {
      video.poster = poster
    }
    video.load()
    if (slot.role === 'current') {
      resetProgressState()
      bindCurrentVideoEvents(video)
    }
    if (!preloadOnly && slot.role === 'current') {
      playCurrent()
    }
  }
}

function tryUnmute(video: HTMLVideoElement) {
  if (!userRequestedSound.value) return
  const attempts = [0, 200, 500]
  attempts.forEach((delay) => {
    setTimeout(() => {
      video.muted = false
      video.play().catch(() => {
        video.muted = true
      })
    }, delay)
  })
}

function playCurrent() {
  const slot = getSlotByRole('current')
  if (!slot) {
    console.warn(`${DEBUG_PREFIX} playCurrent:no-slot`)
    return
  }
  const video = slotRefs.get(slot.key)
  if (!video) {
    console.warn(`${DEBUG_PREFIX} playCurrent:no-video`, { slot: slot.role, key: slot.key })
    return
  }

  // 先暂停所有其他视频
  slotRefs.forEach((v, k) => {
    if (k !== slot.key && !v.paused) {
      console.log(`${DEBUG_PREFIX} 暂停其他视频`, { key: k, slotKey: slot.key })
      v.pause()
    }
  })

  video.muted = videoStore.isMuted || !userRequestedSound.value
  slot.muted = video.muted

  console.log(`${DEBUG_PREFIX} play:start`, {
    id: slot.videoIndex != null ? props.items[slot.videoIndex]?.aweme_id?.substring(0, 8) : 'none',
    videoIndex: slot.videoIndex,
    slotKey: slot.key,
    page: props.page,
    muted: video.muted,
    globalMuted: (window as any)?.isMuted,
    readyState: video.readyState,
    paused: video.paused
  })

  video
    .play()
    .then(() => {
      // 再次检查role，防止异步过程中角色已改变
      const currentSlot = getSlotByRole('current')
      if (currentSlot?.key !== slot.key) {
        console.warn(`${DEBUG_PREFIX} play成功但已不是current，暂停`, {
          slotKey: slot.key,
          currentSlotKey: currentSlot?.key
        })
        video.pause()
        return
      }
      isPlaying.value = true
      tryUnmute(video)
    })
    .catch((err) => {
      console.warn(`${DEBUG_PREFIX} play:error`, {
        id:
          slot.videoIndex != null
            ? props.items[slot.videoIndex]?.aweme_id?.substring(0, 8)
            : 'none',
        page: props.page,
        error: err?.name
      })
      // 错误也要检查role
      const currentSlot = getSlotByRole('current')
      if (currentSlot?.key !== slot.key) {
        console.warn(`${DEBUG_PREFIX} play失败且已不是current，放弃重试`)
        return
      }
      video.muted = true
      slot.muted = true
      video
        .play()
        .then(() => {
          // 重试成功后也要检查
          const currentSlot2 = getSlotByRole('current')
          if (currentSlot2?.key !== slot.key) {
            video.pause()
            return
          }
          isPlaying.value = true
          tryUnmute(video)
        })
        .catch((err2) => {
          console.error(`${DEBUG_PREFIX} play:retry-fail`, err2)
        })
    })
}

function prepareSlots(initial = false) {
  slots.forEach((slot) => {
    updateSlotSource(slot, slot.role !== 'current' || !initial)
  })
  if (initial) {
    nextTick(() => playCurrent())
  }
}

function rotateToNext() {
  if (currentIndex.value >= props.items.length - 1) {
    emit('loadMore')
    return
  }

  console.log('[视频切换] 切换到下一个 START', {
    from: currentIndex.value,
    to: currentIndex.value + 1,
    timestamp: Date.now()
  })

  const prev = getSlotByRole('prev')
  const current = getSlotByRole('current')
  const next = getSlotByRole('next')
  if (!current || !next || !prev) return

  // 暂停所有视频，确保没有遗漏
  slotRefs.forEach((video, key) => {
    if (!video.paused) {
      console.log('[视频切换] 暂停视频', {
        key,
        videoIndex: slots.find((s) => s.key === key)?.videoIndex
      })
      video.pause()
    }
  })

  console.log('[视频切换] slot轮转前', {
    prev: { key: prev.key, role: prev.role, idx: prev.videoIndex },
    current: { key: current.key, role: current.role, idx: current.videoIndex },
    next: { key: next.key, role: next.role, idx: next.videoIndex }
  })

  prev.role = 'next'
  current.role = 'prev'
  next.role = 'current'

  console.log('[视频切换] slot轮转后', {
    prev: { key: prev.key, role: prev.role, idx: prev.videoIndex },
    current: { key: current.key, role: current.role, idx: current.videoIndex },
    next: { key: next.key, role: next.role, idx: next.videoIndex }
  })

  currentIndex.value += 1
  emit('update:index', currentIndex.value)
  videoStore.setCurrentVideo(props.items[currentIndex.value], currentIndex.value)
  videoStore.setCurrentPlaying(props.items[currentIndex.value].aweme_id, props.page)
  // ✅ 深拷贝确保每个视频的统计数据独立
  currentItemLocal.value = JSON.parse(JSON.stringify(props.items[currentIndex.value]))

  prev.videoIndex = currentIndex.value + 1 < props.items.length ? currentIndex.value + 1 : null
  updateSlotSource(prev, true)
  updateSlotSource(next)

  console.log('[视频切换] 切换到下一个 END', {
    newIndex: currentIndex.value,
    timestamp: Date.now()
  })

  if (currentIndex.value >= props.items.length - 3) {
    emit('loadMore')
  }
}

function rotateToPrev() {
  if (currentIndex.value <= 0) return

  console.log('[视频切换] 切换到上一个 START', {
    from: currentIndex.value,
    to: currentIndex.value - 1,
    timestamp: Date.now()
  })

  const prev = getSlotByRole('prev')
  const current = getSlotByRole('current')
  const next = getSlotByRole('next')
  if (!current || !next || !prev) return

  // 暂停所有视频，确保没有遗漏
  slotRefs.forEach((video, key) => {
    if (!video.paused) {
      console.log('[视频切换] 暂停视频', {
        key,
        videoIndex: slots.find((s) => s.key === key)?.videoIndex
      })
      video.pause()
    }
  })

  console.log('[视频切换] slot轮转前', {
    prev: { key: prev.key, role: prev.role, idx: prev.videoIndex },
    current: { key: current.key, role: current.role, idx: current.videoIndex },
    next: { key: next.key, role: next.role, idx: next.videoIndex }
  })

  next.role = 'prev'
  current.role = 'next'
  prev.role = 'current'

  console.log('[视频切换] slot轮转后', {
    prev: { key: prev.key, role: prev.role, idx: prev.videoIndex },
    current: { key: current.key, role: current.role, idx: current.videoIndex },
    next: { key: next.key, role: next.role, idx: next.videoIndex }
  })

  currentIndex.value -= 1
  emit('update:index', currentIndex.value)
  videoStore.setCurrentVideo(props.items[currentIndex.value], currentIndex.value)
  videoStore.setCurrentPlaying(props.items[currentIndex.value].aweme_id, props.page)
  // ✅ 深拷贝确保每个视频的统计数据独立
  currentItemLocal.value = JSON.parse(JSON.stringify(props.items[currentIndex.value]))

  next.videoIndex = currentIndex.value - 1 >= 0 ? currentIndex.value - 1 : null
  updateSlotSource(next, true)
  updateSlotSource(prev)

  console.log('[视频切换] 切换到上一个 END', {
    newIndex: currentIndex.value,
    timestamp: Date.now()
  })
}

function onTouchStart(e: TouchEvent) {
  if (videoStore.showComments) return
  touch.active = true
  touch.startY = e.touches[0].clientY
  touch.deltaY = 0
}

function onTouchMove(e: TouchEvent) {
  if (videoStore.showComments) return
  if (!touch.active) return
  touch.deltaY = e.touches[0].clientY - touch.startY
}

function onTouchEnd() {
  if (videoStore.showComments) return
  if (!touch.active) return
  const threshold = touch.threshold

  console.log('[触摸] touchEnd', {
    deltaY: touch.deltaY,
    threshold,
    willRotate: Math.abs(touch.deltaY) > threshold,
    direction: touch.deltaY < 0 ? 'next' : 'prev'
  })

  if (touch.deltaY < -threshold) {
    rotateToNext()
  } else if (touch.deltaY > threshold) {
    rotateToPrev()
  }
  touch.active = false
  touch.deltaY = 0
}

function onWheel(e: WheelEvent) {
  if (wheelLock) {
    return
  }
  const deltaY = e.deltaY
  const threshold = touch.threshold

  if (deltaY > threshold && currentIndex.value < props.items.length - 1) {
    wheelLock = true
    rotateToNext()
  } else if (deltaY < -threshold && currentIndex.value > 0) {
    wheelLock = true
    rotateToPrev()
  }
  setTimeout(() => {
    wheelLock = false
  }, 200)
}

watch(
  () => videoStore.isMuted,
  (muted) => {
    userRequestedSound.value = !muted
    if (!slotRefs.size) return
    slotRefs.forEach((video, key) => {
      video.muted = muted || !userRequestedSound.value
      const slot = slots.find((s) => s.key === key)
      if (slot) slot.muted = video.muted
    })
    if (!muted) {
      const currentSlot = getSlotByRole('current')
      if (currentSlot) {
        const video = slotRefs.get(currentSlot.key)
        video && tryUnmute(video)
      }
    }
  }
)

watch(
  () => props.items.length,
  () => {
    const nextSlot = getSlotByRole('next')
    if (nextSlot && nextSlot.videoIndex == null && currentIndex.value + 1 < props.items.length) {
      nextSlot.videoIndex = currentIndex.value + 1
      updateSlotSource(nextSlot, true)
    }
  }
)

// ✅ 处理 ItemToolbar/ItemDesc 的数据更新，同步回原始数组
function handleItemUpdate(updatedItem: VideoItem) {
  if (currentIndex.value >= 0 && currentIndex.value < props.items.length) {
    // 更新原始数组中的数据
    Object.assign(props.items[currentIndex.value], updatedItem)
    // 同步到 videoStore
    videoStore.setCurrentVideo(props.items[currentIndex.value], currentIndex.value)
  }
  // 更新本地副本
  currentItemLocal.value = updatedItem
}

watch(
  currentItem,
  (val) => {
    if (val) {
      // ✅ 深拷贝确保每个视频的数据独立，避免统计数据互相影响
      currentItemLocal.value = JSON.parse(JSON.stringify(val))
    }
  },
  { deep: true }
)

onMounted(() => {
  prepareSlots(true)

  // ✅ 设置初始视频到 videoStore
  if (props.items[currentIndex.value]) {
    videoStore.setCurrentVideo(props.items[currentIndex.value], currentIndex.value)
    videoStore.setCurrentPlaying(props.items[currentIndex.value].aweme_id, props.page)
  }
})

onUnmounted(() => {
  // 清理进度条事件绑定
  if (currentBoundVideo) {
    unbindVideoEvents(currentBoundVideo)
    currentBoundVideo = null
  }
  // 确保清理拖动状态
  isDragging = false
  playState.isMoving = false
  slotRefs.clear()
})

function onPlay(slot: SlotState) {
  console.log('[视频事件] onPlay', {
    slotKey: slot.key,
    role: slot.role,
    videoIndex: slot.videoIndex,
    videoId:
      slot.videoIndex != null ? props.items[slot.videoIndex]?.aweme_id?.substring(0, 8) : 'none',
    isCurrent: slot.role === 'current'
  })

  if (slot.role === 'current') {
    isPlaying.value = true
    playState.isMoving = false
  } else {
    // 非 current 的 slot 不应该播放
    console.warn('[视频事件] 非current视频尝试播放，将暂停', {
      slotKey: slot.key,
      role: slot.role
    })
    const video = slotRefs.get(slot.key)
    if (video) {
      video.pause()
    }
  }
}

function onPause(slot: SlotState) {
  console.log('[视频事件] onPause', {
    slotKey: slot.key,
    role: slot.role,
    videoIndex: slot.videoIndex,
    videoId:
      slot.videoIndex != null ? props.items[slot.videoIndex]?.aweme_id?.substring(0, 8) : 'none',
    isCurrent: slot.role === 'current'
  })

  if (slot.role === 'current') {
    isPlaying.value = false
    playState.isMoving = false
  }
}

function togglePlay(slot: SlotState) {
  const video = slotRefs.get(slot.key)
  if (!video) return
  if (video.paused) {
    video
      .play()
      .then(() => {
        isPlaying.value = slot.role === 'current'
      })
      .catch(() => {})
  } else {
    video.pause()
    if (slot.role === 'current') {
      isPlaying.value = false
    }
  }
}

// 保存当前绑定的视频元素，防止多个视频同时更新进度条
let currentBoundVideo: HTMLVideoElement | null = null

function unbindVideoEvents(video: HTMLVideoElement) {
  if (video) {
    video.onloadedmetadata = null
    video.ontimeupdate = null
  }
}

function bindCurrentVideoEvents(video: HTMLVideoElement) {
  // 先解绑旧视频的事件
  if (currentBoundVideo && currentBoundVideo !== video) {
    unbindVideoEvents(currentBoundVideo)
  }

  currentBoundVideo = video

  const computeStep = () => {
    const el = progressRef.value
    if (!el || typeof (el as any).getBoundingClientRect !== 'function') {
      return
    }
    const rect = el.getBoundingClientRect()
    const dur = playState.duration || video.duration || 1
    playState.step = rect.width / Math.max(0.001, dur)
  }

  video.onloadedmetadata = () => {
    // 确保只有当前视频才更新进度条
    if (video !== currentBoundVideo) {
      return
    }

    playState.duration = video.duration
    playState.currentTime = video.currentTime || 0
    computeStep()
    updateProgressFromVideo(video)
  }

  video.ontimeupdate = () => {
    // 确保只有当前视频才更新进度条
    if (video !== currentBoundVideo) return
    if (playState.isMoving) return // 拖动中不被 timeupdate 干扰

    if (!playState.duration && video.duration) {
      playState.duration = video.duration
      computeStep()
    }
    updateProgressFromVideo(video)
  }

  nextTick(computeStep)
}

function getCurrentVideoIndex() {
  const current = getSlotByRole('current')
  return current?.videoIndex ?? -1
}

// 进度条拖动
let isDragging = false

function handleProgressStart(e: PointerEvent) {
  const video = getCurrentVideo()
  const track = progressRef.value
  if (!video || !track) return

  isDragging = true
  playState.isMoving = true
  video.pause()

  updateProgressFromPointer(e, track, video)

  const onMove = (ev: PointerEvent) => {
    if (!isDragging) return
    ev.preventDefault()
    updateProgressFromPointer(ev, track, video)
  }

  const onEnd = () => {
    isDragging = false
    playState.isMoving = false
    video.currentTime = playState.currentTime
    video.play().catch(() => {})
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onEnd)
    window.removeEventListener('pointercancel', onEnd)
  }

  window.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onEnd)
  window.addEventListener('pointercancel', onEnd)
}

function updateProgressFromPointer(e: PointerEvent, track: HTMLElement, video: HTMLVideoElement) {
  const rect = track.getBoundingClientRect()
  const x = e.clientX - rect.left
  const percent = Math.max(0, Math.min(1, x / rect.width))
  playState.currentTime = percent * playState.duration
}

function getCurrentVideo() {
  const current = getSlotByRole('current')
  if (!current) return null
  return slotRefs.get(current.key) || null
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function updateProgressFromVideo(video: HTMLVideoElement) {
  if (video !== currentBoundVideo) return
  playState.currentTime = Math.max(0, Math.min(video.currentTime || 0, playState.duration))
}

function resetProgressState() {
  playState.duration = 0
  playState.currentTime = 0
  playState.isMoving = false
  isDragging = false
}

function onError(slot: SlotState) {
  const video = slotRefs.get(slot.key)
  if (!video) return
  console.warn(`${DEBUG_PREFIX} error`, {
    id: slot.videoIndex != null ? props.items[slot.videoIndex]?.aweme_id?.substring(0, 8) : 'none',
    page: props.page
  })
  video.load()
  if (slot.role === 'current') {
    playCurrent()
  }
}

defineExpose({
  getCurrentIndex: () => currentIndex.value
})
</script>

<style scoped lang="less">
.tri-video-list {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: black;
  touch-action: none;
}

.tri-video-list.comments-open {
  z-index: 200;
  overscroll-behavior: contain;
  touch-action: auto; // 允许评论区域自身滚动
  overflow: visible; // 避免评论弹层被父容器裁剪
}

.slot {
  position: absolute;
  left: 0;
  width: 100%;
  height: 100%;
  transition: transform 0.25s ease;

  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}

// 新的进度条样式
.video-progress {
  position: absolute;
  bottom: -15px;
  left: 5%;
  right: 5%;
  z-index: 200; // 超高优先级，确保在最上层
  pointer-events: auto;
  padding: 20px 0 20px 0; // 上20px 下10px，增加可拖动区域高度（方便手指点击）

  .progress-time {
    position: absolute;
    bottom: 30px; // 向上移一点，避免和进度条重叠
    left: 50%;
    transform: translateX(-50%);
    font-size: 16px; // 从 13px 改为 16px，更大
    font-weight: 500;
    color: white;
    background: rgba(0, 0, 0, 0.75);
    padding: 6px 16px; // 加大内边距
    border-radius: 14px;
    white-space: nowrap;
    z-index: 201; // 确保在最上层
  }

  .progress-track {
    position: relative;
    width: 100%;
    height: 3px;
    background: rgba(255, 255, 255, 0.3);
    border-radius: 2px;
    cursor: pointer;

    &:hover {
      height: 4px;
    }
  }

  .progress-bar {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    background: #fe2c55;
    border-radius: 2px;
    transition: width 0.1s linear;
  }

  .progress-thumb {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    background: #fe2c55;
    border: 2px solid white;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 4px rgba(0, 0, 0, 0.3);
  }
}

.pause-layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 11;
}

.pause-icon {
  font-size: 80rem;
  color: rgba(255, 255, 255, 0.5);
  z-index: 12;
  pointer-events: none;
  filter: drop-shadow(0 0 8px rgba(0, 0, 0, 0.3));
}

.slot.prev {
  transform: translateY(-100%);
}

.slot.current {
  transform: translateY(0);
}

.slot.next {
  transform: translateY(100%);
}

.overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  pointer-events: none;

  > * {
    pointer-events: auto;
  }
}
</style>
