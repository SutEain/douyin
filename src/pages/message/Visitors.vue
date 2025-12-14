<template>
  <div id="Visitors">
    <BaseHeader>
      <template v-slot:center>
        <span class="f16">主页访客</span>
      </template>
    </BaseHeader>
    <div class="content">
      <Peoples v-model:list="data.list" :loading="data.loading" mode="visitor" />
      <div v-if="!data.loading && data.list.length === 0" class="empty">暂无访客</div>
      <NoMore v-else-if="!data.loading" />
    </div>
  </div>
</template>
<script setup lang="ts">
import Peoples from '../people/components/Peoples.vue'
import NoMore from '@/components/NoMore.vue'
import { _notice } from '@/utils'

import { onMounted, reactive } from 'vue'
import { getMyVisitors } from '@/api/videos'

defineOptions({
  name: 'Visitors'
})

const data = reactive({
  list: [] as any[],
  loading: false
})

onMounted(async () => {
  try {
    data.loading = true
    const res = await getMyVisitors(100)
    if (res?.success) {
      data.list = res.data || []
    } else {
      _notice(res?.message || '获取访客失败')
    }
  } catch (e) {
    console.error('[Visitors] load failed:', e)
    _notice('获取访客失败')
  } finally {
    data.loading = false
  }
})
</script>

<style scoped lang="less">
.remove-enter-active,
.remove-leave-active {
  transition: transform 0.3s ease;
}

.remove-enter-from,
.remove-leave-to {
  transform: scale(0);
}

#Visitors {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;
  overflow: auto;
  color: white;
  font-size: 14rem;

  .content {
    padding: var(--page-padding);
    padding-top: var(--common-header-height);
  }

  .empty {
    margin-top: 20rem;
    text-align: center;
    color: var(--second-text-color);
  }
}
</style>
