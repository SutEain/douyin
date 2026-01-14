<template>
  <Scroll
    ref="scroll"
    :loading="state.loading"
    :full-loading="!state.list.length"
    @pulldown="loadData"
  >
    <slot :list="state.list" :loading="state.loading"></slot>
    <NoMore v-if="!state.hasMore && state.list.length > 0" />
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
  hasMore: true, // 🎯 增加 hasMore 状态
  seed: Math.random(), // 🎯 每次组件实例创建时生成唯一种子（Session 种子）
  loading: true // 🎯 初始设为 true，配合模板避免闪现“暂无视频”
})

function loadData() {
  if (state.loading || !state.hasMore) return // 🎯 如果正在加载或没有更多数据，拦截
  state.pageNo++
  getData()
}

async function getData(refresh = false) {
  if (refresh) {
    state.pageNo = 0
    state.hasMore = true
    state.seed = Math.random() // 🎯 刷新时更换种子，全盘重排
  } else {
    if (!state.hasMore) return // 🎯 没有更多数据，直接返回
  }

  // 🎯 修复逻辑：如果是第一次加载（list 为空），允许通过，否则拦截重复请求
  if (state.loading && state.list.length > 0) return

  state.loading = true
  console.log(`[ScrollList] >>> 开始加载数据: pageNo=${state.pageNo}, seed=${state.seed}`)
  try {
    let res = await props.api({
      pageNo: state.pageNo,
      pageSize: state.pageSize,
      seed: state.seed // 🎯 传递种子
    })
    console.log('[ScrollList] <<< 接口返回结果:', {
      success: res.success,
      data_count: res.data?.list?.length,
      hasMore: res.data?.hasMore
    })
    if (res.success) {
      const data = res.data
      let newItems = [] // 🎯 提升作用域

      if (refresh) {
        state.list = data.list
        newItems = data.list
      } else {
        // 🎯 去重：防止分页边界重复（按 aweme_id 或 id 去重）
        const existingIds = new Set(
          state.list.map((item) => item.aweme_id || item.id).filter(Boolean)
        )
        newItems = data.list.filter((item) => {
          const itemId = item.aweme_id || item.id
          return itemId && !existingIds.has(itemId)
        })

        console.log(`[ScrollList] 去重结果: 原始=${data.list.length}, 新增=${newItems.length}`)

        if (newItems.length < data.list.length) {
          console.warn(
            `[ScrollList] 检测到 ${data.list.length - newItems.length} 条重复数据，已过滤`
          )
        }

        if (newItems.length > 0) {
          state.list = state.list.concat(newItems)
        }
      }

      state.total = data.total
      // 🎯 优化 hasMore：如果后端明确返回了 hasMore，则以此为准
      if (data.hasMore !== undefined) {
        state.hasMore = data.hasMore
      } else {
        state.hasMore = data.list.length >= state.pageSize
      }

      // 🎯 补货逻辑：如果去重后本页没剩多少了（甚至为0），且后端说还有更多，自动加载下一页
      if (state.hasMore && newItems.length < 3 && data.list.length > 0) {
        console.log(`[ScrollList] 去重后剩余太少(${newItems.length})，尝试自动补货...`)
        setTimeout(() => loadData(), 100)
      }
      console.log('[ScrollList] 状态更新后:', {
        list_total: state.list.length,
        hasMore: state.hasMore
      })
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

// 🎯 暴露方法给父组件
defineExpose({
  getData
})
</script>
