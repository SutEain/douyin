<template>
  <div class="footer" :class="{ isWhite }">
    <div class="l-button" @click="tab(1)">
      <span :class="{ active: currentTab === 1 }">{{ $t('home.home') }}</span>
    </div>

    <!-- ✅ 中间分割线 -->
    <div class="divider"></div>

    <div class="l-button" @click="tab(5)">
      <span :class="{ active: currentTab === 5 }">{{ $t('home.me') }}</span>
    </div>
  </div>
</template>

<script>
export default {
  name: 'BaseFooter',
  props: ['initTab', 'isWhite'],
  data() {
    return {
      currentTab: this.initTab
    }
  },
  watch: {
    // ✅ 监听 initTab 变化，确保 currentTab 同步更新
    initTab(newVal) {
      this.currentTab = newVal
    },
    // ✅ 监听路由变化，更新 currentTab
    '$route.path'(newPath) {
      if (newPath === '/' || newPath === '/home') {
        this.currentTab = 1
      } else if (newPath === '/me') {
        this.currentTab = 5
      }
    }
  },
  methods: {
    $nav(path) {
      this.$router.push(path)
    },
    tab(index) {
      switch (index) {
        case 1:
          this.$nav('/')
          break
        case 5:
          this.$nav('/me')
          break
      }
    }
  }
}
</script>

<style scoped lang="less">
@import '../assets/less/index';

.footer {
  font-size: 14rem;
  position: fixed;
  width: 100%;
  height: var(--footer-height);
  //border-top: 1px solid #7b7878;
  z-index: 2;
  //不用bottom：0是因为，在进行页面切换的时候，vue的transition
  // 会使footer的bottom：0失效，不能准确定位
  top: calc(var(--vh, 1vh) * 100 - var(--footer-height));
  //bottom: 0;
  background: var(--footer-color);
  color: white;
  display: flex;
  //justify-content: space-between;

  &.isWhite {
    background: white !important;
    color: #000 !important;
  }

  .l-button {
    flex: 1; // ✅ 平分空间（2个按钮各占50%）
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
    font-size: 16rem;

    span {
      cursor: pointer;
      font-weight: bold;
      opacity: 0.7;

      &.active {
        opacity: 1;
      }
    }

    .badge {
      right: 14rem;
      top: 12rem;
      position: absolute;
    }
  }

  // ✅ 中间分割线
  .divider {
    width: 1px;
    height: 50%;
    background: rgba(128, 128, 128, 0.3); // 灰色半透明
    align-self: center;
  }
}
</style>
