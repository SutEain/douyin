/* eslint-disable */
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '.env') })
const axios = require('axios')
const { createClient } = require('@supabase/supabase-js')

// 1. 初始化 Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
)

const BOT_TOKEN = process.env.TG_BOT_TOKEN ? process.env.TG_BOT_TOKEN.trim() : null
const WORKER_URL = 'http://localhost:3000/process'

async function rescue() {
  if (!BOT_TOKEN) {
    console.error('❌ 错误: 请在环境变量或 .env 中设置 TG_BOT_TOKEN')
    process.exit(1)
  }

  console.log('🔍 正在扫描卡在 r2_pending 状态的视频...')

  // 2. 查询卡住的视频 (优先处理 status = 'processing' 且 storage_type = 'r2_pending' 的视频)
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, tg_file_id, tg_thumbnail_file_id, tg_user_id, status')
    .eq('storage_type', 'r2_pending')
    .eq('status', 'processing') // 🎯 优先处理处理中的
    .not('tg_file_id', 'is', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('❌ 查询失败:', error.message)
    return
  }

  if (!videos || videos.length === 0) {
    console.log('✨ 没有发现需要修复的视频。')
    return
  }

  console.log(`📊 发现 ${videos.length} 个视频需要重新触发处理...\n`)

  for (const video of videos) {
    console.log(`🚀 正在发送任务 [${video.id}] 到 Worker...`)
    
    try {
      const payload = {
        video_id: video.id,
        file_id: video.tg_file_id,
        thumbnail_file_id: video.tg_thumbnail_file_id, // 🎯 传递缩略图 ID
        chat_id: video.tg_user_id,
        bot_token: BOT_TOKEN,
        message_id: null // 补救任务没有原始消息 ID
      }

      const resp = await axios.post(WORKER_URL, payload)
      console.log(`   ✅ Worker 已接收:`, resp.data)
      
      // 🎯 休息 2 秒，避免给服务器太大压力
      await new Promise(r => setTimeout(r, 2000))
    } catch (err) {
      console.error(`   ❌ 发送失败:`, err.message)
    }
  }

  console.log('\n✅ 补救任务发送完毕。请观察 PM2 日志确认处理进度。')
}

rescue().catch(console.error)

