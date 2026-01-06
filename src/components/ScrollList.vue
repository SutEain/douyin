<template>
  <Scroll
    ref="scroll"
    :loading="state.loading"
    :full-loading="!state.list.length"
    @pulldown="loadData"
  >
    <slot :list="state.list" :loading="state.loading"></slot>
    <NoMore v-if="state.total !== 0 && state.total === state.list.length" />
  </Scroll>
</template>

<script setup>
import { onMounted, reactive } from 'vue'
import { _notice } from '@/utils'
import Scroll from '@/components/Scroll.vue'
import NoMore from '@/components/NoMore.vue'
import { useScroll } from '@/utils/hooks/useScroll.ts'

const props = defineProps({
  api: {
    type: Function,
    default() {
      return () => void 0
    }
  }
})
const scroll = useScroll()

const state = reactive({
  list: [],
  total: 0,
  pageNo: 0,
  pageSize: 10,
  loading: true // 🎯 初始设为 true，配合模板避免闪现“暂无视频”
})

function loadData() {
  if (state.loading) return
  state.pageNo++
  getData()
}

async function getData(refresh = false) {
  if (refresh) {
    state.pageNo = 0
  } else {
    if (state.total !== 0 && state.total === state.list.length) return
  }

  // 🎯 修复逻辑：如果是第一次加载（list 为空），允许通过，否则拦截重复请求
  if (state.loading && state.list.length > 0) return

  state.loading = true
  try {
    let res = await props.api({
      pageNo: state.pageNo,
      pageSize: state.pageSize
    })
    if (res.success) {
      if (refresh) {
        state.list = res.data.list
      } else {
        state.list = state.list.concat(res.data.list)
      }
      state.total = res.data.total
    } else {
      _notice('查询失败')
    }
  } catch (e) {
    console.error('[ScrollList] getData error:', e)
  } finally {
    state.loading = false
  }
}

onMounted(() => {
  // 🎯 确保在挂载后执行，且 list 为空时能通过 loading 锁
  getData()
})
</script>
