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

const app = express()
app.use(express.json())

const PORT = 3000
const LOCAL_BOT_API = process.env.LOCAL_BOT_API || 'http://localhost:8081'
const R2_BUCKET = process.env.R2_BUCKET
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL

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
  if (activeTasks >= MAX_CONCURRENT_TASKS || taskQueue.length === 0) {
    return
  }

  const task = taskQueue.shift()
  if (!task) return

  const taskKey = getTaskKey(task.videoId, task.fileId)

  // 从队列记录中移除
  queuedTasks.delete(taskKey)
  // 添加到处理中记录
  processingTasks.add(taskKey)

  activeTasks++
  console.log(
    `[Queue] 开始处理任务 (活跃: ${activeTasks}/${MAX_CONCURRENT_TASKS}, 队列: ${taskQueue.length}) [${taskKey}]`
  )

  try {
    await task.handler()
  } catch (error) {
    console.error(`[Queue] 任务处理失败 [${taskKey}]:`, error.message)
  } finally {
    // 从处理中记录移除
    processingTasks.delete(taskKey)
    activeTasks--
    console.log(
      `[Queue] 任务完成 (活跃: ${activeTasks}/${MAX_CONCURRENT_TASKS}, 队列: ${taskQueue.length}) [${taskKey}]`
    )
    // 继续处理下一个任务
    setImmediate(processNextTask)
  }
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
})

// 🎯 使用 Service Key 确保拥有最高修改权限，绕过 RLS
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

app.post('/process', async (req, res) => {
  let { file_id, video_id, bot_token, chat_id, message_id, thumbnail_file_id } = req.body
  if (!file_id || !video_id) return res.status(400).json({ error: 'Missing params' })

  // 🎯 清理可能的空白字符
  video_id = String(video_id).trim()
  file_id = String(file_id).trim()
  if (bot_token) bot_token = bot_token.trim()
  if (thumbnail_file_id) thumbnail_file_id = String(thumbnail_file_id).trim()

  // 🎯 去重检查：如果任务已在处理中或队列中，拒绝重复提交
  const taskKey = getTaskKey(video_id, file_id)
  if (processingTasks.has(taskKey)) {
    console.log(`[Queue] ⚠️ 任务已在处理中，跳过重复提交 [${taskKey}]`)
    return res.json({ status: 'duplicate', video_id, message: '任务已在处理中' })
  }
  if (queuedTasks.has(taskKey)) {
    console.log(`[Queue] ⚠️ 任务已在队列中，跳过重复提交 [${taskKey}]`)
    return res.json({ status: 'duplicate', video_id, message: '任务已在队列中' })
  }

  // 🎯 立即返回响应，避免客户端等待
  res.json({ status: 'processing', video_id, queued: activeTasks >= MAX_CONCURRENT_TASKS })

  // 🎯 将任务加入队列
  const taskHandler = async () => {
    console.log(
      `\n🚀 [${video_id}] 任务启动... (File: ${file_id}, Thumb: ${thumbnail_file_id || 'none'})`
    )

    try {
      const fileRes = await axios.get(`${LOCAL_BOT_API}/bot${bot_token}/getFile?file_id=${file_id}`)
      const localFilePath = fileRes.data.result.file_path

      if (!fs.existsSync(localFilePath)) throw new Error(`文件未找到: ${localFilePath}`)

      const ext = localFilePath.split('.').pop().toLowerCase()
      const isImage = ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext)
      // const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)

      let playUrl = ''
      let coverUrl = ''
      let isHls = false

      if (isImage) {
        console.log(`[${video_id}] 识别为图片项，直接上传...`)
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
        console.log(`[${video_id}] 正在执行 HLS 切片转换...`)
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
          // 🎬 优化：将切片时长从 5 秒改为 4 秒，减少卡顿和跳秒
          // 原因：5秒切片在播放列表切换时缓冲时间过长，导致卡顿
          // 4秒切片在流畅度和文件数量之间取得更好平衡
          execSync(
            `ffmpeg -y -i "${localFilePath}" -c copy ${tagArgs} -hls_time 4 -hls_list_size 0 -f hls "${hlsOutputDir}/index.m3u8"`,
            {
              stdio: 'ignore'
            }
          )

          // 3. 上传所有 HLS 文件 (并发上传优化)
          const files = fs.readdirSync(hlsOutputDir)
          console.log(`[${video_id}] 正在并发上传 HLS 切片 (${files.length} 个文件)...`)

          const UPLOAD_THREADS = 10
          let uploadedCount = 0
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
            // 每 50 个文件打一次进度日志
            if (uploadedCount % 50 === 0 || uploadedCount === files.length) {
              const percent = ((uploadedCount / files.length) * 100).toFixed(1)
              console.log(
                `[${video_id}] ☁️ 上传进度: ${percent}% (${uploadedCount}/${files.length})`
              )
            }
          }

          playUrl = `/videos/${video_id}/index.m3u8`
          isHls = true
          console.log(`[${video_id}] HLS 上传完成: ${playUrl}`)

          // 清理 HLS 临时文件
          files.forEach((f) => fs.unlinkSync(path.join(hlsOutputDir, f)))
          fs.rmdirSync(hlsOutputDir)
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
          const thumbRes = await axios.get(
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
      if (vInfo && vInfo.content_type !== 'collection' && vInfo.content_type !== 'album') {
        if (vInfo.status === 'processing') {
          const isApproved =
            vInfo.review_status === 'approved' || vInfo.review_status === 'auto_approved'
          // 🎯 频道同步 + 免审用户：直接转换为 published，不会变成 ready
          // 🎯 非频道同步或非免审用户：根据审核状态转换
          if (vInfo.is_auto_sync && isApproved) {
            updatePayload.status = 'published'
            updatePayload.published_at = new Date().toISOString()
            console.log(`[${video_id}] 频道同步免审用户，单视频状态转换: processing -> published`)
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
        console.log(`[${video_id}] ✅ 数据库更新成功`)
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
            headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }
          }
        )
        .catch((e) => console.error(`[${video_id}] 回调失败:`, e.message))

      console.log(`[${video_id}] 处理成功！`)
    } catch (error) {
      console.error(`[${video_id}] 💥 异常:`, error.message)
      if (error.response && error.response.data) {
        console.error(`[${video_id}] 🔴 报错详情:`, JSON.stringify(error.response.data))
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
            error: error.message
          },
          {
            headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }
          }
        )
        .catch(() => {})
    }
  }

  // 🎯 将任务加入队列
  queuedTasks.add(taskKey) // 记录到队列中
  taskQueue.push({
    handler: taskHandler,
    videoId: video_id,
    fileId: file_id
  })
  processNextTask()
})

app.listen(PORT, () => console.log(`Worker running on port ${PORT}`))
