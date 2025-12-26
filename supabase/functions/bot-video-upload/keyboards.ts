// bot-video-upload: 统一键盘构造（仅重构，不改行为）

import { TG_MINIAPP_URL } from './env.ts'

export function getPersistentKeyboard() {
  return {
    keyboard: [[{ text: '🏠 首页' }, { text: '👤 个人中心' }]],
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
      ],
      [
        { text: '📹 我的作品', callback_data: 'my_videos' },
        { text: '📤 发布作品', callback_data: 'upload_video' }
      ],
      [
        { text: '👤 个人中心', callback_data: 'user_profile' },
        { text: '💰 邀请赚钱', callback_data: 'profile_invite_unlock' }
      ],
      [{ text: '📢 TG抖音官方群', url: 'https://t.me/niub' }]
    ]
  }
}
