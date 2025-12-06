<template>
  <div class="Setting">
    <BaseHeader>
      <template v-slot:center>
        <span class="f16">{{ $t('settings.title') }}</span>
      </template>
    </BaseHeader>
    <div class="content">
      <div class="title">{{ $t('settings.account') }}</div>
      <div class="row" @click="$no">
        <div class="left">
          <img src="@/assets/img/icon/newicon/left_menu/user.png" alt="" />
          <span>{{ $t('settings.accountSecurity') }}</span>
        </div>
        <div class="right">
          <dy-back direction="right"></dy-back>
        </div>
      </div>
      <div class="row" @click="$no">
        <div class="left">
          <img src="@/assets/img/icon/newicon/left_menu/lock.png" alt="" />
          <span>{{ $t('settings.privacy') }}</span>
        </div>
        <div class="right">
          <dy-back direction="right"></dy-back>
        </div>
      </div>

      <div class="line"></div>
      <div class="title">{{ $t('settings.general') }}</div>
      <div class="row" @click="$no">
        <div class="left">
          <img src="@/assets/img/icon/newicon/left_menu/remind.png" alt="" />
          <span>{{ $t('settings.notification') }}</span>
        </div>
        <div class="right">
          <dy-back direction="right"></dy-back>
        </div>
      </div>
      <div class="row" @click="$no">
        <div class="left">
          <img src="@/assets/img/icon/newicon/left_menu/setting-two.png" alt="" />
          <span>{{ $t('settings.generalSettings') }}</span>
        </div>
        <div class="right">
          <dy-back direction="right"></dy-back>
        </div>
      </div>
      <div class="row" @click="$nav('/me/right-menu/language-setting')">
        <div class="left">
          <img src="@/assets/img/icon/newicon/left_menu/about.png" alt="" />
          <span>{{ $t('settings.language') }}</span>
        </div>
        <div class="right">
          <dy-back direction="right"></dy-back>
        </div>
      </div>
      <div class="line"></div>

      <div class="row" @click="$no">
        <div class="left">
          <img src="@/assets/img/icon/newicon/left_menu/logout.png" alt="" />
          <span>{{ $t('settings.logout') }}</span>
        </div>
        <div class="right">
          <dy-back direction="right"></dy-back>
        </div>
      </div>

      <div class="version">{{ $t('settings.version', { version: gitLastCommitHash }) }}</div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { getCurrentInstance, ref } from 'vue'
import { _no } from '@/utils'

const gitLastCommitHash = ref(LATEST_COMMIT_HASH)
const internalInstance = getCurrentInstance()
const router = internalInstance?.appContext.config.globalProperties.$router

const $nav = (path: string) => {
  router?.push(path)
}

const $no = () => {
  _no()
}

defineOptions({
  name: 'Setting'
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
  z-index: 1100; // 确保在其他层级之上，但低于 LanguageSetting (2000)
  background: var(--main-bg);

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
      height: 1px;
      margin-top: 5rem;
      margin-bottom: 5rem;
    }

    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15rem 20rem;
      font-size: 15rem;
      transition: background-color 0.2s;

      &:active {
        background-color: var(--active-main-bg);
      }

      .left {
        display: flex;
        align-items: center;

        img {
          width: 20rem;
          height: 20rem;
          margin-right: 12rem;
        }

        span {
          color: white;
        }
      }

      .right {
        display: flex;
        align-items: center;
        color: var(--second-text-color);
      }
    }
  }
}
</style>
