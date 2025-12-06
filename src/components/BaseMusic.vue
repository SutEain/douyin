<template>
  <div class="music-wrapper">
    <!-- 只显示音乐图标，不再显示静音功能 -->
    <img 
      class="music"
      :src="playIcon"
      alt="playing"
    />
  </div>
</template>
<script setup lang="ts">
import playIcon from '@/assets/img/icon/play.png'
</script>

<style lang="less">
.music-wrapper {
  display: flex;
  justify-content: center;
  @w: 45rem;
  width: @w;
  height: @w;
  position: relative;
  z-index: 60;

  .music {
    border-radius: 50%;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }
}
</style>
