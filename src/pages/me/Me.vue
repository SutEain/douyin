<template>
  <div class="Me">
    <!-- 🎯 情况 A：已就绪但未登录 (重试页面) -->
    <div v-if="baseStore.isAppReady && !userinfo.uid" class="not-logged-in">
      <div class="content">
        <img src="../../assets/img/icon/avatar/0.png" class="placeholder-avatar" />
        <h2>登录后查看更多精彩</h2>
        <p>您的 Telegram 账号尚未成功同步</p>
        <div class="retry-btn" :class="{ loading: baseStore.loading }" @click="handleRetryLogin">
          <Icon v-if="baseStore.loading" icon="eos-icons:loading" class="icon" />
          <span>{{ baseStore.loading ? '正在重试...' : '点击重试登录' }}</span>
        </div>
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
                v-for="day in 7"
                :key="day"
                class="day-item"
                :class="{ 
                  active: day <= currentCycleDay, 
                  today: !isCheckedInToday && day === (currentCycleDay + 1)
                }"
              >
                <div class="coin">
                  <Icon v-if="day <= currentCycleDay" icon="mdi:check-circle" />
                  <span v-else>+{{ day === 7 ? 10 : 3 + day }}</span>
                </div>
                <div class="label">{{ day }}天</div>
              </div>
            </div>
            <div class="streak-text" v-if="userinfo.checkin_streak > 0">
              已连续签到 <span>{{ userinfo.checkin_streak }}</span> 天
            </div>
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
import { reactive, computed, onMounted, watch } from 'vue'
import { Icon } from '@iconify/vue'
import Posters from '@/components/Posters.vue'
import Indicator from '@/components/slide/Indicator.vue'
import SlideRowList from '@/components/slide/SlideRowList.vue'
import SlideItem from '@/components/slide/SlideItem.vue'
import BaseFooter from '@/components/BaseFooter.vue'
import Loading from '@/components/Loading.vue'
import NoMore from '@/components/NoMore.vue'
import { _checkImgUrl, _formatNumber, _no, _copy } from '@/utils'
import { likeVideo, myVideo, collectedVideo } from '@/api/videos'
import { checkIn } from '@/api/user'
import { useBaseStore } from '@/store/pinia'
import { useNav } from '@/utils/hooks/useNav'

defineOptions({
  name: 'Me'
})

const $nav = useNav()
const baseStore = useBaseStore()

// ========== Refs ==========

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
  }
})

// ========== Computed ==========
const userinfo = computed(() => baseStore.userinfo || ({} as any))

const isCheckedInToday = computed(() => {
  if (!userinfo.value.last_checkin_at) return false
  const lastCheckin = new Date(userinfo.value.last_checkin_at)
  const now = new Date()

  // 转换为北京时间日期字符串对比 (YYYY-MM-DD)
  const toBeijingDate = (date: Date) => {
    const bj = new Date(date.getTime() + 8 * 3600 * 1000)
    return bj.getUTCFullYear() + '-' + (bj.getUTCMonth() + 1) + '-' + bj.getUTCDate()
  }

  return toBeijingDate(lastCheckin) === toBeijingDate(now)
})

// 计算当前 7 天周期内点亮到第几天
const currentCycleDay = computed(() => {
  const streak = userinfo.value.checkin_streak || 0
  if (isCheckedInToday.value) {
    return streak % 7 || 7
  }
  return streak % 7
})

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

// 🎯 点击重试登录
async function handleRetryLogin() {
  if (baseStore.loading) return
  baseStore.loading = true
  try {
    await baseStore.init()
    if (userinfo.value.uid) {
      loadMyVideos() // 登录成功后立即加载数据
    }
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
  if (baseStore.loading || isCheckedInToday.value) return
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
onMounted(() => {
  console.log('[Me] mounted')
  loadMyVideos()
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
    padding-bottom: var(--footer-height);

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
