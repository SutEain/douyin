<template>
  <div
    class="overlay"
    :class="{ landscape: state.landscape }"
    @click.capture="onTap"
    @pointerup.capture="onTap"
    @touchend.capture="onTap"
  >
    <!-- 悬浮 Header：默认显示，点击屏幕浮现，2秒后自动隐藏 -->
    <div class="header" :class="{ show: state.headerVisible }">
      <div class="header-bar">
        <div class="btn" @click.stop="onBack">返回</div>
        <div class="title">
          <div class="t">{{ title || '直播中' }}</div>
        </div>
        <div class="btn" @click.stop="onToggleOrientation">
          {{ state.landscape ? '竖屏' : '横屏' }}
        </div>
      </div>
    </div>

    <div class="player">
      <DPPlayer
        :key="state.playerKey"
        ref="dpRef"
        :src="src"
        :poster="poster"
        :muted="state.muted"
        :debug="debug"
        @error="onPlayerError"
      />

      <div v-if="state.showUnmuteHint" class="unmute" @click.stop="enableSound">
        <div class="btn primary">点一下开声音</div>
      </div>

      <div v-if="state.errorText" class="error" @click.stop>
        <div class="msg">{{ state.errorText }}</div>
        <div class="actions">
          <div class="btn primary" @click="retry">重试</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import DPPlayer from '@/components/live/DPPlayer.vue'

interface Props {
  src: string
  title?: string
  description?: string
  poster?: string
}

withDefaults(defineProps<Props>(), {
  title: '',
  description: '',
  poster: ''
})

const emit = defineEmits<{
  (e: 'close'): void
}>()

const debug = computed(() => {
  try {
    return new URLSearchParams(window.location.search).get('dpdebug') === '1'
  } catch {
    return false
  }
})

const state = reactive({
  landscape: false,
  errorText: '',
  playerKey: 1,
  muted: false,
  showUnmuteHint: false,
  headerVisible: true
})

function retry() {
  state.errorText = ''
  state.playerKey++
  showHeaderThenAutoHide()
}

function onPlayerError(payload: any) {
  // 这里展示给用户的文案尽量简洁；详细信息仍在 console（若开启 dpdebug）
  const name = payload?.detail?.name
  const msg = payload?.message || payload?.detail || '播放失败，请重试'

  // ✅ 默认有声音：先尝试 muted=false。如果被自动播放策略拦截，自动降级静音并重试。
  if (!state.muted && name === 'NotAllowedError') {
    state.muted = true
    state.showUnmuteHint = true
    state.errorText = ''
    state.playerKey++
    showHeaderThenAutoHide()
    return
  }

  state.errorText = msg
  showHeaderThenAutoHide()
}

const dpRef = ref<any>(null)

async function enableSound() {
  // 用户手势触发：尽量在同一点击里完成“开声+play”
  state.muted = false
  state.showUnmuteHint = false
  state.errorText = ''

  const ok = await dpRef.value?.unmuteAndPlay?.()
  if (!ok) {
    // 如果仍失败，回退到静音继续播
    state.muted = true
    state.showUnmuteHint = true
  }

  showHeaderThenAutoHide()
}

async function toggleOrientation() {
  state.landscape = !state.landscape

  // 优先使用 Screen Orientation API（支持则真横屏）
  try {
    const anyScreen: any = window.screen as any
    if (anyScreen?.orientation?.lock) {
      await anyScreen.orientation.lock(state.landscape ? 'landscape' : 'portrait')
    }
  } catch {
    // ignore：不支持就用 CSS 视觉横屏
  }
}

let hideTimer: any = null
let lastTapAt = 0

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function showHeaderThenAutoHide() {
  state.headerVisible = true
  clearHideTimer()
  hideTimer = setTimeout(() => {
    state.headerVisible = false
  }, 2000)
}

function onTap(e?: any) {
  // ✅ 防双触发：某些端会同时触发 click + pointer/touch
  const now = Date.now()
  if (now - lastTapAt < 250) return
  lastTapAt = now

  // B：显示状态再点一下立刻隐藏；隐藏状态点一下显示并计时
  if (state.headerVisible) {
    state.headerVisible = false
    clearHideTimer()
  } else {
    showHeaderThenAutoHide()
  }
}

function onBack() {
  showHeaderThenAutoHide()
  emit('close')
}

function onToggleOrientation() {
  showHeaderThenAutoHide()
  toggleOrientation()
}

onMounted(() => {
  // 1：首次进入先显示，再自动消失
  showHeaderThenAutoHide()
})

onBeforeUnmount(() => {
  clearHideTimer()
  // 尝试恢复竖屏（不保证成功）
  try {
    const anyScreen: any = window.screen as any
    anyScreen?.orientation?.unlock?.()
  } catch {
    /* noop */
  }
})
</script>

<style scoped lang="less">
.overlay {
  position: fixed;
  z-index: 9999;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background: #000;
  color: #fff;
  display: flex;
  flex-direction: column;
}

.header {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  z-index: 3;
  pointer-events: none;
  opacity: 0;
  transform: translateY(-6rem);
  transition:
    opacity 160ms ease,
    transform 160ms ease;

  &.show {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
}

.header-bar {
  padding: calc(8rem + env(safe-area-inset-top)) 12rem 10rem;
  display: flex;
  align-items: center;
  gap: 10rem;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.65),
    rgba(0, 0, 0, 0.35),
    rgba(0, 0, 0, 0)
  );
  backdrop-filter: blur(10px);
}

.btn {
  padding: 6rem 10rem;
  border-radius: 10rem;
  background: rgba(255, 255, 255, 0.1);
  font-size: 12rem;
  user-select: none;
  cursor: pointer;
  white-space: nowrap;

  &.primary {
    background: rgba(255, 255, 255, 0.18);
  }
}

.title {
  flex: 1 1 auto;
  min-width: 0;

  .t {
    font-size: 13rem;
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.player {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

.unmute {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 26rem;
  display: flex;
  justify-content: center;
  z-index: 2;
}

.error {
  position: absolute;
  left: 12rem;
  right: 12rem;
  bottom: 26rem;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12rem;
  padding: 10rem 12rem;
  backdrop-filter: blur(6px);

  .msg {
    font-size: 12rem;
    color: rgba(255, 160, 160, 0.95);
    line-height: 1.4;
  }

  .actions {
    margin-top: 10rem;
    display: flex;
    justify-content: flex-end;
    gap: 10rem;
  }
}

/* 视觉横屏：不支持 orientation.lock 的环境也能旋转显示 */
.overlay.landscape {
  transform: rotate(90deg);
  transform-origin: center;
  width: 100vh;
  height: 100vw;
  left: 50%;
  top: 50%;
  right: auto;
  bottom: auto;
  margin-left: -50vh;
  margin-top: -50vw;
}
</style>
