<template>
  <div class="language-setting">
    <BaseHeader>
      <template v-slot:center>
        <span class="f16">语言设置</span>
      </template>
    </BaseHeader>
    <div class="content">
      <div class="language-list">
        <div
          v-for="lang in languages"
          :key="lang.code"
          class="language-item"
          :class="{ active: currentLang === lang.code }"
          @click="selectLanguage(lang.code)"
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
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { supabase } from '@/utils/supabase'
import { useBaseStore } from '@/store/pinia'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const baseStore = useBaseStore()
const { locale } = useI18n()

const currentLang = ref('zh-CN')

const languages = [
  { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
  { code: 'en-US', name: 'English', flag: '🇺🇸' },
  { code: 'zh-TW', name: '繁體中文', flag: '🇹🇼' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' }
]

onMounted(async () => {
  // 获取当前用户的语言设置
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('lang')
      .eq('id', user.id)
      .single()

    if (profile?.lang) {
      currentLang.value = profile.lang
      locale.value = profile.lang
    }
  }
})

const selectLanguage = async (langCode: string) => {
  currentLang.value = langCode
  locale.value = langCode

  // 更新数据库
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (user) {
    const { error } = await supabase.from('profiles').update({ lang: langCode }).eq('id', user.id)

    if (!error) {
      // 显示成功提示
      console.log('语言设置已更新')
      // 可以添加 Toast 提示
    }
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
  background: #fff;

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
      border-bottom: 1rem solid #f5f5f5;
      cursor: pointer;
      transition: background 0.2s;

      &:active {
        background: #f5f5f5;
      }

      &.active {
        background: #f0f9ff;

        .name {
          color: #1890ff;
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
          color: #333;
        }
      }

      .right {
        .check-icon {
          font-size: 24rem;
          color: #1890ff;
        }
      }
    }
  }
}
</style>
