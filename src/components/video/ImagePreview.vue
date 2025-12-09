<template>
  <Teleport to="body">
    <transition name="fade">
      <div v-if="visible" class="image-preview-overlay" @click="handleClose">
        <!-- 关闭按钮 -->
        <div class="close-btn" @click.stop="handleClose">
          <Icon icon="mdi:close" />
        </div>

        <!-- 图片计数 -->
        <div class="image-counter" v-if="images.length > 1">
          {{ currentIndex + 1 }} / {{ images.length }}
        </div>

        <!-- 图片容器 -->
        <div
          class="preview-container"
          @touchstart="onTouchStart"
          @touchmove="onTouchMove"
          @touchend="onTouchEnd"
          @mousedown="onMouseDown"
          @mousemove="onMouseMove"
          @mouseup="onMouseUp"
          @mouseleave="onMouseUp"
          @click.stop
        >
          <div
            class="preview-wrapper"
            :style="wrapperStyle"
            :class="{ transitioning: isTransitioning }"
          >
            <div v-for="(image, index) in images" :key="index" class="preview-slide">
              <img
                :src="getImageUrl(image)"
                class="preview-image"
                :class="{ zoomed: isZoomed && index === currentIndex }"
                @load="onImageLoad(index)"
                @click.stop="toggleZoom"
                draggable="false"
              />
            </div>
          </div>
        </div>

        <!-- 左右切换按钮（PC端） -->
        <div
          class="nav-btn nav-prev"
          v-if="images.length > 1 && currentIndex > 0"
          @click.stop="prevImage"
        >
          <Icon icon="mdi:chevron-left" />
        </div>
        <div
          class="nav-btn nav-next"
          v-if="images.length > 1 && currentIndex < images.length - 1"
          @click.stop="nextImage"
        >
          <Icon icon="mdi:chevron-right" />
        </div>

        <!-- 底部提示 -->
        <div class="preview-tip">
          {{ isZoomed ? '点击缩小' : '点击放大 · 左右滑动切换' }}
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { buildCdnUrl } from '@/utils/media'

interface ImageItem {
  file_id: string
  url?: string
  width?: number
  height?: number
}

interface Props {
  visible: boolean
  images: ImageItem[]
  initialIndex?: number
}

const props = withDefaults(defineProps<Props>(), {
  initialIndex: 0
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const currentIndex = ref(props.initialIndex)
const isTransitioning = ref(false)
const isZoomed = ref(false)
const loadedImages = reactive<Set<number>>(new Set())

// 触摸状态
const touch = reactive({
  startX: 0,
  startY: 0,
  deltaX: 0,
  active: false
})

// 监听 visible 变化，重置状态
watch(
  () => props.visible,
  (val) => {
    if (val) {
      currentIndex.value = props.initialIndex
      isZoomed.value = false
    }
  }
)

// 监听 initialIndex 变化
watch(
  () => props.initialIndex,
  (val) => {
    currentIndex.value = val
  }
)

// 滑动容器样式
const wrapperStyle = computed(() => {
  const baseOffset = -currentIndex.value * 100
  const dragOffset = touch.active && !isZoomed.value ? (touch.deltaX / window.innerWidth) * 100 : 0
  return {
    transform: `translateX(${baseOffset + dragOffset}%)`
  }
})

function getImageUrl(image: ImageItem) {
  if (image.url) return image.url
  return buildCdnUrl(image.file_id)
}

function onImageLoad(index: number) {
  loadedImages.add(index)
}

function handleClose() {
  emit('update:visible', false)
}

function toggleZoom() {
  isZoomed.value = !isZoomed.value
}

function goToSlide(index: number) {
  if (index === currentIndex.value) return
  if (index < 0 || index >= props.images.length) return
  isTransitioning.value = true
  currentIndex.value = index
  setTimeout(() => {
    isTransitioning.value = false
  }, 300)
}

function prevImage() {
  if (currentIndex.value > 0) {
    goToSlide(currentIndex.value - 1)
  }
}

function nextImage() {
  if (currentIndex.value < props.images.length - 1) {
    goToSlide(currentIndex.value + 1)
  }
}

// 触摸事件
function onTouchStart(e: TouchEvent) {
  if (isZoomed.value) return
  touch.startX = e.touches[0].clientX
  touch.startY = e.touches[0].clientY
  touch.deltaX = 0
  touch.active = true
  isTransitioning.value = false
}

function onTouchMove(e: TouchEvent) {
  if (!touch.active || isZoomed.value) return
  const currentX = e.touches[0].clientX
  touch.deltaX = currentX - touch.startX

  // 边界阻尼
  if (currentIndex.value === 0 && touch.deltaX > 0) {
    touch.deltaX = touch.deltaX * 0.3
  }
  if (currentIndex.value === props.images.length - 1 && touch.deltaX < 0) {
    touch.deltaX = touch.deltaX * 0.3
  }
}

function onTouchEnd() {
  if (!touch.active || isZoomed.value) return
  touch.active = false
  finishSwipe()
}

// 鼠标事件
function onMouseDown(e: MouseEvent) {
  if (isZoomed.value) return
  e.preventDefault()
  touch.startX = e.clientX
  touch.deltaX = 0
  touch.active = true
  isTransitioning.value = false
}

function onMouseMove(e: MouseEvent) {
  if (!touch.active || isZoomed.value) return
  touch.deltaX = e.clientX - touch.startX

  if (currentIndex.value === 0 && touch.deltaX > 0) {
    touch.deltaX = touch.deltaX * 0.3
  }
  if (currentIndex.value === props.images.length - 1 && touch.deltaX < 0) {
    touch.deltaX = touch.deltaX * 0.3
  }
}

function onMouseUp() {
  if (!touch.active || isZoomed.value) return
  touch.active = false
  finishSwipe()
}

function finishSwipe() {
  const threshold = window.innerWidth * 0.15

  if (touch.deltaX < -threshold && currentIndex.value < props.images.length - 1) {
    goToSlide(currentIndex.value + 1)
  } else if (touch.deltaX > threshold && currentIndex.value > 0) {
    goToSlide(currentIndex.value - 1)
  } else {
    isTransitioning.value = true
    setTimeout(() => {
      isTransitioning.value = false
    }, 300)
  }

  touch.deltaX = 0
}
</script>

<style scoped lang="less">
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.image-preview-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.95);
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 10;
  color: white;
  font-size: 24px;
  transition: background 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.3);
  }
}

.image-counter {
  position: absolute;
  top: 28px;
  left: 50%;
  transform: translateX(-50%);
  color: white;
  font-size: 16px;
  font-weight: 500;
  z-index: 10;
}

.preview-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.preview-wrapper {
  display: flex;
  height: 100%;
  will-change: transform;

  &.transitioning {
    transition: transform 0.3s ease-out;
  }
}

.preview-slide {
  flex-shrink: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  cursor: zoom-in;
  transition: transform 0.3s ease;

  &.zoomed {
    cursor: zoom-out;
    transform: scale(1.5);
  }
}

.nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 50px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: white;
  font-size: 40px;
  opacity: 0.6;
  transition: opacity 0.2s;
  z-index: 10;

  &:hover {
    opacity: 1;
  }

  &.nav-prev {
    left: 10px;
  }

  &.nav-next {
    right: 10px;
  }
}

.preview-tip {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  z-index: 10;
}
</style>
