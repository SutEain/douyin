<template>
  <div class="pc28-anchor-control">
    <div class="control-header">
      <span class="title">PC28控制</span>
      <Icon icon="ion:close" class="close-btn" @click="handleClose" />
    </div>

    <div class="control-content">
      <!-- 当前期数状态 -->
      <div v-if="currentRound" class="round-status">
        <div class="status-item">
          <span class="label">期号：</span>
          <span class="value">{{ currentRound.period_number }}</span>
        </div>
        <div class="status-item">
          <span class="label">状态：</span>
          <span
            class="value"
            :class="{
              betting: currentRound.status === 'betting',
              sealed: currentRound.status === 'sealed',
              settled: currentRound.status === 'settled',
              cancelled: currentRound.status === 'cancelled'
            }"
          >
            {{ statusText[currentRound.status] }}
          </span>
        </div>
        <div v-if="currentRound.status === 'betting'" class="status-item">
          <span class="label">倒计时：</span>
          <span class="value countdown">{{ countdownText }}</span>
        </div>
        <div v-if="currentRound.status === 'betting'" class="status-item">
          <span class="label">总下注：</span>
          <span class="value">{{ roomBetAmount }} 抖币</span>
        </div>
        <div v-if="currentRound.result" class="status-item">
          <span class="label">开奖结果：</span>
          <span class="value result">
            {{ currentRound.result.num1 }} + {{ currentRound.result.num2 }} +
            {{ currentRound.result.num3 }} = {{ currentRound.result.sum }}
          </span>
        </div>
      </div>

      <div v-else class="no-round">
        <p>暂无进行中的期数</p>
      </div>

      <!-- 操作按钮 -->
      <div class="actions">
        <button class="btn-stop" @click="handleStop" :disabled="isLoading">
          {{ isLoading ? '处理中...' : '停止游戏' }}
        </button>

        <button
          v-if="currentRound && currentRound.status === 'sealed'"
          class="btn-cancel"
          @click="handleCancel"
          :disabled="isLoading"
        >
          {{ isLoading ? '处理中...' : '取消本期并退回' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Icon } from '@iconify/vue'
import type { PC28GlobalRound } from '@/api/pc28'
import { disablePC28ForRoom, cancelGlobalRound, getCurrentGlobalRound } from '@/api/pc28'
import { _notice } from '@/utils'
import { supabase } from '@/utils/supabase'

const props = defineProps<{
  roomId: string
  currentRound: PC28GlobalRound | null
  roomBetAmount: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'refresh'): void
}>()

const isLoading = ref(false)
const countdownTimer = ref<any>(null)
const currentTime = ref(Date.now())

const statusText = {
  betting: '下注中',
  sealed: '已封盘',
  settled: '已结算',
  cancelled: '已取消'
}

// 计算倒计时文本
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

function startCountdown() {
  if (countdownTimer.value) {
    clearInterval(countdownTimer.value)
    countdownTimer.value = null
  }

  if (
    props.currentRound?.seal_at &&
    (props.currentRound.status === 'betting' || props.currentRound.status === 'sealed')
  ) {
    currentTime.value = Date.now()
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

function handleClose() {
  emit('close')
}

async function handleStop() {
  if (!confirm('确定要停止PC28游戏吗？')) return

  isLoading.value = true
  try {
    const res = await disablePC28ForRoom(props.roomId)
    if (res.success) {
      _notice('PC28游戏已停止')
      emit('refresh')
      handleClose()
    } else {
      _notice(res.message || '停止失败')
    }
  } catch (e: any) {
    _notice(e.message || '停止失败')
  } finally {
    isLoading.value = false
  }
}

async function handleCancel() {
  if (!props.currentRound) return

  if (
    !confirm(`确定要取消本期（${props.currentRound.period_number}期）吗？\n将退回所有下注金额。`)
  ) {
    return
  }

  isLoading.value = true
  try {
    const res = await cancelGlobalRound(props.currentRound.id)
    if (res.success) {
      _notice(`取消成功，已退回 ${res.refund_count || 0} 个下注，共 ${res.total_refund || 0} 抖币`)
      emit('refresh')
    } else {
      _notice(res.message || '取消失败')
    }
  } catch (e: any) {
    _notice(e.message || '取消失败')
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped lang="less">
.pc28-anchor-control {
  position: fixed;
  bottom: 150rem;
  right: 15rem;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(10px);
  border-radius: 16rem;
  padding: 12rem;
  min-width: 200rem;
  max-width: 280rem;
  box-shadow: 0 4rem 12rem rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.control-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12rem;
  padding-bottom: 8rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);

  .title {
    color: white;
    font-size: 14rem;
    font-weight: bold;
  }

  .close-btn {
    color: rgba(255, 255, 255, 0.7);
    font-size: 18rem;
    cursor: pointer;
    transition: color 0.2s;

    &:hover {
      color: white;
    }
  }
}

.control-content {
  .round-status {
    margin-bottom: 16rem;

    .status-item {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8rem;
      font-size: 12rem;

      .label {
        color: rgba(255, 255, 255, 0.7);
      }

      .value {
        color: white;
        font-weight: bold;

        &.betting {
          color: #4caf50;
        }

        &.sealed {
          color: #ff9800;
        }

        &.settled {
          color: #2196f3;
        }

        &.cancelled {
          color: #f44336;
        }

        &.countdown {
          color: #fe2c55;
        }

        &.result {
          color: #ffd700;
        }
      }
    }
  }

  .no-round {
    text-align: center;
    color: rgba(255, 255, 255, 0.7);
    font-size: 12rem;
    padding: 20rem 0;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 8rem;

    button {
      padding: 10rem 16rem;
      border-radius: 8rem;
      border: none;
      font-size: 13rem;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.2s;

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    .btn-stop {
      background: #f44336;
      color: white;

      &:hover:not(:disabled) {
        background: #d32f2f;
      }
    }

    .btn-cancel {
      background: #ff9800;
      color: white;

      &:hover:not(:disabled) {
        background: #f57c00;
      }
    }
  }
}
</style>
