import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN.json'
import enUS from './en-US.json'

const i18n = createI18n({
  legacy: false, // Use Composition API mode
  locale: 'zh-CN', // Default locale
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    zh: zhCN,
    'zh-hans': zhCN,
    en: enUS,
    'en-US': enUS
  }
})

export default i18n
