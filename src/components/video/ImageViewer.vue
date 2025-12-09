<template>
  <div class="image-viewer" @click="$emit('click')">
    <!-- 图片内容 -->
    <img
      :src="imageUrl"
      class="image-content"
      :style="imageStyle"
      @load="onImageLoad"
      @error="onImageError"
    />

    <!-- 加载中 -->
    <div v-if="loading" class="loading-overlay">
      <div class="loading-spinner"></div>
    </div>

    <!-- 左上角类型标识 -->
    <div class="content-type-badge">
      <span class="badge-icon">🖼️</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { buildCdnUrl } from '@/utils/media'

interface Props {
  images: Array<{ file_id: string; url?: string; width?: number; height?: number }>
}

const props = defineProps<Props>()
const emit = defineEmits<{
  click: []
}>()

const loading = ref(true)

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
  background: rgba(0, 0, 0, 0.5);
  padding: 4px 8px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  z-index: 10;

  .badge-icon {
    font-size: 14px;
  }
}
</style>
