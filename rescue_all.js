/* eslint-disable no-undef */
require('dotenv').config()
/* eslint-disable */
const axios = require('axios')
const { createClient } = require('@supabase/supabase-js')

// 1. 初始化 Supabase (参考 index.js)
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// 2. 环境配置
const BOT_TOKEN = (process.env.TG_BOT_TOKEN || process.env.BOT_TOKEN || '').trim()
const WORKER_URL = process.env.BOT_WORKER_URL || 'http://localhost:3000/process'

async function rescueAll() {
  if (!BOT_TOKEN) {
    console.error('❌ 错误: 未找到机器人 Token。请在环境变量或 .env 中设置 TG_BOT_TOKEN')
    console.log('当前尝试读取的变量:', {
      TG_BOT_TOKEN: process.env.TG_BOT_TOKEN ? '已设置' : '未设置',
      BOT_TOKEN: process.env.BOT_TOKEN ? '已设置' : '未设置'
    })
    process.exit(1)
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ 错误: 未找到 Supabase 配置。')
    process.exit(1)
  }

  console.log(`🤖 准备使用 Token: ${BOT_TOKEN.substring(0, 6)}... 进行补救`)
  console.log(`🔗 Worker 地址: ${WORKER_URL}`)
  console.log('🔍 正在扫描所有卡在 processing 状态的作品...')

  // 查询所有 processing 的视频/相册/合集
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, tg_file_id, tg_user_id, status, content_type, media_list')
    .eq('status', 'processing')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('❌ 查询失败:', error.message)
    return
  }

  if (!videos || videos.length === 0) {
    console.log('✨ 没有发现卡住的作品。')
    return
  }

  console.log(`📊 发现 ${videos.length} 个作品卡在处理中，开始分析任务...\n`)

  for (const v of videos) {
    const tasks = []

    if (v.content_type === 'video' || v.content_type === 'image') {
      // 单文件模式
      if (v.tg_file_id) {
        tasks.push({ fileId: v.tg_file_id })
      }
    } else {
      // 相册或合集模式：遍历 media_list，找出没有 play_url 的项
      const list = Array.isArray(v.media_list) ? v.media_list : JSON.parse(v.media_list || '[]')
      for (const item of list) {
        if (!item.play_url || item.play_url.includes('undefined')) {
          tasks.push({ fileId: item.file_id })
        }
      }
    }

    if (tasks.length === 0) {
      console.log(`- ⏩ [${v.id}] 无需处理 (已完成或无文件 ID)`)
      continue
    }

    console.log(`🚀 [${v.id}] (${v.content_type}) 发现 ${tasks.length} 个待上传项...`)

    for (const t of tasks) {
      try {
        const payload = {
          video_id: v.id,
          file_id: t.fileId,
          chat_id: v.tg_user_id,
          bot_token: BOT_TOKEN,
          message_id: 0
        }

        const resp = await axios.post(WORKER_URL, payload)
        console.log(`   ✅ 文件 [${t.fileId.substring(0, 10)}...] 已发送到 Worker`)

        // 每发送一个文件休息 1 秒
        await new Promise((r) => setTimeout(r, 1000))
      } catch (err) {
        console.error(`   ❌ 发送失败 [${t.fileId}]:`, err.message)
      }
    }
  }

  console.log('\n✅ 所有补救指令已发出。请观察上传服务器的 PM2 日志。')
}

rescueAll().catch(console.error)
