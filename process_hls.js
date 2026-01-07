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
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
})

const TEMP_DIR = path.join(os.tmpdir(), 'hls-processor')
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR)

async function main() {
  console.log('------------------------------------------------------------')
  console.log(`🚀 HLS 高可靠处理器启动 | 并发: ${CONCURRENCY} | 上传线程: ${UPLOAD_THREADS}`)
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
        console.log(`[W${workerId}] 😴 暂无任务，休息 30s...`)
        await sleep(30000)
        continue
      }
      try {
        await processVideo(fallback, workerId)
      } catch (e) {
        await sleep(5000)
      }
    } else {
      try {
        await processVideo(video, workerId)
      } catch (e) {
        await sleep(5000)
      }
    }
  }
}

async function processVideo(video, workerId) {
  const { id, play_url } = video
  console.log(`[W${workerId}] 📦 任务开始: ${id}`)

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

  try {
    // 2. 下载原片
    console.log(`[W${workerId}] ⏳ 下载中: ${relativePath}`)
    const { Body } = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: relativePath }))
    const writeStream = fs.createWriteStream(localMp4)
    // @ts-ignore
    await Body.pipe(writeStream)
    await new Promise((res, rej) => {
      writeStream.on('finish', res)
      writeStream.on('error', rej)
    })

    // 3. 极速切片
    console.log(`[W${workerId}] ✂️ 切片中...`)
    await execPromise(
      `ffmpeg -i "${localMp4}" -c copy -hls_time 5 -hls_list_size 0 -f hls "${path.join(outputFolder, 'index.m3u8')}"`
    )

    // 4. 并发上传切片 (Buffer 模式 + 重试逻辑)
    const files = fs.readdirSync(outputFolder)
    console.log(`[W${workerId}] ☁️ 上传中 (${files.length} 个文件)...`)

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
              break
            } catch (err) {
              attempt++
              if (attempt === MAX_RETRIES) throw new Error(`切片上传失败: ${file}`)
              await sleep(Math.pow(2, attempt) * 500) // 指数退避重试
            }
          }
        })
      )
    }

    // 5. 更新数据库
    const newUrl = `/${folder}/${baseName}/index.m3u8`
    const { error: dbErr } = await supabase
      .from('videos')
      .update({ play_url: newUrl, is_hls: true })
      .eq('id', id)
    if (dbErr) throw dbErr

    // 6. 安全清理 R2 原片
    console.log(`[W${workerId}] 🗑️ 清理 R2 原文件`)
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: relativePath })).catch(() => {})

    console.log(`[W${workerId}] ✅ 任务完成: ${id}`)
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
