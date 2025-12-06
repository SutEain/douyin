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
    isMuted.value = value !== undefined ? value : !isMuted.value
    // 同步到 window 对象（兼容旧代码）
    window.isMuted = isMuted.value
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
    reset
  }
})

