<template>
  <Transition name="slide-up">
    <div v-if="show" class="pc28-bet-overlay" @click.self="handleClose">
      <div class="pc28-bet-panel">
        <div class="panel-header">
          <span>PC28下注</span>
          <div class="header-right">
            <div class="coin-info">
              <img src="../../assets/img/icon/home/redpack.png" alt="" />
              <span>{{ userBalance.toFixed(2) }} 抖币</span>
              <Icon
                icon="solar:refresh-bold"
                class="refresh-btn"
                @click="refreshBalance"
                style="font-size: 16rem; margin-left: 5rem; cursor: pointer; opacity: 0.8"
              />
            </div>
            <Icon icon="ion:close" class="close-btn" @click="handleClose" />
          </div>
        </div>

        <div class="panel-content">
          <!-- 期号信息 -->
          <div v-if="currentRound" class="round-info">
            <div class="period">期号：{{ currentRound.period_number }}</div>
            <div class="status" :class="currentRound.status">
              {{ statusText[currentRound.status] }}
            </div>
          </div>

          <!-- 玩法选择 -->
          <div class="bet-tabs">
            <div
              v-for="tab in tabs"
              :key="tab.key"
              class="tab-item"
              :class="{ active: activeTab === tab.key }"
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </div>
            <div
              class="tab-item"
              :class="{ active: activeTab === 'my_bets' }"
              @click="activeTab = 'my_bets'"
            >
              我的下注
            </div>
            <div
              class="tab-item"
              :class="{ active: activeTab === 'transactions' }"
              @click="activeTab = 'transactions'"
            >
              账变记录
            </div>
          </div>

          <!-- 我的下注记录 -->
          <div v-if="activeTab === 'my_bets'" class="my-bets-list">
            <div v-if="myBets.length === 0" class="empty-bets">
              <Icon
                icon="mdi:information-outline"
                style="font-size: 48rem; color: rgba(255, 255, 255, 0.3); margin-bottom: 10rem"
              />
              <div>暂无下注记录</div>
            </div>
            <div v-for="bet in myBets" :key="bet.id" class="bet-record">
              <div class="bet-record-header">
                <div class="bet-type-name">{{ getBetDisplayName(bet) }}</div>
                <div class="bet-status" :class="bet.status">
                  <span v-if="bet.status === 'pending'">待结算</span>
                  <span v-else-if="bet.is_win" class="win">中奖</span>
                  <span v-else class="lose">未中奖</span>
                </div>
              </div>
              <div class="bet-record-details">
                <div class="detail-item">
                  <span class="label">下注金额：</span>
                  <span class="value">{{ bet.amount }} 抖币</span>
                </div>
                <div class="detail-item">
                  <span class="label">赔率：</span>
                  <span class="value">{{ bet.odds }}x</span>
                </div>
                <div v-if="bet.status === 'settled'" class="detail-item">
                  <span class="label">奖金：</span>
                  <span class="value" :class="{ win: bet.is_win }">
                    {{ bet.is_win ? `+${bet.user_gain}` : '0' }} 抖币
                  </span>
                </div>
                <div class="detail-item">
                  <span class="label">时间：</span>
                  <span class="value">{{ formatTime(bet.created_at) }}</span>
                </div>
              </div>
              <!-- 取消下注按钮（封盘前且待结算状态） -->
              <div
                v-if="bet.status === 'pending' && currentRound?.status === 'betting'"
                class="bet-actions"
              >
                <button
                  class="cancel-btn"
                  @click="handleCancelBet(bet.id)"
                  :disabled="cancelingBetId === bet.id"
                >
                  {{ cancelingBetId === bet.id ? '取消中...' : '取消下注' }}
                </button>
              </div>
            </div>
          </div>

          <!-- 账变记录 -->
          <div v-if="activeTab === 'transactions'" class="transactions-list">
            <div v-if="isLoadingTransactions" class="loading-transactions">
              <Icon icon="mdi:loading" class="loading-icon" />
              <span>加载中...</span>
            </div>
            <div v-else-if="transactions.length === 0" class="empty-bets">
              <Icon
                icon="mdi:information-outline"
                style="font-size: 48rem; color: rgba(255, 255, 255, 0.3); margin-bottom: 10rem"
              />
              <div>暂无账变记录</div>
            </div>
            <div v-else>
              <div v-for="tx in transactions" :key="tx.id" class="transaction-record">
                <div class="transaction-header">
                  <div class="transaction-type">
                    <span v-if="tx.type === 'pc28_bet'" class="type-bet">下注</span>
                    <span v-else-if="tx.type === 'pc28_win'" class="type-win">中奖</span>
                    <span v-else-if="tx.type === 'pc28_refund'" class="type-refund">退款</span>
                    <span v-else>{{ tx.type }}</span>
                  </div>
                  <div
                    class="transaction-amount"
                    :class="{ positive: tx.amount > 0, negative: tx.amount < 0 }"
                  >
                    {{ tx.amount > 0 ? '+' : '' }}{{ tx.amount.toFixed(2) }} 抖币
                  </div>
                </div>
                <div class="transaction-details">
                  <div class="detail-item">
                    <span class="label">余额：</span>
                    <span class="value">{{ tx.balance_after.toFixed(2) }} 抖币</span>
                  </div>
                  <div class="detail-item">
                    <span class="label">时间：</span>
                    <span class="value">{{ formatTime(tx.created_at) }}</span>
                  </div>
                  <div v-if="tx.description" class="detail-item">
                    <span class="label">说明：</span>
                    <span class="value">{{ tx.description }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 下注区域 -->
          <div v-if="activeTab !== 'my_bets' && activeTab !== 'transactions'" class="bet-area">
            <!-- 大小单双 -->
            <div
              v-if="activeTab === 'big_small' && config?.game_settings?.big_small?.enabled"
              class="bet-options"
            >
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('big') }"
                @click="toggleBet('big', null)"
              >
                <div class="bet-name">大</div>
                <div class="bet-odds">{{ config.game_settings.big_small.big }}</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('small') }"
                @click="toggleBet('small', null)"
              >
                <div class="bet-name">小</div>
                <div class="bet-odds">{{ config.game_settings.big_small.small }}</div>
              </div>
            </div>

            <!-- 单双 -->
            <div
              v-if="activeTab === 'odd_even' && config?.game_settings?.odd_even?.enabled"
              class="bet-options"
            >
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('odd') }"
                @click="toggleBet('odd', null)"
              >
                <div class="bet-name">单</div>
                <div class="bet-odds">{{ config.game_settings.odd_even.odd }}</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('even') }"
                @click="toggleBet('even', null)"
              >
                <div class="bet-name">双</div>
                <div class="bet-odds">{{ config.game_settings.odd_even.even }}</div>
              </div>
            </div>

            <!-- 组合 -->
            <div
              v-if="activeTab === 'combinations' && config?.game_settings?.combinations?.enabled"
              class="bet-options"
            >
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('big_odd') }"
                @click="toggleBet('big_odd', null)"
              >
                <div class="bet-name">大单</div>
                <div class="bet-odds">{{ config.game_settings.combinations.big_odd }}</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('big_even') }"
                @click="toggleBet('big_even', null)"
              >
                <div class="bet-name">大双</div>
                <div class="bet-odds">{{ config.game_settings.combinations.big_even }}</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('small_odd') }"
                @click="toggleBet('small_odd', null)"
              >
                <div class="bet-name">小单</div>
                <div class="bet-odds">{{ config.game_settings.combinations.small_odd }}</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('small_even') }"
                @click="toggleBet('small_even', null)"
              >
                <div class="bet-name">小双</div>
                <div class="bet-odds">{{ config.game_settings.combinations.small_even }}</div>
              </div>
            </div>

            <!-- 单点 -->
            <div
              v-if="activeTab === 'single_point' && config?.game_settings?.single_point?.enabled"
              class="bet-points"
            >
              <div
                v-for="point in 28"
                :key="point - 1"
                class="bet-point"
                :class="{ selected: selectedBets.has(`single_point_${point - 1}`) }"
                @click="toggleBet('single_point', point - 1)"
              >
                <div class="point-num">{{ point - 1 }}</div>
                <div class="point-odds">
                  {{ config.game_settings.single_point.odds?.[point - 1] || '-' }}
                </div>
              </div>
            </div>
          </div>

          <!-- 下注金额 -->
          <div v-if="activeTab !== 'my_bets' && activeTab !== 'transactions'" class="bet-amount">
            <div class="amount-label">下注金额</div>
            <div class="amount-buttons">
              <button
                v-for="amt in [5, 10, 50, 100, 500]"
                :key="amt"
                class="amount-btn"
                :class="{ active: betAmount === amt }"
                @click="betAmount = amt"
              >
                {{ amt }}
              </button>
            </div>
            <input
              type="number"
              v-model.number="betAmount"
              placeholder="自定义金额"
              min="1"
              max="2000"
              class="amount-input"
              @blur="validateBetAmount"
            />
          </div>

          <!-- 已选下注 -->
          <div
            v-if="activeTab !== 'my_bets' && activeTab !== 'transactions' && selectedBets.size > 0"
            class="selected-bets"
          >
            <div class="selected-label">已选 {{ selectedBets.size }} 注</div>
            <div class="selected-list">
              <div
                v-for="bet in Array.from(selectedBets)"
                :key="bet"
                class="selected-item"
                @click="selectedBets.delete(bet)"
              >
                {{ getBetName(bet) }}
                <Icon icon="ion:close-circle" />
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeTab !== 'my_bets' && activeTab !== 'transactions'" class="panel-footer">
          <div class="total-info">
            <span>共 {{ selectedBets.size }} 注</span>
            <span class="total-amount">总计：{{ totalAmount }} 抖币</span>
          </div>
          <button
            class="bet-btn"
            @click="handleBet"
            :disabled="selectedBets.size === 0 || betAmount <= 0 || betAmount > 2000 || isLoading"
          >
            {{ isLoading ? '下注中...' : '立即下注' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { Icon } from '@iconify/vue'
import type { PC28GameConfig, PC28GameRound, PC28Bet } from '@/api/pc28'
import { placePC28Bet, getMyBets, cancelPC28Bet, getPC28Transactions } from '@/api/pc28'
import { _notice } from '@/utils'
import { supabase } from '@/utils/supabase'

const props = defineProps<{
  show: boolean
  config: PC28GameConfig | null
  currentRound: PC28GameRound | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'success'): void
}>()

const isLoading = ref(false)
const activeTab = ref('big_small')
const selectedBets = ref<Set<string>>(new Set())
const betAmount = ref(10)
const myBets = ref<PC28Bet[]>([])
const isLoadingBets = ref(false)
const cancelingBetId = ref<string | null>(null)
const userBalance = ref(0) // 用户余额
const isRefreshingBalance = ref(false) // 是否正在刷新余额
const transactions = ref<
  Array<{
    id: string
    amount: number
    balance_after: number
    type: string
    description: string
    created_at: string
    related_id: string | null
  }>
>([])
const isLoadingTransactions = ref(false) // 是否正在加载账变记录

// 刷新余额
async function refreshBalance() {
  if (isRefreshingBalance.value) return
  isRefreshingBalance.value = true
  try {
    const {
      data: { session }
    } = await supabase.auth.getSession()
    if (session?.user?.id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('balance_coins')
        .eq('id', session.user.id)
        .maybeSingle()
      if (profile) {
        userBalance.value = Math.floor(Number(profile.balance_coins || 0) * 100) / 100
      }
    }
  } catch (e) {
    console.error('[PC28BetPanel] refreshBalance error:', e)
  } finally {
    isRefreshingBalance.value = false
  }
}

// 根据配置动态生成tabs
const tabs = computed(() => {
  const tabList = []

  if (props.config?.game_settings?.big_small?.enabled) {
    tabList.push({ key: 'big_small', label: '大小' })
  }
  if (props.config?.game_settings?.odd_even?.enabled) {
    tabList.push({ key: 'odd_even', label: '单双' })
  }
  if (props.config?.game_settings?.combinations?.enabled) {
    tabList.push({ key: 'combinations', label: '组合' })
  }
  if (props.config?.game_settings?.single_point?.enabled) {
    tabList.push({ key: 'single_point', label: '单点' })
  }

  // 如果没有开启任何玩法，至少显示一个tab
  if (tabList.length === 0) {
    tabList.push({ key: 'big_small', label: '大小单双' })
  }

  return tabList
})

const statusText = {
  betting: '下注中',
  sealed: '已封盘',
  settled: '已结算'
}

const totalAmount = computed(() => {
  return selectedBets.value.size * betAmount.value
})

function validateBetAmount() {
  if (betAmount.value < 1) {
    _notice('下注金额必须大于0')
    betAmount.value = 1
  } else if (betAmount.value > 2000) {
    _notice('单注下注金额不能超过2000抖币')
    betAmount.value = 2000
  }
}

function toggleBet(type: string, value: number | null) {
  if (!props.currentRound || props.currentRound.status !== 'betting') {
    _notice('当前期已封盘或已结算')
    return
  }

  const key = value !== null ? `${type}_${value}` : type
  if (selectedBets.value.has(key)) {
    selectedBets.value.delete(key)
  } else {
    selectedBets.value.add(key)
  }
}

function getBetName(bet: string): string {
  // 处理 single_point_0 这样的格式
  if (bet.startsWith('single_point_')) {
    const point = bet.replace('single_point_', '')
    return `单点${point}`
  }

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
  return names[bet] || bet
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

async function fetchMyBets() {
  if (!props.currentRound) return

  isLoadingBets.value = true
  try {
    const bets = await getMyBets(props.currentRound.id)
    myBets.value = bets
  } catch (e: any) {
    console.error('[PC28] fetch my bets error:', e)
  } finally {
    isLoadingBets.value = false
  }
}

// 获取账变记录
async function fetchTransactions() {
  isLoadingTransactions.value = true
  try {
    const txList = await getPC28Transactions(50)
    transactions.value = txList
  } catch (e: any) {
    console.error('[PC28] fetch transactions error:', e)
    _notice('加载账变记录失败')
  } finally {
    isLoadingTransactions.value = false
  }
}

// 监听当前期数变化，重新获取下注记录
watch(
  () => props.currentRound?.id,
  () => {
    if (activeTab.value === 'my_bets') {
      fetchMyBets()
    }
  }
)

// 监听activeTab变化，切换到"我的下注"或"账变记录"时获取数据
watch(
  () => activeTab.value,
  (newTab) => {
    if (newTab === 'my_bets') {
      fetchMyBets()
    } else if (newTab === 'transactions') {
      fetchTransactions()
    } else {
      // 切换到其他tab时，如果不在tabs列表中，重置为第一个可用的tab
      // 但my_bets和transactions是固定标签，不需要重置
      if (
        newTab !== 'my_bets' &&
        newTab !== 'transactions' &&
        tabs.value.length > 0 &&
        !tabs.value.find((t) => t.key === newTab)
      ) {
        activeTab.value = tabs.value[0].key
      }
    }
  }
)

// 监听配置变化，更新activeTab
watch(
  () => props.config?.game_settings,
  () => {
    // 如果当前tab不可用，切换到第一个可用的tab
    if (tabs.value.length > 0 && !tabs.value.find((t) => t.key === activeTab.value)) {
      activeTab.value = tabs.value[0].key
    }
  },
  { deep: true }
)

async function handleCancelBet(betId: string) {
  if (cancelingBetId.value === betId) return

  if (!confirm('确认取消这笔下注？下注金额将退还到您的余额。')) {
    return
  }

  cancelingBetId.value = betId
  try {
    const res = await cancelPC28Bet(betId)
    if (res.success) {
      _notice(res.message)
      await fetchMyBets()
    } else {
      _notice(res.message || '取消下注失败')
    }
  } catch (e: any) {
    _notice(e.message || '取消下注失败')
  } finally {
    cancelingBetId.value = null
  }
}

let betsChannel: any = null

function setupBetsRealtime() {
  if (!props.currentRound?.id) return

  // 清理旧的channel
  if (betsChannel) {
    supabase.removeChannel(betsChannel)
  }

  // 监听当前期的下注记录变化
  betsChannel = supabase
    .channel(`pc28_bets_${props.currentRound.id}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'pc28_bets',
        filter: `round_id=eq.${props.currentRound.id}`
      },
      () => {
        // 如果当前在"我的下注"标签页，刷新数据
        if (activeTab.value === 'my_bets') {
          fetchMyBets()
        }
      }
    )
    .subscribe()
}

onMounted(() => {
  // 初始化activeTab为第一个可用的tab（如果当前tab不可用）
  if (
    tabs.value.length > 0 &&
    !tabs.value.find((t) => t.key === activeTab.value) &&
    activeTab.value !== 'my_bets'
  ) {
    activeTab.value = tabs.value[0].key
  }

  if (activeTab.value === 'my_bets') {
    fetchMyBets()
  }
  setupBetsRealtime()
})

onBeforeUnmount(() => {
  if (betsChannel) {
    supabase.removeChannel(betsChannel)
  }
})

// 监听当前期数变化，重新设置Realtime
watch(
  () => props.currentRound?.id,
  () => {
    setupBetsRealtime()
    if (activeTab.value === 'my_bets') {
      fetchMyBets()
    }
  }
)

function handleClose() {
  selectedBets.value.clear()
  betAmount.value = 10
  emit('close')
}

async function handleBet() {
  if (!props.currentRound || selectedBets.value.size === 0 || betAmount.value <= 0) {
    return
  }

  // 验证下注金额
  if (betAmount.value > 2000) {
    _notice('单注下注金额不能超过2000抖币')
    return
  }

  if (betAmount.value < 1) {
    _notice('下注金额必须大于0')
    return
  }

  if (props.currentRound.status !== 'betting') {
    _notice('当前期已封盘或已结算')
    return
  }

  isLoading.value = true
  try {
    let successCount = 0
    for (const bet of selectedBets.value) {
      // 解析下注类型和值
      let type: string
      let betValue: number | undefined

      if (bet.startsWith('single_point_')) {
        // 单点类型：single_point_0 -> type='single_point', betValue=0
        type = 'single_point'
        betValue = parseInt(bet.replace('single_point_', ''))
      } else {
        // 其他类型：直接使用bet作为type
        // big_even -> type='big_even'
        // big -> type='big'
        type = bet
        betValue = undefined
      }

      const res = await placePC28Bet(props.currentRound.id, type, betAmount.value, betValue)

      if (res.success) {
        successCount++
      } else {
        _notice(`${getBetName(bet)}: ${res.message}`)
      }
    }

    if (successCount > 0) {
      _notice(`成功下注 ${successCount} 注`)
      emit('success')
      // 刷新余额
      await refreshBalance()
      // 如果当前在"我的下注"标签页，刷新下注记录
      if (activeTab.value === 'my_bets') {
        await fetchMyBets()
      }
      handleClose()
    }
  } catch (e: any) {
    _notice(e.message || '下注失败')
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped lang="less">
.pc28-bet-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 2000;
  display: flex;
  align-items: flex-end;
}

.pc28-bet-panel {
  width: 100%;
  max-height: 90vh;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(10px);
  border-radius: 20rem 20rem 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: white;
  font-size: 18rem;
  font-weight: bold;

  .header-right {
    display: flex;
    align-items: center;
    gap: 10rem;

    .coin-info {
      display: flex;
      align-items: center;
      gap: 5rem;
      background: rgba(255, 255, 255, 0.1);
      padding: 4rem 10rem;
      border-radius: 15rem;
      font-size: 14rem;

      img {
        width: 16rem;
        height: 16rem;
      }

      .refresh-btn {
        transition: transform 0.3s;
        &:hover {
          transform: rotate(180deg);
        }
        &:active {
          opacity: 0.6;
        }
      }
    }
  }

  .close-btn {
    font-size: 24rem;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
  }
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 20rem;
  background: transparent;
}

.round-info {
  display: flex;
  justify-content: space-between;
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
}

.bet-tabs {
  display: flex;
  gap: 10rem;
  margin-bottom: 15rem;
  overflow-x: auto;
}

.tab-item {
  padding: 8rem 16rem;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8rem;
  color: rgba(255, 255, 255, 0.6);
  font-size: 14rem;
  white-space: nowrap;
  cursor: pointer;

  &.active {
    background: #fe2c55;
    color: white;
  }
}

.bet-options {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10rem;
  margin-bottom: 15rem;
}

.bet-option {
  padding: 15rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s;
  border: 2px solid transparent;

  &.selected {
    background: rgba(254, 44, 85, 0.2);
    border-color: #fe2c55;
  }

  .bet-name {
    color: white;
    font-size: 16rem;
    font-weight: bold;
    margin-bottom: 5rem;
  }

  .bet-odds {
    color: #fe2c55;
    font-size: 14rem;
  }
}

.bet-points {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8rem;
  margin-bottom: 15rem;
}

.bet-point {
  padding: 10rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s;
  border: 2px solid transparent;

  &.selected {
    background: rgba(254, 44, 85, 0.2);
    border-color: #fe2c55;
  }

  .point-num {
    color: white;
    font-size: 14rem;
    font-weight: bold;
    margin-bottom: 3rem;
  }

  .point-odds {
    color: #fe2c55;
    font-size: 12rem;
  }
}

.bet-amount {
  margin-bottom: 15rem;

  .amount-label {
    color: white;
    font-size: 14rem;
    margin-bottom: 10rem;
  }

  .amount-buttons {
    display: flex;
    gap: 10rem;
    margin-bottom: 10rem;
    flex-wrap: wrap;
  }

  .amount-btn {
    padding: 8rem 16rem;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8rem;
    color: white;
    font-size: 14rem;
    cursor: pointer;

    &.active {
      background: #fe2c55;
      border-color: #fe2c55;
    }
  }

  .amount-input {
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

.selected-bets {
  margin-bottom: 15rem;
  padding: 15rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10rem;

  .selected-label {
    color: white;
    font-size: 14rem;
    margin-bottom: 10rem;
  }

  .selected-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8rem;
  }

  .selected-item {
    display: flex;
    align-items: center;
    gap: 5rem;
    padding: 6rem 12rem;
    background: rgba(254, 44, 85, 0.2);
    border-radius: 6rem;
    color: white;
    font-size: 12rem;
    cursor: pointer;
  }
}

.panel-footer {
  padding: 20rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.3);

  .total-info {
    display: flex;
    justify-content: space-between;
    margin-bottom: 15rem;
    color: white;
    font-size: 14rem;

    .total-amount {
      color: #fe2c55;
      font-weight: bold;
    }
  }

  .bet-btn {
    width: 100%;
    padding: 15rem;
    background: #fe2c55;
    border: none;
    border-radius: 10rem;
    color: white;
    font-size: 16rem;
    font-weight: bold;
    cursor: pointer;

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  .pc28-bet-panel {
    transform: translateY(100%);
  }
}

.my-bets-list {
  min-height: 200rem;
  max-height: 400rem;
  overflow-y: auto;
}

.empty-bets {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60rem 20rem;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14rem;
}

.bet-record {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10rem;
  padding: 15rem;
  margin-bottom: 10rem;
  border-left: 3px solid rgba(254, 44, 85, 0.5);

  &:last-child {
    margin-bottom: 0;
  }
}

.loading-bets {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 40rem 20rem;
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

.bet-actions {
  margin-top: 10rem;
  padding-top: 10rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  justify-content: flex-end;
}

.cancel-btn {
  padding: 6rem 12rem;
  background: rgba(255, 152, 0, 0.2);
  border: 1px solid rgba(255, 152, 0, 0.5);
  border-radius: 6rem;
  color: #ff9800;
  font-size: 12rem;
  cursor: pointer;
  transition: all 0.3s;

  &:hover:not(:disabled) {
    background: rgba(255, 152, 0, 0.3);
    border-color: #ff9800;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.bet-record-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10rem;

  .bet-type-name {
    color: white;
    font-size: 16rem;
    font-weight: bold;
  }

  .bet-status {
    font-size: 12rem;
    padding: 4rem 8rem;
    border-radius: 4rem;
    background: rgba(255, 255, 255, 0.1);

    &.pending {
      color: #ff9800;
    }

    &.win {
      color: #4caf50;
      background: rgba(76, 175, 80, 0.2);
    }

    &.lose {
      color: rgba(255, 255, 255, 0.5);
    }
  }
}

.bet-record-details {
  display: flex;
  flex-direction: column;
  gap: 6rem;

  .detail-item {
    display: flex;
    justify-content: space-between;
    font-size: 12rem;

    .label {
      color: rgba(255, 255, 255, 0.6);
    }

    .value {
      color: white;
      font-weight: bold;

      &.win {
        color: #4caf50;
      }
    }
  }
}

.loading-transactions {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40rem 20rem;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14rem;

  .loading-icon {
    font-size: 32rem;
    margin-bottom: 10rem;
    animation: rotate 1s linear infinite;
  }
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.transactions-list {
  max-height: 400rem;
  overflow-y: auto;
}

.transaction-record {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10rem;
  padding: 15rem;
  margin-bottom: 10rem;

  &:last-child {
    margin-bottom: 0;
  }
}

.transaction-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10rem;
}

.transaction-type {
  font-size: 14rem;
  color: rgba(255, 255, 255, 0.8);

  .type-bet {
    color: #ff9800;
  }

  .type-win {
    color: #4caf50;
  }

  .type-refund {
    color: #2196f3;
  }
}

.transaction-amount {
  font-size: 16rem;
  font-weight: bold;

  &.positive {
    color: #4caf50;
  }

  &.negative {
    color: #ff5252;
  }
}

.transaction-details {
  display: flex;
  flex-direction: column;
  gap: 5rem;
  font-size: 12rem;
  color: rgba(255, 255, 255, 0.6);

  .detail-item {
    display: flex;
    justify-content: space-between;

    .label {
      color: rgba(255, 255, 255, 0.5);
    }

    .value {
      color: white;
      font-weight: bold;
    }
  }
}
</style>
