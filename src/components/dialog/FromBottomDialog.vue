<template>
  <Transition name="test">
    <!-- 遮罩层：点击关闭 -->
    <div 
      v-if="modelValue" 
      class="dialog-mask"
      @click="onMaskClick"
    ></div>
  </Transition>
  <Transition name="test">
    <div
      v-if="modelValue"
      key="dialog"
      ref="dialog"
      :class="['FromBottomDialog', mode, showHengGang ? '' : 'no-heng-gang']"
      @touchstart="onStart"
      @touchmove="onMove"
      @touchend="onEnd"
      @click.stop
    >
      <slot name="header"></slot>
      <div :class="['heng-gang', mode]" v-if="showHengGang">
        <div class="content"></div>
      </div>
      <div class="wrapper" ref="wrapper">
        <slot></slot>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import Dom, { _css } from '../../utils/dom'
import bus, { EVENT_KEY } from '@/utils/bus'
import { _stopPropagation } from '@/utils'

defineOptions({ name: 'FromBottomDialog' })

interface FromBottomDialogProps {
  modelValue?: boolean
  mode?: 'dark' | 'light' | 'white'
  maskMode?: 'dark' | 'light' | 'white'
  height?: string
  showHengGang?: boolean
  pageId: string
  borderRadius?: string
  tag?: string
}

interface Emits {
  (ev: 'update:modelValue', val: boolean): void
  (ev: 'cancel'): void
}

const props = withDefaults(defineProps<FromBottomDialogProps>(), {
  modelValue: false,
  mode: 'dark',
  maskMode: 'dark',
      height: 'calc(var(--vh, 1vh) * 90)',
  showHengGang: true,
  borderRadius: '15rem 15rem 0 0',
  tag: ''
})

const emit = defineEmits<Emits>()

const dialog = ref<HTMLElement | null>(null)

const wrapper = ref<HTMLElement | null>(null)

const scroll = ref(0)

const startY = ref(0)

const moveY = ref(0)

const startTime = ref(0)

const pagePosition = ref(null)

watch(
  () => props.modelValue,
  (newVal: boolean) => {
    const page = document.getElementById(props.pageId) || document.body
    
    if (!page) {
      console.error('[FromBottomDialog] ❌ 找不到 page 元素:', props.pageId)
      return
    }
    
    console.log('[FromBottomDialog] 状态变化:', {
      newVal,
      pageId: props.pageId,
      tag: props.tag
    })
    
    if (newVal) {
      // ✅ 打开时：固定页面位置
      pagePosition.value = _css(page, 'position')
      scroll.value = document.documentElement.scrollTop || window.pageYOffset
      
      console.log('[FromBottomDialog] 📌 打开前状态:', {
        scrollTop: scroll.value,
        pageYOffset: window.pageYOffset,
        pagePosition: pagePosition.value,
        bodyPosition: document.body.style.position,
        bodyTop: document.body.style.top
      })
      
      document.body.style.position = 'fixed'
      document.body.style.top = `-${scroll.value}px`
      document.body.style.width = '100%'
      page.style.position = 'absolute'
      
      console.log('[FromBottomDialog] ✅ 打开后状态:', {
        bodyPosition: document.body.style.position,
        bodyTop: document.body.style.top,
        pagePosition: page.style.position
      })
    } else {
      // ✅ 关闭时：恢复页面位置
      console.log('[FromBottomDialog] 📌 关闭前状态:', {
        savedScroll: scroll.value,
        currentScrollTop: document.documentElement.scrollTop,
        bodyPosition: document.body.style.position,
        bodyTop: document.body.style.top,
        pagePosition: page.style.position
      })
      
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      page.style.position = pagePosition.value || ''
      
      // 恢复滚动位置
      window.scrollTo(0, scroll.value)
      document.documentElement.scrollTop = scroll.value
      
      console.log('[FromBottomDialog] ✅ 关闭后状态:', {
        restoredScroll: scroll.value,
        actualScrollTop: document.documentElement.scrollTop,
        windowPageYOffset: window.pageYOffset,
        bodyPosition: document.body.style.position,
        bodyTop: document.body.style.top,
        pagePosition: page.style.position
      })
    }
  }
)

const onHide = (val = false) => {
  emit('update:modelValue', val)
  emit('cancel')
}

const onMaskClick = (e: Event) => {
  e.stopPropagation()
  console.log('[FromBottomDialog] 点击遮罩关闭', {
    tag: props.tag,
    modelValue: props.modelValue
  })
  onHide()
}

const onStart = (e: TouchEvent) => {
  if (props.tag === 'comment') {
    startY.value = e.touches[0].clientY
    console.log('[AutoPlayDebug] comment-touch:start', {
      scrollTop: wrapper.value?.scrollTop,
      target: (e.target as HTMLElement)?.className
    })
    return
  }
  if (wrapper.value?.scrollTop !== 0) return
  startY.value = e.touches[0].clientY
  startTime.value = Date.now()
  _css(dialog.value, 'transition-duration', '0ms')
}

const onMove = (e: TouchEvent) => {
  if (props.tag === 'comment') {
    const delta = e.touches[0].pageY - startY.value
    const scrollTop = wrapper.value?.scrollTop ?? 0
    const atTopPullingDown = scrollTop <= 0 && delta > 0
    if (atTopPullingDown) {
      e.preventDefault()
      e.stopPropagation()
      _stopPropagation(e)
      _css(dialog.value, 'transform', `translate3d(0,0,0)`)
    }
    console.log('[AutoPlayDebug] comment-touch:move', {
      scrollTop,
      delta,
      atTopPullingDown
    })
    return
  }
  if (wrapper.value?.scrollTop !== 0) return
  moveY.value = e.touches[0].pageY - startY.value
  if (moveY.value > 0) {
    bus.emit(EVENT_KEY.DIALOG_MOVE, {
      tag: props.tag,
      e: moveY.value
    })
    _css(dialog.value, 'transform', `translate3d(0, ${moveY.value}px, 0)`)
  }
}

const onEnd = () => {
  if (props.tag === 'comment') {
    console.log('[AutoPlayDebug] comment-touch:end', {
      scrollTop: wrapper.value?.scrollTop
    })
    return
  }
  // 如果是外部改变 modelValue 值的话，这里会没有 ref
  if (!dialog.value) return
  if (Date.now() - startTime.value < 150 && Math.abs(moveY.value) < 30) return
  const clientHeight = dialog.value?.clientHeight
  _css(dialog.value, 'transition-duration', `250ms`)
  if (Math.abs(moveY.value) > clientHeight / 2) {
    _css(dialog.value, 'transform', `translate3d(0,100%,0)`)
    bus.emit(EVENT_KEY.DIALOG_END, { tag: props.tag, isClose: true })
    setTimeout(onHide, 250)
  } else {
    _css(dialog.value, 'transform', `translate3d(0,0,0)`)
    bus.emit(EVENT_KEY.DIALOG_END, { tag: props.tag, isClose: false })
  }
}
</script>

<style scoped lang="less">
@import '../../assets/less/index';

.test-enter-active,
.test-leave-active {
  transition-duration: 250ms !important;
}

.test-enter-from,
.test-leave-to {
  transform: translate3d(0, 101%, 0) !important;
}

.dialog-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 8999;
  cursor: pointer;
}

.FromBottomDialog {
  z-index: 9000;
  position: fixed;
  width: 100%;
  padding-top: 24rem;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  border-radius: 15rem 15rem 0 0;
  overflow: visible;
  display: flex;
  height: v-bind(height);
  max-height: v-bind(height);
  flex-direction: column;
  overscroll-behavior: contain;
  touch-action: none;

  &.dark {
    background: var(--main-bg);
  }

  &.light {
    background: whitesmoke;
  }

  &.white {
    background: white;
  }

  &.no-heng-gang {
    padding-top: 0;
  }

  .heng-gang {
    border-radius: 15rem 15rem 0 0;
    z-index: 3;
    width: 100%;
    position: fixed;
    height: 30rem;
    display: flex;
    transform: translateY(-24rem);
    justify-content: center;
    align-items: center;
    touch-action: pan-y;

    &.dark {
      background: var(--main-bg);

      .content {
        background: var(--second-btn-color);
      }
    }

    &.light {
      background: whitesmoke;

      .content {
        background: darkgray;
      }
    }

    &.white {
      background: white;

      .content {
        background: darkgray;
      }
    }

    .content {
      border-radius: 2px;
      height: 4rem;
      width: 30rem;
    }
  }

  .wrapper {
    flex: 1;
    overflow: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
  }
}
</style>
