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
                <template v-else-if="msg.type === 'gift'">
                  <span class="name">{{ msg.user_nickname }}</span>
                  <span class="gift-text">送出了 {{ msg.content }}</span>
                  <span class="combo-num" v-if="msg.combo > 1">x{{ msg.combo }}</span>
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

    <!-- 礼物面板 -->
    <Transition name="slide-up">
      <div v-if="showGiftPanel" class="gift-panel-overlay" @click.self="showGiftPanel = false">
        <div class="gift-panel">
          <div class="panel-header">
            <span>赠送礼物</span>
            <div class="coin-info">
              <img src="../../assets/img/icon/home/redpack.png" alt="" />
              <span>{{ userCoins }} 抖币</span>
              <div class="recharge">充值</div>
            </div>
          </div>
          <div class="gift-grid">
            <div
              v-for="gift in giftList"
              :key="gift.id"
              class="gift-item"
              :class="{ selected: selectedGiftId === gift.id }"
              @click="selectedGiftId = gift.id"
            >
              <img :src="gift.icon" alt="" />
              <div class="name">{{ gift.name }}</div>
              <div class="cost">{{ gift.cost }} 抖币</div>
            </div>
          </div>
          <div class="panel-footer">
            <div class="qty-selector">
              <div
                v-for="q in qtyOptions"
                :key="q"
                class="qty-item"
                :class="{ active: selectedQty === q }"
                @click="selectedQty = q"
              >
                {{ q }}
              </div>
              <input
                type="number"
                v-model.number="selectedQty"
                placeholder="数量"
                class="qty-input"
              />
            </div>
            <div
              class="send-btn"
              :class="{ disabled: !selectedGiftId || !selectedQty }"
              @click="handleSendGift"
            >
              发送
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, nextTick, watch, computed } from 'vue'
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

// --- 礼物相关 ---
const showGiftPanel = ref(false)
const selectedGiftId = ref<number | null>(null)
const selectedQty = ref(1)
const userCoins = ref(0) // 抖币余额

const qtyOptions = [1, 99, 520, 1314]

const giftList = [
  {
    id: 1,
    name: '小心心',
    cost: 1,
    icon: new URL('../../assets/img/icon/xiaoxinxin.svg', import.meta.url).href
  },
  {
    id: 2,
    name: '电棍',
    cost: 2,
    icon: new URL('../../assets/img/icon/diangun.svg', import.meta.url).href
  },
  {
    id: 3,
    name: '棒棒糖',
    cost: 5,
    icon: new URL('../../assets/img/icon/miao.svg', import.meta.url).href
  },
  {
    id: 4,
    name: '玫瑰花',
    cost: 10,
    icon: new URL('../../assets/img/icon/meigui.svg', import.meta.url).href
  },
  {
    id: 5,
    name: '我舔',
    cost: 20,
    icon: new URL('../../assets/img/icon/tian.svg', import.meta.url).href
  },
  {
    id: 6,
    name: '跳蛋',
    cost: 100,
    icon: new URL('../../assets/img/icon/tiaodan.svg', import.meta.url).href
  },
  {
    id: 7,
    name: '火箭',
    cost: 500,
    icon: new URL('../../assets/img/icon/huojian.svg', import.meta.url).href
  },
  {
    id: 8,
    name: '别墅',
    cost: 1000,
    icon: new URL('../../assets/img/icon/bieshu.svg', import.meta.url).href
  }
]

function sendGift() {
  showGiftPanel.value = true
}

async function handleSendGift() {
  if (!selectedGiftId.value || !selectedQty.value) return
  const gift = giftList.find((g) => g.id === selectedGiftId.value)
  if (!gift) return

  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) {
    alert('请先登录后再送礼物')
    return
  }

  try {
    await sendGiftMessage(user.id, gift, selectedQty.value)
    showGiftPanel.value = false
    selectedQty.value = 1
    selectedGiftId.value = null
  } catch (e: any) {
    console.error('[Gift] Send error:', e)
    alert('发送礼物失败: ' + e.message)
  }
}

async function sendGiftMessage(userId: string, gift: any, qty: number) {
  const { error } = await supabase.from('live_broadcast_messages').insert({
    room_id: roomId.value,
    user_id: userId,
    content: gift.name,
    msg_type: 'gift',
    payload: {
      gift_id: gift.id,
      gift_name: gift.name,
      gift_icon: gift.icon,
      amount: qty,
      combo: qty // 统一使用 combo 字段表示数量
    }
  })
  if (error) throw error
}

// --- 房间切换核心逻辑 ---
async function initRoom() {
  const currentId = route.query.id as string
  console.log('[LivePage] initRoom start', currentId)
  if (!currentId) return

  // 1. 先清理旧的订阅
  if (channel) {
    await supabase.removeChannel(channel)
    channel = null
  }

  // 2. 重置基础状态，强制销毁旧播放器
  roomInfo.value = { stream_url: null }
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

const sendGiftTemplate = (
  nickname: string,
  avatar: string,
  giftName: string,
  giftIcon: string,
  amount: number,
  bannerId: string
) => {
  const avatarUrl = _checkImgUrl(avatar) || fallbackAvatar
  return `
    <div class="send-gift" id="${bannerId}">
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
      <div class="right-count">
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

function triggerGiftAnim(
  nickname: string,
  avatar: string,
  giftName: string,
  giftIcon: string,
  amount: number,
  duration: number = 3
) {
  if (!page.value) return
  // 为每一个送礼动作生成一个完全唯一的 ID，强制触发进入动画
  const bannerId = `gift-banner-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

  const domPage = new Dom(page.value)
  const gift = new Dom().create(
    sendGiftTemplate(nickname, avatar, giftName, giftIcon, amount, bannerId)
  )

  // 设置动态显示时长
  gift.css('animation-duration', duration + 's')

  // 标记为活跃横幅
  gift.els[0].setAttribute('data-active', 'true')

  gift.on('animationend', () => {
    gift.els[0].removeAttribute('data-active')
    gift.remove()
  })

  // 计算位置，防止重叠
  // 起始位置调高（0.4vh），避开评论区
  const activeBanners = document.querySelectorAll('.send-gift[data-active="true"]')
  let top = document.body.clientHeight * 0.4

  if (activeBanners.length > 0) {
    // 找到最高的一个（top 值最小的）
    let minTop = top
    activeBanners.forEach((el: any) => {
      const t = parseInt(el.style.top) || el.offsetTop
      if (t > 0 && t < minTop) minTop = t
    })
    top = minTop - 75
  }

  // 防止堆叠太高，重置回初始位置
  if (top < document.body.clientHeight * 0.1) {
    top = document.body.clientHeight * 0.4
  }

  gift.css('top', top + 'px')
  domPage.append(gift)
}

function triggerLargeGiftEffect(
  giftName: string,
  giftIcon: string,
  nickname: string,
  duration: number = 3,
  titleIcon?: string
) {
  if (!page.value) return
  const domPage = new Dom(page.value)

  // ✅ 如果是 SVG 模式，只显示超大图形，隐藏文字和普通图标
  const contentHtml = titleIcon
    ? `<img src="${titleIcon}" class="large-gift-svg" alt="${giftName}">`
    : `
      <img src="${giftIcon}" class="large-gift-icon" alt="">
      <div class="gift-title">送出 ${giftName}</div>
      <div class="user-name">${nickname}</div>
    `

  const template = `
    <div class="large-gift-effect" style="animation-duration: ${duration}s">
      <div class="effect-content" style="animation-duration: ${duration}s">
        <div class="glow"></div>
        ${contentHtml}
      </div>
    </div>
  `
  const effect = new Dom().create(template)
  effect.on('animationend', () => effect.remove())
  domPage.append(effect)
}

// 获取直播间信息
async function fetchRoomInfo() {
  const currentRoomId = roomId.value
  console.log('[LivePage] fetchRoomInfo v2 start:', currentRoomId)

  try {
    const {
      data: { session }
    } = await supabase.auth.getSession()
    const headers: Record<string, string> = {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    }
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    }

    const resp = await fetch(`${getAppServerBase()}/live/detail?id=${currentRoomId}`, { headers })
    const payload = await resp.json()

    if (resp.ok && payload.code === 0) {
      const room = payload.data.room
      console.log('[LivePage] Room detail loaded:', room.title)
      roomInfo.value = {
        ...room,
        stream_url: buildPlayUrl(room.stream_url)
      }
      viewerCount.value = room.viewer_count || 0

      // 如果是自建直播，检查关注状态
      if (room.is_self_hosted && room.anchor_info?.id) {
        if (session?.user?.id) {
          // 检查关注
          const { data: follow } = await supabase
            .from('follows')
            .select('id')
            .eq('follower_id', session.user.id)
            .eq('followee_id', room.anchor_info.id)
            .maybeSingle()
          isFollowed.value = !!follow

          // 顺便获取个人抖币余额（暂时使用 balance_usdt 字段展示）
          const { data: profile } = await supabase
            .from('profiles')
            .select('balance_usdt')
            .eq('id', session.user.id)
            .single()
          if (profile) {
            userCoins.value = Math.floor(Number(profile.balance_usdt || 0))
          }
        }
      }
    } else {
      console.error('[LivePage] fetchRoomInfo failed:', payload.msg || resp.status)
    }
  } catch (e) {
    console.error('[LivePage] fetchRoomInfo error:', e)
  }
}

function getAppServerBase() {
  const explicit = import.meta.env.VITE_APP_SERVER_URL
  if (explicit) return explicit.replace(/\/$/, '')
  if (import.meta.env.DEV) return '/api/app-server'
  if (import.meta.env.VITE_SUPABASE_URL) {
    return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/app-server`
  }
  return ''
}

function buildPlayUrl(url: string) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw)
    // 只有抖音源且没有指定 stream 类型时，才默认加上 stream=hls
    if (
      u.pathname.includes('/douyin/') &&
      !u.searchParams.has('stream') &&
      !u.searchParams.has('media')
    ) {
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
  console.log('[LivePage] fetchHistoryMessages for room:', currentRoomId)

  const { data, error } = await supabase
    .from('live_broadcast_messages')
    .select('id, content, user_id, msg_type, payload, profiles!user_id(nickname)')
    .eq('room_id', currentRoomId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[LivePage] fetchHistoryMessages error:', error)
    // 如果还是报错，尝试不带 join 的查询作为兜底
    if (error.code === 'PGRST201' || error.status === 409) {
      const { data: fallbackData } = await supabase
        .from('live_broadcast_messages')
        .select('id, content, user_id, msg_type, payload')
        .eq('room_id', currentRoomId)
        .order('created_at', { ascending: false })
        .limit(20)

      if (fallbackData) {
        messages.value = fallbackData.reverse().map((m: any) => ({
          id: m.id,
          content: m.content,
          user_nickname: '用户',
          type: m.msg_type || 'chat',
          combo: m.payload?.combo || 1
        }))
        scrollToBottom()
      }
    }
    return
  }

  if (data) {
    messages.value = data.reverse().map((m: any) => ({
      id: m.id,
      content: m.content,
      user_nickname: m.profiles?.nickname || '路人',
      type: m.msg_type || 'chat',
      combo: m.payload?.combo || 1
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

const profileCache = new Map<string, { nickname: string; avatar_url: string }>()

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
        const isGift = payload.new.msg_type === 'gift'
        const giftPayload = payload.new.payload || {}

        // 无论是否是礼物，都先拉取用户信息（增加缓存防止卡顿）
        let profile = profileCache.get(payload.new.user_id)
        if (!profile) {
          const { data } = await supabase
            .from('profiles')
            .select('nickname, avatar_url')
            .eq('id', payload.new.user_id)
            .single()
          if (data) {
            profile = {
              nickname: data.nickname || '路人',
              avatar_url: data.avatar_url || ''
            }
            profileCache.set(payload.new.user_id, profile)
          }
        }

        const nickname = profile?.nickname || '路人'
        const avatar = profile?.avatar_url || ''

        if (isGift) {
          // 根据单次送礼的总价值计算停留时间
          const giftId = Number(giftPayload.gift_id)
          const gift = giftList.find((g) => g.id === giftId)
          const unitPrice = gift ? gift.cost : 0
          const totalValue = unitPrice * (giftPayload.amount || 1)

          let animDuration = 3 // 基础 3 秒
          if (totalValue >= 50) animDuration = 4
          if (totalValue >= 100) animDuration = 6
          if (totalValue >= 500) animDuration = 8
          if (totalValue >= 1000) animDuration = 12
          if (totalValue >= 3000) animDuration = 18 // 高价值大礼物停留更久

          // 1. 触发基础横幅动画
          triggerGiftAnim(
            nickname,
            avatar,
            giftPayload.gift_name || payload.new.content,
            giftPayload.gift_icon || '',
            giftPayload.combo || giftPayload.amount || 1,
            animDuration
          )

          // 2. 触发大礼物全屏特效 (如果是高价值礼物)
          if (totalValue >= 100 || [6, 7, 8].includes(giftId)) {
            const giftIcon = giftPayload.gift_icon || ''
            // 如果图标是 SVG，我们将其作为标题图展示（替换文字）
            const isSvg = giftIcon.toLowerCase().endsWith('.svg')

            triggerLargeGiftEffect(
              giftPayload.gift_name,
              giftIcon,
              nickname,
              animDuration,
              isSvg ? giftIcon : undefined
            )
          }
        }

        // 普通消息或新礼物消息添加
        const newMessage = {
          id: payload.new.id,
          content: payload.new.content,
          user_id: payload.new.user_id,
          user_nickname: nickname,
          type: payload.new.msg_type || 'chat',
          combo: giftPayload.combo || 1
        }

        messages.value.push(newMessage)
        if (messages.value.length > 100) messages.value.shift()
        scrollToBottom()
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
  left: 15rem;
  display: flex;
  align-items: center;
  z-index: 10000; /* 提高层级 */
  pointer-events: none;
  animation: send-gift-anim ease-out forwards;
  /* animation-duration 由 JS 动态控制 */

  @keyframes send-gift-anim {
    0% {
      opacity: 0;
      transform: translateX(-50rem);
    }
    3% {
      opacity: 1;
      transform: translateX(0);
    }
    97% {
      opacity: 1;
      transform: translateX(0);
    }
    100% {
      opacity: 0;
      transform: translateY(-30rem);
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

  .right-count {
    margin-left: 8rem;
    font-size: 28rem;
    color: #ffda00;
    font-weight: 900;
    font-style: italic;
    text-shadow: 2px 2px 0 #000;

    &.jump {
      animation: count-jump 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
  }

  @keyframes count-jump {
    0% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.4);
    }
    100% {
      transform: scale(1);
    }
  }
}

.large-gift-effect {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20000;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  animation-name: gift-bg-fade;
  animation-fill-mode: forwards;
  /* animation-duration 由 JS 动态控制 */

  .effect-content {
    text-align: center;
    animation-name: gift-content-zoom;
    animation-timing-function: cubic-bezier(0.175, 0.885, 0.32, 1.275);
    animation-fill-mode: forwards;
    /* animation-duration 由 JS 动态控制 */

    .glow {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 500rem;
      height: 500rem;
      background: radial-gradient(circle, rgba(254, 44, 85, 0.6) 0%, transparent 70%);
      animation: glow-rotate 3s linear infinite;
    }

    .large-gift-svg {
      width: 280rem; /* 放大 放大 */
      height: 280rem;
      object-fit: contain;
      margin-bottom: 20rem;
      position: relative;
      z-index: 1;
      filter: drop-shadow(0 0 20rem rgba(250, 206, 21, 0.8));
    }

    .large-gift-svg {
      width: 200rem; /* 缩小一倍，回到适中尺寸 */
      height: 200rem;
      object-fit: contain;
      position: relative;
      z-index: 1;
      filter: drop-shadow(0 0 20rem rgba(250, 206, 21, 0.8));
      animation: pulse-zoom 2s infinite ease-in-out;
    }

    @keyframes pulse-zoom {
      0% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.1);
      }
      100% {
        transform: scale(1);
      }
    }

    .large-gift-icon {
      width: 120rem;
      height: 120rem;
      object-fit: contain;
      margin-bottom: 20rem;
      position: relative;
      z-index: 1;
      filter: drop-shadow(0 0 15rem rgba(255, 255, 255, 0.5));
    }

    .gift-title-img {
      height: 80rem;
      object-fit: contain;
      margin-bottom: 15rem;
      filter: drop-shadow(0 0 15rem rgba(250, 206, 21, 0.6));
      position: relative;
      z-index: 1;
    }

    .gift-title {
      font-size: 40rem;
      font-weight: 900;
      color: #face15;
      text-shadow: 0 0 20rem rgba(250, 206, 21, 0.8);
      margin-bottom: 10rem;
    }

    .user-name {
      font-size: 20rem;
      color: white;
      font-weight: bold;
    }
  }
}

@keyframes gift-bg-fade {
  0% {
    background: transparent;
  }
  3% {
    background: rgba(0, 0, 0, 0.4);
  }
  97% {
    background: rgba(0, 0, 0, 0.4);
  }
  100% {
    background: transparent;
  }
}

@keyframes gift-content-zoom {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  3% {
    transform: scale(1);
    opacity: 1;
  }
  97% {
    transform: scale(1);
    opacity: 1;
  }
  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}

@keyframes glow-rotate {
  from {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

.user-joined {
  font-size: 12rem;
  position: absolute;
  top: 55vh; /* 继续调高，避开礼物区域 */
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

          &.gift {
            background: rgba(254, 44, 85, 0.15); // 透明红背景
            border: 1px solid rgba(254, 44, 85, 0.2);
            .name {
              color: #a2e9ff;
            }
            .gift-text {
              color: #fe2c55;
              font-weight: bold;
              margin-left: 5rem;
            }
            .combo-num {
              color: #face15;
              font-size: 16rem;
              font-weight: 900;
              font-style: italic;
              margin-left: 8rem;
              text-shadow: 0 0 5rem rgba(250, 206, 21, 0.5);
              animation: combo-pop 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
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

  // 礼物面板样式
  .gift-panel-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1001;
    background: rgba(0, 0, 0, 0.4);

    .gift-panel {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(22, 24, 35, 0.95);
      backdrop-filter: blur(10px);
      border-top-left-radius: 12rem;
      border-top-right-radius: 12rem;
      padding-bottom: env(safe-area-inset-bottom);

      .panel-header {
        padding: 15rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: white;
        font-size: 14rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);

        .coin-info {
          display: flex;
          align-items: center;
          gap: 5px;
          background: rgba(255, 255, 255, 0.1);
          padding: 4rem 10rem;
          border-radius: 15rem;

          img {
            width: 16rem;
            height: 16rem;
          }

          .recharge {
            color: #face15;
            margin-left: 5px;
            font-weight: bold;
          }
        }
      }

      .gift-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        padding: 10rem;
        gap: 10rem;
        max-height: 260rem;
        overflow-y: auto;

        .gift-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 10rem 5rem;
          border-radius: 8rem;
          transition: all 0.2s;
          border: 1px solid transparent;

          &.selected {
            background: rgba(254, 44, 85, 0.1);
            border-color: rgba(254, 44, 85, 0.5);
          }

          img {
            width: 45rem;
            height: 45rem;
            object-fit: contain;
            margin-bottom: 5px;
          }

          .name {
            color: white;
            font-size: 12rem;
            margin-bottom: 2px;
          }

          .cost {
            color: rgba(255, 255, 255, 0.5);
            font-size: 10rem;
          }
        }
      }

      .panel-footer {
        padding: 10rem 15rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10rem;

        .qty-selector {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 6rem;
          overflow-x: auto;
          padding-bottom: 5rem;

          &::-webkit-scrollbar {
            display: none;
          }

          .qty-item {
            background: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.8);
            padding: 4rem 10rem;
            border-radius: 12rem;
            font-size: 12rem;
            white-space: nowrap;
            border: 1px solid transparent;

            &.active {
              background: rgba(254, 44, 85, 0.2);
              color: #fe2c55;
              border-color: #fe2c55;
            }
          }

          .qty-input {
            width: 50rem;
            height: 24rem;
            background: rgba(255, 255, 255, 0.1);
            border: none;
            border-radius: 12rem;
            color: white;
            padding: 0 8rem;
            font-size: 12rem;
            outline: none;

            &::placeholder {
              color: rgba(255, 255, 255, 0.3);
            }
          }
        }

        .send-btn {
          background: var(--primary-btn-color);
          color: white;
          padding: 8rem 25rem;
          border-radius: 20rem;
          font-size: 14rem;
          font-weight: bold;
          flex-shrink: 0;

          &.disabled {
            opacity: 0.5;
            background: #666;
          }
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

  .slide-up-enter-active,
  .slide-up-leave-active {
    transition: all 0.3s ease;
  }
  .slide-up-enter-from,
  .slide-up-leave-to {
    opacity: 0;
    .gift-panel {
      transform: translateY(100%);
    }
  }
}

@keyframes pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes combo-pop {
  0% {
    transform: scale(0.5);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
