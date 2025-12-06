<template>
  <div 
    class="video-wrapper" 
    ref="videoWrapper" 
    :class="positionName"
  >
    <!-- ✅ Loading 加载中提示 -->
    <Loading v-if="state.loading" style="position: absolute; z-index: 10;" />
    <!-- ✅ 加载文字提示（可选，让用户更清楚） -->
    <div v-if="state.loading" class="loading-text">加载中...</div>
    <!--    <video :src="item.video + '?v=123'"-->
    <video
      :poster="poster"
      ref="videoEl"
      :muted="state.isMuted"
      preload="auto"
      loop
      x5-video-player-type="h5-page"
      :x5-video-player-fullscreen="false"
      :webkit-playsinline="true"
      :x5-playsinline="true"
      :playsinline="true"
      :fullscreen="false"
      :autoplay="isPlay"
    >
      <source
        v-for="(urlItem, index) in item.video.play_addr.url_list"
        :key="index"
        :src="urlItem"
        type="video/mp4"
        @error="handleVideoError"
      />
      <p>您的浏览器不支持 video 标签。</p>
    </video>
    <Icon icon="fluent:play-28-filled" class="pause-icon" v-if="!isPlaying" />
    <div 
      class="float" 
      @click="handleVideoClick"
      @touchend="handleVideoClick"
      style="pointer-events: auto; z-index: 1;"
    >
      <template v-if="isLive">
        <div class="living">点击进入直播间</div>
        <ItemDesc :is-live="true" v-model:item="state.localItem" :position="position" />
      </template>
      <template v-else>
        <div :style="{ opacity: state.isMove ? 0 : 1 }" class="normal">
          <template v-if="!state.commentVisible">
            <ItemToolbar v-model:item="state.localItem" />
            <ItemDesc v-model:item="state.localItem" />
          </template>
          <div v-if="isMy" class="comment-status">
            <div class="comment">
              <div class="type-comment">
                <img src="../../assets/img/icon/head-image.jpeg" alt="" class="avatar" />
                <div class="right">
                  <p>
                    <span class="name">zzzzz</span>
                    <span class="time">2020-01-20</span>
                  </p>
                  <p class="text">北京</p>
                </div>
              </div>
              <transition-group name="comment-status" tag="div" class="loveds">
                <div class="type-loved" :key="i" v-for="i in state.test">
                  <img src="../../assets/img/icon/head-image.jpeg" alt="" class="avatar" />
                  <img src="../../assets/img/icon/love.svg" alt="" class="loved" />
                </div>
              </transition-group>
            </div>
          </div>
        </div>
        <!-- 进度条触摸热区容器（大面积，方便拖动） -->
        <div 
          class="progress-container"
          @pointerdown.stop.prevent="handleProgressPointerDown"
          @pointermove.stop.prevent="handleProgressPointerMove"
          @pointerup.stop.prevent="handleProgressPointerUp"
        >
          <div
            class="progress"
            :class="progressClass"
            ref="progressEl"
          >
            <div class="time" v-if="state.isMove">
              <span class="currentTime">{{ _duration(state.currentTime) }}</span>
              <span class="duration"> / {{ _duration(state.duration) }}</span>
            </div>
            <template v-if="state.duration > 15 || state.isMove || !isPlaying">
              <div class="bg"></div>
              <div class="progress-line" :style="durationStyle"></div>
              <div class="point"></div>
            </template>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { _checkImgUrl, _duration, _notice, _stopPropagation, cloneDeep } from '@/utils'
import Loading from '../Loading.vue'
import ItemToolbar from './ItemToolbar.vue'
import ItemDesc from './ItemDesc.vue'
import bus, { EVENT_KEY } from '../../utils/bus'
import { SlideItemPlayStatus } from '@/utils/const_var'
import { computed, onMounted, onUnmounted, onUpdated, provide, reactive, watch } from 'vue'
import { _css } from '@/utils/dom'
import { Icon } from '@iconify/vue'
import { toggleVideoLike } from '@/api/videos'
import { videoPlaybackManager } from '@/utils/videoPlaybackManager'
import { useVideoStore } from '@/stores/video'

defineOptions({
  name: 'BaseVideo'
})

const props = defineProps({
  item: {
    type: Object,
    default: () => {
      return {}
    }
  },
  position: {
    type: Object,
    default: () => {
      return {}
    }
  },
  //用于第一条数据，自动播放，如果都用事件去触发播放，有延迟
  isPlay: {
    type: Boolean,
    default: () => {
      return true
    }
  },
  isMy: {
    type: Boolean,
    default: () => {
      return false
    }
  },
  isLive: {
    type: Boolean,
    default: () => {
      return false
    }
  }
})

const videoStore = useVideoStore()

const positionState = computed(() => props.position)
provide(
  'isPlaying',
  computed(() => isPlaying)
)
provide(
  'isMuted',
  computed(() => state.isMuted)
)
provide('position', positionState)
provide(
  'item',
  computed(() => props.item)
)

const videoEl = $ref<HTMLVideoElement>()
const progressEl = $ref<HTMLDivElement>()
const initialMuted = typeof window.isMuted === 'boolean' ? window.isMuted : true
if (window.isMuted === undefined) {
  window.isMuted = initialMuted
}

let state = reactive({
  loading: false,
  loadingHidden: false, // ✅ 标记 loading 是否已隐藏
  paused: false,
  isMuted: initialMuted,
  status: props.isPlay ? SlideItemPlayStatus.Play : SlideItemPlayStatus.Pause,
  duration: 0,
  step: 0,
  currentTime: -1,
  playX: 0,
  start: { x: 0, y: 0 },
  last: { x: 0, time: 0 },
  height: 0,
  width: 0,
  isMove: false,
  ignoreWaiting: false, //忽略waiting事件。因为改变进度会触发waiting事件，烦的一批
  test: [1, 2],
  localItem: props.item,
  progressBarRect: {
    height: 0,
    width: 0
  },
  videoScreenHeight: 0,
  commentVisible: false
})
let likeLoading = false
const DOUBLE_TAP_THRESHOLD = 280
let lastTapTime = 0
let touchTimer: number | null = null

function syncLocalItemState() {
  const snapshot = cloneDeep(state.localItem)
  bus.emit(EVENT_KEY.UPDATE_ITEM, { position: positionState.value, item: snapshot })
}
watch(
  () => props.item,
  (val) => {
    state.localItem = val
  },
  { immediate: true }
)
watch(
  () => window.isMuted,
  (val) => {
    if (videoEl) {
      // 同步全局静音状态到当前视频
      state.isMuted = val
      videoEl.muted = val
    }
  }
)
const poster = $computed(() => {
  return _checkImgUrl(props.item.video.poster ?? props.item.video.cover.url_list[0])
})
const durationStyle = $computed(() => {
  return { width: state.playX + 'px' }
})
const isPlaying = $computed(() => {
  return state.status === SlideItemPlayStatus.Play
})
const positionName = $computed(() => {
  return 'item-' + Object.values(props.position).join('-')
})
const progressClass = $computed(() => {
  if (state.isMove) {
    return 'move'
  } else {
    return isPlaying ? '' : 'stop'
  }
})

// ✅ 方案 C：每个视频有独立 DOM，不需要 watch aweme_id
// props.item 不会变化，因为 DOM 不会被复用

onMounted(() => {
  
  state.height = document.body.clientHeight
  state.width = document.body.clientWidth
  if (videoEl) {
    videoEl.currentTime = 0
  }
  
  let fun = (e) => {
    state.currentTime = Math.ceil(e.target.currentTime)
    state.playX = (state.currentTime - 1) * state.step
  }
  videoEl.addEventListener('loadedmetadata', () => {
    if (!videoEl) return
    state.videoScreenHeight = videoEl.videoHeight / (videoEl.videoWidth / state.width)
    state.duration = videoEl.duration
    if (progressEl) {
      state.progressBarRect = progressEl.getBoundingClientRect()
      state.step = state.progressBarRect.width / Math.floor(state.duration)
    }
    videoEl.addEventListener('timeupdate', fun)
  })

  let eventTester = (e, t: string) => {
    videoEl.addEventListener(
      e,
      () => {
        // console.log('eventTester', e, state.item.aweme_id)
        if (e === 'waiting') {
          if (!state.paused && !state.ignoreWaiting) {
            state.loading = true
            state.loadingHidden = false  // 重置标志，因为需要重新缓冲
          }
        }
        let s = false
        if (s) {
          // event logged
        }
      },
      false
    )
  }

  // eventTester("loadstart", '客户端开始请求数据'); //客户端开始请求数据
  // eventTester("abort", '客户端主动终止下载（不是因为错误引起）'); //客户端主动终止下载（不是因为错误引起）
  // eventTester("loadstart", '客户端开始请求数据'); //客户端开始请求数据
  // eventTester("progress", '客户端正在请求数据'); //客户端正在请求数据
  // // eventTester("suspend", '延迟下载'); //延迟下载
  // eventTester("abort", '客户端主动终止下载（不是因为错误引起），'); //客户端主动终止下载（不是因为错误引起），
  // eventTester("error", '请求数据时遇到错误'); //请求数据时遇到错误
  // eventTester("stalled", '网速失速'); //网速失速
  // eventTester("play", 'play()和autoplay开始播放时触发'); //play()和autoplay开始播放时触发
  // eventTester("pause", 'pause()触发'); //pause()触发
  // eventTester("loadedmetadata", '成功获取资源长度'); //成功获取资源长度
  // eventTester("loadeddata"); //
  eventTester('waiting', '等待数据，并非错误') //等待数据，并非错误
  // ✅ 监听 playing 事件，但不立即隐藏 loading
  videoEl.addEventListener('playing', () => {
    // playing 事件表示视频开始播放，但画面可能还没渲染
    // 继续等待 timeupdate 确认
  })
  
  // ✅ 监听 timeupdate，确保画面真正开始播放后才隐藏 loading
  videoEl.addEventListener('timeupdate', () => {
    // 只有当视频时间>0.1秒且正在播放时，才隐藏 loading
    if (!state.loadingHidden && videoEl.currentTime > 0.1 && !videoEl.paused) {
      state.loading = false
      state.loadingHidden = true
      // 视频开始播放，隐藏 loading
    }
  })
  
  // ✅ 当视频暂停或跳转时，重置标志
  videoEl.addEventListener('pause', () => {
    state.loadingHidden = false
  })
  
  videoEl.addEventListener('seeking', () => {
    state.loadingHidden = false
  })
  // eventTester("canplay", '/可以播放，但中途可能因为加载而暂停'); //可以播放，但中途可能因为加载而暂停
  // eventTester("canplaythrough", '可以播放，歌曲全部加载完毕'); //可以播放，歌曲全部加载完毕
  // eventTester("seeking", '寻找中'); //寻找中
  // eventTester("seeked", '寻找完毕'); //寻找完毕
  // // eventTester("timeupdate",'播放时间改变'); //播放时间改变
  // eventTester("ended", '播放结束'); //播放结束
  // eventTester("ratechange", '播放速率改变'); //播放速率改变
  // eventTester("durationchange", '资源长度改变'); //资源长度改变
  // eventTester("volumechange", '音量改变'); //音量改变

  // console.log('mounted')
  // bus.off('singleClickBroadcast')
  bus.on(EVENT_KEY.SINGLE_CLICK_BROADCAST, click)
  bus.on(EVENT_KEY.DIALOG_MOVE, onDialogMove)
  bus.on(EVENT_KEY.DIALOG_END, onDialogEnd)
  bus.on(EVENT_KEY.OPEN_COMMENTS, onOpenComments)
  bus.on(EVENT_KEY.CLOSE_COMMENTS, onCloseComments)
  bus.on(EVENT_KEY.OPEN_SUB_TYPE, onOpenSubType)
  bus.on(EVENT_KEY.CLOSE_SUB_TYPE, onCloseSubType)

  bus.on(EVENT_KEY.REMOVE_MUTED, removeMuted)
  bus.on(EVENT_KEY.ADD_MUTED, addMuted)
  
  // 监听视频加载错误（303等网络错误）
  if (videoEl) {
    videoEl.addEventListener('error', handleVideoError)
  }
  
  // 预加载视频 - 在元素挂载后立即开始加载
  if (videoEl && videoEl.readyState === 0) {
    videoEl.load()
  }
  
  // ✅ 如果是第一个视频（isPlay=true），设置 currentVideo 并调用 play()
  if (props.isPlay && state.localItem) {
    videoStore.setCurrentVideo(state.localItem as any, (props.position as any)?.index)
    // ⏳ 延迟一帧后播放，确保 DOM 完全准备好
    requestAnimationFrame(() => {
      play()
    })
  }
})

// 处理视频加载错误
let errorRetryCount = 0
const MAX_ERROR_RETRY = 1

function handleVideoError(e: Event) {
  const target = e.target as HTMLVideoElement | HTMLSourceElement
  const isSourceError = target.tagName === 'SOURCE'
  
  console.error('[video] ❌ 加载错误', {
    videoId: props.item.aweme_id?.substring(0, 8),
    errorType: isSourceError ? 'SOURCE元素错误' : 'VIDEO元素错误',
    target: target.tagName,
    src: target.src?.substring(target.src.length - 40) || '无',
    readyState: videoEl?.readyState,
    networkState: videoEl?.networkState,
    error: videoEl?.error,
    errorCode: videoEl?.error?.code,
    errorMessage: videoEl?.error?.message,
    errorRetryCount,
    allSources: Array.from(videoEl?.querySelectorAll('source') || []).map(s => ({
      src: s.src.substring(s.src.length - 30),
      type: s.type
    }))
  })
  
  // 303等网络错误，尝试重新加载一次
  if (errorRetryCount < MAX_ERROR_RETRY && videoEl) {
    errorRetryCount++
    console.log(`[video] 🔄 重试加载 (${errorRetryCount}/${MAX_ERROR_RETRY}), videoId=${props.item.aweme_id?.substring(0, 8)}`)
    setTimeout(() => {
      if (videoEl) {
        videoEl.load()
        // 如果是当前正在播放的视频 或 第一个视频（isPlay），重新播放
        if (state.status === SlideItemPlayStatus.Play || props.isPlay) {
          console.log(`[video] 🔄 重试后自动播放, videoId=${props.item.aweme_id?.substring(0, 8)}`)
          setTimeout(() => {
            videoEl.play().catch((err) => {
              console.error('[video] 重新播放失败:', err)
              // 重试失败，隐藏 loading
              state.loading = false
            })
          }, 300)
        }
      }
    }, 200)
  } else {
    // 超过最大重试次数，隐藏 loading
    state.loading = false
    console.error(`[video] ❌ 加载失败且超过最大重试次数, videoId=${props.item.aweme_id?.substring(0, 8)}`)
  }
}

// ✅ 方案 C：每个视频有独立 DOM，不需要在 onUpdated 中强制 load()
// 移除 onUpdated 逻辑

onUnmounted(() => {
  // 组件卸载
  
  // 强制暂停并清理
  if (videoEl && !videoEl.paused) {
    videoEl.pause()
    videoEl.currentTime = 0
  }
  
  // 移除error事件监听
  if (videoEl) {
    videoEl.removeEventListener('error', handleVideoError)
  }
  
  // 如果当前是正在播放的视频，清理管理器引用
  if (videoPlaybackManager.getCurrentVideoId() === props.item.aweme_id) {
    videoPlaybackManager.clear()
  }
  
  bus.off(EVENT_KEY.SINGLE_CLICK_BROADCAST, click)
  bus.off(EVENT_KEY.DIALOG_MOVE, onDialogMove)
  bus.off(EVENT_KEY.DIALOG_END, onDialogEnd)
  bus.off(EVENT_KEY.OPEN_COMMENTS, onOpenComments)
  bus.off(EVENT_KEY.CLOSE_COMMENTS, onCloseComments)
  bus.off(EVENT_KEY.OPEN_SUB_TYPE, onOpenSubType)
  bus.off(EVENT_KEY.CLOSE_SUB_TYPE, onCloseSubType)
  bus.off(EVENT_KEY.REMOVE_MUTED, removeMuted)
  bus.off(EVENT_KEY.ADD_MUTED, addMuted)
})

function removeMuted() {
  // 全局取消静音（所有视频组件都会响应，但只有播放中的视频会发声）
  window.isMuted = false
  state.isMuted = false
  if (videoEl) {
    videoEl.muted = false
  }
}

function addMuted() {
  // 全局静音
  window.isMuted = true
  state.isMuted = true
  if (videoEl) {
    videoEl.muted = true
  }
}

function onOpenSubType() {
  state.commentVisible = true
}

function onCloseSubType() {
  state.commentVisible = false
}

function onDialogMove({ tag, e }) {
  if (state.commentVisible && tag === 'comment') {
    _css(videoEl, 'transition-duration', `0ms`)
    _css(videoEl, 'height', `calc(var(--vh, 1vh) * 30 + ${e}px)`)
  }
}

function onDialogEnd({ tag, isClose }) {
  if (state.commentVisible && tag === 'comment') {
    _css(videoEl, 'transition-duration', `300ms`)
    if (isClose) {
      state.commentVisible = false
      _css(videoEl, 'height', '100%')
    } else {
      _css(videoEl, 'height', 'calc(var(--vh, 1vh) * 30)')
    }
  }
}

function onOpenComments(id) {
  // ✅ 只负责调整匹配视频的高度，不再触发评论区打开（由 ItemToolbar 直接调用 videoStore）
  if (id === props.item.aweme_id) {
    _css(videoEl, 'transition-duration', `300ms`)
    _css(videoEl, 'height', 'calc(var(--vh, 1vh) * 30)')
    state.commentVisible = true
  }
}

function onCloseComments() {
  if (state.commentVisible) {
    _css(videoEl, 'transition-duration', `300ms`)
    _css(videoEl, 'height', '100%')
    state.commentVisible = false
  }
}

function click({ uniqueId, index, type }) {
  const matched = props.position.uniqueId === uniqueId && props.position.index === index
  
  if (matched) {
    if (type === EVENT_KEY.ITEM_TOGGLE) {
      if (props.isLive) {
        pause()
        bus.emit(EVENT_KEY.NAV, {
          path: '/home/live',
          query: { id: props.item.aweme_id }
        })
      } else {
        if (state.status === SlideItemPlayStatus.Play) {
          pause()
        } else {
          play()
        }
      }
    }
    if (type === EVENT_KEY.ITEM_STOP) {
      // ✅ 滑动切换到其他视频时，重置播放位置（下次回来从头播放）
      videoEl.currentTime = 0
      state.ignoreWaiting = true
      pause()
      setTimeout(() => (state.ignoreWaiting = false), 300)
    }
    if (type === EVENT_KEY.ITEM_PLAY) {
      videoEl.currentTime = 0
      state.ignoreWaiting = true
      play()
      setTimeout(() => (state.ignoreWaiting = false), 300)
    }
  }
}

function play() {
  if (!videoEl) {
    return
  }
  
  // ✅ 立即显示 loading 并重置标志（让用户知道正在加载）
  state.loading = true
  state.loadingHidden = false  // 重置隐藏标志
  
  // 重置错误重试计数
  errorRetryCount = 0
  
  // ✅ 设置当前视频到 videoStore（供 UserPanel 使用）
  videoStore.setCurrentVideo(state.localItem as any, (props.position as any)?.index)
  
  // 通过全局管理器注册当前视频（会自动暂停之前的视频）
  videoPlaybackManager.setCurrentVideo(videoEl, props.item.aweme_id)
  
  // ✅ 不再重置 currentTime，保持上次暂停的位置
  // （切换视频时，ITEM_PLAY 事件会在528行重置 currentTime）
  
  // ✅ 方案 C：每个视频都有独立的 DOM，如果 readyState 为 0，调用 load()
  if (videoEl.readyState === 0) {
    videoEl.load()
  }
  
  // 设置状态 - 明确同步静音状态
  state.status = SlideItemPlayStatus.Play
  state.isMuted = window.isMuted
  videoEl.muted = window.isMuted
  
  // 确保视频已加载足够数据再播放
  const tryPlay = () => {
    if (videoEl.readyState < 2) {
      return false
    }
    
    const playPromise = videoEl.play()
    
    if (playPromise?.catch) {
      playPromise
        .then(() => {
          // ⚠️ 不要在这里隐藏 loading
          // 由 timeupdate 事件确认画面真正播放后才隐藏
        })
        .catch((err) => {
          if (err?.name === 'NotAllowedError') {
            // ✅ 自动静音重试（浏览器策略：重建DOM后必须静音）
            videoEl.muted = true
            state.isMuted = true
            videoEl.play().catch(() => {
              // 播放失败，隐藏 loading
              state.loading = false
            })
          } else if (err?.name !== 'AbortError') {
            // 播放失败，隐藏 loading
            state.loading = false
          }
        })
    }
    return true
  }
  
  // 如果视频还未加载，等待canplay事件（有足够数据开始播放）
  if (videoEl.readyState < 2) {
    state.loading = true
    
    let canplayFired = false
    
    const onCanPlay = () => {
      if (canplayFired) return
      canplayFired = true
      tryPlay()
      cleanup()
    }
    
    const onLoadedData = () => {
      if (canplayFired) return
      if (videoEl.readyState >= 2) {
        canplayFired = true
        tryPlay()
        cleanup()
      }
    }
    
    const cleanup = () => {
      videoEl.removeEventListener('canplay', onCanPlay)
      videoEl.removeEventListener('loadeddata', onLoadedData)
    }
    
    videoEl.addEventListener('canplay', onCanPlay, { once: true })
    videoEl.addEventListener('loadeddata', onLoadedData)
    
    // 设置超时，最多等待1000ms
    setTimeout(() => {
      if (!canplayFired) {
        console.log(`[BaseVideo] ⚠️ canplay 超时, readyState=${videoEl.readyState}, index=${(props.position as any)?.index}`)
        cleanup()
        
        if (videoEl.readyState >= 2) {
          tryPlay()
        } else if (videoEl.readyState === 1) {
          // 直接播放，让浏览器边加载边播放
          // ⚠️ 不隐藏 loading，等待 timeupdate 确认
          videoEl.play().catch((err) => {
            if (err?.name === 'NotAllowedError') {
              // ✅ 自动静音重试
              videoEl.muted = true
              state.isMuted = true
              window.isMuted = true
              videoEl.play().catch(() => {
                // 静音重试也失败，隐藏 loading
                state.loading = false
              })
            } else {
              // 播放失败，隐藏 loading
              state.loading = false
            }
          })
        } else {
          // readyState === 0，再次 load()
          videoEl.load()
          const onLoadedAfterLoad = () => {
            videoEl.play().catch(() => {})
            // ⚠️ 不隐藏 loading，等待 timeupdate 确认
          }
          videoEl.addEventListener('loadeddata', onLoadedAfterLoad, { once: true })
          setTimeout(() => {
            videoEl.removeEventListener('loadeddata', onLoadedAfterLoad)
            // ⚠️ 超时后也不隐藏 loading，让用户看到加载状态
          }, 500)
        }
      }
    }, 1000)
  } else {
    tryPlay()
  }
}

function pause() {
  state.status = SlideItemPlayStatus.Pause
  if (videoEl && !videoEl.paused) {
    videoEl.pause()
  }
}

// 进度条拖动状态（用于判断是否正在拖动）
let isDraggingProgress = false

// Pointer 事件处理（底层事件，像点赞按钮那样）
function handleProgressPointerDown(e: PointerEvent) {
  _stopPropagation(e)
  isDraggingProgress = true
  state.start.x = e.pageX
  state.last.x = state.playX
  state.last.time = state.currentTime
}

function handleProgressPointerMove(e: PointerEvent) {
  _stopPropagation(e)
  if (!isDraggingProgress) return
  
  state.isMove = true
  pause()
  let dx = e.pageX - state.start.x
  state.playX = state.last.x + dx
  state.currentTime = state.last.time + Math.ceil(Math.ceil(dx) / state.step)
  if (state.currentTime <= 0) state.currentTime = 0
  if (state.currentTime >= state.duration) state.currentTime = state.duration
}

function handleProgressPointerUp(e: PointerEvent) {
  _stopPropagation(e)
  isDraggingProgress = false
  videoEl.currentTime = state.currentTime
  setTimeout(() => (state.isMove = false), 1000)
  state.status = SlideItemPlayStatus.Play
  videoEl.play().catch(() => {})
}

function ensureStatistics() {
  if (!state.localItem.statistics) {
    state.localItem.statistics = {
      digg_count: 0,
      comment_count: 0,
      collect_count: 0,
      share_count: 0
    }
  }
}

async function handleDoubleLike() {
  if (!state.localItem?.aweme_id || likeLoading || state.localItem.isLoved) {
    return
  }
  
  ensureStatistics()
  const previous = cloneDeep(state.localItem)
  state.localItem.isLoved = true
  state.localItem.statistics.digg_count = Math.max(
    0,
    (state.localItem.statistics.digg_count ?? 0) + 1
  )
  syncLocalItemState()
  likeLoading = true
  
  try {
    const res = await toggleVideoLike(state.localItem.aweme_id, true)
    if (typeof res?.like_count === 'number') {
      state.localItem.statistics.digg_count = res.like_count
      syncLocalItemState()
    }
  } catch (error: any) {
    Object.assign(state.localItem, previous)
    syncLocalItemState()
    _notice(error?.message || '点赞失败')
  } finally {
    likeLoading = false
  }
}

function handleVideoClick(e: Event) {
  const target = e.target as HTMLElement
  
  // 忽略特定区域的点击
  if (
    target.closest('.toolbar') || 
    target.closest('.progress') || 
    target.closest('.toggle-desc') ||  // 展开/收起按钮
    target.closest('.description-wrapper') ||  // 描述区域
    target.closest('button')
  ) {
    return
  }
  
  const now = Date.now()
  const timeDiff = now - lastTapTime
  
  if (lastTapTime && timeDiff <= DOUBLE_TAP_THRESHOLD) {
    e.preventDefault()
    e.stopPropagation()
    if (touchTimer) {
      clearTimeout(touchTimer)
      touchTimer = null
    }
    lastTapTime = 0
    handleDoubleLike()
  } else {
    lastTapTime = now
    if (touchTimer) {
      clearTimeout(touchTimer)
    }
    touchTimer = window.setTimeout(() => {
      lastTapTime = 0
      touchTimer = null
    }, DOUBLE_TAP_THRESHOLD)
  }
}
</script>

<style scoped lang="less">
.video-wrapper {
  position: relative;
  font-size: 14rem;
  width: 100%;
  height: 100%;
  text-align: center;

  video {
    max-width: 100%;
    height: 100%;
    transition:
      height,
      margin-top 0.3s;
    //background: black;
    /*position: absolute;*/
  }

  .float {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    width: 100%;

    .normal {
      position: absolute;
      bottom: 0;
      width: 100%;
      transition: all 0.3s;

      .comment-status {
        display: flex;
        align-items: center;

        .comment {
          .type-comment {
            display: flex;
            background: rgb(130, 21, 44);
            border-radius: 50px;
            padding: 3px;
            margin-bottom: 20px;

            .avatar {
              width: 36px;
              height: 36px;
              border-radius: 50%;
            }

            .right {
              margin: 0 10px;
              color: var(--second-text-color);

              .name {
                margin-right: 10px;
              }

              .text {
                color: white;
              }
            }
          }

          .type-loved {
            width: 40px;
            height: 40px;
            position: relative;
            margin-bottom: 20px;
            animation: test 1s;
            animation-delay: 0.5s;

            .avatar {
              width: 36px;
              height: 36px;
              border-radius: 50%;
            }

            .loved {
              position: absolute;
              bottom: 0;
              left: 20px;
              width: 10px;
              height: 10px;
              background: red;
              padding: 3px;
              border-radius: 50%;
              border: 2px solid white;
            }
          }

          @keyframes test {
            from {
              display: block;
              transform: translate3d(0, 0, 0);
            }
            to {
              display: none;
              transform: translate3d(0, -60px, 0);
            }
          }
        }
      }
    }

    // 进度条触摸热区容器（大面积，方便拖动）
    .progress-container {
      z-index: 5; // 保留可拖动热区，但让工具栏浮层优先
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 40rem; // 适当缩小，降低误触控件概率
      pointer-events: auto;
      touch-action: none; // 禁止默认触摸行为（滚动、缩放等）
      display: flex;
      align-items: flex-end;
      justify-content: center;
      // background: rgba(255, 0, 0, 0.2); // 调试用，显示热区范围（已注释）
    }

    .progress {
      @w: 90%;
      position: relative;
      bottom: 0;
      height: 10rem;
      width: @w;
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

      @radius: 10rem;

      @h: 2rem;
      @tr: height 0.3s;

      .bg {
        transition: @tr;
        position: absolute;
        width: 100%;
        height: @h;
        background: #4f4f4f;
        border-radius: @radius;
      }

      @p: 50px;

      .progress-line {
        transition: @tr;
        height: calc(@h + 0.5rem);
        width: @p;
        border-radius: @radius 0 0 @radius;
        background: #777777;
        z-index: 1;
      }

      .point {
        transition: all 0.2s;
        width: @h+2;
        height: @h+2;
        border-radius: 50%;
        background: gray;
        z-index: 2;
        transform: translate(-1rem, 1rem);
      }
    }

    & .move {
      @h: 10rem;

      .bg {
        height: @h;
        background: var(--active-main-bg);
      }

      .progress-line {
        height: @h;
        background: var(--second-text-color);
      }

      .point {
        width: @h+2;
        height: @h+2;
        background: white;
      }
    }

    & .stop {
      @h: 4rem;

      .bg {
        height: @h;
      }

      .progress-line {
        height: @h;
        background: white;
      }

      .point {
        width: @h+2;
        height: @h+2;
        background: white;
      }
    }
  }
}

.living {
  position: absolute;
  left: 50%;
  font-size: 18rem;
  border-radius: 50rem;
  border: 1px solid #e0e0e0;
  padding: 15rem 20rem;
  line-height: 1;
  color: white;
  top: 70%;
  transform: translate(-50%, -50%);
}

// ✅ 加载中文字提示
.loading-text {
  position: absolute;
  left: 50%;
  top: 55%;
  transform: translate(-50%, -50%);
  color: white;
  font-size: 14rem;
  z-index: 11;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

// ✅ 暂停图标
.pause-icon {
  // 强制覆盖全局 .pause-icon，确保居中且无动画漂移
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
</style>
