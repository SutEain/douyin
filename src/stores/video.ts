import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { VideoItem } from '@/types'
import bus, { EVENT_KEY } from '@/utils/bus'

/**
 * 视频状态管理 Store
 *
 * 替代原来的 EventBus，使用 Pinia 进行状态管理
 */
export const useVideoStore = defineStore('video', () => {
  // ========== 状态 ==========

  // 当前播放的视频 ID
  const currentPlayingId = ref<string | null>(null)

  // 当前播放的页面
  const currentPage = ref<'home' | 'detail' | 'me' | null>(null)

  // 当前视频索引（用于虚拟列表）
  const currentIndex = ref(0)

  // 当前视频数据
  const currentVideo = ref<VideoItem | null>(null)

  // 是否全屏
  const isFullscreen = ref(false)

  // 是否显示评论
  const showComments = ref(false)

  // 评论的视频 ID
  const commentVideoId = ref<string>('')

  // 是否静音（默认静音以兼容浏览器自动播放策略）
  const isMuted = ref(true)
  // 同步到 window，兼容旧代码
  window.isMuted = true

  // 🎯 全局视频播放管理器
  // 存储所有注册的视频元素（使用 WeakMap 避免内存泄漏）
  const registeredVideos = new Set<HTMLVideoElement>()
  // 当前正在播放的视频元素
  const activeVideoElement = ref<HTMLVideoElement | null>(null)

  // ========== 计算属性 ==========

  const isPlaying = computed(() => currentPlayingId.value !== null)

  // ========== Actions ==========

  /**
   * 设置当前播放的视频
   */
  function setCurrentPlaying(id: string | null, page: 'home' | 'detail' | 'me' | null = null) {
    currentPlayingId.value = id
    if (page) {
      currentPage.value = page
    }
  }

  /**
   * 设置当前视频数据
   */
  function setCurrentVideo(video: VideoItem | null, index?: number) {
    currentVideo.value = video
    if (index !== undefined) {
      currentIndex.value = index
    }
  }

  /**
   * 清空当前播放状态
   */
  function clearPlaying() {
    currentPlayingId.value = null
    currentPage.value = null
  }

  /**
   * 打开评论
   */
  function openComments(videoId?: string) {
    showComments.value = true
    commentVideoId.value = videoId || currentVideo.value?.aweme_id || ''
    isFullscreen.value = true
  }

  /**
   * 关闭评论
   */
  function closeComments() {
    showComments.value = false

    // ✅ 发送事件，通知 BaseVideo 恢复视频高度
    bus.emit(EVENT_KEY.CLOSE_COMMENTS)

    commentVideoId.value = ''
    isFullscreen.value = false
  }

  /**
   * 切换全屏
   */
  function toggleFullscreen(value?: boolean) {
    isFullscreen.value = value !== undefined ? value : !isFullscreen.value
  }

  /**
   * 切换静音
   */
  function toggleMuted(value?: boolean) {
    const oldValue = isMuted.value
    isMuted.value = value !== undefined ? value : !isMuted.value

    // 🎯 防止无限递归：如果值没有变化，直接返回
    if (oldValue === isMuted.value) {
      console.log(`[VideoManager] 静音状态未变化，跳过处理: ${isMuted.value}`)
      return
    }

    // 同步到 window 对象（兼容旧代码）
    window.isMuted = isMuted.value

    // 🎯 同步所有已注册的视频元素的静音状态
    console.log(`[VideoManager] 同步 ${registeredVideos.size} 个视频的静音状态: ${isMuted.value}`)
    registeredVideos.forEach((video) => {
      try {
        video.muted = isMuted.value
      } catch (err) {
        console.warn(`[VideoManager] 同步视频静音状态失败:`, err)
      }
    })

    // 🎯 注意：不在这里发送 bus 事件，避免与 ItemToolbar 形成循环
    // ItemToolbar.toggleMute() 会同时调用 store.toggleMuted() 和 bus.emit()
  }

  /**
   * 重置状态
   */
  function reset() {
    currentPlayingId.value = null
    currentPage.value = null
    currentIndex.value = 0
    currentVideo.value = null
    isFullscreen.value = false
    showComments.value = false
    commentVideoId.value = ''
  }

  // ========== 🎯 全局视频播放管理 ==========

  /**
   * 注册视频元素
   */
  function registerVideoElement(video: HTMLVideoElement) {
    if (!registeredVideos.has(video)) {
      registeredVideos.add(video)
      // 🎯 注册时立即同步静音状态，确保新加载的视频与全局状态一致
      video.muted = isMuted.value
      console.log(`[VideoManager] 注册视频元素`, {
        totalCount: registeredVideos.size,
        muted: isMuted.value,
        videoSrc: video.currentSrc?.substring(0, 50) || 'no src',
        videoPoster: video.poster?.substring(0, 50) || 'no poster',
        readyState: video.readyState,
        paused: video.paused
      })
    } else {
      console.log(`[VideoManager] 视频元素已存在，跳过重复注册`, {
        totalCount: registeredVideos.size,
        videoSrc: video.currentSrc?.substring(0, 50) || 'no src'
      })
    }
  }

  /**
   * 注销视频元素
   */
  function unregisterVideoElement(video: HTMLVideoElement) {
    if (registeredVideos.has(video)) {
      const wasActive = activeVideoElement.value === video
      registeredVideos.delete(video)
      if (wasActive) {
        activeVideoElement.value = null
      }
      console.log(`[VideoManager] 注销视频元素`, {
        remainingCount: registeredVideos.size,
        wasActive,
        videoSrc: video.currentSrc?.substring(0, 50) || 'no src',
        paused: video.paused
      })
    } else {
      console.log(`[VideoManager] 视频元素不存在，跳过注销`, {
        totalCount: registeredVideos.size,
        videoSrc: video.currentSrc?.substring(0, 50) || 'no src'
      })
    }
  }

  /**
   * 设置当前活跃的视频（开始播放时调用）
   * 会自动暂停所有其他视频
   */
  function setActiveVideo(video: HTMLVideoElement) {
    // 如果已经是当前活跃视频，不做处理
    if (activeVideoElement.value === video) {
      return
    }

    console.log(`[VideoManager] 设置活跃视频，暂停其他 ${registeredVideos.size - 1} 个视频`)

    // 暂停所有其他视频
    registeredVideos.forEach((v) => {
      if (v !== video && !v.paused) {
        console.log(`[VideoManager] 暂停后台视频: ${v.currentSrc?.substring(0, 50)}`)
        v.pause()
      }
    })

    // 设置当前活跃视频
    activeVideoElement.value = video
  }

  /**
   * 暂停所有视频
   */
  function pauseAllVideos() {
    console.log(`[VideoManager] 暂停所有视频，总计: ${registeredVideos.size}`)
    registeredVideos.forEach((video) => {
      if (!video.paused) {
        video.pause()
      }
    })
    activeVideoElement.value = null
  }

  return {
    // 状态
    currentPlayingId,
    currentPage,
    currentIndex,
    currentVideo,
    isFullscreen,
    showComments,
    commentVideoId,
    isMuted,
    activeVideoElement,

    // 计算属性
    isPlaying,

    // Actions
    setCurrentPlaying,
    setCurrentVideo,
    clearPlaying,
    openComments,
    closeComments,
    toggleFullscreen,
    toggleMuted,
    reset,

    // 🎯 全局视频管理
    registerVideoElement,
    unregisterVideoElement,
    setActiveVideo,
    pauseAllVideos
  }
})
