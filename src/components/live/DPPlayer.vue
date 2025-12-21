<template>
  <div class="dp-player">
    <video
      ref="videoRef"
      class="video"
      :poster="poster"
      :muted="muted"
      :controls="controls"
      playsinline
      webkit-playsinline
      x5-playsinline
      x5-video-player-type="h5-page"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

declare global {
  interface Window {
    Hls?: any
  }
}

interface Props {
  src: string
  poster?: string
  autoplay?: boolean
  muted?: boolean
  controls?: boolean
  debug?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  poster: '',
  autoplay: true,
  muted: true,
  controls: true,
  debug: false
})

const videoRef = ref<HTMLVideoElement>()

let hls: any = null
let hlsReadyPromise: Promise<any> | null = null

type DebugEntry = { t: number; type: string; data?: any }
const debugLog = ref<DebugEntry[]>([])
const lastError = ref<string>('')

const debugEnabled = computed(() => {
  try {
    const flag = props.debug || new URLSearchParams(window.location.search).get('dpdebug') === '1'
    return !!flag
  } catch {
    return !!props.debug
  }
})

const emit = defineEmits<{
  (e: 'error', payload: { src: string; message: string; detail?: any }): void
}>()

// 供外部“用户手势”触发播放/开声（提高通过自动播放策略的概率）
async function unmuteAndPlay() {
  const video = videoRef.value
  if (!video) return false
  try {
    video.muted = false
    await video.play()
    return true
  } catch (err: any) {
    const name = err?.name || 'Error'
    const msg = err?.message || String(err)
    if (name !== 'AbortError' && debugEnabled.value) {
      console.error('[DPPlayer] unmuteAndPlay failed:', { err })
    }
    emit('error', { src: props.src, message: msg, detail: { name } })
    return false
  }
}

defineExpose({ unmuteAndPlay })

function pushDebug(type: string, data?: any) {
  if (!debugEnabled.value) return
  const entry = { t: Date.now(), type, data }
  debugLog.value.push(entry)
  // 保留最后 80 条
  if (debugLog.value.length > 80) {
    debugLog.value.splice(0, debugLog.value.length - 80)
  }
  try {
    // 控制台也打，方便本地调试
    // eslint-disable-next-line no-console
    console.log('[DPPlayer][debug]', type, data ?? '')
  } catch {
    /* noop */
  }
}

function loadHlsFromCdn(): Promise<any> {
  // 已经加载过
  if (window.Hls) return Promise.resolve(window.Hls)
  if (hlsReadyPromise) return hlsReadyPromise

  hlsReadyPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-hlsjs="1"]') as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Hls))
      existing.addEventListener('error', () => reject(new Error('hls.js load failed')))
      return
    }

    const cdnUrls = [
      // 运行时按需加载（不需要本地安装依赖）
      'https://cdn.jsdelivr.net/npm/hls.js@1.6.7/dist/hls.min.js',
      'https://unpkg.com/hls.js@1.6.7/dist/hls.min.js',
      'https://fastly.jsdelivr.net/npm/hls.js@1.6.7/dist/hls.min.js'
    ]

    const script = document.createElement('script')
    script.dataset.hlsjs = '1'
    script.async = true

    let idx = 0
    const tryLoad = () => {
      if (idx >= cdnUrls.length) {
        reject(new Error('hls.js load failed'))
        return
      }
      script.src = cdnUrls[idx++]
    }

    script.onload = () => resolve(window.Hls)
    script.onerror = () => {
      // 失败就换下一个 CDN
      tryLoad()
    }

    document.head.appendChild(script)
    tryLoad()
  })

  return hlsReadyPromise
}

function destroyHls() {
  if (hls && typeof hls.destroy === 'function') {
    try {
      hls.destroy()
    } catch {
      /* noop */
    }
  }
  hls = null
}

async function setSource(src: string) {
  const video = videoRef.value
  if (!video) return

  pushDebug('setSource', { src })
  destroyHls()

  // 兜底：空 src
  if (!src) {
    video.removeAttribute('src')
    try {
      video.load()
    } catch {
      /* noop */
    }
    return
  }

  // 经验规则：m3u8 / allinone hls 参数 / 720p 解析接口通常为 HLS
  // - 兼容：原外部 migu720p.php
  // - 兼容：本项目 Supabase Edge Function /migu720p?id=...
  // - 兼容：allinone: ?stream=hls / ?media=hls / ?platform=hls
  const maybeHls =
    /\.m3u8(\?|$)/i.test(src) ||
    /migu720p\.php/i.test(src) ||
    /\/migu720p(\?|$)/i.test(src) ||
    /(^|[?&])stream=hls(&|$)/i.test(src) ||
    /(^|[?&])media=hls(&|$)/i.test(src) ||
    /(^|[?&])platform=hls(&|$)/i.test(src)

  pushDebug('maybeHls', { maybeHls })

  if (maybeHls) {
    // 先尝试原生（iOS Safari / 部分 WebView 原生支持 HLS）
    // 如果不支持，再尝试注入 hls.js
    const canNativeHls =
      typeof video.canPlayType === 'function' &&
      (video.canPlayType('application/vnd.apple.mpegurl') ||
        video.canPlayType('application/x-mpegURL'))

    pushDebug('nativeHlsSupport', { canNativeHls })

    if (canNativeHls) {
      video.src = src
    } else {
      try {
        const Hls = await loadHlsFromCdn()
        if (Hls?.isSupported?.()) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true
          })
          try {
            hls.on(Hls.Events.ERROR, (_evt: any, data: any) => {
              lastError.value = `[hls.js] ${data?.type || ''} ${data?.details || ''} fatal=${
                data?.fatal ? '1' : '0'
              }`
              pushDebug('hls.error', data)
            })
            hls.on(Hls.Events.MANIFEST_PARSED, (_evt: any, data: any) => {
              pushDebug('hls.manifest_parsed', {
                levels: data?.levels?.length,
                firstLevel: data?.levels?.[0]?.height
              })
            })
          } catch {
            /* noop */
          }
          hls.loadSource(src)
          hls.attachMedia(video)
          pushDebug('hls.attach', {})
        } else {
          // 兜底：直接塞 src（有些 WebView 会自己处理）
          video.src = src
        }
      } catch {
        // CDN 拉不到时兜底：直接塞 src
        video.src = src
      }
    }
  } else {
    video.src = src
  }

  if (props.autoplay) {
    // Telegram WebView 可能要求 muted 才能自动播放
    video.muted = !!props.muted
    video
      .play()
      .then(() => {})
      .catch((err) => {
        const name = err?.name || 'Error'
        const msg = err?.message || String(err)

        // AbortError 通常是用户操作/切换 src 导致的中断，不当成错误刷屏
        if (name === 'AbortError') {
          pushDebug('play.abort', { name, message: msg })
          return
        }

        if (debugEnabled.value) {
          console.error('[DPPlayer] video.play() failed:', { src, muted: video.muted, err })
        }

        lastError.value = `[play] ${name}: ${msg}`
        pushDebug('play.reject', { name, message: msg })
        emit('error', { src, message: msg, detail: { name } })
      })
  }
}

watch(
  [() => props.src, videoRef],
  ([src]) => {
    // ✅ 关键修复：第一次 immediate 触发时 videoRef 可能还没挂载，导致 setSource 直接 return。
    // 监听 videoRef 变化，确保 video 元素就绪后会再跑一遍 setSource。
    if (!videoRef.value) {
      pushDebug('watch.skip_no_video', { src })
      return
    }
    setSource(src)
  },
  { immediate: true }
)

watch(
  [() => props.muted, videoRef],
  ([muted]) => {
    const video = videoRef.value
    if (!video) return
    video.muted = !!muted
  },
  { immediate: true }
)

onMounted(() => {
  const video = videoRef.value
  if (!video) return

  const onEvent = (type: string) => () => {
    let extra: any = undefined
    if (type === 'error') {
      const err = (video as any).error
      extra = {
        code: err?.code,
        message: err?.message
      }
      const msg = `video.error code=${err?.code ?? 'unknown'}`
      lastError.value = `[video.error] code=${err?.code ?? 'unknown'}`
      emit('error', {
        src: (video.currentSrc || (video as any).src || props.src) ?? '',
        message: msg,
        detail: extra
      })
    }
    if (type === 'stalled' || type === 'waiting') {
      extra = {
        currentTime: video.currentTime,
        readyState: video.readyState,
        networkState: video.networkState
      }
    }
    pushDebug(`video.${type}`, extra)
  }

  const events = [
    'loadstart',
    'loadedmetadata',
    'loadeddata',
    'canplay',
    'canplaythrough',
    'playing',
    'pause',
    'waiting',
    'stalled',
    'ended',
    'error'
  ] as const

  const handlers = new Map<string, any>()
  for (const e of events) {
    const h = onEvent(e)
    handlers.set(e, h)
    video.addEventListener(e, h)
  }

  // 保存到 DOM 上，方便卸载时取回
  ;(video as any).__dpHandlers = handlers
})

onBeforeUnmount(() => {
  const video = videoRef.value
  if (video && (video as any).__dpHandlers) {
    const handlers: Map<string, any> = (video as any).__dpHandlers
    for (const [e, h] of handlers.entries()) {
      try {
        video.removeEventListener(e, h)
      } catch {
        /* noop */
      }
    }
    ;(video as any).__dpHandlers = null
  }
  destroyHls()
})
</script>

<style scoped lang="less">
.dp-player {
  width: 100%;
  height: 100%;
  background: #000;
  position: relative;
}

.video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}
</style>
