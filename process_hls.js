/**
 * 🚀 R2 视频自动切片脚本 (最终稳定版 v5)
 * 特性：
 * 1. 3路并发转换：榨干 4核 CPU。
 * 2. 10线程并发上传：利用 R2 极高并发带宽。
 * 3. Buffer 上传模式：彻底解决跨境网络波动导致的 "non-retryable stream" 报错。
 * 4. 指数退避重试：上传片段失败自动重试，最高 5 次。
 * 5. 自动清理：成功后秒删 R2 原片，节省 TB 级空间。
 */

/* eslint-disable no-undef */
/* eslint-disable no-constant-condition */

import { createClient } from '@supabase/supabase-js'
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand
} from '@aws-sdk/client-s3'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import os from 'os'
import dotenv from 'dotenv'

dotenv.config()

const execPromise = promisify(exec)

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  R2_ENDPOINT,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET
} = process.env

// --- 性能与稳定性配置 ---
const CONCURRENCY = 3 // 同时处理的视频数
const UPLOAD_THREADS = 10 // 每个视频同时上传的切片数
const MAX_RETRIES = 5 // 单个切片最大重试次数

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const s3 = new S3Client({
  endpoint: R2_ENDPOINT,
  region: 'auto',
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  // 🎯 增加超时设置，防止网络挂死
  requestHandler: {
    connectionTimeout: 30000,
    socketTimeout: 30000
  }
})

const TEMP_DIR = path.join(os.tmpdir(), 'hls-processor')
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR)

// --- 日志美化助手 ---
function formatSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function getTS() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function logger(workerId, msg, type = 'info') {
  const icon = {
    info: '💡',
    start: '📦',
    download: '⏳',
    slice: '✂️',
    upload: '☁️',
    db: '💾',
    clean: '🗑️',
    success: '✅',
    error: '💥',
    wait: '😴'
  }[type]
  console.log(`[${getTS()}][W${workerId}] ${icon} ${msg}`)
}

async function main() {
  console.log('------------------------------------------------------------')
  console.log(`🚀 HLS 高可靠处理器启动 | 并发: ${CONCURRENCY} | 上传线程: ${UPLOAD_THREADS}`)
  console.log(`📂 临时目录: ${TEMP_DIR}`)
  console.log('------------------------------------------------------------')

  const workers = Array(CONCURRENCY)
    .fill(0)
    .map((_, i) => startWorker(i))
  await Promise.all(workers)
}

async function startWorker(workerId) {
  // 初始错开，防止瞬间并发压力
  await sleep(workerId * 2500)

  while (true) {
    // 随机偏移抓取，避免 Worker 冲突
    const offset = Math.floor(Math.random() * 40)
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, play_url')
      .eq('status', 'published')
      .eq('is_hls', false)
      .range(offset, offset)
      .limit(1)

    const video = videos?.[0]

    if (error || !video) {
      const { data: fallback } = await supabase
        .from('videos')
        .select('id, play_url')
        .eq('status', 'published')
        .eq('is_hls', false)
        .limit(1)
        .maybeSingle()
      if (!fallback) {
        logger(workerId, '暂无待处理任务，休息 30s...', 'wait')
        await sleep(30000)
        continue
      }
      try {
        await processVideo(fallback, workerId)
      } catch (e) {
        logger(workerId, `视频处理异常: ${e.message}`, 'error')
        await sleep(5000)
      }
    } else {
      try {
        await processVideo(video, workerId)
      } catch (e) {
        logger(workerId, `视频处理异常: ${e.message}`, 'error')
        await sleep(5000)
      }
    }
  }
}

async function processVideo(video, workerId) {
  const { id, play_url } = video
  const startTime = Date.now()
  logger(workerId, `任务开始: ${id}`, 'start')

  // 1. 路径解析
  let relativePath = ''
  try {
    const urlObj = new URL(play_url.startsWith('http') ? play_url : `http://localhost${play_url}`)
    relativePath = urlObj.pathname.startsWith('/') ? urlObj.pathname.slice(1) : urlObj.pathname
  } catch (e) {
    throw new Error('URL 解析失败')
  }

  const folder = path.dirname(relativePath)
  const baseName = path.basename(relativePath, path.extname(relativePath))
  const localMp4 = path.join(TEMP_DIR, `${id}_in.mp4`)
  const outputFolder = path.join(TEMP_DIR, `${id}_out`)
  if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder)

  let stageTime = Date.now()
  try {
    // 2. 下载原片
    const { Body, ContentLength } = await s3.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: relativePath })
    )
    const totalBytes = parseInt(ContentLength || '0')
    logger(workerId, `下载原片: ${relativePath} (${formatSize(totalBytes)})`, 'download')

    const writeStream = fs.createWriteStream(localMp4)
    let downloadedBytes = 0
    let lastLogTime = Date.now()

    // 🎯 优化：使用流式下载并手动计算进度
    await new Promise((res, rej) => {
      // @ts-ignore
      Body.on('data', (chunk) => {
        downloadedBytes += chunk.length
        const now = Date.now()
        if (now - lastLogTime > 5000) {
          const percent = totalBytes > 0 ? ((downloadedBytes / totalBytes) * 100).toFixed(1) : '?'
          logger(workerId, `下载进度: ${percent}% (${formatSize(downloadedBytes)})`, 'download')
          lastLogTime = now
        }
      })
      // @ts-ignore
      Body.pipe(writeStream)
      writeStream.on('finish', res)
      writeStream.on('error', rej)
      // @ts-ignore
      Body.on('error', rej)
    })
    const downloadTime = ((Date.now() - stageTime) / 1000).toFixed(1)
    stageTime = Date.now()

    // 3. 极速切片
    logger(workerId, `FFmpeg 切片开始...`, 'slice')
    // 🎯 增加 ffmpeg 超时保护，防止异常视频导致进程挂死
    await execPromise(
      `ffmpeg -y -i "${localMp4}" -c copy -hls_time 5 -hls_list_size 0 -f hls "${path.join(outputFolder, 'index.m3u8')}"`,
      { timeout: 300000 } // 5 分钟超时
    )
    const sliceTime = ((Date.now() - stageTime) / 1000).toFixed(1)
    stageTime = Date.now()

    // 4. 并发上传切片 (Buffer 模式 + 重试逻辑)
    const files = fs.readdirSync(outputFolder)
    logger(workerId, `并发上传切片 (共 ${files.length} 个文件)...`, 'upload')

    let uploadedCount = 0
    for (let i = 0; i < files.length; i += UPLOAD_THREADS) {
      const chunk = files.slice(i, i + UPLOAD_THREADS)
      await Promise.all(
        chunk.map(async (file) => {
          const filePath = path.join(outputFolder, file)
          const fileContent = fs.readFileSync(filePath)
          const key = `${folder}/${baseName}/${file}`

          let attempt = 0
          while (attempt < MAX_RETRIES) {
            try {
              await s3.send(
                new PutObjectCommand({
                  Bucket: R2_BUCKET,
                  Key: key,
                  Body: fileContent,
                  ContentType: file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/mp2t',
                  CacheControl: 'public, max-age=31536000'
                })
              )
              uploadedCount++
              break
            } catch (err) {
              attempt++
              if (attempt === MAX_RETRIES) throw new Error(`切片上传失败: ${file}`)
              await sleep(Math.pow(2, attempt) * 500) // 指数退避重试
            }
          }
        })
      )
      // 每上传 50 个文件打一次日志
      if (uploadedCount % 50 === 0 || uploadedCount === files.length) {
        const percent = ((uploadedCount / files.length) * 100).toFixed(1)
        logger(workerId, `上传进度: ${percent}% (${uploadedCount}/${files.length})`, 'upload')
      }
    }
    const uploadTime = ((Date.now() - stageTime) / 1000).toFixed(1)
    stageTime = Date.now()

    // 5. 更新数据库
    logger(workerId, `同步数据库状态...`, 'db')
    const newUrl = `/${folder}/${baseName}/index.m3u8`
    const { error: dbErr } = await supabase
      .from('videos')
      .update({ play_url: newUrl, is_hls: true })
      .eq('id', id)
    if (dbErr) throw dbErr

    // 6. 安全清理 R2 原片
    logger(workerId, `清理 R2 原文件 (MP4)`, 'clean')
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: relativePath })).catch(() => {})

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
    logger(
      workerId,
      `任务成功! 耗时: ${totalTime}s (下载:${downloadTime}s, 切片:${sliceTime}s, 上传:${uploadTime}s)`,
      'success'
    )
  } finally {
    // 7. 清理本地环境
    if (fs.existsSync(localMp4)) fs.unlinkSync(localMp4)
    if (fs.existsSync(outputFolder)) {
      fs.readdirSync(outputFolder).forEach((f) => fs.unlinkSync(path.join(outputFolder, f)))
      fs.rmdirSync(outputFolder)
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
main()
