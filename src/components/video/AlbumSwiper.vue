<template>
  <div
    class="album-swiper"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @mouseleave="onMouseUp"
  >
    <!-- 图片容器 -->
    <div class="swiper-container" :style="swiperStyle" :class="{ transitioning: isTransitioning }">
      <div v-for="(image, index) in images" :key="index" class="swiper-slide">
        <img
          :src="getImageUrl(image)"
          class="slide-image"
          @load="onImageLoad(index)"
          @error="onImageError(index)"
          draggable="false"
        />
      </div>
    </div>

    <!-- 左上角类型标识 + 页码（毛玻璃效果） -->
    <div class="content-type-badge">
      <span class="badge-text">相册 {{ currentIndex + 1 }}/{{ images.length }}</span>
    </div>

    <!-- 点击查看高清提示 -->
    <div class="hd-tip" @click.stop="openPreview(currentIndex)">
      <Icon icon="mdi:magnify-plus" />
      <span>查看高清</span>
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

    <!-- 高清预览弹窗 -->
    <ImagePreview v-model:visible="showPreview" :images="images" :initial-index="previewIndex" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { Icon } from '@iconify/vue'
import { buildCdnUrl } from '@/utils/media'
import ImagePreview from './ImagePreview.vue'

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
  reachedLast: [] // 🎯 滑到最后一张时触发
}>()

const currentIndex = ref(0)
const showPreview = ref(false)
const previewIndex = ref(0)

// 🎯 打开高清预览
function openPreview(index: number) {
  previewIndex.value = index
  showPreview.value = true
}
const isTransitioning = ref(false)
const loadedImages = reactive<Set<number>>(new Set())

// 触摸状态
const touch = reactive({
  startX: 0,
  startY: 0,
  deltaX: 0,
  deltaY: 0,
  active: false,
  isHorizontal: false // 🎯 是否判定为水平滑动（用于屏蔽父级的上下滑动）
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
  // 🎯 滑到最后一张时触发完播事件
  if (index === props.images.length - 1) {
    emit('reachedLast')
  }
}

// 触摸事件
function onTouchStart(e: TouchEvent) {
  const t = e.touches[0]
  touch.startX = t.clientX
  touch.startY = t.clientY
  touch.deltaX = 0
  touch.deltaY = 0
  touch.active = true
  touch.isHorizontal = false
  isTransitioning.value = false
}

function onTouchMove(e: TouchEvent) {
  if (!touch.active) return
  const t = e.touches[0]
  touch.deltaX = t.clientX - touch.startX
  touch.deltaY = t.clientY - touch.startY

  // 🎯 一旦判定为水平滑动，则阻止事件冒泡给父级（避免触发 feed 的上下滑动）
  if (!touch.isHorizontal) {
    const absX = Math.abs(touch.deltaX)
    const absY = Math.abs(touch.deltaY)
    // 💡 优化判定：水平位移需超过 15px，且明显大于垂直位移（2倍关系），才认定为切图操作
    if (absX > 15 && absX > absY * 2) {
      touch.isHorizontal = true
    }
  }

  if (touch.isHorizontal) {
    e.stopPropagation()
  }

  // 边界处理：第一张向右滑、最后一张向左滑时增加阻尼
  if (currentIndex.value === 0 && touch.deltaX > 0) {
    touch.deltaX = touch.deltaX * 0.3
  }
  if (currentIndex.value === props.images.length - 1 && touch.deltaX < 0) {
    touch.deltaX = touch.deltaX * 0.3
  }
}

function onTouchEnd(e: TouchEvent) {
  if (!touch.active) return
  if (touch.isHorizontal) {
    e.stopPropagation()
  }
  touch.active = false
  finishSwipe()
}

// 🖱️ 鼠标事件
function onMouseDown(e: MouseEvent) {
  e.preventDefault() // 阻止拖拽图片
  touch.startX = e.clientX
  touch.deltaX = 0
  touch.active = true
  isTransitioning.value = false
}

function onMouseMove(e: MouseEvent) {
  if (!touch.active) return
  const currentX = e.clientX
  touch.deltaX = currentX - touch.startX

  // 边界处理
  if (currentIndex.value === 0 && touch.deltaX > 0) {
    touch.deltaX = touch.deltaX * 0.3
  }
  if (currentIndex.value === props.images.length - 1 && touch.deltaX < 0) {
    touch.deltaX = touch.deltaX * 0.3
  }
}

function onMouseUp() {
  if (!touch.active) return
  touch.active = false
  finishSwipe()
}

// 🎯 完成滑动（触摸和鼠标共用）
function finishSwipe() {
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
  // 🎯 强制 GPU 渲染，解决 Windows 上滑动无动画问题
  will-change: transform;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  transform: translateZ(0);
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
  // 🎯 毛玻璃效果
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 6px 12px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  z-index: 10;
  color: white;
  font-size: 13px;

  .badge-text {
    font-weight: 500;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
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

// 🎯 查看高清按钮
.hd-tip {
  position: absolute;
  bottom: 200px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 8px 16px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 80;
  color: white;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  &:active {
    transform: translateX(-50%) scale(0.95);
  }
}
</style>
