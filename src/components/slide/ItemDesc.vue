<script setup lang="ts">
import { computed, inject, reactive } from 'vue'
import { useI18n } from 'vue-i18n'

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
  // ✅ 限制最多 300 字
  return fullText.length > 300 ? fullText.substring(0, 300) + '...' : fullText
})

const showToggle = computed(() => fullDescription.value.length > 100)
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
      <div class="name mb1r f18 fb" @click.stop="$emit('goUserInfo')">
        @{{ item?.author?.nickname }}
      </div>
      <div class="description-wrapper" v-if="fullDescription">
        <div class="description" :class="{ collapsed: !state.expanded && showToggle }">
          {{ fullDescription }}
        </div>
        <span
          class="toggle-desc"
          v-if="showToggle"
          @click.stop.prevent="state.expanded = !state.expanded"
          @touchend.stop.prevent="state.expanded = !state.expanded"
        >
          {{ state.expanded ? '收起 ▲' : '展开 ▼' }}
        </span>
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
  bottom: 0;
  width: 70%;

  .content {
    color: #fff;
    text-align: left;

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

    .description {
      font-size: 14rem;
      line-height: 1.4;
      white-space: pre-line;
      word-break: break-word;

      &.collapsed {
        display: -webkit-box;
        -webkit-line-clamp: 4;
        line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
    }

    .toggle-desc {
      position: absolute;
      right: -40px;
      bottom: 40px; // ✅ 固定在底部（折叠后的4行文字底部）
      font-size: 14rem;
      color: rgba(255, 255, 255, 0.9);
      cursor: pointer;
      padding: 8rem 12rem;
      white-space: nowrap;
      user-select: none;
      background: rgba(0, 0, 0, 0.15);
      border-radius: 4rem;
      min-width: 64rem;
      text-align: center;
      z-index: 60; // ✅ 高于进度条热区(50)，与静音icon同级

      &:active {
        opacity: 0.8;
        background: rgba(0, 0, 0, 0.3);
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
