/**
 * 全局视频播放管理器
 * 确保同一时间只有一个视频在播放
 */
class VideoPlaybackManager {
  private currentVideo: HTMLVideoElement | null = null
  private currentVideoId: string | null = null

  /**
   * 注册当前要播放的视频
   * 会自动暂停之前的视频
   */
  setCurrentVideo(video: HTMLVideoElement, videoId: string) {
    // 如果有之前的视频且不是同一个，先暂停
    if (this.currentVideo && this.currentVideo !== video) {
      // 只暂停，不修改muted状态，让组件自己管理
      if (!this.currentVideo.paused) {
        this.currentVideo.pause()
      }
      this.currentVideo.currentTime = 0
    }
    
    this.currentVideo = video
    this.currentVideoId = videoId
  }

  /**
   * 暂停所有视频（页面切换时调用）
   */
  pauseAll() {
    if (this.currentVideo) {
      this.currentVideo.pause()
    }
  }

  /**
   * 获取当前播放的视频ID
   */
  getCurrentVideoId() {
    return this.currentVideoId
  }

  /**
   * 清理当前视频引用
   */
  clear() {
    this.currentVideo = null
    this.currentVideoId = null
  }
}

// 导出单例
export const videoPlaybackManager = new VideoPlaybackManager()

