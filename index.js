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

  res.json({ status: 'processing', video_id })
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

    let uploadPath = localFilePath
    let contentType = isImage ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'video/mp4'
    let playUrl = ''
    let coverUrl = ''

    if (isImage) {
      console.log(`[${video_id}] 识别为图片项，跳过视频优化流程...`)
    } else {
      // 🎯 视频兼容性处理
      console.log(`[${video_id}] 正在执行兼容性分析...`)
      try {
        const probeJson = execSync(
          `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,codec_tag_string -of json "${localFilePath}"`
        ).toString()
        const vStream = JSON.parse(probeJson).streams[0]

        if (vStream && vStream.codec_name) {
          let ffmpegArgs = `-c copy -movflags +faststart`
          const codecName = (vStream.codec_name || '').toLowerCase()
          const codecTag = (vStream.codec_tag_string || '').toLowerCase()

          if (codecName === 'hevc' && codecTag === 'hev1') {
            console.log(`[${video_id}] 修正苹果不兼容标签 (hev1 -> hvc1)...`)
            ffmpegArgs = `-c copy -tag:v hvc1 -movflags +faststart`
          }

          const optimizedPath = `${localFilePath}.opt.mp4`
          execSync(`ffmpeg -y -i "${localFilePath}" ${ffmpegArgs} "${optimizedPath}"`, {
            stdio: 'ignore'
          })
          if (fs.existsSync(optimizedPath)) {
            uploadPath = optimizedPath
          }
        }
      } catch (e) {
        console.warn(`[${video_id}] ffprobe/ffmpeg 失败，尝试原始上传:`, e.message)
      }
    }

    // 🎯 上传主文件到 R2
    const r2Key = `videos/${video_id}/${file_id}.${ext}`
    console.log(`[${video_id}] 正在上传到 R2: ${r2Key} (${contentType})`)

    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: fs.createReadStream(uploadPath),
        ContentType: contentType
      })
    )

    playUrl = `${R2_PUBLIC_URL}/${r2Key}`
    console.log(`[${video_id}] 上传完成: ${playUrl}`)

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
          coverUrl = `${R2_PUBLIC_URL}/${thumbR2Key}`
          fs.unlinkSync(localThumbPath)
        }
      } catch (e) {
        console.warn(`[${video_id}] Telegram 缩略图下载失败，将尝试从视频截取:`, e.message)
      }
    }

    // 🎯 兜底方案：如果还没有封面且是视频，则从视频中截取第一帧
    if (!coverUrl && !isImage && fs.existsSync(uploadPath)) {
      console.log(`[${video_id}] 正在从视频截取封面...`)
      try {
        const screenshotPath = `${uploadPath}.thumb.jpg`
        // 截取第 1 秒的一帧
        execSync(`ffmpeg -y -i "${uploadPath}" -ss 00:00:01 -vframes 1 "${screenshotPath}"`, {
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
          coverUrl = `${R2_PUBLIC_URL}/${thumbR2Key}`
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
      .select('status, review_status, content_type, media_list')
      .eq('id', video_id)
      .single()

    const updatePayload = {
      play_url: playUrl,
      storage_type: 'r2',
      is_optimized: true
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
          if (coverUrl) item.cover_url = coverUrl
          changed = true
        }
        return item
      })
      if (changed) {
        updatePayload.media_list = list
      }
    }

    // 🎯 如果是合集/相册，Worker 只负责上传文件，不负责最终状态（由 Edge Function 回调处理）
    // 只有单视频模式下，Worker 才直接负责将 processing 转为 published/ready
    if (vInfo && vInfo.content_type !== 'collection' && vInfo.content_type !== 'album') {
      if (vInfo.status === 'processing') {
        const isApproved =
          vInfo.review_status === 'approved' || vInfo.review_status === 'auto_approved'
        updatePayload.status = isApproved ? 'published' : 'ready'
        console.log(`[${video_id}] 单视频状态转换: processing -> ${updatePayload.status}`)
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
})

app.listen(PORT, () => console.log(`Worker running on port ${PORT}`))
