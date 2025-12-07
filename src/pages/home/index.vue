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

      <!-- ✅ 视频内容区域（只有推荐） -->
      <div class="video-content">
        <Slide4 :active="true" />
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
      <!-- 用户资料页 -->
      <UserPanel
        v-if="state.showUserPanel && state.currentItem"
        :currentItem="state.currentItem"
        :active="state.showUserPanel"
        @back="handleCloseUserPanel"
        @update:currentItem="(item) => (state.currentItem = item)"
      />
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
import { _notice } from '@/utils'
import { useBaseStore } from '@/store/pinia'
import { useVideoStore } from '@/stores/video'
import { videoManager } from '@/utils/videoManager'
import bus, { EVENT_KEY } from '@/utils/bus'

// 组件导入
import IndicatorHome from './components/IndicatorHome.vue'
import Slide4 from './slide/Slide4.vue'
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
import UserPanel from '@/components/UserPanel.vue'

defineOptions({
  name: 'Home'
})

const baseStore = useBaseStore()
const videoStore = useVideoStore()
const router = useRouter()

const share = ref()

const state = reactive({
  navIndex: 2, // 默认显示"推荐" tab (0=长视频, 1=关注, 2=推荐)
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
  currentItem: null as any,
  showUserPanel: false // ✅ 控制显示用户资料页
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
    // 更新 currentItem 并显示 UserPanel
    state.currentItem = currentVideo
    state.showUserPanel = true
    console.log('[Home] ✅ showUserPanel 已设置为:', state.showUserPanel)
    console.log('[Home] ✅ currentItem:', state.currentItem)
  } else {
    console.log('[Home] ❌ 没有 currentVideo 或 author', { currentVideo })
  }
}

// 关闭用户资料页
function handleCloseUserPanel() {
  state.showUserPanel = false
}

// 🎯 检查深链接参数（简化版 - 让后端API处理）
async function checkDeepLink() {
  console.log('[DeepLink][Home] ========== 检查深链接参数 ==========')
  console.log('[DeepLink][Home] baseStore.startVideoId (初始状态):', baseStore.startVideoId)

  // 🎯 如果第一次没有解析到，延迟重试（给 Telegram WebApp 更多初始化时间）
  if (!baseStore.startVideoId) {
    console.log('[DeepLink][Home] 未检测到深链接，延迟 100ms 后重试...')

    // 延迟 100ms 再次解析
    await new Promise((resolve) => setTimeout(resolve, 100))

    console.log('[DeepLink][Home] 重新尝试解析...')
    baseStore.parseStartParam()
    console.log('[DeepLink][Home] baseStore.startVideoId (第二次检查):', baseStore.startVideoId)

    // 如果还是没有，再延迟 200ms 最后一次尝试
    if (!baseStore.startVideoId) {
      console.log('[DeepLink][Home] 仍未检测到，延迟 200ms 后最后一次尝试...')
      await new Promise((resolve) => setTimeout(resolve, 200))

      console.log('[DeepLink][Home] 最后一次尝试解析...')
      baseStore.parseStartParam()
      console.log('[DeepLink][Home] baseStore.startVideoId (第三次检查):', baseStore.startVideoId)
    }
  }

  if (baseStore.startVideoId) {
    console.log('[DeepLink][Home] ✅ 检测到深链接参数:', baseStore.startVideoId)
    console.log('[DeepLink][Home] 等待 Slide4 调用 API 时处理（后端会将深链接视频插入列表首位）')
  } else {
    console.log('[DeepLink][Home] ❌ 未检测到深链接参数，正常加载推荐流')
  }

  console.log('[DeepLink][Home] ========== 检查完成 ==========')
}

// ========== 生命周期 ==========
onMounted(() => {
  console.log('[Home] mounted')

  // 监听点击头像事件
  bus.on(EVENT_KEY.GO_USERINFO, handleGoUserInfo)
  console.log('[Home] ✅ 已注册 GO_USERINFO 监听器', EVENT_KEY.GO_USERINFO)

  // 🎯 检查深链接参数
  checkDeepLink()

  // 首次打开时提示打开声音
  if (!sessionStorage.getItem('sound-tip-shown')) {
    setTimeout(() => {
      _notice('点击右下角打开声音 🔊')
      sessionStorage.setItem('sound-tip-shown', '1')
    }, 500)
  }
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
  height: 100%;
}

.home-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: black;
}

/* 视频内容区域 */
.video-content {
  position: relative;
  width: 100%;
  height: calc(var(--vh, 1vh) * 100 - var(--footer-height));
  overflow: hidden;

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
