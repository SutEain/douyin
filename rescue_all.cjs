/* eslint-disable no-undef */
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '.env') })
/* eslint-disable */
const axios = require('axios')
const { createClient } = require('@supabase/supabase-js')

/**
 * 补救脚本 v2.1
 * 
 * 功能：
 * 1. 扫描所有 status = 'processing' 的视频/图片/相册
 * 2. 识别出其中的 Telegram file_id
 * 3. 触发 Worker 进行下载、处理并上传到 R2
 * 
 * 使用方式：
 * node rescue_all.js "你的机器人TOKEN"
 */

// 1. 初始化 Supabase
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 错误: 未找到 Supabase 配置 (SUPABASE_URL / SUPABASE_SERVICE_KEY)')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// 2. 环境配置
// 🎯 优先级：命令行参数 > 环境变量
const BOT_TOKEN = (process.argv[2] || process.env.TG_BOT_TOKEN || process.env.BOT_TOKEN || '').trim()
const WORKER_URL = process.env.BOT_WORKER_URL || 'http://localhost:3000/process'

async function rescueAll() {
  if (!BOT_TOKEN) {
    console.error('❌ 错误: 未提供机器人 Token。')
    console.log('使用方法: node rescue_all.js "你的TOKEN"')
    process.exit(1)
  }

  console.log(`\n-----------------------------------------`)
  console.log(`🤖 准备使用 Token: ${BOT_TOKEN.substring(0, 6)}... 进行补救`)
  console.log(`🔗 Worker 地址: ${WORKER_URL}`)
  console.log(`-----------------------------------------\n`)

  console.log('🔍 正在扫描需要补救的作品 (processing 或存储在 Telegram)...')

  // 查询所有需要修复的作品
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, tg_file_id, tg_user_id, status, content_type, media_list, tg_thumbnail_file_id, storage_type')
    .or('status.eq.processing,storage_type.eq.telegram,storage_type.eq.r2_pending')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('❌ 查询失败:', error.message)
    return
  }

  if (!videos || videos.length === 0) {
    console.log('✨ 没有发现卡在 processing 状态的作品。')
    return
  }

  console.log(`📊 发现 ${videos.length} 个作品需要处理...\n`)

  let totalTasks = 0
  for (const v of videos) {
    const tasks = []

    if (v.content_type === 'video' || v.content_type === 'image') {
      // 单文件模式
      if (v.tg_file_id) {
        tasks.push({ fileId: v.tg_file_id, thumbnailFileId: v.tg_thumbnail_file_id })
      }
    } else {
      // 相册或合集模式：遍历 media_list，找出没有 play_url 的项
      let list = []
      try {
        list = Array.isArray(v.media_list) ? v.media_list : JSON.parse(v.media_list || '[]')
      } catch (e) {
        console.warn(`   ⚠️ [${v.id}] media_list 解析失败`)
        continue
      }

      for (const item of list) {
        // 如果没有 play_url 或者 play_url 包含 undefined/telegram (旧格式)，则需要重刷
        const needsUpload = !item.play_url || 
                           item.play_url.includes('undefined') || 
                           item.storage_type === 'telegram' ||
                           !item.play_url.startsWith('http')

        if (needsUpload && item.file_id) {
          tasks.push({ 
            fileId: item.file_id, 
            thumbnailFileId: item.cover_url // 相册项的 cover_url 通常存的是 thumbnail 的 file_id
          })
        }
      }
    }

    if (tasks.length === 0) {
      continue
    }

    console.log(`🚀 [${v.id}] (${v.content_type}) 发现 ${tasks.length} 个待上传项...`)
    totalTasks += tasks.length

    for (const t of tasks) {
      try {
        const payload = {
          video_id: v.id,
          file_id: t.fileId,
          chat_id: v.tg_user_id,
          bot_token: BOT_TOKEN,
          message_id: 0,
          thumbnail_file_id: t.thumbnailFileId
        }

        const resp = await axios.post(WORKER_URL, payload)
        console.log(`   ✅ [${t.fileId.substring(0, 10)}...] -> Worker 已接收`)

        // 每发送一个文件休息 1 秒，避免冲击 Worker
        await new Promise((r) => setTimeout(r, 1000))
      } catch (err) {
        console.error(`   ❌ [${t.fileId.substring(0, 10)}...] 发送失败:`, err.message)
      }
    }
  }

  console.log(`\n✅ 所有补救指令已发出 (共计 ${totalTasks} 个文件任务)。`)
  console.log('请观察 Worker 服务器的 PM2 日志确认进度。')
}

rescueAll().catch(console.error)
