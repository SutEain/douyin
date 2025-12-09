<template>
  <div class="video-list-item" @click="handleClick">
    <!-- 作者信息 -->
    <div class="author-info">
      <img
        :src="avatarUrl"
        class="avatar"
        @error="handleAvatarError"
        @click.stop="handleGoUserPanel"
      />
      <div class="author-details" @click.stop="handleGoUserPanel">
        <div class="nickname">{{ video.author?.nickname || video.author?.username }}</div>
        <div class="username">抖音号：{{ formatUserId(video.author) }}</div>
      </div>
      <button class="follow-btn" @click.stop="handleFollow">
        {{ video.is_following ? '已关注' : '关注' }}
      </button>
    </div>

    <!-- 描述 -->
    <div class="description">
      {{ video.desc || video.description || '暂无描述' }}
    </div>

    <!-- 视频封面 -->
    <div class="video-cover">
      <img :src="coverUrl" class="cover-image" @error="handleCoverError" />
      <div class="video-info">
        <div class="stats">
          <span class="stat-item">
            <i class="icon-play">▶</i>
            {{ formatNumber(video.statistics?.digg_count || video.view_count || 0) }}
          </span>
          <span class="stat-item">
            <i class="icon-like">❤</i>
            {{ formatNumber(video.statistics?.digg_count || video.like_count || 0) }}
          </span>
        </div>
        <div class="duration" v-if="video.video?.duration || video.duration">
          {{ formatDuration(video.video?.duration || video.duration) }}
        </div>
      </div>
    </div>

    <!-- 热门评论（放在视频下方） -->
    <div class="hot-comment" v-if="video.top_comment">
      <div class="comment-wrapper">
        <span class="label" v-if="video.top_comment.like_count > 0">热评</span>
        <span class="label new" v-else>最新</span>
        <span class="nickname">{{ video.top_comment.author_nickname }}：</span>
        <span class="content">{{ video.top_comment.content }}</span>
        <span class="likes" v-if="video.top_comment.like_count > 0">
          <i>❤</i> {{ formatNumber(video.top_comment.like_count) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { _checkImgUrl } from '@/utils'

const props = defineProps<{
  video: any
}>()

const emit = defineEmits<{
  click: [video: any]
  follow: [userId: string]
  goUserPanel: [userId: string]
}>()

// 头像 URL
const avatarUrl = computed(() => {
  // 支持多种头像字段格式
  const avatar =
    props.video.author?.avatar_thumb?.url_list?.[0] ||
    props.video.author?.avatar_larger?.url_list?.[0] ||
    props.video.author?.avatar_url
  return _checkImgUrl(avatar)
})

// 封面 URL
const coverUrl = computed(() => {
  // 支持多种封面字段格式
  const cover =
    props.video.video?.poster || props.video.video?.cover?.url_list?.[0] || props.video.cover_url
  return _checkImgUrl(cover)
})

// 格式化用户 ID
const formatUserId = (author: any) => {
  // 优先显示数字 ID，否则显示简短的 user_id
  if (author?.numeric_id) {
    return author.numeric_id
  }
  if (author?.user_id) {
    // 截取 user_id 前 8 位
    return author.user_id.substring(0, 8)
  }
  return '未知'
}

// 格式化数字
const formatNumber = (num: number) => {
  if (!num) return '0'
  if (num >= 10000) {
    return (num / 10000).toFixed(1) + 'w'
  }
  return num.toString()
}

// 格式化时长
const formatDuration = (seconds: number) => {
  const min = Math.floor(seconds / 60)
  const sec = Math.floor(seconds % 60)
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
}

// 头像加载失败
const handleAvatarError = (e: Event) => {
  const target = e.target as HTMLImageElement
  target.src = new URL('../assets/img/icon/avatar/1.png', import.meta.url).href
}

// 封面加载失败
const handleCoverError = (e: Event) => {
  const target = e.target as HTMLImageElement
  target.src = 'https://via.placeholder.com/300x400?text=No+Image'
}

// 点击视频
const handleClick = () => {
  emit('click', props.video)
}

// 关注/取消关注
const handleFollow = () => {
  const userId = props.video.author?.user_id || props.video.author?.id || props.video.author?.uid
  if (userId) emit('follow', userId)
}

// 跳转到用户主页
const handleGoUserPanel = () => {
  const userId = props.video.author?.user_id || props.video.author?.id || props.video.author?.uid
  if (userId) emit('goUserPanel', userId)
}
</script>

<style scoped lang="less">
@import '../assets/less/index';

.video-list-item {
  background: var(--main-bg);
  padding: 16rem var(--page-padding);
  border-bottom: 8rem solid rgba(255, 255, 255, 0.05);
  cursor: pointer;

  &:active {
    background: rgba(255, 255, 255, 0.05);
  }

  .author-info {
    display: flex;
    align-items: center;
    margin-bottom: 12rem;

    .avatar {
      width: 40rem;
      height: 40rem;
      border-radius: 50%;
      object-fit: cover;
      margin-right: 10rem;
    }

    .author-details {
      flex: 1;
      min-width: 0;

      .nickname {
        color: white;
        font-size: 15rem;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .username {
        color: var(--second-text-color);
        font-size: 12rem;
        margin-top: 2rem;
      }
    }

    .follow-btn {
      padding: 6rem 16rem;
      background: var(--primary-btn-color);
      color: white;
      border: none;
      border-radius: 4rem;
      font-size: 13rem;
      cursor: pointer;
      flex-shrink: 0;

      &:active {
        opacity: 0.8;
      }
    }
  }

  .description {
    color: white;
    font-size: 14rem;
    line-height: 1.5;
    margin-bottom: 12rem;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }

  .hot-comment {
    margin-top: 10rem;
    padding: 0;

    .comment-wrapper {
      font-size: 13rem;
      line-height: 1.5;
      color: rgba(255, 255, 255, 0.9);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;

      .label {
        display: inline-block;
        background: rgba(255, 44, 85, 0.8); // 抖音红半透明
        color: white;
        font-size: 10rem;
        padding: 0 4rem;
        border-radius: 2rem;
        margin-right: 6rem;
        vertical-align: middle;
        height: 16rem;
        line-height: 17rem;

        &.new {
          background: rgba(255, 255, 255, 0.2);
          color: rgba(255, 255, 255, 0.9);
        }
      }

      .nickname {
        color: rgba(255, 255, 255, 0.6);
        font-weight: 500;
      }

      .content {
        color: rgba(255, 255, 255, 0.9);
      }

      .likes {
        margin-left: 8rem;
        color: rgba(255, 255, 255, 0.4);
        font-size: 12rem;

        i {
          font-style: normal;
        }
      }
    }
  }

  .video-cover {
    position: relative;
    width: 100%;
    padding-top: 133.33%; /* 3:4 宽高比 */
    border-radius: 8rem;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.05);

    .cover-image {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .video-info {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 10rem;
      background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
      display: flex;
      justify-content: space-between;
      align-items: flex-end;

      .stats {
        display: flex;
        gap: 12rem;
        color: white;
        font-size: 13rem;

        .stat-item {
          display: flex;
          align-items: center;
          gap: 4rem;

          i {
            font-style: normal;
            font-size: 12rem;
          }

          .icon-play {
            opacity: 0.9;
          }

          .icon-like {
            color: #ff4d4f;
          }
        }
      }

      .duration {
        color: white;
        font-size: 12rem;
        background: rgba(0, 0, 0, 0.5);
        padding: 2rem 6rem;
        border-radius: 3rem;
      }
    }
  }
}
</style>
