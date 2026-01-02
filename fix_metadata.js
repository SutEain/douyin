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
  }
})

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
)

async function fixVideos() {
  console.log('🚀 [开始] 正在检索未优化的存量大视频...')

  try {
    // 2. 获取未优化的视频列表 (限制 2000 个，处理完可再次运行)
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, play_url, file_size, title')
      .eq('storage_type', 'r2')
      .eq('is_optimized', false) // 🎯 只选还没优化的
      .gt('file_size', 20 * 1024 * 1024) // 🎯 只选大于 20MB 的
      .order('created_at', { ascending: true }) // 从最老的视频开始
      .limit(2000)

    if (error) {
      throw new Error(`查询数据库失败: ${error.message}`)
    }

    const total = videos.length
    if (total === 0) {
      console.log('✨ 恭喜！所有视频都已优化完成，没有待处理项。')
      return
    }

    console.log(`📊 统计：本次任务共有 ${total} 个大视频等待优化。\n`)

    let successCount = 0
    let failCount = 0

    // 3. 逐个串行处理
    for (let i = 0; i < total; i++) {
      const video = videos[i]
      const videoId = video.id
      const playUrl = video.play_url

      console.log(`[${i + 1}/${total}] 正在处理: ${video.title || videoId}`)
      console.log(`   - 文件大小: ${(video.file_size / 1024 / 1024).toFixed(2)} MB`)

      // 解析 R2 Key
      let r2Key = ''
      try {
        const urlObj = new URL(playUrl)
        r2Key = urlObj.pathname.startsWith('/') ? urlObj.pathname.slice(1) : urlObj.pathname
      } catch (e) {
        console.error(`   ❌ 解析 URL 失败: ${playUrl}`)
        failCount++
        continue
      }

      const localInput = path.join(__dirname, `fix_in_${videoId}.mp4`)
      const localOutput = path.join(__dirname, `fix_out_${videoId}.mp4`)

      try {
        // A. 从 R2 下载
        console.log(`   - 🔽 下载中...`)
        const response = await axios({ method: 'GET', url: playUrl, responseType: 'stream' })
        const writer = fs.createWriteStream(localInput)
        response.data.pipe(writer)
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve)
          writer.on('error', reject)
        })

        // 🎯 深度内容校验：防止下载到损坏或伪造的文件
        try {
          console.log(`   - 🔍 验证文件真实性...`)
          const probeResult = execSync(
            `ffprobe -v error -select_streams v -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${localInput}"`
          )
            .toString()
            .trim()

          if (!probeResult) {
            throw new Error('不包含有效的视频流')
          }
        } catch (err) {
          console.error(`   ⚠️ [${videoId}] 文件校验失败，跳过优化: ${err.message}`)
          // 如果校验失败，直接标记为已完成（或者根据业务逻辑决定是否标记），避免下次重复抓取这种坏文件
          await supabase.from('videos').update({ is_optimized: true }).eq('id', videoId)
          continue
        }

        // B. 执行 FastStart 优化
        console.log(`   - ⚡ FastStart 优化中...`)
        execSync(`ffmpeg -y -i "${localInput}" -c copy -movflags +faststart "${localOutput}"`, {
          stdio: 'ignore'
        })

        // C. 上传回 R2 (覆盖)
        console.log(`   - 🔼 同步回 R2...`)
        await r2.send(
          new PutObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: r2Key,
            Body: fs.createReadStream(localOutput),
            ContentType: 'video/mp4'
          })
        )

        // D. 标记数据库已完成
        console.log(`   - 📝 标记数据库...`)
        const { error: updateError } = await supabase
          .from('videos')
          .update({ is_optimized: true })
          .eq('id', videoId)

        if (updateError) {
          console.warn(`   ⚠️ 数据库标记失败: ${updateError.message}`)
        }

        successCount++
        console.log(`   ✅ 处理成功并已存档`)
      } catch (err) {
        failCount++
        console.error(`   ❌ 处理失败: ${err.message}`)
      } finally {
        // E. 立即清理临时文件
        if (fs.existsSync(localInput)) fs.unlinkSync(localInput)
        if (fs.existsSync(localOutput)) fs.unlinkSync(localOutput)
        console.log('-----------------------------------')
      }
    }

    // 4. 完成汇总
    const summary = `
=========================================
      🎬 存量视频优化完成日志
=========================================
完成时间：${new Date().toLocaleString()}
本次抓取：${total} 个
成功优化：${successCount} 个
出现错误：${failCount} 个
=========================================
`
    console.log(summary)
    fs.appendFileSync(path.join(__dirname, 'fix_summary.log'), summary)
  } catch (err) {
    console.error('💥 脚本崩溃:', err.message)
  }
}

// 检查是否安装了 ffmpeg
try {
  execSync('ffmpeg -version', { stdio: 'ignore' })
  fixVideos()
} catch (e) {
  console.error('❌ 错误：服务器未安装 ffmpeg，请先执行 "sudo apt install ffmpeg -y"')
  process.exit(1)
}
