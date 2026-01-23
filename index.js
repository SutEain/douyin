const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '.env') })
/* eslint-disable */
/* eslint-env node */
const express = require('express')
const axios = require('axios')
const fs = require('fs')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { createClient } = require('@supabase/supabase-js')
const { execSync } = require('child_process')

// 🎯 尝试导入 NodeHttpHandler（可选，如果未安装则使用默认配置）
let NodeHttpHandler = null
try {
  NodeHttpHandler = require('@aws-sdk/node-http-handler').NodeHttpHandler
} catch (e) {
  console.warn('⚠️  @aws-sdk/node-http-handler 未安装，将使用默认超时配置')
  console.warn('   如需自定义超时，请运行: npm install @aws-sdk/node-http-handler')
}

const app = express()
app.use(express.json())

const PORT = 3000
const LOCAL_BOT_API = process.env.LOCAL_BOT_API || 'http://localhost:8081'
const R2_BUCKET = process.env.R2_BUCKET
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL

// 🎯 Axios 请求超时配置
// 🎯 本地 Telegram Bot API 可能需要更长时间处理大文件，增加超时时间
const AXIOS_TIMEOUT = parseInt(process.env.AXIOS_TIMEOUT || '120000') // 默认 120 秒（本地服务处理大文件需要更长时间）
const AXIOS_LONG_TIMEOUT = parseInt(process.env.AXIOS_LONG_TIMEOUT || '60000') // 默认 60 秒（用于回调等）
const TELEGRAM_API_RETRY_COUNT = parseInt(process.env.TELEGRAM_API_RETRY_COUNT || '2') // 默认重试 2 次（本地服务重试次数减少）
const TELEGRAM_API_RETRY_DELAY = parseInt(process.env.TELEGRAM_API_RETRY_DELAY || '3000') // 默认重试延迟 3 秒

// 🎯 Telegram API 请求重试辅助函数（针对本地服务优化）
async function telegramApiRequest(url, retries = TELEGRAM_API_RETRY_COUNT) {
  let lastError = null
  for (let i = 0; i < retries; i++) {
    try {
      const startTime = Date.now()
      const response = await axios.get(url, {
        timeout: AXIOS_TIMEOUT,
        // 🎯 本地请求优化：禁用重定向，减少延迟
        maxRedirects: 0
      })
      const duration = Date.now() - startTime
      if (duration > 5000) {
        console.warn(`⚠️  Telegram API 响应较慢: ${duration}ms`)
      }
      return response
    } catch (error) {
      lastError = error
      const isTimeout =
        error.message && (error.message.includes('timeout') || error.message.includes('ETIMEDOUT'))
      const isNetworkError =
        error.message &&
        (error.message.includes('socket hang up') || error.message.includes('ECONNRESET'))

      if (isTimeout || isNetworkError) {
        if (i < retries - 1) {
          const delay = TELEGRAM_API_RETRY_DELAY * (i + 1) // 递增延迟
          console.warn(`⚠️  本地 Telegram Bot API 请求失败 (${i + 1}/${retries}): ${error.message}`)
          console.warn(`   可能原因: 本地服务过载或处理大文件耗时较长，${delay}ms 后重试...`)
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        } else {
          console.error(`❌ 本地 Telegram Bot API 请求失败，已重试 ${retries} 次`)
          console.error(`   建议检查: 1) 本地 Telegram Bot API 服务是否正常运行`)
          console.error(`             2) 服务是否过载（检查 CPU/内存使用）`)
          console.error(`             3) 文件是否过大导致处理时间过长`)
        }
      }
      // 如果不是超时或网络错误，或者已经重试完，直接抛出错误
      throw error
    }
  }
  throw lastError
}

// 🎯 并发控制：限制同时处理的任务数（避免过载）
const MAX_CONCURRENT_TASKS = parseInt(process.env.MAX_CONCURRENT_TASKS || '3')
let activeTasks = 0
const taskQueue = []

// 🎯 去重：记录正在处理或队列中的任务（使用 video_id + file_id 作为唯一标识）
const processingTasks = new Set() // 正在处理的任务
const queuedTasks = new Set() // 队列中的任务

// 🎯 生成任务唯一标识
function getTaskKey(videoId, fileId) {
  return `${videoId}:${fileId}`
}

// 🎯 处理队列中的任务
async function processNextTask() {
  if (activeTasks >= MAX_CONCURRENT_TASKS) {
    // 🎯 记录为什么没有处理新任务
    if (taskQueue.length > 0) {
      console.log(
        `[Queue] ⏸️  已达到最大并发数 (${activeTasks}/${MAX_CONCURRENT_TASKS})，等待中... (队列: ${taskQueue.length})`
      )
    }
    return
  }
  if (taskQueue.length === 0) {
    return
  }

  // 🎯 按文件大小排序，小的优先处理
  // 🎯 排序规则：已知大小的文件按大小排序（小的在前），未知大小的文件（fileSize = 0）排到最后
  if (taskQueue.length > 1) {
    const beforeSort = taskQueue.map((t) => ({
      id: t.videoId?.substring(0, 8),
      size: t.fileSize || 0
    }))
    taskQueue.sort((a, b) => {
      const sizeA = a.fileSize || 0
      const sizeB = b.fileSize || 0
      // 🎯 如果两个都是未知大小（0），保持原顺序
      if (sizeA === 0 && sizeB === 0) return 0
      // 🎯 如果 A 是未知大小，排到后面
      if (sizeA === 0) return 1
      // 🎯 如果 B 是未知大小，排到后面
      if (sizeB === 0) return -1
      // 🎯 两个都是已知大小，按大小排序（小的在前）
      return sizeA - sizeB
    })
    const afterSort = taskQueue.map((t) => ({
      id: t.videoId?.substring(0, 8),
      size: t.fileSize || 0
    }))
    // 🎯 只在队列前5个有变化时输出日志，避免日志过多
    const changed = beforeSort.slice(0, 5).some((item, idx) => item.id !== afterSort[idx]?.id)
    if (changed) {
      console.log(
        `[Queue] 🔄 队列已重新排序 (前5个): ${afterSort
          .slice(0, 5)
          .map((t) => `${t.id}(${(t.size / 1024 / 1024).toFixed(1)}MB)`)
          .join(', ')}`
      )
    }
  }
  const queueLengthBeforeShift = taskQueue.length // 🎯 记录取出前的队列长度（包含当前任务）
  const task = taskQueue.shift()
  if (!task) return

  const taskKey = getTaskKey(task.videoId, task.fileId)

  // 从队列记录中移除
  queuedTasks.delete(taskKey)
  // 添加到处理中记录
  processingTasks.add(taskKey)

  activeTasks++
  const fileSizeMB = task.fileSize ? (task.fileSize / 1024 / 1024).toFixed(2) : '未知'
  const taskStartTime = Date.now() // 🎯 记录任务开始时间
  // 🎯 显示取出前的队列长度（更直观：表示队列中原本有多少任务，现在开始处理其中一个）
  console.log(
    `[Queue] 开始处理任务 (活跃: ${activeTasks}/${MAX_CONCURRENT_TASKS}, 队列: ${queueLengthBeforeShift}, 大小: ${fileSizeMB}MB) [${taskKey}]`
  )

  // 🎯 添加任务超时监控（30分钟超时）
  const TASK_TIMEOUT = 30 * 60 * 1000 // 30分钟
  const timeoutId = setTimeout(() => {
    const duration = ((Date.now() - taskStartTime) / 1000 / 60).toFixed(1)
    console.error(`[Queue] ⚠️ 任务处理超时警告 [${taskKey}]: 已处理 ${duration} 分钟，可能卡住`)
    console.error(
      `[Queue] ⚠️ 当前活跃任务: ${activeTasks}/${MAX_CONCURRENT_TASKS}, 队列剩余: ${taskQueue.length}`
    )
  }, TASK_TIMEOUT)

  try {
    await task.handler()
  } catch (error) {
    console.error(`[Queue] 任务处理失败 [${taskKey}]:`, error.message)
  } finally {
    clearTimeout(timeoutId) // 🎯 清除超时监控
    const taskDuration = ((Date.now() - taskStartTime) / 1000).toFixed(1)
    // 从处理中记录移除
    processingTasks.delete(taskKey)
    activeTasks--
    const remainingQueue = taskQueue.length
    console.log(
      `[Queue] ✅ 任务完成 (活跃: ${activeTasks}/${MAX_CONCURRENT_TASKS}, 队列剩余: ${remainingQueue}, 耗时: ${taskDuration}秒) [${taskKey}]`
    )
    // 继续处理下一个任务
    if (remainingQueue > 0 && activeTasks < MAX_CONCURRENT_TASKS) {
      console.log(
        `[Queue] 🔄 准备处理下一个任务 (队列剩余: ${remainingQueue}, 可用槽位: ${MAX_CONCURRENT_TASKS - activeTasks})`
      )
      setImmediate(processNextTask)
    } else if (remainingQueue > 0) {
      console.log(`[Queue] ⏸️  队列有任务但已达到最大并发数，等待当前任务完成...`)
    }
  }
}

// 🎯 配置 R2 上传超时（大文件需要更长的超时时间）
const R2_UPLOAD_TIMEOUT = parseInt(process.env.R2_UPLOAD_TIMEOUT || '600000') // 默认 10 分钟（600000ms）

// 🎯 配置 R2 客户端
const r2Config = {
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
}

// 🎯 如果 NodeHttpHandler 可用，则配置自定义超时
if (NodeHttpHandler) {
  r2Config.requestHandler = new NodeHttpHandler({
    requestTimeout: R2_UPLOAD_TIMEOUT,
    connectionTimeout: 30000 // 连接超时 30 秒
  })
  console.log(
    `✅ R2 上传超时已配置: ${R2_UPLOAD_TIMEOUT / 1000} 秒 (${R2_UPLOAD_TIMEOUT / 60000} 分钟)`
  )
} else {
  console.warn(`⚠️  使用默认超时配置（建议安装 @aws-sdk/node-http-handler 以支持大文件上传）`)
}

const r2 = new S3Client(r2Config)

// 🎯 使用 Service Key 确保拥有最高修改权限，绕过 RLS
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

app.post('/process', async (req, res) => {
  let { file_id, video_id, bot_token, chat_id, message_id, thumbnail_file_id, file_size } = req.body

  // 🎯 记录接收到的请求
  console.log(
    `[Receive] 收到任务请求: video_id=${video_id}, file_id=${file_id?.substring(0, 20)}...`
  )

  if (!file_id || !video_id) {
    console.error(`[Receive] ❌ 参数缺失: video_id=${video_id}, file_id=${file_id}`)
    return res.status(400).json({ error: 'Missing params' })
  }

  // 🎯 清理可能的空白字符
  video_id = String(video_id).trim()
  file_id = String(file_id).trim()
  if (bot_token) bot_token = bot_token.trim()
  if (thumbnail_file_id) thumbnail_file_id = String(thumbnail_file_id).trim()

  // 🎯 去重检查：如果任务已在处理中或队列中，拒绝重复提交
  const taskKey = getTaskKey(video_id, file_id)
  if (processingTasks.has(taskKey)) {
    console.log(`[Receive] ⚠️ 任务已在处理中，跳过重复提交 [${taskKey}]`)
    return res.json({ status: 'duplicate', video_id, message: '任务已在处理中' })
  }
  if (queuedTasks.has(taskKey)) {
    console.log(`[Receive] ⚠️ 任务已在队列中，跳过重复提交 [${taskKey}]`)
    return res.json({ status: 'duplicate', video_id, message: '任务已在队列中' })
  }

  // 🎯 立即返回响应，避免客户端等待
  res.json({ status: 'processing', video_id, queued: activeTasks >= MAX_CONCURRENT_TASKS })

  // 🎯 获取文件大小信息（用于优先级排序）
  // 🎯 优先使用传入的文件大小（从数据库获取），如果没有则从 Telegram API 获取
  let fileSize = file_size ? parseInt(file_size) : 0
  let cachedFilePath = null

  if (fileSize > 0) {
    console.log(
      `[Receive] [${taskKey}] ✅ 使用数据库中的文件大小: ${(fileSize / 1024 / 1024).toFixed(2)}MB`
    )
  } else {
    // 🎯 如果没有传入文件大小，尝试从 Telegram API 获取
    try {
      console.log(`[Receive] [${taskKey}] 正在从 Telegram API 获取文件大小信息...`)
      const fileInfoRes = await axios.get(
        `${LOCAL_BOT_API}/bot${bot_token}/getFile?file_id=${file_id}`,
        {
          timeout: 10000 // 🎯 添加超时，避免长时间等待
        }
      )
      fileSize = fileInfoRes.data.result.file_size || 0
      cachedFilePath = fileInfoRes.data.result.file_path // 🎯 缓存文件路径，避免重复调用
      console.log(
        `[Receive] [${taskKey}] 文件大小获取成功: ${fileSize ? (fileSize / 1024 / 1024).toFixed(2) + 'MB' : '未知'}`
      )
    } catch (e) {
      console.warn(`[Receive] [${taskKey}] ⚠️ 无法获取文件大小，将使用默认优先级:`, e.message)
    }
  }

  // 🎯 将任务加入队列
  const taskHandler = async () => {
    console.log(
      `\n🚀 [${video_id}] 任务启动... (视频UUID: ${video_id}, File: ${file_id}, Thumb: ${thumbnail_file_id || 'none'})`
    )

    try {
      // 🎯 优先使用缓存的文件路径，如果文件已存在则直接使用
      let localFilePath = cachedFilePath
      if (!localFilePath || !fs.existsSync(localFilePath)) {
        const getFileStartTime = Date.now()
        console.log(`[${video_id}] 正在从 Telegram API 获取文件路径...`)
        try {
          const fileRes = await telegramApiRequest(
            `${LOCAL_BOT_API}/bot${bot_token}/getFile?file_id=${file_id}`
          )
          localFilePath = fileRes.data.result.file_path
          const getFileDuration = ((Date.now() - getFileStartTime) / 1000).toFixed(1)
          console.log(
            `[${video_id}] ✅ 文件路径获取成功 (耗时: ${getFileDuration}秒): ${localFilePath}`
          )
        } catch (error) {
          const getFileDuration = ((Date.now() - getFileStartTime) / 1000).toFixed(1)
          console.error(
            `[${video_id}] ❌ 文件路径获取失败 (耗时: ${getFileDuration}秒):`,
            error.message
          )
          throw error // 🎯 重新抛出错误，让上层处理
        }
      } else {
        console.log(`[${video_id}] ✅ 使用缓存的文件路径: ${localFilePath}`)
      }

      if (!fs.existsSync(localFilePath)) throw new Error(`文件未找到: ${localFilePath}`)

      const ext = localFilePath.split('.').pop().toLowerCase()
      const isImage = ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext)
      // const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)

      let playUrl = ''
      let coverUrl = ''
      let isHls = false

      if (isImage) {
        console.log(`[${video_id}] 识别为图片项，直接上传... (视频UUID: ${video_id})`)
        const r2Key = `videos/${video_id}/${file_id}.${ext}`
        const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`
        await r2.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: fs.createReadStream(localFilePath),
            ContentType: contentType
          })
        )
        playUrl = `/${r2Key}`
      } else {
        // 🎬 视频转 HLS
        console.log(`[${video_id}] 正在执行 HLS 切片转换... (视频UUID: ${video_id})`)
        const hlsOutputDir = `${localFilePath}_hls`
        if (!fs.existsSync(hlsOutputDir)) fs.mkdirSync(hlsOutputDir)

        try {
          // 1. 自动识别并修复苹果 hev1 标签
          let tagArgs = ''
          try {
            const probeJson = execSync(
              `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,codec_tag_string -of json "${localFilePath}"`
            ).toString()
            const vStream = JSON.parse(probeJson).streams[0]
            if (vStream && vStream.codec_name === 'hevc' && vStream.codec_tag_string === 'hev1') {
              console.log(`[${video_id}] 识别到苹果 hev1 标签，应用修复参数...`)
              tagArgs = '-tag:v hvc1'
            }
          } catch (e) {
            // ignore probe error
          }

          // 2. 执行切片 (使用 -c copy 极速转换)
          execSync(
            `ffmpeg -y -i "${localFilePath}" -c copy ${tagArgs} -hls_time 5 -hls_list_size 0 -f hls "${hlsOutputDir}/index.m3u8"`,
            {
              stdio: 'ignore'
            }
          )

          // 3. 上传所有 HLS 文件 (并发上传优化)
          const files = fs.readdirSync(hlsOutputDir)
          console.log(
            `[${video_id}] 正在并发上传 HLS 切片 (${files.length} 个文件)... (视频UUID: ${video_id})`
          )

          const UPLOAD_THREADS = 10
          let uploadedCount = 0
          let lastLoggedCount = 0 // 🎯 记录上次打印的进度，避免重复打印
          for (let i = 0; i < files.length; i += UPLOAD_THREADS) {
            const chunk = files.slice(i, i + UPLOAD_THREADS)
            await Promise.all(
              chunk.map(async (file) => {
                const filePath = path.join(hlsOutputDir, file)
                const fileContent = fs.readFileSync(filePath)
                const r2Key = `videos/${video_id}/${file}`

                await r2.send(
                  new PutObjectCommand({
                    Bucket: R2_BUCKET,
                    Key: r2Key,
                    Body: fileContent,
                    ContentType: file.endsWith('.m3u8')
                      ? 'application/vnd.apple.mpegurl'
                      : 'video/mp2t',
                    CacheControl: 'public, max-age=31536000'
                  })
                )
                uploadedCount++
              })
            )
            // 🎯 每 50 个文件或完成时打一次进度日志，避免重复打印
            if (uploadedCount - lastLoggedCount >= 50 || uploadedCount === files.length) {
              const percent = ((uploadedCount / files.length) * 100).toFixed(1)
              console.log(
                `[${video_id}] ☁️ 上传进度: ${percent}% (${uploadedCount}/${files.length})`
              )
              lastLoggedCount = uploadedCount
            }
          }

          playUrl = `/videos/${video_id}/index.m3u8`
          isHls = true
          console.log(`[${video_id}] HLS 上传完成: ${playUrl} (视频UUID: ${video_id})`)

          // 🎯 清理 HLS 临时文件（添加文件存在性检查，避免并发删除错误）
          files.forEach((f) => {
            const filePath = path.join(hlsOutputDir, f)
            if (fs.existsSync(filePath)) {
              try {
                fs.unlinkSync(filePath)
              } catch (e) {
                // 忽略删除错误（可能已被其他进程删除）
                if (!e.message.includes('ENOENT')) {
                  console.warn(`[${video_id}] 删除文件失败: ${filePath}`, e.message)
                }
              }
            }
          })
          if (fs.existsSync(hlsOutputDir)) {
            try {
              fs.rmdirSync(hlsOutputDir)
            } catch (e) {
              // 忽略删除错误（目录可能不为空或已被删除）
              if (!e.message.includes('ENOENT')) {
                console.warn(`[${video_id}] 删除目录失败: ${hlsOutputDir}`, e.message)
              }
            }
          }
        } catch (e) {
          console.error(`[${video_id}] HLS 转换失败，回退到原始 MP4 上传:`, e.message)
          const r2Key = `videos/${video_id}/${file_id}.${ext}`
          await r2.send(
            new PutObjectCommand({
              Bucket: R2_BUCKET,
              Key: r2Key,
              Body: fs.createReadStream(localFilePath),
              ContentType: 'video/mp4'
            })
          )
          playUrl = `/${r2Key}`
        }
      }

      // 🎯 处理封面图
      if (thumbnail_file_id) {
        console.log(`[${video_id}] 正在从 Telegram 下载缩略图: ${thumbnail_file_id}`)
        try {
          const thumbRes = await telegramApiRequest(
            `${LOCAL_BOT_API}/bot${bot_token}/getFile?file_id=${thumbnail_file_id}`
          )
          const localThumbPath = thumbRes.data.result.file_path
          if (fs.existsSync(localThumbPath)) {
            const thumbExt = localThumbPath.split('.').pop().toLowerCase()
            const thumbR2Key = `videos/${video_id}/thumb_${thumbnail_file_id}.${thumbExt}`
            await r2.send(
              new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: thumbR2Key,
                Body: fs.createReadStream(localThumbPath),
                ContentType: `image/${thumbExt === 'jpg' ? 'jpeg' : thumbExt}`
              })
            )
            coverUrl = `/${thumbR2Key}`
            fs.unlinkSync(localThumbPath)
          }
        } catch (e) {
          console.warn(`[${video_id}] Telegram 缩略图下载失败，将尝试从视频截取:`, e.message)
        }
      }

      // 🎯 兜底方案：如果还没有封面且是视频，则从视频中截取第一帧
      if (!coverUrl && !isImage && fs.existsSync(localFilePath)) {
        console.log(`[${video_id}] 正在从视频截取封面...`)
        try {
          const screenshotPath = `${localFilePath}.thumb.jpg`
          // 截取第 1 秒的一帧
          execSync(`ffmpeg -y -i "${localFilePath}" -ss 00:00:01 -vframes 1 "${screenshotPath}"`, {
            stdio: 'ignore'
          })
          if (fs.existsSync(screenshotPath)) {
            const thumbR2Key = `videos/${video_id}/cover_auto.jpg`
            await r2.send(
              new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: thumbR2Key,
                Body: fs.createReadStream(screenshotPath),
                ContentType: 'image/jpeg'
              })
            )
            coverUrl = `/${thumbR2Key}`
            fs.unlinkSync(screenshotPath)
            console.log(`[${video_id}] 视频截图封面已生成: ${coverUrl}`)
          }
        } catch (e) {
          console.warn(`[${video_id}] 视频截图失败:`, e.message)
        }
      } else if (isImage && !coverUrl) {
        // 📸 如果是单图且没封面，封面就是图片本身
        coverUrl = playUrl
      }

      // 🎯 更新数据库
      const { data: vInfo } = await supabase
        .from('videos')
        .select('status, review_status, content_type, media_list, images, is_auto_sync')
        .eq('id', video_id)
        .single()

      const updatePayload = {
        play_url: playUrl,
        storage_type: 'r2',
        is_optimized: true,
        is_hls: isHls
      }
      if (coverUrl) {
        updatePayload.cover_url = coverUrl
      }

      // 🎯 核心修复：更新 media_list 里的 play_url 供 APP 读取
      if (vInfo && vInfo.media_list) {
        let list = Array.isArray(vInfo.media_list)
          ? vInfo.media_list
          : JSON.parse(vInfo.media_list || '[]')
        let changed = false
        list = list.map((item) => {
          if (item.file_id === file_id) {
            item.play_url = playUrl
            item.is_hls = isHls
            if (coverUrl) item.cover_url = coverUrl
            changed = true
          }
          return item
        })
        if (changed) {
          updatePayload.media_list = list
        }
      } else if (vInfo && (vInfo.content_type === 'image' || vInfo.content_type === 'video')) {
        // 🎯 对于单图/单视频，如果没有 media_list，创建一个（确保前端能统一处理）
        // 这主要针对补救场景：老数据可能没有 media_list
        if (vInfo.tg_file_id === file_id) {
          const mediaItem = {
            type: isImage ? 'image' : 'video',
            file_id: file_id,
            play_url: playUrl,
            is_hls: isHls,
            cover_url: coverUrl || playUrl,
            order: 0
          }
          updatePayload.media_list = JSON.stringify([mediaItem])
          updatePayload.images = JSON.stringify([mediaItem]) // 兼容旧字段
          console.log(`[${video_id}] 🎯 为单图/单视频创建 media_list`)
        }
      }

      // 🎯 兼容性修复：同时也更新 images 字段（部分老视图还在使用它）
      if (vInfo && vInfo.images && !updatePayload.images) {
        let imgList = Array.isArray(vInfo.images) ? vInfo.images : JSON.parse(vInfo.images || '[]')
        let changed = false
        imgList = imgList.map((item) => {
          if (item.file_id === file_id) {
            item.play_url = playUrl
            item.is_hls = isHls
            if (coverUrl) item.cover_url = coverUrl
            changed = true
          }
          return item
        })
        if (changed) {
          updatePayload.images = imgList
        }
      }

      // 🎯 如果是合集/相册，Worker 只负责上传文件，不负责最终状态（由 Edge Function 回调处理）
      // 只有单视频模式下，Worker 才直接负责将 processing 转为 published/ready
      // 🎯 自动同步的视频：处理完成后自动转换为 published
      if (vInfo && vInfo.content_type !== 'collection' && vInfo.content_type !== 'album') {
        if (vInfo.status === 'processing') {
          const isApproved =
            vInfo.review_status === 'approved' || vInfo.review_status === 'auto_approved'
          // 🎯 自动同步 + 免审用户：直接转换为 published
          // 🎯 非自动同步或非免审用户：根据审核状态转换
          if (vInfo.is_auto_sync && isApproved) {
            updatePayload.status = 'published'
            updatePayload.published_at = new Date().toISOString()
            console.log(`[${video_id}] 自动同步视频处理完成，状态转换: processing -> published`)
          } else {
            updatePayload.status = isApproved ? 'published' : 'ready'
            if (isApproved && !vInfo.published_at) {
              updatePayload.published_at = new Date().toISOString()
            }
            console.log(`[${video_id}] 单视频状态转换: processing -> ${updatePayload.status}`)
          }
        }
      }

      const { data: updateRes, error: dbError } = await supabase
        .from('videos')
        .update(updatePayload)
        .eq('id', video_id)
        .select()

      if (dbError) {
        console.error(`[${video_id}] ❌ 数据库更新失败:`, dbError.message)
      } else {
        console.log(`[${video_id}] ✅ 数据库更新成功 (视频UUID: ${video_id})`)
      }

      // 清理临时文件
      if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath)
      const optPath = `${localFilePath}.opt.mp4`
      if (fs.existsSync(optPath)) fs.unlinkSync(optPath)

      // 通知回调 (Edge Function 会处理相册 JSON 的补全和状态转换)
      await axios
        .post(
          `${process.env.SUPABASE_URL}/functions/v1/bot-video-upload`,
          {
            type: 'worker_complete',
            chatId: chat_id,
            messageId: message_id,
            videoId: video_id,
            file_id: file_id,
            play_url: playUrl,
            cover_url: coverUrl, // 🎯 传递缩略图 URL
            is_hls: isHls, // 🎯 告知回调是 HLS 格式
            success: true
          },
          {
            headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
            timeout: AXIOS_LONG_TIMEOUT // 🎯 添加超时配置
          }
        )
        .catch((e) => console.error(`[${video_id}] 回调失败:`, e.message))

      console.log(`[${video_id}] ✅ 处理成功！(视频UUID: ${video_id})`)
    } catch (error) {
      // 🎯 详细错误日志，帮助定位问题
      console.error(`[${video_id}] 💥 异常:`, error.message)
      console.error(`[${video_id}] 🔴 错误类型:`, error.constructor.name)
      console.error(`[${video_id}] 🔴 错误堆栈:`, error.stack)
      if (error.response) {
        console.error(`[${video_id}] 🔴 HTTP 状态码:`, error.response.status)
        console.error(`[${video_id}] 🔴 响应数据:`, JSON.stringify(error.response.data))
      }
      if (error.request) {
        console.error(`[${video_id}] 🔴 请求信息:`, {
          method: error.config?.method,
          url: error.config?.url,
          timeout: error.config?.timeout
        })
      }

      // 🎯 判断错误发生的具体位置
      let errorLocation = '未知位置'
      if (error.stack) {
        if (error.stack.includes('r2.send') || error.stack.includes('PutObjectCommand')) {
          errorLocation = 'R2上传'
        } else if (
          error.stack.includes('axios.get') &&
          (error.stack.includes('getFile') || error.stack.includes('LOCAL_BOT_API'))
        ) {
          errorLocation = 'Telegram API获取文件'
        } else if (error.stack.includes('axios.post') && error.stack.includes('bot-video-upload')) {
          errorLocation = 'Edge Function回调'
        } else if (
          error.stack.includes('fs.readFileSync') ||
          error.stack.includes('fs.createReadStream')
        ) {
          errorLocation = '文件读取'
        } else if (error.config && error.config.url) {
          // 🎯 通过请求 URL 判断错误位置
          const url = error.config.url
          if (url.includes('getFile')) {
            errorLocation = 'Telegram API获取文件'
          } else if (url.includes('bot-video-upload')) {
            errorLocation = 'Edge Function回调'
          } else if (url.includes('r2') || url.includes('cloudflare')) {
            errorLocation = 'R2上传'
          }
        }
      }
      console.error(`[${video_id}] 🔴 错误发生位置: ${errorLocation}`)

      // 🎯 过滤掉技术性错误信息，避免向用户展示 "socket hang up" 等
      let userFriendlyError = error.message
      if (error.message && error.message.includes('socket hang up')) {
        userFriendlyError = `网络连接中断 (${errorLocation})，请稍后重试`
        console.error(`[${video_id}] ⚠️ socket hang up 错误发生在: ${errorLocation}`)
      } else if (error.message && error.message.includes('ECONNRESET')) {
        userFriendlyError = `连接被重置 (${errorLocation})，请稍后重试`
      } else if (error.message && error.message.includes('ETIMEDOUT')) {
        userFriendlyError = `请求超时 (${errorLocation})，请稍后重试`
      } else if (error.message && error.message.includes('ENOTFOUND')) {
        userFriendlyError = `网络错误 (${errorLocation})，请稍后重试`
      }

      await axios
        .post(
          `${process.env.SUPABASE_URL}/functions/v1/bot-video-upload`,
          {
            type: 'worker_complete',
            chatId: chat_id,
            messageId: message_id,
            videoId: video_id,
            success: false,
            error: userFriendlyError
          },
          {
            headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
            timeout: AXIOS_LONG_TIMEOUT // 🎯 添加超时配置
          }
        )
        .catch(() => {})
    }
  }

  // 🎯 将任务加入队列（包含文件大小用于优先级排序）
  queuedTasks.add(taskKey) // 记录到队列中
  taskQueue.push({
    handler: taskHandler,
    videoId: video_id,
    fileId: file_id,
    fileSize: fileSize // 🎯 文件大小，用于优先级排序（小的优先）
  })
  // 🎯 新任务加入时立即重新排序，确保小文件优先
  // 🎯 排序规则：已知大小的文件按大小排序（小的在前），未知大小的文件（fileSize = 0）排到最后
  taskQueue.sort((a, b) => {
    const sizeA = a.fileSize || 0
    const sizeB = b.fileSize || 0
    // 🎯 如果两个都是未知大小（0），保持原顺序
    if (sizeA === 0 && sizeB === 0) return 0
    // 🎯 如果 A 是未知大小，排到后面
    if (sizeA === 0) return 1
    // 🎯 如果 B 是未知大小，排到后面
    if (sizeB === 0) return -1
    // 🎯 两个都是已知大小，按大小排序（小的在前）
    return sizeA - sizeB
  })

  // 🎯 打印任务入队日志，显示真实队列长度
  const fileSizeMB = fileSize ? (fileSize / 1024 / 1024).toFixed(2) : '未知'
  console.log(
    `[Receive] ✅ [${taskKey}] 任务已成功加入队列 (活跃: ${activeTasks}/${MAX_CONCURRENT_TASKS}, 队列: ${taskQueue.length}, 大小: ${fileSizeMB}MB)`
  )

  processNextTask()
})

app.listen(PORT, () => {
  console.log(`Worker running on port ${PORT}`)
  if (NodeHttpHandler) {
    console.log(`📋 R2 上传配置:`)
    console.log(`   - 上传超时: ${R2_UPLOAD_TIMEOUT / 1000} 秒 (${R2_UPLOAD_TIMEOUT / 60000} 分钟)`)
    console.log(`   - 连接超时: 30 秒`)
    console.log(`   - 可通过环境变量 R2_UPLOAD_TIMEOUT 自定义（单位：毫秒）`)
  }
})
