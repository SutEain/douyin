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

const PORT = 3001
const LOCAL_BOT_API = process.env.LOCAL_BOT_API || 'http://localhost:8081'
const R2_BUCKET = process.env.R2_BUCKET
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
})

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

app.post('/process', async (req, res) => {
  let { file_id, video_id, bot_token, chat_id, message_id } = req.body
  if (!file_id || !video_id) return res.status(400).json({ error: 'Missing params' })

  file_id = file_id.trim()
  if (bot_token) bot_token = bot_token.trim()

  res.json({ status: 'processing', video_id })
  console.log(`[${video_id}] 任务启动...`)

  try {
    const fileRes = await axios.get(`${LOCAL_BOT_API}/bot${bot_token}/getFile?file_id=${file_id}`)
    const localFilePath = fileRes.data.result.file_path

    if (!fs.existsSync(localFilePath)) throw new Error(`文件未找到: ${localFilePath}`)

    // 🎯 核心逻辑：深度内容分析与极速兼容性修复
    console.log(`[${video_id}] 正在执行兼容性分析...`)
    const probeJson = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,codec_tag_string -of json "${localFilePath}"`
    ).toString()
    const vStream = JSON.parse(probeJson).streams[0]

    if (!vStream || !vStream.codec_name) throw new Error('无效视频内容')

    let ffmpegArgs = `-c copy -movflags +faststart`

    // 🎯 苹果设备兼容性检查 (hev1 -> hvc1)
    const codecName = (vStream.codec_name || '').toLowerCase()
    const codecTag = (vStream.codec_tag_string || '').toLowerCase()

    if (codecName === 'hevc' && codecTag === 'hev1') {
      console.log(`[${video_id}] 检测到 hev1 标签 (苹果不兼容)，正在极速修正为 hvc1...`)
      ffmpegArgs = `-c copy -tag:v hvc1 -movflags +faststart`
    } else {
      console.log(`[${video_id}] 编码标签正常 (${codecTag})，仅执行 FastStart 优化...`)
    }

    const optimizedPath = `${localFilePath}.opt.mp4`
    execSync(`ffmpeg -y -i "${localFilePath}" ${ffmpegArgs} "${optimizedPath}"`, {
      stdio: 'ignore'
    })

    const uploadPath = fs.existsSync(optimizedPath) ? optimizedPath : localFilePath

    // 上传到 R2
    const ext = localFilePath.split('.').pop()
    const r2Key = `videos/${video_id}/${file_id}.${ext}`

    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: fs.createReadStream(uploadPath),
        ContentType: 'video/mp4'
      })
    )

    const playUrl = `${R2_PUBLIC_URL}/${r2Key}`
    console.log(`[${video_id}] 上传完成: ${playUrl}`)

    // 🎯 获取当前视频状态
    const { data: vInfo } = await supabase
      .from('videos')
      .select('status, review_status')
      .eq('id', video_id)
      .single()

    const updatePayload = {
      play_url: playUrl,
      storage_type: 'r2',
      is_optimized: true
    }

    // 🎯 如果当前是“处理中”状态，且已审核通过，则直接转为“发布”；否则转为“就绪”
    if (vInfo && vInfo.status === 'processing') {
      const isApproved = vInfo.review_status === 'approved' || vInfo.review_status === 'auto_approved'
      console.log(`[${video_id}] 状态转换: processing -> ${isApproved ? 'published' : 'ready'}`)
      updatePayload.status = isApproved ? 'published' : 'ready'
    }

    // 🎯 更新数据库
    await supabase.from('videos').update(updatePayload).eq('id', video_id)

    // 清理临时文件
    if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath)
    if (fs.existsSync(optimizedPath)) fs.unlinkSync(optimizedPath)

    // 通知回调
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
          success: true
        },
        {
          headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }
        }
      )
      .catch((e) => console.error('Callback failed:', e.message))

    console.log(`[${video_id}] 处理成功！`)
  } catch (error) {
    if (error.response) {
      console.error(`[${video_id}] 失败 (HTTP ${error.response.status}):`, JSON.stringify(error.response.data))
    } else {
      console.error(`[${video_id}] 失败:`, error.message)
    }
    // 失败回调
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
})

app.listen(PORT, () => console.log(`Worker running on port ${PORT}`))
