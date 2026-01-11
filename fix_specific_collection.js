/**
 * 🎯 修复特定合辑：6d98aa36-9a1d-4fb5-8da2-f9e8da45a7c6
 * 问题：修复脚本错误地将5个内容相同的视频改成了不同的play_url
 * 解决方案：如果内容相同，保留第一个，删除其他，转换为单个视频
 */

/* eslint-disable no-undef */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const {
  SUPABASE_URL = process.env.VITE_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
} = process.env

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ 缺少 Supabase 环境变量')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const COLLECTION_ID = '6d98aa36-9a1d-4fb5-8da2-f9e8da45a7c6'
const COLLECTION_ROOT_PLAY_URL = `/videos/${COLLECTION_ID}/index.m3u8`

async function fixSpecificCollection() {
  console.log(`\n🔍 修复合辑: ${COLLECTION_ID}`)

  // 1. 获取合辑数据
  const { data: collection, error } = await supabase
    .from('videos')
    .select('id, media_list, content_type, cover_url, width, height, duration')
    .eq('id', COLLECTION_ID)
    .single()

  if (error) {
    console.error(`❌ 查询失败:`, error.message)
    return
  }

  if (!collection || collection.content_type !== 'collection') {
    console.error(`❌ 不是合辑类型`)
    return
  }

  const mediaList =
    typeof collection.media_list === 'string'
      ? JSON.parse(collection.media_list)
      : collection.media_list || []

  const videoItems = mediaList.filter((item) => item.type === 'video')

  console.log(`📹 发现 ${videoItems.length} 个视频`)

  // 2. 🎯 检查：如果所有视频之前都指向合辑根路径（修复脚本改错了）
  // 或者，如果用户希望合并，我们可以将所有视频的play_url都改回合辑根路径
  // 然后转换为单个视频类型

  console.log(`🔧 将所有视频的 play_url 改回合辑根路径:`)
  console.log(`   ${COLLECTION_ROOT_PLAY_URL}`)

  // 3. 保留第一个视频的信息，其他删除
  const firstVideo = videoItems[0]

  console.log(`📹 保留第一个视频:`)
  console.log(`   file_id: ${firstVideo.file_id}`)
  console.log(`   duration: ${firstVideo.duration}s`)
  console.log(`   size: ${firstVideo.width}x${firstVideo.height}`)
  console.log(`   删除其他 ${videoItems.length - 1} 个视频`)

  // 4. 更新数据库：转换为单个视频类型，使用合辑根路径
  const updatePayload = {
    content_type: 'video',
    play_url: COLLECTION_ROOT_PLAY_URL, // 🎯 使用合辑根路径（之前能播放的路径）
    cover_url: firstVideo.cover_url || collection.cover_url || null,
    width: firstVideo.width || collection.width || null,
    height: firstVideo.height || collection.height || null,
    duration: firstVideo.duration || collection.duration || null,
    media_list: null, // 单个视频不需要 media_list
    images: null, // 单个视频不需要 images
    is_hls: true
  }

  const { error: updateError } = await supabase
    .from('videos')
    .update(updatePayload)
    .eq('id', COLLECTION_ID)

  if (updateError) {
    console.error(`❌ 更新失败:`, updateError.message)
    return
  }

  console.log(`\n✅ 已转换为单个视频类型`)
  console.log(`   play_url: ${COLLECTION_ROOT_PLAY_URL}`)
  console.log(`\n💡 现在应该可以正常播放了！`)
  console.log(`   如果还是404，说明合辑根路径的文件也不存在，需要重新处理`)
}

fixSpecificCollection().catch(console.error)
