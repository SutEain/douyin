<script setup lang="ts">
import { _formatNumber, cloneDeep, _notice, _copy } from '@/utils'
import bus, { EVENT_KEY } from '@/utils/bus'
import { useClick } from '@/utils/hooks/useClick'
import { computed, inject, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { toggleVideoLike, toggleVideoCollect, toggleFollowUser, sendReward } from '@/api/videos'
import { useVideoStore } from '@/stores/video'
import { useBaseStore } from '@/store/pinia'
import { supabase } from '@/utils/supabase'

const props = defineProps({
  isMy: {
    type: Boolean,
    default: () => {
      return false
    }
  },
  item: {
    type: Object,
    default: () => {
      return {}
    }
  }
})

const position = inject<any>('position')
const videoStore = useVideoStore()
const baseStore = useBaseStore()

// 🎯 倍速播放（仅对当前视频生效，由上层播放器提供 setPlaybackRate）
const injectedPlaybackRate = inject<any>('playbackRate', null)
const injectedSetPlaybackRate = inject<any>('setPlaybackRate', null)
const speedOptions = [0.5, 1.0, 1.25, 1.5, 2.0]
const playbackRateText = computed(() => {
  const r = injectedPlaybackRate?.value ?? 1
  // 统一显示 1x / 1.25x
  return `${r}x`
})

function choosePlaybackRate(rate: number) {
  if (typeof injectedSetPlaybackRate === 'function') {
    injectedSetPlaybackRate(rate)
  } else {
    console.warn('[ItemToolbar] setPlaybackRate 未注入，无法设置倍速')
  }
}

// 🎯 切换到新视频时：重置抽屉状态
watch(
  () => (props.item as any)?.aweme_id,
  (newId, oldId) => {
    if (newId && newId !== oldId) {
      showMoreDrawer.value = false
      showRewardPanel.value = false
    }
  }
)

onMounted(() => {
  // 首次打开 App 时显示提示
  if (!sessionStorage.getItem('sound-tip-shown')) {
    setTimeout(() => {
      _notice('点击右下角,打开声音', 5000)
      sessionStorage.setItem('sound-tip-shown', '1')
    }, 1500)
  }
})

const emit = defineEmits(['update:item', 'goUserInfo', 'showComments', 'showShare', 'goMusic', 'toggleCleanScreen'])

function syncItemState() {
  const snapshot = cloneDeep(props.item)
  emit('update:item', snapshot)
  bus.emit(EVENT_KEY.UPDATE_ITEM, { position: position.value, item: snapshot })
}

let likeLoading = $ref(false)
let collectLoading = $ref(false)
let followLoading = $ref(false)

// 静音状态（全局同步，Pinia 为主，兼容旧 bus）
const isMuted = computed(() => videoStore.isMuted)

// 切换静音
function toggleMute() {
  const next = !videoStore.isMuted
  videoStore.toggleMuted(next)
  // 兼容旧的全局变量/事件
  window.isMuted = next
  bus.emit(next ? EVENT_KEY.ADD_MUTED : EVENT_KEY.REMOVE_MUTED)
}

// 监听全局静音事件，同步图标状态
function onAddMuted() {
  videoStore.toggleMuted(true)
}

function onRemoveMuted() {
  videoStore.toggleMuted(false)
}

onMounted(() => {
  bus.on(EVENT_KEY.ADD_MUTED, onAddMuted)
  bus.on(EVENT_KEY.REMOVE_MUTED, onRemoveMuted)
})

onUnmounted(() => {
  bus.off(EVENT_KEY.ADD_MUTED, onAddMuted)
  bus.off(EVENT_KEY.REMOVE_MUTED, onRemoveMuted)
})

function ensureStatistics() {
  if (!props.item.statistics) {
    // eslint-disable-next-line vue/no-mutating-props
    props.item.statistics = {
      digg_count: 0,
      comment_count: 0,
      collect_count: 0,
      share_count: 0
    }
  }
}

async function loved() {
  if (likeLoading || !props.item?.aweme_id) return
  ensureStatistics()
  const previous = cloneDeep(props.item)
  const next = !props.item.isLoved
  // eslint-disable-next-line vue/no-mutating-props
  props.item.isLoved = next
  // eslint-disable-next-line vue/no-mutating-props
  props.item.statistics.digg_count = Math.max(
    0,
    (props.item.statistics.digg_count ?? 0) + (next ? 1 : -1)
  )
  syncItemState()
  likeLoading = true
  try {
    const res = await toggleVideoLike(props.item.aweme_id, next)
    if (typeof res?.like_count === 'number') {
      // eslint-disable-next-line vue/no-mutating-props
      props.item.statistics.digg_count = res.like_count
      syncItemState()
    }
  } catch (error: any) {
    Object.assign(props.item, previous)
    syncItemState()
    _notice(error?.message || '操作失败')
  } finally {
    likeLoading = false
  }
}

async function collected() {
  if (collectLoading || !props.item?.aweme_id) return
  ensureStatistics()
  const previous = cloneDeep(props.item)
  const next = !props.item.isCollect
  // eslint-disable-next-line vue/no-mutating-props
  props.item.isCollect = next
  // eslint-disable-next-line vue/no-mutating-props
  props.item.statistics.collect_count = Math.max(
    0,
    (props.item.statistics.collect_count ?? 0) + (next ? 1 : -1)
  )
  syncItemState()
  collectLoading = true
  try {
    const res = await toggleVideoCollect(props.item.aweme_id, next)
    if (typeof res?.collect_count === 'number') {
      // eslint-disable-next-line vue/no-mutating-props
      props.item.statistics.collect_count = res.collect_count
      syncItemState()
    }
  } catch (error: any) {
    Object.assign(props.item, previous)
    syncItemState()
    _notice(error?.message || '操作失败')
  } finally {
    collectLoading = false
  }
}

async function attention(e) {
  if (followLoading) return
  const targetId = props.item.author?.user_id
  if (!targetId) {
    _notice('暂不支持关注该作者')
    return
  }
  const previous = cloneDeep(props.item)
  // eslint-disable-next-line vue/no-mutating-props
  props.item.isAttention = true
  syncItemState()
  followLoading = true
  e?.currentTarget?.classList.add('attention')
  try {
    await toggleFollowUser(targetId, true)
  } catch (error: any) {
    Object.assign(props.item, previous)
    e?.currentTarget?.classList.remove('attention')
    syncItemState()
    _notice(error?.message || '关注失败')
  } finally {
    followLoading = false
  }
}

function showComments() {
  // ✅ 直接调用 videoStore 打开评论区
  const videoStore = useVideoStore()
  videoStore.openComments(props.item.aweme_id)

  // ✅ 发送事件调整视频高度（只有匹配的视频会响应）
  bus.emit(EVENT_KEY.OPEN_COMMENTS, props.item.aweme_id)
}

// 🎯 分享到 Telegram
// 🎯 修正 Bot 用户名（自动去掉 @）
const rawBotUsername = import.meta.env.VITE_TG_BOT_USERNAME || 'dydy'
const botUsername = rawBotUsername.replace('@', '')
const appName = import.meta.env.VITE_TG_APP_NAME || 'tgdouyin'

const videoDeepLink = computed(() => {
  const videoId = props.item?.aweme_id || ''
  let link = `https://t.me/${botUsername}/${appName}?startapp=video_${videoId}`
  // 🎯 加上邀请码后缀
  if (baseStore.userinfo?.numeric_id) {
    link += `_i${baseStore.userinfo.numeric_id}`
  }
  return link
})

// 1. 复制链接 (修改为 Inline Query 触发格式)
async function copyVideoLink() {
  const desc = (props.item?.desc || '精彩视频').trim()
  // 🎯 严格要求：前 15 个字，不要链接，不要省略号，用于触发 Inline Mode
  const queryText = desc.substring(0, 15)
  const copyText = `@dydy ${queryText}`
  _copy(copyText)
  _notice('搜索指令已复制，在聊天框粘贴即可搜索')
  showMoreDrawer.value = false
}

// 2. Telegram 直接分享
function shareToTelegramDirect() {
  const rid = props.item.aweme_id || props.item.id
  if (!rid) return

  const desc = props.item?.desc || '精彩视频'
  const link = videoDeepLink.value
  const text = `🎬 ${desc}\n\n来自 #TG抖音`

  // 🎯 改回标准分享协议，避免关闭 Mini App
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`

  // @ts-ignore
  if (window.Telegram?.WebApp) {
    // @ts-ignore
    window.Telegram.WebApp.openTelegramLink(shareUrl)
  } else {
    window.open(shareUrl, '_blank')
  }
  showMoreDrawer.value = false
}

// 🎯 更多选项抽屉
const showMoreDrawer = ref(false)

function openMoreDrawer() {
  showMoreDrawer.value = true
}

// 🎯 清屏功能 - 通过 emit 事件通知父组件
function toggleCleanScreen() {
  console.log('[ItemToolbar] toggleCleanScreen 被调用')
  console.log('[ItemToolbar] 准备 emit toggleCleanScreen 事件')
  emit('toggleCleanScreen')
  console.log('[ItemToolbar] emit toggleCleanScreen 事件已发出')
}

// 🎯 视频打赏
const showRewardPanel = ref(false)
function openRewardPanel() {
  showRewardPanel.value = true
}
const rewardAmount = ref('')
const rewardPresets = [10, 50, 100, 500]
const isRewarding = ref(false)

async function handleReward() {
  if (isRewarding.value) return
  const amount = Number(rewardAmount.value)
  if (!amount || amount <= 0) {
    _notice('请输入有效的金额')
    return
  }

  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) {
    _notice('请先登录')
    return
  }

  isRewarding.value = true
  try {
    // 🎯 优化：根据内容实际类型自动传递（后端目前统一用 video）
    const contentType = (props.item as any)?.content_type === 'video' ? 'video' : 'video'

    await sendReward({
      receiver_id: props.item.author?.user_id || props.item.author?.uid,
      gift_amount: amount,
      room_or_video_id: props.item.aweme_id,
      gift_type: contentType,
      gift_name: contentType === 'video' ? '视频打赏' : '图文打赏'
    })

    _notice(`成功打赏 ${amount} 抖币！`)
    showRewardPanel.value = false
    rewardAmount.value = ''
  } catch (e: any) {
    console.error('[Reward] error:', e)
    const msg = e.message || ''
    if (msg.includes('余额不足')) {
      _notice('抖币余额不足，请先充值')
    } else {
      _notice('打赏失败: ' + (msg || '网络繁忙'))
    }
  } finally {
    isRewarding.value = false
  }
}

function selectPreset(amount: number) {
  rewardAmount.value = amount.toString()
}

const vClick = useClick()
</script>

<template>
  <div class="toolbar mb1r">
    <div class="avatar-ctn mb2r">
      <img
        class="avatar"
        :src="item.author?.avatar_168x168?.url_list?.[0]"
        alt=""
        v-click="() => bus.emit(EVENT_KEY.GO_USERINFO)"
      />
      <transition name="fade">
        <div v-if="!item.isAttention" v-click="attention" class="options">
          <img class="no" src="../../assets/img/icon/add-light.png" alt="" />
          <img class="yes" src="../../assets/img/icon/ok-red.png" alt="" />
        </div>
      </transition>
    </div>
    <div class="love mb2r" v-click="loved">
      <div>
        <img src="../../assets/img/icon/love.svg" class="love-image" v-if="!item.isLoved" />
        <img src="../../assets/img/icon/loved.svg" class="love-image" v-if="item.isLoved" />
      </div>
      <span>{{ _formatNumber(item.statistics.digg_count) }}</span>
    </div>
    <div class="message mb2r" v-click="showComments">
      <Icon icon="mage:message-dots-round-fill" class="icon" style="color: white" />
      <span>{{ _formatNumber(item.statistics.comment_count) }}</span>
    </div>

      <!-- 清屏按钮 -->
      <div class="clean-screen mb2r" @click.stop="() => { console.log('[ItemToolbar] 清屏按钮被点击'); toggleCleanScreen() }">
        <Icon icon="mdi:broom" class="icon" style="color: white" />
        <span>清屏</span>
      </div>

    <!-- 打赏按钮（从抽屉中解放出来） -->
    <div class="reward mb2r" @click.stop="openRewardPanel">
      <Icon icon="basil:award-solid" class="icon" style="color: #face15" />
      <span>打赏</span>
    </div>

    <!-- 更多选项按钮 -->
    <div class="more-toggle mb2r" @click.stop="openMoreDrawer">
      <Icon icon="solar:menu-dots-bold" class="icon" style="color: white" />
      <span>更多</span>
    </div>

    <!-- 静音开关 -->
    <div class="mute-toggle mb2r" @click.stop="toggleMute">
      <Icon v-if="isMuted" icon="ph:speaker-simple-slash-fill" class="icon" style="color: white" />
      <Icon v-else icon="ph:speaker-simple-high-fill" class="icon" style="color: white" />
    </div>

    <!-- 更多选项抽屉 -->
    <teleport to="body">
      <transition name="slide-up">
        <div
          v-if="showMoreDrawer"
          class="global-drawer-overlay"
          @click.self="showMoreDrawer = false"
        >
          <div class="more-drawer">
            <div class="drawer-header">
              <span>更多选项</span>
              <Icon
                icon="solar:close-circle-bold"
                class="close-btn"
                @click="showMoreDrawer = false"
              />
            </div>

            <div class="action-grid">
              <!-- TG 直接分享 -->
              <div class="action-item" v-click="shareToTelegramDirect">
                <div class="icon-wrap" style="background: rgba(36, 161, 222, 0.2); color: #24a1de">
                  <Icon icon="logos:telegram" />
                </div>
                <span>TG 分享</span>
              </div>

              <!-- 复制链接 -->
              <div class="action-item" v-click="copyVideoLink">
                <div class="icon-wrap">
                  <Icon icon="solar:link-bold" />
                </div>
                <span>复制链接</span>
              </div>

              <!-- 收藏视频 -->
              <div class="action-item" v-click="collected">
                <div class="icon-wrap" :class="{ active: item.isCollect }">
                  <Icon :icon="item.isCollect ? 'solar:star-bold' : 'solar:star-outline'" />
                </div>
                <span>{{ item.isCollect ? '已收藏' : '收藏' }}</span>
              </div>
            </div>

            <!-- 倍速选择 -->
            <div class="speed-section">
              <div class="section-title">播放倍速 ({{ playbackRateText }})</div>
              <div class="speed-options">
                <div
                  v-for="r in speedOptions"
                  :key="r"
                  class="speed-btn"
                  :class="{ active: (injectedPlaybackRate?.value ?? 1) === r }"
                  @click.stop="choosePlaybackRate(r)"
                >
                  {{ r }}x
                </div>
              </div>
            </div>
          </div>
        </div>
      </transition>
    </teleport>

    <!-- 打赏面板弹窗 -->
    <teleport to="body">
      <transition name="fade">
        <div v-if="showRewardPanel" class="reward-overlay" @click.self="showRewardPanel = false">
          <div class="reward-panel" @click.stop>
            <div class="reward-title">打赏作者</div>
            <div class="reward-presets">
              <div
                v-for="p in rewardPresets"
                :key="p"
                class="preset-item"
                @click.stop="selectPreset(p)"
              >
                {{ p }}
              </div>
            </div>
            <div class="reward-input-wrap">
              <input
                type="number"
                v-model="rewardAmount"
                placeholder="自定义金额"
                class="reward-input"
                @click.stop
              />
              <div class="reward-send" :class="{ loading: isRewarding }" @click.stop="handleReward">
                {{ isRewarding ? '发送中...' : '确认打赏' }}
              </div>
            </div>
            <div class="reward-close" @click.stop="showRewardPanel = false">取消</div>
          </div>
        </div>
      </transition>
    </teleport>

  </div>
</template>

<style scoped lang="less">
.toolbar {
  //width: 40px;
  position: absolute;
  /* 🎯 针对安卓 Chrome 增加偏移，整体上移至 62rem（原为 52rem） */
  bottom: 62rem !important;
  right: 10rem;
  z-index: 1001;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: opacity 0.3s;

  // ✅ 全平台：更紧凑一点（A 档）
  .mb2r {
    margin-bottom: 14rem !important;
  }

  .avatar-ctn {
    position: relative;

    @w: 40rem;

    .avatar {
      width: @w;
      height: @w;
      border: 2rem solid white;
      border-radius: 50%;
    }

    .options {
      position: absolute;
      border-radius: 50%;
      margin: auto;
      left: 0;
      right: 0;
      bottom: -5px;
      background: red;
      //background: black;
      width: 18rem;
      height: 18rem;
      display: flex;
      justify-content: center;
      align-items: center;
      transition: all 1s;

      img {
        position: absolute;
        width: 14rem;
        height: 14rem;
        transition: all 1s;
      }

      .yes {
        opacity: 0;
        transform: rotate(-180deg);
      }

      &.attention {
        background: white;

        .no {
          opacity: 0;
          transform: rotate(180deg);
        }

        .yes {
          opacity: 1;
          transform: rotate(0deg);
        }
      }
    }
  }

  .love,
  .message,
  .share,
  .refresh,
  .clean-screen,
  .reward,
  .more-toggle,
  .mute-toggle {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;

    @width: 32rem;

    img {
      width: @width;
      height: @width;
    }

    span {
      font-size: 10rem;
      margin-top: 2rem;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    }
  }

  .icon {
    font-size: 32rem;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));

    &.refresh-anim {
      animation: refresh-rotate 0.8s linear infinite;
    }
  }

  @keyframes refresh-rotate {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .loved {
    background: red;
  }
}
</style>

<!-- 🎯 全局样式 (Teleport 后的元素需要非 scoped 样式) -->
<style lang="less">
.global-drawer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;

  .more-drawer {
    background: rgba(22, 24, 35, 0.98);
    backdrop-filter: blur(20px);
    border-top-left-radius: 16rem;
    border-top-right-radius: 16rem;
    padding: 20rem 20rem calc(20rem + var(--footer-height) + env(safe-area-inset-bottom));
    color: white;
    width: 100%;

    .drawer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 25rem;
      font-size: 16rem;
      font-weight: bold;

      .close-btn {
        font-size: 24rem;
        opacity: 0.5;
        cursor: pointer;
      }
    }

    .action-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20rem;
      margin-bottom: 30rem;

      .action-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8rem;
        cursor: pointer;

        .icon-wrap {
          width: 50rem;
          height: 50rem;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 12rem;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24rem;

          &.active {
            color: #face15;
            background: rgba(250, 206, 21, 0.15);
          }
        }

        span {
          font-size: 12rem;
          color: rgba(255, 255, 255, 0.7);
        }

        &:active {
          opacity: 0.7;
        }
      }
    }

    .speed-section {
      .section-title {
        font-size: 14rem;
        margin-bottom: 15rem;
        color: rgba(255, 255, 255, 0.6);
      }

      .speed-options {
        display: flex;
        gap: 10rem;
        flex-wrap: wrap;

        .speed-btn {
          padding: 8rem 16rem;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 8rem;
          font-size: 14rem;
          transition: all 0.2s;
          cursor: pointer;
          color: white;

          &.active {
            background: #fe2c55;
            color: white;
          }

          &:active {
            transform: scale(0.95);
          }
        }
      }
    }
  }
}

.reward-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;

  .reward-panel {
    background: #1e1e1e;
    border-radius: 20rem;
    padding: 24rem;
    width: 280rem;
    box-shadow: 0 10rem 30rem rgba(0, 0, 0, 0.5);

    .reward-title {
      font-size: 18rem;
      margin-bottom: 20rem;
      color: #face15;
      text-align: center;
      font-weight: bold;
    }

    .reward-presets {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12rem;
      margin-bottom: 20rem;

      .preset-item {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 10rem;
        padding: 12rem 0;
        text-align: center;
        font-size: 15rem;
        color: white;
        cursor: pointer;

        &:active {
          background: rgba(250, 206, 21, 0.2);
          border-color: #face15;
        }
      }
    }

    .reward-input-wrap {
      .reward-input {
        width: 100%;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 10rem;
        padding: 12rem;
        color: white;
        font-size: 16rem;
        text-align: center;
        margin-bottom: 15rem;
        outline: none;

        &:focus {
          border-color: #face15;
        }
      }

      .reward-send {
        background: #face15;
        color: black;
        border-radius: 10rem;
        padding: 12rem 0;
        text-align: center;
        font-size: 16rem;
        font-weight: bold;
        cursor: pointer;

        &.loading {
          opacity: 0.5;
        }
      }
    }

    .reward-close {
      margin-top: 15rem;
      text-align: center;
      color: rgba(255, 255, 255, 0.5);
      font-size: 14rem;
      cursor: pointer;
    }
  }
}

// 🎯 抽屉动画
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;

  .more-drawer {
    transform: translateY(100%);
  }
}

</style>
