// bot-video-upload: 统一键盘构造（仅重构，不改行为）

import { TG_MINIAPP_URL } from './env.ts'

export function getPersistentKeyboard() {
  const keyboard: any[][] = [[{ text: '📹 我的视频' }, { text: '👤 个人中心' }]]

  // ✅ 底部增加“打开 Mini App”的按钮（需要配置 TG_MINIAPP_URL）
  // 注意：web_app.url 必须是 https 且通常需要在 BotFather 配置允许域名
  if (TG_MINIAPP_URL && /^https:\/\//.test(TG_MINIAPP_URL)) {
    keyboard.push([
      {
        text: '开始刷TG抖音',
        web_app: { url: TG_MINIAPP_URL }
      }
    ])
  }

  return {
    keyboard,
    resize_keyboard: true,
    persistent: true
  }
}
