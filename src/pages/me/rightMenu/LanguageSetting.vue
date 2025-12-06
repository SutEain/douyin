<template>
  <div class="language-setting">
    <BaseHeader>
      <template v-slot:center>
        <span class="f16">{{ $t('settings.language') }}</span>
      </template>
    </BaseHeader>
    <div class="content">
      <div class="language-list">
        <div
          v-for="lang in languages"
          :key="lang.code"
          class="language-item"
          :class="{ active: currentLang === lang.code }"
          @click.stop="selectLanguage(lang.code)"
        >
          <div class="left">
            <span class="flag">{{ lang.flag }}</span>
            <span class="name">{{ lang.name }}</span>
          </div>
          <div class="right">
            <Icon v-if="currentLang === lang.code" icon="mdi:check" class="check-icon" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useBaseStore } from '@/store/pinia'
import { useI18n } from 'vue-i18n'
import BaseHeader from '@/components/BaseHeader.vue'

defineOptions({
  name: 'LanguageSetting'
})

const baseStore = useBaseStore()
const { locale } = useI18n()

const currentLang = ref(baseStore.userinfo.lang || 'en-US')

const languages = [
  { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
  { code: 'en-US', name: 'English', flag: '🇺🇸' }
  // 暂时只开放支持的语言
  // { code: 'zh-TW', name: '繁體中文', flag: '🇹🇼' },
  // { code: 'ja', name: '日本語', flag: '🇯🇵' },
  // { code: 'ko', name: '한국어', flag: '🇰🇷' }
]

onMounted(async () => {
  if (baseStore.userinfo.lang) {
    currentLang.value = baseStore.userinfo.lang
  }
})

const selectLanguage = async (langCode: string) => {
  console.log('selectLanguage', langCode)
  currentLang.value = langCode
  locale.value = langCode

  // 更新 Store 和 数据库
  try {
    await baseStore.updateProfileFields({ lang: langCode })
  } catch (e) {
    console.error('update lang failed', e)
  }
}
</script>

<style scoped lang="less">
.language-setting {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: black;
  color: white;
  z-index: 2000;

  .content {
    padding-top: 50rem;
    height: 100vh;
    overflow-y: auto;
  }

  .language-list {
    .language-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 15rem 20rem;
      border-bottom: 1px solid #333;
      cursor: pointer;
      transition: background 0.2s;

      &:active {
        background: #222;
      }

      &.active {
        // background: #222;

        .name {
          color: var(--primary-color);
          font-weight: 600;
        }
      }

      .left {
        display: flex;
        align-items: center;
        gap: 12rem;

        .flag {
          font-size: 24rem;
        }

        .name {
          font-size: 16rem;
          color: white;
        }
      }

      .right {
        .check-icon {
          font-size: 24rem;
          color: var(--primary-color);
        }
      }
    }
  }
}
</style>
