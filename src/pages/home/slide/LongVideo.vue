<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { _checkImgUrl, _duration, _formatNumber, _stopPropagation } from '@/utils'
import { recommendedLongVideo } from '@/api/videos'
import ScrollList from '@/components/ScrollList.vue'
import { useNav } from '@/utils/hooks/useNav'
import { useVideoStore } from '@/stores/video'
import bus, { EVENT_KEY } from '@/utils/bus'

const props = defineProps({
  active: Boolean
})

const playingEl = ref()
const state = reactive({
  show: false,
  showSpeedPanel: false,
  playbackRate: 1
})

const videoStore = useVideoStore()
const isMuted = computed(() => videoStore.isMuted)

watch(
  () => props.active,
  (n) => {
    if (n) {
      if (state.show) {
        let el = playingEl.value
        if (el) {
          el.parentNode.parentNode.classList.remove('pause')
          el.play()
        }
      } else {
        state.show = true
      }
    } else {
      let el = playingEl.value
      if (el) {
        el.parentNode.parentNode.classList.add('pause')
        el.pause()
      }
    }
  },
  { immediate: true }
)

const obList = []

const vIsCanPlay = {
  mounted(el) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          let videoEls = document.querySelectorAll('.long-video video')
          videoEls.forEach((item) => {
            item.pause()
            if (item.parentNode?.parentNode) {
              item.parentNode.parentNode.classList.add('pause')
            }
          })
          el.parentNode.parentNode.classList.remove('pause')
          el.play()
          playingEl.value = el
          // 🎯 当前视频默认倍速 1.0（仅对当前视频生效）
          try {
            state.playbackRate = 1
            state.showSpeedPanel = false
            el.playbackRate = 1
          } catch {
            // ignore
          }
        } else {
          el.parentNode.parentNode.classList.add('pause')
          el.pause()
        }
      },
      { threshold: 0.5 }
    )
    observer.observe(el)
    obList.push(observer)
  },
  unmounted() {
    obList.map((v) => {
      v.disconnect()
    })
  }
}

const nav = useNav()
const fallbackAvatar = new URL('@/assets/img/icon/avatar/0.png', import.meta.url).href
const fallbackCover = new URL('@/assets/img/icon/me/code-bg.png', import.meta.url).href

function getDurationSeconds(item) {
  const d = item?.video?.duration ?? item?.duration ?? 0
  if (typeof d === 'number' && d > 10000) return Math.floor(d / 1000) // 兜底：老数据可能是 ms
  return d || 0
}

function toggleMute() {
  const next = !videoStore.isMuted
  videoStore.toggleMuted(next)
  // 兼容旧逻辑（feed 的静音也在用）
  window.isMuted = next
  bus.emit(next ? EVENT_KEY.ADD_MUTED : EVENT_KEY.REMOVE_MUTED)

  // 立即同步到页面内所有 video
  const videoEls = document.querySelectorAll('.long-video video')
  videoEls.forEach((v) => {
    try {
      v.muted = next
    } catch {
      // ignore
    }
  })
}

const speedOptions = [0.5, 1.0, 1.25, 1.5, 2.0]
function toggleSpeedPanel() {
  state.showSpeedPanel = !state.showSpeedPanel
}
function choosePlaybackRate(rate) {
  state.playbackRate = rate
  state.showSpeedPanel = false
  const el = playingEl.value
  if (el) {
    try {
      el.playbackRate = rate
    } catch {
      // ignore
    }
  }
}

function onVideoError(e) {
  const video = e.target
  if (video) {
    video.removeAttribute('src')
    video.load()
    video.parentNode?.parentNode?.classList.add('pause')
  }
}

function onCoverError(e) {
  if (e?.target) {
    e.target.src = fallbackCover
  }
}

function onAvatarError(e) {
  if (e?.target) {
    e.target.src = fallbackAvatar
  }
}
</script>

<template>
  <div class="long-video" @dragstart="(e) => _stopPropagation(e)">
    <ScrollList class="Scroll" v-if="state.show" :api="recommendedLongVideo">
      <template v-slot="{ list }">
        <!-- ✅ 短剧tab：后端接口已过滤图文/相册，仅返回视频 -->
        <template v-if="list?.length">
          <div class="list">
            <div
              class="item"
              @click="nav('/video-detail', {}, { items: list, index: i })"
              :class="[
                i % 9 === 0 && 'big',
                i % 9 === 0 ? '' : i % 2 === 1 && 'l',
                i % 9 === 0 ? '' : i % 2 === 0 && 'r'
              ]"
              :key="item?.aweme_id || item?.id || i"
              v-for="(item, i) in list"
            >
              <div class="video-wrapper" v-if="i % 9 === 0">
                <video
                  :muted="isMuted"
                  preload
                  loop
                  x5-video-player-type="h5-page"
                  :x5-video-player-fullscreen="false"
                  :webkit-playsinline="true"
                  :x5-playsinline="true"
                  :playsinline="true"
                  :fullscreen="false"
                  v-is-can-play
                  :poster="_checkImgUrl(item.video.cover.url_list[0])"
                  :src="item.video.play_addr.url_list[0]"
                  @error="onVideoError"
                ></video>
                <div class="options">
                  <div class="left"></div>
                  <div class="right">
                    <!-- ✅ 倍速按钮（仅当前视频生效） -->
                    <div class="option speed" @click.stop="toggleSpeedPanel">
                      <Icon icon="mdi:speedometer" />
                      <span class="text">{{ state.playbackRate }}x</span>
                      <div v-if="state.showSpeedPanel" class="speed-panel" @click.stop>
                        <div
                          v-for="r in speedOptions"
                          :key="r"
                          class="speed-item"
                          :class="{ active: state.playbackRate === r }"
                          @click="choosePlaybackRate(r)"
                        >
                          {{ r }}x
                        </div>
                      </div>
                    </div>
                    <!-- ✅ 仅保留声音按钮，并与 feed 静音状态同步 -->
                    <div class="option" @click.stop="toggleMute">
                      <Icon v-if="isMuted" icon="charm:sound-mute" />
                      <Icon v-else icon="akar-icons:sound-on" />
                    </div>
                  </div>
                </div>
              </div>
              <img
                v-else
                v-lazy="_checkImgUrl(item.video.cover.url_list[0])"
                alt=""
                class="poster"
                @error="onCoverError"
              />
              <div class="duration">{{ _duration(getDurationSeconds(item)) }}</div>
              <div class="title">
                {{ item.desc }}
              </div>
              <div class="bottom">
                <div class="l">
                  <img
                    v-lazy="_checkImgUrl(item.author.avatar_168x168.url_list[0])"
                    alt=""
                    class="avatar"
                    @error="onAvatarError"
                  />
                  <div class="name">{{ item.author.nickname }}</div>
                </div>
                <div class="r">
                  <Icon icon="icon-park-outline:like" />
                  <div class="num">
                    {{ _formatNumber(item.statistics.digg_count) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="empty">暂无短剧视频</div>
      </template>
    </ScrollList>
  </div>
</template>

<style scoped lang="less">
.long-video {
  font-size: 14rem;
  color: white;
  padding-top: var(--home-header-height);
  background: #000;

  .Scroll {
    height: calc(
      var(--vh, 1vh) * 100 - var(--home-header-height) - var(--footer-height)
    ) !important;
  }
}

.list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  row-gap: 22rem;
  box-sizing: border-box;

  .item {
    margin: 0 10rem;
    display: flex;
    flex-direction: column;
    gap: 10rem;
    position: relative;

    .poster {
      border-radius: 12rem;
      width: 100%;
      height: 140rem;
      object-fit: cover;
    }

    .video-wrapper {
      height: 220rem;
      position: relative;

      video {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .options {
        width: 100%;
        box-sizing: border-box;
        padding: 0 12rem;
        display: flex;
        position: absolute;
        bottom: 8rem;
        justify-content: space-between;
        align-items: center;
        color: white;

        .right {
          display: flex;
          align-items: center;
          gap: 10rem;
        }

        .option {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6rem;
          padding: 8rem;
          border-radius: 12rem;
          background: rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(6px);
        }

        .option .text {
          font-size: 12rem;
          color: rgba(255, 255, 255, 0.9);
        }

        .option.speed .speed-panel {
          position: absolute;
          right: 0;
          bottom: 44rem;
          background: rgba(0, 0, 0, 0.85);
          border-radius: 12rem;
          padding: 8rem;
          display: flex;
          flex-direction: column;
          gap: 6rem;
          min-width: 92rem;
          z-index: 50;
        }

        .option.speed .speed-item {
          font-size: 12rem;
          padding: 6rem 10rem;
          border-radius: 8rem;
          color: rgba(255, 255, 255, 0.9);
          user-select: none;
        }

        /* ✅ 去掉 active 高亮：当前倍速已在按钮文字显示 */

        img {
          width: 20rem;
        }

        svg {
          font-size: 20rem;
        }
      }
    }

    .title {
      // ✅ 保障两行完整显示，不被裁切
      min-height: 44rem;
      line-height: 22rem;
      color: white;
      font-size: 14rem;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box; //作为弹性伸缩盒子模型显示。
      -webkit-box-orient: vertical; //设置伸缩盒子的子元素排列方式--从上到下垂直排列
      -webkit-line-clamp: 2; //显示的行
    }

    .f {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 5rem;
    }

    .duration {
      color: white;
      position: absolute;
      bottom: 80rem;
      right: 10rem;
      font-size: 13rem;
    }

    .bottom {
      color: gray;
      .f;
      font-size: 13rem;

      .l {
        .f;
        justify-content: flex-start;

        .name {
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box; //作为弹性伸缩盒子模型显示。
          -webkit-box-orient: vertical; //设置伸缩盒子的子元素排列方式--从上到下垂直排列
          -webkit-line-clamp: 1; //显示的行
        }

        .avatar {
          @w: 20rem;
          width: @w;
          height: @w;
          object-fit: cover;
          border-radius: 50%;
        }
      }

      .r {
        word-break: keep-all;
        .f;

        svg {
          font-size: 16rem;
        }
      }
    }

    &.big {
      grid-column-start: 1;
      grid-column-end: 3;
      margin: 0;

      &.pause {
        .duration {
          display: block;
        }

        .options {
          display: none;
        }
      }

      .duration {
        display: none;
        bottom: 67rem;
      }

      .title {
        height: unset;
        -webkit-line-clamp: 1;
      }

      .title,
      .bottom {
        padding: 0 10rem;
      }
    }

    &.l {
      margin-right: 5rem;
    }

    &.r {
      margin-left: 5rem;
    }
  }
}

.empty {
  padding: 20rem var(--page-padding);
  color: var(--second-text-color);
  text-align: center;
}
</style>
