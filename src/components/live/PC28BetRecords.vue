<template>
  <Transition name="fade">
    <div v-if="show" class="pc28-records-overlay" @click.self="handleClose">
      <div class="pc28-records-modal">
        <div class="modal-header">
          <h3>下注记录</h3>
          <Icon icon="ion:close" class="close-btn" @click="handleClose" />
        </div>

        <div class="modal-content">
          <!-- 期号信息 -->
          <div v-if="currentRound" class="round-info">
            <div class="period">期号：{{ currentRound.period_number }}</div>
            <div class="status" :class="currentRound.status">
              {{ statusText[currentRound.status] }}
            </div>
            <!-- 已结算时显示开奖结果 -->
            <div
              v-if="currentRound.status === 'settled' && currentRound.result"
              class="result-display"
            >
              {{ formatResult(currentRound.result) }}
            </div>
            <div class="total-bet">总下注：{{ totalBetAmount.toFixed(2) }} 抖币</div>
          </div>

          <!-- 统计信息 -->
          <div v-if="bets.length > 0" class="stats">
            <div class="stat-item">
              <div class="stat-label">下注人数</div>
              <div class="stat-value">{{ uniqueUsers }}</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">总注数</div>
              <div class="stat-value">{{ bets.length }}</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">总金额</div>
              <div class="stat-value">{{ totalBetAmount.toFixed(2) }} 抖币</div>
            </div>
          </div>

          <!-- 下注记录列表 -->
          <div class="bets-list">
            <div v-if="bets.length === 0 && !isLoading" class="empty-bets">
              <Icon
                icon="mdi:information-outline"
                style="font-size: 48rem; color: rgba(255, 255, 255, 0.3); margin-bottom: 10rem"
              />
              <div>暂无下注记录</div>
            </div>

            <div v-if="isLoading" class="loading">
              <Icon
                icon="mdi:loading"
                class="spin"
                style="font-size: 24rem; color: rgba(255, 255, 255, 0.5)"
              />
              <div>加载中...</div>
            </div>

            <!-- 按用户分组显示 -->
            <div v-for="(userBets, userId) in groupedBets" :key="userId" class="user-bet-group">
              <div class="user-header">
                <div class="user-info">
                  <div class="user-name">{{ getUserName(userId) }}</div>
                  <div class="user-stats">
                    {{ userBets.length }} 注 · {{ getUserTotalAmount(userBets).toFixed(2) }} 抖币
                    <span
                      v-if="currentRound?.status === 'settled'"
                      class="user-profit"
                      :class="{
                        positive: getUserProfit(userBets) > 0,
                        negative: getUserProfit(userBets) < 0
                      }"
                    >
                      {{ getUserProfit(userBets) > 0 ? '盈利' : '亏损' }}：
                      {{ Math.abs(getUserProfit(userBets)).toFixed(2) }} 抖币
                    </span>
                  </div>
                </div>
              </div>
              <div class="user-bets">
                <div
                  v-for="bet in userBets"
                  :key="bet.id"
                  class="bet-item"
                  :class="{ win: bet.is_win, lose: bet.status === 'settled' && !bet.is_win }"
                >
                  <div class="bet-main">
                    <div class="bet-type">{{ getBetDisplayName(bet) }}</div>
                    <div class="bet-amount">{{ bet.amount }} 抖币</div>
                  </div>
                  <div class="bet-details">
                    <div class="detail-row">
                      <span>赔率：{{ bet.odds }}x</span>
                      <span class="bet-status" :class="bet.status">
                        <span v-if="bet.status === 'pending'">待结算</span>
                        <span v-else-if="bet.is_win" class="win-text"
                          >中奖 +{{ bet.user_gain }} 抖币</span
                        >
                        <span v-else class="lose-text">未中奖</span>
                      </span>
                    </div>
                    <div class="bet-time">{{ formatTime(bet.created_at) }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 主播盈亏统计（仅已结算时显示） -->
          <div v-if="currentRound?.status === 'settled'" class="anchor-profit">
            <div class="profit-label">主播盈亏</div>
            <div
              class="profit-amount"
              :class="{ positive: anchorProfit >= 0, negative: anchorProfit < 0 }"
            >
              {{ anchorProfit >= 0 ? '盈利' : '亏损' }}：{{ Math.abs(anchorProfit).toFixed(2) }}
              抖币
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { Icon } from '@iconify/vue'
import { PC28GameRound, PC28Bet } from '@/api/pc28'
import { getAllBets, getAllBetsForSettled } from '@/api/pc28'
import { supabase } from '@/utils/supabase'
import { _notice } from '@/utils'

const props = defineProps<{
  show: boolean
  currentRound: PC28GameRound | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

// 先声明所有变量
const bets = ref<PC28Bet[]>([])
const isLoading = ref(false)
const userProfiles = ref<Record<string, any>>({})
let betsChannel: any = null

const statusText = {
  betting: '下注中',
  sealed: '已封盘',
  settled: '已结算'
}

// 组件挂载时输出调试信息并获取数据
onMounted(() => {
  console.log(
    '[PC28BetRecords] Component mounted, show:',
    props.show,
    'currentRound:',
    props.currentRound
  )
  if (props.show && props.currentRound) {
    console.log('[PC28BetRecords] Fetching bets from onMounted...')
    fetchBets()
    setupRealtime()
  }
})

// 监听 show 和 currentRound 变化
watch(
  [() => props.show, () => props.currentRound],
  ([newShow, newRound], [oldShow, oldRound]) => {
    console.log('[PC28BetRecords] Props changed:', {
      show: { old: oldShow, new: newShow },
      currentRound: { old: oldRound?.id, new: newRound?.id }
    })

    // 当 show 为 true 且有 currentRound 时，获取数据
    if (newShow && newRound?.id) {
      console.log('[PC28BetRecords] Fetching bets from watch...')
      fetchBets()
      setupRealtime()
    } else if (!newShow) {
      // 当关闭时，清理 Realtime
      if (betsChannel) {
        supabase.removeChannel(betsChannel)
        betsChannel = null
      }
    }
  },
  { immediate: false }
)

// 按用户分组
const groupedBets = computed(() => {
  const groups: Record<string, PC28Bet[]> = {}
  bets.value.forEach((bet) => {
    if (!groups[bet.user_id]) {
      groups[bet.user_id] = []
    }
    groups[bet.user_id].push(bet)
  })
  // 按时间排序（最新的在前）
  Object.keys(groups).forEach((userId) => {
    groups[userId].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  })
  return groups
})

const uniqueUsers = computed(() => {
  return Object.keys(groupedBets.value).length
})

const totalBetAmount = computed(() => {
  return bets.value.reduce((sum, bet) => sum + Number(bet.amount), 0)
})

// 计算主播盈亏：总下注 - 总赔付
const anchorProfit = computed(() => {
  if (!props.currentRound || props.currentRound.status !== 'settled') return 0
  const totalPayout = props.currentRound.total_payout || 0
  return totalBetAmount.value - totalPayout
})

function getUserTotalAmount(userBets: PC28Bet[]): number {
  return userBets.reduce((sum, bet) => sum + Number(bet.amount), 0)
}

// 计算用户盈亏：总中奖金额 - 总下注金额
function getUserProfit(userBets: PC28Bet[]): number {
  const totalBet = userBets.reduce((sum, bet) => sum + Number(bet.amount), 0)
  const totalWin = userBets
    .filter((bet) => bet.status === 'settled' && bet.is_win)
    .reduce((sum, bet) => sum + Number(bet.user_gain || 0), 0)
  return totalWin - totalBet
}

function getUserName(userId: string): string {
  return userProfiles.value[userId]?.nickname || `用户${userId.slice(0, 8)}`
}

function getBetDisplayName(bet: PC28Bet): string {
  const names: Record<string, string> = {
    big: '大',
    small: '小',
    odd: '单',
    even: '双',
    big_odd: '大单',
    big_even: '大双',
    small_odd: '小单',
    small_even: '小双',
    extreme_big: '极大',
    extreme_small: '极小',
    pair: '对子',
    straight: '顺子',
    leopard: '豹子'
  }

  if (bet.bet_type === 'single_point') {
    return `单点${bet.bet_value}`
  }

  return names[bet.bet_type] || bet.bet_type
}

function formatTime(timeStr: string): string {
  const date = new Date(timeStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (seconds < 60) {
    return '刚刚'
  } else if (minutes < 60) {
    return `${minutes}分钟前`
  } else if (hours < 24) {
    return `${hours}小时前`
  } else {
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
}

// 格式化开奖结果：4+2+9=15 大 单 杂六
function formatResult(result: { num1: number; num2: number; num3: number; sum: number }): string {
  const { num1, num2, num3, sum } = result

  // 判断大小
  const bigSmall = sum >= 14 ? '大' : '小'

  // 判断单双
  const oddEven = sum % 2 === 1 ? '单' : '双'

  // 判断模式：豹子 > 对子 > 顺子 > 杂六
  const sortedNums = [num1, num2, num3].sort((a, b) => a - b)
  let pattern = ''

  if (num1 === num2 && num2 === num3) {
    pattern = '豹子'
  } else if (
    (num1 === num2 || num1 === num3 || num2 === num3) &&
    !(num1 === num2 && num2 === num3)
  ) {
    pattern = '对子'
  } else if (sortedNums[1] === sortedNums[0] + 1 && sortedNums[2] === sortedNums[1] + 1) {
    pattern = '顺子'
  } else {
    pattern = '杂六'
  }

  return `${num1}+${num2}+${num3}=${sum} ${bigSmall} ${oddEven} ${pattern}`
}

async function fetchBets() {
  if (!props.currentRound?.id) {
    bets.value = []
    return
  }

  isLoading.value = true
  try {
    console.log('[PC28] Fetching bets for round:', props.currentRound.id)
    // 如果已结算，使用所有用户可访问的API；否则使用主播专用API
    const allBets =
      props.currentRound.status === 'settled'
        ? await getAllBetsForSettled(props.currentRound.id)
        : await getAllBets(props.currentRound.id)
    console.log('[PC28] Fetched bets:', allBets.length, allBets)
    bets.value = allBets

    // 获取用户信息
    const userIds = [...new Set(allBets.map((bet) => bet.user_id))]
    if (userIds.length > 0) {
      const { data } = await supabase.from('profiles').select('id, nickname').in('id', userIds)

      if (data) {
        data.forEach((profile) => {
          userProfiles.value[profile.id] = profile
        })
      }
    }
  } catch (e: any) {
    console.error('[PC28] fetch bets error:', e)
    console.error('[PC28] Error details:', {
      message: e.message,
      code: e.code,
      details: e.details,
      hint: e.hint
    })
    _notice(e.message || '获取下注记录失败，请确认您是主播')
  } finally {
    isLoading.value = false
  }
}

function handleClose() {
  emit('close')
}

function setupRealtime() {
  if (!props.currentRound?.id) return

  if (betsChannel) {
    supabase.removeChannel(betsChannel)
  }

  betsChannel = supabase
    .channel(`pc28_all_bets_${props.currentRound.id}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'pc28_bets',
        filter: `round_id=eq.${props.currentRound.id}`
      },
      () => {
        fetchBets()
      }
    )
    .subscribe()
}

watch(
  () => props.show,
  (newVal) => {
    console.log('[PC28BetRecords] show changed:', newVal, 'currentRound:', props.currentRound)
    if (newVal && props.currentRound) {
      console.log('[PC28BetRecords] Fetching bets...')
      fetchBets()
      setupRealtime()
    } else {
      console.log(
        '[PC28BetRecords] Not fetching - show:',
        newVal,
        'currentRound:',
        props.currentRound
      )
    }
  }
)

watch(
  () => props.currentRound?.id,
  (newId, oldId) => {
    console.log('[PC28BetRecords] currentRound.id changed:', { old: oldId, new: newId })
    if (props.show && newId) {
      fetchBets()
      setupRealtime()
    }
  }
)

onBeforeUnmount(() => {
  console.log('[PC28BetRecords] Component unmounting, cleaning up...')
  if (betsChannel) {
    supabase.removeChannel(betsChannel)
    betsChannel = null
  }
})
</script>

<style scoped lang="less">
.pc28-records-overlay {
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

.pc28-records-modal {
  width: 100%;
  max-width: 600rem;
  max-height: 90vh;
  background: #1a1a1a;
  border-radius: 20rem;
  display: flex;
  flex-direction: column;
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

.round-info {
  display: flex;
  flex-direction: column;
  gap: 8rem;
  padding: 15rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10rem;
  margin-bottom: 15rem;
  color: white;
  font-size: 14rem;

  .period {
    font-weight: bold;
  }

  .status {
    &.betting {
      color: #4caf50;
    }

    &.sealed {
      color: #ff9800;
    }
  }

  .result-display {
    color: #2196f3;
    font-weight: bold;
    font-size: 16rem;
    padding: 10rem;
    background: rgba(33, 150, 243, 0.1);
    border-radius: 8rem;
    text-align: center;
  }

  .total-bet {
    color: #fe2c55;
    font-weight: bold;
  }
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10rem;
  margin-bottom: 20rem;
}

.stat-item {
  background: rgba(255, 255, 255, 0.05);
  padding: 15rem;
  border-radius: 10rem;
  text-align: center;

  .stat-label {
    color: rgba(255, 255, 255, 0.6);
    font-size: 12rem;
    margin-bottom: 5rem;
  }

  .stat-value {
    color: white;
    font-size: 18rem;
    font-weight: bold;
  }
}

.bets-list {
  min-height: 200rem;
}

.empty-bets,
.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60rem 20rem;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14rem;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.user-bet-group {
  margin-bottom: 20rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10rem;
  overflow: hidden;

  &:last-child {
    margin-bottom: 0;
  }
}

.user-header {
  padding: 12rem 15rem;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);

  .user-info {
    .user-name {
      color: white;
      font-size: 14rem;
      font-weight: bold;
      margin-bottom: 4rem;
    }

    .user-stats {
      color: rgba(255, 255, 255, 0.6);
      font-size: 12rem;
    }
  }
}

.user-bets {
  padding: 10rem;
  display: flex;
  flex-direction: column;
  gap: 8rem;
}

.bet-item {
  padding: 12rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8rem;
  border-left: 3px solid rgba(254, 44, 85, 0.5);

  &.win {
    border-left-color: #4caf50;
    background: rgba(76, 175, 80, 0.1);
  }

  &.lose {
    border-left-color: rgba(255, 255, 255, 0.3);
    opacity: 0.7;
  }
}

.bet-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8rem;

  .bet-type {
    color: white;
    font-size: 14rem;
    font-weight: bold;
  }

  .bet-amount {
    color: #fe2c55;
    font-size: 14rem;
    font-weight: bold;
  }
}

.bet-details {
  display: flex;
  flex-direction: column;
  gap: 4rem;
  font-size: 12rem;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  color: rgba(255, 255, 255, 0.6);

  .bet-status {
    &.pending {
      color: #ff9800;
    }

    .win-text {
      color: #4caf50;
      font-weight: bold;
    }

    .lose-text {
      color: rgba(255, 255, 255, 0.5);
    }
  }
}

.bet-time {
  color: rgba(255, 255, 255, 0.4);
}

.user-profit {
  margin-left: 10rem;
  font-weight: bold;

  &.positive {
    color: #4caf50;
  }

  &.negative {
    color: #ff5252;
  }
}

.anchor-profit {
  margin-top: 20rem;
  padding: 15rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10rem;
  text-align: center;
  border: 2px solid rgba(255, 255, 255, 0.1);

  .profit-label {
    color: rgba(255, 255, 255, 0.6);
    font-size: 14rem;
    margin-bottom: 8rem;
  }

  .profit-amount {
    font-size: 20rem;
    font-weight: bold;

    &.positive {
      color: #4caf50;
    }

    &.negative {
      color: #ff5252;
    }
  }
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
