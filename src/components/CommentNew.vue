<template>
  <!-- 遮罩层 -->
  <Transition name="mask-fade">
    <div v-if="modelValue" class="comment-mask" @click.self="handleClose"></div>
  </Transition>

  <!-- 评论区 Dialog -->
  <Transition name="fade">
    <div v-if="modelValue" class="comment-dialog">
      <!-- 顶部标题栏 -->
      <div class="comment-header">
        <div class="comment-title">{{ _formatNumber(comments.length) }}条评论</div>
        <div class="close-btn" @click="handleClose">
          <Icon icon="ic:round-close" />
        </div>
      </div>

      <!-- 输入框区域（移到顶部） -->
      <div class="comment-input-bar">
        <input
          v-model="commentText"
          class="comment-input"
          type="text"
          placeholder="善语结善缘，恶言伤人心"
          @focus="handleInputFocus"
          @blur="handleInputBlur"
        />
        <div class="send-btn" :class="{ active: canSend }" @click="handleSend">
          发送
        </div>
      </div>

      <!-- 评论列表区域 -->
      <div class="comment-list" ref="listRef">
        <!-- 加载中 -->
        <div v-if="commentsLoading" class="loading-container">
          <Loading />
        </div>

        <!-- 空状态 -->
        <div v-else-if="!comments.length" class="empty-container">
          暂无评论，快来抢沙发～
        </div>

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
                    <span class="reply-btn">回复</span>
                  </div>
                  <div class="footer-right">
                    <div class="action-btn" :class="{ active: item.user_digged }" @click="handleLike(item)">
                      <Icon :icon="item.user_digged ? 'icon-park-solid:like' : 'icon-park-outline:like'" />
                      <span v-if="item.digg_count">{{ _formatNumber(item.digg_count) }}</span>
                    </div>
                    <div class="action-btn" @click="item.user_buried = !item.user_buried">
                      <Icon :icon="item.user_buried ? 'icon-park-solid:dislike-two' : 'icon-park-outline:dislike'" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 回复列表 -->
            <div v-if="item.showChildren && item.children?.length" class="reply-list">
              <div v-for="(child, j) in item.children" :key="child.comment_id || j" class="reply-item">
                <img :src="_checkImgUrl(child.avatar)" class="avatar" />
                <div class="reply-body">
                  <div class="username">{{ child.nickname }}</div>
                  <div class="reply-text">{{ child.content }}</div>
                  <div class="reply-footer">
                    <span class="time">{{ _time(child.create_time) }}</span>
                    <span v-if="child.ip_location" class="location">{{ child.ip_location }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 展开更多回复 -->
            <div v-if="Number(item.sub_comment_count)" class="expand-replies" @click="handleExpandReplies(item)">
              <div class="expand-line"></div>
              <span class="expand-text">
                展开{{ item.showChildren ? '更多' : `${item.sub_comment_count}条` }}回复
              </span>
              <Icon icon="ep:arrow-down-bold" />
            </div>
          </div>

          <!-- 已加载完毕 -->
          <div class="no-more">没有更多了</div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Icon } from '@iconify/vue'
import Loading from './Loading.vue'
import { videoComments, sendVideoComment } from '@/api/videos'
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

// 计算属性
const canSend = computed(() => commentText.value.trim().length > 0)

// 关闭评论区
const handleClose = () => {
  emit('update:modelValue', false)
  emit('close')
}

// 加载评论数据
const loadComments = async () => {
  commentsLoading.value = true
  try {
    const res: any = await videoComments({ videoId: props.videoId })
    if (res.success) {
      const list = Array.isArray(res.data?.list) ? res.data.list : Array.isArray(res.data) ? res.data : []
      comments.value = list.map((v: any) => ({
        ...v,
        showChildren: false,
        user_buried: false,
        user_digged: false,
        children: v.children || [],
        digg_count: Number(v.digg_count)
      }))
    } else if (res.message) {
      _notice(res.message)
      comments.value = []
    }
  } catch (error: any) {
    console.error('[Comment] 加载评论失败:', error)
    _notice(error?.message || '加载评论失败')
  } finally {
    commentsLoading.value = false
  }
}

// 发送评论
const handleSend = async () => {
  const content = commentText.value.trim()
  if (!content) return

  try {
    const result: any = await sendVideoComment(props.videoId, content)
    const formatted = {
      ...result,
      showChildren: false,
      user_digged: false,
      user_buried: false,
      children: []
    }
    comments.value.unshift(formatted)
    commentText.value = ''
    emit('comment-success')
  } catch (error: any) {
    _notice(error?.message || '评论失败')
  }
}

// 点赞评论
const handleLike = (item: any) => {
  if (item.user_digged) {
    item.digg_count--
  } else {
    item.digg_count++
  }
  item.user_digged = !item.user_digged
}

// 展开回复
const handleExpandReplies = async (item: any) => {
  if (item.showChildren) {
    // 加载更多回复（模拟数据）
    item.children = item.children.concat(sampleSize(comments.value, 10))
  } else {
    // 首次展开（模拟数据）
    item.children = sampleSize(comments.value, 3)
    item.showChildren = true
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

// 保存页面滚动位置
let savedScrollTop = 0

// 监听打开/关闭
watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal) {
      // ✅ 打开时：保存当前滚动位置
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
            console.log('[Comment] 🔍 验证滚动位置:', actualScroll, '差异:', Math.abs(actualScroll - savedScrollTop))
            
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
    }

    .reply-footer {
      font-size: 11px;
      color: #c4c3c3;
      display: flex;
      gap: 8px;
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
  border-bottom: 1px solid #f0f0f0; // ✅ 改为 border-bottom（输入框在顶部）
  padding: 10px 15px;
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
  z-index: 10;

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

