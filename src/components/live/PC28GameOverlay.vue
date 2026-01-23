<template>
  <div class="PC28GameOverlay">
    <!-- 合并的游戏挂件：如果有开盘显示期数状态，否则只显示游戏标识 -->
    <div v-if="config?.is_enabled" class="game-badge" @click="handleBadgeClick">
      <Icon icon="mdi:dice-multiple" class="game-icon" />
      <div class="game-content">
        <div class="game-text">{{ currentRound?.game_name || 'PC28' }}</div>
        <!-- 如果有开盘，显示期数和状态 -->
        <div v-if="currentRound" class="round-info">
          <div class="round-period">{{ currentRound.period_number }}期</div>
          <div class="round-status" :class="currentRound.status">
            {{ statusText[currentRound.status] }}
          </div>
          <!-- 只在状态为下注中时显示倒计时 -->
          <div
            v-if="currentRound.status === 'betting' && currentRound.seal_at && countdownText"
            class="countdown"
          >
            {{ countdownText }}
          </div>
          <!-- 已结算时显示结果 -->
          <div v-if="currentRound.status === 'settled' && currentRound.result" class="result-info">
            {{ currentRound.result.num1 }}+{{ currentRound.result.num2 }}+{{
              currentRound.result.num3
            }}={{ currentRound.result.sum }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { PC28GameConfig, PC28GameRound, autoSealPC28Rounds } from '@/api/pc28'
import { supabase } from '@/utils/supabase'

const props = defineProps<{
  roomId: string
  config: PC28GameConfig | null
  currentRound: PC28GameRound | null
  isAnchor?: boolean
}>()

const emit = defineEmits<{
  (e: 'open-bet'): void
  (e: 'open-records'): void
}>()

const statusText = {
  betting: '下注中',
  sealed: '已封盘',
  settled: '已结算'
}

const countdownTimer = ref<any>(null)
const currentTime = ref(Date.now())

// 使用computed来响应式计算倒计时文本
const countdownText = computed(() => {
  if (!props.currentRound?.seal_at) return ''

  const sealTime = new Date(props.currentRound.seal_at).getTime()
  const diff = Math.max(0, Math.floor((sealTime - currentTime.value) / 1000))

  if (diff <= 0) {
    return '已封盘'
  }

  const minutes = Math.floor(diff / 60)
  const seconds = diff % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
})

function handleBadgeClick() {
  console.log('[PC28GameOverlay] Badge clicked, isAnchor:', props.isAnchor)
  // 如果已结算，所有用户都打开下注记录面板查看结算信息
  // 主播点击：打开下注记录面板
  // 用户点击：已结算时打开下注记录面板，未结算时打开下注面板
  if (props.isAnchor || props.currentRound?.status === 'settled') {
    console.log('[PC28GameOverlay] Emitting open-records')
    emit('open-records')
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

  // 如果有封盘时间且状态是下注中或已封盘，启动倒计时
  if (
    props.currentRound?.seal_at &&
    (props.currentRound.status === 'betting' || props.currentRound.status === 'sealed')
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
  display: flex;
  flex-direction: column;
  gap: 10rem;
}

.game-badge {
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(10px);
  padding: 10rem 15rem;
  border-radius: 20rem;
  display: flex;
  align-items: center;
  gap: 8rem;
  cursor: pointer;
  box-shadow: 0 4rem 12rem rgba(0, 0, 0, 0.3);
  animation: pulse 2s infinite ease-in-out;
  min-width: 120rem;
  border: 1px solid rgba(255, 255, 255, 0.2);

  .game-icon {
    font-size: 24rem;
    color: white;
    flex-shrink: 0;
  }

  .game-content {
    display: flex;
    flex-direction: column;
    gap: 4rem;
    flex: 1;
  }

  .game-text {
    color: white;
    font-size: 14rem;
    font-weight: bold;
  }

  .round-info {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .round-period {
    color: rgba(255, 255, 255, 0.9);
    font-size: 12rem;
    font-weight: bold;
  }

  .round-status {
    color: #4caf50;
    font-size: 11rem;
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
    font-size: 11rem;
    font-weight: bold;
    margin-top: 2rem;
  }

  .countdown {
    color: #fe2c55;
    font-size: 11rem;
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
