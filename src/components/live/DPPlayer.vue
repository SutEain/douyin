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
      preload="auto"
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
  landscape?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  poster: '',
  autoplay: true,
  muted: true,
  controls: true,
  playbackRate: 1,
  debug: false,
  landscape: false
})

const videoRef = ref<HTMLVideoElement>()
// 🎯 统一使用 contain，确保视频完整显示在窗口内，不会被裁剪
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
    // 🚨 桌面平台检测：Windows 和 Mac 都需要强制使用 hls.js 以解决音视频同步问题
    const isWindows = /Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent)
    const isMac = /Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent)
    const isDesktop = isWindows || isMac

    // 先尝试原生（iOS Safari / 部分 WebView 原生支持 HLS）
    // 如果不支持，再尝试注入 hls.js
    const canNativeHls =
      typeof video.canPlayType === 'function' &&
      (video.canPlayType('application/vnd.apple.mpegurl') ||
        video.canPlayType('application/x-mpegURL'))

    pushDebug('nativeHlsSupport', { canNativeHls, isWindows, isMac, isDesktop })

    // 🚨 桌面平台（Windows/Mac）：即使浏览器原生支持 HLS，也强制使用 hls.js，以便应用音视频同步修复
    // 移动端（iOS Safari）继续使用原生 HLS，性能更好
    if (canNativeHls && !isDesktop) {
      video.src = src
    } else {
      try {
        const Hls = await loadHlsFromCdn()
        if (Hls?.isSupported?.()) {
          // 🚨 桌面平台：使用最简化的 HLS 配置，避免过度配置导致的问题
          const hlsConfig: any = {
            enableWorker: true,
            autoStartLoad: true
          }

          // 🚨 桌面平台（Windows/Mac）：只设置必要的参数，避免配置冲突
          if (isDesktop) {
            // 关键配置：关闭低延迟模式，这是桌面平台音画不同步的主要原因
            hlsConfig.lowLatencyMode = false
            // 适中的缓冲长度，不要太大也不要太小
            hlsConfig.maxBufferLength = 20
            hlsConfig.maxMaxBufferLength = 40
            // 直播同步参数
            hlsConfig.liveSyncDurationCount = 3
            hlsConfig.liveMaxLatencyDurationCount = 6
            // 最小缓冲
            hlsConfig.minBufferLength = 8
          }

          hls = new Hls(hlsConfig)
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

            // 🚨 桌面平台：详细的调试日志和同步检测
            if (isDesktop) {
              // 🚨 桌面平台：确保视频元素使用正确的播放速率
              try {
                video.defaultPlaybackRate = 1.0
                video.playbackRate = 1.0
                pushDebug('desktop_playback_rate_set', {
                  playbackRate: video.playbackRate,
                  platform: isWindows ? 'Windows' : 'Mac'
                })
              } catch (e) {
                pushDebug('desktop_playback_rate_failed', {
                  error: e,
                  platform: isWindows ? 'Windows' : 'Mac'
                })
              }

              // 🚨 桌面平台：详细的音视频同步调试日志
              let lastLogTime = Date.now()
              let lastVideoTime = 0
              let audioTrackCount = 0
              let videoTrackCount = 0
              let lastAudioPTS = 0
              let lastVideoPTS = 0

              // 监听所有 HLS 事件，记录音视频时间戳
              hls.on(Hls.Events.FRAG_LOADED, (_evt: any, data: any) => {
                const frag = data?.frag
                if (frag) {
                  pushDebug('hls.frag_loaded', {
                    type: frag.type,
                    relurl: frag.relurl,
                    start: frag.start,
                    startPTS: frag.startPTS,
                    endPTS: frag.endPTS,
                    duration: frag.duration,
                    sn: frag.sn
                  })

                  if (frag.type === 'audio') {
                    audioTrackCount++
                    if (frag.startPTS !== undefined) {
                      lastAudioPTS = frag.startPTS
                    }
                  } else if (frag.type === 'video') {
                    videoTrackCount++
                    if (frag.startPTS !== undefined) {
                      lastVideoPTS = frag.startPTS
                    }
                  }

                  // 如果音视频时间戳都存在，计算差异
                  if (lastAudioPTS > 0 && lastVideoPTS > 0) {
                    const syncDiff = Math.abs(lastAudioPTS - lastVideoPTS)
                    pushDebug('hls.pts_sync_check', {
                      audioPTS: lastAudioPTS.toFixed(3),
                      videoPTS: lastVideoPTS.toFixed(3),
                      diff: syncDiff.toFixed(3),
                      audioCount: audioTrackCount,
                      videoCount: videoTrackCount
                    })
                  }
                }
              })

              hls.on(Hls.Events.FRAG_PARSED, (_evt: any, data: any) => {
                const frag = data?.frag
                if (frag && video) {
                  pushDebug('hls.frag_parsed', {
                    type: frag.type,
                    startPTS: frag.startPTS,
                    endPTS: frag.endPTS,
                    videoCurrentTime: video.currentTime,
                    videoReadyState: video.readyState
                  })
                }
              })

              // 监听缓冲区更新
              hls.on(Hls.Events.BUFFER_APPENDED, (_evt: any, data: any) => {
                if (!video) return
                try {
                  const buffered = video.buffered
                  if (buffered && buffered.length > 0) {
                    const bufferedRanges = []
                    for (let i = 0; i < buffered.length; i++) {
                      bufferedRanges.push({
                        start: buffered.start(i).toFixed(3),
                        end: buffered.end(i).toFixed(3)
                      })
                    }
                    pushDebug('hls.buffer_appended', {
                      ranges: bufferedRanges,
                      currentTime: video.currentTime.toFixed(3),
                      readyState: video.readyState,
                      networkState: video.networkState
                    })
                  }
                } catch (e) {
                  // 忽略错误
                }
              })

              // 🚨 桌面平台：详细的播放状态监控
              let timeUpdateCount = 0
              const timeUpdateHandler = () => {
                if (!video) return

                timeUpdateCount++
                const now = Date.now()
                const currentTime = video.currentTime

                // 每50次 timeupdate（约2-3秒）记录一次详细状态
                if (timeUpdateCount % 50 === 0) {
                  try {
                    const buffered = video.buffered
                    const bufferedInfo = []
                    if (buffered && buffered.length > 0) {
                      for (let i = 0; i < buffered.length; i++) {
                        bufferedInfo.push({
                          start: buffered.start(i).toFixed(3),
                          end: buffered.end(i).toFixed(3)
                        })
                      }
                    }

                    const timeDiff = currentTime - lastVideoTime
                    const realTimeDiff = (now - lastLogTime) / 1000

                    pushDebug('desktop.playback_status', {
                      platform: isWindows ? 'Windows' : 'Mac',
                      currentTime: currentTime.toFixed(3),
                      lastVideoTime: lastVideoTime.toFixed(3),
                      timeDiff: timeDiff.toFixed(3),
                      realTimeDiff: realTimeDiff.toFixed(3),
                      playbackRate: video.playbackRate,
                      paused: video.paused,
                      readyState: video.readyState,
                      networkState: video.networkState,
                      buffered: bufferedInfo,
                      videoWidth: video.videoWidth,
                      videoHeight: video.videoHeight,
                      audioPTS: lastAudioPTS > 0 ? lastAudioPTS.toFixed(3) : 'N/A',
                      videoPTS: lastVideoPTS > 0 ? lastVideoPTS.toFixed(3) : 'N/A',
                      ptsDiff:
                        lastAudioPTS > 0 && lastVideoPTS > 0
                          ? Math.abs(lastAudioPTS - lastVideoPTS).toFixed(3)
                          : 'N/A'
                    })

                    // 检测时间推进异常
                    if (lastVideoTime > 0 && !video.paused) {
                      const expectedTimeDiff = realTimeDiff * video.playbackRate
                      const actualTimeDiff = timeDiff
                      const drift = Math.abs(expectedTimeDiff - actualTimeDiff)

                      if (drift > 0.2) {
                        pushDebug('desktop.time_drift_detected', {
                          platform: isWindows ? 'Windows' : 'Mac',
                          expected: expectedTimeDiff.toFixed(3),
                          actual: actualTimeDiff.toFixed(3),
                          drift: drift.toFixed(3),
                          playbackRate: video.playbackRate
                        })
                      }
                    }

                    lastVideoTime = currentTime
                    lastLogTime = now
                  } catch (e) {
                    pushDebug('desktop.playback_status_error', {
                      error: e,
                      platform: isWindows ? 'Windows' : 'Mac'
                    })
                  }
                }
              }

              video.addEventListener('timeupdate', timeUpdateHandler)

              // 监听所有视频事件
              const eventTypes = [
                'play',
                'pause',
                'seeking',
                'seeked',
                'waiting',
                'stalled',
                'canplay',
                'canplaythrough',
                'loadedmetadata',
                'loadeddata'
              ]
              const eventHandlers = new Map<string, () => void>()

              eventTypes.forEach((eventType) => {
                const handler = () => {
                  if (!video) return
                  pushDebug(`video.${eventType}`, {
                    currentTime: video.currentTime.toFixed(3),
                    readyState: video.readyState,
                    networkState: video.networkState,
                    paused: video.paused,
                    buffered:
                      video.buffered.length > 0
                        ? `${video.buffered.start(0).toFixed(3)}-${video.buffered.end(video.buffered.length - 1).toFixed(3)}`
                        : 'empty'
                  })
                }
                eventHandlers.set(eventType, handler)
                video.addEventListener(eventType, handler)
              })

              // 保存处理器以便清理
              ;(video as any).__dpDesktopTimeUpdateHandler = timeUpdateHandler
              ;(video as any).__dpDesktopEventHandlers = eventHandlers
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
    // 🎯 修复：如果从静音切换到有声，且当前是暂停状态，尝试播放
    // 这能解决某些浏览器在解除静音时不会自动恢复播放的问题
    if (!muted && video.paused) {
      video.play().catch(() => {
        /* 这里的失败通常是因为没有用户手势，静默失败即可 */
      })
    }
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

watch(
  () => props.landscape,
  () => {
    // 🎯 统一使用 contain，确保视频完整显示在窗口内，不会被裁剪
    videoFit.value = 'contain'
  }
)

onMounted(() => {
  const video = videoRef.value
  if (!video) return

  // 🚨 桌面平台：尝试多种方法解决音画不同步问题
  const isWindows = /Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent)
  const isMac = /Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent)
  const isDesktop = isWindows || isMac

  if (isDesktop) {
    try {
      // 🚨 方法1: 禁用 CSS 硬件加速 (修改：不要强制 transform: none，否则会影响父级的 rotate)
      video.style.willChange = 'auto'
      video.style.backfaceVisibility = 'visible'

      // 🚨 方法2: 设置视频元素属性
      video.setAttribute('preload', 'auto')
      video.setAttribute('playsinline', 'true')

      // 🚨 方法3: 强制设置播放速率，确保音视频同步
      video.defaultPlaybackRate = 1.0
      video.playbackRate = 1.0

      // 🚨 方法4: 尝试禁用某些可能导致不同步的浏览器特性
      // 注意：这些属性可能不被所有浏览器支持，但尝试设置不会出错
      try {
        ;(video as any).mozMediaKeys = null
        ;(video as any).webkitMediaKeys = null
      } catch {
        // 忽略不支持的情况
      }

      pushDebug('desktop_video_config', {
        platform: isWindows ? 'Windows' : 'Mac',
        willChange: video.style.willChange,
        playbackRate: video.playbackRate,
        preload: video.preload
      })
    } catch (e) {
      pushDebug('desktop_video_config_failed', {
        error: e,
        platform: isWindows ? 'Windows' : 'Mac'
      })
    }
  }

  const onEvent = (type: string) => () => {
    let extra: any = undefined
    if (type === 'loadedmetadata' || type === 'playing' || type === 'resize') {
      if (video.videoWidth && video.videoHeight) {
        // 🎯 统一使用 contain，确保视频完整显示在窗口内，不会被裁剪
        videoFit.value = 'contain'
        pushDebug('video.fit', {
          event: type,
          width: video.videoWidth,
          height: video.videoHeight,
          fit: videoFit.value,
          landscape: props.landscape
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

  // 🎯 清理桌面平台的音视频同步处理器
  if (video) {
    try {
      // 清理旧的处理器（如果存在）
      if ((video as any).__dpSyncHandler) {
        video.removeEventListener('timeupdate', (video as any).__dpSyncHandler)
        ;(video as any).__dpSyncHandler = null
      }
      if ((video as any).__dpSeekingHandler) {
        video.removeEventListener('seeking', (video as any).__dpSeekingHandler)
        ;(video as any).__dpSeekingHandler = null
      }
      if ((video as any).__dpStalledHandler) {
        video.removeEventListener('stalled', (video as any).__dpStalledHandler)
        video.removeEventListener('waiting', (video as any).__dpStalledHandler)
        ;(video as any).__dpStalledHandler = null
      }

      // 🚨 清理桌面平台的调试处理器
      if ((video as any).__dpDesktopTimeUpdateHandler) {
        video.removeEventListener('timeupdate', (video as any).__dpDesktopTimeUpdateHandler)
        ;(video as any).__dpDesktopTimeUpdateHandler = null
      }
      if ((video as any).__dpDesktopEventHandlers) {
        const handlers: Map<string, () => void> = (video as any).__dpDesktopEventHandlers
        handlers.forEach((handler, eventType) => {
          try {
            video.removeEventListener(eventType, handler)
          } catch {
            /* noop */
          }
        })
        ;(video as any).__dpDesktopEventHandlers = null
      }
    } catch {
      /* noop */
    }
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
  /* 🎯 修复：强制 3D 渲染，解决部分 WebView 下 transform 继承失效问题 */
  transform: translateZ(0);
  will-change: transform;
}
</style>
