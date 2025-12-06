<template>
  <div class="indicator-home" :class="{ isLight }">
    <div class="notice" :style="noticeStyle"><span>{{ $t('home.refreshContent') }}</span></div>
    <div class="toolbar" ref="toolbar" :style="toolbarStyle">
      <div class="tab-ctn">
        <div class="tabs" ref="tabs">
          <!-- 长视频 - 禁用 -->
          <div class="tab disabled">
            <span style="opacity: 0.3;">{{ $t('home.longVideo') }}</span>
          </div>
          
          <!-- 关注 - 禁用 -->
          <div class="tab disabled">
            <span style="opacity: 0.3;">{{ $t('home.following') }}</span>
            <img src="../../../assets/img/icon/live.webp" class="tab2-img" style="opacity: 0.3;" />
          </div>
          
          <!-- 推荐 - 唯一可用的 tab -->
          <div class="tab active" @click.stop="change(2)">
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
  unmounted() {
    bus.off(this.name + '-moveX', this.move)
    bus.off(this.name + '-moveY')
    bus.off(this.name + '-end', this.end)
  },

  methods: {
    change(index) {
      this.$emit('update:index', index)
      _css(this.indicatorRef, 'transition-duration', `300ms`)
      _css(this.indicatorRef, 'left', this.lefts[index] + 'px')
    },
    initTabs() {
      let tabs = this.$refs.tabs
      this.indicatorRef = this.$refs.indicator
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
      width: 75%;

      .tabs {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 30rem;

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
}
</style>
