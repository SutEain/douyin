<template>
  <Transition name="fade">
    <div v-if="show" class="pc28-control-overlay" @click.self="handleClose">
      <div class="pc28-control-modal">
        <div class="modal-header">
          <h3>快三类游戏控制</h3>
          <Icon icon="ion:close" class="close-btn" @click="handleClose" />
        </div>

        <div class="modal-content">
          <!-- 当前期数状态 -->
          <div v-if="currentRound" class="round-status">
            <div class="status-item">
              <span class="label">游戏名称：</span>
              <span class="value">{{ currentRound.game_name || 'PC28' }}</span>
            </div>
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
                  settled: currentRound.status === 'settled'
                }"
              >
                {{ statusText[currentRound.status] }}
              </span>
            </div>
            <div v-if="currentRound.status === 'betting'" class="status-item">
              <span class="label">总下注：</span>
              <span class="value">{{ currentRound.total_bet_amount || 0 }} 抖币</span>
            </div>
            <div v-if="currentRound.result" class="status-item">
              <span class="label">开奖结果：</span>
              <span class="value result">
                {{ currentRound.result.num1 }} + {{ currentRound.result.num2 }} +
                {{ currentRound.result.num3 }} = {{ currentRound.result.sum }}
              </span>
            </div>
          </div>

          <!-- 开盘 -->
          <div v-if="!currentRound || currentRound.status === 'settled'" class="control-section">
            <h4>开盘</h4>
            <div class="input-group">
              <label>游戏名称</label>
              <input
                type="text"
                v-model="openForm.gameName"
                placeholder="如：PC28、北京快三、上海快三等"
              />
            </div>
            <div class="input-group">
              <label>期号</label>
              <input type="text" v-model="openForm.periodNumber" placeholder="请输入期号" />
            </div>
            <div class="input-group">
              <label>封盘倒计时（分钟，可选）</label>
              <input
                type="number"
                v-model.number="openForm.countdownMinutes"
                placeholder="留空则手动封盘"
                min="1"
              />
            </div>
            <button class="btn-primary" @click="handleOpen" :disabled="isLoading">
              {{ isLoading ? '开盘中...' : '开盘' }}
            </button>
          </div>

          <!-- 封盘 -->
          <div v-if="currentRound && currentRound.status === 'betting'" class="control-section">
            <button class="btn-warning" @click="handleSeal" :disabled="isLoading">
              {{ isLoading ? '封盘中...' : '封盘' }}
            </button>
          </div>

          <!-- 结算 -->
          <div v-if="currentRound && currentRound.status === 'sealed'" class="control-section">
            <h4>结算</h4>

            <!-- 第一个数字选择 -->
            <div class="number-select-group">
              <label>第一个数字</label>
              <div class="number-buttons">
                <button
                  v-for="num in 10"
                  :key="num - 1"
                  class="number-btn"
                  :class="{ active: settleForm.num1 === num - 1 }"
                  @click="settleForm.num1 = num - 1"
                >
                  {{ num - 1 }}
                </button>
              </div>
            </div>

            <!-- 第二个数字选择 -->
            <div class="number-select-group">
              <label>第二个数字</label>
              <div class="number-buttons">
                <button
                  v-for="num in 10"
                  :key="num - 1"
                  class="number-btn"
                  :class="{ active: settleForm.num2 === num - 1 }"
                  @click="settleForm.num2 = num - 1"
                >
                  {{ num - 1 }}
                </button>
              </div>
            </div>

            <!-- 第三个数字选择 -->
            <div class="number-select-group">
              <label>第三个数字</label>
              <div class="number-buttons">
                <button
                  v-for="num in 10"
                  :key="num - 1"
                  class="number-btn"
                  :class="{ active: settleForm.num3 === num - 1 }"
                  @click="settleForm.num3 = num - 1"
                >
                  {{ num - 1 }}
                </button>
              </div>
            </div>

            <div
              v-if="
                settleForm.num1 !== null && settleForm.num2 !== null && settleForm.num3 !== null
              "
              class="result-preview"
            >
              结果预览：{{ settleForm.num1 }} + {{ settleForm.num2 }} + {{ settleForm.num3 }} =
              {{ settleForm.num1 + settleForm.num2 + settleForm.num3 }}
            </div>
            <button class="btn-danger" @click="handleSettle" :disabled="isLoading || !canSettle">
              {{ isLoading ? '结算中...' : '确认结算' }}
            </button>
          </div>

          <!-- 结束游戏 -->
          <div class="control-section danger-section">
            <h4>游戏管理</h4>
            <button class="btn-danger" @click="handleCloseGame" :disabled="isLoading">
              {{ isLoading ? '处理中...' : '结束游戏' }}
            </button>
            <div class="danger-tip">结束游戏后将关闭PC28功能，当前未结算的期数需要先结算</div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Icon } from '@iconify/vue'
import type { PC28GameRound } from '@/api/pc28'
import {
  openPC28Round,
  sealRound,
  settlePC28Round,
  autoSealPC28Rounds,
  closePC28Game
} from '@/api/pc28'
import { _notice } from '@/utils'

const props = defineProps<{
  show: boolean
  currentRound: PC28GameRound | null
  roomId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'refresh'): void
}>()

const isLoading = ref(false)

// 从localStorage读取上次的期号
const getLastPeriodNumber = (): string => {
  try {
    return localStorage.getItem('pc28_last_period_number') || ''
  } catch {
    return ''
  }
}

const openForm = ref({
  periodNumber: getLastPeriodNumber(),
  gameName: 'PC28',
  countdownMinutes: null as number | null
})

const settleForm = ref({
  num1: null as number | null,
  num2: null as number | null,
  num3: null as number | null
})

const statusText = {
  betting: '下注中',
  sealed: '已封盘',
  settled: '已结算'
}

const canSettle = computed(() => {
  return (
    settleForm.value.num1 !== null &&
    settleForm.value.num2 !== null &&
    settleForm.value.num3 !== null &&
    settleForm.value.num1 >= 0 &&
    settleForm.value.num1 <= 9 &&
    settleForm.value.num2 >= 0 &&
    settleForm.value.num2 <= 9 &&
    settleForm.value.num3 >= 0 &&
    settleForm.value.num3 <= 9
  )
})

function handleClose() {
  emit('close')
}

async function handleOpen() {
  if (!openForm.value.gameName.trim()) {
    _notice('请输入游戏名称')
    return
  }
  if (!openForm.value.periodNumber.trim()) {
    _notice('请输入期号')
    return
  }

  isLoading.value = true
  try {
    const sealAt = openForm.value.countdownMinutes
      ? new Date(Date.now() + openForm.value.countdownMinutes * 60 * 1000)
      : undefined

    const res = await openPC28Round(
      props.roomId,
      openForm.value.periodNumber.trim(),
      openForm.value.gameName.trim(),
      sealAt
    )
    if (res.success) {
      _notice('开盘成功')
      // 保存当前期号到localStorage，作为下次的默认值
      try {
        localStorage.setItem('pc28_last_period_number', openForm.value.periodNumber.trim())
      } catch {
        // localStorage可能不可用，忽略错误
      }
      openForm.value.periodNumber = ''
      openForm.value.gameName = 'PC28'
      openForm.value.countdownMinutes = null
      emit('refresh')
    } else {
      _notice(res.message || '开盘失败')
    }
  } catch (e: any) {
    _notice(e.message || '开盘失败')
  } finally {
    isLoading.value = false
  }
}

async function handleSeal() {
  if (!props.currentRound) return

  isLoading.value = true
  try {
    const res = await sealRound(props.currentRound.id)
    if (res.success) {
      _notice('封盘成功')
      emit('refresh')
    } else {
      _notice(res.message || '封盘失败')
    }
  } catch (e: any) {
    _notice(e.message || '封盘失败')
  } finally {
    isLoading.value = false
  }
}

async function handleSettle() {
  if (!props.currentRound || !canSettle.value) return

  // 二次确认
  if (
    !confirm(
      `确认结算？结果：${settleForm.value.num1} + ${settleForm.value.num2} + ${settleForm.value.num3} = ${settleForm.value.num1! + settleForm.value.num2! + settleForm.value.num3!}`
    )
  ) {
    return
  }

  isLoading.value = true
  try {
    const res = await settlePC28Round(
      props.currentRound.id,
      settleForm.value.num1!,
      settleForm.value.num2!,
      settleForm.value.num3!
    )
    if (res.success) {
      const totalBetAmount = Number(res.total_bet_amount) || 0
      const totalPayout = Number(res.total_payout) || 0
      const profit = totalBetAmount - totalPayout

      // 显示详细的结算信息
      const message = `结算成功！总下注：${totalBetAmount.toFixed(2)} 抖币，总赔付：${totalPayout.toFixed(2)} 抖币，${profit >= 0 ? '盈利' : '亏损'}：${Math.abs(profit).toFixed(2)} 抖币`
      _notice(message)

      settleForm.value.num1 = null
      settleForm.value.num2 = null
      settleForm.value.num3 = null
      emit('refresh')
    } else {
      _notice(res.message || '结算失败')
    }
  } catch (e: any) {
    _notice(e.message || '结算失败')
  } finally {
    isLoading.value = false
  }
}

// 检查并自动封盘
async function checkAndAutoSeal() {
  if (!props.currentRound) return

  // 如果状态是betting但seal_at时间已过，自动封盘
  if (props.currentRound.status === 'betting' && props.currentRound.seal_at) {
    const sealTime = new Date(props.currentRound.seal_at).getTime()
    if (Date.now() >= sealTime) {
      try {
        await autoSealPC28Rounds()
        emit('refresh') // 刷新数据
      } catch (e: any) {
        console.error('[PC28] Auto seal error:', e)
      }
    }
  }
}

async function handleCloseGame() {
  if (!props.roomId) return

  // 检查是否有未结算的期数
  const hasUnsettledRound = props.currentRound && props.currentRound.status !== 'settled'

  // 二次确认
  let confirmMessage = '确认结束游戏？结束后将关闭PC28功能，用户将无法继续下注。'
  if (hasUnsettledRound) {
    confirmMessage = `确认结束游戏？\n存在未结算的期数（${props.currentRound.period_number}期），系统将自动退还所有用户的下注金额。\n结束后将关闭PC28功能。`
  }

  if (!confirm(confirmMessage)) {
    return
  }

  isLoading.value = true
  try {
    const res = await closePC28Game(props.roomId)
    if (res.success) {
      if (res.refund_count && res.refund_count > 0) {
        _notice(`游戏已结束，已退还 ${res.total_refund} 抖币给 ${res.refund_count} 位用户`)
      } else {
        _notice('游戏已结束')
      }
      emit('refresh')
      handleClose()
    } else {
      _notice(res.message || '结束游戏失败')
    }
  } catch (e: any) {
    _notice(e.message || '结束游戏失败')
  } finally {
    isLoading.value = false
  }
}

// 监听currentRound变化，检查是否需要自动封盘
watch(
  () => props.currentRound,
  () => {
    checkAndAutoSeal()
  },
  { immediate: true, deep: true }
)

let checkInterval: any = null

// 组件挂载时也检查一次
onMounted(() => {
  checkAndAutoSeal()

  // 每5秒检查一次是否需要自动封盘
  checkInterval = setInterval(() => {
    checkAndAutoSeal()
  }, 5000)
})

onBeforeUnmount(() => {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
})
</script>

<style scoped lang="less">
.pc28-control-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20rem;
}

.pc28-control-modal {
  width: 100%;
  max-width: 400rem;
  background: #1a1a1a;
  border-radius: 20rem;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);

  h3 {
    color: white;
    font-size: 18rem;
    margin: 0;
  }

  .close-btn {
    font-size: 24rem;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
  }
}

.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20rem;
}

.round-status {
  background: rgba(255, 255, 255, 0.05);
  padding: 15rem;
  border-radius: 10rem;
  margin-bottom: 20rem;
}

.status-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10rem;
  color: white;
  font-size: 14rem;

  &:last-child {
    margin-bottom: 0;
  }

  .label {
    color: rgba(255, 255, 255, 0.6);
  }

  .value {
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

    &.result {
      color: #fe2c55;
      font-size: 16rem;
    }
  }
}

.control-section {
  margin-bottom: 20rem;

  h4 {
    color: white;
    font-size: 16rem;
    margin-bottom: 15rem;
  }
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 5rem;
  margin-bottom: 15rem;

  label {
    color: rgba(255, 255, 255, 0.8);
    font-size: 14rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  input {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    padding: 10rem;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8rem;
    color: white;
    font-size: 14rem;

    &:focus {
      outline: none;
      border-color: #fe2c55;
    }
  }
}

.number-select-group {
  margin-bottom: 20rem;
  display: flex;
  flex-direction: column;
  gap: 10rem;

  label {
    color: rgba(255, 255, 255, 0.8);
    font-size: 14rem;
    font-weight: bold;
  }

  .number-buttons {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6rem;
  }

  .number-btn {
    padding: 8rem;
    background: rgba(255, 255, 255, 0.1);
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 6rem;
    color: white;
    font-size: 14rem;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.3s;
    min-width: 0;
    aspect-ratio: 1;

    &:hover {
      background: rgba(255, 255, 255, 0.2);
      border-color: #fe2c55;
      transform: scale(1.05);
    }

    &.active {
      background: linear-gradient(135deg, #fe2c55 0%, #ff6b9d 100%);
      border-color: #fe2c55;
      box-shadow: 0 2rem 8rem rgba(254, 44, 85, 0.4);
    }
  }
}

.result-preview {
  padding: 10rem;
  background: rgba(254, 44, 85, 0.2);
  border-radius: 8rem;
  color: #fe2c55;
  font-size: 16rem;
  font-weight: bold;
  text-align: center;
  margin-bottom: 15rem;
}

button {
  width: 100%;
  padding: 12rem;
  border-radius: 10rem;
  font-size: 16rem;
  font-weight: bold;
  border: none;
  cursor: pointer;
  transition: opacity 0.3s;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn-primary {
  background: #4caf50;
  color: white;
}

.btn-warning {
  background: #ff9800;
  color: white;
}

.btn-danger {
  background: #fe2c55;
  color: white;
}

.danger-section {
  margin-top: 30rem;
  padding-top: 20rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);

  h4 {
    color: #ff9800;
    margin-bottom: 10rem;
  }
}

.danger-tip {
  margin-top: 8rem;
  color: rgba(255, 152, 0, 0.8);
  font-size: 12rem;
  text-align: center;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
