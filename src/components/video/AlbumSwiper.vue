<template>
  <div
    class="album-swiper"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @click="$emit('click')"
  >
    <!-- 图片容器 -->
    <div class="swiper-container" :style="swiperStyle" :class="{ transitioning: isTransitioning }">
      <div v-for="(image, index) in images" :key="index" class="swiper-slide">
        <img
          :src="getImageUrl(image)"
          class="slide-image"
          @load="onImageLoad(index)"
          @error="onImageError(index)"
        />
      </div>
    </div>

    <!-- 左上角类型标识 + 页码 -->
    <div class="content-type-badge">
      <span class="badge-icon">📷</span>
      <span class="badge-text">{{ currentIndex + 1 }}/{{ images.length }}</span>
    </div>

    <!-- 底部指示器 -->
    <div class="swiper-pagination" v-if="images.length > 1">
      <div
        v-for="(_, index) in images"
        :key="index"
        class="pagination-dot"
        :class="{ active: index === currentIndex }"
        @click.stop="goToSlide(index)"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { buildCdnUrl } from '@/utils/media'

interface ImageItem {
  file_id: string
  url?: string // 🎯 后端返回的完整 CDN URL
  width?: number
  height?: number
  order?: number
}

interface Props {
  images: ImageItem[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  click: []
}>()

const currentIndex = ref(0)
const isTransitioning = ref(false)
const loadedImages = reactive<Set<number>>(new Set())

// 触摸状态
const touch = reactive({
  startX: 0,
  deltaX: 0,
  active: false
})

// 滑动容器样式
const swiperStyle = computed(() => {
  const baseOffset = -currentIndex.value * 100
  const dragOffset = touch.active ? (touch.deltaX / window.innerWidth) * 100 : 0
  return {
    transform: `translateX(${baseOffset + dragOffset}%)`
  }
})

function getImageUrl(image: ImageItem) {
  // 🎯 优先使用后端返回的完整 URL，否则尝试构建
  if (image.url) return image.url
  return buildCdnUrl(image.file_id)
}

function onImageLoad(index: number) {
  loadedImages.add(index)
}

function onImageError(index: number) {
  console.error('[AlbumSwiper] 图片加载失败:', index)
}

function goToSlide(index: number) {
  if (index === currentIndex.value) return
  isTransitioning.value = true
  currentIndex.value = index
  setTimeout(() => {
    isTransitioning.value = false
  }, 300)
}

// 触摸事件
function onTouchStart(e: TouchEvent) {
  touch.startX = e.touches[0].clientX
  touch.deltaX = 0
  touch.active = true
  isTransitioning.value = false
}

function onTouchMove(e: TouchEvent) {
  if (!touch.active) return
  const currentX = e.touches[0].clientX
  touch.deltaX = currentX - touch.startX

  // 边界处理：第一张向右滑、最后一张向左滑时增加阻尼
  if (currentIndex.value === 0 && touch.deltaX > 0) {
    touch.deltaX = touch.deltaX * 0.3
  }
  if (currentIndex.value === props.images.length - 1 && touch.deltaX < 0) {
    touch.deltaX = touch.deltaX * 0.3
  }
}

function onTouchEnd() {
  if (!touch.active) return
  touch.active = false

  const threshold = window.innerWidth * 0.2 // 20% 阈值

  if (touch.deltaX < -threshold && currentIndex.value < props.images.length - 1) {
    // 向左滑 -> 下一张
    goToSlide(currentIndex.value + 1)
  } else if (touch.deltaX > threshold && currentIndex.value > 0) {
    // 向右滑 -> 上一张
    goToSlide(currentIndex.value - 1)
  } else {
    // 回弹
    isTransitioning.value = true
    setTimeout(() => {
      isTransitioning.value = false
    }, 300)
  }

  touch.deltaX = 0
}
</script>

<style scoped lang="less">
.album-swiper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: black;
}

.swiper-container {
  display: flex;
  height: 100%;
  will-change: transform;

  &.transitioning {
    transition: transform 0.3s ease-out;
  }
}

.swiper-slide {
  flex-shrink: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.slide-image {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
}

.content-type-badge {
  position: absolute;
  top: 60px;
  left: 12px;
  background: rgba(0, 0, 0, 0.5);
  padding: 4px 10px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  z-index: 10;
  color: white;
  font-size: 12px;

  .badge-icon {
    font-size: 14px;
  }

  .badge-text {
    font-weight: 500;
  }
}

.swiper-pagination {
  position: absolute;
  bottom: 120px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  z-index: 10;
}

.pagination-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.4);
  transition: all 0.3s ease;
  cursor: pointer;

  &.active {
    background: white;
    width: 18px;
    border-radius: 3px;
  }
}
</style>
