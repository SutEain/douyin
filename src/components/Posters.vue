<template>
  <div class="posters">
    <div class="poster-item" :key="index" v-for="(i, index) in list" @click="goDetail(index)">
      <img
        class="poster"
        v-lazy="buildCdnUrl(i.video.cover.url_list[0])"
        @error="(e) => _handleImageError(e)"
        alt=""
      />
      <template v-if="mode === 'normal'">
        <div class="num">
          <Icon icon="icon-park-outline:like" />
          <span>{{ _formatNumber(i.statistics.digg_count) }}</span>
        </div>
        <!-- 🎯 播放量：仅在 Me 页作品列表（showLabels=true）显示 -->
        <div class="views" v-if="showLabels">
          <Icon icon="mdi:eye-outline" />
          <span>{{ _formatNumber(i.view_count || 0) }}</span>
        </div>
        <!-- 🎯 内容类型标识：图片/相册 -->
        <div class="content-type-badge" v-if="i.content_type === 'image'">
          <Icon icon="solar:gallery-bold" />
        </div>
        <div class="content-type-badge album" v-if="i.content_type === 'album'">
          <Icon icon="solar:album-bold" />
          <span v-if="i.images?.length">{{ i.images.length }}</span>
        </div>
        <div class="content-type-badge collection" v-if="i.content_type === 'collection'">
          <Icon icon="solar:box-minimalistic-bold" />
          <span v-if="i.media_list?.length">{{ i.media_list.length }}</span>
          <span v-else-if="i.images?.length">{{ i.images.length }}</span>
        </div>
        <!-- 🎯 只在 showLabels=true 时显示标签 -->
        <template v-if="showLabels">
          <div class="top" v-if="i.is_top">置顶</div>
          <!-- ✅ 草稿标签 (status = draft 或 ready) -->
          <div class="draft" v-if="i.status === 'draft' || i.status === 'ready'">草稿</div>
          <!-- ✅ 私密标签 (is_private = true) -->
          <div class="private" v-if="i.is_private">私密</div>
        </template>
      </template>
      <div class="date" v-if="mode === 'date'">
        <div class="day">{{ getDay(i.create_time) }}</div>
        <div class="month">{{ getMonth(i.create_time) }}</div>
      </div>
      <template v-if="mode === 'music'">
        <div class="music" v-if="index === 0">首发</div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { _formatNumber, _handleImageError } from '@/utils'
import { buildCdnUrl } from '@/utils/media'
import { useBaseStore } from '@/store/pinia'
import { useRouter } from 'vue-router'
import { cloneDeep } from '@/utils'
import { Icon } from '@iconify/vue'

const store = useBaseStore()
const nav = useRouter()
const props = defineProps({
  list: {
    type: [Array, Number],
    default: () => {
      return []
    }
  },
  mode: {
    type: String,
    default: 'normal' //date,music
  },
  showLabels: {
    type: Boolean,
    default: false // 🎯 默认不显示草稿/置顶/私密标签
  }
})

defineOptions({
  name: 'Posters'
})

function goDetail(index) {
  // 传递列表和当前位置，便于详情页三槽位滑动
  const videoItem = props.list[index]
  store.routeData = cloneDeep({ items: props.list, index, item: videoItem })
  nav.push({ path: '/video-detail' })
}

function getDay(time) {
  let date = new Date(time * 1000)
  return date.getDate()
}

function getMonth(time) {
  let date = new Date(time * 1000)
  let month = date.getMonth() + 1
  switch (month) {
    case 1:
      return '一月'
    case 2:
      return '二月'
    case 3:
      return '三月'
    case 4:
      return '四月'
    case 5:
      return '五月'
    case 6:
      return '六月'
    case 7:
      return '七月'
    case 8:
      return '八月'
    case 9:
      return '九月'
    case 10:
      return '十月'
    case 11:
      return '十一月'
    case 12:
      return '十二月'
  }
}
</script>

<style scoped lang="less">
.posters {
  display: grid;
  grid-template-columns: 33.33% 33.33% 33.33%;
}

.poster-item {
  height: 200rem;
  max-height: calc(33.33vw * 1.3);
  border: 0.5px solid black;
  overflow: hidden;
  position: relative;

  .poster {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }

  .top,
  .music,
  .draft,
  .private {
    position: absolute;
    font-size: 12rem;
    padding: 2rem 3rem;
    border-radius: 2rem;
  }

  .top,
  .music {
    background: gold;
    color: black;
    top: 7rem;
    left: 7rem;
  }

  .draft {
    background: rgba(255, 165, 0, 0.9); // 橙色背景 - 草稿
    color: white;
    top: 7rem;
    right: 7rem;
  }

  .private {
    background: rgba(128, 128, 128, 0.9); // 灰色背景 - 私密
    color: white;
    bottom: 35rem;
    left: 7rem;
  }

  .num {
    color: white;
    position: absolute;
    bottom: 5rem;
    left: 5rem;
    display: flex;
    align-items: center;
    font-size: 14rem;
    gap: 3rem;

    .love {
      width: 14rem;
      height: 14rem;
      margin-right: 5rem;
    }
  }

  .views {
    color: white;
    position: absolute;
    bottom: 5rem;
    right: 5rem;
    display: flex;
    align-items: center;
    font-size: 14rem;
    gap: 3rem;
  }

  // 🎯 图片/相册类型标识
  .content-type-badge {
    position: absolute;
    top: 7rem;
    right: 7rem;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    padding: 3rem 6rem;
    border-radius: 4rem;
    font-size: 12rem;
    display: flex;
    align-items: center;
    gap: 3rem;

    &.album {
      span {
        font-size: 10rem;
      }
    }

    &.collection {
      background: rgba(114, 46, 209, 0.8); // 紫色背景
      span {
        font-size: 10rem;
      }
    }
  }

  .date {
    position: absolute;
    top: 5rem;
    left: 5rem;
    display: flex;
    align-items: center;
    flex-direction: column;
    font-size: 14rem;
    color: black;
    background: white;
    padding: 6rem;
    border-radius: 6rem;

    .day {
      font-weight: bold;
    }

    .month {
      font-size: 10rem;
    }
  }
}
</style>
