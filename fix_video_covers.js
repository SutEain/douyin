/* eslint-disable no-undef */
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '.env') })
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { createClient } = require('@supabase/supabase-js')
const { exec } = require('child_process')
const util = require('util')
const execPromise = util.promisify(exec)
const fs = require('fs')

/**
 * 视频封面补救脚本 v1.2 (增强版)
 * 
 * 功能：
 * 1. 支持并发处理。
 * 2. 优化截图时间，兼容极短视频。
 * 3. 增加错误记录，防止死循环卡死。
 */

// 1. 初始化配置
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
})

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const BATCH_SIZE = 50 // 每批次抓取数量
const CONCURRENCY = 5 // 并发数

async function processSingleVideo(v) {
  const tmpPath = path.resolve(__dirname, `thumb_${v.id}.jpg`)
  try {
    console.log(`🎬 正在处理 [${v.id}] ...`)
    
    // 🎯 优化：改为截取 00:00:00，确保 1秒短视频也能截到
    // 使用 -t 1 限制读取时间，避免某些损坏视频导致 ffmpeg 挂起
    await execPromise(`ffmpeg -y -t 5 -i "${v.play_url}" -ss 00:00:00 -vframes 1 "${tmpPath}"`, {
      timeout: 30000 // 30秒超时保护
    })

    if (!fs.existsSync(tmpPath)) {
      throw new Error('截图文件未生成')
    }

    // 上传到 R2
    const thumbR2Key = `videos/${v.id}/cover_rescue.jpg`
    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: thumbR2Key,
        Body: fs.createReadStream(tmpPath),
        ContentType: 'image/jpeg'
      })
    )

    const coverUrl = `${process.env.R2_PUBLIC_URL}/${thumbR2Key}`

    // 更新数据库
    const { error: updateError } = await supabase
      .from('videos')
      .update({ cover_url: coverUrl })
      .eq('id', v.id)

    if (updateError) throw updateError

    console.log(`   ✅ 成功 [${v.id.substring(0, 8)}]: ${coverUrl}`)
  } catch (err) {
    console.error(`   ❌ 失败 [${v.id.substring(0, 8)}]:`, err.message)
    
    // 🎯 核心防死循环：如果截图失败，给它打个标记，防止下一轮重复抓取
    // 我们可以给它设为一个特殊的占位符，或者设置 status 避免再次被查出
    await supabase
      .from('videos')
      .update({ cover_url: 'FAILED_TO_GENERATE' }) // 标记为失败，以后可以手动查出再修
      .eq('id', v.id)
  } finally {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath)
      } catch (e) {
        // ignore
      }
    }
  }
}

async function main() {
  console.log('🚀 封面修复任务启动 (v1.2)...')
  
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // 抓取 storage_type=r2 且 cover_url 为 null 的视频
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, play_url')
      .eq('storage_type', 'r2')
      .eq('status', 'published')
      .is('cover_url', null)
      .or('content_type.is.null,content_type.eq.video')
      .limit(BATCH_SIZE)

    if (error) {
      console.error('❌ 获取数据失败:', error.message)
      await new Promise(r => setTimeout(r, 5000))
      continue
    }

    if (!videos || videos.length === 0) {
      console.log('✅ 所有任务已处理完毕，正在休眠...')
      await new Promise(r => setTimeout(r, 60000))
      continue
    }

    console.log(`📊 抓取到 ${videos.length} 条数据，并发处理中...`)

    // 分组进行并发处理
    for (let i = 0; i < videos.length; i += CONCURRENCY) {
      const batch = videos.slice(i, i + CONCURRENCY)
      await Promise.all(batch.map(v => processSingleVideo(v)))
    }
  }
}

main().catch(console.error)
