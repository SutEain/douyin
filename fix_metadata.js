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
  maxAttempts: 3
})

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
)

async function fixVideos() {
  while (true) {
    const startTime = Date.now()
    console.log(`\n🔄 [${new Date().toLocaleString()}] 开始新一轮抓取优化任务...`)

    try {
      const { data: videos, error } = await supabase
        .from('videos')
        .select('id, play_url, file_size, title')
        .eq('storage_type', 'r2')
        .eq('is_optimized', false)
        .gt('file_size', 1024 * 1024)
        .order('created_at', { ascending: true })
        .limit(50) // 每次处理 50 个

      if (error) {
        console.error(`❌ 查询失败: ${error.message}`)
        await new Promise((resolve) => setTimeout(resolve, 10000))
        continue
      }

      if (!videos || videos.length === 0) {
        console.log('✨ 所有视频已优化。进入 5 分钟检查周期...')
        await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000))
        continue
      }

      console.log(`📊 本轮任务：${videos.length} 个视频\n`)

      for (let i = 0; i < videos.length; i++) {
        const video = videos[i]
        const videoId = video.id
        const playUrl = video.play_url

        console.log(`[${i + 1}/${videos.length}] 处理: ${video.title || videoId}`)

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
            `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,codec_tag_string,pix_fmt -of json "${localInput}"`
          ).toString()
          const vStream = JSON.parse(probeJson).streams[0]

          if (!vStream || !vStream.codec_name) throw new Error('无效视频文件')

          let ffmpegArgs = `-c copy -movflags +faststart`
          const codecName = (vStream.codec_name || '').toLowerCase()
          const codecTag = (vStream.codec_tag_string || '').toLowerCase()
          const pixFmt = (vStream.pix_fmt || '').toLowerCase()

          if (codecName === 'hevc' && codecTag === 'hev1') {
            console.log(`   - 🛠 修正标签 (hev1 -> hvc1)`)
            ffmpegArgs = `-c copy -tag:v hvc1 -movflags +faststart`
          } else if (codecName === 'h264' && pixFmt === 'yuvj420p') {
            console.log(`   - ⚡ 转码修复 (yuvj420p -> yuv420p)`)
            ffmpegArgs = `-c:v libx264 -preset superfast -pix_fmt yuv420p -c:a copy -movflags +faststart`
          }

          execSync(`ffmpeg -y -i "${localInput}" ${ffmpegArgs} -map_metadata -1 "${localOutput}"`, {
            stdio: 'ignore'
          })

          if (!fs.existsSync(localOutput) || fs.statSync(localOutput).size === 0) {
            throw new Error('FFmpeg 生成文件失败')
          }

          // C. 上传
          await r2.send(
            new PutObjectCommand({
              Bucket: process.env.R2_BUCKET,
              Key: r2Key,
              Body: fs.createReadStream(localOutput),
              ContentType: 'video/mp4'
            })
          )

          // D. 更新状态
          const { data: vInfo } = await supabase.from('videos').select('status').eq('id', videoId).single()
          const updatePayload = { is_optimized: true }
          if (vInfo && vInfo.status === 'processing') {
            updatePayload.status = 'ready'
          }
          await supabase.from('videos').update(updatePayload).eq('id', videoId)
          console.log(`   ✅ 优化成功`)
        } catch (err) {
          console.error(`   ❌ 失败: ${err.message}`)
          if (!err.message.includes('streaming request')) {
            await supabase.from('videos').update({ is_optimized: true }).eq('id', videoId)
          }
        } finally {
          if (fs.existsSync(localInput)) fs.unlinkSync(localInput)
          if (fs.existsSync(localOutput)) fs.unlinkSync(localOutput)
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`\n✨ 本轮优化任务耗时 ${duration}s。进入 5 分钟冷却期...`)
      await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000))
    } catch (err) {
      console.error('😱 循环崩溃:', err.message)
      await new Promise((resolve) => setTimeout(resolve, 10000))
    }
  }
}

fixVideos().catch(console.error)
