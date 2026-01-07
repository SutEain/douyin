<template>
  <div
    :class="['tri-video-list', { 'comments-open': videoStore.showComments }]"
    ref="containerRef"
    :data-page="page"
    @touchstart.stop="onTouchStart"
    @touchmove.stop.prevent="onTouchMove"
    @touchend.stop="onTouchEnd"
    @mousedown.stop="onMouseDown"
    @mousemove.stop="onMouseMove"
    @mouseup.stop="onMouseUp"
    @mouseleave.stop="onMouseUp"
    @wheel.prevent="onWheel"
  >
    <!-- 🎯 滑动容器：整体跟手移动 -->
    <div
      class="slide-container"
      :style="slideContainerStyle"
      :class="{ transitioning: slideState.isTransitioning }"
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
        <!-- 🎯 内容加载占位（取消“没有更多”判断，只显示加载背景） -->
        <template v-if="slot.videoIndex === null">
          <div class="no-more-page" style="background: #000">
            <Loading style="width: 40rem" />
          </div>
        </template>

        <!-- 🎯 根据内容类型渲染不同组件 -->
        <template v-else-if="getSlotContentType(slot) === 'video'">
          <!-- 视频元素 -->
          <video
            :ref="setSlotRef(slot.key)"
            preload="auto"
            loop
            playsinline
            webkit-playsinline
            x5-playsinline
            x5-video-player-type="h5-page"
            :muted="slot.muted"
            :style="{ objectFit: getSlotVideoFit(slot) }"
            @play="onPlay(slot)"
            @playing="onPlaying(slot)"
            @pause="onPause(slot)"
            @error="onError(slot)"
            @click="togglePlay(slot)"
          />

          <!-- 自定义 poster 层：视频加载时显示缩略图 -->
          <div
            v-if="slot.posterUrl && !slot.isPlaying"
            class="video-poster"
            :style="{
              backgroundImage: `url(${slot.posterUrl})`,
              backgroundSize: getSlotVideoFit(slot) === 'cover' ? 'cover' : 'contain'
            }"
          ></div>

          <!-- 暂停图标 -->
          <div v-if="slot.role === 'current' && isPausedOverlay" class="pause-layer">
            <Icon icon="fluent:play-28-filled" class="pause-icon" />
          </div>
        </template>

        <!-- 🖼️ 单图 -->
        <template v-else-if="getSlotContentType(slot) === 'image'">
          <ImageViewer :images="getSlotImages(slot)" @click="handleImageClick(slot)" />
        </template>

        <!-- 📷 相册 / 合集 -->
        <template
          v-else-if="
            getSlotContentType(slot) === 'album' || getSlotContentType(slot) === 'collection'
          "
        >
          <AlbumSwiper
            :images="getSlotImages(slot)"
            :is-current="slot.role === 'current'"
            :content-type="getSlotContentType(slot)"
            @click="handleImageClick(slot)"
            @reached-last="handleAlbumComplete(slot)"
          />
        </template>
      </div>

      <!-- 🎯 UI 元素（描述、点赞、进度条等）：放在 slide-container 里，跟随整体移动 -->
      <div class="overlay" v-if="currentItem">
        <ItemToolbar v-model:item="currentItemLocal" @update:item="handleItemUpdate" />
        <ItemDesc
          v-model:item="currentItemLocal"
          @update:item="handleItemUpdate"
          @view-detail="openGraphicDetail"
        />

        <!-- 进度条：在视频或合辑类型时显示 -->
        <div
          v-show="currentContentType === 'video' || (isAlbumLike && albumSync.duration > 0)"
          class="video-progress"
          @pointerdown.stop.prevent="handleProgressStart"
          data-progress="video-progress"
        >
          <div
            class="progress-time"
            v-if="playState.isMoving || playState.showTimeHint"
            data-progress="time"
          >
            {{ formatTime(isAlbumLike ? albumSync.currentTime : playState.currentTime) }} /
            {{ formatTime(isAlbumLike ? albumSync.duration : playState.duration) }}
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
    <!-- 🎯 关闭 slide-container -->
  </div>

  <!-- 🖼️ 图文详情（推荐流里刷到 image/album 时：展开后点“查看详情”弹出） -->
  <teleport to="body">
    <div v-if="graphicDetail.visible" class="graphic-detail-shadow">
      <AlbumDetail
        :detail="graphicDetail.detail"
        @close="closeGraphicDetail"
        @update="handleGraphicDetailUpdate"
      />
    </div>
  </teleport>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  provide,
  reactive,
  ref,
  watch
} from 'vue'
import { Icon } from '@iconify/vue'
import ItemToolbar from '../slide/ItemToolbar.vue'
import ItemDesc from '../slide/ItemDesc.vue'
import ImageViewer from './ImageViewer.vue'
import AlbumSwiper from './AlbumSwiper.vue'
import type { VideoItem } from '../../types'
import { useVideoStore } from '@/stores/video'
import { useBaseStore } from '@/store/pinia'
import { parseImages, getContentType, buildCdnUrl } from '@/utils/media'
import { recordVideoView } from '@/api/videos'
// import { _copy, _notice } from '@/utils'
// ✅ 避免循环依赖导致的 “Cannot access 'Y' before initialization”
// 只在需要打开图文详情时再异步加载
const AlbumDetail = defineAsyncComponent(() => import('@/pages/other/AlbumDetail.vue'))

const DEBUG_PREFIX = '[AutoPlayDebug]'
// 🎯 观看历史记录追踪（避免重复记录）
const recordedViews = new Set<string>() // 已记录开始观看
const completedViews = new Set<string>() // 已记录完播
let currentCompletionTimer: ReturnType<typeof setTimeout> | null = null // 当前视频的完播计时器

// 🎯 记录进入 current（立即记录播放 + 设置完播计时器）
function recordEnterCurrent(item: VideoItem | null, contentType: string) {
  if (!item?.aweme_id) return

  // 1. 立即记录播放
  if (!recordedViews.has(item.aweme_id)) {
    recordedViews.add(item.aweme_id)
    recordVideoView(item.aweme_id, { progress: 0 })
    console.log(`[ViewHistory] 记录播放: ${item.aweme_id.substring(0, 8)}`)
  }

  // 2. 设置完播计时器
  if (completedViews.has(item.aweme_id)) return // 已完播过

  // 清除之前的计时器
  if (currentCompletionTimer) {
    clearTimeout(currentCompletionTimer)
    currentCompletionTimer = null
  }

  // 根据内容类型计算完播时长
  if (contentType === 'image' || contentType === 'album' || contentType === 'collection') {
    // 🎯 图片/相册/合集：立即记录完播，且由于 RPC v2 支持，我们只需确保一次性标记
    if (!completedViews.has(item.aweme_id)) {
      recordedViews.add(item.aweme_id)
      completedViews.add(item.aweme_id)
      recordVideoView(item.aweme_id, { progress: 100, completed: true })
      console.log(`[ViewHistory] 图片/相册立即完播: ${item.aweme_id.substring(0, 8)}`)
    }
    return // 退出，不设置计时器
  }

  // 视频：时长的 70%，最少 2 秒，最多 30 秒
  const duration = item.video?.duration || 10
  const completionTime = Math.max(2000, Math.min(30000, duration * 0.7 * 1000))

  console.log(`[ViewHistory] 设置完播计时器: ${item.aweme_id.substring(0, 8)}, ${completionTime}ms`)

  currentCompletionTimer = setTimeout(() => {
    if (!completedViews.has(item.aweme_id)) {
      completedViews.add(item.aweme_id)
      recordVideoView(item.aweme_id, { progress: 100, completed: true })
      console.log(`[ViewHistory] 记录完播: ${item.aweme_id.substring(0, 8)}`)
    }
    currentCompletionTimer = null
  }, completionTime)
}

// 🎯 离开 current（清除计时器）
function recordLeaveCurrent() {
  if (currentCompletionTimer) {
    clearTimeout(currentCompletionTimer)
    currentCompletionTimer = null
    console.log(`[ViewHistory] 清除完播计时器（离开当前视频）`)
  }
}
const SLOT_KEYS = ['slotA', 'slotB', 'slotC'] as const

interface SlotState {
  key: (typeof SLOT_KEYS)[number]
  role: 'prev' | 'current' | 'next'
  videoIndex: number | null
  muted: boolean
  posterUrl: string // 🎯 视频封面图
  isPlaying: boolean // 🎯 是否正在播放
}

interface Props {
  items: VideoItem[]
  page: 'home' | 'detail' | 'me' | 'long-video'
  initialIndex?: number
  autoplay?: boolean
  hasMore?: boolean // 🎯 是否还有更多数据
  noMoreSubtext?: string | null // 🎯 没有更多时的副标题文案
}

const props = withDefaults(defineProps<Props>(), {
  initialIndex: 0,
  autoplay: true,
  hasMore: true,
  noMoreSubtext: '休息一下，稍后再来'
})

const emit = defineEmits<{
  'update:index': [index: number]
  loadMore: []
}>()

const videoStore = useVideoStore()

const graphicDetail = reactive<{
  visible: boolean
  detail: any
}>({
  visible: false,
  detail: null
})

function formatMMDDFromSeconds(sec?: number) {
  const t = Number(sec)
  if (!Number.isFinite(t) || t <= 0) return ''
  const ms = t < 1e12 ? t * 1000 : t
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}-${dd}`
}

function buildNoteCardDetailFromItem(item: VideoItem) {
  const imgs = parseImages(item?.images)
  const imageList = Array.isArray(imgs)
    ? imgs
        .map((img: any) => ({
          type: img?.type || 'image', // 🎯 传递媒体类型
          info_list: [
            {
              // 🎯 优先使用 play_url (R2)，然后是 url，最后才是 file_id
              url: img?.play_url || img?.url || buildCdnUrl(String(img?.file_id || ''))
            }
          ]
        }))
        .filter((x: any) => !!x?.info_list?.[0]?.url)
    : []

  const coverUrl = imageList?.[0]?.info_list?.[0]?.url || ''
  const nickname = item?.author?.nickname || '用户'
  const avatar =
    item?.author?.avatar_168x168?.url_list?.[0] ||
    item?.author?.avatar_thumb?.url_list?.[0] ||
    item?.author?.avatar_300x300?.url_list?.[0] ||
    ''
  const authorId = item?.author?.user_id || null

  return {
    id: item.aweme_id,
    isLoved: !!(item as any).isLoved,
    isCollect: !!(item as any).isCollect,
    isAttention: !!(item as any).isAttention,
    note_card: {
      aweme_id: item.aweme_id,
      cover: { url_default: coverUrl },
      image_list: imageList,
      display_title: (item as any).desc || '',
      user: {
        id: authorId,
        avatar,
        nickname,
        nick_name: nickname
      },
      interact_info: {
        liked_count: (item as any)?.statistics?.digg_count ?? 0,
        comment_count: (item as any)?.statistics?.comment_count ?? 0,
        collect_count: (item as any)?.statistics?.collect_count ?? 0,
        share_count: (item as any)?.statistics?.share_count ?? 0
      },
      comment_list: [],
      createTime: formatMMDDFromSeconds((item as any)?.create_time)
    }
  }
}

function openGraphicDetail() {
  const item = currentItemLocal.value
  if (!item) return
  const t = String((item as any)?.content_type || 'video')
  if (t !== 'image' && t !== 'album' && t !== 'collection') return
  graphicDetail.detail = buildNoteCardDetailFromItem(item)
  graphicDetail.visible = true
  console.log('[VideoList] open graphic detail from feed:', { id: item.aweme_id, type: t })
}

function closeGraphicDetail() {
  graphicDetail.visible = false
  graphicDetail.detail = null
}

function handleGraphicDetailUpdate(patch: any) {
  const idx = currentIndex.value
  const origin = idx >= 0 && idx < props.items.length ? props.items[idx] : null
  if (!origin) return
  if (patch?.id && String(patch.id) !== String(origin.aweme_id)) return

  if (typeof patch?.isLoved === 'boolean') (origin as any).isLoved = patch.isLoved
  if (typeof patch?.isCollect === 'boolean') (origin as any).isCollect = patch.isCollect
  if (typeof patch?.isAttention === 'boolean') (origin as any).isAttention = patch.isAttention

  const interact = patch?.note_card?.interact_info || {}
  if ((origin as any).statistics) {
    if (interact.liked_count != null)
      (origin as any).statistics.digg_count = Number(interact.liked_count)
    if (interact.comment_count != null)
      (origin as any).statistics.comment_count = Number(interact.comment_count)
    if (interact.collect_count != null)
      (origin as any).statistics.collect_count = Number(interact.collect_count)
    if (interact.share_count != null)
      (origin as any).statistics.share_count = Number(interact.share_count)
  }

  // 同步当前 UI
  currentItemLocal.value = JSON.parse(JSON.stringify(origin))
  console.log('[VideoList] synced AlbumDetail update to feed item:', {
    id: origin.aweme_id,
    patch
  })
}

function stopVideo(slot: SlotState) {
  const video = slotRefs.get(slot.key)
  if (video) {
    video.pause()
  }
  if (slot.role === 'current') {
    isPlaying.value = false
  }
}

const containerRef = ref<HTMLDivElement>()
const currentIndex = ref(props.initialIndex)
const userRequestedSound = ref(!videoStore.isMuted)
const slots = reactive<SlotState[]>([
  {
    key: 'slotA',
    role: 'prev',
    videoIndex: props.initialIndex - 1 >= 0 ? props.initialIndex - 1 : null,
    muted: true,
    posterUrl: '',
    isPlaying: false
  },
  {
    key: 'slotB',
    role: 'current',
    videoIndex:
      props.items.length === 0 && !props.hasMore
        ? null
        : props.initialIndex < props.items.length
          ? props.initialIndex
          : null,
    muted: true,
    posterUrl: '',
    isPlaying: false
  },
  {
    key: 'slotC',
    role: 'next',
    videoIndex: props.initialIndex + 1 < props.items.length ? props.initialIndex + 1 : null,
    muted: true,
    posterUrl: '',
    isPlaying: false
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
  lastTime: 0,
  showTimeHint: false // 🎯 松手后短暂保留时间提示，避免一闪而过
})

const touch = reactive({
  startY: 0,
  deltaY: 0,
  active: false,
  threshold: 50 // 触发切换的阈值
})
let wheelLock = false
let wheelDeltaY = 0 // 🎯 累积的滚轮 deltaY（用于 Mac 触控板）
let wheelTimeout: number | null = null // 🎯 滚轮超时计时器
let wheelUnlockTime = 0 // 🎯 记录解锁时间，用于冷却期

// 🎯 滑动状态：实现跟手滑动和吸附效果
const slideState = reactive({
  offsetY: 0, // 当前滑动偏移量（px）
  isTransitioning: false, // 是否正在执行吸附动画
  startY: 0, // 触摸/鼠标起始位置
  startTime: 0, // 触摸/鼠标起始时间
  lastY: 0, // 上一次触摸/鼠标位置
  isMouseDragging: false // 鼠标是否正在拖动
})

// 计算 slide-container 的样式
const slideContainerStyle = computed(() => {
  return {
    transform: `translateY(${slideState.offsetY}px)`,
    transition: slideState.isTransitioning ? 'transform 350ms ease-out' : 'none'
  }
})

const currentItem = computed(() => props.items[currentIndex.value])
// ✅ 初始化时也要深拷贝，避免共享引用
const currentItemLocal = ref<VideoItem | null>(
  currentItem.value ? JSON.parse(JSON.stringify(currentItem.value)) : null
)
const isPlaying = ref(false)
const isPausedOverlay = computed(() => !isPlaying.value)

// 🎯 邀请链接
/*
const inviteLink = computed(() => {
  if (baseStore.userinfo.numeric_id) {
    return `https://t.me/dydy?start=${baseStore.userinfo.numeric_id}`
  }
  return ''
})
*/

// 🎯 复制邀请链接
// function copyInviteLink() {
//   if (inviteLink.value) {
//     _copy(inviteLink.value)
//   }
// }

// 🎯 分享邀请链接
// function shareInvite() {
//   if (!inviteLink.value) return
//   const botUsername = 'dydy'
//   const shareText = `@${botUsername}`
//   _copy(shareText)
//   _notice('分享指令已复制，去聊天框粘贴即可生成卡片～')
// }

// 🎯 当前内容类型
const currentContentType = computed(() => getContentType(currentItem.value))

// 🎯 是否是相册或合集类型（需要同步子组件进度）
const isAlbumLike = computed(() => {
  const t = currentContentType.value
  return t === 'album' || t === 'collection'
})

// 🎯 倍速播放：默认 1.0，仅对当前视频生效
const playbackRate = ref<number>(1)
function getCurrentVideoEl(): HTMLVideoElement | null {
  const currentSlot = getSlotByRole('current')
  if (!currentSlot) return null
  return slotRefs.get(currentSlot.key) || null
}
function applyPlaybackRate(rate: number) {
  const el = getCurrentVideoEl()
  if (!el) return
  try {
    el.playbackRate = rate
  } catch (e) {
    console.warn('[VideoList] 设置 playbackRate 失败:', e)
  }
}
function setPlaybackRate(rate: number) {
  const safe = [0.5, 1, 1.25, 1.5, 2].includes(rate) ? rate : 1
  playbackRate.value = safe
  applyPlaybackRate(safe)
}

// 🎯 获取 slot 对应的内容类型
function getSlotContentType(slot: SlotState): 'video' | 'image' | 'album' | 'collection' {
  if (slot.videoIndex == null) return 'video'
  const item = props.items[slot.videoIndex]
  // 🎯 如果 images 数组中包含视频，且类型是 album，则统一交由 AlbumSwiper 处理
  return getContentType(item)
}

// 🎯 获取视频填充模式
function getSlotVideoFit(slot: SlotState): 'contain' | 'cover' {
  if (slot.videoIndex == null) return 'contain'
  const item = props.items[slot.videoIndex]
  const { width, height } = item?.video || {}
  // 如果是横屏视频 (宽 > 高)，使用 contain 以免剪掉太多内容，上下留黑边是正常的
  // 如果是竖屏视频 (高 >= 宽)，使用 cover 以填充全屏，消除左右黑边
  if (width && height && width > height) {
    return 'contain'
  }
  return 'cover'
}

// 🎯 获取 slot 对应的图片数组
function getSlotImages(slot: SlotState): VideoItem['images'] {
  if (slot.videoIndex == null) return []
  const item = props.items[slot.videoIndex]
  // 🎯 同时检查 images 和 media_list 字段
  return parseImages(item?.images || (item as any)?.media_list)
}

// 🎯 图片/相册点击处理（可以用于暂停/恢复等交互）
function handleImageClick(slot: SlotState) {
  // 图片/相册点击时可以执行特定操作
  // 目前保持空实现，后续可以添加放大预览等功能
  console.log('[VideoList] Image clicked:', slot.key)
}

// 🎯 相册/合集滑到最后一张，记录完播
function handleAlbumComplete(slot: SlotState) {
  const item = slot.videoIndex != null ? props.items[slot.videoIndex] : null
  if (item?.aweme_id && !completedViews.has(item.aweme_id)) {
    completedViews.add(item.aweme_id)
    recordVideoView(item.aweme_id, { progress: 100, completed: true })
  }
}

// 🎯 为合辑视频提供进度条同步机制
const albumSync = reactive({
  currentTime: 0,
  duration: 0,
  onSeek: null as ((time: number) => void) | null
})

provide('albumSync', albumSync)

// 进度百分比
const progressPercent = computed(() => {
  if (isAlbumLike.value) {
    if (!albumSync.duration) return 0
    return Math.min(100, Math.max(0, (albumSync.currentTime / albumSync.duration) * 100))
  }
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
provide('playbackRate', playbackRate)
provide('setPlaybackRate', setPlaybackRate)

// 🎯 切换到新视频时，重置倍速为 1.0（仅对当前视频生效）
watch(
  () => currentItem.value?.aweme_id,
  (newId, oldId) => {
    if (newId && newId !== oldId) {
      setPlaybackRate(1)
    }
  }
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
        // error 事件：非 current 静默且清空 src，current 交给 play error 处理
        el.addEventListener('error', () => {
          const slot = slots.find((s) => s.key === key)
          const video = slotRefs.get(key)
          if (!slot || !video) return
          if (slot.role !== 'current') {
            video.removeAttribute('src')
            video.load()
            return
          }
          stopVideo(slot)
        })
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
  const idx = slot.videoIndex

  // 🎯 检查内容类型
  const contentType = getSlotContentType(slot)

  // 📸 图片/相册/合集类型：不需要处理外层视频容器
  if (contentType === 'image' || contentType === 'album' || contentType === 'collection') {
    slot.posterUrl = ''
    slot.isPlaying = false
    // 这些类型交由 ImageViewer 或 AlbumSwiper 处理，不需要外层视频元素，直接返回
    return
  }

  // 🎬 视频类型：正常处理
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

  if (idx == null || !props.items[idx]) {
    video.removeAttribute('src')
    video.load()
    slot.posterUrl = ''
    slot.isPlaying = false
    return
  }
  const item = props.items[idx]
  const url = item.video?.play_addr?.url_list?.[0]
  const poster = item.video?.cover?.url_list?.[0] || ''

  // 🎯 设置 poster URL 到 slot 状态
  slot.posterUrl = poster
  slot.isPlaying = false

  if (!url) {
    console.warn(`${DEBUG_PREFIX} source:empty`, { slot: slot.role, key: slot.key, idx })
  }
  if (url) {
    // 避免重复设置同一个 src 触发重新缓冲，导致切换时卡顿
    const resolvedUrl = new URL(url, window.location.href).href
    const isSameSrc = video.src === resolvedUrl

    if (!isSameSrc) {
      video.src = resolvedUrl
      if (poster) {
        video.poster = poster
      }
      // 非 current 只预加载元数据，减少无谓缓冲
      if (slot.role === 'current') {
        video.load()
      } else {
        video.preload = 'metadata'
      }
    }

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

  // 🎯 获取当前内容
  const contentType = getSlotContentType(slot)
  const item = slot.videoIndex != null ? props.items[slot.videoIndex] : null

  // 🔍 手机调试日志
  console.log('[DebugMobile] playCurrent called', {
    slotKey: slot.key,
    videoIndex: slot.videoIndex,
    itemExists: !!item,
    itemId: item?.aweme_id,
    contentType,
    recorded: item?.aweme_id ? recordedViews.has(item.aweme_id) : 'N/A'
  })

  // 🎯 记录进入 current（立即记录播放 + 设置完播计时器）
  console.log(`${DEBUG_PREFIX} 准备记录观看历史`, {
    id: item?.aweme_id,
    type: contentType,
    hasRecorded: item?.aweme_id ? recordedViews.has(item.aweme_id) : false
  })

  recordEnterCurrent(item, contentType)

  // 🎯 检查是否允许播放（autoplay 代表当前 Tab 是否处于激活状态）
  if (!props.autoplay) {
    console.log(`${DEBUG_PREFIX} playCurrent: 中止播放 - autoplay 为 false (Tab 可能不活跃)`)
    isPlaying.value = false
    return
  }

  // 🎯 图片/相册/合集类型不需要播放视频元素
  if (contentType === 'image' || contentType === 'album' || contentType === 'collection') {
    console.log(`${DEBUG_PREFIX} playCurrent:skip-non-video`, { contentType })
    isPlaying.value = true // 这些类型默认显示为"播放中"状态
    return
  }

  const video = slotRefs.get(slot.key)
  if (!video) {
    console.warn(`${DEBUG_PREFIX} playCurrent:no-video`, { slot: slot.role, key: slot.key })
    return
  }

  // 🛡️ 避免空 src 或不支持的源导致 NotSupportedError
  if (!video.src) {
    console.warn(`${DEBUG_PREFIX} play:skip-no-src`, {
      slotKey: slot.key,
      videoIndex: slot.videoIndex,
      role: slot.role
    })
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
      handlePlayError(slot, err)
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
  // 🎯 如果已经在最后一个视频，强制触发加载，但不允许继续向下轮转空槽位
  if (currentIndex.value >= props.items.length - 1) {
    console.log('[VideoList] 已到达最后一条，请求追载新内容...')
    emit('loadMore')
    return
  }

  // 🎯 离开当前视频，清除完播计时器
  recordLeaveCurrent()

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

  currentIndex.value += 1
  emit('update:index', currentIndex.value)

  // 🎯 如果滑到了"没有更多"页面，不更新视频相关状态
  const nextItem = props.items[currentIndex.value]
  if (nextItem) {
    videoStore.setCurrentVideo(nextItem, currentIndex.value)
    videoStore.setCurrentPlaying(nextItem.aweme_id, props.page)
    // ✅ 深拷贝确保每个视频的统计数据独立
    currentItemLocal.value = JSON.parse(JSON.stringify(nextItem))
  } else {
    // 滑到了"没有更多"页面
    currentItemLocal.value = null
  }

  prev.videoIndex = currentIndex.value + 1 < props.items.length ? currentIndex.value + 1 : null
  updateSlotSource(prev, true)
  updateSlotSource(next)

  console.log('[视频切换] 切换到下一个 END', {
    newIndex: currentIndex.value,
    isNoMorePage: !nextItem,
    timestamp: Date.now()
  })

  if (currentIndex.value >= props.items.length - 3 && currentIndex.value < props.items.length) {
    emit('loadMore')
  }

  // 🎯 强制记录观看历史（针对图片/相册/合集），防止 playCurrent 未及时执行
  if (nextItem) {
    const type = getContentType(nextItem)
    if (type === 'image' || type === 'album' || type === 'collection') {
      console.log(`${DEBUG_PREFIX} rotateToNext: 强制记录图片/相册/合集历史`, {
        id: nextItem.aweme_id
      })
      recordEnterCurrent(nextItem, type)
    }
  }
}

function rotateToPrev() {
  if (currentIndex.value <= 0) return

  // 🎯 离开当前视频，清除完播计时器
  recordLeaveCurrent()

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

  // 🎯 强制记录观看历史（针对图片/相册/合集）
  const currentItem = props.items[currentIndex.value]
  if (currentItem) {
    const type = getContentType(currentItem)
    if (type === 'image' || type === 'album' || type === 'collection') {
      console.log(`${DEBUG_PREFIX} rotateToPrev: 强制记录图片/相册/合集历史`, {
        id: currentItem.aweme_id
      })
      recordEnterCurrent(currentItem, type)
    }
  }

  console.log('[视频切换] 切换到上一个 END', {
    newIndex: currentIndex.value,
    timestamp: Date.now()
  })
}

// 🎯 触摸开始：记录起始位置和时间
function onTouchStart(e: TouchEvent) {
  if (videoStore.showComments) return
  if (slideState.isTransitioning) return // 动画中不响应

  touch.active = true
  const clientY = e.touches[0].clientY
  slideState.startY = clientY
  slideState.lastY = clientY
  slideState.startTime = Date.now()
}

// 🎯 触摸移动：实时跟手更新 offsetY
function onTouchMove(e: TouchEvent) {
  if (videoStore.showComments) return
  if (!touch.active) return
  if (slideState.isTransitioning) return

  const clientY = e.touches[0].clientY
  const deltaY = clientY - slideState.startY

  // 🎯 实时更新偏移量（跟手）
  slideState.offsetY = deltaY
  slideState.lastY = clientY
}

// 🎯 触摸结束：判断是否切换，执行吸附动画
function onTouchEnd() {
  if (videoStore.showComments) return
  if (!touch.active) return

  touch.active = false

  const deltaY = slideState.offsetY
  const deltaTime = Date.now() - slideState.startTime
  const velocity = Math.abs(deltaY) / deltaTime // px/ms

  // 获取屏幕高度
  const screenHeight = window.innerHeight

  // 🎯 判断是否切换视频
  // 条件1: 滑动距离 > 30% 屏幕高度
  // 条件2: 快速滑动（速度 > 0.5 px/ms）且距离 > 20% 屏幕高度
  const threshold30 = screenHeight * 0.3
  const threshold20 = screenHeight * 0.2
  const isFastSwipe = velocity > 0.5

  let shouldSwitch = false
  let direction: 'next' | 'prev' | null = null

  if (deltaY < 0) {
    // 向上滑（切换到下一个）
    if (Math.abs(deltaY) > threshold30 || (isFastSwipe && Math.abs(deltaY) > threshold20)) {
      shouldSwitch = true
      direction = 'next'
    }
  } else if (deltaY > 0) {
    // 向下滑（切换到上一个）
    if (Math.abs(deltaY) > threshold30 || (isFastSwipe && Math.abs(deltaY) > threshold20)) {
      shouldSwitch = true
      direction = 'prev'
    }
  }

  if (shouldSwitch && direction) {
    // 🎯 执行切换
    // 如果没有更多数据，允许滑动到 items.length 位置（即 no-more 页面）
    const maxIndex = props.hasMore ? props.items.length - 1 : props.items.length

    if (direction === 'next' && currentIndex.value < maxIndex) {
      snapToNext()
    } else if (direction === 'prev' && currentIndex.value > 0) {
      snapToPrev()
    } else {
      // 到头了，弹回
      snapBack()
    }
  } else {
    // 🎯 不切换，弹回当前位置
    snapBack()
  }
}

// 🎯 鼠标按下：记录起始位置
function onMouseDown(e: MouseEvent) {
  if (videoStore.showComments) return
  if (slideState.isTransitioning) return

  slideState.isMouseDragging = true
  const clientY = e.clientY
  slideState.startY = clientY
  slideState.lastY = clientY
  slideState.startTime = Date.now()
}

// 🎯 鼠标移动：实时跟手更新 offsetY
function onMouseMove(e: MouseEvent) {
  if (videoStore.showComments) return
  if (!slideState.isMouseDragging) return
  if (slideState.isTransitioning) return

  const clientY = e.clientY
  const deltaY = clientY - slideState.startY

  // 🎯 实时更新偏移量（跟手）
  slideState.offsetY = deltaY
  slideState.lastY = clientY
}

// 🎯 鼠标松开/离开：判断是否切换，执行吸附动画
function onMouseUp() {
  if (videoStore.showComments) return
  if (!slideState.isMouseDragging) return

  slideState.isMouseDragging = false

  const deltaY = slideState.offsetY
  const deltaTime = Date.now() - slideState.startTime
  const velocity = Math.abs(deltaY) / deltaTime // px/ms

  // 获取屏幕高度
  const screenHeight = window.innerHeight

  // 🎯 判断是否切换视频（与触摸逻辑相同）
  const threshold30 = screenHeight * 0.3
  const threshold20 = screenHeight * 0.2
  const isFastSwipe = velocity > 0.5

  let shouldSwitch = false
  let direction: 'next' | 'prev' | null = null

  if (deltaY < 0) {
    // 向上滑（切换到下一个）
    if (Math.abs(deltaY) > threshold30 || (isFastSwipe && Math.abs(deltaY) > threshold20)) {
      shouldSwitch = true
      direction = 'next'
    }
  } else if (deltaY > 0) {
    // 向下滑（切换到上一个）
    if (Math.abs(deltaY) > threshold30 || (isFastSwipe && Math.abs(deltaY) > threshold20)) {
      shouldSwitch = true
      direction = 'prev'
    }
  }

  if (shouldSwitch && direction) {
    // 🎯 执行切换
    // 如果没有更多数据，允许滑动到 items.length 位置（即 no-more 页面）
    const maxIndex = props.hasMore ? props.items.length - 1 : props.items.length

    if (direction === 'next' && currentIndex.value < maxIndex) {
      snapToNext()
    } else if (direction === 'prev' && currentIndex.value > 0) {
      snapToPrev()
    } else {
      // 到头了，弹回
      snapBack()
    }
  } else {
    // 🎯 不切换，弹回当前位置
    snapBack()
  }
}

// 🎯 滚轮事件：支持鼠标滚轮和 Mac 触控板
function onWheel(e: WheelEvent) {
  const now = Date.now()
  const timeSinceUnlock = now - wheelUnlockTime

  if (wheelLock) {
    // 🎯 在锁定期间，重置累积值，防止累积后跳2个
    wheelDeltaY = 0
    if (wheelTimeout) {
      clearTimeout(wheelTimeout)
      wheelTimeout = null
    }
    return
  }

  // 🎯 冷却期：解锁后 400ms 内忽略惯性滚动
  if (wheelUnlockTime > 0 && timeSinceUnlock < 400) {
    wheelDeltaY = 0
    if (wheelTimeout) {
      clearTimeout(wheelTimeout)
      wheelTimeout = null
    }
    return
  }

  if (slideState.isTransitioning) return

  const deltaY = e.deltaY
  const threshold = touch.threshold

  // 🎯 累积 deltaY（用于 Mac 触控板的小幅度滑动）
  wheelDeltaY += deltaY

  // 清除之前的超时，重新开始计时
  if (wheelTimeout) {
    clearTimeout(wheelTimeout)
  }

  // 150ms 内没有新的滚轮事件，重置累积值
  wheelTimeout = window.setTimeout(() => {
    wheelDeltaY = 0
  }, 150)

  // 判断是否达到阈值
  if (Math.abs(wheelDeltaY) > threshold) {
    const maxIndex = props.hasMore ? props.items.length - 1 : props.items.length
    if (wheelDeltaY > 0 && currentIndex.value < maxIndex) {
      // 向下滚动（切换到下一个）
      wheelLock = true
      wheelDeltaY = 0 // 重置累积值
      if (wheelTimeout) {
        clearTimeout(wheelTimeout)
        wheelTimeout = null
      }
      snapToNext()
      // 等待动画完成后再解锁（350ms 动画 + 50ms 缓冲）
      setTimeout(() => {
        wheelLock = false
        wheelUnlockTime = Date.now() // 🎯 记录解锁时间
      }, 400)
    } else if (wheelDeltaY < 0 && currentIndex.value > 0) {
      // 向上滚动（切换到上一个）
      wheelLock = true
      wheelDeltaY = 0 // 重置累积值
      if (wheelTimeout) {
        clearTimeout(wheelTimeout)
        wheelTimeout = null
      }
      snapToPrev()
      // 等待动画完成后再解锁
      setTimeout(() => {
        wheelLock = false
        wheelUnlockTime = Date.now() // 🎯 记录解锁时间
      }, 400)
    }
  }
}

// 🎯 吸附到下一个视频（新方案：动画开始时就轮转）
function snapToNext() {
  // 🎯 先轮转 slot，然后从 100vh 位置开始动画
  const currentOffsetY = slideState.offsetY
  rotateToNext()

  // 轮转后，新的 current 在 100vh 下方，我们需要把它移到正确位置
  slideState.offsetY = currentOffsetY + window.innerHeight

  // 🎯 检查下一个视频的内容类型
  const nextSlot = getSlotByRole('current')
  const nextContentType = nextSlot ? getSlotContentType(nextSlot) : 'video'
  const isNonVideoContent =
    nextContentType === 'image' || nextContentType === 'album' || nextContentType === 'collection'

  // 🎯 如果是图文/相册/合辑，需要等待组件渲染完成后再执行动画
  if (isNonVideoContent) {
    // 等待 DOM 更新和组件渲染
    nextTick(() => {
      // 再等待一帧确保组件完全渲染
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          slideState.isTransitioning = true
          slideState.offsetY = 0

          // 动画结束后关闭 transition
          setTimeout(() => {
            slideState.isTransitioning = false
          }, 350)
        })
      })
    })
  } else {
    // 视频类型，只需要等待一帧确保 DOM 更新
    requestAnimationFrame(() => {
      slideState.isTransitioning = true
      slideState.offsetY = 0

      // 动画结束后关闭 transition
      setTimeout(() => {
        slideState.isTransitioning = false
      }, 350)
    })
  }
}

// 🎯 吸附到上一个视频（新方案：动画开始时就轮转）
function snapToPrev() {
  // 🎯 先轮转 slot，然后从 -100vh 位置开始动画
  const currentOffsetY = slideState.offsetY
  rotateToPrev()

  // 轮转后，新的 current 在 -100vh 上方，我们需要把它移到正确位置
  slideState.offsetY = currentOffsetY - window.innerHeight

  // 🎯 检查上一个视频的内容类型
  const prevSlot = getSlotByRole('current')
  const prevContentType = prevSlot ? getSlotContentType(prevSlot) : 'video'
  const isNonVideoContent =
    prevContentType === 'image' || prevContentType === 'album' || prevContentType === 'collection'

  // 🎯 如果是图文/相册/合辑，需要等待组件渲染完成后再执行动画
  if (isNonVideoContent) {
    // 等待 DOM 更新和组件渲染
    nextTick(() => {
      // 再等待一帧确保组件完全渲染
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          slideState.isTransitioning = true
          slideState.offsetY = 0

          // 动画结束后关闭 transition
          setTimeout(() => {
            slideState.isTransitioning = false
          }, 350)
        })
      })
    })
  } else {
    // 视频类型，只需要等待一帧确保 DOM 更新
    requestAnimationFrame(() => {
      slideState.isTransitioning = true
      slideState.offsetY = 0

      // 动画结束后关闭 transition
      setTimeout(() => {
        slideState.isTransitioning = false
      }, 350)
    })
  }
}

// 🎯 弹回当前位置
function snapBack() {
  slideState.isTransitioning = true
  slideState.offsetY = 0

  setTimeout(() => {
    slideState.isTransitioning = false
  }, 350)
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
  (newLen, oldLen) => {
    // 💡 重点：如果列表从 0 变为有数据，且当前 slot 为空，立即填充并播放
    if (newLen > 0 && oldLen === 0) {
      const currentSlot = getSlotByRole('current')
      if (currentSlot && currentSlot.videoIndex === null) {
        console.log('[VideoList] 🚀 数据延迟到达，立即填充 SlotB')
        currentIndex.value = 0
        currentSlot.videoIndex = 0
        updateSlotSource(currentSlot)

        // 预载 next
        const nextSlot = getSlotByRole('next')
        if (nextSlot && props.items.length > 1) {
          nextSlot.videoIndex = 1
          updateSlotSource(nextSlot, true)
        }
      }
    }

    const nextSlot = getSlotByRole('next')
    if (nextSlot && nextSlot.videoIndex == null && currentIndex.value + 1 < props.items.length) {
      nextSlot.videoIndex = currentIndex.value + 1
      updateSlotSource(nextSlot, true)
    }
    // 🎯 当 items 为空且 hasMore 为 false 时，更新 slotB 显示 no-more-page
    const currentSlot = getSlotByRole('current')
    if (currentSlot && props.items.length === 0 && !props.hasMore) {
      currentSlot.videoIndex = null
    }
  }
)

// 🎯 监听 hasMore 变化，当 items 为空且 hasMore 变为 false 时，显示 no-more-page
watch(
  () => props.hasMore,
  () => {
    const currentSlot = getSlotByRole('current')
    if (currentSlot && props.items.length === 0 && !props.hasMore) {
      currentSlot.videoIndex = null
    }
  }
)

// 🎯 监听播放激活状态（Tab 切换）
watch(
  () => props.autoplay,
  (val) => {
    console.log(`${DEBUG_PREFIX} watch:autoplay changed`, val)
    if (val) {
      playCurrent()
    } else {
      slotRefs.forEach((v) => {
        if (!v.paused) {
          v.pause()
          console.log(`${DEBUG_PREFIX} autoplay=false, 暂停视频`)
        }
      })
      isPlaying.value = false
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

  // 🎯 onPlay 不隐藏 poster，等待 onPlaying 事件

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

// 🎯 视频真正开始播放（有画面输出）
function onPlaying(slot: SlotState) {
  // 🎯 视频真正播放时，隐藏 poster
  slot.isPlaying = true
  // 🎯 同步倍速到“当前视频”
  if (slot.role === 'current') {
    applyPlaybackRate(playbackRate.value)
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

  // 🎯 暂停时不显示 poster（避免暂停时出现缩略图）

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

function handlePlayError(slot: SlotState, err: any) {
  const video = slotRefs.get(slot.key)
  console.warn(`${DEBUG_PREFIX} play:error`, {
    id: slot.videoIndex != null ? props.items[slot.videoIndex]?.aweme_id?.substring(0, 8) : 'none',
    page: props.page,
    error: err?.name
  })

  // 去掉自动重试：出错后停止当前的播放尝试，保持当前索引，等待用户滑动或手动操作
  if (video) {
    video.pause()
    // 清空 src 避免浏览器继续重试
    video.removeAttribute('src')
    video.load()
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

// 进度条拖动
let isDragging = false
let timeHintTimer: number | null = null

function handleProgressStart(e: PointerEvent) {
  const isAlbum = isAlbumLike.value
  const video = getCurrentVideo()
  const track = progressRef.value
  if ((!isAlbum && !video) || !track) return

  isDragging = true
  playState.isMoving = true
  playState.showTimeHint = true

  if (timeHintTimer) {
    clearTimeout(timeHintTimer)
    timeHintTimer = null
  }

  if (!isAlbum && video) video.pause()

  updateProgressFromPointer(e, track)

  const onMove = (ev: PointerEvent) => {
    if (!isDragging) return
    ev.preventDefault()
    updateProgressFromPointer(ev, track)
  }

  const onEnd = () => {
    isDragging = false
    playState.isMoving = false

    if (isAlbum) {
      // 🎯 如果是合辑，通知子组件 seek
      if (albumSync.onSeek) {
        albumSync.onSeek(albumSync.currentTime)
      }
    } else if (video) {
      video.currentTime = playState.currentTime
      video.play().catch(() => {})
    }

    // 🎯 松手后延迟隐藏时间提示，避免一闪而逝
    timeHintTimer = window.setTimeout(() => {
      playState.showTimeHint = false
      timeHintTimer = null
    }, 300)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onEnd)
    window.removeEventListener('pointercancel', onEnd)
  }

  window.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onEnd)
  window.addEventListener('pointercancel', onEnd)
}

function updateProgressFromPointer(e: PointerEvent, track: HTMLElement) {
  const rect = track.getBoundingClientRect()
  const x = e.clientX - rect.left
  const percent = Math.max(0, Math.min(1, x / rect.width))

  if (isAlbumLike.value) {
    albumSync.currentTime = percent * albumSync.duration
  } else {
    playState.currentTime = percent * playState.duration
  }
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
  min-height: 200px; // ✅ 增加最小高度兜底，防止加载瞬间塌陷
}

.tri-video-list.comments-open {
  z-index: 200;
  overscroll-behavior: contain;
  touch-action: auto; // 允许评论区域自身滚动
  overflow: visible; // 避免评论弹层被父容器裁剪
}

// 🖼️ 推荐流图文详情弹层（teleport to body）
.graphic-detail-shadow {
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: calc(var(--vh, 1vh) * 100);
  background: #000;
  z-index: 99999;
  overflow: hidden;

  // ✅ AlbumDetail 默认 .goods-detail opacity=0（用于 Community 的开启动画）
  // 推荐页直接渲染时没有动画逻辑，会导致“黑屏”，这里强制显示
  :deep(.goods-detail) {
    opacity: 1 !important;
  }
}

// 🎯 滑动容器：整体移动
.slide-container {
  position: relative;
  width: 100%;
  height: 100%;
  will-change: transform;
  // 🎯 强制 GPU 渲染，解决 Windows 上图片切换无动画问题
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  transform-style: preserve-3d;
}

.slot {
  position: absolute;
  left: 0;
  width: 100%;
  height: 100%;
  // 🎯 强制 GPU 渲染，解决 Windows 上图片切换无动画问题
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  transform-style: preserve-3d;
  overflow: hidden;

  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  // 🎯 自定义 poster 层：视频加载时显示缩略图
  .video-poster {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-position: center;
    background-repeat: no-repeat;
    background-color: #000;
    z-index: 1;
    pointer-events: none;
  }
}

// 新的进度条样式
.video-progress {
  position: absolute;
  bottom: -7px; // 🎯 向上移动一点，确保不被文字挡住，且在屏幕可见范围内
  left: 0;
  right: 0;
  z-index: 1000; // 🎯 绝对置顶，确保在描述文字上方
  pointer-events: auto;
  padding: 15px 0 10px 0; // 🎯 调整点击区域

  .progress-time {
    position: absolute;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 20px;
    font-weight: 600;
    color: white;
    background: rgba(0, 0, 0, 0.75);
    padding: 8px 18px;
    border-radius: 20px;
    white-space: nowrap;
    z-index: 1001;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }

  .progress-track {
    position: relative;
    width: calc(100% - 30px); // 🎯 留点边距
    margin: 0 15px;
    height: 2px; // 🎯 保持细长风格
    background: rgba(255, 255, 255, 0.2);
    cursor: pointer;
    overflow: visible; // 🎯 确保圆点不被剪裁

    &:hover {
      height: 3px;
    }
  }

  .progress-bar {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    background: #fe2c55;
    transition: width 0.1s linear;
  }

  .progress-thumb {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    background: white; // 🎯 白色圆点更显眼
    border-radius: 50%;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
    opacity: 1; // 🎯 始终显示
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

// 🎯 overlay：现在在 slide-container 里，会跟随整体移动
.overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0; // 覆盖整个区域
  z-index: 50; // 提高层级，确保进度条和时间提示在最上层
  pointer-events: none;

  > * {
    pointer-events: auto;
  }
}

// 🎯 没有更多页面样式
.no-more-page {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%);

  .no-more-icon {
    font-size: 64px;
    margin-bottom: 20px;
    animation: float 3s ease-in-out infinite;
  }

  .no-more-text {
    font-size: 18px;
    color: rgba(255, 255, 255, 0.9);
    margin: 0 0 8px 0;
  }

  .no-more-subtext {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.5);
    margin: 0;
    white-space: pre-line; // 支持多行规则展示
  }

  .copy-invite-btn {
    margin-top: 30px;
    background: #fe2c55;
    color: white;
    padding: 12px 40px;
    border-radius: 25px;
    font-size: 14px;
    font-weight: bold;
    border: none;
    cursor: pointer;
    transition: opacity 0.2s;
    min-width: 200px;
  }

  .copy-invite-btn:active {
    opacity: 0.8;
  }

  .share-invite-btn {
    margin-top: 30px;
    background: #ff6b00;
    color: white;
    padding: 12px 40px;
    border-radius: 25px;
    font-size: 14px;
    font-weight: bold;
    border: none;
    cursor: pointer;
    transition: opacity 0.2s;
    min-width: 200px;
  }

  .share-invite-btn:active {
    opacity: 0.85;
  }

  @keyframes float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-10px);
    }
  }
}
</style>
