<template>
  <div class="lookHistory">
    <BaseHeader>
      <template v-slot:center>
        <span class="f16">观看历史</span>
      </template>
      <template v-slot:right v-if="isClear">
        <span class="second-text-color f13" @click="clear">清空</span>
      </template>
    </BaseHeader>
    <div class="content">
      <Scroll class="Scroll" @pulldown="getHistoryVideo">
        <Posters
          v-if="data.historyVideo.list.length > 0"
          :list="data.historyVideo.list"
          :showLabels="true"
        />
        <Loading :is-full-screen="false" v-if="data.loadingVideo" />
        <template v-else>
          <NoMore
            v-if="
              data.historyVideo.list.length &&
              data.historyVideo.total !== -1 &&
              data.historyVideo.list.length >= data.historyVideo.total
            "
          />
          <div v-else-if="data.historyVideo.total === 0" class="empty-list">
            <div class="title">暂无观看历史记录</div>
          </div>
        </template>
      </Scroll>
    </div>
  </div>
</template>
<script setup lang="ts">
import Posters from '@/components/Posters.vue'
import Scroll from '@/components/Scroll.vue'
import NoMore from '@/components/NoMore.vue'
import { historyVideo, clearVideoHistory } from '@/api/videos'

import { computed, onMounted, reactive } from 'vue'
import { _showConfirmDialog } from '@/utils'

defineOptions({
  name: 'LookHistory'
})

const data = reactive({
  loadingVideo: false,
  isClearHistoryVideo: false,
  pageSize: 15,
  historyVideo: {
    total: -1, // 🎯 初始化为 -1，和 Me 页面保持一致
    pageNo: 0,
    list: []
  }
})

const isClear = computed(() => {
  return data.historyVideo.list.length > 0
})

onMounted(() => {
  getHistoryVideo(true)
})

async function getHistoryVideo(init = false) {
  if (data.loadingVideo) return
  if (data.isClearHistoryVideo) return

  // 🎯 如果已加载完所有数据，不再请求
  if (data.historyVideo.total !== -1 && data.historyVideo.list.length >= data.historyVideo.total) {
    return
  }

  data.loadingVideo = true
  try {
    const res: any = await historyVideo({
      pageNo: data.historyVideo.pageNo,
      pageSize: data.pageSize
    })

    if (res.success) {
      data.historyVideo.total = res.data.total
      data.historyVideo.list.push(...res.data.list)
      data.historyVideo.pageNo++ // 🎯 成功加载后递增页码
    }
  } catch (error) {
    console.error('[LookHistory] 加载观看历史失败:', error)
  } finally {
    data.loadingVideo = false
  }
}

async function clear() {
  _showConfirmDialog('确定清空？', '清空后，所有观看记录将被永久删除', 'gray', async () => {
    try {
      const res = await clearVideoHistory()
      if (res.success) {
        // 🎯 清空成功后，重置前端状态
        data.historyVideo.list = []
        data.historyVideo.total = 0
        data.historyVideo.pageNo = 0
        data.isClearHistoryVideo = false // 重置标志，允许重新加载
        console.log('[LookHistory] 成功清空所有观看历史')
      } else {
        console.error('[LookHistory] 清空失败:', res.message)
      }
    } catch (error) {
      console.error('[LookHistory] 清空观看历史异常:', error)
    }
  })
}
</script>

<style scoped lang="less">
@import '../../../assets/less/index';

.lookHistory {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;
  overflow: auto;
  color: white;
  font-size: 14rem;

  .content {
    padding-top: 60rem;

    .Scroll {
      height: calc(var(--vh, 1vh) * 100 - var(--common-header-height)) !important;
    }

    .empty-list {
      padding: 40rem 20rem;
      text-align: center;

      .title {
        font-size: 14rem;
        color: var(--second-text-color);
        margin-bottom: 8rem;
      }

      .desc {
        font-size: 12rem;
        color: var(--second-text-color);
        opacity: 0.7;
      }
    }
  }
}
</style>
