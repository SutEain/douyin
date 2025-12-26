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
          <div class="liver" v-if="route.query.type !== 'external'">
            <img
              class="avatar"
              :src="_checkImgUrl(roomInfo.anchor_info?.avatar_url) || fallbackAvatar"
              alt=""
            />
            <div class="desc-wrapper">
              <div class="name">{{ roomInfo.anchor_info?.nickname || '主播' }}</div>
              <div class="count">{{ viewerCount }} 人正在看</div>
            </div>
            <div class="follow-btn" @click="attention" :class="{ isFollowed }">
              {{ isFollowed ? '已关注' : '关注' }}
            </div>
          </div>
          <div class="liver external-label" v-else>
            <div class="desc-wrapper">
              <div class="name">正在转播中</div>
              <div class="count">{{ viewerCount }} 人正在看</div>
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
    <Transition name="fade">
      <div v-if="showInput" class="input-overlay" @click.self="showInput = false">
        <div class="input-container">
          <input
            v-model="inputText"
            ref="commentInput"
            placeholder="说点什么..."
            @keyup.enter="handleSendComment"
            @blur="showInput = false"
          />
          <div class="send-btn" @click="handleSendComment" :class="{ active: inputText.trim() }">
            发送
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { supabase } from '@/utils/supabase'
import { _checkImgUrl } from '@/utils'
import { toggleFollowUser } from '@/api/videos'
import DPPlayer from '@/components/live/DPPlayer.vue'
import Dom from '@/utils/dom'

const route = useRoute()
const roomId = computed(() => route.query.id as string)
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
const commentInput = ref<HTMLInputElement | null>(null) // 新增 Ref
const viewerCount = ref(0)
const viewers = ref<any[]>([]) // 存储前几名观众
const fallbackAvatar = new URL('../../assets/img/icon/avatar/0.png', import.meta.url).href

// --- 房间切换核心逻辑 ---
async function initRoom() {
  console.log('[LivePage] initRoom', roomId)
  // 1. 先清理旧的订阅
  if (channel) {
    await supabase.removeChannel(channel)
    channel = null
  }

  // 2. 重置基础状态，防止残影
  roomInfo.value = {}
  messages.value = []
  viewerCount.value = 0
  viewers.value = []

  // 3. 加载新数据
  await fetchRoomInfo()
  await fetchHistoryMessages()

  // 4. 开启新的订阅
  setupSubscription()
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
    nextTick(() => {
      commentInput.value?.focus()
    })
  }
})

// 展示观众列表
function showViewerList() {
  if (viewers.value.length === 0) return
  const names = viewers.value.map((v) => v.nickname).join('、')
  alert(`当前在线观众：\n${names}${viewerCount.value > 5 ? ` 等共 ${viewerCount.value} 人` : ''}`)
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

const sendGiftTemplate = (nickname: string, avatar: string, giftName: string, amount: number) => {
  const avatarUrl = _checkImgUrl(avatar) || fallbackAvatar
  const giftIcon = new URL('../../assets/img/icon/home/love.webp', import.meta.url).href
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
function triggerUserJoinedAnim(nickname: string, rank?: number) {
  if (!page.value) return
  const domPage = new Dom(page.value)
  const user = new Dom().create(userJoinedTemplate(nickname, rank))
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
  const currentRoomId = roomId.value
  const isExternal = route.query.type === 'external'

  if (isExternal) {
    const { data, error } = await supabase
      .from('live_rooms')
      .select('id, title, stream_url, cover_url')
      .eq('id', currentRoomId)
      .single()

    if (data) {
      roomInfo.value = {
        ...data,
        stream_url: buildPlayUrl(data.stream_url),
        anchor_info: null
      }
      viewerCount.value = Math.floor(Math.random() * 500) + 100 // 转播间随机人数
    }
    return
  }

  const { data, error } = await supabase
    .from('live_broadcast_rooms')
    .select(
      `
      id, title, viewer_count, stream_key,
      anchor:profiles(id, nickname, avatar_url),
      node:live_broadcast_nodes(domain_name)
    `
    )
    .eq('id', currentRoomId)
    .single()

  if (data) {
    const anchor = (Array.isArray(data.anchor) ? data.anchor[0] : data.anchor) as any
    const node = (Array.isArray(data.node) ? data.node[0] : data.node) as any

    roomInfo.value = {
      ...data,
      anchor_info: anchor,
      stream_url: `https://${node?.domain_name}/LiveApp/streams/${data.stream_key}.m3u8`,
      cover_url: anchor?.avatar_url
    }
    viewerCount.value = data.viewer_count || 0

    // 检查关注状态
    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (user && anchor?.id) {
      const { data: follow } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', user.id)
        .eq('followee_id', anchor.id)
        .maybeSingle()

      isFollowed.value = !!follow
    }
  }
}

function buildPlayUrl(url: string) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw)
    if (u.pathname.includes('/douyin/') && u.searchParams.get('stream') !== 'hls') {
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
  const { data } = await supabase
    .from('live_broadcast_messages')
    .select('id, content, user_id, msg_type, profiles(nickname)')
    .eq('room_id', currentRoomId)
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
    room_id: roomId.value,
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

  console.log('[LivePage] toggleFollow', { targetId, nextStatus })

  try {
    const res = await toggleFollowUser(targetId, nextStatus)
    console.log('[LivePage] toggleFollow success:', res)
    // res 是后端返回的 data: { follow: boolean, ... }
    if (res && typeof res.follow === 'boolean') {
      isFollowed.value = res.follow
    } else {
      // 兼容某些返回
      isFollowed.value = nextStatus
    }
  } catch (e: any) {
    console.error('关注操作失败:', e)
    // 如果是 500 错误，可能是后端问题
    alert('关注失败: ' + (e.message || '未知错误'))
  }
}

let channel: any = null

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
      // 提取所有在线连接
      const allPresences = Object.entries(state).flatMap(([key, presences]) => {
        return (presences as any[]).map((p) => ({ ...p, presence_key: key }))
      })

      // 更新总人数
      viewerCount.value = Math.max(allPresences.length, 1)

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
      // 1. 添加到列表
      messages.value.push({
        id: Date.now(),
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
            payload: { nickname, rank }
          })

          // 自己也显示进场动画
          triggerUserJoinedAnim(nickname, rank)
        }
      }
    })
}

onMounted(async () => {
  await initRoom()
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
  top: 62vh; /* 调高位置，使其悬浮在评论区上方 */
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
  height: 100vh;
  background: #000;
  color: white;
  position: fixed; /* 改为 fixed，防止键盘弹出时顶部被推走 */
  top: 0;
  left: 0;
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
}
</style>
