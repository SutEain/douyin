<template>
  <div class="LivePage" ref="page">
    <div class="live-wrapper" id="live-wrapper" v-love="'live-wrapper'">
      <DPPlayer
        v-if="roomInfo.stream_url"
        :src="roomInfo.stream_url"
        :poster="roomInfo.cover_url"
        :muted="false"
        :controls="false"
        @error="onPlayerError"
        @contextmenu.prevent
      />
      <div v-else class="loading-placeholder">
        <span>正在进入直播间...</span>
      </div>
    </div>

    <div class="float">
      <div class="top">
        <div class="left">
          <div class="liver">
            <img class="avatar" :src="_checkImgUrl(roomInfo.anchor_info?.avatar_url)" alt="" />
            <div class="desc">
              <div class="desc-wrapper">
                <div class="name">{{ roomInfo.anchor_info?.nickname || '主播' }}</div>
                <div class="count">{{ viewerCount }} 人正在看</div>
              </div>
              <div class="follow-btn" @click="attention" :class="{ isFollowed }">
                {{ isFollowed ? '已关注' : '关注' }}
              </div>
            </div>
          </div>
        </div>
        <div class="right">
          <div class="follower">
            <div class="round count">{{ viewerCount }}</div>
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
                  <span class="system-text">{{ msg.user_nickname }} {{ msg.content }}</span>
                </template>
                <template v-else>
                  <span class="name">{{ msg.user_nickname }}:</span>
                  <span class="text">{{ msg.content }}</span>
                </template>
              </div>
            </div>
          </div>
          <div class="options">
            <div class="input" @click="showInput = true">
              <span>说点什么...</span>
            </div>
            <img src="../../assets/img/icon/home/gift.webp" alt="" class="gift" @click="sendGift" />
          </div>
        </div>
      </div>
    </div>

    <!-- 弹出的输入框 -->
    <div v-if="showInput" class="input-overlay" @click.self="showInput = false">
      <div class="input-container">
        <input
          v-model="inputText"
          ref="commentInput"
          placeholder="说点什么..."
          @keyup.enter="handleSendComment"
        />
        <button @click="handleSendComment">发送</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { supabase } from '@/utils/supabase'
import { _checkImgUrl } from '@/utils'
import { toggleFollowUser } from '@/api/videos'
import DPPlayer from '@/components/live/DPPlayer.vue'
import Dom from '@/utils/dom'

const route = useRoute()
const roomId = route.query.id as string
const page = ref<HTMLElement | null>(null)

const state = reactive({
  muted: false
})

const roomInfo = ref<any>({})
const messages = ref<any[]>([])
const isFollowed = ref(false)
const showInput = ref(false)
const inputText = ref('')
const comments = ref<HTMLElement | null>(null)
const viewerCount = ref(0)

// --- 动画通知模板 ---
const userJoinedTemplate = (nickname: string) => {
  return `
    <div class="user-joined">
      <span class="name">${nickname}</span>
      <span class="text">加入了直播间</span>
    </div>
  `
}

const sendGiftTemplate = (nickname: string, avatar: string, giftName: string, amount: number) => {
  const avatarUrl = avatar || '/images/icon/avatar/1.png'
  const giftIcon = '/images/icon/love.webp'
  return `
    <div class="send-gift">
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
      <div class="right">
        x${amount}
      </div>
    </div>
  `
}

// --- 触发动画通知 ---
function triggerUserJoinedAnim(nickname: string) {
  if (!page.value) return
  const domPage = new Dom(page.value)
  const user = new Dom().create(userJoinedTemplate(nickname))
  user.on('animationend', () => user.remove())
  domPage.append(user)
}

function triggerGiftAnim(nickname: string, avatar: string, giftName: string, amount: number) {
  if (!page.value) return
  const domPage = new Dom(page.value)
  const gift = new Dom().create(sendGiftTemplate(nickname, avatar, giftName, amount))
  gift.on('animationend', () => gift.remove())

  // 简单计算位置，防止重叠
  const oldGifts = new Dom('.send-gift')
  let top = document.body.clientHeight * 0.6
  if (oldGifts.els.length !== 0) {
    top = gift.removePx(oldGifts.css('top')) - 70
  }
  if (top < 100) top = document.body.clientHeight * 0.6

  gift.css('top', top)
  domPage.append(gift)
}

// 获取直播间信息
async function fetchRoomInfo() {
  const { data, error } = await supabase
    .from('live_broadcast_rooms')
    .select(
      `
      id, title, viewer_count, stream_key,
      anchor:profiles(id, nickname, avatar_url),
      node:live_broadcast_nodes(domain_name)
    `
    )
    .eq('id', roomId)
    .single()

  if (data) {
    roomInfo.value = {
      ...data,
      anchor_info: data.anchor,
      stream_url: `https://${data.node?.domain_name}/LiveApp/streams/${data.stream_key}.m3u8`,
      cover_url: data.anchor?.avatar_url
    }
    viewerCount.value = data.viewer_count || 0

    // 检查关注状态
    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (user && data.anchor?.id) {
      const { data: follow } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', user.id)
        .eq('followee_id', data.anchor.id)
        .maybeSingle()

      isFollowed.value = !!follow
    }
  }
}

// 获取历史评论
async function fetchHistoryMessages() {
  const { data } = await supabase
    .from('live_broadcast_messages')
    .select('id, content, user_id, msg_type, profiles(nickname)')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (data) {
    messages.value = data.reverse().map((m: any) => ({
      id: m.id,
      content: m.content,
      user_nickname: m.profiles?.nickname,
      type: m.msg_type || 'chat'
    }))
    scrollToBottom()
  }
}

// 发送评论
async function handleSendComment() {
  if (!inputText.value.trim()) return

  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) return alert('请先登录')

  const { error } = await supabase.from('live_broadcast_messages').insert({
    room_id: roomId,
    user_id: user.id,
    content: inputText.value.trim()
  })

  if (!error) {
    inputText.value = ''
    showInput.value = false
  }
}

function sendGift() {
  alert('礼物系统正在升级中...')
  // 测试动画
  // triggerGiftAnim('测试用户', '', '爱心', 1)
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
  if (!roomInfo.value.anchor?.id) return

  const targetId = roomInfo.value.anchor.id
  const nextStatus = !isFollowed.value

  try {
    const res = await toggleFollowUser(targetId, nextStatus)
    if (res.success) {
      isFollowed.value = nextStatus
    }
  } catch (e) {
    console.error('关注操作失败:', e)
  }
}

let channel: any = null

onMounted(async () => {
  await fetchRoomInfo()
  await fetchHistoryMessages()

  // 订阅实时消息
  channel = supabase
    .channel(`live_room_${roomId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'live_broadcast_messages',
        filter: `room_id=eq.${roomId}`
      },
      async (payload) => {
        const { data: profile } = await supabase
          .from('profiles')
          .select('nickname, avatar_url')
          .eq('id', payload.new.user_id)
          .single()

        const nickname = profile?.nickname || '路人'
        const avatar = profile?.avatar_url || ''

        const newMessage = {
          id: payload.new.id,
          content: payload.new.content,
          user_nickname: nickname,
          type: payload.new.msg_type || 'chat'
        }

        messages.value.push(newMessage)
        if (messages.value.length > 100) messages.value.shift()
        scrollToBottom()

        // 如果是礼物消息，触发大动画
        if (payload.new.msg_type === 'gift') {
          triggerGiftAnim(nickname, avatar, payload.new.content, 1)
        }
      }
    )
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      const count = Object.keys(state).length
      viewerCount.value = Math.max(count, 1) // 至少显示1个人
    })
    .on('broadcast', { event: 'user_joined' }, (payload) => {
      const nickname = payload.payload.nickname || '路人'
      // 1. 添加到列表
      messages.value.push({
        id: Date.now(),
        user_nickname: nickname,
        content: '加入了直播间',
        type: 'system'
      })
      scrollToBottom()
      // 2. 触发抖音进场动画
      triggerUserJoinedAnim(nickname)
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        const {
          data: { user }
        } = await supabase.auth.getUser()
        if (user) {
          const { data: me } = await supabase
            .from('profiles')
            .select('nickname')
            .eq('id', user.id)
            .single()
          const nickname = me?.nickname || '路人'

          // 追踪 Presence
          channel.track({
            user_id: user.id,
            nickname: nickname
          })

          // 广播进入
          channel.send({
            type: 'broadcast',
            event: 'user_joined',
            payload: { nickname }
          })
        }
      }
    })
})

onBeforeUnmount(() => {
  if (channel) supabase.removeChannel(channel)
})
</script>

<style lang="less">
@import '../../assets/less/index';

/* 全局动画样式（不能加 scoped，因为是动态创建的 DOM） */
.send-gift {
  position: fixed;
  top: 63vh;
  left: 15rem;
  display: flex;
  align-items: flex-end;
  z-index: 10;
  pointer-events: none;
  animation: send-gift-anim 2.5s ease-out forwards;

  @keyframes send-gift-anim {
    0% {
      opacity: 0;
      transform: translateX(-100%);
    }
    15% {
      opacity: 1;
      transform: translateX(0);
    }
    85% {
      opacity: 1;
      transform: translateX(0);
    }
    100% {
      opacity: 0;
      transform: translateY(-50rem);
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

  .right {
    margin-left: 8rem;
    font-size: 28rem;
    color: #ffda00;
    font-weight: 900;
    font-style: italic;
    text-shadow: 2px 2px 0 #000;
  }
}

.user-joined {
  font-size: 12rem;
  position: absolute;
  top: 70vh;
  left: 15rem;
  padding: 5rem 12rem;
  border-radius: 20rem;
  background: linear-gradient(to right, rgba(115, 114, 181, 0.9), transparent);
  color: #a2e9ff;
  z-index: 9;
  pointer-events: none;
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

  .level {
    display: inline-block;
    .wrapper {
      display: flex;
      align-items: center;
      background: #8285b9;
      border-radius: 10rem;
      padding: 0 5rem;
      margin-right: 5rem;
      font-size: 10rem;
      img {
        width: 12rem;
        margin-right: 2rem;
      }
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
  height: 100vh;
  background: #000;
  color: white;
  position: relative;
  overflow: hidden;

  .live-wrapper {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
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
    padding: calc(10rem + env(safe-area-inset-top)) 15rem 20rem;
    box-sizing: border-box;

    .top {
      display: flex;
      justify-content: space-between;
      pointer-events: auto;

      .liver {
        background: rgba(0, 0, 0, 0.4);
        padding: 4rem 12rem 4rem 4rem;
        border-radius: 30rem;
        display: flex;
        align-items: center;
        gap: 8rem;

        .avatar {
          width: 32rem;
          height: 32rem;
          border-radius: 50%;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .desc-wrapper {
          .name {
            font-size: 13rem;
            font-weight: 600;
          }
          .count {
            font-size: 10rem;
            opacity: 0.7;
          }
        }

        .follow-btn {
          background: var(--primary-btn-color);
          padding: 4rem 12rem;
          border-radius: 20rem;
          font-size: 12rem;
          &.isFollowed {
            background: rgba(255, 255, 255, 0.2);
          }
        }
      }

      .right .follower {
        display: flex;
        align-items: center;
        gap: 10rem;
        .count {
          background: rgba(0, 0, 0, 0.4);
          padding: 4rem 10rem;
          border-radius: 20rem;
          font-size: 12rem;
        }
        .close {
          width: 24rem;
          height: 24rem;
          opacity: 0.8;
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
        }
      }

      .options {
        display: flex;
        align-items: center;
        gap: 15rem;
        margin-top: 10rem;

        .input {
          flex: 1;
          background: rgba(255, 255, 255, 0.2);
          padding: 8rem 15rem;
          border-radius: 25rem;
          font-size: 14rem;
          color: rgba(255, 255, 255, 0.6);
        }

        .gift {
          width: 36rem;
          height: 36rem;
        }
      }
    }
  }

  .input-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
    display: flex;
    align-items: flex-end;

    .input-container {
      width: 100%;
      background: #1e1e1e;
      padding: 15rem;
      display: flex;
      gap: 10rem;
      border-radius: 15rem 15rem 0 0;

      input {
        flex: 1;
        background: #333;
        border: none;
        padding: 10rem 15rem;
        border-radius: 20rem;
        color: white;
        outline: none;
      }

      button {
        background: var(--primary-btn-color);
        border: none;
        padding: 0 20rem;
        border-radius: 20rem;
        color: white;
        font-weight: 600;
      }
    }
  }
}
</style>
