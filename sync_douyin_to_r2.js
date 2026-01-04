const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

// --- 1. 初始化客户端 (参考 fix_metadata.js) ---
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  },
  maxAttempts: 3
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-xxx.r2.dev';
const DOUYIN_SELECTION_NUMERIC_ID = 88888;

async function main() {
  const targetId = process.argv[2];
  
  if (targetId) {
    console.log(`🚀 开始处理指定视频 ID: ${targetId}`);
    const { data: video, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', targetId)
      .single();
      
    if (error || !video) {
      console.error('❌ 未找到该视频');
      return;
    }
    await processVideo(video);
  } else {
    // --- 批量模式 ---
    while (true) {
      const startTime = Date.now();
      console.log(`\n🔄 [${new Date().toLocaleString()}] 开始新一轮搬运检查...`);
      
      try {
        const { data: author } = await supabase
          .from('profiles')
          .select('id')
          .eq('numeric_id', DOUYIN_SELECTION_NUMERIC_ID)
          .maybeSingle();

        if (author) {
          const { data: videos, error } = await supabase
            .from('videos')
            .select('*')
            .eq('author_id', author.id)
            .neq('storage_type', 'r2')
            .order('created_at', { ascending: false })
            .limit(50);

          if (error) throw error;

          if (videos?.length) {
            console.log(`[Batch] 发现 ${videos.length} 个视频，开始搬运...`);
            for (const video of videos) {
              await processVideo(video);
              // 🎯 优化：每处理完一个视频，休息 3 秒，防止 CPU 持续满载
              await new Promise(r => setTimeout(r, 3000));
            }
          } else {
            console.log('✅ 暂无需要同步的视频。');
          }
        }
      } catch (err) {
        console.error('😱 批量处理异常:', err.message);
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n✨ 本轮任务耗时 ${duration}s。按计划进入 5 分钟冷却期...`);
      await new Promise(r => setTimeout(r, 5 * 60 * 1000)); // 严格休眠 5 分钟
    }
  }
}

async function processVideo(video) {
  const videoId = video.id;
  const rawUrl = video.play_url;
  const rawCoverUrl = video.cover_url;

  if (!rawUrl || !rawUrl.startsWith('http')) {
    console.log(`- ⏩ 跳过 ${videoId}: 无效 URL`);
    return;
  }

  const tempInput = path.join(__dirname, `sync_in_${videoId}.mp4`);
  const tempOutput = path.join(__dirname, `sync_out_${videoId}.mp4`);
  const tempCover = path.join(__dirname, `sync_cover_${videoId}.webp`);

  try {
    console.log(`处理 [${videoId}]:`);
    
    // 1. 下载视频
    console.log(`   - 🔽 正在下载外部视频...`);
    const response = await axios({
      method: 'get',
      url: rawUrl,
      responseType: 'stream',
      timeout: 120000,
      headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const writer = fs.createWriteStream(tempInput);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    if (!fs.existsSync(tempInput) || fs.statSync(tempInput).size < 1024) {
      throw new Error('下载失败: 文件损坏或过小');
    }

    // 1.1 下载封面 (同步处理)
    let newCoverUrl = rawCoverUrl;
    if (rawCoverUrl && rawCoverUrl.startsWith('http')) {
      console.log(`   - 🖼️ 正在同步封面图...`);
      try {
        const coverRes = await axios({
          method: 'get',
          url: rawCoverUrl,
          responseType: 'arraybuffer',
          timeout: 15000
        });
        const coverKey = `covers/${videoId}.webp`;
        await r2.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: coverKey,
          Body: coverRes.data,
          ContentType: 'image/webp'
        }));
        newCoverUrl = `${R2_PUBLIC_URL}/${coverKey}`;
      } catch (ce) {
        console.warn(`   - ⚠️ 封面同步失败: ${ce.message}，保持原样`);
      }
    }

    // 2. 分析编码信息
    const probeJson = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,codec_tag_string,pix_fmt -of json "${tempInput}"`
    ).toString();
    const probeData = JSON.parse(probeJson);
    const vStream = probeData.streams[0];

    if (!vStream || !vStream.codec_name) throw new Error('无效视频文件');

    let ffmpegArgs = `-c copy -movflags +faststart`;
    const codecName = (vStream.codec_name || '').toLowerCase();
    const codecTag = (vStream.codec_tag_string || '').toLowerCase();
    const pixFmt = (vStream.pix_fmt || '').toLowerCase();

    let action = '✨ 执行 FastStart 优化';

    if (codecName === 'hevc' && codecTag === 'hev1') {
      action = '🛠 修正标签 (hev1 -> hvc1)';
      ffmpegArgs = `-c copy -tag:v hvc1 -movflags +faststart`;
    } else if (codecName === 'h264' && pixFmt === 'yuvj420p') {
      action = '⚡ 重新编码修复兼容性 (yuvj420p -> yuv420p)';
      // 🎯 优化：限制 ffmpeg 只使用 1 个线程，降低 CPU 峰值
      ffmpegArgs = `-c:v libx264 -preset superfast -threads 1 -pix_fmt yuv420p -c:a copy -movflags +faststart`;
    }

    console.log(`   - ${action}...`);
    // 🎯 优化：增加全局 -threads 1 确保即使是 copy 模式也尽量低功耗
    execSync(`ffmpeg -y -threads 1 -i "${tempInput}" ${ffmpegArgs} -map_metadata -1 "${tempOutput}"`, {
      stdio: 'ignore'
    });

    // 3. 上传到 R2
    const fileKey = `videos/${videoId}.mp4`;
    console.log(`   - 🔼 正在上传到 R2...`);
    
    if (!fs.existsSync(tempOutput) || fs.statSync(tempOutput).size === 0) {
      throw new Error('FFmpeg 生成的文件为空');
    }

    const fileSize = fs.statSync(tempOutput).size;
    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: fileKey,
        Body: fs.createReadStream(tempOutput),
        ContentType: 'video/mp4',
        ContentLength: fileSize // 🎯 修复：显式提供文件大小，解决 "exceeds maximum allowed size" 报错
      })
    );

    const newUrl = `${R2_PUBLIC_URL}/${fileKey}`;

    // 4. 更新数据库 (同时更新封面和视频链接)
    await supabase.from('videos').update({
      play_url: newUrl,
      cover_url: newCoverUrl,
      storage_type: 'r2',
      is_optimized: true,
      status: 'published'
    }).eq('id', videoId);

    console.log(`   ✅ 成功: ${newUrl}`);

  } catch (err) {
    console.error(`   ❌ 失败 [${videoId}]:`, err.message);
  } finally {
    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
    if (fs.existsSync(tempCover)) fs.unlinkSync(tempCover);
  }
}

main().catch(console.error);
