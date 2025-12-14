<template>
  <div id="UserPanel" @dragstart="(e) => _stopPropagation(e)" ref="page">
    <!-- ✅ 固定顶部栏 - 移到滚动容器外面 -->
    <div ref="float" class="float" :class="state.floatFixed ? 'fixed' : ''">
      <div class="left">
        <Icon @click="emit('back')" class="icon" icon="eva:arrow-ios-back-fill" />
        <transition name="fade">
          <div class="float-user" v-if="state.floatFixed">
            <img
              v-lazy="_checkImgUrl(props.currentItem.author.avatar_168x168.url_list[0])"
              class="avatar"
            />
            <img
              v-if="!props.currentItem.author.follow_status"
              src="@/assets/img/icon/add-light.png"
              alt=""
              class="add"
            />
            <!-- ✅ 吸顶栏：仅在未关注时展示“关注”，已关注时不展示“私信”入口 -->
            <span v-if="!props.currentItem.author.follow_status" @click="followButton">关注</span>
          </div>
        </transition>
      </div>
      <div class="right">
        <transition name="fade">
          <div
            class="request"
            v-if="!state.floatFixed"
            :style="state.loadings.requestUpdate ? 'pointer-events:none;opacity:.6;' : ''"
          >
            <img @click="handleRequestUpdate" src="@/assets/img/icon/me/finger-right.png" alt="" />
            <span @click="handleRequestUpdate">{{
              state.loadings.requestUpdate ? '发送中...' : '求更新'
            }}</span>
          </div>
        </transition>
        <!-- ✅ 隐藏搜索和三个点按钮
        <Icon class="icon" icon="ion:search" @click.stop="_no" />
        <Icon class="icon" icon="ri:more-line" @click.stop="emit('showFollowSetting')" />
        -->
      </div>
    </div>

    <!-- ✅ 内层滚动容器 -->
    <div class="scroll-container" @scroll="scroll" ref="scrollContainer">
      <div class="main" ref="main">
        <!--   src="@/assets/img/header-bg.png"   -->
        <header>
          <!-- ✅ 背景图：优先显示用户设置的背景，否则显示默认背景 -->
          <img
            ref="cover"
            :src="
              props.currentItem?.author?.cover_url?.[0]?.url_list?.[0]
                ? _checkImgUrl(props.currentItem.author.cover_url[0].url_list[0])
                : '/images/profile/default_bg.png'
            "
            @click="
              state.previewImg = props.currentItem?.author?.cover_url?.[0]?.url_list?.[0]
                ? _checkImgUrl(props.currentItem.author.cover_url[0].url_list[0])
                : '/images/profile/default_bg.png'
            "
            alt=""
            class="cover"
          />
          <div class="avatar-wrapper">
            <!-- ✅ 头像：必须显示 -->
            <img
              :src="_checkImgUrl(props.currentItem.author.avatar_168x168.url_list[0])"
              class="avatar"
              @click="
                state.previewImg = _checkImgUrl(props.currentItem.author.avatar_300x300.url_list[0])
              "
            />
            <div class="description">
              <div class="name f22">{{ props.currentItem.author.nickname }}</div>
              <div class="certification" v-if="props.currentItem.author.certification">
                <img src="@/assets/img/icon/me/certification.webp" />
                {{ props.currentItem.author.certification }}
              </div>
              <template v-else>
                <!-- 🎯 TG用户名第1排（根据隐私设置显示） -->
                <div
                  class="number"
                  style="margin-bottom: 5px; display: flex; align-items: center; gap: 5px"
                  v-if="
                    props.currentItem.author.unique_id &&
                    props.currentItem.author.show_tg_username === true
                  "
                >
                  <span>TG用户名：@{{ props.currentItem.author.unique_id }}</span>
                  <Icon
                    icon="mdi:content-copy"
                    style="font-size: 14px; cursor: pointer; opacity: 0.7"
                    @click.stop="copyAuthorTgUsername"
                  />
                </div>
                <!-- 🎯 数字ID第2排 -->
                <div class="number" style="display: flex; align-items: center; gap: 5px">
                  <span>ID: {{ props.currentItem.author.numeric_id || '加载中...' }}</span>
                  <Icon
                    v-if="props.currentItem.author.numeric_id"
                    icon="mdi:content-copy"
                    style="font-size: 14px; cursor: pointer; opacity: 0.7"
                    @click.stop="copyAuthorNumericId"
                  />
                </div>
              </template>
            </div>
          </div>
        </header>
        <div class="info">
          <!-- ✅ 第1个：个性签名 -->
          <div class="signature">
            <div
              class="text"
              v-if="props.currentItem.author.signature"
              v-html="props.currentItem.author.signature"
            ></div>
            <div class="text empty" v-else>这个人很神秘，什么都没留下</div>
          </div>

          <!-- ✅ 第2个：年龄、地区等信息 -->
          <div class="more">
            <div
              class="age item"
              v-if="props.currentItem.author.user_age && props.currentItem.author.user_age !== -1"
            >
              <img
                v-if="props.currentItem.author.gender == 1"
                src="@/assets/img/icon/me/man.png"
                alt=""
              />
              <img
                v-if="props.currentItem.author.gender == 2"
                src="@/assets/img/icon/me/woman.png"
                alt=""
              />
              <span>{{ props.currentItem.author.user_age }}岁</span>
            </div>
            <div class="item" v-if="props.currentItem.author.ip_location">
              <img src="@/assets/img/icon/me/ditu.png" alt="" />
              {{ props.currentItem.author.ip_location }}
            </div>
            <div
              class="item"
              v-if="props.currentItem.author.province || props.currentItem.author.city"
            >
              <img src="@/assets/img/icon/me/ditu.png" alt="" />
              {{ props.currentItem.author.province }}
              <template v-if="props.currentItem.author.province && props.currentItem.author.city">
                ·
              </template>
              {{ props.currentItem.author.city }}
            </div>
            <div class="item" v-if="props.currentItem.author.school?.name">
              {{ props.currentItem.author.school?.name }}
            </div>
          </div>

          <!-- ✅ 第3个：获赞/关注/粉丝 -->
          <div class="heat">
            <div class="text">
              <span class="num">{{ _formatNumber(localAuthorStats.total_favorited) }}</span>
              <span>获赞</span>
            </div>
            <div class="text">
              <span class="num">{{ _formatNumber(localAuthorStats.following_count) }}</span>
              <span>关注</span>
            </div>
            <div class="text">
              <span class="num">{{
                _formatNumber(localAuthorStats.mplatform_followers_count)
              }}</span>
              <span>粉丝</span>
            </div>
          </div>
        </div>

        <!-- ✅ 第4个：关注按钮 -->
        <div v-if="shouldShowFollowButton" class="my-buttons">
          <!-- ✅ 单按钮：未关注(0) / 已关注(1) / 互相关注(2) -->
          <div
            class="follow-button"
            :class="{
              'follow-button-unfollow': props.currentItem.author.follow_status === 0,
              'follow-button-followed': props.currentItem.author.follow_status === 1,
              'follow-button-mutual': props.currentItem.author.follow_status === 2,
              'follow-button-loading': state.loadings.follow
            }"
            @click="handleFollowClick"
          >
            <!-- Loading 状态 -->
            <Loading v-if="state.loadings.follow" :isFullScreen="false" type="small" />

            <!-- 未关注：显示 +关注 -->
            <template v-else-if="props.currentItem.author.follow_status === 0">
              <img src="@/assets/img/icon/add-white.png" alt="" />
              <span>关注</span>
            </template>
            <!-- 已关注：显示 已关注 -->
            <template v-else-if="props.currentItem.author.follow_status === 1">
              <span>已关注</span>
            </template>
            <!-- 互相关注：显示 ♥ 互相关注 -->
            <template v-else-if="props.currentItem.author.follow_status === 2">
              <span>♥ 互相关注</span>
            </template>
          </div>
        </div>

        <!-- ✅ 去掉推荐同类型作者功能
      <div class="my-buttons">
        <div
          class="option"
          :class="state.isShowRecommend ? 'option-recommend' : ''"
          @click="state.isShowRecommend = !state.isShowRecommend"
        >
          <img
            v-if="state.loadings.showRecommend"
            class="loading"
            src="@/assets/img/icon/loading-gray.png"
            alt=""
          />
          <Icon icon="bxs:down-arrow" v-else class="arrow" />
        </div>
      </div>

      <div class="recommend" :class="{ hidden: !state.isShowRecommend }">
        <div class="title">
          <span>你可能感兴趣</span>
          <img src="@/assets/img/icon/about-gray.png" />
        </div>
        <div class="friends" @touchmove="stop">
          <div class="friend" :key="i" v-for="(item, i) in baseStore.friends.all">
            <img
              :style="item.select ? 'opacity: .5;' : ''"
              class="avatar"
              :src="_checkImgUrl(item.avatar)"
              alt=""
            />
            <span class="name">{{ item.name }}</span>
            <span class="tips">可能感兴趣的人</span>
            <dy-button type="primary">关注</dy-button>
            <div class="close">
              <dy-back img="close" scale=".6"></dy-back>
            </div>
          </div>
          <div class="more" @click="$nav('/people/find-acquaintance')">
            <div class="notice">
              <div>点击查看</div>
              <div>更多好友</div>
            </div>
          </div>
        </div>
      </div>
      -->

        <!-- 🎯 Tab 指示器 -->
        <div class="tab-section" ref="total">
          <Indicator
            name="userPanelList"
            :tabStyleWidth="`${100 / availableTabs.length}%`"
            :tabTexts="availableTabs"
            v-model:active-index="state.tabIndex"
          />
        </div>

        <!-- 🎯 Tab 内容区域 -->
        <div class="tab-content">
          <SlideRowList name="userPanelList" v-model:active-index="state.tabIndex">
            <!-- Tab 0: 作品（始终显示） -->
            <SlideItem>
              <div class="videos">
                <Posters
                  v-if="props.currentItem.aweme_list && props.currentItem.aweme_list.length"
                  :list="props.currentItem.aweme_list"
                ></Posters>
                <Loading
                  :isFullScreen="false"
                  v-else-if="state.loadings.profile || state.loadings.works"
                />
                <div
                  class="empty-list"
                  v-else-if="
                    (!props.currentItem.aweme_list || props.currentItem.aweme_list.length === 0) &&
                    !state.loadings.profile &&
                    !state.loadings.works
                  "
                >
                  <div class="title">暂时没有作品</div>
                </div>
                <NoMore
                  v-else-if="
                    props.currentItem.aweme_list && props.currentItem.aweme_list.length > 0
                  "
                />
              </div>
            </SlideItem>

            <!-- Tab 1: 喜欢 -->
            <SlideItem v-if="shouldShowLikeTab">
              <div class="videos">
                <!-- 🎯 未公开提示 -->
                <div class="privacy-notice" v-if="!isLikePublic">
                  <img src="@/assets/img/icon/me/lock-gray.png" alt="" />
                  <span>对方未公开喜欢列表</span>
                </div>
                <!-- 已公开，显示内容 -->
                <template v-else>
                  <Posters v-if="state.videos.like.list.length" :list="state.videos.like.list" />
                  <Loading :isFullScreen="false" v-else-if="state.loadings.like" />
                  <div
                    class="empty-list"
                    v-else-if="state.videos.like.list.length === 0 && !state.loadings.like"
                  >
                    <div class="title">暂时没有喜欢的视频</div>
                  </div>
                  <NoMore v-else />
                </template>
              </div>
            </SlideItem>

            <!-- Tab 2: 收藏 -->
            <SlideItem v-if="shouldShowCollectTab">
              <div class="videos">
                <!-- 🎯 未公开提示 -->
                <div class="privacy-notice" v-if="!isCollectPublic">
                  <img src="@/assets/img/icon/me/lock-gray.png" alt="" />
                  <span>对方未公开收藏列表</span>
                </div>
                <!-- 已公开，显示内容 -->
                <template v-else>
                  <Posters
                    v-if="state.videos.collect.list.length"
                    :list="state.videos.collect.list"
                  />
                  <Loading :isFullScreen="false" v-else-if="state.loadings.collect" />
                  <div
                    class="empty-list"
                    v-else-if="state.videos.collect.list.length === 0 && !state.loadings.collect"
                  >
                    <div class="title">暂时没有收藏的视频</div>
                  </div>
                  <NoMore v-else />
                </template>
              </div>
            </SlideItem>
          </SlideRowList>
        </div>
      </div>
    </div>
    <!-- ✅ 关闭 scroll-container -->
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { Icon } from '@iconify/vue'
import {
  _checkImgUrl,
  _copy,
  _formatNumber,
  _getUserDouyinId,
  _notice,
  _no,
  _stopPropagation
} from '@/utils'
import { useNav } from '@/utils/hooks/useNav'
import Indicator from './slide/Indicator.vue'
import SlideRowList from './slide/SlideRowList.vue'
import SlideItem from './slide/SlideItem.vue'
import Posters from '@/components/Posters.vue'
import { DefaultUser } from '@/utils/const_var'
import Loading from '@/components/Loading.vue'
import NoMore from '@/components/NoMore.vue'
import { useBaseStore } from '@/store/pinia'
import {
  authorVideos,
  toggleFollowUser,
  getUserProfile,
  requestAuthorUpdate,
  recordProfileVisit,
  likeVideo,
  collectedVideo
} from '@/api/videos'

const $nav = useNav()
const baseStore = useBaseStore()
const emit = defineEmits<{
  'update:currentItem': [val: any]
  back: []
  showFollowSetting: []
  showFollowSetting2: []
}>()

const props = defineProps({
  currentItem: {
    type: Object,
    default() {
      return {
        author: DefaultUser,
        aweme_list: []
      }
    },
    required: true
  },
  active: {
    type: Boolean,
    default() {
      return false
    }
  }
})
const main = ref(null)
const page = ref(null)
const scrollContainer = ref<HTMLElement | null>(null)
const cover = ref(null)
const total = ref(null)

const state = reactive({
  isShowRecommend: false, //是否显示推荐
  previewImg: '',
  floatFixed: false,
  showFollowSetting: false,
  floatHeight: 52,
  tabIndex: 0, // 🎯 当前tab索引
  videos: {
    // 作者作品分页信息（列表直接复用 props.currentItem.aweme_list）
    works: { total: -1, pageNo: 0, pageSize: 20 },
    // 喜欢列表
    like: { list: [], total: -1, pageNo: 0, pageSize: 20 },
    // 收藏列表
    collect: { list: [], total: -1, pageNo: 0, pageSize: 20 }
  },
  loadings: {
    showRecommend: false,
    follow: false, // ✅ 关注/取消关注 loading
    profile: false, // ✅ 加载用户信息 loading
    works: false, // ✅ 加载作品列表 loading
    like: false, // 🎯 加载喜欢列表 loading
    collect: false, // 🎯 加载收藏列表 loading
    requestUpdate: false // 🎯 求更新 loading
  },
  acceleration: 1.2,
  start: { x: 0, y: 0, time: 0 },
  move: { x: 0, y: 0 },
  isTop: false,
  coverHeight: 220,
  //能移动的高度
  canMoveMaxHeight: document.body.clientHeight / 4,
  //是否自动放大Cover
  isAutoScaleCover: false,
  uid: null,
  // 🎯 本地防抖：避免同一作者短时间内重复上报访客
  lastVisitAuthorId: '',
  lastVisitAt: 0
})

// ✅ 本地响应式对象：存储作者统计数据（解决 API 更新延迟问题）
const localAuthorStats = reactive({
  aweme_count: 0,
  total_favorited: 0,
  following_count: 0,
  mplatform_followers_count: 0
})

// ✅ 初始化或更新本地统计数据
watch(
  () => props.currentItem?.author,
  (author) => {
    if (author) {
      localAuthorStats.aweme_count = author.aweme_count || 0
      localAuthorStats.total_favorited = author.total_favorited || 0
      localAuthorStats.following_count = author.following_count || 0
      localAuthorStats.mplatform_followers_count = author.mplatform_followers_count || 0
    }
  },
  { immediate: true, deep: true }
)

// ✅ 判断是否显示关注按钮：只有 follow_status 是 0/1/2 时才显示
const shouldShowFollowButton = computed(() => {
  const status = props.currentItem?.author?.follow_status
  return status === 0 || status === 1 || status === 2
})

// 🎯 喜欢tab始终显示
const shouldShowLikeTab = computed(() => true)

// 🎯 收藏tab始终显示
const shouldShowCollectTab = computed(() => true)

// 🎯 判断对方是否公开了喜欢列表
const isLikePublic = computed(() => {
  const author = props.currentItem?.author
  return author?.show_like !== false
})

// 🎯 判断对方是否公开了收藏列表
const isCollectPublic = computed(() => {
  const author = props.currentItem?.author
  return author?.show_collect !== false
})

async function handleRequestUpdate() {
  try {
    const authorId = props.currentItem?.author?.user_id
    if (!authorId) {
      console.log('[UserPanel] ❌ authorId 不存在，无法求更新')
      _notice('作者ID缺失，稍后重试')
      return
    }
    if (state.loadings.requestUpdate) return
    state.loadings.requestUpdate = true

    console.log('[UserPanel] 🫵 求更新', { authorId })
    const res = await requestAuthorUpdate(authorId)
    if (!res?.success) {
      _notice(res?.message || '求更新失败')
      return
    }
    if (res?.data?.sent === false) {
      _notice('已提醒过一次，24小时后再来吧')
      return
    }
    _notice('已通知作者更新作品')
  } catch (e) {
    console.error('[UserPanel] handleRequestUpdate error:', e)
    _notice('求更新失败，请稍后重试')
  } finally {
    state.loadings.requestUpdate = false
  }
}

// 🎯 进入别人主页时记录访客（后端会做 24h 去重 + 24h 通知限频）
async function reportProfileVisit() {
  try {
    const authorId = props.currentItem?.author?.user_id
    const myId = baseStore?.userinfo?.uid
    if (!authorId || !myId) return
    if (authorId === myId) return

    const now = Date.now()
    if (state.lastVisitAuthorId === authorId && now - (state.lastVisitAt || 0) < 2000) {
      return
    }
    state.lastVisitAuthorId = authorId
    state.lastVisitAt = now

    console.log('[UserPanel] 👀 记录访客', { authorId })
    await recordProfileVisit(authorId)
  } catch (e) {
    console.warn('[UserPanel] reportProfileVisit failed:', e)
  }
}

// 🎯 固定tab列表
const availableTabs = computed(() => ['作品', '喜欢', '收藏'])

watch(
  () => props.active,
  async (newVal, oldVal) => {
    console.log('[UserPanel] 🔍 active watch 触发:', {
      newVal,
      oldVal,
      immediate: oldVal === undefined
    })
    console.log('[UserPanel] 🔍 props.active 值:', props.active)
    console.log('[UserPanel] 🔍 props.currentItem:', props.currentItem)

    if (newVal) {
      console.log('[UserPanel] ✅ 面板激活，开始加载数据')

      // ✅ 1. 先加载作者详细信息（名字、签名、统计数据等）
      await loadAuthorInfo()
      // ✅ 记录访客（后端去重+限频）
      await reportProfileVisit()

      // ✅ 2. 再加载作者视频列表
      if (!props.currentItem.aweme_list || !props.currentItem.aweme_list.length) {
        console.log('[UserPanel] ⚡ aweme_list 为空，立即调用 loadAuthorVideos()')
        await loadAuthorVideos()
      } else {
        console.log('[UserPanel] ⏭️ aweme_list 已有数据，跳过加载')
      }
    } else {
      console.log('[UserPanel] ⏸️ 面板未激活')
    }
  },
  { immediate: true } // ✅ 立即执行，确保首次加载
)

watch(
  () => props.currentItem.author.uid,
  async (newUid) => {
    console.log('[UserPanel] author.uid 变化:', {
      newUid,
      oldUid: state.uid,
      changed: newUid !== state.uid
    })
    if (props.currentItem.author.uid !== state.uid) {
      console.log('[UserPanel] UID 改变，重新加载视频')
      state.uid = props.currentItem.author.uid
      // ✅ 记录访客（切换到另一个作者）
      await reportProfileVisit()
      // ✅ 切换作者时重置分页状态，避免沿用上一位作者的 pageNo/total
      state.videos.works.pageNo = 0
      state.videos.works.total = -1
      emit('update:currentItem', { ...props.currentItem, aweme_list: [] })
      await loadAuthorVideos()
    }
  }
)

function stop(e) {
  e.stopPropagation()
}

// ✅ 处理关注/取消关注
async function handleFollowClick() {
  const status = props.currentItem.author.follow_status
  const authorId = props.currentItem.author.user_id

  if (!authorId) {
    console.error('[UserPanel] authorId is missing')
    return
  }

  // ✅ 防止重复点击
  if (state.loadings.follow) {
    return
  }

  try {
    state.loadings.follow = true

    if (status === 0) {
      // 未关注 → 关注
      console.log('[UserPanel] 关注用户:', authorId)
      const result = await toggleFollowUser(authorId, true)

      // ✅ 使用后端返回的关注状态（1=已关注, 2=互相关注）
      const newStatus = result?.follow_status ?? 1
      const updatedAuthor = {
        ...props.currentItem.author,
        follow_status: newStatus,
        is_follow: newStatus > 0
      }

      // ✅ 更新本地统计数据（如果后端返回了粉丝数）
      if (result?.follower_count !== undefined && result.follower_count !== null) {
        localAuthorStats.mplatform_followers_count = result.follower_count
      }

      emit('update:currentItem', { ...props.currentItem, author: updatedAuthor })
      console.log(
        '[UserPanel] ✅ 关注成功, 状态:',
        result?.follow_status === 2 ? '互相关注' : '已关注'
      )
    } else {
      // 已关注(1) 或 互相关注(2) → 取消关注
      console.log('[UserPanel] 取消关注用户:', authorId)
      const result = await toggleFollowUser(authorId, false)

      // 取消关注后状态为0
      const updatedAuthor = {
        ...props.currentItem.author,
        follow_status: 0,
        is_follow: false
      }

      // ✅ 更新本地统计数据（如果后端返回了粉丝数）
      if (result?.follower_count !== undefined && result.follower_count !== null) {
        localAuthorStats.mplatform_followers_count = result.follower_count
      }

      emit('update:currentItem', { ...props.currentItem, author: updatedAuthor })
      console.log('[UserPanel] ✅ 取消关注成功')
    }
  } catch (error: any) {
    console.error('[UserPanel] ❌ 关注操作失败:', error?.message || error)
    // TODO: 显示错误提示给用户
  } finally {
    state.loadings.follow = false
  }
}

function followButton() {}

function cancelFollow() {}

// 🎯 复制作者的数字ID
function copyAuthorNumericId() {
  if (props.currentItem?.author?.numeric_id) {
    _copy(String(props.currentItem.author.numeric_id))
  }
}

// 🎯 复制作者的TG用户名
function copyAuthorTgUsername() {
  if (props.currentItem?.author?.unique_id) {
    _copy('@' + props.currentItem.author.unique_id)
  }
}

defineExpose({ cancelFollow })

// ✅ 加载作者详细信息（个人信息 + 统计数据）
async function loadAuthorInfo() {
  try {
    console.log('[UserPanel] 📡 loadAuthorInfo 开始')
    state.loadings.profile = true

    const authorId = props.currentItem.author?.user_id
    if (!authorId) {
      console.log('[UserPanel] ❌ authorId 不存在，无法加载用户信息')
      return
    }

    console.log('[UserPanel] 📡 调用 getUserProfile API, authorId:', authorId)
    const res = await getUserProfile(authorId)
    console.log('[UserPanel] API 响应:', res)

    if (res?.success && res.data) {
      const profile = res.data
      console.log('[UserPanel] ✅ 获取到用户信息:', {
        nickname: profile.nickname,
        username: profile.username,
        followStatus: profile.follow_status,
        totalFavorited: profile.total_favorited,
        followingCount: profile.following_count,
        followersCount: profile.followers_count,
        awemeCount: profile.aweme_count
      })

      // ✅ 更新 author 信息
      const followStatus = profile.follow_status ?? props.currentItem.author.follow_status
      const updatedAuthor = {
        ...props.currentItem.author,
        // 个人信息
        nickname: profile.nickname || props.currentItem.author.nickname,
        unique_id: profile.username || props.currentItem.author.unique_id,
        numeric_id: profile.numeric_id || props.currentItem.author.numeric_id, // ✅ 添加 numeric_id
        signature: profile.bio || profile.signature || props.currentItem.author.signature,
        gender: profile.gender,
        birthday: profile.birthday,
        // 统计数据
        total_favorited: profile.total_favorited ?? props.currentItem.author.total_favorited,
        following_count: profile.following_count ?? props.currentItem.author.following_count,
        mplatform_followers_count:
          profile.followers_count ?? props.currentItem.author.mplatform_followers_count,
        aweme_count: profile.aweme_count ?? props.currentItem.author.aweme_count,
        // 关注状态
        follow_status: followStatus,
        is_follow: followStatus > 0, // ✅ 根据 follow_status 设置 is_follow
        // 头像（如果有新的）
        avatar_168x168: profile.avatar_url
          ? { url_list: [profile.avatar_url] }
          : props.currentItem.author.avatar_168x168
      }

      console.log('[UserPanel] 📝 更新 author 数据')

      // ✅ 立即更新本地统计数据（避免等待父组件更新）
      localAuthorStats.aweme_count = profile.aweme_count || 0
      localAuthorStats.total_favorited = profile.total_favorited || 0
      localAuthorStats.following_count = profile.following_count || 0
      localAuthorStats.mplatform_followers_count = profile.followers_count || 0

      console.log('[UserPanel] ✅ 本地统计数据已更新:', localAuthorStats)

      // 同时更新父组件数据
      emit('update:currentItem', {
        ...props.currentItem,
        author: updatedAuthor
      })
    } else {
      console.log('[UserPanel] ⚠️ 获取用户信息失败，使用传入的数据')
    }
  } catch (error) {
    console.error('[UserPanel] loadAuthorInfo 错误:', error)
  } finally {
    state.loadings.profile = false
  }
}

async function loadAuthorVideos() {
  try {
    // ✅ 防止滚动到底部时并发触发导致重复追加
    if (state.loadings.works) {
      console.log('[UserPanel] loadAuthorVideos: loading中，跳过重复触发', {
        pageNo: state.videos.works.pageNo
      })
      return
    }

    console.log('[UserPanel] loadAuthorVideos 开始')
    console.log('[UserPanel] currentItem:', {
      hasAuthor: !!props.currentItem?.author,
      authorId: props.currentItem?.author?.user_id,
      nickname: props.currentItem?.author?.nickname
    })

    const authorId = props.currentItem.author?.user_id

    if (!authorId) {
      console.log('[UserPanel] ❌ authorId 不存在，无法加载视频')
      return
    }

    // 已经全部加载完
    if (
      state.videos.works.total !== -1 &&
      (props.currentItem.aweme_list?.length || 0) >= state.videos.works.total
    ) {
      console.log('[UserPanel] 已加载全部作品，跳过')
      return
    }

    state.loadings.works = true // ✅ 开始加载

    console.log('[UserPanel] 📡 调用 authorVideos API', {
      authorId,
      pageNo: state.videos.works.pageNo,
      pageSize: state.videos.works.pageSize
    })
    // ✅ 分页加载作者作品
    const res = await authorVideos(authorId, {
      pageNo: state.videos.works.pageNo,
      pageSize: state.videos.works.pageSize
    })
    console.log('[UserPanel] API 响应:', {
      success: res?.success,
      listLength: res?.data?.list?.length || 0,
      firstIds: (res?.data?.list || [])
        .slice(0, 5)
        .map((v: any) => v?.aweme_id)
        .filter(Boolean)
    })

    if (res?.success) {
      state.videos.works.total = res.data?.total ?? state.videos.works.total

      const pageList = (res.data?.list || []).map((a: any) => ({
        ...a,
        author: props.currentItem.author
      }))
      console.log('[UserPanel] ✅ 本次加载作品数量:', pageList.length)

      const existing = props.currentItem.aweme_list || []
      // ✅ 合并并去重（后端或并发重复返回时也能兜底）
      const mergedRaw = state.videos.works.pageNo === 0 ? pageList : [...existing, ...pageList]
      const seen = new Set<string>()
      const merged = mergedRaw.filter((v: any) => {
        const key = v?.aweme_id || v?.id
        if (!key) return true
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      console.log('[UserPanel] ✅ 合并后作品总数:', merged.length)

      // ✅ 返回新对象，触发响应式更新
      emit('update:currentItem', { ...props.currentItem, aweme_list: merged })

      state.videos.works.pageNo++
    } else {
      console.log('[UserPanel] ❌ API 调用失败或返回空')
      // ✅ 即使失败，也更新为空列表（如果是第一次加载），触发状态更新
      if (!props.currentItem.aweme_list) {
        emit('update:currentItem', { ...props.currentItem, aweme_list: [] })
      }
    }
  } catch (error) {
    console.error('[UserPanel] loadAuthorVideos 错误:', error)
  } finally {
    state.loadings.works = false // ✅ 结束加载
  }
}

// 🎯 加载用户喜欢的视频列表
async function loadLikeVideos() {
  if (state.loadings.like) {
    return // 避免重复加载
  }

  // 已经全部加载完
  if (state.videos.like.total !== -1 && state.videos.like.list.length >= state.videos.like.total) {
    return
  }

  try {
    const authorId = props.currentItem.author?.user_id
    if (!authorId) {
      console.log('[UserPanel] ❌ authorId 不存在，无法加载喜欢列表')
      return
    }

    console.log('[UserPanel] 📡 加载喜欢列表, authorId:', authorId)
    state.loadings.like = true
    const res = await likeVideo({
      user_id: authorId,
      pageNo: state.videos.like.pageNo,
      pageSize: state.videos.like.pageSize
    })

    if (res?.success) {
      const pageList = (res.data?.list || []).map((a: any) => ({
        ...a,
        author: a.author || props.currentItem.author
      }))
      state.videos.like.total = res.data?.total || 0
      state.videos.like.list.push(...pageList)
      state.videos.like.pageNo++
      console.log('[UserPanel] ✅ 喜欢列表加载成功, 累计视频数量:', state.videos.like.list.length)
    } else {
      console.log('[UserPanel] ❌ 喜欢列表加载失败')
      state.videos.like.total = 0
    }
  } catch (error) {
    console.error('[UserPanel] loadLikeVideos 错误:', error)
    state.videos.like.total = 0
  } finally {
    state.loadings.like = false
  }
}

// 🎯 加载用户收藏的视频列表
async function loadCollectVideos() {
  if (state.loadings.collect) {
    return // 避免重复加载
  }

  if (
    state.videos.collect.total !== -1 &&
    state.videos.collect.list.length >= state.videos.collect.total
  ) {
    return
  }

  try {
    const authorId = props.currentItem.author?.user_id
    if (!authorId) {
      console.log('[UserPanel] ❌ authorId 不存在，无法加载收藏列表')
      return
    }

    console.log('[UserPanel] 📡 加载收藏列表, authorId:', authorId)
    state.loadings.collect = true
    const res = await collectedVideo({
      user_id: authorId,
      pageNo: state.videos.collect.pageNo,
      pageSize: state.videos.collect.pageSize
    })

    if (res?.success) {
      const pageList = (res.data?.list || []).map((a: any) => ({
        ...a,
        author: a.author || props.currentItem.author
      }))
      state.videos.collect.total = res.data?.total || 0
      state.videos.collect.list.push(...pageList)
      state.videos.collect.pageNo++
      console.log(
        '[UserPanel] ✅ 收藏列表加载成功, 累计视频数量:',
        state.videos.collect.list.length
      )
    } else {
      console.log('[UserPanel] ❌ 收藏列表加载失败')
      state.videos.collect.total = 0
    }
  } catch (error) {
    console.error('[UserPanel] loadCollectVideos 错误:', error)
    state.videos.collect.total = 0
  } finally {
    state.loadings.collect = false
  }
}

// 🎯 监听 tab 切换，按需加载数据
watch(
  () => state.tabIndex,
  async (newIndex) => {
    console.log('[UserPanel] Tab 切换:', newIndex, availableTabs.value[newIndex])

    // Tab 0: 作品（已在初始化时加载）
    if (newIndex === 0) {
      return
    }

    // 根据可用tab动态判断
    const currentTab = availableTabs.value[newIndex]

    // 🎯 只有公开了才加载数据
    if (currentTab === '喜欢' && isLikePublic.value) {
      await loadLikeVideos()
    } else if (currentTab === '收藏' && isCollectPublic.value) {
      await loadCollectVideos()
    }
  }
)

function scroll(e: Event) {
  // ✅ 从滚动容器获取 scrollTop
  const scrollTop = (e.target as HTMLElement)?.scrollTop || 0
  // console.log('scroll', scrollTop)
  let totalY = total.value.getBoundingClientRect().y
  state.floatFixed = totalY <= state.floatHeight
  let isTop = scrollTop === 0
  if (isTop && state.isAutoScaleCover) {
    cover.value.style.transition = 'all .1s'
    cover.value.style.height = `calc(${state.coverHeight}rem + ${state.canMoveMaxHeight}px)`
    setTimeout(() => {
      cover.value.style.transition = 'all .4s'
      cover.value.style.height = `calc(${state.coverHeight}rem)`
      state.isAutoScaleCover = false
    }, 200)
  }

  // 🎯 接近底部时，根据当前 Tab 加载更多
  const target = e.target as HTMLElement | null
  if (!target) return
  const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight
  if (scrollBottom > 200) return

  if (state.tabIndex === 0) {
    // 作品
    loadAuthorVideos()
  } else if (state.tabIndex === 1 && isLikePublic.value) {
    // 喜欢
    loadLikeVideos()
  } else if (state.tabIndex === 2 && isCollectPublic.value) {
    // 收藏
    loadCollectVideos()
  }
}

function touchStart(e: TouchEvent) {
  state.start.x = e.touches[0].pageX
  state.start.y = e.touches[0].pageY
  state.start.time = Date.now()
  // ✅ 从滚动容器获取 scrollTop
  state.isTop = scrollContainer.value?.scrollTop === 0
  if (state.isTop) {
    cover.value.style.transition = 'none'
  }
  // console.log('touchStart', scrollContainer.value?.scrollTop)
}

function touchMove(e: TouchEvent) {
  state.move.x = e.touches[0].pageX - state.start.x
  state.move.y = e.touches[0].pageY - state.start.y
  let isNext = state.move.y < 0

  // console.log('touchMove', scrollContainer.value?.scrollTop)
  //todo 有空了加个，越滑越紧的效果
  if (state.isTop && !isNext && document.body.clientHeight / 4 > state.move.y) {
    // ✅ 在顶部下拉时，阻止默认行为，防止拉动整个 miniApp
    e.preventDefault()
    let scrollHeight = state.move.y
    cover.value.style.height = `calc(${state.coverHeight}rem + ${scrollHeight}px)`
  }
}

function touchEnd() {
  if (state.isTop) {
    state.isTop = false
    cover.value.style.transition = 'all .3s'
    cover.value.style.height = `calc(${state.coverHeight}rem)`
  }
  let endTime = Date.now()
  state.isAutoScaleCover = endTime - state.start.time < 100
  // console.log('touchEnd')
}

// ✅ 在 mounted 时手动添加触摸事件监听器，以便控制 passive 属性
onMounted(() => {
  if (main.value) {
    main.value.addEventListener('touchstart', touchStart, { passive: true })
    main.value.addEventListener('touchmove', touchMove, { passive: false }) // ✅ 非 passive，允许 preventDefault
    main.value.addEventListener('touchend', touchEnd, { passive: true })
  }
})

onUnmounted(() => {
  if (main.value) {
    main.value.removeEventListener('touchstart', touchStart)
    main.value.removeEventListener('touchmove', touchMove)
    main.value.removeEventListener('touchend', touchEnd)
  }
})
</script>

<style scoped lang="less">
.fade1-enter-active,
.fade1-leave-active {
  transition: all 0.3s ease;
}

.fade1-enter-from,
.fade1-leave-to {
  transform: translateY(10px);
  opacity: 0;
}

.FromBottomDialog {
  left: inherit;
}

#UserPanel {
  position: fixed;
  top: 0;
  left: 0;
  background: var(--color-user);
  height: 100vh;
  width: 100%;
  overflow: hidden; // ✅ 外层阻止滚动
  font-size: 14rem;
  z-index: 10000; // ✅ 确保在最上层

  .scroll-container {
    height: 100vh;
    overflow-y: auto; // ✅ 内层可滚动
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain; // ✅ 防止下拉时拉动整个 miniApp
    overscroll-behavior-y: contain; // ✅ 明确指定 Y 轴
    touch-action: pan-y; // ✅ 只允许垂直平移

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .preview-img {
    z-index: 3;
    position: fixed;
    bottom: 0;
    top: 0;
    background: black;
    display: flex;
    align-items: center;
    justify-content: center;

    .resource {
      width: 100%;
      max-height: 100%;
    }

    .download {
      position: absolute;
      bottom: 20rem;
      right: 20rem;
      padding: 3rem;
      background: var(--second-btn-color-tran);
      width: 20rem;
    }
  }

  .mask {
    background: #0000004f;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: calc(var(--vh, 1vh) * 100);
    z-index: 3;
  }

  .main {
    // ✅ 添加 touch-action，允许垂直滚动但拦截其他触摸行为
    touch-action: pan-y;

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

    .notice {
      font-size: 12rem;
      height: 40rem;
      color: var(--second-text-color);
      display: flex;
      justify-content: center;
      align-items: center;

      img {
        height: 12rem;
        margin-right: 5rem;
      }
    }

    // 🎯 隐私未公开提示
    .privacy-notice {
      font-size: 12rem;
      height: 200rem;
      color: var(--second-text-color);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 10rem;

      img {
        height: 40rem;
        width: 40rem;
      }
    }

    .collect {
      padding: 7rem;

      .video {
        background: var(--active-main-bg);
        border-radius: 5rem;
        padding: 10rem;
        margin-bottom: 7rem;

        .top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10rem;

          .left {
            display: flex;
            align-items: center;
            color: gainsboro;

            img {
              height: 20rem;
              margin-right: 5rem;
            }
          }

          .right {
            display: flex;
            align-items: center;
            color: var(--second-text-color);
          }
        }

        .list {
          display: grid;
          grid-template-columns: 33.33% 33.33% 33.33%;

          .item {
            height: calc(33.33% * 1.3);
            padding: 2rem;
            overflow: hidden;
            position: relative;

            .poster {
              border-radius: 4rem;
              width: 100%;
              height: 100%;
              display: block;
            }

            .num {
              color: white;
              position: absolute;
              bottom: 5rem;
              left: 5rem;
              display: flex;
              align-items: center;
              font-size: 14rem;

              .love {
                width: 14rem;
                height: 14rem;
                margin-right: 5rem;
              }
            }
          }
        }
      }

      .audio {
        background: var(--active-main-bg);
        border-radius: 5rem;
        padding: 10rem;

        .top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10rem;

          .left {
            display: flex;
            align-items: center;
            color: gainsboro;

            img {
              height: 15rem;
              margin-right: 5rem;
            }
          }

          .right {
            display: flex;
            align-items: center;
            color: var(--second-text-color);
          }
        }

        .list {
          display: grid;
          grid-template-columns: 33.33% 33.33% 33.33%;

          .item {
            padding: 2rem;
            overflow: hidden;
            position: relative;

            .poster {
              border-radius: 4rem;
              width: 100%;
              height: calc((100% - 34rem) / 3);
              display: block;
            }

            .title {
              margin-top: 5rem;
              color: var(--second-text-color);
            }
          }
        }
      }
    }

    header {
      position: relative;
      color: white;

      .cover {
        height: 220rem;
        object-fit: cover;
        width: 100%;
        //transition: height .3s;
      }

      .avatar-wrapper {
        display: flex;
        align-items: center;
        box-sizing: border-box;
        position: absolute;
        bottom: 35rem;
        left: 20rem;
        //margin-top: -20rem;
        //transform: translateY(-20rem);

        .avatar {
          background: white;
          padding: 2.5px;
          border-radius: 50%;
          @w: 100rem;
          width: @w;
          height: @w;
        }

        .description {
          font-size: 12rem;
          color: white;
          margin-left: 15rem;

          .number,
          .certification {
            display: flex;
            align-items: center;

            img {
              width: 12rem;
              margin-left: 5rem;
            }
          }

          .number {
            color: var(--second-text-color);

            img {
              margin-left: 5rem;
            }
          }

          .certification {
            img {
              width: 14rem;
              margin-right: 5rem;
            }
          }
        }
      }
    }

    .info {
      position: relative;
      z-index: 1;
      background: var(--main-bg);
      padding: 0 20rem;
      border-radius: 10rem 10rem 0 0;
      margin-top: -20rem;

      .signature {
        color: white;
        display: flex;
        align-items: center;
        padding: 15rem; // ✅ 上下左右都是 15rem
        font-family: 'Microsoft YaHei', '微软雅黑', sans-serif; // ✅ 雅黑字体
        font-size: 14rem; // ✅ 和 Me 页面一致

        img {
          height: 12rem;
          margin-left: 6rem;
        }

        .text {
          white-space: pre-wrap;

          // ✅ 空简介样式
          &.empty {
            color: rgba(255, 255, 255, 0.5);
          }
        }
      }

      .more {
        padding: 0 0 10rem 10rem; // ✅ 上 右 下 左
        color: var(--second-text-color);
        display: flex;

        .item {
          padding: 2rem 5rem;
          border-radius: 2rem;
          background: var(--second-btn-color-tran);
          font-size: 10rem;
          display: flex;
          align-items: center;
          margin-right: 5rem;

          img {
            height: 10rem;
            margin-right: 2rem;
          }
        }
      }

      .heat {
        display: flex;
        justify-content: space-around; // ✅ 平分3等份，和Me页面一样
        padding: 10rem 0;

        .text {
          text-align: center; // ✅ 居中显示
          cursor: pointer;

          .num {
            display: block; // ✅ 数字独占一行
            font-size: 18rem; // ✅ 字体更大
            font-weight: bold;
            margin-bottom: 5rem;
            color: #fff;
          }

          span:last-child {
            font-size: 14rem; // ✅ 文字更大
            color: rgba(255, 255, 255, 0.6);
          }
        }
      }
    }

    .my-buttons {
      margin: 20rem;
      display: flex;
      justify-content: center;
      align-items: center;

      // ✅ 单个关注按钮（3种状态）
      .follow-button {
        width: 100%;
        height: 40rem;
        border-radius: 4rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8rem;
        font-size: 16rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;

        img {
          width: 16rem;
          height: 16rem;
        }

        // 未关注：粉色背景
        &.follow-button-unfollow {
          background: var(--primary-btn-color); // #FE2C55
          color: white;

          &:active {
            opacity: 0.8;
          }
        }

        // 已关注：白色背景 + 灰色文字
        &.follow-button-followed {
          background: white;
          color: #666;
          border: 1rem solid #e8e8e8;

          &:active {
            background: #f5f5f5;
          }
        }

        // 互相关注：浅绿色背景 + 白色文字
        &.follow-button-mutual {
          background: #52c41a; // 浅绿色
          color: white;
          font-weight: 600;

          &:active {
            opacity: 0.8;
          }
        }

        // Loading 状态：禁用点击，半透明
        &.follow-button-loading {
          opacity: 0.6;
          pointer-events: none;
          cursor: not-allowed;
        }
      }
    }

    // 🎯 Tab 指示器区域
    .tab-section {
      background: var(--main-bg);
      position: sticky;
      top: 52rem;
      z-index: 2;
      padding: 0;
    }

    // 🎯 Tab 内容区域
    .tab-content {
      min-height: 200px;
      background: var(--main-bg);
    }

    .videos {
      padding: 0;
      min-height: 50vh;
    }
  }

  .float {
    position: fixed;
    box-sizing: border-box;
    width: 100%;
    z-index: 2;
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 52rem;
    padding: 0 15rem;
    background: transparent;
    transition: all 0.2s;

    &.fixed {
      background: var(--main-bg);

      img {
        background: var(--main-bg) !important;
      }
    }

    .icon {
      color: white;
      border-radius: 50%;
      background: rgba(82, 80, 80, 0.5);
      padding: 6rem;
      font-size: 18rem;
    }

    .left {
      display: flex;
      align-items: center;

      .float-user {
        display: inline-flex;
        margin-left: 22rem;
        color: white;
        font-size: 12rem;
        align-items: center;
        background: var(--second-btn-color-tran);
        height: 22rem;
        border-radius: 40rem;
        padding: 1rem 10rem 1rem 1rem;

        .add {
          width: 12rem;
          margin-right: 2rem;
        }

        .avatar {
          width: 20rem;
          border-radius: 50%;
          margin-right: 5rem;
        }
      }
    }

    .right {
      display: flex;
      color: white;
      align-items: center;
      position: relative;
      gap: 15rem;

      .request {
        font-size: 12rem;
        height: 26rem;
        display: flex;
        padding-right: 13rem;
        padding-left: 5rem;
        align-items: center;
        border-radius: 20rem;
        background: rgba(82, 80, 80, 0.5);

        img {
          padding: 6rem;
          width: 18rem;
        }
      }
    }
  }
}
</style>
