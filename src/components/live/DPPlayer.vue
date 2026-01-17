<template>
  <div class="dp-player">
    <video
      ref="videoRef"
      class="video"
      :poster="poster"
      :muted="muted"
      :controls="controls"
      :style="{ objectFit: videoFit }"
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
  playbackRate?: number
  debug?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  poster: '',
  autoplay: true,
  muted: true,
  controls: true,
  playbackRate: 1,
  debug: false
})

const videoRef = ref<HTMLVideoElement>()
const videoFit = ref<'contain' | 'cover'>('contain')

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
          // 🎯 Windows 平台优化：检测操作系统，调整 HLS 配置以解决音画不同步问题
          const isWindows = /Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent)

          hls = new Hls({
            enableWorker: true,
            // 🎯 Windows 平台：关闭低延迟模式，增加缓冲以确保音视频同步
            // 低延迟模式在 Windows 上可能导致缓冲不足，造成音画不同步
            lowLatencyMode: !isWindows,
            // 🎯 Windows 平台：增加最大缓冲长度，确保有足够的音视频数据
            maxBufferLength: isWindows ? 30 : undefined, // 30秒缓冲
            maxMaxBufferLength: isWindows ? 60 : undefined, // 最大60秒缓冲
            // 🎯 Windows 平台：设置直播同步持续时间，确保音视频同步
            liveSyncDurationCount: isWindows ? 3 : undefined, // 3个片段
            liveMaxLatencyDurationCount: isWindows ? 5 : undefined, // 最大延迟5个片段
            // 🎯 Windows 平台：增加最小缓冲长度，避免缓冲不足
            minBufferLength: isWindows ? 10 : undefined, // 最小10秒缓冲
            // 🎯 Windows 平台：设置缓冲区大小，确保有足够的音视频数据
            maxBufferSize: isWindows ? 60 * 1000 * 1000 : undefined, // 60MB 缓冲区
            // 🎯 启用自动级别切换，根据网络情况自动调整
            autoStartLoad: true,
            // 🎯 启用音视频同步修复
            abrEwmaDefaultEstimate: 500000, // 初始带宽估计
            abrBandWidthFactor: 0.95, // 带宽因子
            abrBandWidthUpFactor: 0.7, // 带宽上升因子
            // 🎯 Windows 平台：启用音视频同步修复
            capLevelToPlayerSize: !isWindows, // Windows 上关闭自动分辨率调整，避免频繁切换导致同步问题
            // 🎯 Windows 平台：设置音频轨道切换策略
            audioPreference: isWindows ? 'main' : undefined, // 优先使用主音频轨道
            // 🎯 Windows 平台：启用音视频同步修复机制
            maxBufferHole: isWindows ? 0.5 : undefined, // 最大缓冲空洞0.5秒
            maxStarvationDelay: isWindows ? 4 : undefined, // 最大饥饿延迟4秒
            maxLoadingDelay: isWindows ? 4 : undefined, // 最大加载延迟4秒
            // 🎯 Windows 平台：设置片段加载超时
            fragLoadingTimeOut: isWindows ? 20000 : undefined, // 20秒超时
            manifestLoadingTimeOut: isWindows ? 10000 : undefined // 10秒超时
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

            // 🎯 Windows 平台：监听音视频同步事件，主动修复不同步问题
            if (isWindows) {
              // 🎯 Windows 平台：监听片段加载完成事件，确保音视频数据同步
              hls.on(Hls.Events.FRAG_LOADED, (_evt: any, data: any) => {
                pushDebug('hls.frag_loaded', {
                  frag: data?.frag?.relurl,
                  type: data?.frag?.type
                })
              })

              // 🎯 Windows 平台：监听缓冲区更新，检测可能的同步问题
              let lastBufferedEnd = 0
              hls.on(Hls.Events.BUFFER_APPENDED, (_evt: any, data: any) => {
                if (!video) return

                try {
                  const buffered = video.buffered
                  if (buffered && buffered.length > 0) {
                    const currentBufferedEnd = buffered.end(buffered.length - 1)

                    // 检测缓冲区是否正常增长
                    if (currentBufferedEnd === lastBufferedEnd && video.readyState >= 3) {
                      pushDebug('hls.buffer_stalled', {
                        bufferedEnd: currentBufferedEnd,
                        currentTime: video.currentTime
                      })
                    }

                    lastBufferedEnd = currentBufferedEnd
                  }
                } catch (e) {
                  // 忽略错误
                }
              })

              // 🎯 Windows 平台：监听播放时间更新，检测视频卡顿
              let lastVideoTime = 0
              let stalledCount = 0
              const timeUpdateHandler = () => {
                if (!video) return

                const currentTime = video.currentTime

                // 检测视频时间是否正常更新（允许小幅度变化）
                if (
                  Math.abs(currentTime - lastVideoTime) < 0.01 &&
                  video.readyState >= 3 &&
                  !video.paused
                ) {
                  stalledCount++

                  // 如果连续3次检测到卡顿，尝试修复
                  if (stalledCount >= 3) {
                    pushDebug('video.stalled_detected', {
                      currentTime,
                      readyState: video.readyState,
                      networkState: video.networkState
                    })

                    // 尝试重新加载当前片段
                    if (hls && hls.media) {
                      try {
                        // 先停止加载
                        hls.stopLoad()
                        // 等待一小段时间后重新开始加载
                        setTimeout(() => {
                          if (hls && hls.media) {
                            hls.startLoad()
                            pushDebug('hls.restart_attempted', {})
                          }
                        }, 500)
                      } catch (e) {
                        pushDebug('hls.restart_failed', { error: e })
                      }
                    }

                    stalledCount = 0 // 重置计数器
                  }
                } else {
                  stalledCount = 0 // 正常播放，重置计数器
                }

                lastVideoTime = currentTime
              }

              video.addEventListener('timeupdate', timeUpdateHandler)

              // 保存处理器以便清理
              ;(video as any).__dpSyncHandler = timeUpdateHandler
            }
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

watch(
  [() => props.playbackRate, videoRef],
  ([rate]) => {
    const video = videoRef.value
    if (!video) return
    try {
      video.playbackRate = rate || 1
    } catch {
      // ignore
    }
  },
  { immediate: true }
)

onMounted(() => {
  const video = videoRef.value
  if (!video) return

  const onEvent = (type: string) => () => {
    let extra: any = undefined
    if (type === 'loadedmetadata' || type === 'playing' || type === 'resize') {
      if (video.videoWidth && video.videoHeight) {
        // 如果是横屏视频 (宽 > 高)，使用 contain 以免剪掉太多内容，上下留黑边是正常的
        // 如果是竖屏视频 (高 >= 宽)，使用 cover 以填充全屏，消除左右黑边
        videoFit.value = video.videoWidth > video.videoHeight ? 'contain' : 'cover'
        pushDebug('video.fit', {
          event: type,
          width: video.videoWidth,
          height: video.videoHeight,
          fit: videoFit.value
        })
      }
    }
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
    'resize',
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

  // 🎯 清理 Windows 平台的音视频同步处理器
  if (video && (video as any).__dpSyncHandler) {
    try {
      video.removeEventListener('timeupdate', (video as any).__dpSyncHandler)
    } catch {
      /* noop */
    }
    ;(video as any).__dpSyncHandler = null
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
