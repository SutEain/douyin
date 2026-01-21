<script setup lang="ts">
import { computed, inject, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { _truncate } from '@/utils'

const props = defineProps({
  isMy: {
    type: Boolean,
    default: () => {
      return false
    }
  },
  isLive: {
    type: Boolean,
    default: () => {
      return false
    }
  }
})

const emit = defineEmits<{
  goUserInfo: []
  viewDetail: []
}>()

const item = inject<any>('item')

const { t } = useI18n()

const state = reactive({
  isAttention: false,
  test: [1, 2],
  expanded: false
})

const currentItem = computed(() => {
  if (!item) return {}
  return 'value' in (item as any) ? (item as any).value || {} : item
})

const normalizedTags = computed(() => {
  const tags = currentItem.value?.tags || []
  if (!Array.isArray(tags)) return []
  return tags
    .map((tag: string) => String(tag || '').trim())
    .filter(Boolean)
    .map((tag: string) => (tag.startsWith('#') ? tag : `#${tag}`))
})

const fullDescription = computed(() => {
  const desc = currentItem.value?.desc ?? ''
  const parts = [desc?.trim()]
  if (normalizedTags.value.length) {
    parts.push(normalizedTags.value.join(' '))
  }
  const fullText = parts.filter(Boolean).join(' ').trim()
  // ✅ 移除字数限制，允许完整显示
  return fullText
})

const showToggle = computed(() => fullDescription.value.length > 100)

const isGraphic = computed(() => {
  const t = String(currentItem.value?.content_type || 'video')
  return t === 'image' || t === 'album' || t === 'collection'
})

// 🎯 合辑（collection）不显示"查看详情"按钮
const isCollection = computed(() => {
  const t = String(currentItem.value?.content_type || 'video')
  return t === 'collection'
})

const showViewDetail = computed(
  () => showToggle.value && state.expanded && isGraphic.value && !isCollection.value
)

function formatBeijingDate(date: Date) {
  // 输出 YYYY-MM-DD（北京时间）
  const s = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
  // zh-CN 通常是 YYYY/MM/DD，这里统一为 YYYY-MM-DD
  return s.replace(/\//g, '-')
}

const publishDate = computed(() => {
  const t = Number(currentItem.value?.create_time)
  if (!Number.isFinite(t) || t <= 0) return ''
  // create_time 既可能是秒，也可能是毫秒
  const ms = t < 1e12 ? t * 1000 : t
  return formatBeijingDate(new Date(ms))
})
</script>
<template>
  <div class="item-desc ml1r mb1r">
    <div class="content" v-if="!props.isMy">
      <div class="location-wrapper" v-if="item.city || item.address">
        <div class="location">
          <img src="../../assets/img/icon/location.webp" alt="" />
          <span>{{ item.city }}</span>
          <template v-if="item.address">
            <div class="gang"></div>
          </template>
          <span>{{ item.address }}</span>
        </div>
      </div>
      <div class="live" v-if="props.isLive">直播中</div>
      <div class="name mb1r f18 fb" @click.stop="emit('goUserInfo')">
        @{{ _truncate(item?.author?.nickname, 15) }}
      </div>
      <div v-if="publishDate" class="publish-date">发布于 {{ publishDate }}</div>
      <div
        class="description-wrapper"
        v-if="fullDescription"
        @touchstart.stop="state.expanded && $event.stopPropagation()"
        @touchmove.stop="state.expanded && $event.stopPropagation()"
        @touchend.stop="state.expanded && $event.stopPropagation()"
        @mousedown.stop="state.expanded && $event.stopPropagation()"
        @mousemove.stop="state.expanded && $event.stopPropagation()"
        @mouseup.stop="state.expanded && $event.stopPropagation()"
        @wheel.stop="state.expanded && $event.stopPropagation()"
      >
        <div
          class="description"
          :class="{ collapsed: !state.expanded && showToggle }"
          @touchstart.stop="state.expanded && $event.stopPropagation()"
          @touchmove.stop="state.expanded && $event.stopPropagation()"
          @mousedown.stop="state.expanded && $event.stopPropagation()"
          @mousemove.stop="state.expanded && $event.stopPropagation()"
          @wheel.stop="state.expanded && $event.stopPropagation()"
        >
          {{ fullDescription }}
        </div>
        <div class="desc-actions" v-if="showToggle || showViewDetail">
          <span
            class="view-detail"
            v-if="showViewDetail"
            @click.stop.prevent="emit('viewDetail')"
            @touchend.stop.prevent="emit('viewDetail')"
          >
            查看详情
          </span>
          <span
            class="toggle-desc"
            v-if="showToggle"
            @click.stop.prevent="state.expanded = !state.expanded"
            @touchend.stop.prevent="state.expanded = !state.expanded"
          >
            {{ state.expanded ? '收起 ▲' : '展开 ▼' }}
          </span>
        </div>
      </div>
      <!--      <div class="music" @click.stop="bus.emit('nav','/home/music')">-->
      <!--        <img src="../../assets/img/icon/music.svg" alt="" class="music-image">-->
      <!--        <span>{{ item.music.title }}</span>-->
      <!--      </div>-->
    </div>
    <div v-else class="comment-status">
      <div class="comment">
        <div class="type-comment">
          <img src="../../assets/img/icon/head-image.jpeg" alt="" class="avatar" />
          <div class="right">
            <p>
              <span class="name">zzzzz</span>
              <span class="time">2020-01-20</span>
            </p>
            <p class="text">北京</p>
          </div>
        </div>
        <transition-group name="comment-status" tag="div" class="loveds">
          <div class="type-loved" :key="i" v-for="i in state.test">
            <img src="../../assets/img/icon/head-image.jpeg" alt="" class="avatar" />
            <img src="../../assets/img/icon/love.svg" alt="" class="loved" />
          </div>
        </transition-group>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.item-desc {
  position: absolute;
  // 🎯 容器已减去 footer 高度，此处只需常规偏移
  bottom: 20rem !important;
  z-index: 1001;
  width: 76%;

  .content {
    color: #fff;
    text-align: left;

    .publish-date {
      font-size: 12rem;
      color: rgba(255, 255, 255, 0.65);
      margin-top: -6rem;
      margin-bottom: 8rem;
    }

    .location-wrapper {
      display: flex;

      .location {
        margin-bottom: 10rem;

        display: flex;
        align-items: center;
        font-size: 12rem;
        padding: 4rem;
        border-radius: 3rem;
        background: var(--second-btn-color-tran);

        .gang {
          height: 8rem;
          width: 1.5px;
          margin: 0 5rem;
          background: gray;
        }

        img {
          margin-right: 7rem;
          width: 18rem;
        }
      }
    }

    .live {
      border-radius: 3rem;
      margin-bottom: 10rem;
      padding: 3rem 6rem;
      font-size: 11rem;
      display: inline-flex;
      background: var(--primary-btn-color);
      color: white;
    }

    .description-wrapper {
      position: relative;
      margin-bottom: 8rem;
      padding-right: 80rem; // ✅ 给按钮留出空间
    }

    .desc-actions {
      position: absolute;
      right: -30rem; // ✅ 靠左移动一点 (原为 -40px，即约 -40rem)
      bottom: 40rem; // ✅ 与原“展开/收起”位置对齐
      display: flex;
      flex-direction: column;
      gap: 8rem;
      z-index: 60; // ✅ 高于进度条热区(50)，与静音icon同级
    }

    // ✅ 提升白色视频上的可读性：描述区域加渐变遮罩
    .description-wrapper::before {
      content: '';
      position: absolute;
      width: 100vw;
      // 🎯 修复：父级容器有 ml1r (约 10rem)，我们需要向左偏移回来以铺满全屏
      left: calc(-1 * var(--record-ml, 10rem));
      top: -60rem; // 向上延伸更多，让渐变极度柔和
      bottom: -40rem;
      background: linear-gradient(
        to bottom,
        rgba(0, 0, 0, 0) 0%,
        rgba(0, 0, 0, 0.1) 20%,
        rgba(0, 0, 0, 0.4) 60%,
        rgba(0, 0, 0, 0.7) 100%
      );
      pointer-events: none;
      z-index: 0;
    }

    .description {
      font-size: 14rem;
      line-height: 1.4;
      white-space: pre-line;
      word-break: break-word;
      position: relative;
      z-index: 1;
      // ✅ 展开后允许在限定高度内滚动，避免过长覆盖屏幕
      max-height: 50vh;
      overflow-y: auto;
      // 🎯 优化滚动条样式（极简）
      &::-webkit-scrollbar {
        width: 2px;
      }
      &::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 1px;
      }

      &.collapsed {
        display: -webkit-box;
        -webkit-line-clamp: 4;
        line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
        max-height: none;
      }
    }

    .toggle-desc {
      position: relative;
      font-size: 14rem;
      color: rgba(255, 255, 255, 0.9);
      cursor: pointer;
      padding: 8rem 12rem;
      white-space: nowrap;
      user-select: none;
      background: transparent; // 🎯 移除背景色，靠底部的渐变层来衬托
      border-radius: 4rem;
      min-width: 64rem;
      text-align: center;

      &:active {
        opacity: 0.8;
        background: rgba(255, 255, 255, 0.1); // 仅点击时有微弱反馈
      }
    }

    .view-detail {
      position: relative;
      font-size: 14rem;
      color: rgba(255, 255, 255, 0.9);
      cursor: pointer;
      padding: 8rem 12rem;
      white-space: nowrap;
      user-select: none;
      background: transparent; // 🎯 移除背景色
      border-radius: 4rem;
      min-width: 64rem;
      text-align: center;

      &:active {
        opacity: 0.8;
        background: rgba(255, 255, 255, 0.1);
      }
    }

    .music {
      position: relative;
      display: flex;
      align-items: center;

      .music-image {
        width: 20px;
        height: 20px;
      }
    }
  }

  .comment-status {
    display: flex;
    align-items: center;

    .comment {
      .type-comment {
        display: flex;
        background: rgb(130, 21, 44);
        border-radius: 50px;
        padding: 3px;
        margin-bottom: 20px;

        .avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
        }

        .right {
          margin: 0 10px;
          color: var(--second-text-color);

          .name {
            margin-right: 10px;
          }

          .text {
            color: white;
          }
        }
      }

      .type-loved {
        width: 40px;
        height: 40px;
        position: relative;
        margin-bottom: 20px;
        animation: test 1s;
        animation-delay: 0.5s;

        .avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
        }

        .loved {
          position: absolute;
          bottom: 0;
          left: 20px;
          width: 10px;
          height: 10px;
          background: red;
          padding: 3px;
          border-radius: 50%;
          border: 2px solid white;
        }
      }

      @keyframes test {
        from {
          display: block;
          transform: translate3d(0, 0, 0);
        }
        to {
          display: none;
          transform: translate3d(0, -60px, 0);
        }
      }
    }
  }
}
</style>
