<template>
  <SlideItem class="slide-item-class">
    <!-- 直播列表卡片 -->
    <div class="sub-type" :class="state.subTypeIsTop ? 'top' : ''" ref="subTypeRef">
      <div class="card" @touchmove="_stop">
        <div class="nav-item" @click="goLive(i)" :key="j" v-for="(i, j) in store.users">
          <img :src="_checkImgUrl(i.avatar_168x168.url_list[0])" alt="" />
          <span>{{ i.nickname }}</span>
        </div>
      </div>
    </div>
    
    <!-- 直播数量提示 -->
    <div
      class="sub-type-notice"
      v-if="state.subType === -1 && !state.subTypeVisible"
      @click.stop="showSubType"
    >
      {{ store.users.length }}个直播
    </div>
    
    <!-- 视频列表 -->
    <div
      class="video-container"
      :style="{
        background: 'black',
        marginTop: state.subTypeVisible ? state.subTypeHeight : 0
      }"
      @touchstart="pageClick"
    >
      <VideoList
        v-if="state.list.length > 0"
        :items="state.list"
        page="home"
        :initial-index="0"
        :autoplay="props.active"
        @load-more="loadMore"
      />
    </div>
  </SlideItem>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import SlideItem from '@/components/slide/SlideItem.vue'
import VideoList from '@/components/video/VideoList.vue'
import { _checkImgUrl, _stop } from '@/utils'
import { recommendedVideo } from '@/api/videos'
import { useBaseStore } from '@/store/pinia'
import bus, { EVENT_KEY } from '@/utils/bus'
import type { VideoItem } from '@/types'

const store = useBaseStore()
const props = defineProps({
  active: {
    type: Boolean,
    default: false
  }
})

const subTypeRef = ref(null)
const state = reactive({
  list: [] as VideoItem[],
  totalSize: 0,
  pageSize: 10,
  subTypeVisible: false,
  subTypeIsTop: false,
  subTypeHeight: '0px',
  subType: -1
})

// ========== Methods ==========
async function loadMore() {
  if (store.loading) return
  if (state.totalSize > 0 && state.list.length >= state.totalSize) return
  
  store.loading = true
  const res = await recommendedVideo({
    start: state.list.length,
    pageSize: state.pageSize
  })
  store.loading = false
  
  if (res.success) {
    state.totalSize = res.data.total
    state.list.push(...res.data.list)
  }
}

function showSubType() {
  state.subTypeVisible = true
  bus.emit(EVENT_KEY.OPEN_SUB_TYPE)
}

function closeSubType() {
  state.subTypeVisible = false
  bus.emit(EVENT_KEY.CLOSE_SUB_TYPE)
}

function pageClick() {
  if (state.subTypeVisible) {
    closeSubType()
  }
}

function goLive(user: any) {
  console.log('进入直播间', user)
  // TODO: 实现进入直播间逻辑
}

// ========== 生命周期 ==========
onMounted(() => {
  // 初始加载
  loadMore()
  
  // 计算直播卡片高度
  if (subTypeRef.value) {
    state.subTypeHeight = (subTypeRef.value as HTMLElement).offsetHeight + 'px'
  }
})
</script>

<style scoped lang="less">
.slide-item-class {
  position: relative;
  
  .video-container {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
  }
  
  .sub-type {
    position: absolute;
    top: -100%;
    left: 0;
    right: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 10;
    transition: top 0.3s;
    
    &.top {
      top: 0;
    }
    
    .card {
      display: flex;
      flex-wrap: wrap;
      padding: 10px;
      
      .nav-item {
        width: 25%;
        padding: 10px;
        text-align: center;
        
        img {
          width: 50px;
          height: 50px;
          border-radius: 50%;
        }
        
        span {
          display: block;
          color: white;
          font-size: 12px;
          margin-top: 5px;
        }
      }
    }
  }
  
  .sub-type-notice {
    position: absolute;
    top: 20px;
    right: 20px;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    padding: 5px 15px;
    border-radius: 15px;
    font-size: 12px;
    z-index: 11;
  }
}
</style>

