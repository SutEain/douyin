/**
 * 统一的视频播放管理器
 *
 * 职责：
 * 1. 确保同一时间只有一个视频播放
 * 2. 管理视频的播放/暂停状态
 * 3. 处理视频切换时的清理工作
 */

interface VideoInstance {
  id: string
  element: HTMLVideoElement
  page: string // 'home' | 'detail' | 'me'
}

class VideoManager {
  private currentVideo: VideoInstance | null = null
  private videoElements = new Map<string, HTMLVideoElement>()
  private stallTimers = new Map<string, number>()
  private readonly DEBUG_PREFIX = '[AutoPlayDebug]'

  private scheduleStallCheck(id: string, page: string, element: HTMLVideoElement) {
    const lastTime = element.currentTime
    // 清理旧定时器
    const old = this.stallTimers.get(id)
    if (old) {
      clearTimeout(old)
    }
    const timer = window.setTimeout(() => {
      const paused = element.paused
      const timeUnchanged = Math.abs(element.currentTime - lastTime) < 0.05
      if (paused || timeUnchanged) {
        console.warn(`${this.DEBUG_PREFIX} play:stall-detected`, {
          id: id.substring(0, 8),
          page,
          paused,
          currentTime: element.currentTime,
          lastTime,
          readyState: element.readyState,
          muted: element.muted
        })
        // 静音重试一次
        element.muted = true
        element
          .play()
          .then(() => {
            console.log(`${this.DEBUG_PREFIX} play:stall-retry-success`, {
              id: id.substring(0, 8),
              page,
              muted: element.muted,
              readyState: element.readyState,
              paused: element.paused
            })
          })
          .catch((error) => {
            console.error(`${this.DEBUG_PREFIX} play:stall-retry-fail`, {
              id: id.substring(0, 8),
              page,
              error
            })
          })
      }
      this.stallTimers.delete(id)
    }, 700)
    this.stallTimers.set(id, timer)
  }

  /**
   * 注册视频元素
   */
  register(id: string, element: HTMLVideoElement, page: string) {
    this.videoElements.set(id, element)

    // 确保初始静音状态与全局一致，避免自动播放被拦截
    if (typeof window !== 'undefined' && typeof (window as any).isMuted !== 'undefined') {
      element.muted = (window as any).isMuted
    }

    console.log(`${this.DEBUG_PREFIX} register`, {
      id: id.substring(0, 8),
      page,
      muted: element.muted,
      globalMuted: (window as any)?.isMuted,
      readyState: element.readyState
    })

    // 监听视频播放事件
    element.addEventListener('play', () => {
      // 如果不是当前视频发起的播放，自动设为当前视频
      if (this.currentVideo?.id !== id) {
        this.pauseAll()
        this.currentVideo = { id, element, page }
      }
    })
  }

  /**
   * 注销视频元素
   */
  unregister(id: string) {
    const element = this.videoElements.get(id)
    if (element) {
      element.pause()
      element.currentTime = 0
    }
    this.videoElements.delete(id)

    if (this.currentVideo?.id === id) {
      this.currentVideo = null
    }
  }

  /**
   * 播放指定视频（会自动暂停其他视频）
   */
  async play(id: string, page: string) {
    const element = this.videoElements.get(id)
    if (!element) {
      console.warn('[VideoManager] 视频元素不存在:', id)
      return
    }

    // 暂停其他视频
    this.pauseAll()

    // 设置当前视频
    this.currentVideo = { id, element, page }

    // 播放前保证静音状态与全局一致，降低浏览器拦截概率
    const globalMuted = typeof window !== 'undefined' ? (window as any)?.isMuted : undefined
    const needForceMute = globalMuted === false && element.muted === false
    if (typeof globalMuted !== 'undefined') {
      element.muted = globalMuted
    }
    if (needForceMute) {
      element.muted = true
      console.log(`${this.DEBUG_PREFIX} play:force-mute-before`, {
        id: id.substring(0, 8),
        page,
        muted: element.muted,
        globalMuted,
        readyState: element.readyState,
        paused: element.paused
      })
    }

    console.log(`${this.DEBUG_PREFIX} play:start`, {
      id: id.substring(0, 8),
      page,
      muted: element.muted,
      globalMuted,
      readyState: element.readyState,
      paused: element.paused
    })

    // 播放
    try {
      await element.play()
      console.log(`${this.DEBUG_PREFIX} play:success`, {
        id: id.substring(0, 8),
        page,
        muted: element.muted,
        globalMuted,
        readyState: element.readyState,
        paused: element.paused
      })
      // 如果是强制静音启动，且全局原本未静音，播放成功后尝试恢复
      if (needForceMute) {
        setTimeout(() => {
          element.muted = false
          console.log(`${this.DEBUG_PREFIX} play:restore-unmute`, {
            id: id.substring(0, 8),
            page,
            muted: element.muted,
            globalMuted
          })
        }, 0)
      }
      this.scheduleStallCheck(id, page, element)
    } catch (error: any) {
      // AbortError 是正常的（视频在播放前被暂停）
      if (error.name === 'AbortError') {
        console.log('[VideoManager] ⏸️ 播放被中止（正常）', { id: id.substring(0, 8) })
        return
      }

      // 浏览器自动播放限制：自动切换为静音重试一次
      if (error.name === 'NotAllowedError') {
        console.warn(`${this.DEBUG_PREFIX} play:not-allowed`, {
          id: id.substring(0, 8),
          page,
          muted: element.muted,
          globalMuted: (window as any)?.isMuted,
          readyState: element.readyState,
          paused: element.paused,
          error
        })
        try {
          const prevMuted = element.muted
          element.muted = true
          await element.play()
          console.log('[VideoManager] ▶️ 静音重试成功', { id: id.substring(0, 8), page })
          // 如果全局未静音，尽量恢复用户期望（已触发播放后恢复通常不会被拦截）
          if (typeof window !== 'undefined' && !(window as any).isMuted && !prevMuted) {
            setTimeout(() => {
              element.muted = false
            }, 0)
          }
          this.scheduleStallCheck(id, page, element)
          return
        } catch (err) {
          console.error(`${this.DEBUG_PREFIX} play:retry-muted-fail`, {
            id: id.substring(0, 8),
            page,
            muted: element.muted,
            globalMuted: (window as any)?.isMuted,
            readyState: element.readyState,
            paused: element.paused,
            error: err
          })
        }
      }

      console.error(`${this.DEBUG_PREFIX} play:fail`, {
        id: id.substring(0, 8),
        page,
        muted: element.muted,
        globalMuted: (window as any)?.isMuted,
        readyState: element.readyState,
        paused: element.paused,
        error
      })
    }
  }

  /**
   * 暂停指定视频
   */
  pause(id: string) {
    const element = this.videoElements.get(id)
    if (element && !element.paused) {
      element.pause()
      console.log('[VideoManager] ⏸️ 暂停', { id: id.substring(0, 8) })
    }

    if (this.currentVideo?.id === id) {
      this.currentVideo = null
    }
  }

  /**
   * 暂停所有视频
   */
  pauseAll() {
    this.videoElements.forEach((element, id) => {
      if (!element.paused) {
        element.pause()
      }
    })
    this.currentVideo = null
  }

  /**
   * 切换播放/暂停
   */
  toggle(id: string, page: string) {
    const element = this.videoElements.get(id)
    if (!element) return

    if (element.paused) {
      this.play(id, page)
    } else {
      this.pause(id)
    }
  }

  /**
   * 获取当前播放的视频信息
   */
  getCurrent() {
    return this.currentVideo
  }

  /**
   * 清理指定页面的所有视频
   */
  clearPage(page: string) {
    const toRemove: string[] = []

    this.videoElements.forEach((element, id) => {
      // 检查是否属于该页面（通过 DOM 结构判断）
      const wrapper = element.closest('[data-page]')
      if (wrapper?.getAttribute('data-page') === page) {
        element.pause()
        element.currentTime = 0
        toRemove.push(id)
      }
    })

    toRemove.forEach((id) => this.videoElements.delete(id))

    if (this.currentVideo && toRemove.includes(this.currentVideo.id)) {
      this.currentVideo = null
    }

    console.log('[VideoManager] 清理页面', { page, count: toRemove.length })
  }

  /**
   * 获取当前注册的视频数量
   */
  getCount() {
    return this.videoElements.size
  }
}

// 导出单例
export const videoManager = new VideoManager()
