/* eslint-disable */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { createClient } = require('@supabase/supabase-js')
const axios = require('axios')

// 1. 初始化客户端
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  },
  maxAttempts: 3 // 增加重试次数
})

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
)

async function fixVideos() {
  while (true) {
    console.log(`\n🔄 [${new Date().toLocaleString()}] 开始新一轮抓取...`)

    try {
      const { data: videos, error } = await supabase
        .from('videos')
        .select('id, play_url, file_size, title')
        .eq('storage_type', 'r2')
        .eq('is_optimized', false)
        .gt('file_size', 1024 * 1024)
        .order('created_at', { ascending: true })
        .limit(100)

      if (error) {
        console.error(`❌ 查询失败: ${error.message}`)
        await new Promise((resolve) => setTimeout(resolve, 5000))
        continue
      }

      const total = videos.length
      if (total === 0) {
        console.log('✨ 所有视频已处理完毕。休眠 1 分钟后检查新视频...')
        await new Promise((resolve) => setTimeout(resolve, 60000))
        continue
      }

      console.log(`📊 本轮任务：${total} 个视频\n`)

      for (let i = 0; i < total; i++) {
        const video = videos[i]
        const videoId = video.id
        const playUrl = video.play_url

        console.log(`[${i + 1}/${total}] 处理: ${video.title || videoId}`)

        let r2Key = ''
        try {
          const urlObj = new URL(playUrl)
          r2Key = urlObj.pathname.startsWith('/') ? urlObj.pathname.slice(1) : urlObj.pathname
        } catch (e) {
          console.error(`   ❌ URL解析失败: ${playUrl}`)
          continue
        }

        const localInput = path.join(__dirname, `fix_in_${videoId}.mp4`)
        const localOutput = path.join(__dirname, `fix_out_${videoId}.mp4`)

        try {
          // A. 下载
          const response = await axios({ method: 'GET', url: playUrl, responseType: 'stream' })
          const writer = fs.createWriteStream(localInput)
          response.data.pipe(writer)
          await new Promise((resolve, reject) => {
            writer.on('finish', resolve)
            writer.on('error', reject)
          })

          // B. 分析与修复
          const probeJson = execSync(
            `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,codec_tag_string -of json "${localInput}"`
          ).toString()
          const vStream = JSON.parse(probeJson).streams[0]

          if (!vStream || !vStream.codec_name) throw new Error('无效视频文件')

          let ffmpegArgs = `-c copy -movflags +faststart`
          const codecName = (vStream.codec_name || '').toLowerCase()
          const codecTag = (vStream.codec_tag_string || '').toLowerCase()

          if (codecName === 'hevc' && codecTag === 'hev1') {
            console.log(`   - 🛠 修正标签 (hev1 -> hvc1)`)
            ffmpegArgs = `-c copy -tag:v hvc1 -movflags +faststart`
          } else {
            console.log(`   - ✨ FastStart 优化 (${codecTag})`)
          }

          execSync(`ffmpeg -y -i "${localInput}" ${ffmpegArgs} "${localOutput}"`, {
            stdio: 'ignore'
          })

          // C. 校验并上传
          if (!fs.existsSync(localOutput) || fs.statSync(localOutput).size === 0) {
            throw new Error('FFmpeg 生成的文件为空或不存在')
          }

          await r2.send(
            new PutObjectCommand({
              Bucket: process.env.R2_BUCKET,
              Key: r2Key,
              Body: fs.createReadStream(localOutput),
              ContentType: 'video/mp4'
            })
          )

          await supabase.from('videos').update({ is_optimized: true }).eq('id', videoId)
          console.log(`   ✅ 成功`)
        } catch (err) {
          console.error(`   ❌ 失败: ${err.message}`)
          // 如果是 R2 网络问题，可以考虑不打标记下次重试；如果是文件坏了，打标记跳过
          if (!err.message.includes('streaming request')) {
            await supabase.from('videos').update({ is_optimized: true }).eq('id', videoId)
          }
        } finally {
          if (fs.existsSync(localInput)) fs.unlinkSync(localInput)
          if (fs.existsSync(localOutput)) fs.unlinkSync(localOutput)
        }
      }
    } catch (err) {
      console.error('😱 循环崩溃:', err.message)
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }
}

fixVideos().catch(console.error)
