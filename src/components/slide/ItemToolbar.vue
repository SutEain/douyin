<script setup lang="ts">
import { _formatNumber, cloneDeep, _notice, _copy } from '@/utils'
import bus, { EVENT_KEY } from '@/utils/bus'
import { useClick } from '@/utils/hooks/useClick'
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
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
const showSpeedPanel = ref(false)
const speedOptions = [0.5, 1.0, 1.25, 1.5, 2.0]
const playbackRateText = computed(() => {
  const r = injectedPlaybackRate?.value ?? 1
  // 统一显示 1x / 1.25x
  return `${r}x`
})

function toggleSpeedPanel() {
  showSpeedPanel.value = !showSpeedPanel.value
}

function choosePlaybackRate(rate: number) {
  if (typeof injectedSetPlaybackRate === 'function') {
    injectedSetPlaybackRate(rate)
  } else {
    console.warn('[ItemToolbar] setPlaybackRate 未注入，无法设置倍速')
  }
  showSpeedPanel.value = false
}

// 🎯 切换到新视频时：重置倍速面板状态（倍速本身由播放器在切换时重置为 1.0）
watch(
  () => (props.item as any)?.aweme_id,
  (newId, oldId) => {
    if (newId && newId !== oldId) {
      showSpeedPanel.value = false
    }
  }
)

// 🎯 声音提示气泡
const showSoundTip = ref(false)

onMounted(() => {
  // 首次打开 App 时显示气泡提示
  if (!sessionStorage.getItem('sound-tip-shown')) {
    setTimeout(() => {
      showSoundTip.value = true
      sessionStorage.setItem('sound-tip-shown', '1')
      // 5秒后自动消失（原来是 2 秒）
      setTimeout(() => {
        showSoundTip.value = false
      }, 5000)
    }, 500)
  }
})

const emit = defineEmits(['update:item', 'goUserInfo', 'showComments', 'showShare', 'goMusic'])

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
function shareToTelegram() {
  if (!props.item?.aweme_id) {
    _notice('视频ID缺失，无法分享')
    return
  }

  const numericId = baseStore.userinfo?.numeric_id
  const inviteSuffix = numericId ? `_i${numericId}` : ''
  const startParam = `video_${props.item.aweme_id}${inviteSuffix}`

  const botUsername = 'tg_douyin_bot'
  const shareText = `@${botUsername} ${startParam}`

  // 🎯 直接复制指令
  _copy(shareText)
  _notice('分享指令已复制，去聊天框粘贴即可生成卡片～')
}

// 🎯 视频打赏
const showRewardPanel = ref(false)
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
    await sendReward({
      receiver_id: props.item.author?.user_id || props.item.author?.uid,
      gift_amount: amount,
      room_or_video_id: props.item.aweme_id,
      gift_type: 'video',
      gift_name: '视频打赏'
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
        v-click="
          () => {
            console.log('[ItemToolbar] 🖱️ 头像被点击了！')
            console.log('[ItemToolbar] 发送 GO_USERINFO 事件')
            bus.emit(EVENT_KEY.GO_USERINFO)
          }
        "
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
    <!--TODO     -->
    <div class="message mb2r" v-click="collected">
      <Icon
        v-if="item.isCollect"
        icon="ic:round-star"
        class="icon"
        style="color: rgb(252, 179, 3)"
      />
      <Icon v-else icon="ic:round-star" class="icon" style="color: white" />
      <span>{{ _formatNumber(item.statistics.collect_count) }}</span>
    </div>
    <!-- 🎯 视频打赏按钮 -->
    <div
      v-if="!props.isMy"
      class="message mb2r"
      v-click="() => (showRewardPanel = !showRewardPanel)"
    >
      <Icon icon="basil:award-solid" class="icon" style="color: #face15" />
      <span>打赏</span>

      <transition name="fade">
        <div v-if="showRewardPanel" class="reward-panel" @click.stop>
          <div class="reward-title">打赏作者</div>
          <div class="reward-presets">
            <div
              v-for="p in rewardPresets"
              :key="p"
              class="preset-item"
              v-click="() => selectPreset(p)"
            >
              {{ p }}
            </div>
          </div>
          <div class="reward-input-wrap">
            <input
              type="number"
              v-model="rewardAmount"
              placeholder="自定义打赏金额"
              class="reward-input"
              @click.stop
            />
            <div class="reward-send" :class="{ loading: isRewarding }" v-click="handleReward">
              {{ isRewarding ? '发送中...' : '确认打赏' }}
            </div>
          </div>
        </div>
      </transition>
    </div>

    <!-- 🎯 分享按钮 - 调起 Telegram 联系人选择器 -->
    <div v-if="!props.isMy" class="share mb2r" v-click="shareToTelegram">
      <img src="../../assets/img/icon/share-white-full.png" alt="" class="share-image" />
      <span>{{ _formatNumber(item.statistics.share_count) }}</span>
    </div>
    <!-- 自己的视频显示菜单图标（保留旧逻辑） -->
    <div v-else class="share mb2r" v-click="() => bus.emit(EVENT_KEY.SHOW_SHARE)">
      <img src="../../assets/img/icon/menu-white.png" alt="" class="share-image" />
    </div>

    <!-- 倍速开关 -->
    <div class="speed-toggle mb2r" v-click="toggleSpeedPanel">
      <Icon icon="mdi:speedometer" class="icon" style="color: white" />
      <div class="speed-text">{{ playbackRateText }}</div>

      <transition name="fade">
        <div v-if="showSpeedPanel" class="speed-panel" v-click.stop="() => {}">
          <div
            v-for="r in speedOptions"
            :key="r"
            class="speed-item"
            :class="{ active: (injectedPlaybackRate?.value ?? 1) === r }"
            v-click="() => choosePlaybackRate(r)"
          >
            {{ r }}x
          </div>
        </div>
      </transition>
    </div>

    <!-- 静音开关 -->
    <div class="mute-toggle mb2r" v-click="toggleMute" @click.stop>
      <Icon v-if="isMuted" icon="ph:speaker-simple-slash-fill" class="icon" style="color: white" />
      <Icon v-else icon="ph:speaker-simple-high-fill" class="icon" style="color: white" />

      <!-- 🎯 声音提示气泡 -->
      <transition name="bubble">
        <div v-if="showSoundTip" class="sound-tip-bubble" @click.stop="showSoundTip = false">
          <span>点这打开声音 🔊</span>
          <div class="bubble-arrow"></div>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped lang="less">
.toolbar {
  //width: 40px;
  position: absolute;
  bottom: 0;
  right: 10rem;
  z-index: 10;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;

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
  .share {
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
      font-size: 12rem;
    }
  }

  .icon {
    font-size: 36rem;
  }

  .loved {
    background: red;
  }

  // 🎯 静音开关容器
  .mute-toggle {
    position: relative;
  }

  // 🎯 倍速开关容器
  .speed-toggle {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;

    .speed-text {
      font-size: 11rem;
      margin-top: 2rem;
      color: rgba(255, 255, 255, 0.9);
    }

    .speed-panel {
      position: absolute;
      right: 50px;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      z-index: 120;
      min-width: 84px;
    }

    .speed-item {
      color: rgba(255, 255, 255, 0.9);
      font-size: 13px;
      padding: 6px 10px;
      border-radius: 8px;
      cursor: pointer;
      user-select: none;
    }
  }

  // 🎯 声音提示气泡
  .sound-tip-bubble {
    position: absolute;
    right: 50px;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(10px);
    padding: 8px 14px;
    border-radius: 20px;
    white-space: nowrap;
    pointer-events: none; // 不影响点击
    z-index: 100;

    span {
      color: white;
      font-size: 13px;
      font-weight: 500;
    }

    // 右侧箭头
    .bubble-arrow {
      position: absolute;
      right: -6px;
      top: 50%;
      transform: translateY(-50%);
      width: 0;
      height: 0;
      border-top: 6px solid transparent;
      border-bottom: 6px solid transparent;
      border-left: 6px solid rgba(0, 0, 0, 0.8);
    }
  }

  // 🎯 打赏面板
  .reward-panel {
    position: absolute;
    right: 50rem;
    bottom: 40rem; /* 向上移动，避开进度条 */
    background: rgba(0, 0, 0, 0.95);
    backdrop-filter: blur(15px);
    border-radius: 16rem;
    padding: 16rem;
    width: 180rem;
    z-index: 200;
    box-shadow: 0 8rem 24rem rgba(0, 0, 0, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.15);

    .reward-title {
      font-size: 14rem;
      margin-bottom: 12rem;
      color: #face15;
      text-align: center;
      font-weight: bold;
    }

    .reward-presets {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10rem;
      margin-bottom: 16rem;

      .preset-item {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 8rem;
        padding: 8rem 0;
        text-align: center;
        font-size: 13rem;
        color: white;
        transition: all 0.2s;

        &:active {
          background: #face15;
          color: black;
          transform: scale(0.95);
        }
      }
    }

    .reward-input-wrap {
      display: flex;
      flex-direction: column; /* 改为纵向，更清晰 */
      gap: 10rem;

      .reward-input {
        width: 100%;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8rem;
        padding: 10rem;
        color: #face15;
        font-size: 16rem;
        font-weight: bold;
        text-align: center;
        outline: none;

        &::placeholder {
          color: rgba(255, 255, 255, 0.3);
          font-weight: normal;
          font-size: 13rem;
        }

        &:focus {
          border-color: #face15;
          background: rgba(250, 206, 21, 0.05);
        }
      }

      .reward-send {
        background: #face15;
        color: black;
        border-radius: 8rem;
        padding: 10rem 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14rem;
        font-weight: bold;
        transition: opacity 0.2s;

        &:active {
          opacity: 0.8;
        }

        &.loading {
          opacity: 0.5;
          pointer-events: none;
        }
      }
    }
  }
}

// 🎯 气泡动画
.bubble-enter-active {
  animation: bubble-in 0.3s ease-out;
}
.bubble-leave-active {
  animation: bubble-out 0.3s ease-in;
}

@keyframes bubble-in {
  0% {
    opacity: 0;
    transform: translateY(-50%) translateX(10px) scale(0.8);
  }
  100% {
    opacity: 1;
    transform: translateY(-50%) translateX(0) scale(1);
  }
}

@keyframes bubble-out {
  0% {
    opacity: 1;
    transform: translateY(-50%) translateX(0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateY(-50%) translateX(10px) scale(0.8);
  }
}
</style>
