<template>
  <div
    class="LivePage"
    ref="page"
    :class="{ 'landscape-mode': isLandscape }"
    @touchstart="handleFirstTouch"
    @click="handleFirstTouch"
  >
    <div class="live-wrapper" id="live-wrapper" v-love="'live-wrapper'">
      <!-- 🎯 已下播状态展示 -->
      <div
        v-if="roomInfo.status === 'offline' || roomInfo.status === 'ended'"
        class="offline-placeholder"
      >
        <div class="offline-content">
          <img :src="roomInfo.cover_url || fallbackAvatar" class="blur-bg" />
          <div class="tip-box">
            <Icon icon="solar:videocamera-record-off-bold" class="off-icon" />
            <span class="tip-text">直播已结束</span>
            <span class="sub-text">主播正在休息，去看看其他直播吧</span>
            <div class="back-btn" @click="$router.back()">返回首页</div>
          </div>
        </div>
      </div>

      <DPPlayer
        v-else-if="roomInfo.stream_url"
        ref="playerRef"
        :src="roomInfo.stream_url"
        :poster="roomInfo.cover_url"
        :muted="isMuted"
        :controls="false"
        :landscape="isLandscape"
        @error="onPlayerError"
        @contextmenu.prevent
      />
      <div v-else class="loading-placeholder">
        <span>正在进入直播间...</span>
      </div>
    </div>

    <div class="float" v-if="!isCleanScreen">
      <div class="top">
        <div class="left">
          <div class="liver">
            <img
              class="avatar"
              :src="_checkImgUrl(roomInfo.anchor_info?.avatar_url) || fallbackAvatar"
              alt=""
              referrerpolicy="no-referrer"
              @click="goUser(roomInfo.anchor_id)"
            />
            <div class="desc-wrapper" @click="goUser(roomInfo.anchor_id)">
              <div class="name">{{ _truncate(roomInfo.anchor_info?.nickname || '主播', 15) }}</div>
              <div class="count">{{ viewerCount }} 人正在看</div>
            </div>
            <div class="follow-btn" @click="attention" :class="{ isFollowed }">
              {{ isFollowed ? '已关注' : '关注' }}
            </div>
          </div>
        </div>
        <div class="right">
          <div class="follower">
            <div class="viewer-avatars" v-if="viewers.length">
              <img
                v-for="v in viewers"
                :key="v.renderKey"
                :src="_checkImgUrl(v.avatar) || fallbackAvatar"
                class="v-avatar"
                referrerpolicy="no-referrer"
                @error="(e: any) => (e.target.src = fallbackAvatar)"
              />
            </div>
            <div class="round count" @click="showViewerList">{{ viewerCount }}</div>
            <dy-back class="round close" img="close" mode="light" @click="$router.back()" />
          </div>
        </div>
      </div>

      <div class="bottom">
        <div class="left">
          <div class="comments" ref="comments">
            <div class="comments-wrapper" ref="comments-wrapper">
              <div class="comment notice">
                <span class="text">
                  欢迎来到直播间！TG抖音严禁出现未成年儿童色情、血腥暴力内容,一经发现,永久封禁。
                </span>
              </div>
              <div class="comment" :key="msg.id" v-for="msg in messages" :class="msg.type">
                <template v-if="msg.type === 'system'">
                  <span class="system-text">
                    <span class="name" @click.stop="goUser(msg.user_id)">{{
                      _truncate(msg.user_nickname, 15)
                    }}</span>
                    {{ msg.content }}
                  </span>
                </template>
                <template v-else-if="msg.type === 'gift'">
                  <span class="name" @click.stop="goUser(msg.user_id)">{{
                    _truncate(msg.user_nickname, 15)
                  }}</span>
                  <span class="gift-text">送出了 {{ msg.content }}</span>
                  <span class="combo-num" v-if="msg.combo > 1">x{{ msg.combo }}</span>
                </template>
                <template v-else-if="msg.type === 'pc28'">
                  <span class="pc28-text">{{ getPC28MessageText(msg.content) }}</span>
                </template>
                <template v-else>
                  <span class="name" @click.stop="goUser(msg.user_id)"
                    >{{ _truncate(msg.user_nickname, 15) }}:</span
                  >
                  <span class="text">{{ msg.content }}</span>
                </template>
              </div>
            </div>
          </div>
          <div class="options">
            <div class="input" @click="showInput = true">
              <span>评论</span>
            </div>
            <div class="option-item share" @click="showShareDrawer = true">
              <Icon icon="solar:share-bold" />
            </div>
            <!-- 🎯 新增：静音切换按钮 -->
            <div class="option-item mute-toggle" @click="toggleMute">
              <Icon :icon="isMuted ? 'solar:muted-bold' : 'solar:volume-loud-bold'" />
            </div>
            <div
              v-if="
                roomInfo.is_self_hosted &&
                (roomInfo.anchor_id === baseStore.userinfo.uid ||
                  [10000, 10003].includes(baseStore.userinfo.numeric_id))
              "
              class="option-item redpacket"
              @click="showSendPacket = true"
            >
              <img src="/hongbao-.svg" style="width: 24rem; height: 24rem" />
            </div>
            <!-- 🎯 新增：清屏按钮 -->
            <div class="option-item clean-screen" @click="isCleanScreen = !isCleanScreen">
              <Icon icon="mdi:broom" />
            </div>
            <!-- 🎯 新增：横屏切换按钮 -->
            <div
              class="option-item landscape-toggle"
              @click="isLandscape = !isLandscape"
              style="font-size: 22rem"
            >
              <Icon
                :icon="isLandscape ? 'solar:quit-full-screen-bold' : 'solar:full-screen-bold'"
              />
            </div>
            <!-- 🎯 PC28游戏摇杆按钮（仅房间主播可见，排除特殊用户） -->
            <div
              v-if="canControlPC28"
              class="option-item game-toggle"
              @click="handleGameToggleClick"
            >
              <Icon icon="mdi:dice-multiple" style="font-size: 24rem" />
            </div>
            <img src="../../assets/img/icon/home/gift.webp" alt="" class="gift" @click="sendGift" />
          </div>
          <!-- 🎯 安卓全面屏：底部占位元素，避免被三大金刚按钮遮挡 -->
          <div class="android-bottom-spacer"></div>
        </div>
      </div>
    </div>

    <!-- 还原按钮（清屏时显示在右下角） -->
    <teleport to="body">
      <transition name="fade">
        <div v-if="isCleanScreen" class="restore-btn" @click.stop="isCleanScreen = false">
          <Icon icon="solar:restart-bold" class="restore-icon" />
        </div>
      </transition>
    </teleport>

    <!-- 弹出的输入框 -->
    <Transition name="fade">
      <div v-if="showInput" class="input-overlay" @click.self="showInput = false">
        <div class="input-container" @click.stop @mousedown.stop>
          <input
            v-model="inputText"
            ref="commentInput"
            placeholder="评论"
            @keyup.enter="handleSendComment"
            @click.stop
            @mousedown.stop
          />
          <div
            class="send-btn"
            @click.stop="handleSendComment"
            :class="{ active: inputText.trim() && !isSendingComment, disabled: isSendingComment }"
          >
            {{ isSendingComment ? '...' : '发送' }}
          </div>
        </div>
      </div>
    </Transition>

    <!-- 礼物面板 -->
    <Transition name="slide-up">
      <div v-if="showGiftPanel" class="gift-panel-overlay" @click.self="showGiftPanel = false">
        <div class="gift-panel">
          <div class="panel-header">
            <span>赠送礼物</span>
            <div class="coin-info">
              <img src="../../assets/img/icon/home/redpack.png" alt="" />
              <span>{{ userCoins.toFixed(2) }} 抖币</span>
              <Icon
                icon="solar:refresh-bold"
                class="refresh-btn"
                @click="refreshUserBalance"
                style="font-size: 16rem; margin-left: 5rem; cursor: pointer; opacity: 0.8"
              />
              <div class="recharge" @click="handleRecharge">充值</div>
            </div>
          </div>
          <div class="gift-grid">
            <div
              v-for="gift in giftList"
              :key="gift.id"
              class="gift-item"
              :class="{ selected: selectedGiftId === gift.id }"
              @click="selectedGiftId = gift.id"
            >
              <img :src="gift.icon" alt="" loading="lazy" />
              <div class="name">{{ gift.name }}</div>
              <div class="cost">{{ gift.cost }} 抖币</div>
            </div>
          </div>
          <div class="panel-footer">
            <div class="qty-selector">
              <div
                v-for="q in qtyOptions"
                :key="q"
                class="qty-item"
                :class="{ active: selectedQty === q }"
                @click="selectedQty = q"
              >
                {{ q }}
              </div>
              <input
                type="number"
                v-model.number="selectedQty"
                placeholder="数量"
                class="qty-input"
                min="1"
                max="9999"
                @input="
                  () => {
                    if (selectedQty > 9999) selectedQty = 9999
                    if (selectedQty < 1) selectedQty = 1
                  }
                "
              />
            </div>
            <div
              class="send-btn"
              :class="{ disabled: !selectedGiftId || !selectedQty || isSendingGift }"
              @click="handleSendGift"
            >
              {{ isSendingGift ? '发送中...' : '发送' }}
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 充值面板 -->
    <Transition name="slide-up">
      <div
        v-if="showRechargeModal"
        class="gift-panel-overlay recharge-overlay"
        @click.self="showRechargeModal = false"
      >
        <div class="gift-panel recharge-panel">
          <div class="panel-header">
            <span>抖币充值</span>
            <dy-back
              class="round close"
              img="close"
              mode="light"
              @click="showRechargeModal = false"
            />
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
                    >{{
                      (rechargeInfo.pending_order.base_amount * 100).toLocaleString()
                    }}
                    抖币</span
                  >
                </div>

                <div class="payment-address">
                  <div class="addr-label">📍 收款地址 (TRC20)</div>
                  <div
                    class="addr-value"
                    @click="
                      () => {
                        _copy(rechargeInfo.pending_order.trc20_address)
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
          <div v-else class="loading-box">
            <Loading />
          </div>
        </div>
      </div>
    </Transition>

    <!-- 透明视频礼物特效组件 -->
    <VapPlayer ref="vapPlayerRef" :src="vapSrc" @ended="onVapEffectEnded" />

    <!-- 🧧 倒计时红包组件 -->
    <RedPacketOverlay
      v-if="roomId"
      :room-id="roomId"
      :is-followed="isFollowed"
      :last-message="lastUserMessage"
    />

    <!-- 🎯 PC28游戏状态挂件（类似红包，所有用户可见，点击参与下注） -->
    <PC28GameOverlay
      v-if="roomId && pc28Config?.is_enabled"
      :room-id="roomId"
      :config="pc28Config"
      :current-round="pc28CurrentRound"
      :is-anchor="canControlPC28"
      @open-bet="showPC28Bet = true"
      @open-records="handleOpenBetRecords"
    />

    <!-- 🧧 发红包弹窗 -->
    <Transition name="slide-up">
      <div v-if="showSendPacket" class="gift-panel-overlay" @click.self="showSendPacket = false">
        <div class="gift-panel send-packet-panel">
          <div class="panel-header">
            <span>发放直播间红包</span>
            <div class="coin-info">
              <img src="../../assets/img/icon/home/redpack.png" alt="" />
              <span>{{ userCoins.toFixed(2) }} 抖币</span>
            </div>
          </div>

          <div class="packet-form">
            <div class="form-item">
              <label>红包金额</label>
              <input
                type="number"
                v-model.number="packetForm.total_coins"
                placeholder="请输入总金额"
              />
            </div>
            <div class="form-item">
              <label>红包个数</label>
              <input
                type="number"
                v-model.number="packetForm.total_count"
                placeholder="请输入个数"
              />
            </div>
            <div class="form-item">
              <label>红包类型</label>
              <div class="cond-checks">
                <label>
                  <input type="radio" value="lucky" v-model="packetForm.packet_type" /> 拼手气
                </label>
                <label>
                  <input type="radio" value="equal" v-model="packetForm.packet_type" /> 普通
                </label>
              </div>
            </div>
            <div class="form-item">
              <label>倒计时 (秒)</label>
              <select v-model.number="packetForm.countdown_seconds">
                <option :value="60">60秒</option>
                <option :value="180">3分钟</option>
                <option :value="300">5分钟</option>
                <option :value="600">10分钟</option>
              </select>
            </div>
            <div class="form-item">
              <label>领取条件</label>
              <div class="cond-checks">
                <label
                  ><input type="checkbox" v-model="packetForm.claim_conditions.follow" />
                  必须关注</label
                >
                <label><input type="checkbox" v-model="showKeywordInput" /> 指定弹幕</label>
              </div>
              <input
                v-if="showKeywordInput"
                v-model="packetForm.claim_conditions.keyword"
                placeholder="请输入弹幕关键词"
                class="keyword-input"
              />
            </div>
          </div>

          <div class="panel-footer">
            <div
              class="send-btn"
              :class="{ disabled: !canSendPacket || isSendingPacket }"
              @click="handleSendPacket"
            >
              {{ isSendingPacket ? '发放中...' : `立即发放 (${packetForm.total_coins || 0} 抖币)` }}
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 🎯 分享抽屉 -->
    <Transition name="slide-up">
      <div v-if="showShareDrawer" class="gift-panel-overlay" @click.self="showShareDrawer = false">
        <div class="gift-panel share-drawer">
          <div class="panel-header">
            <span>分享直播间</span>
            <Icon
              icon="solar:close-circle-bold"
              class="close-btn"
              style="font-size: 24rem; opacity: 0.5"
              @click="showShareDrawer = false"
            />
          </div>
          <div class="share-grid">
            <div class="share-item" @click="shareRoomDirect">
              <div class="icon-wrap tg">
                <Icon icon="logos:telegram" />
              </div>
              <span>TG 分享</span>
            </div>
            <div class="share-item" @click="copyRoomLink">
              <div class="icon-wrap link">
                <Icon icon="solar:link-bold" />
              </div>
              <span>复制链接</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 🎯 用户信息弹窗 -->
    <Transition name="slide-up">
      <UserPanel
        v-if="showUserPanel"
        :currentItem="selectedUser"
        :active="showUserPanel"
        @back="showUserPanel = false"
        @update:currentItem="handleUpdateUser"
      />
    </Transition>

    <!-- 🎯 PC28游戏菜单弹窗（主播选择游戏） -->
    <Transition name="slide-up">
      <div v-if="showGameMenu" class="game-menu-overlay" @click.self="showGameMenu = false">
        <div class="game-menu">
          <div class="menu-header">
            <h3>选择游戏</h3>
            <Icon icon="solar:close-circle-bold" class="close-btn" @click="showGameMenu = false" />
          </div>
          <div class="menu-content">
            <div class="game-item" @click="handleSelectGame('pc28')">
              <Icon icon="mdi:dice-multiple" style="font-size: 32rem; color: #667eea" />
              <div>
                <div class="game-name">加拿大PC28</div>
                <div class="game-desc">猜大小、单双、组合</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 🎯 PC28游戏设置弹窗（主播） -->
    <!-- 🎯 PC28游戏设置弹窗 (仅房间主播可见，排除特殊用户) -->
    <PC28GameConfigComponent
      v-if="showPC28Config && canControlPC28"
      :show="showPC28Config"
      :config="pc28Config"
      :room-id="roomId"
      @close="showPC28Config = false"
      @save="handleSavePC28Config"
    />

    <!-- 🎯 PC28游戏控制面板（仅房间主播可见，排除特殊用户） -->
    <PC28GameControl
      v-if="showPC28Control && canControlPC28"
      :show="showPC28Control"
      :current-round="pc28CurrentRound"
      :room-id="roomId"
      @close="showPC28Control = false"
      @refresh="handlePC28Refresh"
    />

    <!-- 🎯 PC28用户下注面板 -->
    <PC28BetPanel
      v-if="showPC28Bet"
      :show="showPC28Bet"
      :config="pc28Config"
      :current-round="pc28CurrentRound"
      @close="showPC28Bet = false"
    />

    <!-- 🎯 PC28下注记录面板（主播视角或已结算时所有用户可查看） -->
    <PC28BetRecords
      v-if="
        showPC28BetRecords &&
        pc28CurrentRound &&
        (canControlPC28 || pc28CurrentRound.status === 'settled')
      "
      :show="showPC28BetRecords"
      :current-round="pc28CurrentRound"
      @close="showPC28BetRecords = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, nextTick, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { supabase } from '@/utils/supabase'
import { _checkImgUrl, _notice, _copy, _truncate } from '@/utils'
import { toggleFollowUser, sendReward, sendRedPacket, incrementWatchTime } from '@/api/videos'
import DPPlayer from '@/components/live/DPPlayer.vue'
import VapPlayer from '@/components/live/VapPlayer.vue'
import UserPanel from '@/components/UserPanel.vue'
import RedPacketOverlay from '@/components/live/RedPacketOverlay.vue'
import PC28GameOverlay from '@/components/live/PC28GameOverlay.vue'
import PC28GameConfigComponent from '@/components/live/PC28GameConfig.vue'
import PC28GameControl from '@/components/live/PC28GameControl.vue'
import PC28BetPanel from '@/components/live/PC28BetPanel.vue'
import PC28BetRecords from '@/components/live/PC28BetRecords.vue'
import Dom from '@/utils/dom'
import { DefaultUser } from '@/utils/const_var'

import { useBaseStore } from '@/store/pinia'
import { getPC28Config, upsertPC28Config, getCurrentRound } from '@/api/pc28'
import type { PC28GameConfig, PC28GameRound } from '@/api/pc28'

const route = useRoute()
const baseStore = useBaseStore()
const roomId = computed(() => route.query.id as string)

// 🎯 切换直播间时，强制恢复竖屏并重置静音状态
watch(roomId, () => {
  isLandscape.value = false
  // 🎯 每次进入新房间都默认静音，确保能自动播放
  isMuted.value = !(window as any).Telegram?.WebApp?.initData
})

const page = ref<HTMLElement | null>(null)

const roomInfo = ref<any>({})
const messages = ref<any[]>([])
const isFollowed = ref(false)
const showInput = ref(false)
const inputText = ref('')
const comments = ref<HTMLElement | null>(null)
const commentInput = ref<HTMLInputElement | null>(null) // 新增 Ref
const isSendingComment = ref(false)
const isSendingGift = ref(false)
const isSendingPacket = ref(false)
const isLandscape = ref(false) // 🎯 新增：横屏状态
const isCleanScreen = ref(false) // 🎯 清屏状态
// 🎯 策略：安卓环境或非 TG MiniApp 环境默认静音，以绕过极其严格的自动播放限制
const isAndroid = /Android/i.test(navigator.userAgent)
const isMuted = ref(isAndroid || !(window as any).Telegram?.WebApp?.initData)
const playerRef = ref<any>(null)
const showUserPanel = ref(false)
const followLoading = ref(false) // 🎯 防止重复点击关注

const isInitialTouch = ref(true) // 🎯 用于安卓端首次触摸解锁播放

async function toggleMute() {
  isMuted.value = !isMuted.value
  if (!isMuted.value) {
    // 🎯 开启声音：必须通过直接调用 video.play() 来满足浏览器的用户交互要求
    playerRef.value?.unmuteAndPlay()
  }
}

// 🎯 安卓端兜底：用户首次点击页面时，尝试解锁播放（解决黑屏/无画面）
function handleFirstTouch() {
  if (isAndroid && isInitialTouch.value) {
    isInitialTouch.value = false
    playerRef.value?.play()
  }
}
const selectedUser = ref<any>(null)

// 🎯 横屏模式切换时，自动清理当前正在播放和队列中的特效
watch(isLandscape, (val) => {
  if (val) {
    giftEffectQueue.value = []
    isPlayingEffect.value = false
    vapSrc.value = ''
    // 移除所有正在显示的 CSS 礼物横幅和大礼物特效
    document.querySelectorAll('.send-gift, .large-gift-effect').forEach((el) => el.remove())
  }
})

const vapPlayerRef = ref<any>(null)
const vapSrc = ref('') // 初始值为空

// 🎁 特效播放队列
interface GiftEffectItem {
  giftName: string
  giftIcon: string
  nickname: string
  duration: number
  titleIcon?: string
  effectUrl?: string
  type: 'vap' | 'css' // vap=MP4特效, css=CSS动画特效
}

const giftEffectQueue = ref<GiftEffectItem[]>([])
const isPlayingEffect = ref(false) // 当前是否有特效正在播放
const viewerCount = ref(0)
const viewers = ref<any[]>([]) // 存储前几名观众
let watchTimeTimer: any = null // 观看时长定时器
const fallbackAvatar = new URL('../../assets/img/icon/avatar/0.png', import.meta.url).href

// --- 礼物相关 ---
const showGiftPanel = ref(false)
const giftList = ref<any[]>([])
const selectedGiftId = ref<number | null>(null)
const selectedQty = ref(1)
const userCoins = ref(0) // 抖币余额

// --- 充值相关 ---
const showRechargeModal = ref(false)
const rechargeInfo = ref<any>(null)

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

async function handleRecharge() {
  showRechargeModal.value = true
  await fetchRechargeInfo()
}

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
    } else {
      _notice(payload.msg || '创建失败')
    }
  } catch (e: any) {
    _notice(e.message || '系统错误')
  }
}

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

// --- 红包相关 ---
const showSendPacket = ref(false)
const showKeywordInput = ref(false)
const lastUserMessage = ref('')
const packetForm = reactive({
  total_coins: 100,
  total_count: 10,
  packet_type: 'lucky' as const,
  countdown_seconds: 300,
  claim_conditions: {
    follow: false,
    keyword: ''
  }
})

// --- PC28游戏相关 ---
const showGameMenu = ref(false)
const showPC28Config = ref(false)
const showPC28Control = ref(false)
const showPC28Bet = ref(false)
const showPC28BetRecords = ref(false)
const pc28Config = ref<PC28GameConfig | null>(null)
const pc28CurrentRound = ref<PC28GameRound | null>(null)
const isAnchor = computed(() => {
  return (
    roomInfo.value.is_self_hosted &&
    (roomInfo.value.anchor_id === baseStore.userinfo.uid ||
      [10000, 10003].includes(baseStore.userinfo.numeric_id))
  )
})

// PC28游戏控制权限：只有真正的房间主播可以控制（排除10003等特殊用户）
const canControlPC28 = computed(() => {
  return roomInfo.value.is_self_hosted && roomInfo.value.anchor_id === baseStore.userinfo.uid
})

function handleOpenBetRecords() {
  console.log('[LivePage] handleOpenBetRecords called')
  console.log('[LivePage] canControlPC28:', canControlPC28.value)
  console.log('[LivePage] pc28CurrentRound:', pc28CurrentRound.value)
  console.log('[LivePage] Setting showPC28BetRecords to true')
  showPC28BetRecords.value = true
  console.log('[LivePage] showPC28BetRecords after set:', showPC28BetRecords.value)
}

// PC28实时监听
let pc28Channel: any = null

async function fetchPC28Data() {
  if (!roomId.value) return

  try {
    // 获取配置
    const config = await getPC28Config(roomId.value)
    pc28Config.value = config

    // 获取当前期数
    const round = await getCurrentRound(roomId.value)
    pc28CurrentRound.value = round
  } catch (e: any) {
    console.error('[PC28] fetch data error:', e)
  }
}

// PC28刷新处理（包括刷新用户余额）
async function handlePC28Refresh() {
  await fetchPC28Data()
  // 结算后刷新用户余额
  await refreshUserBalance()
}

async function handleSavePC28Config(config: Partial<PC28GameConfig>) {
  if (!roomId.value) return

  try {
    await upsertPC28Config(roomId.value, config)
    await fetchPC28Data()
  } catch (e: any) {
    _notice(e.message || '保存失败')
  }
}

function handleGameToggleClick() {
  // 只有房间主播可以控制PC28游戏
  if (canControlPC28.value) {
    if (pc28Config.value?.is_enabled) {
      showPC28Control.value = true
    } else {
      showPC28Config.value = true
    }
  } else {
    // 非主播不应该看到这个按钮，但以防万一
    showGameMenu.value = true
  }
}

function handleSelectGame(game: string) {
  showGameMenu.value = false
  if (game === 'pc28') {
    if (canControlPC28.value) {
      // 房间主播：打开设置或控制面板
      if (pc28Config.value?.is_enabled) {
        showPC28Control.value = true
      } else {
        showPC28Config.value = true
      }
    } else {
      // 用户：打开下注面板
      showPC28Bet.value = true
    }
  }
}

// 解析PC28消息内容，如果是JSON则提取text字段
function getPC28MessageText(content: string): string {
  try {
    const parsed = JSON.parse(content)
    return parsed.text || content
  } catch {
    // 如果不是JSON，直接返回原内容
    return content
  }
}

function setupPC28Realtime() {
  if (!roomId.value) return

  pc28Channel = supabase
    .channel(`pc28_${roomId.value}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'pc28_game_configs',
        filter: `room_id=eq.${roomId.value}`
      },
      () => {
        fetchPC28Data()
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'pc28_game_rounds',
        filter: `room_id=eq.${roomId.value}`
      },
      () => {
        fetchPC28Data()
      }
    )
    .subscribe()
}

const canSendPacket = computed(() => {
  return (
    packetForm.total_coins >= 10 &&
    packetForm.total_count >= 1 &&
    userCoins.value >= packetForm.total_coins
  )
})

async function handleSendPacket() {
  if (!canSendPacket.value || isSendingPacket.value) return
  isSendingPacket.value = true

  try {
    // 🎯 深度克隆并清理未启用的条件
    const finalForm = JSON.parse(JSON.stringify(packetForm))
    if (!showKeywordInput.value || !finalForm.claim_conditions.keyword) {
      delete finalForm.claim_conditions.keyword
    }
    if (!finalForm.claim_conditions.follow) {
      delete finalForm.claim_conditions.follow
    }

    console.log('[RedPacket] 发送红包参数:', finalForm)

    const res = await sendRedPacket({
      room_id: roomId.value,
      ...finalForm
    })
    if (res?.packet) {
      _notice('红包发放成功！')
      showSendPacket.value = false
      userCoins.value -= packetForm.total_coins

      // 发放成功后重置表单部分字段
      packetForm.claim_conditions.keyword = ''
      showKeywordInput.value = false
    }
  } catch (e: any) {
    _notice(e.message || '发放失败')
  } finally {
    isSendingPacket.value = false
  }
}

// 增加“发红包”入口按钮 (在 options 区域)
// ... 下面会修改模板增加按钮

const qtyOptions = [1, 99, 520, 1314]

// 资源路径处理
function getResourceUrl(path: string) {
  // 如果 VITE_RESOURCE_URL 存在，则拼接到路径前缀；否则使用本地相对路径
  const base = (import.meta.env.VITE_RESOURCE_URL || '').replace(/\/$/, '')
  if (!path) return ''
  if (path.startsWith('http')) return path
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

// 从数据库加载礼物列表
async function fetchGifts() {
  try {
    const { data, error } = await supabase
      .from('gifts')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error) throw error

    // 处理数据库中的礼物，映射字段名并应用资源路径
    giftList.value = (data || []).map((g) => ({
      ...g,
      cost: g.price, // 统一字段名为 cost 兼容现有逻辑
      // 适配 R2 路径结构：图标在 gifts_icon，特效在 gifts
      icon: getResourceUrl(`/gifts_icon/${g.icon_filename}`),
      effectUrl: g.effect_filename
        ? getResourceUrl(`/gifts/${encodeURIComponent(g.effect_filename)}?v=1`)
        : null
    }))
  } catch (e) {
    console.error('[LivePage] fetchGifts error:', e)
  }
}

function sendGift() {
  showGiftPanel.value = true
}

async function handleSendGift() {
  if (!selectedGiftId.value || !selectedQty.value || isSendingGift.value) return
  isSendingGift.value = true

  const gift = giftList.value.find((g) => g.id === selectedGiftId.value)
  if (!gift) {
    isSendingGift.value = false
    return
  }

  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) {
    _notice('请先登录后再送礼物')
    isSendingGift.value = false
    return
  }

  // 检查数量限制
  if (selectedQty.value > 9999) {
    _notice('单次发送礼物数量不能超过 9999')
    selectedQty.value = 9999
    isSendingGift.value = false
    return
  }

  // 检查余额（前端初步检查，后端 RPC 会做最终校验）
  const totalCost = gift.cost * selectedQty.value
  if (userCoins.value < totalCost) {
    _notice('抖币余额不足，请先充值')
    isSendingGift.value = false
    return
  }

  try {
    // 1. 调用后端接口处理真实扣款、分成、代发消息和通知
    const receiverId = roomInfo.value.anchor_id || roomInfo.value.anchor_info?.id

    const res = await sendReward({
      receiver_id: receiverId,
      gift_amount: totalCost,
      room_or_video_id: roomId.value,
      gift_type: 'live',
      gift_name: gift.name,
      gift_id: gift.id,
      gift_icon: gift.icon,
      gift_qty: selectedQty.value,
      effect_url: gift.effectUrl
    })

    // 2. 更新本地余额显示
    if (res && typeof res.sender_balance === 'number') {
      userCoins.value = Math.floor(Number(res.sender_balance) * 100) / 100
    } else {
      // 如果返回中没有余额，刷新一次
      await refreshUserBalance()
    }

    // 后端已经通过 supabaseAdmin 代发了消息，前端不需要再 insert
    // 只需要关闭面板即可，实时监听会自动收到消息并触发特效
    // showGiftPanel.value = false
    selectedQty.value = 1
    // selectedGiftId.value = null
  } catch (e: any) {
    console.error('[Gift] Send error:', e)
    const msg = e.message || ''
    if (msg.includes('余额不足')) {
      _notice('抖币余额不足，请先充值')
    } else {
      _notice('发送礼物失败: ' + (msg || '网络繁忙'))
    }
  } finally {
    isSendingGift.value = false
  }
}

// --- 房间切换核心逻辑 ---
async function initRoom() {
  const currentId = route.query.id as string
  if (!currentId) return

  // 1. 先清理旧的订阅
  if (channel) {
    await supabase.removeChannel(channel)
    channel = null
  }

  // 2. 重置基础状态，强制销毁旧播放器
  roomInfo.value = { stream_url: null }
  messages.value = []
  viewerCount.value = 0
  viewers.value = []
  isFollowed.value = false

  // 3. 加载新数据
  await fetchRoomInfo()
  await fetchHistoryMessages()

  // 4. 开启新的订阅
  setupSubscription()

  // 5. 加载PC28数据
  await fetchPC28Data()
  setupPC28Realtime()
}

// 监听路由参数变化，实现直播间无缝切换
watch(
  () => route.query.id,
  (newId) => {
    if (newId) {
      // 也可以不刷新页面，手动执行 init
      initRoom()
    }
  }
)

// 监听输入框显示，自动聚焦
watch(showInput, (val) => {
  if (val) {
    // Windows上需要延迟更长时间才能正确聚焦
    nextTick(() => {
      setTimeout(() => {
        commentInput.value?.focus()
        // 确保输入框获得焦点后，光标在输入框内
        if (commentInput.value) {
          commentInput.value.setSelectionRange(0, 0)
        }
      }, 100)
    })
  }
})

// 展示观众列表
function showViewerList() {
  if (viewers.value.length === 0) return
  const names = viewers.value.map((v) => v.nickname).join('、')
  _notice(`在线观众：${names}${viewerCount.value > 5 ? ` 等共 ${viewerCount.value} 人` : ''}`)
}

// --- 分享相关 ---
const showShareDrawer = ref(false)
const rawBotUsername = import.meta.env.VITE_TG_BOT_USERNAME || 'dydy'
const botUsername = rawBotUsername.replace('@', '')
const appName = import.meta.env.VITE_TG_APP_NAME || 'tgdouyin'

const roomDeepLink = computed(() => {
  const rid = roomId.value
  if (!rid) return ''
  let link = `https://t.me/${botUsername}/${appName}?startapp=live_${rid}`
  if (baseStore.userinfo?.numeric_id) {
    link += `_i${baseStore.userinfo.numeric_id}`
  }
  return link
})

function copyRoomLink() {
  const rid = roomId.value
  if (!rid) return

  // 🎯 恢复为“分享口令”格式，以便在 Telegram 中弹出卡片
  let shareCommand = `@dydy live_${rid}`
  if (baseStore.userinfo?.numeric_id) {
    shareCommand += `_i${baseStore.userinfo.numeric_id}`
  }

  _copy(shareCommand)
  _notice('分享口令已复制，去聊天框粘贴即可弹出卡片')
  showShareDrawer.value = false
}

function shareRoomDirect() {
  const rid = roomId.value
  if (!rid) return

  const anchorName = roomInfo.value.anchor_info?.nickname || '主播'
  const link = roomDeepLink.value
  const text = `📺 快来围观 ${anchorName} 的直播间！\n\n来自 #TG抖音`

  // 🎯 改回标准分享协议，避免关闭 Mini App
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`

  // @ts-ignore
  if (window.Telegram?.WebApp) {
    // @ts-ignore
    window.Telegram.WebApp.openTelegramLink(shareUrl)
  } else {
    window.open(shareUrl, '_blank')
  }
  showShareDrawer.value = false
}

// --- 动画通知模板 ---
const userJoinedTemplate = (nickname: string, rank?: number) => {
  const levelImg = new URL('../../assets/img/icon/home/level.webp', import.meta.url).href
  return `
    <div class="user-joined">
      <div class="rank-badge">
        <img src="${levelImg}" alt="">
        <span>${rank || 1}</span>
      </div>
      <span class="name">${nickname}</span>
      <span class="text">加入了直播间</span>
    </div>
  `
}

const sendGiftTemplate = (
  nickname: string,
  avatar: string,
  giftName: string,
  giftIcon: string,
  amount: number,
  bannerId: string
) => {
  const avatarUrl = _checkImgUrl(avatar) || fallbackAvatar
  return `
    <div class="send-gift" id="${bannerId}">
      <div class="left">
        <img src="${avatarUrl}" alt="" class="avatar">
        <div class="desc">
          <div class="name">${nickname}</div>
          <div class="sendto">
            <span class="send">送出</span>
            <span class="to">${giftName}</span>
          </div>
        </div>
        <div class="gift-wrapper">
          <img src="${giftIcon}" alt="" class="gift-icon">
        </div>
      </div>
      <div class="right-count">
        x${amount}
      </div>
    </div>
  `
}

// --- 触发动画通知 ---
function triggerUserJoinedAnim(nickname: string, rank?: number) {
  if (!page.value) return
  const domPage = new Dom(page.value)
  const user = new Dom().create(userJoinedTemplate(nickname, rank))
  user.on('animationend', () => user.remove())
  domPage.append(user)
}

function triggerGiftAnim(
  nickname: string,
  avatar: string,
  giftName: string,
  giftIcon: string,
  amount: number,
  duration: number = 3
) {
  if (!page.value || isLandscape.value) return // 🎯 横屏模式下不播放礼物横幅
  // 为每一个送礼动作生成一个完全唯一的 ID，强制触发进入动画
  const bannerId = `gift-banner-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

  const domPage = new Dom(page.value)
  const gift = new Dom().create(
    sendGiftTemplate(nickname, avatar, giftName, giftIcon, amount, bannerId)
  )

  // 设置动态显示时长
  gift.css('animation-duration', duration + 's')

  // 标记为活跃横幅
  gift.els[0].setAttribute('data-active', 'true')

  gift.on('animationend', () => {
    gift.els[0].removeAttribute('data-active')
    gift.remove()
  })

  // 计算位置，防止重叠
  // 起始位置调高（0.4vh），避开评论区
  const activeBanners = document.querySelectorAll('.send-gift[data-active="true"]')
  let top = document.body.clientHeight * 0.4

  if (activeBanners.length > 0) {
    // 找到最高的一个（top 值最小的）
    let minTop = top
    activeBanners.forEach((el: any) => {
      const t = parseInt(el.style.top) || el.offsetTop
      if (t > 0 && t < minTop) minTop = t
    })
    top = minTop - 75
  }

  // 防止堆叠太高，重置回初始位置
  if (top < document.body.clientHeight * 0.1) {
    top = document.body.clientHeight * 0.4
  }

  gift.css('top', top + 'px')
  domPage.append(gift)
}

// 🎁 VAP特效播放完成回调
function onVapEffectEnded() {
  console.log('[GiftEffect] VAP特效播放完成')
  isPlayingEffect.value = false
  // 播放下一个队列中的特效
  playNextEffect()
}

// 🎁 CSS动画特效播放完成回调
function onCssEffectEnded() {
  console.log('[GiftEffect] CSS特效播放完成')
  isPlayingEffect.value = false
  // 播放下一个队列中的特效
  playNextEffect()
}

// 🎁 播放下一个队列中的特效
function playNextEffect() {
  if (giftEffectQueue.value.length === 0) {
    console.log('[GiftEffect] 队列已空，停止播放')
    return
  }

  const nextEffect = giftEffectQueue.value.shift()
  if (!nextEffect) return

  console.log('[GiftEffect] 开始播放队列中的特效:', nextEffect.giftName)
  isPlayingEffect.value = true

  if (nextEffect.type === 'vap') {
    // MP4特效
    const finalUrl = nextEffect.effectUrl?.startsWith('http')
      ? nextEffect.effectUrl
      : nextEffect.effectUrl || ''

    // 🎯 先清空 src，确保每次都会重新加载（即使 URL 相同）
    vapSrc.value = ''

    // 给一点时间让清空生效，然后设置新的 src
    nextTick(() => {
      vapSrc.value = finalUrl
      // 再给一点时间让 src 切换生效
      nextTick(() => {
        if (vapPlayerRef.value) {
          vapPlayerRef.value.play()
        }
      })
    })
  } else {
    // CSS动画特效
    if (!page.value) {
      isPlayingEffect.value = false
      playNextEffect() // 如果页面不存在，继续播放下一个
      return
    }

    const domPage = new Dom(page.value)
    const contentHtml = nextEffect.titleIcon
      ? `<img src="${nextEffect.titleIcon}" class="large-gift-svg" alt="${nextEffect.giftName}">`
      : `
        <img src="${nextEffect.giftIcon}" class="large-gift-icon" alt="">
        <div class="gift-title">送出 ${nextEffect.giftName}</div>
        <div class="user-name">${nextEffect.nickname}</div>
      `

    const template = `
      <div class="large-gift-effect" style="animation-duration: ${nextEffect.duration}s">
        <div class="effect-content" style="animation-duration: ${nextEffect.duration}s">
          <div class="glow"></div>
          ${contentHtml}
        </div>
      </div>
    `
    const effect = new Dom().create(template)
    effect.on('animationend', () => {
      effect.remove()
      onCssEffectEnded()
    })
    domPage.append(effect)
  }
}

function triggerLargeGiftEffect(
  giftName: string,
  giftIcon: string,
  nickname: string,
  duration: number = 3,
  titleIcon?: string,
  effectUrl?: string
) {
  if (isLandscape.value) return // 🎯 横屏模式下不播放大礼物特效
  // 🎁 将特效加入队列
  const effectItem: GiftEffectItem = {
    giftName,
    giftIcon,
    nickname,
    duration,
    titleIcon,
    effectUrl,
    type: effectUrl ? 'vap' : 'css'
  }

  giftEffectQueue.value.push(effectItem)
  console.log(
    '[GiftEffect] 特效已加入队列:',
    giftName,
    '当前队列长度:',
    giftEffectQueue.value.length
  )

  // 🎁 如果当前没有特效在播放，立即开始播放
  if (!isPlayingEffect.value) {
    playNextEffect()
  } else {
    console.log('[GiftEffect] 当前有特效正在播放，等待队列')
  }
}

// 🎯 计算显示人数：真实人数 + 自定义偏移量
function getDisplayViewerCount(room: any): number {
  const realCount = room.viewer_count || room.real_viewer_count || 0
  const customOffset = room.custom_viewer_count || 0
  return realCount + customOffset
}

// 获取直播间信息
async function fetchRoomInfo() {
  const currentRoomId = roomId.value

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

    const resp = await fetch(`${getAppServerBase()}/live/detail?id=${currentRoomId}`, { headers })
    const payload = await resp.json()

    if (resp.ok && payload.code === 0) {
      const room = payload.data.room
      roomInfo.value = {
        ...room,
        stream_url: buildPlayUrl(room.stream_url)
      }
      // 🎯 计算显示人数：优先使用自定义人数（如果存在且不为0），否则使用实际人数
      const displayCount = getDisplayViewerCount(room)
      viewerCount.value = displayCount

      // 获取个人抖币余额 (无论是否自建直播)
      await refreshUserBalance()

      // 检查关注状态 (不管是自建还是转播，只要有主播 ID)
      if (session?.user?.id && room.anchor_info?.id) {
        const { data: follow } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', session.user.id)
          .eq('followee_id', room.anchor_info.id)
          .maybeSingle()
        isFollowed.value = !!follow
      }
    } else {
      console.error('[LivePage] fetchRoomInfo failed:', payload.msg || resp.status)
    }
  } catch (e) {
    console.error('[LivePage] fetchRoomInfo error:', e)
  }
}

// 刷新用户余额
async function refreshUserBalance() {
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
        userCoins.value = Math.floor(Number(profile.balance_coins || 0) * 100) / 100
      }
    }
  } catch (e) {
    console.error('[LivePage] refreshUserBalance error:', e)
  }
}

function getAppServerBase() {
  const explicit = import.meta.env.VITE_APP_SERVER_URL
  if (explicit) return explicit.replace(/\/$/, '')
  if (import.meta.env.DEV) return '/api/app-server'
  if (import.meta.env.VITE_SUPABASE_URL) {
    return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/app-server`
  }
  return ''
}

function buildPlayUrl(url: string) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw)
    // 只有抖音源且没有指定 stream 类型时，才默认加上 stream=hls
    if (
      u.pathname.includes('/douyin/') &&
      !u.searchParams.has('stream') &&
      !u.searchParams.has('media')
    ) {
      u.searchParams.set('stream', 'hls')
      return u.toString()
    }
  } catch {
    // ignore
  }
  return raw
}

// 获取历史评论
async function fetchHistoryMessages() {
  const currentRoomId = roomId.value

  const { data, error } = await supabase
    .from('live_broadcast_messages')
    .select('id, content, user_id, msg_type, payload, profiles!user_id(nickname)')
    .eq('room_id', currentRoomId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[LivePage] fetchHistoryMessages error:', error)
    // 如果还是报错，尝试不带 join 的查询作为兜底
    if (error.code === 'PGRST201') {
      const { data: fallbackData } = await supabase
        .from('live_broadcast_messages')
        .select('id, content, user_id, msg_type, payload')
        .eq('room_id', currentRoomId)
        .order('created_at', { ascending: false })
        .limit(20)

      if (fallbackData) {
        messages.value = fallbackData.reverse().map((m: any) => ({
          id: m.id,
          content: m.content,
          user_id: m.user_id,
          user_nickname: '用户',
          type: m.msg_type || 'chat',
          combo: m.payload?.combo || 1
        }))
        scrollToBottom()
      }
    }
    return
  }

  if (data) {
    messages.value = data.reverse().map((m: any) => ({
      id: m.id,
      content: m.content,
      user_id: m.user_id,
      user_nickname: m.profiles?.nickname || '路人',
      type: m.msg_type || 'chat',
      combo: m.payload?.combo || 1,
      payload: m.payload
    }))
    scrollToBottom()
  }
}

// 发送评论
async function handleSendComment() {
  if (!inputText.value.trim() || isSendingComment.value) return
  isSendingComment.value = true

  try {
    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (!user) {
      _notice('请先登录')
      return
    }

    const { error } = await supabase.from('live_broadcast_messages').insert({
      room_id: roomId.value,
      user_id: user.id,
      content: inputText.value.trim()
    })

    if (!error) {
      lastUserMessage.value = inputText.value.trim() // 🎯 记录最后一条消息用于红包条件
      inputText.value = ''
      showInput.value = false
    } else {
      console.error('发送评论失败:', error)
      _notice('发送失败，请重试')
    }
  } catch (e) {
    console.error('发送评论异常:', e)
  } finally {
    isSendingComment.value = false
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (comments.value) {
      comments.value.scrollTop = comments.value.scrollHeight
    }
  })
}

function onPlayerError(err: any) {
  console.error('播放器错误:', err)
}

async function attention() {
  if (!roomInfo.value.anchor_info?.id || followLoading.value) {
    return
  }

  const targetId = roomInfo.value.anchor_info.id
  const nextStatus = !isFollowed.value
  followLoading.value = true

  try {
    const res = await toggleFollowUser(targetId, nextStatus)
    // res 是后端返回的 data: { follow: boolean, ... }
    if (res && typeof res.follow === 'boolean') {
      isFollowed.value = res.follow
    } else {
      // 兼容某些返回
      isFollowed.value = nextStatus
    }
  } catch (e: any) {
    // 如果是 500 错误，可能是后端问题
    _notice('关注失败: ' + (e.message || '未知错误'))
  } finally {
    followLoading.value = false
  }
}

function goUser(uid: string) {
  console.log('[LivePage] goUser:', uid)
  if (!uid) return

  // 🎯 修改为弹窗模式，不中断直播
  selectedUser.value = {
    author: {
      ...DefaultUser,
      user_id: uid,
      uid: uid
    },
    aweme_list: []
  }
  showUserPanel.value = true
}

function handleUpdateUser(newItem: any) {
  selectedUser.value = newItem
}

let channel: any = null

const profileCache = new Map<string, { nickname: string; avatar_url: string }>()

function setupSubscription() {
  const currentRoomId = route.query.id as string
  if (!currentRoomId) return

  // 订阅实时消息
  channel = supabase
    .channel(`live_room_${currentRoomId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'live_broadcast_messages',
        filter: `room_id=eq.${currentRoomId}`
      },
      async (payload) => {
        const isGift = payload.new.msg_type === 'gift'
        const giftPayload = payload.new.payload || {}

        // 无论是否是礼物，都先拉取用户信息（增加缓存防止卡顿）
        let profile = profileCache.get(payload.new.user_id)
        if (!profile) {
          const { data } = await supabase
            .from('profiles')
            .select('nickname, avatar_url')
            .eq('id', payload.new.user_id)
            .single()
          if (data) {
            profile = {
              nickname: data.nickname || '路人',
              avatar_url: data.avatar_url || ''
            }
            profileCache.set(payload.new.user_id, profile)
          }
        }

        const nickname = profile?.nickname || '路人'
        const avatar = profile?.avatar_url || ''

        if (isGift) {
          // 根据单次送礼的总价值计算停留时间
          const giftId = Number(giftPayload.gift_id)
          const gift = giftList.value.find((g) => g.id === giftId)
          const unitPrice = gift ? gift.cost : 0
          const totalValue = unitPrice * (giftPayload.amount || 1)

          let animDuration = 3 // 基础 3 秒
          if (totalValue >= 50) animDuration = 4
          if (totalValue >= 100) animDuration = 6
          if (totalValue >= 500) animDuration = 8
          if (totalValue >= 1000) animDuration = 12
          if (totalValue >= 3000) animDuration = 18 // 高价值大礼物停留更久

          // 1. 触发基础横幅动画
          triggerGiftAnim(
            nickname,
            avatar,
            giftPayload.gift_name || payload.new.content,
            giftPayload.gift_icon || '',
            giftPayload.combo || giftPayload.amount || 1,
            animDuration
          )

          // 2. 触发大礼物全屏特效
          // 如果礼物自带 effect_url (数据库配置的 MP4)，则直接播放 MP4 特效
          // 否则根据价值触发基础的全屏图标动画
          if (giftPayload.effect_url || totalValue >= 100) {
            const giftIcon = giftPayload.gift_icon || ''
            const isSvg = giftIcon.toLowerCase().endsWith('.svg')

            triggerLargeGiftEffect(
              giftPayload.gift_name,
              giftIcon,
              nickname,
              animDuration,
              isSvg ? giftIcon : undefined,
              giftPayload.effect_url ? getResourceUrl(giftPayload.effect_url) : undefined
            )
          }
        }

        // 普通消息或新礼物消息添加
        const newMessage = {
          id: payload.new.id,
          content: payload.new.content,
          user_id: payload.new.user_id,
          user_nickname: nickname,
          type: payload.new.msg_type || 'chat',
          combo: giftPayload.combo || 1,
          payload: payload.new.payload
        }

        messages.value.push(newMessage)
        if (messages.value.length > 100) messages.value.shift()
        scrollToBottom()
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'live_broadcast_rooms',
        filter: `id=eq.${currentRoomId}`
      },
      (payload) => {
        console.log('[LivePage] Room info updated:', payload.new)
        // 🎯 更新本地 roomInfo 中的自定义人数和状态等
        const newInfo = {
          ...roomInfo.value,
          ...payload.new
        }
        // 如果推送了新的流地址，重新构建播放地址
        if (payload.new.stream_url) {
          newInfo.stream_url = buildPlayUrl(payload.new.stream_url)
        }
        roomInfo.value = newInfo

        // 🎯 重新计算并显示人数
        viewerCount.value = getDisplayViewerCount(roomInfo.value)
      }
    )
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      // 提取所有在线连接
      const allPresences = Object.entries(state).flatMap(([key, presences]) => {
        return (presences as any[]).map((p) => ({ ...p, presence_key: key }))
      })

      // 🎯 更新总人数：真实在线人数 + 自定义偏移量
      const realCount = Math.max(allPresences.length, 1)
      const customOffset = roomInfo.value.custom_viewer_count || 0
      viewerCount.value = realCount + customOffset

      // 提取头像流（去重显示，每个人只占一个坑位）
      const uniqueViewers = new Map()
      allPresences.forEach((p) => {
        if (p.user_id && !uniqueViewers.has(p.user_id)) {
          uniqueViewers.set(p.user_id, {
            id: p.user_id,
            nickname: p.nickname || '路人',
            avatar: p.avatar,
            renderKey: `${p.user_id}_${p.presence_key}` // 唯一的渲染 Key
          })
        }
      })

      viewers.value = Array.from(uniqueViewers.values()).slice(0, 5)
    })
    .on('broadcast', { event: 'user_joined' }, (payload) => {
      const nickname = payload.payload.nickname || '路人'
      const rank = payload.payload.rank || 1
      const userId = payload.payload.user_id
      // 1. 添加到列表
      messages.value.push({
        id: Date.now(),
        user_id: userId,
        user_nickname: nickname,
        content: '加入了直播间',
        type: 'system'
      })
      scrollToBottom()
      // 2. 触发抖音进场动画
      triggerUserJoinedAnim(nickname, rank)
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        const {
          data: { user }
        } = await supabase.auth.getUser()
        if (user) {
          const { data: me } = await supabase
            .from('profiles')
            .select('nickname, avatar_url, invite_success_count')
            .eq('id', user.id)
            .single()
          const nickname = me?.nickname || '路人'
          const avatar = me?.avatar_url || ''
          const rank = me?.invite_success_count || 1

          // 追踪 Presence
          channel.track({
            user_id: user.id,
            nickname: nickname,
            avatar: avatar,
            rank: rank
          })

          // 广播进入
          channel.send({
            type: 'broadcast',
            event: 'user_joined',
            payload: { nickname, rank, user_id: user.id }
          })

          // 自己也显示进场动画
          triggerUserJoinedAnim(nickname, rank)
        }
      }
    })
}

onMounted(async () => {
  await fetchGifts()
  await initRoom()
  await fetchPC28Data()
  setupPC28Realtime()

  // 🎯 观看时长上报：每10秒上报一次
  watchTimeTimer = setInterval(() => {
    // 只有在直播状态才上报
    if (roomInfo.value?.status === 'live') {
      console.log(`[WatchTime] 直播间心跳上报: 10秒, roomId=${roomId.value}`)
      incrementWatchTime(10, roomId.value).catch((e) => {
        console.warn('[WatchTime] 直播间上报失败:', e)
      })
    }
  }, 10000)
})

onBeforeUnmount(() => {
  isLandscape.value = false // 退出时重置状态
  if (channel) supabase.removeChannel(channel)
  if (pc28Channel) supabase.removeChannel(pc28Channel)
  if (watchTimeTimer) {
    clearInterval(watchTimeTimer)
    watchTimeTimer = null
  }
})
</script>

<style lang="less">
@import '../../assets/less/index';

/* 全局动画样式（不能加 scoped，因为是动态创建的 DOM） */
.send-gift {
  position: fixed;
  left: 15rem;
  display: flex;
  align-items: center;
  z-index: 10000; /* 提高层级 */
  pointer-events: none;
  animation: send-gift-anim ease-out forwards;
  /* animation-duration 由 JS 动态控制 */

  @keyframes send-gift-anim {
    0% {
      opacity: 0;
      transform: translateX(-50rem);
    }
    3% {
      opacity: 1;
      transform: translateX(0);
    }
    97% {
      opacity: 1;
      transform: translateX(0);
    }
    100% {
      opacity: 0;
      transform: translateY(-30rem);
    }
  }

  .left {
    background: linear-gradient(to right, #fe2c55, rgba(254, 44, 85, 0.4));
    padding: 4rem 15rem 4rem 4rem;
    border-radius: 50rem;
    display: flex;
    align-items: center;

    .avatar {
      margin-right: 8rem;
      width: 36rem;
      height: 36rem;
      object-fit: cover;
      border-radius: 50%;
      border: 1px solid white;
    }

    .desc {
      .name {
        font-size: 13rem;
        font-weight: bold;
        color: white;
      }
      .sendto {
        font-size: 11rem;
        color: #fff;
        opacity: 0.9;
      }
    }

    .gift-wrapper {
      margin-left: 10rem;
      .gift-icon {
        width: 45rem;
        height: 45rem;
      }
    }
  }

  .right-count {
    margin-left: 8rem;
    font-size: 28rem;
    color: #ffda00;
    font-weight: 900;
    font-style: italic;
    text-shadow: 2px 2px 0 #000;

    &.jump {
      animation: count-jump 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
  }

  @keyframes count-jump {
    0% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.4);
    }
    100% {
      transform: scale(1);
    }
  }
}

.large-gift-effect {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 800; /* 降低层级，确保不遮挡红包 and 输入框 */
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  animation-name: gift-bg-fade;
  animation-fill-mode: forwards;
  /* animation-duration 由 JS 动态控制 */

  .effect-content {
    text-align: center;
    animation-name: gift-content-zoom;
    animation-timing-function: cubic-bezier(0.175, 0.885, 0.32, 1.275);
    animation-fill-mode: forwards;
    /* animation-duration 由 JS 动态控制 */

    .glow {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 500rem;
      height: 500rem;
      background: radial-gradient(circle, rgba(254, 44, 85, 0.6) 0%, transparent 70%);
      animation: glow-rotate 3s linear infinite;
    }

    .large-gift-svg {
      width: 280rem; /* 放大 放大 */
      height: 280rem;
      object-fit: contain;
      margin-bottom: 20rem;
      position: relative;
      z-index: 1;
      filter: drop-shadow(0 0 20rem rgba(250, 206, 21, 0.8));
    }

    .large-gift-svg {
      width: 200rem; /* 缩小一倍，回到适中尺寸 */
      height: 200rem;
      object-fit: contain;
      position: relative;
      z-index: 1;
      filter: drop-shadow(0 0 20rem rgba(250, 206, 21, 0.8));
      animation: pulse-zoom 2s infinite ease-in-out;
    }

    @keyframes pulse-zoom {
      0% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.1);
      }
      100% {
        transform: scale(1);
      }
    }

    .large-gift-icon {
      width: 120rem;
      height: 120rem;
      object-fit: contain;
      margin-bottom: 20rem;
      position: relative;
      z-index: 1;
      filter: drop-shadow(0 0 15rem rgba(255, 255, 255, 0.5));
    }

    .gift-title-img {
      height: 80rem;
      object-fit: contain;
      margin-bottom: 15rem;
      filter: drop-shadow(0 0 15rem rgba(250, 206, 21, 0.6));
      position: relative;
      z-index: 1;
    }

    .gift-title {
      font-size: 40rem;
      font-weight: 900;
      color: #face15;
      text-shadow: 0 0 20rem rgba(250, 206, 21, 0.8);
      margin-bottom: 10rem;
    }

    .user-name {
      font-size: 20rem;
      color: white;
      font-weight: bold;
    }
  }
}

@keyframes gift-bg-fade {
  0% {
    background: transparent;
  }
  3% {
    background: rgba(0, 0, 0, 0.4);
  }
  97% {
    background: rgba(0, 0, 0, 0.4);
  }
  100% {
    background: transparent;
  }
}

@keyframes gift-content-zoom {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  3% {
    transform: scale(1);
    opacity: 1;
  }
  97% {
    transform: scale(1);
    opacity: 1;
  }
  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}

@keyframes glow-rotate {
  from {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

.user-joined {
  font-size: 12rem;
  position: absolute;
  top: 55vh; /* 继续调高，避开礼物区域 */
  left: 15rem;
  padding: 4rem 12rem;
  border-radius: 20rem;
  background: linear-gradient(to right, rgba(115, 114, 181, 0.9), transparent);
  color: #a2e9ff;
  z-index: 100; /* 确保在最上层 */
  pointer-events: none;
  display: flex;
  align-items: center;
  animation: user-joined-anim 3s ease-in-out forwards;

  @keyframes user-joined-anim {
    0% {
      opacity: 0;
      transform: translateX(-50rem);
    }
    10% {
      opacity: 1;
      transform: translateX(0);
    }
    90% {
      opacity: 1;
      transform: translateX(0);
    }
    100% {
      opacity: 0;
      transform: translateX(-20rem);
    }
  }

  .rank-badge {
    display: flex;
    align-items: center;
    background: rgba(0, 0, 0, 0.2);
    padding: 1rem 6rem;
    border-radius: 8rem;
    margin-right: 6rem;
    img {
      width: 12rem;
      height: 12rem;
      margin-right: 2rem;
    }
    span {
      font-size: 10rem;
      font-weight: bold;
      color: #ffd700;
    }
  }

  .name {
    font-weight: bold;
    margin-right: 5rem;
  }
}
</style>

<style scoped lang="less">
@import '../../assets/less/index';

.LivePage {
  width: 100%;
  height: calc(var(--vh, 1vh) * 100); /* 🎯 适配全平台：使用 JS 计算的动态高度 */
  background: #000;
  color: white;
  position: fixed; /* 改为 fixed，防止键盘弹出时顶部被推走 */
  top: 0;
  left: 0;
  overflow: hidden;

  /* 🎯 横屏模式支持 - 优化 WebView2 兼容性 */
  &.landscape-mode {
    position: fixed !important;
    top: 50% !important;
    left: 50% !important;
    width: calc(var(--vh, 1vh) * 100) !important;
    height: 100dvw !important;
    transform: translate(-50%, -50%) rotate(90deg);
    z-index: 9999;
    background: #000;
    overflow: hidden;

    .live-wrapper {
      width: calc(var(--vh, 1vh) * 100) !important;
      height: 100dvw !important;
    }

    /* 确保播放器和特效容器在横屏下强制铺满 */
    :deep(.dp-player),
    :deep(.vap-container),
    :deep(.large-gift-effect) {
      width: calc(var(--vh, 1vh) * 100) !important;
      height: 100dvw !important;
    }

    /* 横屏下隐藏一些不需要的 UI 或调整位置 */
    .float {
      .top {
        padding-top: 10rem;
      }
      .bottom {
        padding-bottom: 15rem;
      }
    }

    /* 礼物横幅位置调整 */
    :deep(.send-gift) {
      left: 30rem;
    }
  }

  .live-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    background: #000;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;

    .offline-placeholder {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 100;
      display: flex;
      justify-content: center;
      align-items: center;

      .offline-content {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;

        .blur-bg {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          filter: blur(20px) brightness(0.4);
          transform: scale(1.1);
        }

        .tip-box {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 20rem;

          .off-icon {
            font-size: 64rem;
            color: rgba(255, 255, 255, 0.6);
            margin-bottom: 20rem;
          }

          .tip-text {
            color: white;
            font-size: 20rem;
            font-weight: bold;
            margin-bottom: 10rem;
          }

          .sub-text {
            color: rgba(255, 255, 255, 0.5);
            font-size: 14rem;
            margin-bottom: 30rem;
          }

          .back-btn {
            background: #fe2c55;
            color: white;
            padding: 10rem 40rem;
            border-radius: 25rem;
            font-size: 16rem;
            font-weight: bold;
            box-shadow: 0 4px 15px rgba(254, 44, 85, 0.3);
            cursor: pointer;
            pointer-events: auto;

            &:active {
              transform: scale(0.95);
            }
          }
        }
      }
    }
  }

  .loading-placeholder {
    font-size: 16rem;
    color: #666;
  }

  .float {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    /* 🎯 再次降低基础值至 15rem，适配 TG MiniApp (解决偏高问题) */
    padding: calc(10rem + env(safe-area-inset-top)) 15rem calc(15rem + env(safe-area-inset-bottom));
    box-sizing: border-box;

    /* 🎯 针对安卓 Chrome 浏览器大幅补偿 (解决被完全遮挡问题) */
    :global(html.is-chrome.is-android) & {
      padding-bottom: calc(65rem + env(safe-area-inset-bottom));
    }

    .top {
      display: flex;
      justify-content: space-between;
      pointer-events: auto;

      .liver {
        background: rgba(0, 0, 0, 0.4);
        padding: 3rem 4rem;
        border-radius: 30rem;
        display: flex;
        align-items: center;
        gap: 6rem;
        max-width: 180rem; /* 限制最大宽度 */

        &.external-label {
          padding: 6rem 15rem;
          min-width: 100rem;
          background: linear-gradient(to right, #fe2c55, #ff2c55);

          .name {
            font-size: 13rem;
            letter-spacing: 1px;
          }
          .count {
            opacity: 0.9;
          }
        }

        .avatar {
          width: 32rem;
          height: 32rem;
          border-radius: 50%;
          border: 1px solid rgba(255, 255, 255, 0.2);
          flex-shrink: 0;
        }

        .desc-wrapper {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;

          .name {
            font-size: 12rem;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.2;
          }
          .count {
            font-size: 9rem;
            opacity: 0.8;
            line-height: 1.2;
            white-space: nowrap;
          }
        }

        .follow-btn {
          background: var(--primary-btn-color);
          color: white;
          padding: 4rem 10rem;
          margin-right: 2rem;
          border-radius: 18rem;
          font-size: 12rem;
          font-weight: 600;
          flex-shrink: 0;
          transition: all 0.2s;

          &.isFollowed {
            background: rgba(255, 255, 255, 0.15);
            color: rgba(255, 255, 255, 0.6);
            font-weight: normal;
          }
        }
      }

      .right .follower {
        display: flex;
        align-items: center;
        gap: 8rem;
        flex-shrink: 0; /* 强制右侧区域不被压缩 */

        .viewer-avatars {
          display: flex;
          align-items: center;
          margin-right: 4rem;

          .v-avatar {
            width: 24rem;
            height: 24rem;
            border-radius: 50%;
            border: 1px solid rgba(255, 255, 255, 0.4);
            margin-left: -8rem; /* 头像重叠效果 */
            flex-shrink: 0; /* 强制头像保持大小 */
            object-fit: cover;
            background: #333;
            &:first-child {
              margin-left: 0;
            }
          }
        }

        .count {
          background: rgba(0, 0, 0, 0.4);
          padding: 4rem 10rem;
          border-radius: 20rem;
          font-size: 12rem;
          font-weight: 600;
          min-width: 20rem;
          text-align: center;
          flex-shrink: 0;
        }
        .close {
          width: 24rem;
          height: 24rem;
          opacity: 0.8;
          flex-shrink: 0;
        }
      }
    }

    .bottom {
      margin-top: auto;
      pointer-events: auto;

      .comments {
        max-height: 30vh;
        overflow-y: auto;
        padding-bottom: 10rem;
        mask-image: linear-gradient(to bottom, transparent, black 20%);

        .comment {
          background: rgba(0, 0, 0, 0.3);
          padding: 4rem 10rem;
          border-radius: 10rem;
          margin-bottom: 6rem;
          font-size: 13rem;
          display: table; /* 改为 table，确保每条消息占一行且宽度自适应内容 */
          max-width: 90%;
          word-break: break-all;

          .name {
            color: #ffda00;
            margin-right: 6rem;
            cursor: pointer;

            &:active {
              opacity: 0.7;
            }
          }

          &.system {
            background: rgba(255, 255, 255, 0.1);
            .system-text {
              color: #a2e9ff;
              font-style: italic;
            }
          }

          &.notice {
            background: rgba(255, 218, 0, 0.1);
            color: #ffda00;
            font-size: 12rem;
          }

          &.gift {
            background: rgba(254, 44, 85, 0.15); // 透明红背景
            border: 1px solid rgba(254, 44, 85, 0.2);
            .name {
              color: #a2e9ff;
            }
            .gift-text {
              color: #fe2c55;
              font-weight: bold;
              margin-left: 5rem;
            }
            .combo-num {
              color: #face15;
              font-size: 16rem;
              font-weight: 900;
              font-style: italic;
              margin-left: 8rem;
              text-shadow: 0 0 5rem rgba(250, 206, 21, 0.5);
              animation: combo-pop 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
          }

          &.pc28 {
            background: linear-gradient(
              90deg,
              rgba(33, 150, 243, 0.3) 0%,
              rgba(33, 150, 243, 0.1) 100%
            );
            border-left: 3px solid #2196f3;

            .pc28-text {
              color: #64b5f6;
              font-weight: 500;
            }
          }
        }
      }

      .options {
        display: flex;
        align-items: center;
        justify-content: space-between; /* 🎯 均匀分布所有按钮 */
        margin-top: 10rem;
        background: rgba(0, 0, 0, 0.5);
        padding: 8rem 12rem;
        border-radius: 20rem;
        backdrop-filter: blur(10px);

        .input {
          width: 36rem;
          height: 36rem;
          background: rgba(0, 0, 0, 0.6);
          border-radius: 50%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-size: 10rem;
          line-height: 1.1;
          color: rgba(255, 255, 255, 0.8);
          flex-shrink: 0;
        }

        .option-item {
          width: 36rem;
          height: 36rem;
          background: rgba(0, 0, 0, 0.6);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20rem;
          color: white;
          flex-shrink: 0;

          &:active {
            opacity: 0.7;
          }
        }

        .gift {
          width: 36rem;
          height: 36rem;
          background: rgba(0, 0, 0, 0.6);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
      }

      // 🎯 安卓全面屏：底部占位元素，避免被三大金刚按钮遮挡
      .android-bottom-spacer {
        display: none;
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        width: 100%;
        z-index: -1; // 放在工具栏后面
      }
    }
  }

  .input-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.2);
    z-index: 1000;
    display: flex;
    align-items: flex-end;
    pointer-events: auto;

    .input-container {
      width: 100%;
      background: #1e1e1e;
      padding: 10rem 15rem;
      display: flex;
      align-items: center;
      gap: 12rem;
      border-radius: 12rem 12rem 0 0;
      /* 关键：使用 transform 辅助定位，减少对视口高度的依赖 */
      transform: translateY(0);
      padding-bottom: calc(10rem + env(safe-area-inset-bottom));
      /* Windows上确保可以点击 */
      pointer-events: auto;
      position: relative;
      z-index: 1001;

      input {
        flex: 1;
        background: #333;
        border: none;
        height: 36rem;
        padding: 0 15rem;
        border-radius: 18rem;
        color: white;
        font-size: 14rem;
        outline: none;
        /* Windows上确保可以聚焦 */
        pointer-events: auto;

        &::placeholder {
          color: #999;
        }
      }

      .send-btn {
        background: #333;
        color: #666;
        padding: 0 18rem;
        height: 32rem;
        border-radius: 16rem;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14rem;
        font-weight: 600;
        transition: all 0.2s;

        &.active {
          background: var(--primary-btn-color);
          color: white;
        }
      }
    }
  }

  // 礼物面板样式
  .gift-panel-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1001;
    background: rgba(0, 0, 0, 0.4);

    .gift-panel {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(22, 24, 35, 0.95);
      backdrop-filter: blur(10px);
      border-top-left-radius: 12rem;
      border-top-right-radius: 12rem;
      padding-bottom: env(safe-area-inset-bottom);

      .panel-header {
        padding: 15rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: white;
        font-size: 14rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);

        .coin-info {
          display: flex;
          align-items: center;
          gap: 5px;
          background: rgba(255, 255, 255, 0.1);
          padding: 4rem 10rem;
          border-radius: 15rem;

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
            margin-left: 5px;
            font-weight: bold;
          }
        }
      }

      .gift-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        padding: 10rem;
        gap: 10rem;
        max-height: 260rem;
        overflow-y: auto;

        .gift-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 10rem 5rem;
          border-radius: 8rem;
          transition: all 0.2s;
          border: 1px solid transparent;

          &.selected {
            background: rgba(254, 44, 85, 0.1);
            border-color: rgba(254, 44, 85, 0.5);
          }

          img {
            width: 45rem;
            height: 45rem;
            object-fit: contain;
            margin-bottom: 5px;
          }

          .name {
            color: white;
            font-size: 12rem;
            margin-bottom: 2px;
          }

          .cost {
            color: rgba(255, 255, 255, 0.5);
            font-size: 10rem;
          }
        }
      }

      .panel-footer {
        padding: 10rem 15rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10rem;

        .qty-selector {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 6rem;
          overflow-x: auto;
          padding-bottom: 5rem;

          &::-webkit-scrollbar {
            display: none;
          }

          .qty-item {
            background: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.8);
            padding: 4rem 10rem;
            border-radius: 12rem;
            font-size: 12rem;
            white-space: nowrap;
            border: 1px solid transparent;

            &.active {
              background: rgba(254, 44, 85, 0.2);
              color: #fe2c55;
              border-color: #fe2c55;
            }
          }

          .qty-input {
            width: 50rem;
            height: 24rem;
            background: rgba(255, 255, 255, 0.1);
            border: none;
            border-radius: 12rem;
            color: white;
            padding: 0 8rem;
            font-size: 12rem;
            outline: none;

            &::placeholder {
              color: rgba(255, 255, 255, 0.3);
            }
          }
        }

        .send-btn {
          background: var(--primary-btn-color);
          color: white;
          padding: 8rem 25rem;
          border-radius: 20rem;
          font-size: 14rem;
          font-weight: bold;
          flex-shrink: 0;

          &.disabled {
            opacity: 0.5;
            background: #666;
          }
        }
      }
    }
  }

  .send-packet-panel {
    .packet-form {
      padding: 20rem;
      color: white;

      .form-item {
        margin-bottom: 15rem;
        display: flex;
        flex-direction: column;
        gap: 8rem;

        label {
          font-size: 13rem;
          color: rgba(255, 255, 255, 0.6);
        }

        input,
        select {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 10rem;
          border-radius: 8rem;
          color: white;
          font-size: 14rem;
          outline: none;
        }

        .cond-checks {
          display: flex;
          gap: 20rem;
          font-size: 14rem;

          label {
            color: white;
            display: flex;
            align-items: center;
            gap: 5rem;

            input[type='radio'],
            input[type='checkbox'] {
              width: 16rem;
              height: 16rem;
              accent-color: #fe2c55;
            }
          }
        }

        .keyword-input {
          margin-top: 5rem;
        }
      }
    }
  }

  .share-drawer {
    background: rgba(22, 24, 35, 0.98);
    backdrop-filter: blur(20px);
    padding: 20rem 20rem calc(20rem + env(safe-area-inset-bottom));

    .share-grid {
      display: flex;
      justify-content: center;
      gap: 40rem;
      padding: 20rem 0;

      .share-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10rem;

        .icon-wrap {
          width: 56rem;
          height: 56rem;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 14rem;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28rem;

          &.tg {
            background: rgba(36, 161, 222, 0.2);
            color: #24a1de;
          }
          &.link {
            background: rgba(255, 255, 255, 0.1);
            color: white;
          }
        }

        span {
          font-size: 13rem;
          color: rgba(255, 255, 255, 0.7);
        }

        &:active {
          opacity: 0.7;
        }
      }
    }
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
          }
        }
      }
    }

    .loading-box {
      height: 300rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }

  /* 适配 Transition 动画 */
  .fade-enter-active,
  .fade-leave-active {
    transition:
      opacity 0.2s,
      transform 0.2s;
  }
  .fade-enter-from,
  .fade-leave-to {
    opacity: 0;
    .input-container {
      transform: translateY(100%);
    }
  }

  .slide-up-enter-active,
  .slide-up-leave-active {
    transition: all 0.3s ease;
  }
  .slide-up-enter-from,
  .slide-up-leave-to {
    opacity: 0;
    .gift-panel {
      transform: translateY(100%);
    }
  }
}

@keyframes pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes combo-pop {
  0% {
    transform: scale(0.5);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

// 🎯 还原按钮样式
.restore-btn {
  position: fixed;
  bottom: calc(100rem + env(safe-area-inset-bottom));
  right: 20rem;
  z-index: 10002;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 50%;
  width: 48rem;
  height: 48rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: all 0.2s ease;

  &:active {
    transform: scale(0.95);
  }

  .restore-icon {
    font-size: 28rem;
    color: white;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

// 🎯 PC28游戏菜单弹窗样式
.game-menu-overlay {
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

.game-menu {
  width: 100%;
  max-width: 300rem;
  background: #1a1a1a;
  border-radius: 20rem;
  overflow: hidden;
}

.menu-header {
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

.menu-content {
  padding: 20rem;
}

.game-item {
  display: flex;
  align-items: center;
  gap: 15rem;
  padding: 15rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10rem;
  cursor: pointer;
  transition: all 0.3s;
  margin-bottom: 10rem;

  &:last-child {
    margin-bottom: 0;
  }

  &:active {
    background: rgba(254, 44, 85, 0.2);
  }

  .game-icon {
    font-size: 24rem;
    color: #fe2c55;
  }

  span {
    color: white;
    font-size: 16rem;
    font-weight: bold;
  }
}
</style>
