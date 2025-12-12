// bot-video-upload: 统一键盘构造（仅重构，不改行为）

import { TG_MINIAPP_URL } from './env.ts'

export function getPersistentKeyboard() {
  return {
    keyboard: [[{ text: '📹 我的视频' }, { text: '👤 个人中心' }]],
    resize_keyboard: true,
    persistent: true
  }
}

export function getWelcomeKeyboard() {
  if (!TG_MINIAPP_URL) return undefined

  return {
    inline_keyboard: [
      [
        {
          text: '🚀 开始刷抖音',
          web_app: { url: TG_MINIAPP_URL }
        }
      ]
    ]
  }
}
