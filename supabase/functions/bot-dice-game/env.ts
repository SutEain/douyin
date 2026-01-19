// bot-dice-game-v2: 环境变量集中管理

export const BOT_TOKEN = Deno.env.get('DICE_BOT_TOKEN')!
export const TG_API_BASE =
  Deno.env.get('TG_API_BASE') || Deno.env.get('TELEGRAM_API_BASE') || 'https://api.telegram.org'

// 本地开发用 SB_ 前缀，生产环境用 SUPABASE_ 前缀
export const SUPABASE_URL = Deno.env.get('SB_URL') || Deno.env.get('SUPABASE_URL')!
export const SUPABASE_SERVICE_KEY =
  Deno.env.get('SB_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
