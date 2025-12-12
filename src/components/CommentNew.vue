<template>
  <!-- 遮罩层 -->
  <Transition name="mask-fade">
    <div v-if="modelValue" class="comment-mask" @click.self="handleClose"></div>
  </Transition>

  <!-- 评论区 Dialog -->
  <Transition name="fade">
    <div
      v-if="modelValue"
      class="comment-dialog"
      :style="{ transform: `translateY(${pullDistance}px)` }"
    >
      <!-- 顶部标题栏 -->
      <div
        class="comment-header"
        @touchstart="handleHeaderTouchStart"
        @touchmove="handleHeaderTouchMove"
        @touchend="handleHeaderTouchEnd"
      >
        <!-- 下拉指示器 -->
        <div class="pull-indicator" :style="{ opacity: pullDistance / 80 }"></div>

        <div class="comment-title">
          <span v-if="commentsLoading">加载中...</span>
          <span v-else>{{ _formatNumber(comments.length) }}条评论</span>
        </div>
        <div class="close-btn" @click="handleClose">
          <Icon icon="ic:round-close" />
        </div>
      </div>

      <!-- 输入框区域（移到顶部） -->
      <div
        class="comment-input-bar"
        @touchstart="handleHeaderTouchStart"
        @touchmove="handleHeaderTouchMove"
        @touchend="handleHeaderTouchEnd"
      >
        <!-- 回复提示 -->
        <div v-if="replyingTo" class="reply-hint">
          <span>回复 @{{ replyingTo.nickname }}</span>
          <Icon icon="ic:round-close" @click="cancelReply" />
        </div>
        <div class="input-wrapper">
          <input
            v-model="commentText"
            class="comment-input"
            type="text"
            :placeholder="replyingTo ? `回复 @${replyingTo.nickname}` : '善语结善缘，恶言伤人心'"
            @focus="handleInputFocus"
            @blur="handleInputBlur"
          />
          <div class="send-btn" :class="{ active: canSend }" @click="handleSend">发送</div>
        </div>
      </div>

      <!-- 评论列表区域 -->
      <div
        class="comment-list"
        ref="listRef"
        @touchstart="handleTouchStart"
        @touchmove="handleTouchMove"
        @scroll="handleScroll"
      >
        <!-- 加载中 -->
        <div v-if="commentsLoading" class="loading-container">
          <Loading />
        </div>

        <!-- 空状态 -->
        <div v-else-if="!comments.length" class="empty-container">暂无评论，快来抢沙发～</div>

        <!-- 评论列表 -->
        <div v-else class="comment-items">
          <div v-for="(item, i) in comments" :key="item.comment_id || i" class="comment-item">
            <!-- 主评论 -->
            <div class="comment-main">
              <img :src="_checkImgUrl(item.avatar)" class="avatar" />
              <div class="comment-body">
                <div class="username">{{ item.nickname }}</div>
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
                      @click="handleLike(item)"
                    >
                      <Icon
                        :icon="item.user_digged ? 'icon-park-solid:like' : 'icon-park-outline:like'"
                      />
                      <span v-if="item.digg_count">{{ _formatNumber(item.digg_count) }}</span>
                    </div>
                    <div class="action-btn" @click="item.user_buried = !item.user_buried">
                      <Icon
                        :icon="
                          item.user_buried
                            ? 'icon-park-solid:dislike-two'
                            : 'icon-park-outline:dislike'
                        "
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 回复列表 -->
            <div v-if="item.showChildren && item.children?.length" class="reply-list">
              <div
                v-for="(child, j) in item.children"
                :key="child.comment_id || j"
                class="reply-item"
              >
                <img :src="_checkImgUrl(child.avatar)" class="avatar" />
                <div class="reply-body">
                  <div class="username">{{ child.nickname }}</div>
                  <div class="reply-text">
                    <span v-if="child.reply_to_user" class="reply-to"
                      >回复 @{{ child.reply_to_user }}：</span
                    >
                    {{ child.content }}
                  </div>
                  <div class="reply-footer">
                    <div class="footer-left">
                      <span class="time">{{ _time(child.create_time) }}</span>
                      <span v-if="child.ip_location" class="location">{{ child.ip_location }}</span>
                      <span class="reply-btn" @click="handleReply(item)">回复</span>
                    </div>
                    <div class="footer-right">
                      <div
                        class="action-btn"
                        :class="{ active: child.user_digged }"
                        @click="handleLike(child)"
                      >
                        <Icon
                          :icon="
                            child.user_digged ? 'icon-park-solid:like' : 'icon-park-outline:like'
                          "
                        />
                        <span v-if="child.digg_count">{{ _formatNumber(child.digg_count) }}</span>
                      </div>
                      <div class="action-btn" @click="child.user_buried = !child.user_buried">
                        <Icon
                          :icon="
                            child.user_buried
                              ? 'icon-park-solid:dislike-two'
                              : 'icon-park-outline:dislike'
                          "
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 展开更多回复 -->
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

          <!-- 加载更多 / 已加载完毕 -->
          <div v-if="isLoadingMore" class="loading-more">
            <Loading />
          </div>
          <div v-else-if="!hasMore" class="no-more">没有更多了</div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Icon } from '@iconify/vue'
import Loading from './Loading.vue'
import { videoComments, sendVideoComment, toggleCommentLike, getCommentReplies } from '@/api/videos'
import { _formatNumber, _time, _checkImgUrl, _notice, sampleSize } from '@/utils'

interface Props {
  modelValue: boolean
  videoId: string
  pageId?: string
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'close'): void
  (e: 'comment-success'): void
}

const props = withDefaults(defineProps<Props>(), {
  pageId: 'home'
})

const emit = defineEmits<Emits>()

// 评论数据
const comments = ref<any[]>([])
const commentsLoading = ref(false)
const commentText = ref('')
const listRef = ref<HTMLElement | null>(null)
const replyingTo = ref<any>(null) // 🎯 正在回复的评论
// 🎯 分页数据
const pageNo = ref(0)
const pageSize = 20
const total = ref(0)
const hasMore = computed(() => comments.value.length < total.value)
const isLoadingMore = ref(false)
// 🎯 下拉关闭手势
const pullDistance = ref(0)
let headerStartY = 0
let headerStartTime = 0

// 计算属性
const isSending = ref(false)
const canSend = computed(() => commentText.value.trim().length > 0 && !isSending.value)

// 关闭评论区
const handleClose = () => {
  emit('update:modelValue', false)
  emit('close')
}

// 🎯 加载评论数据（第一页）
const loadComments = async () => {
  commentsLoading.value = true
  pageNo.value = 0
  try {
    const res: any = await videoComments({
      videoId: props.videoId,
      pageNo: pageNo.value,
      pageSize
    })
    if (res.success) {
      const list = Array.isArray(res.data?.list)
        ? res.data.list
        : Array.isArray(res.data)
          ? res.data
          : []
      comments.value = list.map((v: any) => ({
        ...v,
        showChildren: false,
        user_buried: false,
        user_digged: false,
        children: v.children || [],
        digg_count: Number(v.digg_count)
      }))
      total.value = res.data?.total ?? 0
      pageNo.value = 1 // 下次加载第二页
    } else if (res.message) {
      _notice(res.message)
      comments.value = []
      total.value = 0
    }
  } catch (error: any) {
    console.error('[Comment] 加载评论失败:', error)
    _notice(error?.message || '加载评论失败')
  } finally {
    commentsLoading.value = false
  }
}

// 🎯 加载更多评论
const loadMoreComments = async () => {
  if (isLoadingMore.value || !hasMore.value) return

  isLoadingMore.value = true
  try {
    const res: any = await videoComments({
      videoId: props.videoId,
      pageNo: pageNo.value,
      pageSize
    })
    if (res.success) {
      const list = Array.isArray(res.data?.list)
        ? res.data.list
        : Array.isArray(res.data)
          ? res.data
          : []
      const newComments = list.map((v: any) => ({
        ...v,
        showChildren: false,
        user_buried: false,
        user_digged: false,
        children: v.children || [],
        digg_count: Number(v.digg_count)
      }))
      comments.value.push(...newComments)
      pageNo.value++
    }
  } catch (error: any) {
    console.error('[Comment] 加载更多评论失败:', error)
    _notice(error?.message || '加载失败')
  } finally {
    isLoadingMore.value = false
  }
}

// 发送评论
const handleSend = async () => {
  const content = commentText.value.trim()
  if (!content || isSending.value) return

  isSending.value = true

  try {
    // 🎯 如果是回复评论，传入 reply_to
    const replyToId = replyingTo.value?.comment_id || null
    const result: any = await sendVideoComment(props.videoId, content, replyToId)

    const formatted = {
      ...result,
      showChildren: false,
      user_digged: false,
      user_buried: false,
      children: []
    }

    // 🎯 如果是回复，添加到对应评论的回复列表
    if (replyToId && replyingTo.value) {
      const parentComment = comments.value.find((c) => c.comment_id === replyToId)
      if (parentComment) {
        if (!parentComment.children) parentComment.children = []
        parentComment.children.unshift(formatted)
        parentComment.sub_comment_count = (parentComment.sub_comment_count || 0) + 1
        parentComment.showChildren = true
      }
    } else {
      // 否则添加到主评论列表
      comments.value.unshift(formatted)
    }

    commentText.value = ''
    replyingTo.value = null // 🎯 清除回复状态
    emit('comment-success')
  } catch (error: any) {
    _notice(error?.message || '评论失败')
  } finally {
    isSending.value = false
  }
}

// 🎯 回复评论
const handleReply = (item: any) => {
  replyingTo.value = item
  // 自动聚焦输入框
  nextTick(() => {
    const input = document.querySelector('.comment-input') as HTMLInputElement
    if (input) input.focus()
  })
}

// 🎯 取消回复
const cancelReply = () => {
  replyingTo.value = null
  commentText.value = ''
}

// 🎯 点赞/取消点赞评论
const handleLike = async (item: any) => {
  const newLikedState = !item.user_digged
  const oldLikedState = item.user_digged
  const oldCount = item.digg_count

  // 乐观更新 UI
  item.user_digged = newLikedState
  item.digg_count = newLikedState ? oldCount + 1 : Math.max(0, oldCount - 1)

  try {
    const result: any = await toggleCommentLike(item.comment_id, newLikedState)
    // 使用服务器返回的真实数据
    item.digg_count = result.like_count || 0
  } catch (error: any) {
    // 失败时回滚
    item.user_digged = oldLikedState
    item.digg_count = oldCount
    _notice(error?.message || '操作失败')
  }
}

// 🎯 展开回复（调用真实API）
const handleExpandReplies = async (item: any) => {
  if (item.showChildren) {
    // 已展开，无需重复加载（因为条件已经过滤了全部展示的情况）
    return
  }

  // 首次展开，加载回复列表
  try {
    const res: any = await getCommentReplies(item.comment_id)
    if (res.success) {
      item.children = res.data.map((v: any) => ({
        ...v,
        user_digged: false,
        user_buried: false
      }))
      item.showChildren = true
    } else {
      _notice(res.message || '加载回复失败')
    }
  } catch (error: any) {
    _notice(error?.message || '加载回复失败')
  }
}

// @ 好友
const handleAtClick = () => {
  console.log('[Comment] @ 好友')
  // TODO: 实现 @ 好友功能
}

// 表情
const handleEmojiClick = () => {
  console.log('[Comment] 表情')
  // TODO: 实现表情功能
}

// 输入框焦点
const handleInputFocus = () => {
  console.log('[Comment] 输入框获得焦点')
}

const handleInputBlur = () => {
  console.log('[Comment] 输入框失去焦点')
}

// 🎯 头部下拉关闭手势
const handleHeaderTouchStart = (e: TouchEvent) => {
  // 🎯 如果触摸目标是输入框，不处理手势
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.classList.contains('comment-input')) {
    return
  }

  headerStartY = e.touches[0].clientY
  headerStartTime = Date.now()
  pullDistance.value = 0
}

const handleHeaderTouchMove = (e: TouchEvent) => {
  // 🎯 如果触摸目标是输入框，不处理手势
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.classList.contains('comment-input')) {
    return
  }

  if (headerStartY === 0) return // 未初始化

  const currentY = e.touches[0].clientY
  const deltaY = currentY - headerStartY

  // 只处理向下拉（deltaY > 0）
  if (deltaY > 0) {
    e.preventDefault() // 阻止页面滚动
    pullDistance.value = Math.min(deltaY, 100) // 最大100px
  }
}

const handleHeaderTouchEnd = () => {
  if (headerStartY === 0) return // 未初始化

  const duration = Date.now() - headerStartTime

  // 🎯 下拉超过80px 或 快速下拉（速度判断）则关闭评论区
  if (pullDistance.value > 80 || (pullDistance.value > 40 && duration < 200)) {
    handleClose()
  }

  // 重置
  pullDistance.value = 0
  headerStartY = 0
  headerStartTime = 0
}

// 🎯 防止空评论或少量评论时下拉导致 miniapp 关闭
let startY = 0
const handleTouchStart = (e: TouchEvent) => {
  startY = e.touches[0].clientY
}

const handleTouchMove = (e: TouchEvent) => {
  if (!listRef.value) return

  const currentY = e.touches[0].clientY
  const deltaY = currentY - startY
  const scrollTop = listRef.value.scrollTop

  // 🎯 当滚动到顶部且继续下拉时，阻止默认行为
  if (scrollTop <= 0 && deltaY > 0) {
    e.preventDefault()
  }

  // 🎯 当滚动到底部且继续上拉时，也阻止（可选）
  const scrollHeight = listRef.value.scrollHeight
  const clientHeight = listRef.value.clientHeight
  if (scrollTop + clientHeight >= scrollHeight && deltaY < 0) {
    e.preventDefault()
  }
}

// 🎯 滚动到底部时加载更多
const handleScroll = () => {
  if (!listRef.value || isLoadingMore.value || !hasMore.value) return

  const { scrollTop, scrollHeight, clientHeight } = listRef.value
  // 距离底部 100px 时触发加载
  if (scrollTop + clientHeight >= scrollHeight - 100) {
    loadMoreComments()
  }
}

// 保存页面滚动位置
let savedScrollTop = 0

// 监听打开/关闭
watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal) {
      // ✅ 打开时：立即清空旧评论数据，重置分页状态
      comments.value = []
      commentsLoading.value = true
      pageNo.value = 0
      total.value = 0
      isLoadingMore.value = false

      // ✅ 保存当前滚动位置
      savedScrollTop = document.documentElement.scrollTop || window.pageYOffset || 0
      console.log('[Comment] 📌 打开评论区，保存滚动位置:', savedScrollTop)

      loadComments()
      // 滚动到顶部
      nextTick(() => {
        if (listRef.value) {
          listRef.value.scrollTop = 0
        }
      })
    } else {
      // ✅ 关闭时：恢复滚动位置
      commentText.value = ''

      console.log('[Comment] 📌 关闭评论区前，当前滚动位置:', {
        saved: savedScrollTop,
        current: document.documentElement.scrollTop || window.pageYOffset
      })

      nextTick(() => {
        // 延迟恢复，等待 Telegram viewport 恢复
        setTimeout(() => {
          // ✅ 强制滚动到保存的位置（通常是 0）
          window.scrollTo({ top: savedScrollTop, behavior: 'auto' })
          document.documentElement.scrollTop = savedScrollTop
          document.body.scrollTop = savedScrollTop
          console.log('[Comment] ✅ 恢复滚动位置到:', savedScrollTop)

          // 再次验证并强制恢复（双重保险）
          setTimeout(() => {
            const actualScroll = document.documentElement.scrollTop || window.pageYOffset
            console.log(
              '[Comment] 🔍 验证滚动位置:',
              actualScroll,
              '差异:',
              Math.abs(actualScroll - savedScrollTop)
            )

            if (Math.abs(actualScroll - savedScrollTop) > 5) {
              console.log('[Comment] ⚠️ 位置不对，强制再次恢复')
              window.scrollTo({ top: savedScrollTop, behavior: 'auto' })
              document.documentElement.scrollTop = savedScrollTop
              document.body.scrollTop = savedScrollTop
            }
          }, 100)
        }, 150) // ✅ 增加延迟到 150ms，等待 Telegram viewport 完全恢复
      })
    }
  }
)
</script>

<style lang="less" scoped>
// 遮罩层
.comment-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 8999;
}

// Dialog
.comment-dialog {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 65vh; // ✅ 从 80vh 改为 65vh，更合适的高度
  background: white;
  border-radius: 15px 15px 0 0;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  // 🎯 下拉手势的过渡效果
  transition: transform 0.2s ease-out;
  will-change: transform;
}

// 顶部标题栏
.comment-header {
  flex-shrink: 0;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border-bottom: 1px solid #f0f0f0;
  // 🎯 禁止触摸选择，优化手势体验
  user-select: none;
  -webkit-user-select: none;

  // 🎯 下拉指示器
  .pull-indicator {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    width: 40px;
    height: 4px;
    background: #ddd;
    border-radius: 2px;
    transition: opacity 0.2s;
  }

  .comment-title {
    font-size: 14px;
    font-weight: bold;
    color: #000;
  }

  .close-btn {
    position: absolute;
    right: 15px;
    top: 50%;
    transform: translateY(-50%);
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: #000;
    font-size: 20px;

    &:active {
      opacity: 0.6;
    }
  }
}

// 评论列表区域
.comment-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  // 🎯 防止滚动穿透到父页面
  overscroll-behavior: contain;
  // 🎯 只允许垂直滚动
  touch-action: pan-y;
}

// 加载中 / 空状态
.loading-container,
.empty-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #999;
  font-size: 14px;
}

// 评论项
.comment-items {
  padding: 10px 0;
}

.comment-item {
  padding: 15px;
  border-bottom: 1px solid #f5f5f5;

  &:last-child {
    border-bottom: none;
  }
}

.comment-main {
  display: flex;
  gap: 10px;

  .avatar {
    width: 37px;
    height: 37px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .comment-body {
    flex: 1;
    min-width: 0;

    .username {
      font-size: 13px;
      color: #666;
      margin-bottom: 5px;
    }

    .comment-text {
      font-size: 14px;
      color: #000;
      line-height: 1.5;
      word-wrap: break-word;
      margin-bottom: 8px;

      &.text-gray {
        color: #999;
      }
    }

    .comment-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      color: #999;

      .footer-left {
        display: flex;
        align-items: center;
        gap: 10px;

        .time {
          color: #c4c3c3;
        }

        .location {
          color: #c4c3c3;
        }

        .reply-btn {
          color: #999;
          cursor: pointer;

          &:active {
            opacity: 0.6;
          }
        }
      }

      .footer-right {
        display: flex;
        align-items: center;
        gap: 15px;

        .action-btn {
          display: flex;
          align-items: center;
          gap: 3px;
          color: gray;
          cursor: pointer;
          font-size: 17px;

          &:active {
            opacity: 0.6;
          }

          &.active {
            color: rgb(231, 58, 87);
          }

          span {
            font-size: 12px;
          }
        }
      }
    }
  }
}

// 回复列表
.reply-list {
  margin-left: 47px;
  margin-top: 10px;
}

.reply-item {
  display: flex;
  gap: 10px;
  padding: 5px 0;

  .avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .reply-body {
    flex: 1;
    min-width: 0;

    .username {
      font-size: 12px;
      color: #666;
      margin-bottom: 3px;
    }

    .reply-text {
      font-size: 13px;
      color: #000;
      line-height: 1.5;
      word-wrap: break-word;
      margin-bottom: 5px;

      // 🎯 回复目标用户样式
      .reply-to {
        color: #666;
        font-size: 12px;
      }
    }

    .reply-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 3px;

      .footer-left {
        display: flex;
        align-items: center;
        gap: 10px;

        .time {
          font-size: 11px;
          color: #c4c3c3;
        }

        .location {
          font-size: 11px;
          color: #c4c3c3;
        }

        .reply-btn {
          font-size: 11px;
          color: #999;
          cursor: pointer;

          &:active {
            opacity: 0.6;
          }
        }
      }

      .footer-right {
        display: flex;
        align-items: center;
        gap: 12px;

        .action-btn {
          display: flex;
          align-items: center;
          gap: 3px;
          color: gray;
          cursor: pointer;
          font-size: 14px;

          &:active {
            opacity: 0.6;
          }

          &.active {
            color: rgb(231, 58, 87);
          }

          span {
            font-size: 11px;
          }
        }
      }
    }
  }
}

// 展开更多回复
.expand-replies {
  margin-left: 47px;
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #999;
  font-size: 13px;
  cursor: pointer;

  &:active {
    opacity: 0.6;
  }

  .expand-line {
    width: 30px;
    height: 1px;
    background: #ddd;
  }

  .expand-text {
    flex: 1;
  }
}

// 已加载完毕
// 加载更多
.loading-more {
  display: flex;
  justify-content: center;
  padding: 20px;
}

.no-more {
  text-align: center;
  padding: 20px;
  color: #ccc;
  font-size: 13px;
}

// 输入框区域
.comment-input-bar {
  flex-shrink: 0;
  background: white;
  border-bottom: 1px solid #f0f0f0;
  padding: 10px 15px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  z-index: 10;
  // 🎯 禁止触摸选择，优化手势体验（但不影响输入框）
  user-select: none;
  -webkit-user-select: none;

  // 🎯 回复提示
  .reply-hint {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 10px;
    background: #f0f0f0;
    border-radius: 4px;
    font-size: 12px;
    color: #666;

    span {
      flex: 1;
    }

    svg {
      font-size: 16px;
      cursor: pointer;
      color: #999;

      &:active {
        opacity: 0.6;
      }
    }
  }

  // 🎯 输入框包装器
  .input-wrapper {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .comment-input {
    flex: 1;
    height: 36px;
    padding: 0 15px;
    background: #f5f5f5;
    border: none;
    border-radius: 18px;
    font-size: 14px;
    outline: none;

    &::placeholder {
      color: #999;
    }
  }

  .send-btn {
    padding: 0 20px;
    height: 36px; // ✅ 增加高度，和输入框一样高
    display: flex;
    align-items: center;
    justify-content: center;
    background: #e0e0e0;
    color: #999;
    border-radius: 18px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0; // ✅ 防止按钮被压缩

    &.active {
      background: #fe2c55;
      color: white;
    }

    &:active {
      opacity: 0.8;
    }
  }
}

// 动画（统一使用 fade，避免 transform 导致的点击位置问题）
.mask-fade-enter-active,
.mask-fade-leave-active,
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.mask-fade-enter-from,
.mask-fade-leave-to,
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
