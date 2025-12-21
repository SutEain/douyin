<template>
  <div class="overlay" :class="{ landscape: state.landscape }">
    <div class="topbar">
      <div class="btn" @click="emit('close')">返回</div>
      <div class="title">
        <div class="t">{{ title || '直播中' }}</div>
        <div v-if="description" class="d">{{ description }}</div>
      </div>
      <div class="btn" @click="toggleOrientation">{{ state.landscape ? '竖屏' : '横屏' }}</div>
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

      <div v-if="state.showUnmuteHint" class="unmute">
        <div class="btn" @click="enableSound">点一下开声音</div>
      </div>

      <div v-if="state.errorText" class="error">
        <div class="msg">{{ state.errorText }}</div>
        <div class="actions">
          <div class="btn" @click="retry">重试</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
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
  showUnmuteHint: false
})

function retry() {
  state.errorText = ''
  state.playerKey++
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
    return
  }

  state.errorText = msg
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

onBeforeUnmount(() => {
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

.topbar {
  height: 48rem;
  padding: 0 12rem;
  display: flex;
  align-items: center;
  gap: 10rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex: 0 0 auto;
}

.btn {
  padding: 6rem 10rem;
  border-radius: 10rem;
  background: rgba(255, 255, 255, 0.1);
  font-size: 12rem;
  user-select: none;
  cursor: pointer;
  white-space: nowrap;
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
  .d {
    margin-top: 4rem;
    font-size: 11rem;
    color: rgba(255, 255, 255, 0.6);
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
  bottom: 22rem;
  display: flex;
  justify-content: center;
  z-index: 2;
}

.error {
  position: absolute;
  left: 12rem;
  right: 12rem;
  bottom: 12rem;
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
