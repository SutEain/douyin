<template>
  <Transition name="slide-up">
    <div v-show="show" class="pc28-bet-overlay" @click.self="handleClose">
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
              <div class="recharge" @click="handleRecharge">充值</div>
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

          <!-- 玩法选择 - 第一排：玩法分类 -->
          <div class="bet-tabs bet-tabs-row1">
            <div
              v-for="tab in gameTabs"
              :key="tab.key"
              class="tab-item"
              :class="{ active: activeTab === tab.key }"
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </div>
          </div>

          <!-- 功能选择 - 第二排：功能tab -->
          <div class="bet-tabs bet-tabs-row2">
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
              账单
            </div>
            <div
              class="tab-item"
              :class="{ active: activeTab === 'rules' }"
              @click="activeTab = 'rules'"
            >
              规则
            </div>
            <div
              class="tab-item"
              :class="{ active: activeTab === 'history' }"
              @click="activeTab = 'history'"
            >
              开奖历史
            </div>
          </div>

          <!-- 开奖历史 -->
          <div v-if="activeTab === 'history'" class="history-content">
            <div v-if="isLoadingHistory" class="loading-history">
              <Icon icon="mdi:loading" class="loading-icon" />
              <span>加载中...</span>
            </div>
            <div v-else-if="historyList.length === 0" class="empty-bets">
              <Icon
                icon="mdi:information-outline"
                style="font-size: 48rem; color: rgba(255, 255, 255, 0.3); margin-bottom: 10rem"
              />
              <div>暂无开奖历史</div>
            </div>
            <div v-else class="history-list">
              <div v-for="round in historyList" :key="round.id" class="history-item">
                <div class="history-header">
                  <div class="period-number">第{{ round.period_number }}期</div>
                  <div class="settled-time">{{ formatHistoryTime(round.settled_at) }}</div>
                </div>
                <div v-if="round.result" class="history-result">
                  <div class="result-numbers">
                    <span class="num">{{ round.result.num1 }}</span>
                    <span class="plus">+</span>
                    <span class="num">{{ round.result.num2 }}</span>
                    <span class="plus">+</span>
                    <span class="num">{{ round.result.num3 }}</span>
                    <span class="equals">=</span>
                    <span class="sum">{{ round.result.sum }}</span>
                  </div>
                  <div class="result-tags">
                    <span class="tag" :class="getBigSmallClass(round.result.sum)">
                      {{ getBigSmall(round.result.sum) }}
                    </span>
                    <span class="tag" :class="getOddEvenClass(round.result.sum)">
                      {{ getOddEven(round.result.sum) }}
                    </span>
                    <span class="tag pattern">{{ getPattern(round.result) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 规则说明 -->
          <div v-if="activeTab === 'rules'" class="rules-content">
            <div class="rules-section">
              <div class="rules-title">基础赔率</div>
              <div class="rules-list">
                <div class="rule-item">
                  <span class="rule-label">大小单双：</span>
                  <span class="rule-value">2.0倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">组合：</span>
                  <span class="rule-value">大单/小双 4.2倍，大双/小单 4.6倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">极值（极大/极小）：</span>
                  <span class="rule-value">15倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">对子：</span>
                  <span class="rule-value">3.4倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">顺子：</span>
                  <span class="rule-value">15倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">豹子：</span>
                  <span class="rule-value">80倍</span>
                </div>
              </div>
            </div>

            <div class="rules-section">
              <div class="rules-title">点杀倍数</div>
              <div class="rules-list">
                <div class="rule-item">
                  <span class="rule-label">0/27：</span>
                  <span class="rule-value">888倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">1/26：</span>
                  <span class="rule-value">222倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">2/25：</span>
                  <span class="rule-value">123倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">3/24：</span>
                  <span class="rule-value">80倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">4/23：</span>
                  <span class="rule-value">48倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">5/22：</span>
                  <span class="rule-value">38倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">6/21：</span>
                  <span class="rule-value">28倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">7/20：</span>
                  <span class="rule-value">22倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">8/19：</span>
                  <span class="rule-value">18倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">9/18：</span>
                  <span class="rule-value">15倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">10/17：</span>
                  <span class="rule-value">14倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">11/16：</span>
                  <span class="rule-value">13倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">12/15：</span>
                  <span class="rule-value">12倍</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">13/14：</span>
                  <span class="rule-value">11倍</span>
                </div>
              </div>
            </div>

            <div class="rules-section">
              <div class="rules-title">特殊规则</div>
              <div class="rules-list">
                <div class="rule-item special">
                  <div class="rule-label">规则1：</div>
                  <div class="rule-desc">遇13/14，大、小、单、双中奖赔1.6倍</div>
                </div>
                <div class="rule-item special">
                  <div class="rule-label">规则2：</div>
                  <div class="rule-desc">
                    组合玩法遇13/14仅回本：<br />
                    • 如果开奖结果是13或14<br />
                    • 所有组合玩法（大单/大双/小单/小双）原本该中的只回本，不算中奖<br />
                    • 例如：开奖是13，用户下了4个组合，原本应该中"小单"的只退回本金，其他3注被吃掉
                  </div>
                </div>
                <div class="rule-item special">
                  <div class="rule-label">规则3：</div>
                  <div class="rule-desc">
                    组合玩法遇对子/顺子/豹子正常结算：<br />
                    • 如果开奖结果是对子、顺子或豹子<br />
                    • 组合玩法（大单/大双/小单/小双）按正常规则结算<br />
                    • 例如：开奖是对子且和值为15（大单），用户下注"大单"则正常中奖
                  </div>
                </div>
              </div>
            </div>

            <div class="rules-section">
              <div class="rules-title">抽水规则</div>
              <div class="rules-list">
                <div class="rule-item">
                  <span class="rule-label">平台抽成：</span>
                  <span class="rule-value">用户盈利的1%</span>
                </div>
                <div class="rule-item">
                  <span class="rule-label">主播抽水：</span>
                  <span class="rule-value">下注额的1%（平台支付）</span>
                </div>
              </div>
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
                  <span
                    v-else-if="
                      bet.status === 'settled' && bet.user_gain > 0 && bet.user_gain === bet.amount
                    "
                    class="win"
                  >
                    回本
                  </span>
                  <span v-else class="lose">未中奖</span>
                </div>
              </div>
              <div class="bet-record-details">
                <div v-if="bet.period_number" class="detail-item">
                  <span class="label">期号：</span>
                  <span class="value">{{ bet.period_number }}期</span>
                </div>
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
                  <span
                    class="value"
                    :class="{
                      win: bet.is_win || (bet.user_gain > 0 && bet.user_gain === bet.amount)
                    }"
                  >
                    {{
                      bet.is_win || (bet.user_gain > 0 && bet.user_gain === bet.amount)
                        ? `+${bet.user_gain}`
                        : '0'
                    }}
                    抖币
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
                    <span v-else-if="tx.type === 'pc28_bet_income'" class="type-income"
                      >未中奖收入</span
                    >
                    <span v-else-if="tx.type === 'pc28_payout'" class="type-payout">赔付</span>
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
          <div
            v-if="
              activeTab !== 'my_bets' &&
              activeTab !== 'transactions' &&
              activeTab !== 'rules' &&
              activeTab !== 'history'
            "
            class="bet-area"
          >
            <!-- 基础玩法：大小、单双 -->
            <div v-if="activeTab === 'basic'" class="bet-options">
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('big') }"
                @click="toggleBet('big', null)"
              >
                <div class="bet-name">大</div>
                <div class="bet-odds">2.0</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('small') }"
                @click="toggleBet('small', null)"
              >
                <div class="bet-name">小</div>
                <div class="bet-odds">2.0</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('odd') }"
                @click="toggleBet('odd', null)"
              >
                <div class="bet-name">单</div>
                <div class="bet-odds">2.0</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('even') }"
                @click="toggleBet('even', null)"
              >
                <div class="bet-name">双</div>
                <div class="bet-odds">2.0</div>
              </div>
            </div>

            <!-- 组合 -->
            <div v-if="activeTab === 'combinations'" class="bet-options">
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('big_odd') }"
                @click="toggleBet('big_odd', null)"
              >
                <div class="bet-name">大单</div>
                <div class="bet-odds">4.2</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('big_even') }"
                @click="toggleBet('big_even', null)"
              >
                <div class="bet-name">大双</div>
                <div class="bet-odds">4.6</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('small_odd') }"
                @click="toggleBet('small_odd', null)"
              >
                <div class="bet-name">小单</div>
                <div class="bet-odds">4.6</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('small_even') }"
                @click="toggleBet('small_even', null)"
              >
                <div class="bet-name">小双</div>
                <div class="bet-odds">4.2</div>
              </div>
            </div>

            <!-- 特殊玩法 -->
            <div v-if="activeTab === 'special'" class="bet-options bet-options-special">
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('extreme_big') }"
                @click="toggleBet('extreme_big', null)"
              >
                <div class="bet-name">极大</div>
                <div class="bet-odds">15</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('extreme_small') }"
                @click="toggleBet('extreme_small', null)"
              >
                <div class="bet-name">极小</div>
                <div class="bet-odds">15</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('leopard') }"
                @click="toggleBet('leopard', null)"
              >
                <div class="bet-name">豹子</div>
                <div class="bet-odds">80</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('straight') }"
                @click="toggleBet('straight', null)"
              >
                <div class="bet-name">顺子</div>
                <div class="bet-odds">15</div>
              </div>
              <div
                class="bet-option"
                :class="{ selected: selectedBets.has('pair') }"
                @click="toggleBet('pair', null)"
              >
                <div class="bet-name">对子</div>
                <div class="bet-odds">3.4</div>
              </div>
            </div>

            <!-- 单点 -->
            <div v-if="activeTab === 'single_point'" class="bet-points">
              <div
                v-for="point in 28"
                :key="point - 1"
                class="bet-point"
                :class="{ selected: selectedBets.has(`single_point_${point - 1}`) }"
                @click="toggleBet('single_point', point - 1)"
              >
                <div class="point-num">{{ point - 1 }}</div>
                <div class="point-odds">{{ getSinglePointOdds(point - 1) }}</div>
              </div>
            </div>
          </div>

          <!-- 下注金额 -->
          <div
            v-if="
              activeTab !== 'my_bets' &&
              activeTab !== 'transactions' &&
              activeTab !== 'rules' &&
              activeTab !== 'history'
            "
            class="bet-amount"
          >
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
            v-if="
              activeTab !== 'my_bets' &&
              activeTab !== 'transactions' &&
              activeTab !== 'rules' &&
              activeTab !== 'history' &&
              selectedBets.size > 0
            "
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

        <div
          v-if="
            activeTab !== 'my_bets' &&
            activeTab !== 'transactions' &&
            activeTab !== 'rules' &&
            activeTab !== 'history'
          "
          class="panel-footer"
        >
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

  <!-- 充值面板 -->
  <Transition name="slide-up">
    <div
      v-show="showRechargeModal"
      class="gift-panel-overlay recharge-overlay"
      @click.self="showRechargeModal = false"
    >
      <div class="gift-panel recharge-panel">
        <div class="panel-header">
          <span>抖币充值</span>
          <Icon icon="ion:close" class="close-btn" @click="showRechargeModal = false" />
        </div>

        <div class="recharge-content" v-if="rechargeInfo">
          <!-- 如果有待支付订单 -->
          <template v-if="rechargeInfo.pending_order">
            <div class="pending-order">
              <div class="status-tip">⏳ 待支付订单</div>
              <div class="order-item">
                <span class="label">订单编号</span>
                <span class="value"
                  ><code>{{ rechargeInfo.pending_order.order_no }}</code></span
                >
              </div>
              <div class="order-item highlight">
                <span class="label">应付金额</span>
                <span class="value"
                  >{{ Number(rechargeInfo.pending_order.total_amount).toFixed(2) }} USDT</span
                >
              </div>
              <div class="order-item">
                <span class="label">预计到账</span>
                <span class="value"
                  >{{ (rechargeInfo.pending_order.base_amount * 100).toLocaleString() }} 抖币</span
                >
              </div>

              <div class="payment-address">
                <div class="addr-label">📍 收款地址 (TRC20)</div>
                <div
                  class="addr-value"
                  @click="
                    () => {
                      copyToClipboard(rechargeInfo.pending_order.trc20_address)
                      _notice('地址已复制')
                    }
                  "
                >
                  <code>{{ rechargeInfo.pending_order.trc20_address }}</code>
                  <Icon icon="solar:copy-bold" class="copy-icon" />
                </div>
              </div>

              <div class="qr-code">
                <img
                  :src="`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${rechargeInfo.pending_order.trc20_address}`"
                />
                <p>请扫码或转账至上方地址</p>
              </div>

              <div class="notice-box">
                ⚠️ 请务必支付<b>精确金额 (含尾数)</b
                >，否则无法自动到账！支付完成后请等待管理员确认。
              </div>

              <div class="recharge-footer">
                <div
                  class="cancel-btn"
                  @click="handleCancelRecharge(rechargeInfo.pending_order.id)"
                >
                  取消订单
                </div>
                <div class="done-btn" @click="showRechargeModal = false">我已支付</div>
              </div>
            </div>
          </template>

          <!-- 如果没有待支付订单 -->
          <template v-else>
            <div class="recharge-intro">
              <p>💡 汇率：1 USDT = 100 抖币</p>
              <p>请选择充值金额 (USDT-TRC20)：</p>
            </div>
            <div class="amount-grid">
              <div
                v-for="amt in rechargeInfo.amounts"
                :key="amt"
                class="amount-item"
                @click="handleCreateRecharge(amt)"
              >
                <div class="usdt">{{ amt }} USDT</div>
                <div class="coins">{{ amt * 100 }} 抖币</div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { Icon } from '@iconify/vue'
import type { PC28GlobalRound, PC28Bet } from '@/api/pc28'
import {
  placePC28BetGlobal,
  getMyBets,
  cancelPC28Bet,
  getPC28Transactions,
  getPC28History
} from '@/api/pc28'
import { _notice, _copy } from '@/utils'
import { supabase } from '@/utils/supabase'

const props = defineProps<{
  show: boolean
  currentRound: PC28GlobalRound | null
  roomId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'success'): void
}>()

const isLoading = ref(false)
const activeTab = ref('basic') // 默认显示基础玩法
const selectedBets = ref<Set<string>>(new Set())
const betAmount = ref(10)
const myBets = ref<PC28Bet[]>([])
const isLoadingBets = ref(false)
const cancelingBetId = ref<string | null>(null)
const userBalance = ref(0) // 用户余额
const isRefreshingBalance = ref(false) // 是否正在刷新余额
// --- 充值相关 ---
const showRechargeModal = ref(false)
const rechargeInfo = ref<any>(null)
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
const historyList = ref<PC28GlobalRound[]>([]) // 开奖历史列表
const isLoadingHistory = ref(false) // 是否正在加载开奖历史

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

// 玩法分类 - 第一排
const gameTabs = computed(() => {
  return [
    { key: 'basic', label: '基础' }, // 大小、单双
    { key: 'combinations', label: '组合' }, // 大单、大双、小单、小双
    { key: 'special', label: '特殊' }, // 极大、极小、豹子、顺子、对子
    { key: 'single_point', label: '单点' } // 0-27
  ]
})

// 平台统一单点赔率
function getSinglePointOdds(point: number): string {
  const oddsMap: Record<number, number> = {
    0: 888,
    27: 888,
    1: 222,
    26: 222,
    2: 123,
    25: 123,
    3: 80,
    24: 80,
    4: 48,
    23: 48,
    5: 38,
    22: 38,
    6: 28,
    21: 28,
    7: 22,
    20: 22,
    8: 18,
    19: 18,
    9: 15,
    18: 15,
    10: 14,
    17: 14,
    11: 13,
    16: 13,
    12: 12,
    15: 12,
    13: 11,
    14: 11
  }
  return oddsMap[point]?.toString() || '-'
}

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
    const bets = await getMyBets(props.currentRound.id, true) // 使用全局期数
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

// 获取服务器基础URL
function getAppServerBase() {
  const explicit = import.meta.env.VITE_APP_SERVER_URL
  if (explicit) return explicit.replace(/\/$/, '')
  if (import.meta.env.DEV) return '/api/app-server'
  if (import.meta.env.VITE_SUPABASE_URL) {
    return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/app-server`
  }
  return ''
}

// 复制到剪贴板
function copyToClipboard(text: string) {
  _copy(text)
}

// 获取充值信息
async function fetchRechargeInfo() {
  try {
    const {
      data: { session }
    } = await supabase.auth.getSession()
    const headers: Record<string, string> = {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    }
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    }

    const resp = await fetch(`${getAppServerBase()}/recharge/info`, { headers })
    const payload = await resp.json()
    if (payload.code === 0) {
      rechargeInfo.value = payload.data
    }
  } catch (e) {
    console.error('fetchRechargeInfo error:', e)
  }
}

// 处理充值
async function handleRecharge() {
  showRechargeModal.value = true
  await fetchRechargeInfo()
}

// 创建充值订单
async function handleCreateRecharge(amount: number) {
  try {
    const {
      data: { session }
    } = await supabase.auth.getSession()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    }
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    }

    const resp = await fetch(`${getAppServerBase()}/recharge/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount })
    })
    const payload = await resp.json()
    if (payload.code === 0) {
      _notice('订单创建成功')
      await fetchRechargeInfo()
      // 刷新余额
      await refreshBalance()
    } else {
      _notice(payload.msg || '创建失败')
    }
  } catch (e: any) {
    _notice(e.message || '系统错误')
  }
}

// 取消充值订单
async function handleCancelRecharge(orderId: string) {
  if (!confirm('确定要取消该充值订单吗？')) return
  try {
    const {
      data: { session }
    } = await supabase.auth.getSession()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    }
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    }

    const resp = await fetch(`${getAppServerBase()}/recharge/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ order_id: orderId })
    })
    const payload = await resp.json()
    if (payload.code === 0) {
      _notice('订单已取消')
      await fetchRechargeInfo()
    }
  } catch (e) {
    console.error('handleCancelRecharge error:', e)
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

// 获取开奖历史
async function fetchHistory() {
  isLoadingHistory.value = true
  try {
    const history = await getPC28History(20)
    historyList.value = history
  } catch (e: any) {
    console.error('[PC28] fetch history error:', e)
    _notice('加载开奖历史失败')
  } finally {
    isLoadingHistory.value = false
  }
}

// 计算大小
function getBigSmall(sum: number): string {
  return sum >= 14 ? '大' : '小'
}

// 计算单双
function getOddEven(sum: number): string {
  return sum % 2 === 1 ? '单' : '双'
}

// 计算模式（豹子、对子、顺子、杂六）
function getPattern(result: { num1: number; num2: number; num3: number }): string {
  const { num1, num2, num3 } = result
  const sortedNums = [num1, num2, num3].sort((a, b) => a - b)

  // 豹子：三个数字相同
  if (num1 === num2 && num2 === num3) {
    return '豹子'
  }

  // 对子：有两个数字相同（但不是豹子）
  if (num1 === num2 || num1 === num3 || num2 === num3) {
    return '对子'
  }

  // 顺子：三个数字连续
  if (sortedNums[1] === sortedNums[0] + 1 && sortedNums[2] === sortedNums[1] + 1) {
    return '顺子'
  }

  // 杂六
  return '杂六'
}

// 获取大小样式类
function getBigSmallClass(sum: number): string {
  return sum >= 14 ? 'big' : 'small'
}

// 获取单双样式类
function getOddEvenClass(sum: number): string {
  return sum % 2 === 1 ? 'odd' : 'even'
}

// 格式化历史时间
function formatHistoryTime(timeStr: string | null): string {
  if (!timeStr) return ''
  const date = new Date(timeStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 1) {
    return '刚刚'
  } else if (minutes < 60) {
    return `${minutes}分钟前`
  } else if (hours < 24) {
    return `${hours}小时前`
  } else if (days < 7) {
    return `${days}天前`
  } else {
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
}

// 监听activeTab变化，切换到"我的下注"或"账变记录"或"开奖历史"时获取数据
watch(
  () => activeTab.value,
  (newTab) => {
    if (newTab === 'my_bets') {
      fetchMyBets()
    } else if (newTab === 'transactions') {
      fetchTransactions()
    } else if (newTab === 'history') {
      fetchHistory()
    }
    // 平台统一规则，所有玩法都开启，不需要检查tab有效性
  }
)

// 平台统一规则，所有玩法都开启，不需要监听配置变化

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
        filter: `global_round_id=eq.${props.currentRound.id}`
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
  // 平台统一规则，所有玩法都开启，不需要检查tab可用性
  if (activeTab.value === 'my_bets') {
    fetchMyBets()
  } else if (activeTab.value === 'history') {
    fetchHistory()
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

      const res = await placePC28BetGlobal(
        props.currentRound.id,
        props.roomId,
        type,
        betAmount.value,
        betValue
      )

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

      .recharge {
        color: #face15;
        margin-left: 5rem;
        font-weight: bold;
        cursor: pointer;
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

.bet-tabs-row1 {
  margin-bottom: 10rem;
}

.bet-tabs-row2 {
  margin-bottom: 15rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 10rem;
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

.bet-options-special {
  // 特殊玩法有5个选项，使用3列布局（前3个2列，后2个3列）
  grid-template-columns: repeat(3, 1fr);

  // 第4和第5个选项占据中间列
  .bet-option:nth-child(4),
  .bet-option:nth-child(5) {
    grid-column: span 1;
  }
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

.history-content {
  max-height: 500rem;
  overflow-y: auto;
}

.loading-history {
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

.history-list {
  display: flex;
  flex-direction: column;
  gap: 10rem;
}

.history-item {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10rem;
  padding: 15rem;
  border-left: 3px solid rgba(254, 44, 85, 0.5);
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12rem;

  .period-number {
    color: white;
    font-size: 16rem;
    font-weight: bold;
  }

  .settled-time {
    color: rgba(255, 255, 255, 0.5);
    font-size: 12rem;
  }
}

.history-result {
  display: flex;
  flex-direction: column;
  gap: 10rem;
}

.result-numbers {
  display: flex;
  align-items: center;
  gap: 8rem;
  font-size: 18rem;
  font-weight: bold;

  .num {
    color: #4caf50;
    min-width: 24rem;
    text-align: center;
  }

  .plus {
    color: rgba(255, 255, 255, 0.6);
  }

  .equals {
    color: rgba(255, 255, 255, 0.6);
    margin-left: 4rem;
  }

  .sum {
    color: #fe2c55;
    min-width: 32rem;
    text-align: center;
  }
}

.result-tags {
  display: flex;
  gap: 8rem;
  flex-wrap: wrap;
}

.tag {
  padding: 4rem 10rem;
  border-radius: 6rem;
  font-size: 12rem;
  font-weight: bold;
  color: white;

  &.big {
    background: rgba(255, 152, 0, 0.3);
    color: #ff9800;
  }

  &.small {
    background: rgba(33, 150, 243, 0.3);
    color: #2196f3;
  }

  &.odd {
    background: rgba(76, 175, 80, 0.3);
    color: #4caf50;
  }

  &.even {
    background: rgba(156, 39, 176, 0.3);
    color: #9c27b0;
  }

  &.pattern {
    background: rgba(254, 44, 85, 0.3);
    color: #fe2c55;
  }
}

.rules-content {
  max-height: 500rem;
  overflow-y: auto;
  padding: 20rem;
}

.rules-section {
  margin-bottom: 30rem;

  &:last-child {
    margin-bottom: 0;
  }
}

.rules-title {
  font-size: 18rem;
  font-weight: bold;
  color: #ff9800;
  margin-bottom: 15rem;
  padding-bottom: 10rem;
  border-bottom: 1px solid rgba(255, 152, 0, 0.3);
}

.rules-list {
  display: flex;
  flex-direction: column;
  gap: 12rem;
}

.rule-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 12rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8rem;
  font-size: 14rem;

  &.special {
    flex-direction: column;
    gap: 8rem;
  }

  .rule-label {
    color: rgba(255, 255, 255, 0.7);
    font-weight: 500;
  }

  .rule-value {
    color: #4caf50;
    font-weight: bold;
  }

  .rule-desc {
    color: rgba(255, 255, 255, 0.9);
    line-height: 1.6;
    margin-left: 0;
  }
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

// 充值弹窗样式
.gift-panel-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 10001;
  display: flex;
  align-items: flex-end;
}

.recharge-overlay {
  z-index: 10001;
}

.gift-panel {
  width: 100%;
  max-height: 90vh;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(10px);
  border-radius: 20rem 20rem 0 0;
  display: flex;
  flex-direction: column;
}

.recharge-panel {
  .recharge-content {
    padding: 20rem;
    color: white;

    .recharge-intro {
      margin-bottom: 20rem;
      p {
        margin: 0;
        font-size: 14rem;
        line-height: 1.6;
        &:first-child {
          color: #face15;
          font-weight: bold;
        }
        &:last-child {
          color: rgba(255, 255, 255, 0.6);
        }
      }
    }

    .amount-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12rem;

      .amount-item {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 15rem;
        border-radius: 12rem;
        text-align: center;
        transition: all 0.2s;
        cursor: pointer;

        &:active {
          transform: scale(0.95);
          background: rgba(254, 44, 85, 0.1);
          border-color: #fe2c55;
        }

        .usdt {
          font-size: 18rem;
          font-weight: bold;
          color: white;
          margin-bottom: 4rem;
        }

        .coins {
          font-size: 12rem;
          color: rgba(255, 255, 255, 0.5);
        }
      }
    }

    .pending-order {
      .status-tip {
        background: rgba(250, 206, 21, 0.1);
        color: #face15;
        padding: 8rem;
        border-radius: 8rem;
        text-align: center;
        margin-bottom: 20rem;
        font-weight: bold;
      }

      .order-item {
        display: flex;
        justify-content: space-between;
        margin-bottom: 12rem;
        font-size: 14rem;

        .label {
          color: rgba(255, 255, 255, 0.5);
        }

        &.highlight {
          .value {
            color: #fe2c55;
            font-weight: bold;
            font-size: 18rem;
          }
        }
      }

      .payment-address {
        margin: 20rem 0;
        background: rgba(255, 255, 255, 0.05);
        padding: 12rem;
        border-radius: 10rem;

        .addr-label {
          font-size: 12rem;
          color: rgba(255, 255, 255, 0.5);
          margin-bottom: 8rem;
        }

        .addr-value {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10rem;
          word-break: break-all;
          cursor: pointer;

          code {
            font-size: 13rem;
            color: #a2e9ff;
          }

          .copy-icon {
            font-size: 18rem;
            color: #fe2c55;
            flex-shrink: 0;
          }
        }
      }

      .qr-code {
        text-align: center;
        margin: 20rem 0;
        img {
          width: 150rem;
          height: 150rem;
          padding: 10rem;
          background: white;
          border-radius: 10rem;
        }
        p {
          margin-top: 10rem;
          font-size: 12rem;
          color: rgba(255, 255, 255, 0.4);
        }
      }

      .notice-box {
        font-size: 12rem;
        line-height: 1.6;
        color: rgba(255, 255, 255, 0.5);
        padding: 10rem;
        background: rgba(254, 44, 85, 0.05);
        border-left: 3rem solid #fe2c55;
        margin-bottom: 20rem;
        b {
          color: #fe2c55;
        }
      }

      .recharge-footer {
        display: flex;
        gap: 15rem;

        .cancel-btn {
          flex: 1;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          padding: 12rem;
          border-radius: 25rem;
          text-align: center;
          font-size: 14rem;
          cursor: pointer;
        }

        .done-btn {
          flex: 1;
          background: var(--primary-btn-color);
          color: white;
          padding: 12rem;
          border-radius: 25rem;
          text-align: center;
          font-size: 14rem;
          font-weight: bold;
          cursor: pointer;
        }
      }
    }
  }
}
</style>
