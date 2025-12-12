// bot-video-upload: 环境变量集中管理（仅重构，不改行为）

export const BOT_TOKEN = Deno.env.get('TG_BOT_TOKEN')!
export const TG_API_BASE = Deno.env.get('TELEGRAM_API_BASE') || 'https://api.telegram.org'
export const BOT_WORKER_URL = Deno.env.get('BOT_WORKER_URL')
export const TG_FILE_PROXY_URL =
  Deno.env.get('TG_CDN_PROXY_URL') || Deno.env.get('TG_VIDEO_PROXY_URL')

// Telegram Mini App (Web App) URL，用于键盘按钮打开小程序
// 建议在环境变量中配置 TG_MINIAPP_URL（必须是 https）
export const TG_MINIAPP_URL =
  (Deno.env.get('TG_MINIAPP_URL') || Deno.env.get('MINIAPP_URL') || '').trim() || null

// Telegram Mini App 的 t.me 启动链接（用于 inline button / 普通 URL 跳转）
// 例如: https://t.me/tg_douyin_bot/tgdouyin
export const TG_MINIAPP_TME_URL = Deno.env.get('TG_MINIAPP_TME_URL')

// 本地开发用 SB_ 前缀，生产环境用 SUPABASE_ 前缀
export const SUPABASE_URL = Deno.env.get('SB_URL') || Deno.env.get('SUPABASE_URL')!
export const SUPABASE_SERVICE_KEY =
  Deno.env.get('SB_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
