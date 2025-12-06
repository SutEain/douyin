<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  getSlideOffset,
  slideInit,
  slideReset,
  slideTouchEnd,
  slideTouchMove,
  slideTouchStart,
  canSlide
} from '@/utils/slide'
import { SlideType } from '@/utils/const_var'
import { _css } from '@/utils/dom'

const props = defineProps({
  index: {
    type: Number,
    default: () => {
      return 0
    }
  },
  //改变index，是否使用动画
  changeActiveIndexUseAnim: {
    type: Boolean,
    default: true
  },
  name: {
    type: String,
    default: () => 'SlideVertical'
  }
})
const emit = defineEmits(['update:index'])

//slide-list的ref引用
const slideListEl = ref(null)

const state = reactive({
  judgeValue: 20, //一个用于判断滑动朝向的固定值
  type: SlideType.VERTICAL, //组件类型
  name: props.name,
  localIndex: props.index, //当前下标
  needCheck: true, //是否需要检测，每次按下都需要检测，up事件会重置为true
  next: false, //能否滑动
  isDown: false, //是否按下，用于move事件判断
  start: { x: 0, y: 0, time: 0 }, //按下时的起点坐标
  move: { x: 0, y: 0 }, //移动时的坐标
  //slide-list的宽度和子元素数量
  wrapper: {
    width: 0,
    height: 0,
    //childrenLength用于canNext方法判断当前页是否是最后一页，是则不能滑动，不捕获事件
    childrenLength: 0
  }
})

watch(
  () => props.index,
  (newVal) => {
    if (state.localIndex !== newVal) {
      state.localIndex = newVal
      if (props.changeActiveIndexUseAnim) {
        _css(slideListEl.value, 'transition-duration', `300ms`)
      }
      _css(
        slideListEl.value,
        'transform',
        `translate3d(0,${getSlideOffset(state, slideListEl.value)}px, 0)`
      )
    }
  }
)

const isDesktop = !/Mobi|Android|iPhone/i.test(navigator.userAgent)
const wheelState = {
  lock: false,
  active: false,
  accum: 0,
  timeout: null
}

onMounted(() => {
  slideInit(slideListEl.value, state)
  if (isDesktop && slideListEl.value) {
    slideListEl.value.addEventListener('wheel', handleWheel, { passive: false })
  }
})

onUnmounted(() => {
  slideListEl.value?.removeEventListener('wheel', handleWheel)
})

function createWheelEvent(e: WheelEvent, deltaY = 0) {
  const clientX = e.clientX || 0
  const baseY = e.clientY || 0
  const pageX = e.pageX ?? clientX
  const pageY = e.pageY ?? baseY
  const nextY = baseY - deltaY
  const nextPageY = pageY - deltaY
  return {
    clientX,
    clientY: nextY,
    pageX,
    pageY: nextPageY,
    touches: [
      {
        clientX,
        clientY: nextY,
        pageX,
        pageY: nextPageY
      }
    ]
  } as any
}

function touchStart(e) {
  slideTouchStart(e, slideListEl.value, state)
}

function touchMove(e) {
  slideTouchMove(e, slideListEl.value, state)
}

function touchEnd(e) {
  slideTouchEnd(e, state)
  slideReset(e, slideListEl.value, state, emit)
}

function canNext(state, isNext) {
  return !(
    (state.localIndex === 0 && !isNext) ||
    (state.localIndex === state.wrapper.childrenLength - 1 && isNext)
  )
}

function handleWheel(e: WheelEvent) {
  if (!isDesktop) return
  if (!slideListEl.value) return
  if (!e.deltaY) return
  if (wheelState.lock) return
  
  wheelState.accum += e.deltaY
  
  if (wheelState.timeout) {
    clearTimeout(wheelState.timeout)
  }
  wheelState.timeout = window.setTimeout(() => {
    wheelState.accum = 0
    wheelState.timeout = null
  }, 100)

  const threshold = 60
  if (Math.abs(wheelState.accum) >= threshold) {
    const isNext = wheelState.accum > 0
    if (canNext(state, isNext)) {
      if (wheelState.timeout) clearTimeout(wheelState.timeout)
      
      state.localIndex += isNext ? 1 : -1
      
      const mockEvent = {
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {},
        touches: []
      }
      slideReset(mockEvent, slideListEl.value, state, emit)
      
      wheelState.lock = true
      wheelState.accum = 0
      setTimeout(() => { wheelState.lock = false }, 1000)
    } else {
        wheelState.accum = 0
    }
  }
}
</script>

<template>
  <div class="slide v">
    <div
      class="slide-list flex-direction-column"
      ref="slideListEl"
      @pointerdown.prevent="touchStart"
      @pointermove.prevent="touchMove"
      @pointerup.prevent="touchEnd"
    >
      <slot></slot>
    </div>
  </div>
</template>
