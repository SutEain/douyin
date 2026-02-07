<template>
  <div class="image-viewer">
    <!-- 图片内容 -->
    <img
      :src="imageUrl"
      class="image-content"
      :style="imageStyle"
      @load="onImageLoad"
      @error="(e) => handleImageError(e)"
      @click.stop="openPreview"
      draggable="false"
    />

    <!-- 加载中 -->
    <div v-if="loading" class="loading-overlay">
      <div class="loading-spinner"></div>
    </div>

    <!-- 左上角类型标识（毛玻璃效果） -->
    <div class="content-type-badge">
      <span class="badge-text">图片</span>
    </div>

    <!-- 点击查看高清提示 -->
    <div class="hd-tip" @click.stop="openPreview">
      <Icon icon="mdi:magnify-plus" />
      <span>查看高清</span>
    </div>

    <!-- 高清预览弹窗 -->
    <ImagePreview v-model:visible="showPreview" :images="images" :initial-index="0" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Icon } from '@iconify/vue'
import { buildCdnUrl } from '@/utils/media'
import ImagePreview from './ImagePreview.vue'
import { _handleImageError } from '@/utils'

interface Props {
  images: Array<{
    file_id: string
    url?: string
    play_url?: string // 🎯 增加 play_url
    width?: number
    height?: number
  }>
}

const props = defineProps<Props>()

const loading = ref(true)
const showPreview = ref(false)

// 🎯 打开高清预览
function openPreview() {
  showPreview.value = true
}

// 获取第一张图片的 URL
const imageUrl = computed(() => {
  if (props.images && props.images.length > 0) {
    const first = props.images[0]
    // 🎯 优先使用 R2 直链 (play_url 或 url)，使用 buildCdnUrl 处理相对路径
    const targetUrl = first.play_url || first.url
    if (targetUrl) return buildCdnUrl(targetUrl)
    // 如果没有 play_url 或 url，尝试使用 file_id（兼容旧数据）
    if (first.file_id) return buildCdnUrl(first.file_id)
  }
  return ''
})

// 图片样式（适应容器）
const imageStyle = computed(() => {
  return {
    objectFit: 'contain' as const
  }
})

function onImageLoad() {
  loading.value = false
}

function handleImageError(event: Event) {
  loading.value = false
  // 🚨 使用安全的错误处理函数，防止XSS攻击
  _handleImageError(event)
  console.error('[ImageViewer] 图片加载失败:', imageUrl.value)
}
</script>

<style scoped lang="less">
.image-viewer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: black;
  // 🎯 强制 GPU 渲染，解决 Windows 上滑动无动画问题
  will-change: transform;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  transform: translateZ(0);
}

.image-content {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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

// 🎯 查看高清按钮
.hd-tip {
  position: absolute;
  bottom: 160px;
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
