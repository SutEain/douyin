<template>
  <div class="goods-detail" @dragstart="(e) => _stopPropagation(e)">
    <header>
      <Icon @click="close" icon="material-symbols-light:arrow-back-ios-new" />
      <!-- ✅ 右上角搜索按钮移除 -->
    </header>

    <div class="scroll" ref="scrollEl">
      <div class="slide-imgs">
        <SlideHorizontal v-model:index="state.index">
          <SlideItem :key="i" v-for="(item, i) in props.detail.note_card?.image_list">
            <img :src="_checkImgUrl(item.info_list?.[0]?.url)" alt="" />
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
            <img class="avatar" :src="_checkImgUrl(props.detail.note_card?.user?.avatar)" />
            <div class="right">
              <div class="name">
                {{
                  props.detail.note_card?.user?.nickname ||
                  props.detail.note_card?.user?.nick_name ||
                  props.detail.note_card?.user?.name ||
                  '用户'
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
          <div class="desc">
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
          <div v-else class="comment" :key="c.comment_id || i" v-for="(c, i) in comments.list">
            <img :src="_checkImgUrl(c.avatar)" alt="" class="avatar" />
            <span class="content">
              <b class="nick">{{ c.nickname || '用户' }}</b>
              ：{{ c.content }}
            </span>
          </div>

          <div
            v-if="comments.hasMore && !comments.loadingMore"
            class="load-more"
            @click.stop="loadMoreComments"
          >
            加载更多
          </div>
          <div v-else-if="comments.loadingMore" class="loading-more">加载中...</div>
        </div>
      </div>
    </div>
    <div class="toolbar">
      <div class="input-wrap">
        <input
          v-model="comments.input"
          class="comment-input"
          type="text"
          placeholder="说点什么..."
          @keyup.enter="sendComment"
        />
        <div
          class="send-btn"
          :class="[comments.input.trim() && 'active']"
          :style="comments.sending ? 'pointer-events:none;opacity:.6;' : ''"
          @click.stop="sendComment"
        >
          发送
        </div>
      </div>
      <div class="options">
        <div
          class="option"
          :class="[local.isLoved && 'active']"
          :style="local.likeLoading ? 'pointer-events:none;opacity:.6;' : ''"
          @click.stop="toggleLike"
        >
          <Icon :icon="local.isLoved ? 'solar:heart-bold' : 'solar:heart-linear'" />
          <div class="text">
            {{ _formatNumber(local.likeCount) }}
          </div>
        </div>
        <!-- ✅ 评论按钮移除：评论内容已在详情页直接展示 -->

        <div
          class="option"
          :class="[local.isCollect && 'active']"
          :style="local.collectLoading ? 'pointer-events:none;opacity:.6;' : ''"
          @click.stop="toggleCollect"
        >
          <Icon :icon="local.isCollect ? 'solar:star-bold' : 'mage:star'" />
          <div class="text">
            {{ _formatNumber(local.collectCount) }}
          </div>
        </div>
        <div class="option" @click.stop="shareToTelegram">
          <Icon icon="ph:share-fat-light" />
          <div class="text">
            {{ _formatNumber(local.shareCount) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import SlideHorizontal from '@/components/slide/SlideHorizontal.vue'
import SlideItem from '@/components/slide/SlideItem.vue'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { _checkImgUrl, _copy, _formatNumber, _notice, _stopPropagation, cloneDeep } from '@/utils'
import {
  sendVideoComment,
  toggleFollowUser,
  toggleVideoCollect,
  toggleVideoLike,
  videoComments
} from '@/api/videos'
import { useBaseStore } from '@/store/pinia'

const baseStore = useBaseStore()

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

const commentList = computed(() => {
  const list = props.detail?.note_card?.comment_list
  return Array.isArray(list) ? list : []
})

const commentCount = computed(() => commentList.value.length)

const displayCommentCount = computed(() => {
  // 优先显示真实拉取到的评论数；否则用接口返回的 comment_count；否则 fallback
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
  pageNo: 0,
  pageSize: 50,
  input: '',
  sending: false
})

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
    const data = res.data || []
    const nextList = Array.isArray(data) ? data : data?.list || []
    if (reset) {
      comments.list = nextList
    } else {
      comments.list = [...comments.list, ...nextList]
    }

    // hasMore：尽量兼容两种返回结构
    const hasMore =
      typeof data?.hasMore === 'boolean' ? data.hasMore : nextList.length >= comments.pageSize
    comments.hasMore = !!hasMore
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
    await sendVideoComment(id, content)
    comments.input = ''
    // 发送成功后：刷新第一页（保证显示的是后端真实数据）
    await loadComments(true)
    // ✅ 同步 comment_count：不要直接改 props，走 update 回传到列表/当前详情
    emit('update', {
      id,
      note_card: {
        aweme_id: id,
        interact_info: {
          comment_count: comments.list.length
        }
      }
    })
  } catch (error) {
    _notice(error?.message || '发送失败')
  } finally {
    comments.sending = false
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

function shareToTelegram() {
  const id = String(currentId.value || '')
  if (!id) {
    _notice('作品ID缺失，无法分享')
    return
  }
  const numericId = baseStore.userinfo?.numeric_id
  const inviteSuffix = numericId ? `_i${numericId}` : ''
  const shareText = `@tg_douyin_bot video_${id}${inviteSuffix}`
  _copy(shareText)
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
  height: 100%;
  @c: #a2a2a2;
  @c2: #c0c0c0;
  @red: rgb(248, 38, 74);
  position: relative;
  opacity: 0;

  & > header {
    position: fixed;
    left: 0;
    top: 0;
    width: 100%;
    z-index: 9;
    display: flex;
    justify-content: space-between;
    padding: 15rem;
    box-sizing: border-box;

    svg {
      font-size: 20rem;
      background: rgba(176, 176, 176, 0.4);
      padding: 5rem;
      color: white;
      border-radius: 50%;
    }
  }

  .scroll {
    height: 100vh;
    overflow: auto;
  }

  .slide-imgs {
    position: relative;
    height: 70vh;

    img {
      height: 100%;
      width: 100%;
      object-fit: cover;
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
    padding-bottom: 10vh;
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

      .comment {
        margin-bottom: 16rem;
        display: flex;
        align-items: center;
        gap: 5rem;

        .content {
          display: inline-block;
          flex: 1;
          word-break: break-all;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;

          .nick {
            font-weight: 600;
            margin-right: 4rem;
          }
        }

        img {
          border-radius: 50%;
          width: 20rem;
          height: 20rem;
        }

        &:last-child {
          margin-bottom: 0;
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
    position: fixed;
    bottom: 0;
    width: 100vw;
    left: 0;
    background: var(--color-message);
    border-top: 1px solid rgba(white, 0.1);
    display: flex;
    align-items: center;
    padding: 8rem 10rem;
    padding-right: 0;
    box-sizing: border-box;
    gap: 6rem;

    .input-wrap {
      flex: 1;
      height: 34rem;
      border-radius: 30rem;
      background: var(--second-btn-color-tran);
      color: gray;
      display: flex;
      align-items: center;
      padding: 0 10rem;
      gap: 8rem;

      .comment-input {
        flex: 1;
        height: 100%;
        outline: none;
        border: none;
        background: transparent;
        color: white;
        font-size: 13rem;
      }

      .send-btn {
        font-size: 12rem;
        padding: 4rem 10rem;
        border-radius: 20rem;
        background: rgba(255, 255, 255, 0.12);
        color: gray;
      }

      .send-btn.active {
        background: var(--primary-btn-color);
        color: white;
      }
    }

    .options {
      width: 180rem;
      display: flex;

      .option {
        flex: 1;
        display: flex;
        justify-content: center;
        align-items: center;
        flex-direction: column;
        font-size: 13rem;
        color: white;
        cursor: pointer;

        svg {
          font-size: 24rem;
        }
      }

      .option.active {
        color: var(--primary-btn-color);
      }
    }
  }
}
</style>
