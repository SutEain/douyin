<template>
  <div class="indicator-home" :class="{ isLight }">
    <div class="notice" :style="noticeStyle">
      <span>{{ $t('home.refreshContent') }}</span>
    </div>
    <div class="toolbar" ref="toolbar" :style="toolbarStyle">
      <div class="tab-ctn">
        <div class="tabs" ref="tabs">
          <!-- 关注 -->
          <div class="tab" :class="{ active: index === 0 }" @click.stop="change(0)">
            <span>{{ $t('home.following') }}</span>
          </div>

          <!-- 图文 Tab -->
          <div class="tab" :class="{ active: index === 1 }" @click.stop="change(1)">
            <span>图文</span>
          </div>

          <!-- 视频 Tab -->
          <div class="tab" :class="{ active: index === 2 }" @click.stop="change(2)">
            <span>视频</span>
          </div>

          <!-- 短剧 Tab -->
          <div class="tab" :class="{ active: index === 3 }" @click.stop="change(3)">
            <span>短剧</span>
          </div>

          <!-- 东南亚 Tab -->
          <div class="tab" :class="{ active: index === 4 }" @click.stop="change(4)">
            <span>东南亚</span>
          </div>

          <!-- 直播 Tab -->
          <div class="tab" :class="{ active: index === 5 }" @click.stop="change(5)">
            <span>直播</span>
          </div>

          <!-- 成人内容 Tab -->
          <div class="tab" :class="{ active: index === 6 }" @click.stop="change(6)">
            <span>成人</span>
          </div>

          <!-- 推荐 -->
          <div class="tab" :class="{ active: index === 7 }" @click.stop="change(7)">
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
  top: var(--tg-top-offset, 0px);
  left: 0;
  z-index: 2;
  width: 100%;
  color: white;
  height: var(--home-header-height);
  transition: all 0.3s;
  font-weight: bold;
  box-sizing: border-box;

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
      // ✅ 自动宽度并限制最大宽度，避免挡住右侧搜索按钮
      width: fit-content;
      max-width: 70%;

      .tabs {
        display: flex;
        justify-content: center;
        align-items: center;
        // ✅ Tab 间距再缩小一点
        gap: 8rem;

        .tab {
          transition: color 0.3s;
          color: rgba(white, 0.7);
          position: relative;
          font-size: 13rem;
          cursor: pointer;
          font-weight: 600;
          white-space: nowrap;
          min-width: fit-content;

          .tab1-img {
            position: absolute;
            @width: 8rem;
            width: @width;
            height: @width;
            margin-left: 2rem;
            transition: all 0.3s;
          }

          .tab2-img {
            position: absolute;
            height: 12rem;
            left: 100%;
            margin-left: 2rem;
            top: -4rem;
          }

          &.active {
            color: white;
            font-size: 14rem;
          }
        }
      }

      .indicator {
        //transition: left .3s;
        position: absolute;
        bottom: -5rem; // Adjusted bottom
        height: 2rem; // Thinner
        width: 16rem; // Fixed width for indicator
        background: #fff;
        border-radius: 2rem;
      }
    }

    // ✅ 小屏：Tab 容器撑满“除右上角搜索按钮之外”的区域（不改 JS，避免风险）
    // - 桌面不动；移动端更宽松
    // - right 预留搜索按钮区域：icon(24rem) + 右侧 padding(15rem) + 缓冲(≈21rem) => 60rem
    @media screen and (max-width: 500px) {
      .tab-ctn {
        left: 60rem; // ✅ 左右对称：左边也预留与右边搜索按钮相同的距离
        right: 60rem; // ✅ 预留搜索按钮区域
        width: auto;
        transform: none;

        .tabs {
          justify-content: space-between; // ✅ 在对称区域内均匀铺满
          gap: 0;

          .tab + .tab {
            margin-left: 8rem;
          }
        }
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
}
</style>
