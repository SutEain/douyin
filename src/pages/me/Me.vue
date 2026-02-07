<template>
  <div class="Me">
    <!-- 🎯 情况 A：已就绪但未登录 (登录页面) -->
    <div v-if="baseStore.isAppReady && !userinfo.uid" class="not-logged-in">
      <div class="content">
        <img src="../../assets/img/icon/avatar/0.png" class="placeholder-avatar" />
        <h2>登录后查看更多精彩</h2>
        <p v-if="isBrowserEnv">使用 Telegram 账号登录</p>
        <p v-else>您的 Telegram 账号尚未成功同步</p>

        <!-- 🎯 浏览器环境：显示验证码登录 -->
        <div v-if="isBrowserEnv" class="verification-login">
          <a :href="telegramLoginUrl" target="_blank" class="get-code-btn">
            <Icon icon="mdi:telegram" style="font-size: 20px; margin-right: 8px" />
            <span>在 Telegram 中获取验证码</span>
          </a>
          <p class="tip-text">点击上方按钮，在 Telegram 中获取 6 位数验证码</p>

          <div class="code-input-wrapper">
            <input
              v-model="verificationCode"
              type="text"
              maxlength="6"
              placeholder="请输入 6 位数验证码"
              class="code-input"
              @input="handleCodeInput"
            />
            <button
              class="submit-btn"
              :class="{ loading: baseStore.loading, disabled: !isCodeValid }"
              @click="handleVerifyCode"
              :disabled="!isCodeValid || baseStore.loading"
            >
              <Icon v-if="baseStore.loading" icon="eos-icons:loading" class="icon" />
              <span>{{ baseStore.loading ? '验证中...' : '登录' }}</span>
            </button>
          </div>
        </div>

        <!-- 🎯 Telegram WebApp 环境：显示重试按钮 -->
        <div
          v-else
          class="retry-btn"
          :class="{ loading: baseStore.loading }"
          @click="handleRetryLogin"
        >
          <Icon v-if="baseStore.loading" icon="eos-icons:loading" class="icon" />
          <span>{{ baseStore.loading ? '正在重试...' : '点击重试登录' }}</span>
        </div>

        <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>
      </div>
      <!-- 未登录也要有底部导航，方便切回首页 -->
      <BaseFooter :init-tab="5" />
    </div>

    <!-- 🎯 情况 B：正常显示 (或正在初始化) -->
    <div v-else class="scroll-container" @scroll.passive="handleScroll">
      <!-- 用户信息区域 -->
      <div class="user-info">
        <header :style="headerBackgroundStyle" @click="handleHeaderClick">
          <!-- 顶部按钮栏 - 贴在背景图上，随页面滚动 -->
          <div class="header-actions">
            <div class="left" @click.stop="$nav('/me/edit-userinfo')">
              <Icon icon="ri:edit-fill" />
              <span>编辑资料</span>
            </div>
            <div class="right">
              <div class="item" @click.stop="handleRefresh" :class="{ loading: baseStore.loading }">
                <Icon icon="mdi:refresh" />
              </div>
              <div class="item" @click.stop="$nav('/me/right-menu/look-history')">
                <Icon icon="mdi:history" />
              </div>
              <div class="item" @click.stop="$nav('/message/visitors')">
                <Icon icon="eva:people-outline" />
              </div>
              <!-- ✅ 隐藏搜索按钮
              <div class="item" @click.stop="_no">
                <Icon icon="ic:round-search" />
              </div>
              -->
              <!-- 🎯 隐藏设置按钮，设置功能移至BOT
              <div class="item" @click.stop="$nav('/me/right-menu/setting')">
                <Icon icon="ri:settings-line" />
              </div>
              -->
            </div>
          </div>
          <div class="info">
            <img
              :src="_checkImgUrl(userinfo.avatar_168x168?.url_list?.[0])"
              class="avatar"
              referrerpolicy="no-referrer"
              @error="(e) => _handleImageError(e)"
              @click.stop="state.previewImg = _checkImgUrl(userinfo.avatar_300x300?.url_list?.[0])"
            />
            <div class="right">
              <p class="name">{{ userinfo.nickname }}</p>
              <!-- 🎯 TG用户名第1排 -->
              <div
                class="number"
                style="margin-bottom: 5px; display: flex; align-items: center; gap: 5px"
                v-if="userinfo.unique_id && userinfo.show_tg_username === true"
              >
                <span>TG用户名：@{{ userinfo.unique_id }}</span>
                <Icon
                  icon="mdi:content-copy"
                  style="font-size: 14px; cursor: pointer; opacity: 0.7"
                  @click.stop="copyTgUsername"
                />
                <span style="margin-left: 5px" v-if="userinfo.is_private">私密账号</span>
              </div>
              <!-- 🎯 数字ID第2排 -->
              <div class="number" style="display: flex; align-items: center; gap: 5px">
                <span>ID: {{ userinfo.numeric_id || '加载中...' }}</span>
                <Icon
                  v-if="userinfo.numeric_id"
                  icon="mdi:content-copy"
                  style="font-size: 14px; cursor: pointer; opacity: 0.7"
                  @click.stop="copyNumericId"
                />
              </div>
            </div>
          </div>
        </header>

        <!-- 详细信息 -->
        <div class="detail">
          <!-- ✅ 第1个：个性签名 -->
          <div class="signature" @click.stop="$nav('/me/edit-userinfo-item', { type: 3 })">
            <template v-if="!userinfo.signature">
              <span>点击添加介绍，让大家认识你...</span>
              <img src="../../assets/img/icon/me/write-gray.png" alt="" />
            </template>
            <div v-else class="text signature-text">{{ userinfo.signature }}</div>
          </div>

          <!-- ✅ 第2个：年龄、地区等信息 -->
          <div class="more">
            <div class="age item" v-if="userinfo.user_age !== -1">
              <img v-if="userinfo.gender == 2" src="../../assets/img/icon/me/woman.png" alt="" />
              <img v-if="userinfo.gender == 1" src="../../assets/img/icon/me/man.png" alt="" />
              <span>{{ userinfo.user_age }}岁</span>
            </div>
            <div class="item" v-if="userinfo.country || userinfo.province || userinfo.city">
              <img src="../../assets/img/icon/me/ditu.png" alt="" />
              <template v-if="userinfo.country">{{ userinfo.country }}</template>
              <template v-if="userinfo.country && (userinfo.province || userinfo.city)">
                ·
              </template>
              <template v-if="userinfo.province">{{ userinfo.province }}</template>
              <template v-if="userinfo.province && userinfo.city"> - </template>
              <template v-if="userinfo.city">{{ userinfo.city }}</template>
            </div>
            <div class="item" v-if="userinfo.school?.name">
              {{ userinfo.school.name }}
            </div>
          </div>

          <!-- ✅ 第3个：获赞/关注/粉丝/抖币 -->
          <div class="head">
            <div class="heat">
              <div class="text">
                <span class="num">{{ _formatNumber(userinfo.aweme_count || 0) }}</span>
                <span>获赞</span>
              </div>
              <div class="text" @click="$nav('/people/follow-and-fans', { type: 0 })">
                <span class="num">{{ _formatNumber(userinfo.following_count || 0) }}</span>
                <span>关注</span>
              </div>
              <div class="text" @click="$nav('/people/follow-and-fans', { type: 1 })">
                <span class="num">{{ _formatNumber(userinfo.follower_count || 0) }}</span>
                <span>粉丝</span>
              </div>
              <div class="text">
                <span class="num" style="color: #face15">{{
                  _formatNumber(userinfo.balance_coins || 0)
                }}</span>
                <span>抖币</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 🎯 签到日历区域 -->
        <div class="checkin-section">
          <div class="checkin-card" @click="handleCheckInClick">
            <div class="title-row">
              <div class="left">
                <Icon icon="lucide:calendar-check" class="icon" />
                <span class="text">每日签到</span>
              </div>
              <div class="right">
                <span v-if="isCheckedInToday" class="status checked">今日已签到</span>
                <span v-else class="status">点击签到领抖币</span>
                <Icon icon="mdi:chevron-right" />
              </div>
            </div>
            <div class="days-row">
              <div
                v-for="(day, index) in displayDays"
                :key="index"
                class="day-item"
                :class="{
                  active: day <= currentDisplayDay,
                  today: !isCheckedInToday && day === currentDisplayDay + 1
                }"
              >
                <div class="coin">
                  <Icon v-if="day <= currentDisplayDay" icon="mdi:check-circle" />
                  <span v-else>+{{ getDayReward(day) }}</span>
                </div>
                <div class="label">{{ day }}天</div>
              </div>
            </div>
            <div class="streak-text" v-if="userinfo.checkin_streak > 0">
              已连续签到 <span>{{ userinfo.checkin_streak }}</span> 天
            </div>
          </div>

          <!-- 🎯 观看时长奖励卡片 -->
          <div class="watch-time-card">
            <div class="title-row">
              <div class="left">
                <Icon icon="mdi:play-circle" class="icon" />
                <span class="text">观看时长奖励</span>
              </div>
            </div>
            <div class="progress-section">
              <!-- 🎯 观看时间信息放在进度条上面 -->
              <div class="time-text">
                <template v-if="(state.watchTimeStatus?.total_seconds || 0) >= 1800">
                  <span class="highlight">已完成任务</span>
                </template>
                <template v-else>
                  今日观看：<span class="highlight">{{
                    state.watchTimeStatus?.total_minutes || 0
                  }}</span>
                  分钟
                </template>
              </div>

              <!-- 🎯 进度条和里程碑 -->
              <div class="progress-bar-wrapper">
                <div class="progress-bar">
                  <div
                    class="progress-fill"
                    :style="{
                      width: `${Math.min(((state.watchTimeStatus?.total_seconds || 0) / 1800) * 100, 100)}%`
                    }"
                  ></div>
                </div>
                <div class="milestones">
                  <div
                    class="milestone"
                    :class="{ reached: (state.watchTimeStatus?.total_seconds || 0) >= 300 }"
                    style="left: 16.67%"
                  >
                    <div class="milestone-dot"></div>
                    <div class="milestone-label">5分钟<br />+5抖币</div>
                  </div>
                  <div
                    class="milestone"
                    :class="{ reached: (state.watchTimeStatus?.total_seconds || 0) >= 900 }"
                    style="left: 50%"
                  >
                    <div class="milestone-dot"></div>
                    <div class="milestone-label">15分钟<br />+10抖币</div>
                  </div>
                  <div
                    class="milestone milestone-last"
                    :class="{ reached: (state.watchTimeStatus?.total_seconds || 0) >= 1800 }"
                    style="left: 100%"
                  >
                    <div class="milestone-dot"></div>
                    <div class="milestone-label">30分钟<br />+15抖币</div>
                  </div>
                </div>
              </div>

              <!-- 🎯 奖励信息放在进度条下面 -->
              <div class="reward-info">
                <div class="reward-text" v-if="state.watchTimeStatus?.can_claim">
                  可领取：<span class="reward-amount"
                    >+{{ state.watchTimeStatus?.available_reward || 0 }}</span
                  >
                  抖币
                </div>
                <div
                  class="reward-text claimed"
                  v-else-if="state.watchTimeStatus?.claimed_reward > 0"
                >
                  今日已领取：<span class="reward-amount"
                    >+{{ state.watchTimeStatus?.claimed_reward }}</span
                  >
                  抖币
                </div>
                <div class="reward-text" v-else>观看满5分钟可领取奖励</div>
              </div>
            </div>
            <button
              class="claim-btn"
              :class="{ disabled: !state.watchTimeStatus?.can_claim }"
              :disabled="!state.watchTimeStatus?.can_claim || baseStore.loading"
              @click.stop="handleClaimWatchTimeReward"
            >
              <Icon icon="mdi:gift" />
              <span>{{
                state.watchTimeStatus?.can_claim
                  ? '立即领取'
                  : state.watchTimeStatus?.claimed_reward > 0
                    ? '今日已领取'
                    : '观看时长不足'
              }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Tab 指示器 -->
      <div class="tab-section">
        <Indicator
          name="videoList"
          tabStyleWidth="25%"
          :tabTexts="['作品', '喜欢', '收藏']"
          v-model:active-index="state.contentIndex"
        />
      </div>

      <!-- Tab 内容区域 -->
      <div class="tab-content-wrapper" :style="{ height: tabContentHeight }">
        <SlideRowList name="videoList" v-model:active-index="state.contentIndex">
          <!-- Tab 0: 作品 -->
          <SlideItem>
            <Posters
              v-if="state.videos.my.list.length > 0"
              :list="state.videos.my.list"
              :showLabels="true"
            />
            <Loading v-if="state.loadings.loading0" :is-full-screen="false" />
            <div v-else-if="state.videos.my.total === 0" class="empty-list">
              <div class="title">暂时没有作品</div>
              <div class="desc">去发布你的第一个作品吧</div>
            </div>
            <no-more v-else-if="state.videos.my.total !== -1" />
          </SlideItem>

          <!-- Tab 1: 喜欢 -->
          <SlideItem>
            <!-- 🎯 根据隐私设置显示提示 -->
            <div class="notice" v-if="userinfo.show_like === false">
              <img src="../../assets/img/icon/me/lock-gray.png" alt="" />
              <span>只有你能看到自己的喜欢列表</span>
            </div>
            <Posters v-if="state.videos.like.list.length > 0" :list="state.videos.like.list" />
            <Loading v-if="state.loadings.loading1" :is-full-screen="false" />
            <div v-else-if="state.videos.like.total === 0" class="empty-list">
              <div class="title">暂时没有喜欢的视频</div>
            </div>
            <no-more v-else-if="state.videos.like.total !== -1" />
          </SlideItem>

          <!-- Tab 2: 收藏 -->
          <SlideItem>
            <!-- 🎯 根据隐私设置显示提示 -->
            <div class="notice" v-if="userinfo.show_collect === false">
              <img src="../../assets/img/icon/me/lock-gray.png" alt="" />
              <span>只有你能看到自己的收藏列表</span>
            </div>
            <div class="collect" v-if="state.videos.collect.video.list.length > 0">
              <!-- 视频收藏 -->
              <div class="video" v-if="state.videos.collect.video.total !== -1">
                <div class="top" @click="$nav('/me/collect/video-collect')">
                  <div class="left">
                    <img src="../../assets/img/icon/me/video-whitegray.png" alt="" />
                    <span>视频</span>
                  </div>
                  <div class="right">
                    <span>全部</span>
                    <Icon icon="mdi:chevron-right" />
                  </div>
                </div>
                <Posters
                  v-if="state.videos.collect.video.total !== -1"
                  :list="state.videos.collect.video.list"
                />
              </div>

              <!-- 音乐收藏 -->
              <div class="music" v-if="state.videos.collect.music.total !== -1">
                <div class="top" @click="$nav('/me/collect/music-collect')">
                  <div class="left">
                    <img src="../../assets/img/icon/me/music-whitegray.png" alt="" />
                    <span>音乐</span>
                  </div>
                  <div class="right">
                    <span>全部</span>
                    <Icon icon="mdi:chevron-right" />
                  </div>
                </div>
                <Posters
                  v-if="state.videos.collect.music.total !== -1"
                  :list="state.videos.collect.music.list"
                />
              </div>
            </div>
            <Loading v-if="state.loadings.loading2" :is-full-screen="false" />
            <no-more v-else />
          </SlideItem>
        </SlideRowList>
      </div>
    </div>

    <!-- 底部导航 -->
    <BaseFooter :init-tab="5" />

    <!-- 图片预览 -->
    <transition name="fade">
      <div v-if="state.previewImg" class="fixed-preview-image" @click="state.previewImg = ''">
        <img :src="state.previewImg" alt="" />
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, watch, ref, onMounted, onBeforeUnmount } from 'vue'
import { Icon } from '@iconify/vue'
import Posters from '@/components/Posters.vue'
import Indicator from '@/components/slide/Indicator.vue'
import SlideRowList from '@/components/slide/SlideRowList.vue'
import SlideItem from '@/components/slide/SlideItem.vue'
import BaseFooter from '@/components/BaseFooter.vue'
import Loading from '@/components/Loading.vue'
import NoMore from '@/components/NoMore.vue'
import { _checkImgUrl, _formatNumber, _no, _copy, _handleImageError } from '@/utils'
import {
  likeVideo,
  myVideo,
  collectedVideo,
  getWatchTimeStatus,
  claimWatchTimeReward
} from '@/api/videos'
import { checkIn } from '@/api/user'
import { useBaseStore } from '@/store/pinia'
import { useNav } from '@/utils/hooks/useNav'
import { supabase } from '@/utils/supabase'
import { isBrowserEnvironment } from '@/utils/env'

defineOptions({
  name: 'Me'
})

const $nav = useNav()
const baseStore = useBaseStore()

// ========== Refs ==========
const errorMessage = ref('')
const verificationCode = ref('')

// 🎯 验证码是否有效（6 位数字）
const isCodeValid = computed(() => {
  return /^\d{6}$/.test(verificationCode.value)
})

// 🎯 Telegram 登录 URL（跳转到 Bot 获取验证码）
const telegramLoginUrl = computed(() => {
  const botUsername = (import.meta.env.VITE_TG_BOT_USERNAME || 'dydy').replace('@', '')
  return `https://t.me/${botUsername}?start=web_login`
})

// 🎯 检测是否在浏览器环境（非 Telegram WebApp）
// 🚨 使用统一的环境检测工具函数，确保在 miniAPP 中绝对不会显示 Web 版登录
const isBrowserEnv = computed(() => {
  return isBrowserEnvironment()
})

// ========== State ==========
const state = reactive({
  previewImg: '',
  contentIndex: 0,

  videos: {
    my: { list: [], total: -1, pageNo: 0, pageSize: 15 },
    like: { list: [], total: -1, pageNo: 0, pageSize: 15 },
    collect: {
      video: { list: [], total: -1, pageNo: 0, pageSize: 15 },
      music: { list: [], total: -1, pageNo: 0, pageSize: 15 }
    }
  },

  loadings: {
    loading0: false,
    loading1: false,
    loading2: false
  },

  // 🎯 观看时长奖励状态
  watchTimeStatus: {
    total_seconds: 0,
    total_minutes: 0,
    claimed_reward: 0,
    available_reward: 0,
    reward_level: 'none',
    can_claim: false
  }
})

// ========== Computed ==========
const userinfo = computed(() => baseStore.userinfo || ({} as any))

const isCheckedInToday = computed(() => {
  if (!userinfo.value.last_checkin_at) return false
  const lastCheckin = new Date(userinfo.value.last_checkin_at)
  const now = new Date()

  // 🎯 修复：统一使用 Intl 接口获取北京时间日期字符串 (YYYY-MM-DD)
  // 避免手动加 8 小时导致的跨时区计算错误
  const toBeijingDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date)
  }

  return toBeijingDate(lastCheckin) === toBeijingDate(now)
})

// 计算显示的7天范围
const displayDays = computed(() => {
  const streak = userinfo.value.checkin_streak || 0

  // 如果连续签到 <= 7天，显示周期内的天数（1-7）
  if (streak <= 7) {
    return [1, 2, 3, 4, 5, 6, 7]
  }

  // 如果连续签到 > 7天，显示总天数（从 streak-6 到 streak）
  // 例如：第8天显示 [2, 3, 4, 5, 6, 7, 8]
  // 例如：第9天显示 [3, 4, 5, 6, 7, 8, 9]
  const startDay = streak - 6
  return Array.from({ length: 7 }, (_, i) => startDay + i)
})

// 计算当前应该点亮到第几天
const currentDisplayDay = computed(() => {
  const streak = userinfo.value.checkin_streak || 0
  // 如果今天已签到，返回当前连续签到天数
  // 如果今天未签到，返回昨天的连续签到天数
  return streak
})

// 获取某天的奖励金额
const getDayReward = (day: number) => {
  const streak = userinfo.value.checkin_streak || 0
  // 如果连续签到 > 7天，每天奖励都是满的（10抖币）
  if (streak > 7) {
    return 10
  }
  // 如果连续签到 <= 7天，按周期内的奖励规则
  return day === 7 ? 10 : day + 3
}

const headerBackgroundStyle = computed(() => {
  const userCoverUrl = userinfo.value.cover_url?.[0]?.url_list?.[0]
  const bgUrl = userCoverUrl ? _checkImgUrl(userCoverUrl) : '/images/profile/default_bg.png'
  return {
    backgroundImage: `url(${bgUrl})`
  }
})

const tabContentHeight = computed(() => {
  // 计算 Tab 内容区域的高度，给足够的空间
  return 'auto'
})

// ========== Methods ==========

// 点击背景图预览
function handleHeaderClick() {
  const userCoverUrl = userinfo.value.cover_url?.[0]?.url_list?.[0]
  if (userCoverUrl) {
    state.previewImg = _checkImgUrl(userCoverUrl)
  } else {
    state.previewImg = '/images/profile/default_bg.png'
  }
}

// 🎯 点击重试登录（增强版：更智能的重试机制）
async function handleRetryLogin() {
  if (baseStore.loading) return

  baseStore.loading = true
  errorMessage.value = ''

  try {
    console.log('[Me] 🔄 开始重试登录流程...')

    // 🎯 步骤1：检查并获取 initData
    const { loginWithTelegram } = await import('@/api/auth')
    const { waitForTelegram } = await import('@/pages/login/TelegramLogin')

    // 1.1 优先从 URL 获取 initData
    const getInitDataFromUrl = (): string | null => {
      try {
        const href = window.location.href || ''
        const url = new URL(href)
        const q = url.searchParams.get('tgWebAppData')
        if (q) return decodeURIComponent(q)

        const hash = window.location.hash || ''
        if (hash.includes('tgWebAppData')) {
          const raw = hash.startsWith('#') ? hash.slice(1) : hash
          const params = new URLSearchParams(raw)
          const v = params.get('tgWebAppData')
          if (v) return decodeURIComponent(v)
        }
      } catch (e) {
        console.warn('[Me] 解析 URL initData 失败:', e)
      }
      return null
    }

    let initData = getInitDataFromUrl()

    // 1.2 如果 URL 中没有，等待 Telegram WebApp 初始化并获取
    if (!initData) {
      console.log('[Me] ⏳ URL 中没有 initData，等待 Telegram WebApp 初始化...')
      const tg = await waitForTelegram()

      if (tg?.initData) {
        initData = tg.initData
        console.log('[Me] ✅ 从 Telegram WebApp 获取到 initData')
      } else {
        // 再等待一段时间，有些情况下 initData 会延迟加载
        console.log('[Me] ⏳ initData 仍未就绪，等待最多 2 秒...')
        for (let i = 0; i < 20; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          const tg2 = window.Telegram?.WebApp
          if (tg2?.initData) {
            initData = tg2.initData
            console.log('[Me] ✅ 延迟获取到 initData（等待了', (i + 1) * 100, 'ms）')
            break
          }
        }
      }
    }

    // 1.3 如果还是没有 initData，给出明确提示
    if (!initData) {
      console.error('[Me] ❌ 无法获取 initData')
      errorMessage.value =
        '无法获取 Telegram 用户信息。请尝试：\n1. 刷新页面\n2. 重新打开应用\n3. 检查网络连接'
      return
    }

    // 🎯 步骤2：尝试登录
    console.log('[Me] 🔐 开始登录...')
    const result = await loginWithTelegram(initData)

    if (!result?.user) {
      console.error('[Me] ❌ 登录返回结果异常:', result)
      errorMessage.value = '登录失败，请重试'
      return
    }

    // 🎯 步骤3：等待 session 写入并验证
    console.log('[Me] ⏳ 等待 session 写入...')
    await new Promise((resolve) => setTimeout(resolve, 200))

    const { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData?.session) {
      console.error('[Me] ❌ Session 写入失败')
      errorMessage.value = '登录成功但 session 写入失败，请刷新页面重试'
      return
    }

    // 🎯 步骤4：重新初始化 store
    console.log('[Me] 🔄 重新初始化 baseStore...')
    await baseStore.init()

    // 🎯 步骤5：验证登录是否成功
    await new Promise((resolve) => setTimeout(resolve, 100))

    if (userinfo.value.uid) {
      console.log('[Me] ✅ 登录成功！')
      loadMyVideos()
      loadWatchTimeStatus()
    } else {
      console.warn('[Me] ⚠️ Session 存在但 userinfo.uid 为空，尝试获取 profile...')
      const { getCurrentProfile } = await import('@/api/auth')
      const profile = await getCurrentProfile()

      if (profile) {
        baseStore.applyProfile(profile)
        loadMyVideos()
        loadWatchTimeStatus()
      } else {
        errorMessage.value = '登录成功但获取用户信息失败，请刷新页面重试'
      }
    }
  } catch (error: any) {
    console.error('[Me] ❌ 重试登录失败:', error)
    errorMessage.value = error?.message || '登录失败，请检查网络连接后重试'
  } finally {
    baseStore.loading = false
  }
}

// 🎯 点击复制数字ID
function copyNumericId() {
  if (userinfo.value.numeric_id) {
    _copy(String(userinfo.value.numeric_id))
  }
}

// 🎯 点击签到
async function handleCheckInClick() {
  if (baseStore.loading) return

  // 如果今天已经签过到了，直接提示剩余时间，不再请求后端
  if (isCheckedInToday.value) {
    const now = new Date()
    // 🎯 修复：使用 Intl 获取准确的北京时间分量
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    })
    const parts = formatter.formatToParts(now)
    const bjHour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0')
    const bjMinute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0')

    const hours = 23 - bjHour
    const minutes = 59 - bjMinute
    _no(`您今天已经签到过了\n距离下次签到还需 ${hours} 小时 ${minutes} 分钟`)
    return
  }

  baseStore.loading = true
  try {
    const res = await checkIn()
    if (res.success) {
      const { reward, streak, next_reward } = res.data
      _no(`✅ 签到成功！获得 ${reward} 抖币\n已连续签到 ${streak} 天，明天可领 ${next_reward} 抖币`)
      // 刷新用户信息以立即点亮
      await baseStore.init()
    } else {
      _no(res.message)
    }
  } catch (e: any) {
    _no(e.message || '签到失败，请稍后重试')
  } finally {
    baseStore.loading = false
  }
}

// 🎯 加载观看时长奖励状态
async function loadWatchTimeStatus() {
  if (!userinfo.value.uid) return
  try {
    const res = await getWatchTimeStatus()
    if (res.success && res.data) {
      Object.assign(state.watchTimeStatus, res.data)
    }
  } catch (e: any) {
    console.warn('[loadWatchTimeStatus] 加载观看时长状态失败:', e)
  }
}

// 🎯 领取观看时长奖励
async function handleClaimWatchTimeReward() {
  if (baseStore.loading || !state.watchTimeStatus?.can_claim) return

  baseStore.loading = true
  try {
    const res = await claimWatchTimeReward()
    if (res.success && res.data) {
      const { reward_amount, reward_level } = res.data
      // 🎯 显示本次奖励
      _no(`✅ 领取成功！获得 ${reward_amount || 0} 抖币`)
      // 刷新用户信息和观看时长状态
      await Promise.all([baseStore.init(), loadWatchTimeStatus()])
    } else {
      _no(res.message || '领取失败，请稍后重试')
    }
  } catch (e: any) {
    _no(e.message || '领取失败，请稍后重试')
  } finally {
    baseStore.loading = false
  }
}

// 🎯 刷新页面数据
async function handleRefresh() {
  if (baseStore.loading) return

  baseStore.loading = true
  try {
    // 刷新用户信息、观看时长状态和视频列表
    await Promise.all([baseStore.init(), loadWatchTimeStatus(), loadMyVideos()])
    _no('刷新成功')
  } catch (e: any) {
    console.error('[handleRefresh] 刷新失败:', e)
    _no('刷新失败，请稍后重试')
  } finally {
    baseStore.loading = false
  }
}

// 🎯 复制TG用户名
function copyTgUsername() {
  if (userinfo.value.unique_id) {
    _copy('@' + userinfo.value.unique_id)
  }
}

// 加载我的作品
async function loadMyVideos() {
  if (state.loadings.loading0) return
  // 🎯 优化：如果未登录，直接跳过加载请求（页面会由 UI 显示重试登录页）
  if (!userinfo.value.uid) return

  if (state.videos.my.total !== -1 && state.videos.my.list.length >= state.videos.my.total) {
    return
  }

  state.loadings.loading0 = true
  const res = await myVideo({
    pageNo: state.videos.my.pageNo,
    pageSize: state.videos.my.pageSize
  })
  state.loadings.loading0 = false

  if (res.success) {
    state.videos.my.total = res.data.total
    state.videos.my.list.push(...res.data.list)
    state.videos.my.pageNo++
  }
}

// 监听滚动，接近底部时加载更多
function handleScroll(e: Event) {
  const target = e.target as HTMLElement | null
  if (!target) return

  const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight
  // 距离底部小于 200px 时尝试加载更多
  if (scrollBottom > 200) return

  if (state.contentIndex === 0) {
    loadMyVideos()
  } else if (state.contentIndex === 1) {
    loadLikedVideos()
  } else if (state.contentIndex === 2) {
    loadCollectedVideos()
  }
}

// 加载喜欢的视频
async function loadLikedVideos() {
  console.log('[Me] 🔍 loadLikedVideos 被调用')
  console.log('[Me] 当前状态:', {
    loading: state.loadings.loading1,
    total: state.videos.like.total,
    listLength: state.videos.like.list.length,
    pageNo: state.videos.like.pageNo
  })

  if (state.loadings.loading1) {
    console.log('[Me] ⏸️ 正在加载中，跳过')
    return
  }
  if (state.videos.like.total !== -1 && state.videos.like.list.length >= state.videos.like.total) {
    console.log('[Me] ⏸️ 已加载全部数据，跳过')
    return
  }

  console.log('[Me] 🚀 开始请求喜欢的视频数据...')
  state.loadings.loading1 = true
  const res = await likeVideo({
    pageNo: state.videos.like.pageNo,
    pageSize: state.videos.like.pageSize
  })
  state.loadings.loading1 = false

  console.log('[Me] 📦 API 响应:', res)

  if (res.success) {
    state.videos.like.total = res.data.total
    state.videos.like.list.push(...res.data.list)
    state.videos.like.pageNo++
    console.log('[Me] ✅ 喜欢的视频加载成功:', {
      total: res.data.total,
      newCount: res.data.list.length,
      currentTotal: state.videos.like.list.length
    })
  } else {
    console.error('[Me] ❌ 喜欢的视频加载失败:', res)
  }
}

// 加载收藏的视频
async function loadCollectedVideos() {
  console.log('[Me] 🔍 loadCollectedVideos 被调用')
  console.log('[Me] 当前状态:', {
    loading: state.loadings.loading2,
    total: state.videos.collect.video.total,
    listLength: state.videos.collect.video.list.length,
    pageNo: state.videos.collect.video.pageNo
  })

  if (state.loadings.loading2) {
    console.log('[Me] ⏸️ 正在加载中，跳过')
    return
  }

  console.log('[Me] 🚀 开始请求收藏的视频数据...')
  state.loadings.loading2 = true
  const res = await collectedVideo({
    pageNo: state.videos.collect.video.pageNo,
    pageSize: state.videos.collect.video.pageSize
  })
  state.loadings.loading2 = false

  console.log('[Me] 📦 API 响应:', res)

  if (res.success) {
    state.videos.collect.video.total = res.data.total
    state.videos.collect.video.list.push(...res.data.list)
    state.videos.collect.video.pageNo++
    console.log('[Me] ✅ 收藏的视频加载成功:', {
      total: res.data.total,
      newCount: res.data.list.length,
      currentTotal: state.videos.collect.video.list.length
    })
  } else {
    console.error('[Me] ❌ 收藏的视频加载失败:', res)
  }
}

// ========== Watch ==========
// 监听 tab 切换，加载对应数据
watch(
  () => state.contentIndex,
  (newIndex) => {
    console.log('[Me] 📌 Tab 切换到:', newIndex, ['作品', '喜欢', '收藏'][newIndex])

    if (newIndex === 0 && state.videos.my.list.length === 0) {
      console.log('[Me] 加载作品数据')
      loadMyVideos()
    } else if (newIndex === 1 && state.videos.like.list.length === 0) {
      console.log('[Me] 加载喜欢数据')
      loadLikedVideos()
    } else if (newIndex === 2 && state.videos.collect.video.list.length === 0) {
      console.log('[Me] 加载收藏数据')
      loadCollectedVideos()
    }
  }
)

// ========== 生命周期 ==========
// 🎯 处理验证码输入（只允许数字）
function handleCodeInput(e: Event) {
  const target = e.target as HTMLInputElement
  const value = target.value.replace(/\D/g, '') // 只保留数字
  verificationCode.value = value.slice(0, 6) // 最多 6 位
  errorMessage.value = '' // 清除错误信息
}

// 🎯 验证并提交验证码
async function handleVerifyCode() {
  if (!isCodeValid.value || baseStore.loading) return

  try {
    baseStore.loading = true
    errorMessage.value = ''

    console.log('[Me] 🔐 开始验证码登录流程...')

    const { loginWithVerificationCode } = await import('@/api/auth')
    const result = await loginWithVerificationCode(verificationCode.value)

    console.log('[Me] ✅ API 调用成功，返回结果:', result)

    // 🎯 等待 session 写入（确保 session 已保存到本地存储）
    console.log('[Me] ⏳ 等待 session 写入...')
    await new Promise((resolve) => setTimeout(resolve, 200))

    const { data } = await supabase.auth.getSession()
    console.log('[Me] 🔍 获取 session 结果:', {
      hasSession: !!data.session,
      userId: data.session?.user?.id
    })

    if (!data.session) {
      console.error('[Me] ❌ session 不存在，登录失败')
      errorMessage.value = '登录失败，请重试'
      return
    }

    // 🎯 重新初始化 store（会从数据库获取完整的 profile）
    console.log('[Me] 🔄 重新初始化 baseStore...')
    await baseStore.init()

    // 🎯 再次等待一下，确保 profile 已加载
    await new Promise((resolve) => setTimeout(resolve, 100))

    console.log('[Me] 📊 baseStore.init() 完成，userinfo:', {
      uid: userinfo.value.uid,
      unique_id: userinfo.value.unique_id,
      nickname: userinfo.value.nickname
    })

    if (userinfo.value.uid) {
      console.log('[Me] 🎉 登录成功！加载用户数据...')
      loadMyVideos() // 登录成功后立即加载数据
      loadWatchTimeStatus() // 🎯 加载观看时长状态
      // 清空验证码
      verificationCode.value = ''
    } else {
      console.warn('[Me] ⚠️ session 存在但 userinfo.uid 为空，可能初始化失败')
      // 🎯 如果初始化失败，尝试再次获取 profile
      const { getCurrentProfile } = await import('@/api/auth')
      const profile = await getCurrentProfile()

      if (profile) {
        console.log('[Me] ✅ 通过 getCurrentProfile 获取到 profile，应用用户信息...')
        baseStore.applyProfile(profile)
        loadMyVideos()
        loadWatchTimeStatus()
        verificationCode.value = ''
      } else {
        console.error('[Me] ❌ 无法获取用户信息，可能是 RLS 策略问题或数据库问题')
        errorMessage.value = '登录成功但获取用户信息失败，请刷新页面重试'
      }
    }
  } catch (error: any) {
    console.error('[Me] ❌ 验证码登录失败:', error)
    errorMessage.value = error?.message || '验证码无效或已过期，请重新获取'
    verificationCode.value = '' // 清空验证码
  } finally {
    baseStore.loading = false
  }
}

// 🎯 监听用户信息变化，自动加载观看时长状态
watch(
  () => userinfo.value.uid,
  (newUid) => {
    if (newUid) {
      loadWatchTimeStatus()
    }
  },
  { immediate: true }
)

// 🎯 页面激活时刷新观看时长状态（每30秒刷新一次）
const watchTimeRefreshTimer = ref<ReturnType<typeof setInterval> | null>(null)
onMounted(() => {
  if (userinfo.value.uid) {
    loadWatchTimeStatus()
    // 每30秒自动刷新一次观看时长状态
    watchTimeRefreshTimer.value = setInterval(() => {
      if (userinfo.value.uid) {
        loadWatchTimeStatus()
      }
    }, 30000)
  }
})

// 清理定时器
watch(
  () => userinfo.value.uid,
  (newUid) => {
    if (!newUid && watchTimeRefreshTimer.value) {
      clearInterval(watchTimeRefreshTimer.value)
      watchTimeRefreshTimer.value = null
    }
  }
)

// 组件卸载时清理定时器
onBeforeUnmount(() => {
  if (watchTimeRefreshTimer.value) {
    clearInterval(watchTimeRefreshTimer.value)
    watchTimeRefreshTimer.value = null
  }
})
</script>

<style scoped lang="less">
.Me {
  height: 100vh;
  width: 100%;
  background: #000; // ✅ 改为纯黑
  position: relative;
  overflow: hidden;

  // 🎯 情况 A：未登录状态页样式 (放在这里，不再嵌套在 scroll-container 里)
  .not-logged-in {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #000;
    color: white;
    z-index: 100;

    .content {
      text-align: center;
      padding: 0 40px;
      margin-bottom: 100px;

      .placeholder-avatar {
        width: 100px;
        height: 100px;
        border-radius: 50%;
        margin-bottom: 20px;
        opacity: 0.5;
        border: 2px solid rgba(255, 255, 255, 0.2);
      }

      h2 {
        font-size: 20px;
        margin-bottom: 10px;
      }

      p {
        font-size: 14px;
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 30px;
      }

      .verification-login {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        margin-bottom: 20px;

        .get-code-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #0088cc;
          color: white;
          padding: 14px 28px;
          border-radius: 8px;
          text-decoration: none;
          font-size: 16px;
          font-weight: bold;
          transition: all 0.3s;
          width: 100%;
          max-width: 300px;

          &:hover {
            opacity: 0.9;
            transform: translateY(-1px);
          }

          &:active {
            opacity: 0.8;
            transform: translateY(0);
          }
        }

        .tip-text {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.6);
          text-align: center;
          margin: 0;
        }

        .code-input-wrapper {
          width: 100%;
          max-width: 300px;
          display: flex;
          flex-direction: column;
          gap: 12px;

          .code-input {
            width: 100%;
            padding: 14px 16px;
            border: 2px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.1);
            color: white;
            font-size: 18px;
            font-weight: bold;
            text-align: center;
            letter-spacing: 4px;
            outline: none;
            transition: all 0.3s;
            box-sizing: border-box;

            &::placeholder {
              color: rgba(255, 255, 255, 0.4);
              letter-spacing: 0;
            }

            &:focus {
              border-color: #0088cc;
              background: rgba(255, 255, 255, 0.15);
            }
          }

          .submit-btn {
            width: 100%;
            padding: 14px;
            border: none;
            border-radius: 8px;
            background: #fe2c55;
            color: white;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            box-sizing: border-box;

            &:hover:not(.disabled) {
              opacity: 0.9;
              transform: translateY(-1px);
            }

            &:active:not(.disabled) {
              opacity: 0.8;
              transform: translateY(0);
            }

            &.disabled {
              opacity: 0.5;
              cursor: not-allowed;
            }

            &.loading {
              opacity: 0.7;
              cursor: not-allowed;
            }

            .icon {
              font-size: 20px;
              animation: rotate 1s linear infinite;
            }
          }
        }
      }

      .error-message {
        color: #ff6b6b;
        font-size: 14px;
        margin-top: 15px;
      }

      .retry-btn {
        background: #fe2c55;
        color: white;
        padding: 0 30px;
        height: 48px;
        line-height: 48px;
        border-radius: 4px;
        font-size: 16px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        cursor: pointer;
        transition: opacity 0.3s;

        &:active {
          opacity: 0.8;
        }

        &.loading {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .icon {
          font-size: 20px;
          animation: rotate 1s linear infinite;
        }
      }
    }
  }

  .scroll-container {
    height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    padding-bottom: calc(var(--footer-height) + env(safe-area-inset-bottom));

    &::-webkit-scrollbar {
      display: none;
    }

    .user-info {
      header {
        position: relative;
        height: 200px;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        background-color: #000; // ✅ 改为纯黑

        // 顶部按钮栏 - 贴在背景图顶部
        .header-actions {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 15px;
          background: transparent;
          z-index: 10;

          .left {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 14px;
            color: white;
            cursor: pointer;
          }

          .right {
            display: flex;
            gap: 15px;

            .item {
              font-size: 20px;
              color: white;
              cursor: pointer;
              transition:
                transform 0.3s,
                opacity 0.3s;

              &:hover {
                opacity: 0.8;
              }

              &:active {
                transform: scale(0.9);
              }

              &.loading {
                animation: rotate 1s linear infinite;
              }
            }
          }
        }

        .info {
          position: absolute;
          bottom: 20px;
          left: 30px; // ✅ 调整左边距，让头像中心和获赞中心对齐
          display: flex;
          align-items: flex-end;
          gap: 15px;

          .avatar {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            border: 3px solid white;
          }

          .right {
            color: white;

            .name {
              font-size: 18px;
              font-weight: bold;
              margin-bottom: 5px;
            }

            .number {
              font-size: 13px;
              display: flex;
              align-items: center;
              gap: 5px;
              color: rgba(255, 255, 255, 0.6); // ✅ TG用户名颜色调灰

              img {
                width: 16px;
                height: 16px;
                cursor: pointer;
              }
            }
          }
        }
      }

      .detail {
        padding: 15px;

        .head {
          .heat {
            display: flex;
            justify-content: space-around;
            padding: 10px 0;

            .text {
              text-align: center;
              cursor: pointer;

              .num {
                display: block;
                font-size: 18px;
                font-weight: bold;
                margin-bottom: 5px;
                color: #fff;
              }

              span:last-child {
                font-size: 14px;
                color: rgba(255, 255, 255, 0.6);
              }
            }
          }
        }

        .signature {
          padding: 0 0 15px 15px; // ✅ 上 右 下 左
          font-size: 14px;
          font-family: 'Microsoft YaHei', '微软雅黑', sans-serif; // ✅ 雅黑字体
          color: rgba(255, 255, 255, 0.8);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 5px;

          img {
            width: 16px;
            height: 16px;
          }

          .text {
            flex: 1;
          }

          // 🎯 保留换行格式
          .signature-text {
            white-space: pre-wrap; // 保留换行和空格
            word-wrap: break-word; // 长单词换行
          }
        }

        .more {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          padding: 0 0 10px 10px; // ✅ 上 右 下 左
          font-size: 13px;
          color: rgba(255, 255, 255, 0.8);
          cursor: pointer;

          .item {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 10px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;

            img {
              width: 16px;
              height: 16px;
            }
          }
        }
      }
    }

    // 🎯 签到区域样式
    .checkin-section {
      padding: 0 15px 15px;
      display: flex;
      flex-direction: column;
      gap: 15px;

      .checkin-card {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 12px;
        padding: 15px;
        border: 1px solid rgba(255, 255, 255, 0.1);

        .title-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;

          .left {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #fff;
            font-weight: bold;

            .icon {
              color: #face15;
              font-size: 18px;
            }
          }

          .right {
            display: flex;
            align-items: center;
            gap: 4px;
            color: rgba(255, 255, 255, 0.5);
            font-size: 13px;

            .status.checked {
              color: #face15;
            }
          }
        }

        .days-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 12px;

          .day-item {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;

            .coin {
              width: 36px;
              height: 36px;
              background: rgba(255, 255, 255, 0.1);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              color: #face15;
              font-size: 12px;
              font-weight: bold;
              transition: all 0.3s;
            }

            .label {
              font-size: 11px;
              color: rgba(255, 255, 255, 0.4);
            }

            &.active {
              .coin {
                background: #face15;
                color: #000;
                box-shadow: 0 0 10px rgba(250, 206, 21, 0.3);
              }
              .label {
                color: #face15;
              }
            }

            &.today:not(.active) {
              .coin {
                border: 1px solid #face15;
                animation: pulse 2s infinite;
              }
            }
          }
        }

        .streak-text {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.4);
          text-align: center;

          span {
            color: #face15;
            font-weight: bold;
          }
        }
      }

      // 🎯 观看时长奖励卡片样式
      .watch-time-card {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 12px;
        padding: 15px;
        border: 1px solid rgba(255, 255, 255, 0.1);

        .title-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;

          .left {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #fff;
            font-weight: bold;

            .icon {
              color: #face15;
              font-size: 18px;
            }
          }
        }

        .progress-section {
          margin-bottom: 15px;
          display: flex;
          flex-direction: column;
          gap: 12px;

          // 🎯 观看时间信息
          .time-text {
            font-size: 14px;
            color: rgba(255, 255, 255, 0.7);
            margin-bottom: 4px;

            .highlight {
              color: #face15;
              font-weight: bold;
              font-size: 16px;
            }
          }

          // 🎯 奖励信息
          .reward-info {
            margin-top: 4px;

            .reward-text {
              font-size: 13px;
              color: rgba(255, 255, 255, 0.5);

              &.claimed {
                color: rgba(255, 255, 255, 0.4);
              }

              .reward-amount {
                color: #face15;
                font-weight: bold;
                font-size: 15px;
              }
            }
          }

          .progress-bar-wrapper {
            position: relative;
            margin-bottom: 50px; // 🎯 给里程碑标签留出空间，避免和按钮重叠

            .progress-bar {
              width: 100%;
              height: 6px;
              background: rgba(255, 255, 255, 0.1);
              border-radius: 3px;
              overflow: hidden;
              margin-bottom: 0; // 🎯 移除 margin-bottom，改用父容器的 margin-bottom

              .progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #face15 0%, #ffd700 100%);
                border-radius: 3px;
                transition: width 0.3s ease;
              }
            }

            .milestones {
              position: absolute;
              top: 10px;
              left: 0;
              right: 0;
              width: 100%;

              .milestone {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
                position: absolute;
                transform: translateX(-50%);

                &.milestone-last {
                  transform: translateX(-100%);
                }

                .milestone-dot {
                  width: 12px;
                  height: 12px;
                  border-radius: 50%;
                  background: rgba(255, 255, 255, 0.2);
                  border: 2px solid rgba(255, 255, 255, 0.3);
                  transition: all 0.3s;
                }

                .milestone-label {
                  font-size: 9px;
                  color: rgba(255, 255, 255, 0.4);
                  text-align: center;
                  line-height: 1.2;
                  white-space: nowrap;
                  word-break: keep-all;
                }

                &.reached {
                  .milestone-dot {
                    background: #face15;
                    border-color: #face15;
                    box-shadow: 0 0 8px rgba(250, 206, 21, 0.5);
                  }

                  .milestone-label {
                    color: #face15;
                  }
                }
              }
            }
          }
        }

        .claim-btn {
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, #face15 0%, #ffd700 100%);
          border: none;
          border-radius: 8px;
          color: #000;
          font-weight: bold;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.3s;

          &:hover:not(.disabled) {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(250, 206, 21, 0.4);
          }

          &:active:not(.disabled) {
            transform: translateY(0);
          }

          &.disabled {
            background: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.4);
            cursor: not-allowed;
          }

          .icon {
            font-size: 16px;
          }
        }
      }
    }

    // Tab 区域
    .tab-section {
      position: sticky;
      top: 0;
      z-index: 50;
      background: #000; // ✅ 改为纯黑
    }

    .tab-content-wrapper {
      // 让内容自然显示
      position: relative;
      min-height: 60vh;
      padding-bottom: 80px;

      // SlideRowList 内容
      :deep(.slide-row-list) {
        width: 100%;
        height: auto;
        min-height: 60vh;
      }

      :deep(#base-slide-wrapper) {
        height: auto;
        min-height: 60vh;
        overflow: hidden; // ✅ 恢复 hidden，防止内容溢出
      }

      :deep(#base-slide-list) {
        height: auto;
        min-height: 60vh;
      }

      // SlideItem 内容样式
      :deep(.slide-item) {
        padding: 0; // ✅ 去掉左右padding
        min-height: 110vh;
        background-color: #000; // ✅ 三个 tab 的背景色
        width: 100%;
        box-sizing: border-box;
      }
    }

    .notice {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 15px 0;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.5);

      img {
        width: 14px;
        height: 14px;
      }
    }

    .collect {
      .video,
      .music {
        margin-bottom: 20px;

        .top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px 0;
          cursor: pointer;

          .left {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 15px;
            font-weight: bold;
            color: #fff;

            img {
              width: 20px;
              height: 20px;
            }
          }

          .right {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 13px;
            color: rgba(255, 255, 255, 0.5);
          }
        }
      }
    }

    .empty-list {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding-top: 50px;
      color: rgba(255, 255, 255, 0.5);
      font-size: 14px;

      .title {
        margin-bottom: 5px;
        font-size: 16px;
        font-weight: bold;
        color: rgba(255, 255, 255, 0.9);
      }
    }
  }

  .fixed-preview-image {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.9);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;

    img {
      max-width: 90%;
      max-height: 90%;
      object-fit: contain;
    }
  }

  .star-count-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 30px 20px;
    background: #000; // ✅ 改为纯黑

    img {
      width: 60px;
      height: 60px;
      margin-bottom: 20px;
    }

    .desc {
      text-align: center;

      p {
        margin-bottom: 10px;
        font-size: 14px;
        color: rgba(255, 255, 255, 0.8);

        span {
          color: #ff2d55;
          font-weight: bold;
        }
      }
    }
  }
}

// Transition 动画
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes pulse {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(250, 206, 21, 0.4);
  }
  70% {
    transform: scale(1.05);
    box-shadow: 0 0 0 10px rgba(250, 206, 21, 0);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(250, 206, 21, 0);
  }
}
</style>
