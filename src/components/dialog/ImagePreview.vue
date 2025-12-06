<template>
  <Teleport to="body">
    <div v-if="modelValue" class="image-preview-overlay" @click="close">
      <div class="image-preview-container">
        <img 
          :src="modelValue" 
          alt="预览图片" 
          class="preview-image"
          @click.stop
        />
        <div class="close-btn" @click="close">
          <Icon icon="mdi:close" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'

interface Props {
  modelValue: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

function close() {
  emit('update:modelValue', '')
}
</script>

<style scoped lang="less">
.image-preview-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.9);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  
  .image-preview-container {
    position: relative;
    max-width: 90%;
    max-height: 90%;
    
    .preview-image {
      max-width: 100%;
      max-height: 90vh;
      object-fit: contain;
    }
    
    .close-btn {
      position: absolute;
      top: -40px;
      right: 0;
      color: white;
      font-size: 32px;
      cursor: pointer;
      padding: 8px;
      
      &:hover {
        opacity: 0.8;
      }
    }
  }
}
</style>

