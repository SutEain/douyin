/* eslint-disable */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { createClient } = require('@supabase/supabase-js')
const axios = require('axios')

// 1. 获取命令行参数
const videoId = process.argv[2]
if (!videoId) {
  console.error('❌ 请提供视频 ID')
  process.exit(1)
}

// 2. 初始化客户端
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
})

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
)

async function fixSingleVideo() {
  console.log(`🚀 深度修复视频: ${videoId}`)

  try {
    const { data: video, error: queryError } = await supabase
      .from('videos')
      .select('id, play_url, file_size, title')
      .eq('id', videoId)
      .single()

    if (queryError || !video) throw new Error(`未找到视频: ${videoId}`)

    const playUrl = video.play_url
    const urlObj = new URL(playUrl)
    const r2Key = urlObj.pathname.startsWith('/') ? urlObj.pathname.slice(1) : urlObj.pathname

    const localInput = path.join(__dirname, `fix_in_${videoId}.mp4`)
    const localOutput = path.join(__dirname, `fix_out_${videoId}.mp4`)

    console.log(`   - 🔽 下载中...`)
    const response = await axios({ method: 'GET', url: playUrl, responseType: 'stream' })
    const writer = fs.createWriteStream(localInput)
    response.data.pipe(writer)
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve)
      writer.on('error', reject)
    })

    console.log(`   - 🔍 深度分析编码参数...`)
    const probeJson = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,codec_tag_string,pix_fmt -of json "${localInput}"`
    ).toString()
    const vStream = JSON.parse(probeJson).streams[0]

    if (!vStream) throw new Error('解析流失败')

    const codecName = (vStream.codec_name || '').toLowerCase()
    const codecTag = (vStream.codec_tag_string || '').toLowerCase()
    const pixFmt = (vStream.pix_fmt || '').toLowerCase()

    let ffmpegArgs = `-c copy -movflags +faststart`

    // 🎯 策略 1: 修复 hev1 (苹果 HEVC 兼容性)
    if (codecName === 'hevc' && codecTag === 'hev1') {
      console.log(`   - 🛠 修正标签 (hev1 -> hvc1)`)
      ffmpegArgs = `-c copy -tag:v hvc1 -movflags +faststart`
    }
    // 🎯 策略 2: 修复 yuvj (苹果 H.264 像素格式兼容性)
    else if (pixFmt.includes('yuvj')) {
      console.log(`   - ⚠️ 检测到不兼容的像素格式 (${pixFmt})，正在执行极速兼容性转码...`)
      // 使用 superfast 预设减少等待时间，crf 23 保证画质
      ffmpegArgs = `-c:v libx264 -pix_fmt yuv420p -preset superfast -crf 23 -c:a copy -movflags +faststart`
    } else {
      console.log(`   - ✨ 仅 FastStart 优化`)
    }

    execSync(`ffmpeg -y -i "${localInput}" ${ffmpegArgs} "${localOutput}"`, { stdio: 'ignore' })

    console.log(`   - 🔼 上传回 R2...`)
    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: r2Key,
        Body: fs.createReadStream(localOutput),
        ContentType: 'video/mp4'
      })
    )

    // 🎯 更新状态
    const { data: vInfo } = await supabase
      .from('videos')
      .select('status')
      .eq('id', videoId)
      .single()
    const updatePayload = { is_optimized: true }
    if (vInfo && vInfo.status === 'processing') {
      console.log(`   - 🔄 状态转换: processing -> ready`)
      updatePayload.status = 'ready'
    }

    await supabase.from('videos').update(updatePayload).eq('id', videoId)
    console.log(`✅ 处理完成！`)
  } catch (err) {
    console.error(`❌ 失败: ${err.message}`)
  } finally {
    if (fs.existsSync(localInput)) fs.unlinkSync(localInput)
    if (fs.existsSync(localOutput)) fs.unlinkSync(localOutput)
  }
}

fixSingleVideo()
