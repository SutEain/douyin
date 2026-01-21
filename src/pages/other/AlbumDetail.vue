<template>
  <div class="goods-detail" @dragstart="(e) => _stopPropagation(e)">
    <div class="detail-container">
      <header class="detail-header">
        <Icon @click="close" icon="material-symbols-light:arrow-back-ios-new" />
      </header>

      <div class="scroll" ref="scrollEl">
        <div class="slide-imgs">
          <SlideHorizontal v-model:index="state.index">
            <SlideItem :key="i" v-for="(item, i) in props.detail.note_card?.image_list">
              <!-- 🎬 视频类型 -->
              <video
                v-if="item.type === 'video'"
                v-is-can-play="buildCdnUrl(item.info_list?.[0]?.url)"
                style="height: 100%; width: 100%; object-fit: contain"
                autoplay
                loop
                muted
                playsinline
                webkit-playsinline
                x5-playsinline
                x5-video-player-type="h5-page"
              />
              <!-- 🖼️ 图片类型 -->
              <img
                v-else
                :src="buildCdnUrl(item.info_list?.[0]?.url)"
                alt=""
                @error="handleImageError"
                style="background-color: #000; min-height: 100%; object-fit: contain"
              />
            </SlideItem>
          </SlideHorizontal>

          <div class="indicator-bar" v-if="props.detail.note_card?.image_list?.length > 1">
            <div
              class="indicator"
              :class="[i <= state.index + 1 && 'active']"
              :key="j"
              v-for="(i, j) in props.detail.note_card?.image_list?.length"
            ></div>
          </div>
        </div>

        <div class="content">
          <div class="shop">
            <header>
              <img class="avatar" :src="buildCdnUrl(props.detail.note_card?.user?.avatar)" />
              <div class="right">
                <div class="name">
                  {{
                    _truncate(
                      props.detail.note_card?.user?.nickname ||
                        props.detail.note_card?.user?.nick_name ||
                        props.detail.note_card?.user?.name ||
                        '用户',
                      15
                    )
                  }}
                </div>
                <div
                  class="r"
                  :style="local.followLoading ? 'pointer-events:none;opacity:.6;' : ''"
                  @click.stop="toggleFollow"
                >
                  {{ local.isAttention ? '取消关注' : '关注' }}
                </div>
              </div>
            </header>
            <div class="desc" style="white-space: pre-wrap">
              {{ props.detail.note_card?.display_title }}
            </div>
            <div class="date">{{ props.detail.note_card.createTime }}</div>
          </div>

          <div class="card comments">
            <header>
              <span class="l">评论 {{ displayCommentCount }}</span>
              <!-- ✅ 去掉右上角“查看全部” -->
            </header>
            <div v-if="comments.loading" class="loading">加载中...</div>
            <div v-else-if="!comments.list.length" class="empty">暂无评论，快来抢沙发～</div>

            <!-- ✅ 复用 CommentNew 的结构：主评论 + 回复 + 展开更多 + 评论点赞 -->
            <div v-else class="comment-items">
              <div
                v-for="(item, i) in comments.list"
                :key="item.comment_id || i"
                class="comment-item"
                :class="{ 'show-delete': showDeleteActionId === item.comment_id }"
                @touchstart="handleTouchStartLong(item)"
                @touchend="handleTouchEndLong"
                @mousedown="handleTouchStartLong(item)"
                @mouseup="handleTouchEndLong"
              >
                <div class="comment-main">
                  <img
                    :src="buildCdnUrl(item.avatar)"
                    class="avatar"
                    @click="handleAvatarClick(item)"
                  />
                  <div class="comment-body">
                    <div class="username" @click="handleAvatarClick(item)">
                      {{ _truncate(item.nickname, 15) }}
                    </div>
                    <div class="comment-text" :class="{ 'text-gray': item.user_buried }">
                      {{ item.user_buried ? '该评论已折叠' : item.content }}
                    </div>
                    <div class="comment-footer">
                      <div class="footer-left">
                        <span class="time">{{ _time(item.create_time) }}</span>
                        <span v-if="item.ip_location" class="location">{{ item.ip_location }}</span>
                        <span class="reply-btn" @click="handleReply(item)">回复</span>
                      </div>
                      <div class="footer-right">
                        <div
                          class="action-btn"
                          :class="{ active: item.user_digged }"
                          @click="handleCommentLike(item)"
                        >
                          <Icon
                            :icon="
                              item.user_digged ? 'icon-park-solid:like' : 'icon-park-outline:like'
                            "
                          />
                          <span v-if="item.digg_count">{{ _formatNumber(item.digg_count) }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 删除操作按钮 -->
                <div
                  v-if="showDeleteActionId === item.comment_id"
                  class="delete-overlay"
                  @click.stop="handleDeleteComment(item)"
                >
                  <div class="delete-btn">删除</div>
                  <div class="cancel-delete" @click.stop="showDeleteActionId = null">取消</div>
                </div>

                <div v-if="item.showChildren && item.children?.length" class="reply-list">
                  <div
                    v-for="(child, j) in item.children"
                    :key="child.comment_id || j"
                    class="reply-item"
                    :class="{ 'show-delete': showDeleteActionId === child.comment_id }"
                    @touchstart="handleTouchStartLong(child)"
                    @touchend="handleTouchEndLong"
                    @mousedown="handleTouchStartLong(child)"
                    @mouseup="handleTouchEndLong"
                  >
                    <img
                      :src="buildCdnUrl(child.avatar)"
                      class="avatar"
                      @click="handleAvatarClick(child)"
                    />
                    <div class="reply-body">
                      <div class="username" @click="handleAvatarClick(child)">
                        {{ _truncate(child.nickname, 15) }}
                      </div>
                      <div class="reply-text">
                        <span v-if="child.reply_to_user" class="reply-to"
                          >回复 @{{ _truncate(child.reply_to_user, 15) }}：</span
                        >
                        {{ child.content }}
                      </div>
                      <div class="reply-footer">
                        <div class="footer-left">
                          <span class="time">{{ _time(child.create_time) }}</span>
                          <span v-if="child.ip_location" class="location">{{
                            child.ip_location
                          }}</span>
                          <span class="reply-btn" @click="handleReply(item)">回复</span>
                        </div>
                        <div class="footer-right">
                          <div
                            class="action-btn"
                            :class="{ active: child.user_digged }"
                            @click="handleCommentLike(child)"
                          >
                            <Icon
                              :icon="
                                child.user_digged ? 'icon-park-solid:like' : 'icon-park-outline:like'
                              "
                            />
                            <span v-if="child.digg_count">{{ _formatNumber(child.digg_count) }}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- 删除操作按钮 (回复) -->
                    <div
                      v-if="showDeleteActionId === child.comment_id"
                      class="delete-overlay"
                      @click.stop="handleDeleteComment(child)"
                    >
                      <div class="delete-btn">删除</div>
                      <div class="cancel-delete" @click.stop="showDeleteActionId = null">取消</div>
                    </div>
                  </div>
                </div>

                <div
                  v-if="
                    Number(item.sub_comment_count) &&
                    (!item.showChildren || item.children.length < item.sub_comment_count)
                  "
                  class="expand-replies"
                  @click="handleExpandReplies(item)"
                >
                  <div class="expand-line"></div>
                  <span class="expand-text">
                    展开{{ item.showChildren ? '更多' : `${item.sub_comment_count}条` }}回复
                  </span>
                  <Icon icon="ep:arrow-down-bold" />
                </div>
              </div>

              <div v-if="comments.loadingMore" class="loading-more">加载中...</div>
              <div v-else-if="comments.hasMore" class="load-more" @click.stop="loadMoreComments">
                加载更多
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="detail-footer">
        <div v-if="replyingTo" class="reply-hint-bar">
          <span>回复 @{{ _truncate(replyingTo.nickname, 15) }}</span>
          <Icon icon="ic:round-close" class="close" @click.stop="cancelReply" />
        </div>
        <div class="toolbar">
          <div class="input-wrap">
            <input
              v-model="comments.input"
              class="comment-input"
              type="text"
              :placeholder="replyingTo ? `回复 @${_truncate(replyingTo.nickname, 15)}` : '说点什么...'"
              @keyup.enter="sendComment"
            />
          </div>

          <!-- ✅ 只有输入内容时才显示发送按钮，平时隐藏以腾出空间 -->
          <transition name="fade">
            <div
              v-if="comments.input.trim()"
              class="send-btn active"
              :style="comments.sending ? 'pointer-events:none;opacity:.6;' : ''"
              @click.stop="sendComment"
            >
              发送
            </div>
          </transition>

          <div class="options">
            <div
              class="option"
              :class="[local.isLoved && 'active']"
              :style="local.likeLoading ? 'pointer-events:none;opacity:.6;' : ''"
              @click.stop="toggleLike"
            >
              <Icon :icon="local.isLoved ? 'solar:heart-bold' : 'solar:heart-linear'" />
              <div class="text">{{ _formatNumber(local.likeCount) }}</div>
            </div>

            <div
              class="option"
              :class="[local.isCollect && 'active']"
              :style="local.collectLoading ? 'pointer-events:none;opacity:.6;' : ''"
              @click.stop="toggleCollect"
            >
              <Icon :icon="local.isCollect ? 'solar:star-bold' : 'mage:star'" />
              <div class="text">{{ _formatNumber(local.collectCount) }}</div>
            </div>

            <div class="option" @click.stop="showShareDrawer = true">
              <Icon icon="ph:share-fat-light" />
              <div class="text">{{ _formatNumber(local.shareCount) }}</div>
            </div>

            <!-- 🎯 打赏 -->
            <div class="option reward" @click.stop="showRewardPanel = true">
              <Icon icon="basil:award-solid" style="color: #face15" />
              <div class="text">打赏</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 🎯 打赏面板弹窗 (Teleport 到 body 避免层级问题) -->
    <teleport to="body">
      <transition name="fade">
        <div v-if="showRewardPanel" class="reward-overlay" @click.self="showRewardPanel = false">
          <div class="reward-panel" @click.stop>
            <div class="reward-title">打赏作者</div>
            <div class="reward-presets">
              <div v-for="p in rewardPresets" :key="p" class="preset-item" @click="selectPreset(p)">
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
              <div class="reward-send" :class="{ loading: isRewarding }" @click="handleReward">
                {{ isRewarding ? '发送中...' : '确认打赏' }}
              </div>
            </div>
            <div class="reward-close" @click="showRewardPanel = false">取消</div>
          </div>
        </div>
      </transition>
    </teleport>

    <!-- 🎯 分享抽屉 -->
    <teleport to="body">
      <transition name="slide-up">
        <div v-if="showShareDrawer" class="reward-overlay" @click.self="showShareDrawer = false">
          <div class="reward-panel share-drawer">
            <div class="reward-title" style="color: white; font-size: 16rem">分享给好友</div>
            <div class="share-grid">
              <div class="share-item" @click="shareAlbumDirect">
                <div class="icon-wrap tg">
                  <Icon icon="logos:telegram" />
                </div>
                <span>TG 分享</span>
              </div>
              <div class="share-item" @click="copyAlbumLink">
                <div class="icon-wrap link">
                  <Icon icon="solar:link-bold" />
                </div>
                <span>复制链接</span>
              </div>
            </div>
            <div class="reward-close" @click="showShareDrawer = false">取消</div>
          </div>
        </div>
      </transition>
    </teleport>
  </div>
</template>

<script setup>
import SlideHorizontal from '@/components/slide/SlideHorizontal.vue'
import SlideItem from '@/components/slide/SlideItem.vue'
import Hls from 'hls.js'
import { computed, onMounted, reactive, ref, watch, onUnmounted } from 'vue'
import {
  _copy,
  _formatNumber,
  _notice,
  _stopPropagation,
  cloneDeep,
  _time,
  _truncate
} from '@/utils'
import { buildCdnUrl } from '@/utils/media'
import {
  getCommentReplies,
  sendVideoComment,
  toggleCommentLike,
  toggleFollowUser,
  toggleVideoCollect,
  toggleVideoLike,
  videoComments,
  deleteVideoComment,
  sendReward
} from '@/api/videos'
import { useRouter } from 'vue-router'
import { useBaseStore } from '@/store/pinia'

const baseStore = useBaseStore()
const router = useRouter()

defineOptions({
  name: 'Album-Detail'
})

const props = defineProps({
  detail: {
    type: Object,
    default() {
      return {}
    }
  }
})

const emit = defineEmits({
  close: [],
  update: [Object]
})

const scrollEl = ref()
const state = reactive({
  index: 0
})

const hlsInstances = new Map()
const vIsCanPlay = {
  mounted(el, binding) {
    const url = binding.value
    if (!url) return
    if (url.includes('.m3u8')) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          capLevelToPlayerSize: true,
          autoStartLoad: true
        })
        hls.loadSource(url)
        hls.attachMedia(el)
        hlsInstances.set(el, hls)
      } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
        el.src = url
      }
    } else {
      el.src = url
    }
    el.play().catch(() => {})
  },
  unmounted(el) {
    const hls = hlsInstances.get(el)
    if (hls) {
      hls.destroy()
      hlsInstances.delete(el)
    }
  }
}

const commentList = computed(() => {
  const list = props.detail?.note_card?.comment_list
  return Array.isArray(list) ? list : []
})

const commentCount = computed(() => commentList.value.length)

const displayCommentCount = computed(() => {
  // 优先显示接口 total；其次显示已加载数量；否则用接口返回的 comment_count；否则 fallback
  if (comments.total) return comments.total
  if (comments.list.length) return comments.list.length
  const n = props.detail?.note_card?.interact_info?.comment_count
  if (typeof n === 'number') return n
  return commentCount.value
})

const currentId = computed(() => {
  return props.detail?.note_card?.aweme_id || props.detail?.id || props.detail?.note_card?.id || ''
})

const authorId = computed(() => {
  return props.detail?.note_card?.user?.id || props.detail?.author?.user_id || null
})

const local = reactive({
  isLoved: false,
  isCollect: false,
  isAttention: false,
  likeCount: 0,
  collectCount: 0,
  shareCount: 0,
  likeLoading: false,
  collectLoading: false,
  followLoading: false
})

const comments = reactive({
  list: [],
  loading: false,
  loadingMore: false,
  hasMore: false,
  total: 0,
  pageNo: 0,
  pageSize: 20,
  input: '',
  sending: false
})

const replyingTo = ref(null)

// 🎯 打赏相关
const showRewardPanel = ref(false)
const rewardAmount = ref('')
const rewardPresets = [10, 50, 100, 500]
const isRewarding = ref(false)

// 🎯 图片加载错误处理
function handleImageError(event) {
  const img = event.target
  if (img) {
    // 如果图片加载失败，隐藏图片或显示占位符
    img.style.display = 'none'
  }
}

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
    const id = String(currentId.value || '')
    await sendReward({
      receiver_id:
        props.detail.author?.user_id ||
        props.detail.author?.uid ||
        props.detail.note_card?.user?.id,
      gift_amount: amount,
      room_or_video_id: id,
      gift_type: 'video', // 后端目前短视频和图文统一归类为 video
      gift_name: '图文打赏'
    })

    _notice(`成功打赏 ${amount} 抖币！`)
    showRewardPanel.value = false
    rewardAmount.value = ''
  } catch (e) {
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

function selectPreset(amount) {
  rewardAmount.value = amount.toString()
}

// 🎯 长按删除和点击头像逻辑
const longPressTimer = ref(null)
const showDeleteActionId = ref(null)

const currentUserUid = computed(() => baseStore.userinfo.uid)
const videoAuthorUid = computed(() => authorId.value)

const handleAvatarClick = (item) => {
  const userId = item.user_id
  if (!userId) return
  router.push({
    name: 'user-page',
    params: { id: userId }
  })
}

const handleTouchStartLong = (item) => {
  const isAuthor = videoAuthorUid.value === currentUserUid.value
  const isMyComment = item.user_id === currentUserUid.value
  if (!isAuthor && !isMyComment) return

  longPressTimer.value = setTimeout(() => {
    showDeleteActionId.value = item.comment_id
    if (window.navigator?.vibrate) window.navigator.vibrate(50)
  }, 600)
}

const handleTouchEndLong = () => {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value)
    longPressTimer.value = null
  }
}

const handleDeleteComment = async (item) => {
  const confirmDelete = window.confirm('确认删除这条评论吗？')
  if (!confirmDelete) {
    showDeleteActionId.value = null
    return
  }

  try {
    await deleteVideoComment(item.comment_id)
    _notice('评论已删除')

    const index = comments.list.findIndex((c) => c.comment_id === item.comment_id)
    if (index !== -1) {
      comments.list.splice(index, 1)
      comments.total--
    } else {
      for (const parent of comments.list) {
        if (parent.children) {
          const childIndex = parent.children.findIndex((c) => c.comment_id === item.comment_id)
          if (childIndex !== -1) {
            parent.children.splice(childIndex, 1)
            parent.sub_comment_count = Math.max(0, (parent.sub_comment_count || 0) - 1)
            break
          }
        }
      }
    }
  } catch (error) {
    _notice(error?.message || '删除失败')
  } finally {
    showDeleteActionId.value = null
  }
}

watch(
  () => props.detail,
  (d) => {
    const interact = d?.note_card?.interact_info || {}
    local.likeCount = Number(interact?.liked_count ?? 0) || 0
    local.collectCount = Number(interact?.collect_count ?? 0) || 0
    local.shareCount = Number(interact?.share_count ?? 0) || 0
    local.isLoved = !!(d?.isLoved ?? d?.note_card?.isLoved ?? d?.note_card?.interact_info?.isLoved)
    local.isCollect = !!(
      d?.isCollect ??
      d?.note_card?.isCollect ??
      d?.note_card?.interact_info?.isCollect
    )
    local.isAttention = !!(d?.isAttention ?? d?.note_card?.isAttention ?? d?.is_attention)

    // 切换作品时重置评论并重新拉取
    comments.list = []
    comments.pageNo = 0
    comments.hasMore = false
    if (currentId.value) {
      loadComments(true)
    }
  },
  { immediate: true, deep: true }
)

onMounted(() => {
  if (currentId.value) {
    loadComments(true)
  }
})

async function toggleFollow() {
  if (local.followLoading) return
  const targetId = authorId.value
  if (!targetId) {
    _notice('作者ID缺失，无法关注')
    return
  }
  const next = !local.isAttention
  const previous = local.isAttention
  local.isAttention = next
  local.followLoading = true
  console.log('[AlbumDetail] toggleFollow:', { targetId, next })
  emitDetailUpdate()
  try {
    await toggleFollowUser(targetId, next)
  } catch (error) {
    local.isAttention = previous
    _notice(error?.message || '操作失败')
    emitDetailUpdate()
  } finally {
    local.followLoading = false
  }
}

function emitDetailUpdate() {
  const id = String(currentId.value || '')
  if (!id) return
  const patch = {
    id,
    isLoved: !!local.isLoved,
    isCollect: !!local.isCollect,
    isAttention: !!local.isAttention,
    note_card: {
      aweme_id: id,
      interact_info: {
        liked_count: Number(local.likeCount ?? 0) || 0,
        collect_count: Number(local.collectCount ?? 0) || 0,
        share_count: Number(local.shareCount ?? 0) || 0
      }
    }
  }
  console.log('[AlbumDetail] emit update:', patch)
  emit('update', patch)
}

async function loadComments(reset = false) {
  const id = String(currentId.value || '')
  if (!id) return
  if (reset) {
    comments.loading = true
    comments.pageNo = 0
  } else {
    comments.loadingMore = true
  }

  try {
    const res = await videoComments({
      videoId: id,
      pageNo: comments.pageNo,
      pageSize: comments.pageSize
    })
    if (!res?.success) {
      throw new Error(res?.message || '加载失败')
    }
    const data = res.data || {}
    const nextListRaw = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : []
    const nextList = nextListRaw.map((v) => ({
      ...v,
      showChildren: !!(v.showChildren || (v.children && v.children.length)),
      user_buried: false,
      user_digged: !!v.user_digged,
      children: Array.isArray(v.children)
        ? v.children.map((c) => ({ ...c, user_digged: !!c.user_digged }))
        : [],
      digg_count: Number(v.digg_count ?? 0),
      sub_comment_count: Number(v.sub_comment_count ?? 0),
      __fullRepliesLoaded: false
    }))
    if (reset) {
      comments.list = nextList
    } else {
      comments.list = [...comments.list, ...nextList]
    }

    comments.total = Number(data?.total ?? comments.total ?? 0) || 0
    comments.hasMore = comments.total
      ? comments.list.length < comments.total
      : nextList.length >= comments.pageSize
    comments.pageNo = comments.pageNo + 1
  } catch (error) {
    console.error('[AlbumDetail] loadComments failed:', error)
    _notice(error?.message || '加载评论失败')
  } finally {
    comments.loading = false
    comments.loadingMore = false
  }
}

function loadMoreComments() {
  if (comments.loadingMore || comments.loading) return
  loadComments(false)
}

async function sendComment() {
  const id = String(currentId.value || '')
  if (!id) {
    _notice('作品ID缺失，无法评论')
    return
  }
  const content = String(comments.input || '').trim()
  if (!content) return
  if (comments.sending) return
  comments.sending = true
  console.log('[AlbumDetail] sendComment:', { videoId: id, length: content.length })
  try {
    const replyToId = replyingTo.value?.comment_id || null
    const result = await sendVideoComment(id, content, replyToId)
    const formatted = {
      ...result,
      showChildren: false,
      user_digged: false,
      user_buried: false,
      children: []
    }

    if (replyToId && replyingTo.value) {
      const parent = comments.list.find((c) => c.comment_id === replyToId)
      if (parent) {
        parent.sub_comment_count = (parent.sub_comment_count || 0) + 1
        parent.showChildren = true
        formatted.reply_to_user = replyingTo.value.nickname
        // 默认只展示 1 条回复；如果已展开完整回复，则直接插入到列表
        if (parent.__fullRepliesLoaded) {
          parent.children = [formatted, ...(parent.children || [])]
        } else {
          parent.children = [formatted]
        }
      }
    } else {
      comments.list.unshift(formatted)
      comments.total = (comments.total || 0) + 1
    }

    comments.input = ''
    replyingTo.value = null

    emit('update', {
      id,
      note_card: {
        aweme_id: id,
        interact_info: { comment_count: comments.total || comments.list.length }
      }
    })
  } catch (error) {
    _notice(error?.message || '发送失败')
  } finally {
    comments.sending = false
  }
}

function handleReply(item) {
  replyingTo.value = item
}

function cancelReply() {
  replyingTo.value = null
  comments.input = ''
}

async function handleCommentLike(item) {
  const newLikedState = !item.user_digged
  const oldLikedState = item.user_digged
  const oldCount = Number(item.digg_count ?? 0)

  item.user_digged = newLikedState
  item.digg_count = newLikedState ? oldCount + 1 : Math.max(0, oldCount - 1)

  try {
    const result = await toggleCommentLike(item.comment_id, newLikedState)
    item.digg_count = result?.like_count ?? item.digg_count
  } catch (error) {
    item.user_digged = oldLikedState
    item.digg_count = oldCount
    _notice(error?.message || '操作失败')
  }
}

async function handleExpandReplies(item) {
  if (item.__fullRepliesLoaded) {
    item.showChildren = true
    return
  }
  try {
    const res = await getCommentReplies(item.comment_id)
    if (res.success) {
      item.children = (res.data || []).map((v) => ({
        ...v,
        user_digged: false,
        user_buried: false
      }))
      item.showChildren = true
      item.__fullRepliesLoaded = true
    } else {
      _notice(res.message || '加载回复失败')
    }
  } catch (error) {
    _notice(error?.message || '加载回复失败')
  }
}

async function toggleLike() {
  if (local.likeLoading) return
  const id = String(currentId.value || '')
  if (!id) {
    _notice('作品ID缺失，无法点赞')
    return
  }

  const previous = cloneDeep(local)
  const next = !local.isLoved
  local.isLoved = next
  local.likeCount = Math.max(0, (local.likeCount ?? 0) + (next ? 1 : -1))
  emitDetailUpdate()
  local.likeLoading = true
  try {
    const res = await toggleVideoLike(id, next)
    if (typeof res?.like_count === 'number') {
      local.likeCount = res.like_count
      emitDetailUpdate()
    }
  } catch (error) {
    Object.assign(local, previous)
    _notice(error?.message || '操作失败')
    emitDetailUpdate()
  } finally {
    local.likeLoading = false
  }
}

async function toggleCollect() {
  if (local.collectLoading) return
  const id = String(currentId.value || '')
  if (!id) {
    _notice('作品ID缺失，无法收藏')
    return
  }

  const previous = cloneDeep(local)
  const next = !local.isCollect
  local.isCollect = next
  local.collectCount = Math.max(0, (local.collectCount ?? 0) + (next ? 1 : -1))
  emitDetailUpdate()
  local.collectLoading = true
  try {
    const res = await toggleVideoCollect(id, next)
    if (typeof res?.collect_count === 'number') {
      local.collectCount = res.collect_count
      emitDetailUpdate()
    }
  } catch (error) {
    Object.assign(local, previous)
    _notice(error?.message || '操作失败')
    emitDetailUpdate()
  } finally {
    local.collectLoading = false
  }
}

// --- 分享相关 ---
const showShareDrawer = ref(false)
const rawBotUsername = import.meta.env.VITE_TG_BOT_USERNAME || 'dydy'
const botUsername = rawBotUsername.replace('@', '')
const appName = import.meta.env.VITE_TG_APP_NAME || 'tgdouyin'

const albumDeepLink = computed(() => {
  const id = String(currentId.value || '')
  if (!id) return ''
  let link = `https://t.me/${botUsername}/${appName}?startapp=video_${id}`
  if (baseStore.userinfo?.numeric_id) {
    link += `_i${baseStore.userinfo.numeric_id}`
  }
  return link
})

function copyAlbumLink() {
  // 🎯 严格要求：前 15 个字，不要链接，不要省略号，用于触发 Inline Mode
  const title = (props.detail?.note_card?.display_title || '精彩内容').trim()
  const queryText = title.substring(0, 15)
  const copyText = `@dydy ${queryText}`
  _copy(copyText)
  _notice('搜索指令已复制，在聊天框粘贴即可搜索')
  showShareDrawer.value = false
}

function shareAlbumDirect() {
  const id = String(currentId.value || '')
  if (!id) return

  const title = props.detail?.note_card?.display_title || '精彩内容'
  const link = albumDeepLink.value
  const text = `📸 ${title}\n\n来自 #TG抖音`

  // 🎯 改回标准分享协议，避免关闭 Mini App
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`

  // @ts-ignore
  if (window.Telegram?.WebApp) {
    // @ts-ignore
    window.Telegram.WebApp.openTelegramLink(shareUrl)
  } else {
    window.open(shareUrl, '_blank')
  }
  showShareDrawer.value = false
}

function shareToTelegram() {
  showShareDrawer.value = true
}

function close() {
  emit('close')
  setTimeout(() => {
    state.index = 0
    scrollEl.value.scrollTop = 0
  }, 500)
}
</script>

<style scoped lang="less">
@import '@/assets/less/index.less';

.goods-detail {
  background: var(--color-message);
  color: white;
  font-size: 14rem;
  height: 100dvh;
  width: 100vw;
  @c: #a2a2a2;
  @c2: #c0c0c0;
  @red: rgb(248, 38, 74);
  position: relative;
  overflow: hidden;

  .detail-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .detail-header {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    z-index: 10;
    display: flex;
    justify-content: space-between;
    padding: calc(15rem + env(safe-area-inset-top)) 15rem 15rem;
    box-sizing: border-box;
    pointer-events: none;

    svg {
      pointer-events: auto;
      font-size: 20rem;
      background: rgba(0, 0, 0, 0.4);
      padding: 5rem;
      color: white;
      border-radius: 50%;
    }
  }

  .scroll {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .detail-footer {
    width: 100%;
    background: var(--color-message);
    border-top: 1px solid rgba(white, 0.1);
    z-index: 11;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .slide-imgs {
    position: relative;
    height: 70vh;
    background: #000;

    img {
      height: 100%;
      width: 100%;
      // ✅ 方案 A：完整展示，不裁切
      object-fit: contain;
    }

    .indicator-bar {
      position: absolute;
      bottom: 5rem;
      left: 3vw;
      width: 94%;
      display: flex;
      gap: 5rem;

      .indicator {
        background: rgba(162, 160, 160, 0.5);
        height: 3rem;
        flex: 1;
        border-radius: 2rem;
      }

      .active {
        background: rgba(250, 246, 246, 0.58);
      }
    }

    .index {
      font-size: 12rem;
      position: absolute;
      padding: 3rem 10rem;
      border-radius: 15rem;
      background: rgba(91, 89, 89, 0.5);
      right: 10rem;
      bottom: 30rem;
      color: white;
    }
  }

  .card {
    margin-top: 15rem;
    border-radius: 10rem;
    padding: 10rem 15rem;
    background: black;
  }

  .arrow {
    font-size: 16rem;
  }

  .content {
    padding: 15rem;
    padding-bottom: 20rem;
    border-radius: 16rem 16rem 0 0;

    .comments {
      & > header {
        margin-bottom: 16rem;
        display: flex;
        justify-content: space-between;
        align-items: center;

        .l {
          font-size: 15rem;
        }

        .r {
          color: gray;
          font-size: 12rem;
          display: flex;
          align-items: center;
        }
      }

      // ✅ CommentNew 同款结构样式（主评论 + 回复 + 展开更多）
      .comment-items {
        display: flex;
        flex-direction: column;
        gap: 12rem;
      }

      .comment-item {
        width: 100%;
        position: relative; // 🎯 必须 relative

        &.show-delete {
          background: rgba(255, 255, 255, 0.05);
        }
      }

      // 🎯 删除操作层
      .delete-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 20rem;
        z-index: 100;
        border-radius: 8rem;
        animation: fadeIn 0.2s ease;

        .delete-btn {
          padding: 6rem 20rem;
          background: #fe2c55;
          color: white;
          border-radius: 20rem;
          font-size: 13rem;
          font-weight: 500;
        }

        .cancel-delete {
          padding: 6rem 20rem;
          background: rgba(255, 255, 255, 0.15);
          color: #eee;
          border-radius: 20rem;
          font-size: 13rem;
        }
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .comment-main,
      .reply-item {
        display: flex;
        align-items: flex-start;
        gap: 8rem;
        position: relative; // 🎯 必须 relative

        &.show-delete {
          background: rgba(255, 255, 255, 0.05);
        }
      }

      .avatar {
        width: 28rem;
        height: 28rem;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .comment-body,
      .reply-body {
        flex: 1;
        min-width: 0;
      }

      .username {
        font-size: 13rem;
        color: rgba(255, 255, 255, 0.95);
        font-weight: 600;
      }

      .comment-text,
      .reply-text {
        margin-top: 4rem;
        font-size: 13rem;
        line-height: 18rem;
        color: rgba(255, 255, 255, 0.9);
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2; // ✅ 默认最多两行
        line-clamp: 2;
        word-break: break-word;
      }

      .text-gray {
        color: rgba(255, 255, 255, 0.45);
      }

      .comment-footer,
      .reply-footer {
        margin-top: 6rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11rem;
        color: rgba(255, 255, 255, 0.55);
      }

      .footer-left {
        display: flex;
        align-items: center;
        gap: 8rem;
        min-width: 0;
      }

      .time,
      .location {
        white-space: nowrap;
      }

      .reply-btn {
        color: rgba(255, 255, 255, 0.75);
        white-space: nowrap;
      }

      .footer-right {
        display: flex;
        align-items: center;
        gap: 10rem;
      }

      .action-btn {
        display: flex;
        align-items: center;
        gap: 4rem;
        white-space: nowrap;
        user-select: none;
        cursor: pointer;
        color: rgba(255, 255, 255, 0.75);

        svg {
          font-size: 14rem;
        }
      }

      .action-btn.active {
        color: var(--primary-btn-color);
      }

      .reply-list {
        margin-left: 36rem;
        margin-top: 8rem;
        display: flex;
        flex-direction: column;
        gap: 8rem;
      }

      .reply-to {
        color: rgba(255, 255, 255, 0.75);
      }

      .expand-replies {
        margin-left: 36rem;
        margin-top: 6rem;
        display: flex;
        align-items: center;
        gap: 8rem;
        font-size: 12rem;
        color: rgba(255, 255, 255, 0.65);
        cursor: pointer;

        svg {
          font-size: 14rem;
        }

        .expand-line {
          width: 18rem;
          height: 1px;
          background: rgba(255, 255, 255, 0.25);
        }
      }

      .loading,
      .empty,
      .loading-more {
        color: gray;
        font-size: 12rem;
        padding: 8rem 0;
        text-align: center;
      }

      .load-more {
        margin-top: 8rem;
        color: var(--primary-btn-color);
        font-size: 12rem;
        text-align: center;
        padding: 10rem 0;
      }
    }

    .shop {
      & > header {
        display: flex;
        align-items: center;
        gap: 10rem;

        img {
          width: 36rem;
          height: 36rem;
          border-radius: 50%;
        }

        .right {
          flex: 1;
          display: flex;
          justify-content: space-between;
          align-items: center;

          .name {
            font-size: 16rem;
          }

          .r {
            border-radius: 4rem;
            padding: 6rem 16rem;
            background: var(--primary-btn-color);
            font-size: 12rem;
            color: white;
          }
        }
      }

      .desc {
        margin-top: 10rem;
      }

      .date {
        font-size: 12rem;
        margin-top: 10rem;
        color: gray;
      }
    }
  }

  .toolbar {
    display: flex;
    align-items: center;
    padding: 8rem 12rem;
    box-sizing: border-box;
    gap: 10rem; // 🎯 增加整体间距

    .input-wrap {
      flex: 1;
      height: 36rem;
      border-radius: 30rem;
      background: rgba(255, 255, 255, 0.08);
      color: white;
      display: flex;
      align-items: center;
      padding: 0 12rem;

      .comment-input {
        flex: 1;
        height: 100%;
        outline: none;
        border: none;
        background: transparent;
        color: white;
        font-size: 14rem;
      }
    }

    .send-btn {
      height: 34rem;
      padding: 0 15rem;
      border-radius: 18rem;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13rem;
      background: var(--primary-btn-color);
      color: white;
      font-weight: 600;
      white-space: nowrap;
    }

    .options {
      display: flex;
      gap: 15rem; // 🎯 进一步增加图标间距，呼吸感更好
      padding-left: 5rem;
      align-items: flex-start; // 🎯 顶部对齐图标

      .option {
        display: flex;
        justify-content: center;
        align-items: center;
        flex-direction: column;
        min-width: 32rem;
        color: white;
        cursor: pointer;

        svg {
          font-size: 22rem;
        }

        .text {
          font-size: 10rem;
          margin-top: 2rem;
          color: rgba(255, 255, 255, 0.7);
          height: 12rem; // 🎯 固定高度，防止没有文字时高度抖动
          line-height: 12rem;
        }
      }

      .option.reward {
        justify-content: center;
      }

      .option.active {
        color: var(--primary-btn-color);
        .text {
          color: var(--primary-btn-color);
        }
      }
    }
  }
}

// ✅ 回复提示条：现在在 detail-footer 内部
.reply-hint-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8rem 12rem;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  color: rgba(255, 255, 255, 0.9);
  font-size: 12rem;

  .close {
    font-size: 16rem;
    color: rgba(255, 255, 255, 0.85);
  }
}
</style>
