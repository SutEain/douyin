/**
 * 🎯 修复合辑中所有视频 play_url 都指向同一个文件的问题
 *
 * 问题：某些合辑中，所有视频的 play_url 都被错误地设置为合辑根路径
 * 例如：/videos/{collectionId}/index.m3u8
 * 正确应该是：/videos/{collectionId}/{fileId}/index.m3u8
 *
 * 修复策略：
 * 1. 检测所有合辑中 play_url 重复的视频
 * 2. 根据 file_id 重新生成正确的 play_url
 * 3. 更新数据库中的 media_list
 */

/* eslint-disable no-undef */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ 缺少 Supabase 环境变量')
  console.error('   需要设置: SUPABASE_URL 或 VITE_SUPABASE_URL')
  console.error('   需要设置: SUPABASE_SERVICE_ROLE_KEY 或 VITE_SUPABASE_ANON_KEY')
  console.error('   当前环境变量:', {
    SUPABASE_URL: process.env.SUPABASE_URL ? '已设置' : '未设置',
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ? '已设置' : '未设置',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? '已设置' : '未设置',
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ? '已设置' : '未设置'
  })
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * 检查 play_url 是否是合辑根路径（错误的格式）
 */
function isCollectionRootPath(playUrl, collectionId) {
  if (!playUrl) return false
  // 检查是否是 /videos/{collectionId}/index.m3u8 格式（缺少 fileId）
  const rootPattern = new RegExp(`^/videos/${collectionId}/index\\.m3u8$`)
  return rootPattern.test(playUrl)
}

/**
 * 根据 file_id 生成正确的 play_url
 */
function generateCorrectPlayUrl(collectionId, fileId) {
  // 清理 file_id，移除特殊字符
  const cleanFileId = fileId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `/videos/${collectionId}/${cleanFileId}/index.m3u8`
}

/**
 * 修复单个合辑的 play_url
 */
async function fixCollectionPlayUrls(collection) {
  const { id, media_list } = collection

  try {
    let mediaList = typeof media_list === 'string' ? JSON.parse(media_list) : media_list
    if (!Array.isArray(mediaList)) {
      console.log(`  ⚠️ [${id}] media_list 格式错误，跳过`)
      return { fixed: false, reason: 'invalid_format' }
    }

    const videoItems = mediaList.filter((item) => item.type === 'video')
    if (videoItems.length === 0) {
      return { fixed: false, reason: 'no_videos' }
    }

    let fixed = false
    let fixedCount = 0

    // 检查并修复每个视频的 play_url
    for (const item of videoItems) {
      if (!item.file_id) {
        console.log(`  ⚠️ [${id}] 视频项缺少 file_id，跳过`)
        continue
      }

      // 如果 play_url 是合辑根路径（错误的格式），需要修复
      if (isCollectionRootPath(item.play_url, id)) {
        const correctPlayUrl = generateCorrectPlayUrl(id, item.file_id)
        console.log(`  🔧 [${id}] 修复视频 ${item.file_id}:`)
        console.log(`     旧: ${item.play_url}`)
        console.log(`     新: ${correctPlayUrl}`)
        item.play_url = correctPlayUrl
        fixed = true
        fixedCount++
      }
    }

    // 如果有修复，更新数据库
    if (fixed) {
      const { error } = await supabase
        .from('videos')
        .update({
          media_list: mediaList,
          images: mediaList
        })
        .eq('id', id)

      if (error) {
        console.error(`  ❌ [${id}] 更新数据库失败:`, error.message)
        return { fixed: false, reason: 'db_error', error: error.message }
      }

      console.log(`  ✅ [${id}] 修复完成，更新了 ${fixedCount} 个视频的 play_url`)
      return { fixed: true, fixedCount }
    }

    return { fixed: false, reason: 'no_fix_needed' }
  } catch (error) {
    console.error(`  ❌ [${id}] 处理失败:`, error.message)
    return { fixed: false, reason: 'error', error: error.message }
  }
}

/**
 * 主函数：修复所有有问题的合辑
 */
async function main() {
  console.log('🔍 开始扫描有问题的合辑...\n')

  // 查询所有合辑
  const { data: collections, error } = await supabase
    .from('videos')
    .select('id, media_list, created_at')
    .eq('content_type', 'collection')
    .not('media_list', 'is', null)

  if (error) {
    console.error('❌ 查询合辑失败:', error)
    process.exit(1)
  }

  console.log(`📊 找到 ${collections.length} 个合辑，开始检查...\n`)

  let totalFixed = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (let i = 0; i < collections.length; i++) {
    const collection = collections[i]
    console.log(`[${i + 1}/${collections.length}] 检查合辑: ${collection.id}`)

    const result = await fixCollectionPlayUrls(collection)

    if (result.fixed) {
      totalFixed++
    } else if (result.reason === 'error' || result.reason === 'db_error') {
      totalErrors++
    } else {
      totalSkipped++
    }

    console.log('') // 空行分隔
  }

  console.log('\n📊 修复统计:')
  console.log(`  ✅ 已修复: ${totalFixed} 个合辑`)
  console.log(`  ⏭️  跳过: ${totalSkipped} 个合辑`)
  console.log(`  ❌ 错误: ${totalErrors} 个合辑`)
  console.log(`\n✨ 修复完成！`)
}

// 运行主函数
main().catch((error) => {
  console.error('❌ 程序执行失败:', error)
  process.exit(1)
})
