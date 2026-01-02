require('dotenv').config()
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
const LOCAL_BOT_API = process.env.LOCAL_BOT_API || 'http://localhost:8081' // Docker 内部端口是 8081
const R2_BUCKET = process.env.R2_BUCKET
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL

// 初始化 R2 客户端
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
})

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// 核心接口：接收处理任务
app.post('/process', async (req, res) => {
  const { file_id, video_id, bot_token, chat_id, message_id } = req.body

  if (!file_id || !video_id) {
    return res.status(400).json({ error: 'Missing params' })
  }

  // 1. 立即响应 Supabase，防止超时
  res.json({ status: 'processing', video_id })

  console.log(`[${video_id}] 开始处理任务...`)

  try {
    // 2. 获取文件信息 (向 Local API 请求路径)
    // 注意：Local API 返回的路径是容器内的绝对路径
    const fileRes = await axios.get(`${LOCAL_BOT_API}/bot${bot_token}/getFile?file_id=${file_id}`)
    const filePathInContainer = fileRes.data.result.file_path

    // 3. 修正路径
    // Docker 挂载关系：宿主机 /var/lib/telegram-bot-api <-> 容器 /var/lib/telegram-bot-api
    // 所以宿主机路径 = 容器路径
    const localFilePath = filePathInContainer

    if (!fs.existsSync(localFilePath)) {
      throw new Error(`文件不存在: ${localFilePath}`)
    }

    // 🎯 深度内容校验：防止改后缀的伪造文件
    try {
      console.log(`[${video_id}] 正在验证文件真实性...`)
      // -show_streams 尝试读取轨道信息，-select_streams v 仅看视频轨
      const probeResult = execSync(
        `ffprobe -v error -select_streams v -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${localFilePath}"`
      )
        .toString()
        .trim()

      if (!probeResult) {
        throw new Error('该文件不包含有效的视频流，可能是伪造或损坏的文件')
      }
      console.log(`[${video_id}] 验证通过，编码格式: ${probeResult}`)
    } catch (err) {
      console.error(`[${video_id}] 文件校验失败:`, err.message)
      throw new Error(`上传失败：检测到该文件不是有效的视频文件 (详情: ${err.message})`)
    }

    // 🎯 优化：使用 ffmpeg 进行 faststart 处理，解决长视频拖动卡顿问题
    const optimizedPath = `${localFilePath}.opt.mp4`
    try {
      console.log(`[${video_id}] 正在执行 faststart 优化...`)
      // -c copy 表示不重编码（极快），-movflags +faststart 将元数据移至文件头
      execSync(`ffmpeg -y -i "${localFilePath}" -c copy -movflags +faststart "${optimizedPath}"`, {
        stdio: 'ignore'
      })
      console.log(`[${video_id}] faststart 优化完成`)
    } catch (err) {
      console.warn(
        `[${video_id}] ffmpeg 优化失败（可能未安装 ffmpeg），将使用原文件上传:`,
        err.message
      )
    }

    const uploadPath = fs.existsSync(optimizedPath) ? optimizedPath : localFilePath

    // 4. 上传到 R2
    const ext = localFilePath.split('.').pop()
    // 🎯 优化：使用 video_id + file_id 确保合辑内每个视频路径唯一，防止覆盖
    const r2Key = `videos/${video_id}/${file_id}.${ext}`
    console.log(`[${video_id}] 正在上传到 R2: ${r2Key}`)

    const fileStream = fs.createReadStream(uploadPath)
    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: fileStream,
        ContentType: 'video/mp4'
      })
    )

    const playUrl = `${R2_PUBLIC_URL}/${r2Key}`
    console.log(`[${video_id}] 上传完成: ${playUrl}`)

    // 5. 更新数据库主记录
    await supabase
      .from('videos')
      .update({
        play_url: playUrl,
        status: 'draft',
        storage_type: 'r2'
      })
      .eq('id', video_id)

    // 6. 删除本地临时文件
    fs.unlink(localFilePath, (err) => {
      if (err) console.error(`[${video_id}] 删除本地文件失败:`, err)
    })
    if (fs.existsSync(optimizedPath)) {
      fs.unlink(optimizedPath, (err) => {
        if (err) console.error(`[${video_id}] 删除优化文件失败:`, err)
      })
    }

    // 7. 通知 Supabase 完成 (触发编辑菜单)
    const webhookUrl = `${process.env.SUPABASE_URL}/functions/v1/bot-video-upload`

    await axios.post(
      webhookUrl,
      {
        type: 'worker_complete',
        chatId: chat_id,
        message_id: message_id, // 兼容字段
        messageId: message_id,
        videoId: video_id,
        file_id: file_id, // 🎯 新增：明确告诉 Bot 哪一集处理好了
        play_url: playUrl, // 🎯 新增：直接返回播放地址，减少 Bot 二次查询
        success: true
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY}`
        }
      }
    )

    console.log(`[${video_id}] 任务全部完成`)
  } catch (error) {
    console.error(`[${video_id}] 处理失败:`, {
      message: error.message,
      code: error.code,
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
      data: error.response?.data
    })

    // 通知失败
    try {
      const webhookUrl = `${process.env.SUPABASE_URL}/functions/v1/bot-video-upload`
      await axios.post(webhookUrl, {
        type: 'worker_complete',
        chatId: chat_id,
        messageId: message_id,
        videoId: video_id,
        file_id: file_id, // 🎯 新增
        success: false,
        error: error.message
      })
    } catch (e) {
      console.error('回调通知也失败了', e.message)
    }
  }
})

app.listen(PORT, () => {
  console.log(`Worker running on port ${PORT}`)
})
