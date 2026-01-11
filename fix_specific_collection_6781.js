/**
 * 🎯 修复特定合辑：6781b6b1-1637-448a-8974-bd24a70f9b52
 * 问题：所有视频的play_url都指向合辑根路径，但可能文件不存在
 * 解决方案：检查并修复
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

const COLLECTION_ID = '6781b6b1-1637-448a-8974-bd24a70f9b52'
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

  const mediaList =
    typeof collection.media_list === 'string'
      ? JSON.parse(collection.media_list)
      : collection.media_list || []

  const videoItems = mediaList.filter((item) => item.type === 'video')

  console.log(`📹 发现 ${videoItems.length} 个视频`)

  // 2. 检查所有视频的 play_url
  const allPointToRoot = videoItems.every((item) => item.play_url === COLLECTION_ROOT_PLAY_URL)

  console.log(`📊 所有视频都指向合辑根路径: ${allPointToRoot}`)

  if (allPointToRoot) {
    console.log(`\n💡 情况分析:`)
    console.log(`   - 所有视频的 play_url 都已改回合辑根路径`)
    console.log(`   - 如果播放404，说明合辑根路径的文件不存在`)
    console.log(`   - 需要检查 R2 存储中是否存在该文件`)
    console.log(`\n🔧 当前状态:`)
    console.log(`   - content_type: ${collection.content_type}`)
    console.log(`   - 视频数量: ${videoItems.length}`)
    console.log(`   - play_url: ${COLLECTION_ROOT_PLAY_URL}`)
    console.log(`\n⚠️  如果文件不存在，需要:`)
    console.log(`   1. 从 Telegram 重新下载这些视频`)
    console.log(`   2. 或者检查是否有备份文件`)
    console.log(`   3. 或者将这些视频从合辑中移除`)
  } else {
    console.log(`\n🔧 修复中...`)

    // 将所有视频的 play_url 改回合辑根路径
    for (const item of videoItems) {
      if (item.play_url !== COLLECTION_ROOT_PLAY_URL) {
        console.log(`  修复: ${item.file_id}`)
        console.log(`    旧: ${item.play_url}`)
        console.log(`    新: ${COLLECTION_ROOT_PLAY_URL}`)
        item.play_url = COLLECTION_ROOT_PLAY_URL
      }
    }

    // 更新数据库
    const { error: updateError } = await supabase
      .from('videos')
      .update({
        media_list: mediaList,
        images: mediaList
      })
      .eq('id', COLLECTION_ID)

    if (updateError) {
      console.error(`❌ 更新失败:`, updateError.message)
      return
    }

    console.log(`\n✅ 已修复所有视频的 play_url`)
  }
}

fixSpecificCollection().catch(console.error)
