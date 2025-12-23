<template>
  <div class="indicator-home" :class="{ isLight }">
    <div class="notice" :style="noticeStyle">
      <span>{{ $t('home.refreshContent') }}</span>
    </div>
    <div class="toolbar" ref="toolbar" :style="toolbarStyle">
      <div class="tab-ctn">
        <div class="tabs" ref="tabs">
          <!-- 视频 Tab -->
          <div class="tab" :class="{ active: index === 0 }" @click.stop="change(0)">
            <span>视频</span>
          </div>

          <!-- 图文 Tab -->
          <div class="tab" :class="{ active: index === 1 }" @click.stop="change(1)">
            <span>图文</span>
          </div>

          <!-- 直播 Tab -->
          <div class="tab" :class="{ active: index === 2 }" @click.stop="change(2)">
            <span>直播</span>
          </div>

          <!-- 短剧 Tab -->
          <div class="tab" :class="{ active: index === 3 }" @click.stop="change(3)">
            <span>短剧</span>
          </div>

          <!-- 成人内容 Tab -->
          <div class="tab" :class="{ active: index === 4 }" @click.stop="change(4)">
            <span>成人</span>
          </div>

          <!-- 关注 - 可点击 -->
          <div class="tab" :class="{ active: index === 5 }" @click.stop="change(5)">
            <span>{{ $t('home.following') }}</span>
          </div>

          <!-- 推荐 -->
          <div class="tab" :class="{ active: index === 6 }" @click.stop="change(6)">
            <span>{{ $t('home.recommended') }}</span>
          </div>
        </div>
        <div class="indicator" ref="indicator"></div>
      </div>
      <Icon
        v-hide="loading"
        icon="ion:search"
        class="search"
        @click="$router.push('/home/search')"
      />
    </div>
    <Loading :style="loadingStyle" class="loading" style="width: 40rem" :is-full-screen="false" />
  </div>
</template>
<script>
import Loading from '../../../components/Loading.vue'
import bus from '../../../utils/bus'
import { mapState } from 'pinia'
import { useBaseStore } from '@/store/pinia'
import { _css } from '@/utils/dom'

export default {
  name: 'IndicatorHome',
  components: {
    Loading
  },
  props: {
    loading: {
      type: Boolean,
      default() {
        return false
      }
    },
    //用于和slidList绑定，因为一个页面可能有多个slidList，但只有一个indicator组件
    name: {
      type: String,
      default: () => ''
    },
    index: {
      type: Number,
      default: () => 0
    },
    isLight: {
      type: Boolean,
      default: () => false
    }
  },
  setup() {
    const baseStore = useBaseStore()
    return { baseStore }
  },
  data() {
    return {
      indicatorRef: null,
      lefts: [],
      indicatorSpace: 0,
      type: 1,
      moveY: 0
    }
  },
  computed: {
    ...mapState(useBaseStore, ['judgeValue', 'homeRefresh']),
    transform() {
      return `translate3d(0, ${this.moveY - this.judgeValue > this.homeRefresh ? this.homeRefresh : this.moveY - this.judgeValue}px, 0)`
    },
    toolbarStyle() {
      if (this.loading) {
        return {
          opacity: 1,
          'transition-duration': '300ms',
          transform: `translate3d(0, 0, 0)`
        }
      }
      if (this.moveY) {
        return {
          opacity: 1 - (this.moveY - this.judgeValue) / (this.homeRefresh / 2),
          transform: this.transform
        }
      }
      return {
        opacity: 1,
        'transition-duration': '300ms',
        transform: `translate3d(0, 0, 0)`
      }
    },
    noticeStyle() {
      if (this.loading) {
        return { opacity: 0 }
      }
      if (this.moveY) {
        return {
          opacity: (this.moveY - this.judgeValue) / (this.homeRefresh / 2) - 0.5,
          transform: this.transform
        }
      }
      return { opacity: 0 }
    },
    loadingStyle() {
      if (this.loading) {
        return { opacity: 1, 'transition-duration': '300ms' }
      }
      if (this.moveY) {
        return {
          opacity: (this.moveY - this.judgeValue) / (this.homeRefresh / 2) - 0.5,
          transform: this.transform
        }
      }
      return {}
    }
  },
  created() {},
  mounted() {
    this.initTabs()
    bus.on(this.name + '-moveX', this.move)
    bus.on(this.name + '-moveY', (e) => {
      this.moveY = e
    })
    bus.on(this.name + '-end', this.end)
  },
  // ✅ 从视频详情返回 Home（keep-alive 激活）时，重新计算 Tab 白线位置，避免错位
  activated() {
    this.scheduleInitTabs('activated')
  },
  unmounted() {
    bus.off(this.name + '-moveX', this.move)
    bus.off(this.name + '-moveY')
    bus.off(this.name + '-end', this.end)
  },

  methods: {
    _tabDebugEnabled() {
      try {
        return new URLSearchParams(window.location.search).get('tabdebug') === '1'
      } catch {
        return false
      }
    },
    scheduleInitTabs(from = 'unknown') {
      // nextTick + rAF：确保 DOM 已稳定（避免返回瞬间测量不准）
      this.$nextTick(() => {
        requestAnimationFrame(() => {
          if (this._tabDebugEnabled()) {
            console.log('[IndicatorHome] scheduleInitTabs', { from, index: this.index })
          }
          this.initTabs()
        })
      })
    },
    change(index) {
      this.$emit('update:index', index)
      _css(this.indicatorRef, 'transition-duration', `300ms`)
      _css(this.indicatorRef, 'left', this.lefts[index] + 'px')
    },
    initTabs() {
      let tabs = this.$refs.tabs
      this.indicatorRef = this.$refs.indicator
      // ✅ 重新计算时清空，避免多次 mounted/keep-alive 导致 lefts 累积错位
      this.lefts = []
      let indicatorWidth = _css(this.indicatorRef, 'width')
      for (let i = 0; i < tabs.children.length; i++) {
        let item = tabs.children[i]
        let tabWidth = _css(item, 'width')
        this.lefts.push(
          item.getBoundingClientRect().x -
            tabs.getBoundingClientRect().x +
            (tabWidth * 0.5 - indicatorWidth / 2)
        )
      }
      this.indicatorSpace = this.lefts[1] - this.lefts[0]
      _css(this.indicatorRef, 'transition-duration', `300ms`)
      _css(this.indicatorRef, 'left', this.lefts[this.index] + 'px')
      if (this._tabDebugEnabled()) {
        const rect = tabs?.getBoundingClientRect?.()
        console.log('[IndicatorHome] initTabs', {
          index: this.index,
          tabsWidth: rect?.width,
          indicatorWidth,
          left: this.lefts?.[this.index]
        })
      }
    },
    move(e) {
      _css(this.indicatorRef, 'transition-duration', `0ms`)
      _css(
        this.indicatorRef,
        'left',
        this.lefts[this.index] - e / (this.baseStore.bodyWidth / this.indicatorSpace) + 'px'
      )
    },
    end(index) {
      this.moveY = 0
      _css(this.indicatorRef, 'transition-duration', `300ms`)
      _css(this.indicatorRef, 'left', this.lefts[index] + 'px')
      setTimeout(() => {
        _css(this.indicatorRef, 'transition-duration', `0ms`)
      }, 300)
    }
  }
}
</script>

<style scoped lang="less">
.indicator-home {
  position: absolute;
  font-size: 16rem;
  top: 0;
  left: 0;
  z-index: 2;
  width: 100%;
  color: white;
  height: var(--home-header-height);
  transition: all 0.3s;
  font-weight: bold;

  .notice {
    opacity: 0;
    top: 0;
    position: absolute;
    width: 100vw;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .loading {
    opacity: 0;
    top: 7rem;
    right: 7rem;
    position: absolute;
  }

  .toolbar {
    z-index: 2;
    position: relative;
    color: white;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: 0 15rem;
    display: flex;
    justify-content: space-between;
    align-items: center;

    .tab-ctn {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      // ✅ 收紧 Tab 占用宽度，给右侧搜索按钮留空间
      width: 74%;

      .tabs {
        display: flex;
        justify-content: center;
        align-items: center;
        // ✅ Tab 间距小一点，避免侵占搜索按钮区域
        gap: 12rem;

        .tab {
          transition: color 0.3s;
          color: rgba(white, 0.7);
          position: relative;
          font-size: 15rem;
          cursor: pointer;
          font-weight: 600;
          white-space: nowrap;
          min-width: fit-content;

          .tab1-img {
            position: absolute;
            @width: 12rem;
            width: @width;
            height: @width;
            margin-left: 4rem;
            transition: all 0.3s;
          }

          .tab2-img {
            position: absolute;
            height: 15rem;
            left: 100%;
            margin-left: 2rem;
            top: -5rem;
          }

          &.active {
            color: white;
            font-size: 16rem;
          }
        }
      }

      .indicator {
        //transition: left .3s;
        position: absolute;
        bottom: -8rem; // Adjusted bottom
        height: 3rem; // Slightly thicker
        width: 20rem; // Fixed width for indicator
        background: #fff;
        border-radius: 2rem;
      }
    }

    .search {
      position: absolute;
      right: 15rem;
      color: white;
      font-size: 24rem;
    }
  }

  .mask {
    top: 0;
    position: absolute;
    width: 100vw;
    height: calc(var(--vh, 1vh) * 100);
    background: #00000066;
  }

  // ✅ 仅安卓：部分 WebView 对 flex gap 支持不稳定，导致 tab 文案“挤成一串”
  // - 用 margin-left 作为兜底间距（iOS/desktop 仍使用 gap）
  // - 同时让 tab 容器吃满搜索按钮之外的宽度，避免明明有空间却被锁死在 74%
  :global(html.is-android) & {
    .toolbar {
      .tab-ctn {
        left: 15rem;
        right: 54rem; // 预留搜索按钮区域（24rem icon + padding）
        width: auto;
        transform: none;
      }

      .tab-ctn {
        .tabs {
          gap: 0;
          justify-content: flex-start;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;

          &::-webkit-scrollbar {
            display: none;
          }

          .tab + .tab {
            margin-left: 12rem;
          }
        }
      }
    }
  }
}
</style>
