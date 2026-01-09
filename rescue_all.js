/* eslint-disable no-undef */
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '.env') })
/* eslint-disable */
const axios = require('axios')
const { createClient } = require('@supabase/supabase-js')

/**
 * 补救脚本 v3.0 - 持续运行模式
 *
 * 功能：
 * 1. 持续运行，每30分钟扫描一次
 * 2. 扫描所有 status = 'processing' 的视频/图片/相册
 * 3. 识别出其中的 Telegram file_id
 * 4. 触发 Worker 进行下载、处理并上传到 R2
 *
 * 使用方式：
 * node rescue_all.js "你的机器人TOKEN"
 *
 * 环境变量：
 * - SCAN_INTERVAL: 扫描间隔（分钟），默认 30
 * - MAX_CONCURRENT: 并发提交数，默认 5
 * - BATCH_DELAY: 批次延迟（毫秒），默认 200
 */

// 1. 初始化 Supabase
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 错误: 未找到 Supabase 配置 (SUPABASE_URL / SUPABASE_SERVICE_KEY)')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// 2. 环境配置
// 🎯 优先级：命令行参数 > 环境变量
const BOT_TOKEN = (
  process.argv[2] ||
  process.env.TG_BOT_TOKEN ||
  process.env.BOT_TOKEN ||
  ''
).trim()
const WORKER_URL = process.env.BOT_WORKER_URL || 'http://localhost:3000/process'
const SCAN_INTERVAL = parseInt(process.env.SCAN_INTERVAL || '30') // 默认30分钟

// 🎯 运行状态
let isRunning = false
let isShuttingDown = false

async function rescueAll() {
  if (isRunning) {
    console.log('⏸️  上次扫描还在进行中，跳过本次扫描')
    return
  }

  isRunning = true
  const startTime = Date.now()

  try {
    if (!BOT_TOKEN) {
      console.error('❌ 错误: 未提供机器人 Token。')
      console.log('使用方法: node rescue_all.js "你的TOKEN"')
      process.exit(1)
    }

    console.log(`\n-----------------------------------------`)
    console.log(`🤖 准备使用 Token: ${BOT_TOKEN.substring(0, 6)}... 进行补救`)
    console.log(`🔗 Worker 地址: ${WORKER_URL}`)
    console.log(`-----------------------------------------\n`)

    console.log('🔍 正在扫描需要补救的作品...')

    // 🎯 查询条件：
    // 1. status = 'processing' 或 storage_type = 'telegram'/'r2_pending'（正在处理）
    // 2. content_type = 'image' 且有 tg_file_id（单图，需要检查 play_url）
    // 注意：单图即使 status 不是 processing，如果 play_url 无效也需要补救
    const { data: videos, error } = await supabase
      .from('videos')
      .select(
        'id, tg_file_id, tg_user_id, status, content_type, media_list, tg_thumbnail_file_id, storage_type, play_url, cover_url'
      )
      .or('status.eq.processing,storage_type.eq.telegram,storage_type.eq.r2_pending')
      .order('created_at', { ascending: false })

    // 🎯 额外查询：单图但 play_url 无效的情况（即使 status 不是 processing）
    // 包括：
    // 1. play_url 为空、null、包含 undefined
    // 2. play_url 指向 .m3u8 文件（图片不应该有视频格式的 play_url）
    // 3. play_url 不是有效的图片路径（不是以 /videos/{id}/ 开头且是图片格式）
    const { data: imageVideos, error: imageError } = await supabase
      .from('videos')
      .select(
        'id, tg_file_id, tg_user_id, status, content_type, media_list, tg_thumbnail_file_id, storage_type, play_url, cover_url'
      )
      .eq('content_type', 'image')
      .or('play_url.is.null,play_url.eq.,play_url.like.%undefined%,play_url.like.%.m3u8%')
      .not('status', 'eq', 'processing')
      .not('storage_type', 'eq', 'telegram')
      .not('storage_type', 'eq', 'r2_pending')
      .order('created_at', { ascending: false })

    if (imageError) {
      console.warn('⚠️  查询单图失败:', imageError.message)
    }

    // 🎯 额外查询：已发布的合辑（collection），检查 media_list 中是否有需要处理的项
    // 老合辑的问题：media_list 中的视频 play_url 可能是 null 或 .mp4 格式（不是 HLS）
    const { data: publishedCollections, error: collectionError } = await supabase
      .from('videos')
      .select(
        'id, tg_file_id, tg_user_id, status, content_type, media_list, tg_thumbnail_file_id, storage_type, play_url, cover_url'
      )
      .eq('content_type', 'collection')
      .eq('status', 'published')
      .eq('storage_type', 'r2')
      .order('created_at', { ascending: false })
      .limit(1000) // 🎯 限制查询数量，避免一次性查询太多

    if (collectionError) {
      console.warn('⚠️  查询已发布合辑失败:', collectionError.message)
    }

    // 🎯 合并结果，去重
    const allVideos = [...(videos || [])]
    if (imageVideos && imageVideos.length > 0) {
      const existingIds = new Set(allVideos.map((v) => v.id))
      for (const img of imageVideos) {
        if (!existingIds.has(img.id)) {
          allVideos.push(img)
        }
      }
    }
    // 🎯 添加已发布的合辑，但需要检查 media_list 中是否有需要处理的项
    if (publishedCollections && publishedCollections.length > 0) {
      const existingIds = new Set(allVideos.map((v) => v.id))
      for (const coll of publishedCollections) {
        if (!existingIds.has(coll.id)) {
          // 🎯 检查 media_list 中是否有需要处理的项
          try {
            const list = Array.isArray(coll.media_list)
              ? coll.media_list
              : JSON.parse(coll.media_list || '[]')
            let hasInvalidItems = false
            for (const item of list) {
              const itemPlayUrl = item.play_url ? String(item.play_url) : ''
              const isNullOrEmpty =
                !itemPlayUrl || itemPlayUrl === 'null' || itemPlayUrl.includes('undefined')
              const isMp4Format = itemPlayUrl && itemPlayUrl.endsWith('.mp4')
              const isNotHls =
                itemPlayUrl &&
                !itemPlayUrl.endsWith('.m3u8') &&
                !itemPlayUrl.includes('/index.m3u8')
              const missingIsHlsFlag = item.type === 'video' && !item.is_hls && isNotHls
              if (isNullOrEmpty || isMp4Format || missingIsHlsFlag) {
                hasInvalidItems = true
                break
              }
            }
            if (hasInvalidItems) {
              allVideos.push(coll)
            }
          } catch (e) {
            console.warn(`   ⚠️ [${coll.id}] media_list 解析失败，跳过`)
          }
        }
      }
    }

    if (error) {
      console.error('❌ 查询失败:', error.message)
      return
    }

    if (allVideos.length === 0) {
      console.log('✨ 没有发现需要补救的作品。')
      return
    }

    console.log(`📊 发现 ${allVideos.length} 个作品需要处理...`)
    if (imageVideos && imageVideos.length > 0) {
      console.log(`   📸 其中 ${imageVideos.length} 个是单图 play_url 无效的情况`)
    }
    if (publishedCollections && publishedCollections.length > 0) {
      const collectionCount = allVideos.filter(
        (v) => v.content_type === 'collection' && v.status === 'published'
      ).length
      if (collectionCount > 0) {
        console.log(
          `   🎬 其中 ${collectionCount} 个是已发布合辑需要重新处理（media_list 中有无效 play_url）`
        )
      }
    }
    console.log()

    // 🎯 收集所有任务
    const allTasks = []
    for (const v of allVideos) {
      const tasks = []

      if (v.content_type === 'video' || v.content_type === 'image') {
        // 单文件模式
        // 🎯 对于单图，如果没有 tg_file_id，尝试从 media_list 中获取 file_id
        let fileId = v.tg_file_id
        if (!fileId && v.content_type === 'image' && v.media_list) {
          try {
            const list = Array.isArray(v.media_list)
              ? v.media_list
              : JSON.parse(v.media_list || '[]')
            if (list.length > 0 && list[0].file_id) {
              fileId = list[0].file_id
              console.log(
                `   🔍 [${v.id}] 从 media_list 获取 file_id: ${fileId.substring(0, 20)}...`
              )
            }
          } catch (e) {
            console.warn(`   ⚠️ [${v.id}] media_list 解析失败`)
          }
        }

        if (fileId) {
          // 🎯 对于单图，额外检查 play_url 是否有效
          if (v.content_type === 'image') {
            const playUrl = String(v.play_url || '')
            const coverUrl = String(v.cover_url || '')

            // 🎯 如果 play_url 为空、包含 undefined、指向 .m3u8（视频格式），则需要重新处理
            // 图片不应该有视频格式的 play_url
            const hasInvalidPlayUrl =
              !playUrl ||
              playUrl.includes('undefined') ||
              playUrl.includes('.m3u8') || // 🎯 图片不应该有视频格式的 play_url
              (!playUrl.startsWith('http') && !playUrl.startsWith('/'))

            // 🎯 如果 cover_url 也没有，也需要处理
            const hasInvalidCoverUrl =
              !coverUrl || (!coverUrl.startsWith('http') && !coverUrl.startsWith('/'))

            const needsUpload = hasInvalidPlayUrl || hasInvalidCoverUrl

            if (!needsUpload) {
              console.log(`   ⏭️  [${v.id}] 单图已有有效 play_url，跳过`)
              continue
            }
          }

          // 🎯 同样检查缩略图是否已是 URL
          const thumbId =
            v.tg_thumbnail_file_id && !String(v.tg_thumbnail_file_id).startsWith('http')
              ? v.tg_thumbnail_file_id
              : null

          tasks.push({
            videoId: v.id,
            fileId: fileId, // 🎯 使用从 media_list 获取的 file_id（如果有）
            thumbnailFileId: thumbId,
            chatId: v.tg_user_id,
            contentType: v.content_type
          })
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
          // 🛡️ 防御性检查：确保 item 存在且 play_url 是字符串
          const itemPlayUrl = item.play_url ? String(item.play_url) : ''
          const itemCoverUrl = String(item.cover_url || '')

          // 🎯 检测需要重新处理的情况：
          // 1. play_url 为 null、空字符串或包含 undefined
          // 2. play_url 是 .mp4 格式（不是 HLS，老合辑的问题）
          // 3. 缺少 is_hls 标记且 play_url 不是 .m3u8 格式
          // 4. storage_type 是 telegram（未上传）
          const isNullOrEmpty =
            !itemPlayUrl || itemPlayUrl === 'null' || itemPlayUrl.includes('undefined')
          const isMp4Format = itemPlayUrl && itemPlayUrl.endsWith('.mp4')
          const isNotHls =
            itemPlayUrl && !itemPlayUrl.endsWith('.m3u8') && !itemPlayUrl.includes('/index.m3u8')
          const missingIsHlsFlag = item.type === 'video' && !item.is_hls && isNotHls
          const needsUpload =
            isNullOrEmpty ||
            isMp4Format ||
            missingIsHlsFlag ||
            item.storage_type === 'telegram' ||
            (itemPlayUrl && !itemPlayUrl.startsWith('http') && !itemPlayUrl.startsWith('/'))

          if (needsUpload && item.file_id) {
            // 🎯 只有当 cover_url 不是 HTTP 链接时，才视其为 thumbnail_file_id
            const thumbId = itemCoverUrl && !itemCoverUrl.startsWith('http') ? itemCoverUrl : null

            tasks.push({
              videoId: v.id,
              fileId: item.file_id,
              thumbnailFileId: thumbId,
              chatId: v.tg_user_id,
              contentType: v.content_type
            })
          }
        }
      }

      if (tasks.length > 0) {
        console.log(`📝 [${v.id}] (${v.content_type}) 收集到 ${tasks.length} 个待上传项`)
        allTasks.push(...tasks)
      }
    }

    if (allTasks.length === 0) {
      console.log('✨ 没有需要处理的任务。')
      return
    }

    console.log(`\n🚀 总共收集到 ${allTasks.length} 个文件任务，开始并发提交...\n`)

    // 🎯 并发控制：同时最多处理 N 个任务，避免冲击 Worker
    const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '5') // 默认并发 5 个
    const BATCH_DELAY = parseInt(process.env.BATCH_DELAY || '200') // 批次间延迟 200ms

    let successCount = 0
    let failCount = 0
    let processedCount = 0

    // 并发处理函数
    async function processTask(task) {
      try {
        const payload = {
          video_id: task.videoId,
          file_id: task.fileId,
          chat_id: task.chatId,
          bot_token: BOT_TOKEN,
          message_id: 0,
          thumbnail_file_id: task.thumbnailFileId
        }

        await axios.post(WORKER_URL, payload, { timeout: 10000 })
        successCount++
        processedCount++
        const progress = ((processedCount / allTasks.length) * 100).toFixed(1)
        console.log(
          `   ✅ [${processedCount}/${allTasks.length}] (${progress}%) [${task.fileId.substring(0, 10)}...] -> Worker 已接收`
        )
        return { success: true, task }
      } catch (err) {
        failCount++
        processedCount++
        const progress = ((processedCount / allTasks.length) * 100).toFixed(1)
        console.error(
          `   ❌ [${processedCount}/${allTasks.length}] (${progress}%) [${task.fileId.substring(0, 10)}...] 发送失败:`,
          err.message
        )
        return { success: false, task, error: err.message }
      }
    }

    // 分批并发处理
    for (let i = 0; i < allTasks.length; i += MAX_CONCURRENT) {
      const batch = allTasks.slice(i, i + MAX_CONCURRENT)
      await Promise.all(batch.map(processTask))

      // 批次间短暂延迟，避免过载
      if (i + MAX_CONCURRENT < allTasks.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY))
      }
    }

    console.log(`\n✅ 所有补救指令已发出！`)
    console.log(
      `📊 统计: 成功 ${successCount} 个，失败 ${failCount} 个，总计 ${allTasks.length} 个`
    )
    console.log('请观察 Worker 服务器的 PM2 日志确认处理进度。')

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`⏱️  本次扫描耗时: ${duration} 秒`)
  } catch (error) {
    console.error('❌ 扫描过程发生错误:', error)
  } finally {
    isRunning = false
  }
}

// 🎯 执行一次扫描
async function runScan() {
  if (isShuttingDown) {
    console.log('🛑 正在关闭，停止扫描')
    return
  }

  const now = new Date().toLocaleString('zh-CN')
  console.log(`\n${'='.repeat(60)}`)
  console.log(`🕐 [${now}] 开始执行扫描任务...`)
  console.log(`${'='.repeat(60)}\n`)

  await rescueAll()

  if (!isShuttingDown) {
    const nextScanTime = new Date(Date.now() + SCAN_INTERVAL * 60 * 1000).toLocaleString('zh-CN')
    console.log(`\n⏰ 下次扫描时间: ${nextScanTime} (${SCAN_INTERVAL} 分钟后)`)
    console.log(`${'='.repeat(60)}\n`)
  }
}

// 🎯 主循环
async function startService() {
  console.log(`\n${'='.repeat(60)}`)
  console.log('🚀 补救服务已启动')
  console.log(`📋 配置信息:`)
  console.log(`   - 扫描间隔: ${SCAN_INTERVAL} 分钟`)
  console.log(`   - Worker 地址: ${WORKER_URL}`)
  console.log(`   - 并发数: ${process.env.MAX_CONCURRENT || '5'}`)
  console.log(`   - 批次延迟: ${process.env.BATCH_DELAY || '200'}ms`)
  console.log(`${'='.repeat(60)}\n`)

  // 立即执行一次
  await runScan()

  // 设置定时器
  const intervalId = setInterval(
    async () => {
      if (isShuttingDown) {
        clearInterval(intervalId)
        return
      }
      await runScan()
    },
    SCAN_INTERVAL * 60 * 1000
  )

  // 🎯 优雅退出处理
  process.on('SIGTERM', () => {
    console.log('\n🛑 收到 SIGTERM 信号，准备退出...')
    isShuttingDown = true
    clearInterval(intervalId)
    if (!isRunning) {
      console.log('✅ 服务已安全退出')
      process.exit(0)
    } else {
      console.log('⏳ 等待当前扫描完成...')
    }
  })

  process.on('SIGINT', () => {
    console.log('\n🛑 收到 SIGINT 信号 (Ctrl+C)，准备退出...')
    isShuttingDown = true
    clearInterval(intervalId)
    if (!isRunning) {
      console.log('✅ 服务已安全退出')
      process.exit(0)
    } else {
      console.log('⏳ 等待当前扫描完成...')
    }
  })

  // 等待当前任务完成后退出
  const checkExit = setInterval(() => {
    if (isShuttingDown && !isRunning) {
      clearInterval(checkExit)
      console.log('✅ 服务已安全退出')
      process.exit(0)
    }
  }, 1000)
}

// 🎯 启动服务
startService().catch((error) => {
  console.error('❌ 服务启动失败:', error)
  process.exit(1)
})
