<template>
  <div class="image-viewer">
    <!-- 图片内容 -->
    <img
      :src="imageUrl"
      class="image-content"
      :style="imageStyle"
      @load="onImageLoad"
      @error="onImageError"
      @click.stop="openPreview"
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

interface Props {
  images: Array<{ file_id: string; url?: string; width?: number; height?: number }>
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
    // 🎯 优先使用后端返回的完整 URL
    if (props.images[0].url) return props.images[0].url
    return buildCdnUrl(props.images[0].file_id)
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

function onImageError() {
  loading.value = false
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
