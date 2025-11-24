<template>
  <div class="Setting">
    <BaseHeader>
      <template v-slot:center>
        <span class="f16">设置</span>
      </template>
    </BaseHeader>
    <div class="content">
      <div class="title">帐号</div>
      <div class="row">
        <div class="left">
          <img src="@/assets/img/icon/newicon/left_menu/user.png" alt="" />
          <span>帐号与安全</span>
        </div>
        <div class="right">
          <dy-back direction="right"></dy-back>
        </div>
      </div>
      <div class="row">
        <div class="left">
          <img src="@/assets/img/icon/newicon/left_menu/lock.png" alt="" />
          <span>隐私设置</span>
        </div>
        <div class="right">
          <dy-back direction="right"></dy-back>
        </div>
      </div>

      <div class="line"></div>
      <div class="title">通用</div>
      <div class="row">
        <div class="left">
          <img src="@/assets/img/icon/newicon/left_menu/remind.png" alt="" />
          <span>通知设置</span>
        </div>
        <div class="right">
          <dy-back direction="right"></dy-back>
        </div>
      </div>
      <div class="row">
        <div class="left">
          <img src="@/assets/img/icon/newicon/left_menu/setting-two.png" alt="" />
          <span>通用设置</span>
        </div>
        <div class="right">
          <dy-back direction="right"></dy-back>
        </div>
      </div>
      <div class="row">
        <div class="left">
          <img src="@/assets/img/icon/newicon/left_menu/about.png" alt="" />
          <span>语言设置</span>
        </div>
        <div class="right">
          <dy-back direction="right"></dy-back>
        </div>
      </div>
      <div class="line"></div>

      <div class="row">
        <div class="left">
          <img src="@/assets/img/icon/newicon/left_menu/logout.png" alt="" />
          <span>退出登录</span>
        </div>
        <div class="right">
          <dy-back direction="right"></dy-back>
        </div>
      </div>

      <div class="version">抖音 {{ gitLastCommitHash }}</div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'

const gitLastCommitHash = ref(LATEST_COMMIT_HASH)

defineOptions({
  name: 'ChooseSchool'
})
</script>

<style scoped lang="less">
@import '@/assets/less/index';

.Setting {
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

    .title {
      color: var(--second-text-color);
      font-size: 13rem;
      margin: 20rem 0 0 20rem;
    }

    .version {
      color: var(--second-text-color);
      font-size: 13rem;
      margin: 40rem;
      text-align: center;
    }

    .line {
      width: calc(100% - 30rem);
      margin-left: 15rem;
      background: var(--line-color);
    }
  }
}
</style>
