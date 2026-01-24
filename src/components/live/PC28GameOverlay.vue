<template>
  <div class="PC28GameOverlay">
    <div class="badges-container">
      <!-- 当前开盘的挂件（只显示betting或sealed状态，不显示cancelled） -->
      <div
        v-if="
          currentRound && currentRound.status !== 'settled' && currentRound.status !== 'cancelled'
        "
        class="game-badge"
        @click="handleBadgeClick(currentRound)"
      >
        <div class="game-content">
          <div class="game-text">PC28</div>
          <div class="round-info">
            <div class="round-period">{{ currentRound.period_number }}期</div>
            <!-- 根据状态显示对应的文本：betting显示"下注中"，sealed显示"已封盘" -->
            <div
              v-if="currentRound.status === 'betting' || currentRound.status === 'sealed'"
              class="round-status"
              :class="currentRound.status"
            >
              {{ currentRound.status === 'betting' ? '下注中' : '已封盘' }}
            </div>
            <!-- 只在状态为下注中时显示倒计时 -->
            <div
              v-if="currentRound.status === 'betting' && currentRound.seal_at && countdownText"
              class="countdown"
            >
              {{ countdownText }}
            </div>
          </div>
        </div>
      </div>

      <!-- 已结算的挂件（显示已结算的round列表） -->
      <div
        v-for="settledRound in displaySettledRounds"
        :key="settledRound.id"
        class="game-badge settled-badge"
        @click="handleBadgeClick(settledRound)"
      >
        <div class="game-content">
          <div class="game-text">PC28</div>
          <div class="round-info">
            <div class="round-period">{{ settledRound.period_number }}期</div>
            <div class="round-status settled">已结算</div>
            <!-- 已结算时显示结果 -->
            <div v-if="settledRound.result" class="result-info">
              {{ settledRound.result.num1 }}+{{ settledRound.result.num2 }}+{{
                settledRound.result.num3
              }}={{ settledRound.result.sum }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import type { PC28GlobalRound } from '@/api/pc28'
import { supabase } from '@/utils/supabase'

const props = defineProps<{
  roomId: string
  currentRound: PC28GlobalRound | null
  lastSettledRound?: PC28GlobalRound | null
  isAnchor?: boolean
}>()

const emit = defineEmits<{
  (e: 'open-bet'): void
  (e: 'open-records', round: PC28GlobalRound): void
}>()

// 计算要显示的已结算round列表：
// 1. 如果当前期是已结算，显示当前期和上一期（共2个）
// 2. 如果当前期不是已结算，只显示上一期（1个）
const displaySettledRounds = computed(() => {
  const rounds: PC28GlobalRound[] = []

  // 如果当前期是已结算，先添加当前期
  if (props.currentRound?.status === 'settled') {
    rounds.push(props.currentRound)
  }

  // 如果存在上一期的已结算round，且不是当前期，添加它
  if (props.lastSettledRound && props.lastSettledRound.id !== props.currentRound?.id) {
    rounds.push(props.lastSettledRound)
  }

  return rounds
})

const statusText = {
  betting: '下注中',
  sealed: '已封盘',
  settled: '已结算',
  cancelled: '已取消'
}

const countdownTimer = ref<any>(null)
const currentTime = ref(Date.now())

// 使用computed来响应式计算倒计时文本
const countdownText = computed(() => {
  if (!props.currentRound?.seal_at) return ''

  try {
    // 🎯 统一使用北京时间（UTC+8）
    // seal_at 是数据库存储的 UTC 时间（ISO 8601 格式）
    // 需要正确解析为 UTC 时间戳，然后与当前 UTC 时间比较
    let sealAtStr = props.currentRound.seal_at

    // 标准化时间格式：确保是 ISO 8601 格式
    if (sealAtStr.includes(' ') && sealAtStr.includes('+')) {
      // "2026-01-25 03:39:45+00" -> "2026-01-25T03:39:45Z"
      sealAtStr = sealAtStr.replace(' ', 'T').replace('+00', 'Z').replace('+08:00', 'Z')
    } else if (sealAtStr.includes(' ') && !sealAtStr.includes('T')) {
      // "2026-01-25 03:39:45" -> "2026-01-25T03:39:45Z" (假设是 UTC)
      sealAtStr = sealAtStr.replace(' ', 'T') + 'Z'
    }

    // 解析为 UTC 时间戳（毫秒）
    const sealTime = new Date(sealAtStr).getTime()

    // 检查解析是否成功
    if (isNaN(sealTime)) {
      console.error('[PC28GameOverlay] Invalid seal_at format:', props.currentRound.seal_at)
      return ''
    }

    // currentTime.value 是 Date.now()，返回的是 UTC 时间戳（毫秒）
    // sealTime 也是 UTC 时间戳，两者可以直接相减
    const diff = Math.max(0, Math.floor((sealTime - currentTime.value) / 1000))

    // 如果倒计时结束，返回空字符串（不显示任何文本）
    if (diff <= 0) {
      return ''
    }

    const minutes = Math.floor(diff / 60)
    const seconds = diff % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  } catch (e) {
    console.error('[PC28GameOverlay] Error calculating countdown:', e)
    return ''
  }
})

function handleBadgeClick(round: PC28GlobalRound) {
  console.log('[PC28GameOverlay] Badge clicked, isAnchor:', props.isAnchor, 'round:', round)
  // 如果已结算，所有用户都打开下注记录面板查看结算信息
  // 主播点击：打开下注记录面板
  // 用户点击：已结算时打开下注记录面板，未结算时打开下注面板
  if (props.isAnchor || round.status === 'settled') {
    console.log('[PC28GameOverlay] Emitting open-records')
    emit('open-records', round)
  } else {
    console.log('[PC28GameOverlay] Emitting open-bet')
    emit('open-bet')
  }
}

function startCountdown() {
  // 清除旧的定时器
  if (countdownTimer.value) {
    clearInterval(countdownTimer.value)
    countdownTimer.value = null
  }

  // 如果有封盘时间且状态不是已结算或已取消，启动倒计时
  if (
    props.currentRound?.seal_at &&
    props.currentRound.status !== 'settled' &&
    props.currentRound.status !== 'cancelled'
  ) {
    // 立即更新一次
    currentTime.value = Date.now()

    // 每秒更新当前时间，触发computed重新计算
    countdownTimer.value = setInterval(() => {
      currentTime.value = Date.now()
    }, 1000)
  }
}

function stopCountdown() {
  if (countdownTimer.value) {
    clearInterval(countdownTimer.value)
    countdownTimer.value = null
  }
}

// 监听currentRound变化，重新启动倒计时
watch(
  () => props.currentRound,
  () => {
    stopCountdown()
    startCountdown()
  },
  { deep: true }
)

onMounted(() => {
  startCountdown()
})

onBeforeUnmount(() => {
  stopCountdown()
})
</script>

<style scoped lang="less">
.PC28GameOverlay {
  position: fixed;
  top: 100rem;
  right: 15rem;
  z-index: 900;
  pointer-events: auto;
  max-height: calc(100vh - 200rem);
  overflow-y: auto;
  overflow-x: hidden;
  /* 完全隐藏滚动条 */
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE and Edge */

  &::-webkit-scrollbar {
    display: none; /* Chrome, Safari, Opera */
  }

  .badges-container {
    display: flex;
    flex-direction: column;
    gap: 10rem;
  }
}

.game-badge {
  background: rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(6px);
  padding: 8rem 10rem;
  border-radius: 16rem;
  display: flex;
  align-items: center;
  gap: 0;
  cursor: pointer;
  box-shadow: 0 4rem 12rem rgba(0, 0, 0, 0.1);
  animation: pulse 2s infinite ease-in-out;
  min-width: auto;
  max-width: 140rem;
  border: 1px solid rgba(255, 255, 255, 0.1);

  .game-content {
    display: flex;
    flex-direction: column;
    gap: 3rem;
    flex: 1;
    width: 100%;
  }

  .game-text {
    color: white;
    font-size: 13rem;
    font-weight: bold;
  }

  .round-info {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .round-period {
    color: rgba(255, 255, 255, 0.9);
    font-size: 11rem;
    font-weight: bold;
  }

  .round-status {
    color: #4caf50;
    font-size: 10rem;
    font-weight: bold;

    &.sealed {
      color: #ff9800;
    }

    &.settled {
      color: #2196f3;
    }
  }

  .result-info {
    color: rgba(255, 255, 255, 0.9);
    font-size: 10rem;
    font-weight: bold;
    margin-top: 2rem;
  }

  .countdown {
    color: #fe2c55;
    font-size: 10rem;
    font-weight: bold;
  }
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}
</style>
