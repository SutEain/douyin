<script setup lang="ts">
import { _formatNumber, cloneDeep, _notice } from '@/utils'
import bus, { EVENT_KEY } from '@/utils/bus'
import { useClick } from '@/utils/hooks/useClick'
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { toggleVideoLike, toggleVideoCollect, toggleFollowUser } from '@/api/videos'
import { useVideoStore } from '@/stores/video'

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

const vClick = useClick()
</script>

<template>
  <div class="toolbar mb1r">
    <div class="avatar-ctn mb2r">
      <img
        class="avatar"
        :src="item.author?.avatar_168x168?.url_list?.[0]"
        alt=""
        v-click="() => {
          console.log('[ItemToolbar] 🖱️ 头像被点击了！')
          console.log('[ItemToolbar] 发送 GO_USERINFO 事件')
          bus.emit(EVENT_KEY.GO_USERINFO)
        }"
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
    <div v-if="!props.isMy" class="share mb2r" v-click="() => bus.emit(EVENT_KEY.SHOW_SHARE)">
      <img src="../../assets/img/icon/share-white-full.png" alt="" class="share-image" />
      <span>{{ _formatNumber(item.statistics.share_count) }}</span>
    </div>
    <div v-else class="share mb2r" v-click="() => bus.emit(EVENT_KEY.SHOW_SHARE)">
      <img src="../../assets/img/icon/menu-white.png" alt="" class="share-image" />
    </div>
    
    <!-- 静音开关 -->
    <div class="mute-toggle mb2r" v-click="toggleMute" @click.stop>
      <Icon 
        v-if="isMuted" 
        icon="ph:speaker-simple-slash-fill" 
        class="icon"
        style="color: white"
      />
      <Icon 
        v-else 
        icon="ph:speaker-simple-high-fill" 
        class="icon"
        style="color: white"
      />
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

  .avatar-ctn {
    position: relative;

    @w: 45rem;

    .avatar {
      width: @w;
      height: @w;
      border: 3rem solid white;
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

    @width: 35rem;

    img {
      width: @width;
      height: @width;
    }

    span {
      font-size: 12rem;
    }
  }

  .icon {
    font-size: 40rem;
  }

  .loved {
    background: red;
  }
}
</style>
