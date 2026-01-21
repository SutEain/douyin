<template>
  <div class="home-page">
    <div class="home-container" id="home-index">
      <!-- ✅ 恢复顶部导航栏（IndicatorHome） -->
      <IndicatorHome
        v-if="!videoStore.isFullscreen"
        :loading="baseStore.loading"
        name="main"
        v-model:index="state.navIndex"
      />

      <!-- ✅ 视频内容区域：关注 / 图文 / 视频 / 短剧 / 东南亚 / 直播 / 成人 / 推荐 -->
      <div class="video-content has-footer-offset">
        <!-- 0=关注 -->
        <SlideFollow v-if="state.navIndex === 0" :active="state.active && state.navIndex === 0" />
        <!-- 1=图文 -->
        <Community
          v-else-if="state.navIndex === 1"
          :active="state.active && state.navIndex === 1"
        />
        <!-- 2=视频 -->
        <VideoTab v-else-if="state.navIndex === 2" :active="state.active && state.navIndex === 2" />
        <!-- 3=短剧 -->
        <ShortDramaTab
          v-else-if="state.navIndex === 3"
          :active="state.active && state.navIndex === 3"
        />
        <!-- 4=东南亚 -->
        <LongVideo
          v-else-if="state.navIndex === 4"
          :active="state.active && state.navIndex === 4"
        />
        <!-- 5=直播 -->
        <LiveTab v-else-if="state.navIndex === 5" :active="state.active && state.navIndex === 5" />
        <!-- 6=成人 -->
        <SlideAdult
          v-else-if="state.navIndex === 6"
          :active="state.active && state.navIndex === 6"
        />
        <!-- 7=推荐 -->
        <Slide4 v-else :active="state.active && state.navIndex === 7" />
      </div>

      <!-- 底部导航栏 -->
      <BaseFooter :init-tab="1" />

      <PlayFeedback v-model="state.showPlayFeedback" />
      <DouyinCode
        v-if="state.currentItem"
        :item="state.currentItem"
        v-model="state.showDouyinCode"
      />
      <ShareTo v-model:type="state.shareType" />

      <FollowSetting
        v-if="state.currentItem"
        v-model:currentItem="state.currentItem"
        @showChangeNote="state.showChangeNote = true"
        @showBlockDialog="state.showBlockDialog = true"
        @showShare="state.isSharing = true"
        v-model="state.showFollowSetting"
      />

      <FollowSetting2
        v-if="state.currentItem"
        v-model:currentItem="state.currentItem"
        v-model="state.showFollowSetting2"
      />

      <BlockDialog v-model="state.showBlockDialog" />

      <ConfirmDialog title="设置备注名" ok-text="确认" v-model:visible="state.showChangeNote">
        <Search mode="light" v-model="state.test" :isShowSearchIcon="false" />
      </ConfirmDialog>

      <ShareToFriend v-model="state.shareToFriend" />
    </div>

    <!-- ✅ 使用 Teleport 将弹窗传送到 body，避免定位问题 -->
    <Teleport to="body">
      <!-- 评论弹窗 -->
      <Comment
        page-id="home-index"
        :video-id="videoStore.commentVideoId"
        v-model="videoStore.showComments"
        @close="videoStore.closeComments()"
        @comment-success="handleCommentSuccess"
      />

      <!-- 分享弹窗 -->
      <Share
        v-if="state.currentItem"
        v-model="state.isSharing"
        ref="share"
        page-id="home-index"
        :item="state.currentItem"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBaseStore } from '@/store/pinia'
import { useVideoStore } from '@/stores/video'
import { videoManager } from '@/utils/videoManager'
import bus, { EVENT_KEY } from '@/utils/bus'

// 组件导入
import IndicatorHome from './components/IndicatorHome.vue'
import Slide4 from './slide/Slide4.vue'
import SlideAdult from './slide/SlideAdult.vue'
import SlideFollow from './slide/SlideFollow.vue'
import LongVideo from './slide/LongVideo.vue'
import VideoTab from './slide/VideoTab.vue'
import ShortDramaTab from './slide/ShortDramaTab.vue'
import Community from './slide/Community.vue'
import LiveTab from './slide/LiveTab.vue'
import BaseFooter from '@/components/BaseFooter.vue'
import Comment from '@/components/CommentNew.vue'
import Share from '@/components/Share.vue'
import PlayFeedback from './components/PlayFeedback.vue'
import DouyinCode from '@/components/DouyinCode.vue'
import ShareTo from './components/ShareTo.vue'
import FollowSetting from './components/FollowSetting.vue'
import FollowSetting2 from './components/FollowSetting2.vue'
import BlockDialog from '../message/components/BlockDialog.vue'
import ConfirmDialog from '@/components/dialog/ConfirmDialog.vue'
import Search from '@/components/Search.vue'
import ShareToFriend from './components/ShareToFriend.vue'

defineOptions({
  name: 'Home'
})

const baseStore = useBaseStore()
const videoStore = useVideoStore()
const router = useRouter()

const share = ref()

const state = reactive({
  navIndex: 7, // 默认显示"推荐" tab (0=关注, 1=图文, 2=视频, 3=短剧, 4=东南亚, 5=直播, 6=成人, 7=推荐)
  test: '',
  isSharing: false,
  shareType: -1,
  showPlayFeedback: false,
  showDouyinCode: false,
  showFollowSetting: false,
  showFollowSetting2: false,
  showBlockDialog: false,
  showChangeNote: false,
  shareToFriend: false,
  active: true,
  currentItem: null as any
})

// 监听 navIndex 变化，暂停其他 tab 的视频
watch(
  () => state.navIndex,
  (newIndex, oldIndex) => {
    if (newIndex !== oldIndex) {
      console.log(`[Home] 切换 tab: ${oldIndex} -> ${newIndex}`)
      // 暂停所有视频，让新 tab 自己控制播放
      videoManager.pauseAll()
    }
  }
)

// 监听 videoStore 的 currentVideo 变化，同步到 state.currentItem
watch(
  () => videoStore.currentVideo,
  (newVideo) => {
    if (newVideo) {
      state.currentItem = {
        ...newVideo,
        aweme_list: (newVideo as any).aweme_list || []
      }
    }
  }
)

// ========== Methods ==========
function handleCommentSuccess() {
  if (state.currentItem?.statistics) {
    state.currentItem.statistics.comment_count++
  }
  if (videoStore.currentVideo?.statistics) {
    videoStore.currentVideo.statistics.comment_count++
  }
}

// 打开用户资料页
function handleGoUserInfo() {
  console.log('[Home] 🎯 handleGoUserInfo 被调用了！')

  // 优先使用 videoStore.currentVideo，因为它是实时的
  const currentVideo = videoStore.currentVideo || state.currentItem

  if (currentVideo?.author) {
    const author = currentVideo.author
    console.log('[Home] 打开用户资料页', { author })

    const targetId = author.user_id || author.uid
    if (targetId) {
      router.push({
        name: 'user-page',
        params: { id: targetId }
      })
    }
  } else {
    console.log('[Home] ❌ 没有 currentVideo 或 author', { currentVideo })
  }
}

// 🎯 深链接逻辑已移至 App.vue 全局处理，此处仅保留日志供调试
function checkDeepLink() {
  console.log('[DeepLink][Home] 状态确认:', {
    startLiveId: baseStore.startLiveId,
    startVideoId: baseStore.startVideoId
  })
}

// ========== 生命周期 ==========
onMounted(() => {
  console.log('[Home] mounted')
  console.log('[Home] State:', {
    navIndex: state.navIndex,
    isFullscreen: videoStore.isFullscreen,
    footerHeight: getComputedStyle(document.documentElement).getPropertyValue('--footer-height')
  })

  // 监听点击头像事件
  bus.on(EVENT_KEY.GO_USERINFO, handleGoUserInfo)
  console.log('[Home] ✅ 已注册 GO_USERINFO 监听器', EVENT_KEY.GO_USERINFO)

  // 🎯 检查深链接参数（仅用于调试日志）
  checkDeepLink()
})

onUnmounted(() => {
  // 移除事件监听
  bus.off(EVENT_KEY.GO_USERINFO, handleGoUserInfo)
})

onActivated(() => {
  console.log('[Home] activated')
  state.active = true
})

onDeactivated(() => {
  console.log('[Home] deactivated')
  state.active = false
  videoManager.pauseAll()
})
</script>

<style scoped lang="less">
.home-page {
  width: 100%;
  height: calc(var(--vh, 1dvh) * 100); /* 🎯 适配全平台 */
}

.home-container {
  position: relative;
  width: 100%;
  height: calc(var(--vh, 1dvh) * 100);
  background: black;
}

/* 视频内容区域 */
.video-content {
  position: relative;
  width: 100%;
  /* 🎯 方案升级：核心修复视频遮挡字幕问题 */
  /* 使用 padding-top 而不是 margin-top，防止外边距折叠导致顶部黑边 */
  padding-top: var(--home-header-height);
  /* 这样 height: 100% 的子组件（视频）就正好止步于 Footer 上方 */
  height: calc(
    var(--vh, 1vh) * 100 - var(--footer-height) -
      env(safe-area-inset-bottom)
  );
  box-sizing: border-box;
  overflow: hidden;
  z-index: 1;

  /* 🎯 定义底部偏移量：用于内部 UI 组件（如描述、作者）的定位基准 */
  &.has-footer-offset {
    --footer-offset: 0rem;

    /* 🎯 安卓 Chrome 环境下，额外减去高度以应对地址栏和导航栏遮挡 */
    :global(html.is-chrome.is-android) & {
      height: calc(
        var(--vh, 1vh) * 100 - var(--home-header-height) - var(--footer-height) -
          env(safe-area-inset-bottom) - 35rem
      );
    }
  }

  /* 让每个 tab 的内容占满整个区域 */
  > * {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
}
</style>
