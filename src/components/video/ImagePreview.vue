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
          ref="containerRef"
          @touchstart="onTouchStart"
          @touchmove="onTouchMove"
          @touchend="onTouchEnd"
          @mousedown="onMouseDown"
          @mousemove="onMouseMove"
          @mouseup="onMouseUp"
          @mouseleave="onMouseUp"
          @wheel.prevent="onWheel"
          @click.stop
        >
          <div
            class="preview-wrapper"
            :style="wrapperStyle"
            :class="{ transitioning: isTransitioning && !isZoomed }"
          >
            <div v-for="(image, index) in images" :key="index" class="preview-slide">
              <div
                class="image-wrapper"
                :style="index === currentIndex ? imageWrapperStyle : {}"
                :class="{ 'zoom-transitioning': zoomTransitioning && index === currentIndex }"
              >
                <img
                  :src="getImageUrl(image)"
                  class="preview-image"
                  @load="onImageLoad(index)"
                  @dblclick.stop="toggleZoom"
                  draggable="false"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- 左右切换按钮（PC端，非放大状态） -->
        <div
          class="nav-btn nav-prev"
          v-if="images.length > 1 && currentIndex > 0 && !isZoomed"
          @click.stop="prevImage"
        >
          <Icon icon="mdi:chevron-left" />
        </div>
        <div
          class="nav-btn nav-next"
          v-if="images.length > 1 && currentIndex < images.length - 1 && !isZoomed"
          @click.stop="nextImage"
        >
          <Icon icon="mdi:chevron-right" />
        </div>

        <!-- 缩放按钮 -->
        <div class="zoom-controls">
          <div class="zoom-btn" @click.stop="zoomOut" :class="{ disabled: scale <= 1 }">
            <Icon icon="mdi:minus" />
          </div>
          <div class="zoom-level">{{ Math.round(scale * 100) }}%</div>
          <div class="zoom-btn" @click.stop="zoomIn" :class="{ disabled: scale >= 3 }">
            <Icon icon="mdi:plus" />
          </div>
        </div>

        <!-- 底部提示 -->
        <div class="preview-tip">
          {{ isZoomed ? '拖拽查看 · 双击还原' : '双击放大 · 左右滑动切换' }}
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

const containerRef = ref<HTMLElement | null>(null)
const currentIndex = ref(props.initialIndex)
const isTransitioning = ref(false)
const loadedImages = reactive<Set<number>>(new Set())

// 缩放和平移状态
const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const zoomTransitioning = ref(false)

// 是否处于放大状态
const isZoomed = computed(() => scale.value > 1)

// 触摸/鼠标状态
const touch = reactive({
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  deltaX: 0,
  deltaY: 0,
  active: false,
  pinchDistance: 0
})

// 监听 visible 变化，重置状态
watch(
  () => props.visible,
  (val) => {
    if (val) {
      currentIndex.value = props.initialIndex
      resetZoom()
    }
  }
)

// 监听 initialIndex 变化
watch(
  () => props.initialIndex,
  (val) => {
    currentIndex.value = val
    resetZoom()
  }
)

// 切换图片时重置缩放
watch(currentIndex, () => {
  resetZoom()
})

// 滑动容器样式（用于切换图片）
const wrapperStyle = computed(() => {
  const baseOffset = -currentIndex.value * 100
  const dragOffset = touch.active && !isZoomed.value ? (touch.deltaX / window.innerWidth) * 100 : 0
  return {
    transform: `translateX(${baseOffset + dragOffset}%)`
  }
})

// 图片包装器样式（用于缩放和平移）
const imageWrapperStyle = computed(() => {
  return {
    transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`
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

function resetZoom() {
  zoomTransitioning.value = true
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
  setTimeout(() => {
    zoomTransitioning.value = false
  }, 300)
}

function toggleZoom() {
  zoomTransitioning.value = true
  if (isZoomed.value) {
    // 还原
    scale.value = 1
    translateX.value = 0
    translateY.value = 0
  } else {
    // 放大到 2 倍
    scale.value = 2
  }
  setTimeout(() => {
    zoomTransitioning.value = false
  }, 300)
}

function zoomIn() {
  if (scale.value >= 3) return
  zoomTransitioning.value = true
  scale.value = Math.min(3, scale.value + 0.5)
  setTimeout(() => {
    zoomTransitioning.value = false
  }, 200)
}

function zoomOut() {
  if (scale.value <= 1) return
  zoomTransitioning.value = true
  scale.value = Math.max(1, scale.value - 0.5)
  if (scale.value === 1) {
    translateX.value = 0
    translateY.value = 0
  }
  setTimeout(() => {
    zoomTransitioning.value = false
  }, 200)
}

function onWheel(e: WheelEvent) {
  // 鼠标滚轮缩放
  if (e.deltaY < 0) {
    zoomIn()
  } else {
    zoomOut()
  }
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

// 获取两点之间距离（用于捏合缩放）
function getDistance(touches: TouchList) {
  if (touches.length < 2) return 0
  const dx = touches[0].clientX - touches[1].clientX
  const dy = touches[0].clientY - touches[1].clientY
  return Math.sqrt(dx * dx + dy * dy)
}

// 触摸事件
function onTouchStart(e: TouchEvent) {
  // 双指缩放
  if (e.touches.length === 2) {
    touch.pinchDistance = getDistance(e.touches)
    return
  }

  touch.startX = e.touches[0].clientX
  touch.startY = e.touches[0].clientY
  touch.lastX = translateX.value
  touch.lastY = translateY.value
  touch.deltaX = 0
  touch.deltaY = 0
  touch.active = true
  isTransitioning.value = false
}

function onTouchMove(e: TouchEvent) {
  // 双指缩放
  if (e.touches.length === 2) {
    const newDistance = getDistance(e.touches)
    if (touch.pinchDistance > 0) {
      const ratio = newDistance / touch.pinchDistance
      scale.value = Math.max(1, Math.min(3, scale.value * ratio))
      touch.pinchDistance = newDistance
    }
    return
  }

  if (!touch.active) return

  const currentX = e.touches[0].clientX
  const currentY = e.touches[0].clientY
  touch.deltaX = currentX - touch.startX
  touch.deltaY = currentY - touch.startY

  if (isZoomed.value) {
    // 放大状态：拖拽移动图片
    translateX.value = touch.lastX + touch.deltaX
    translateY.value = touch.lastY + touch.deltaY
  } else {
    // 非放大状态：边界阻尼（用于切换图片）
    if (currentIndex.value === 0 && touch.deltaX > 0) {
      touch.deltaX = touch.deltaX * 0.3
    }
    if (currentIndex.value === props.images.length - 1 && touch.deltaX < 0) {
      touch.deltaX = touch.deltaX * 0.3
    }
  }
}

function onTouchEnd(e: TouchEvent) {
  if (e.touches.length > 0) return // 还有手指在屏幕上

  touch.pinchDistance = 0

  if (!touch.active) return
  touch.active = false

  if (isZoomed.value) {
    // 放大状态：限制边界
    constrainPosition()
  } else {
    // 非放大状态：处理滑动切换
    finishSwipe()
  }
}

// 鼠标事件
function onMouseDown(e: MouseEvent) {
  e.preventDefault()
  touch.startX = e.clientX
  touch.startY = e.clientY
  touch.lastX = translateX.value
  touch.lastY = translateY.value
  touch.deltaX = 0
  touch.deltaY = 0
  touch.active = true
  isTransitioning.value = false
}

function onMouseMove(e: MouseEvent) {
  if (!touch.active) return

  touch.deltaX = e.clientX - touch.startX
  touch.deltaY = e.clientY - touch.startY

  if (isZoomed.value) {
    // 放大状态：拖拽移动图片
    translateX.value = touch.lastX + touch.deltaX
    translateY.value = touch.lastY + touch.deltaY
  } else {
    // 非放大状态：边界阻尼
    if (currentIndex.value === 0 && touch.deltaX > 0) {
      touch.deltaX = touch.deltaX * 0.3
    }
    if (currentIndex.value === props.images.length - 1 && touch.deltaX < 0) {
      touch.deltaX = touch.deltaX * 0.3
    }
  }
}

function onMouseUp() {
  if (!touch.active) return
  touch.active = false

  if (isZoomed.value) {
    constrainPosition()
  } else {
    finishSwipe()
  }
}

// 限制图片位置在合理范围内
function constrainPosition() {
  // 简单限制：不做严格边界限制，允许自由拖动
  // 如果缩放比例为1，重置位置
  if (scale.value <= 1) {
    zoomTransitioning.value = true
    translateX.value = 0
    translateY.value = 0
    setTimeout(() => {
      zoomTransitioning.value = false
    }, 200)
  }
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
  touch.deltaY = 0
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
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
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

.image-wrapper {
  will-change: transform;
  transform-origin: center center;

  &.zoom-transitioning {
    transition: transform 0.3s ease-out;
  }
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
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

.zoom-controls {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.6);
  padding: 8px 16px;
  border-radius: 24px;
  z-index: 10;

  .zoom-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: white;
    font-size: 20px;
    transition: all 0.2s;

    &:hover:not(.disabled) {
      background: rgba(255, 255, 255, 0.3);
    }

    &.disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
  }

  .zoom-level {
    color: white;
    font-size: 14px;
    min-width: 50px;
    text-align: center;
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
