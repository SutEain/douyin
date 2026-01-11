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
// 🎯 修复脚本需要使用 SERVICE_ROLE_KEY 才能绕过 RLS 策略
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ 缺少 Supabase 环境变量')
  console.error('   需要设置: SUPABASE_URL 或 VITE_SUPABASE_URL')
  console.error('   推荐使用: SUPABASE_SERVICE_ROLE_KEY（修复脚本需要管理员权限）')
  console.error('   当前环境变量:', {
    SUPABASE_URL: process.env.SUPABASE_URL ? '已设置' : '未设置',
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ? '已设置' : '未设置',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? '已设置' : '未设置',
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ? '已设置' : '未设置'
  })
  process.exit(1)
}

// 🎯 检查是否使用了 SERVICE_ROLE_KEY
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️  警告: 未使用 SUPABASE_SERVICE_ROLE_KEY，可能无法绕过 RLS 策略')
  console.warn('   如果遇到权限错误，请设置 SUPABASE_SERVICE_ROLE_KEY 环境变量')
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
 * 检测并删除重复的视频
 * 🎯 改进：不仅基于 play_url，还基于内容特征（duration、width、height、file_size）判断重复
 */
function removeDuplicateVideos(mediaList) {
  const videoItems = mediaList.filter((item) => item.type === 'video')

  // 🎯 按内容特征分组（duration、width、height、file_size）
  // 如果这些值都相同，认为是重复视频
  const contentMap = new Map()

  for (const item of videoItems) {
    // 构建内容特征key
    const contentKey = JSON.stringify({
      duration: item.duration || null,
      width: item.width || null,
      height: item.height || null,
      file_size: item.file_size || null,
      play_url: item.play_url || null // 也包含 play_url，如果相同则更确定是重复
    })

    if (!contentMap.has(contentKey)) {
      contentMap.set(contentKey, [])
    }
    contentMap.get(contentKey).push(item)
  }

  // 找出重复的内容
  const duplicates = []
  for (const [contentKey, items] of contentMap.entries()) {
    if (items.length > 1) {
      duplicates.push({ contentKey, items })
    }
  }

  if (duplicates.length === 0) {
    return { mediaList, removedCount: 0 }
  }

  // 🎯 删除重复项，只保留第一个
  // 如果所有视频的 play_url 都相同（比如都指向合辑根路径），保留第一个，删除其他的
  let removedCount = 0
  const seenContentKeys = new Set()
  const newMediaList = mediaList.filter((item) => {
    if (item.type === 'video') {
      const contentKey = JSON.stringify({
        duration: item.duration || null,
        width: item.width || null,
        height: item.height || null,
        file_size: item.file_size || null,
        play_url: item.play_url || null
      })

      if (seenContentKeys.has(contentKey)) {
        removedCount++
        return false // 删除重复项
      }
      seenContentKeys.add(contentKey)
    }
    return true
  })

  return { mediaList: newMediaList, removedCount }
}

/**
 * 修复单个合辑的 play_url
 */
async function fixCollectionPlayUrls(collection) {
  const { id, media_list, cover_url, width, height, duration } = collection

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

    // 1. 🎯 先检查：如果所有视频的 play_url 都指向合辑根路径（或都指向不存在的路径）
    // 且内容特征相同，应该合并为1个视频，使用合辑根路径
    const allPointToRoot = videoItems.every(
      (item) => !item.play_url || isCollectionRootPath(item.play_url, id)
    )

    // 检查内容特征是否相同（允许小的差异，比如duration可能略有不同）
    const contentKeys = new Set()
    for (const item of videoItems) {
      const key = JSON.stringify({
        duration: item.duration || null,
        width: item.width || null,
        height: item.height || null,
        file_size: item.file_size || null
      })
      contentKeys.add(key)
    }

    // 🎯 如果所有视频都指向根路径（或没有play_url），且内容相同，合并为1个视频
    if (allPointToRoot && contentKeys.size === 1 && videoItems.length > 1) {
      console.log(`  🔄 [${id}] 所有视频内容相同且都指向合辑根路径，合并为1个视频`)
      const firstVideo = videoItems[0]
      const collectionRootPlayUrl = `/videos/${id}/index.m3u8`

      // 转换为单个视频类型
      const updatePayload = {
        content_type: 'video',
        play_url: collectionRootPlayUrl,
        cover_url: firstVideo.cover_url || cover_url || null,
        width: firstVideo.width || width || null,
        height: firstVideo.height || height || null,
        duration: firstVideo.duration || duration || null,
        media_list: null,
        images: null,
        is_hls: true
      }

      const { error } = await supabase.from('videos').update(updatePayload).eq('id', id)
      if (error) {
        console.error(`  ❌ [${id}] 转换为视频类型失败:`, error.message)
        return { fixed: false, reason: 'db_error', error: error.message }
      }

      console.log(`  ✅ [${id}] 已合并为单个视频类型（删除了 ${videoItems.length - 1} 个重复视频）`)
      return {
        fixed: true,
        converted: true,
        fixedCount: videoItems.length - 1,
        removedCount: videoItems.length - 1
      }
    }

    // 🎯 如果所有视频的 play_url 都指向错误的路径（修复脚本改错的），统一改回合辑根路径
    // 检查是否所有 play_url 都包含合辑ID但指向不存在的文件路径（修复脚本改错的格式）
    const allHaveWrongPaths = videoItems.every(
      (item) =>
        item.play_url &&
        item.play_url.includes(`/videos/${id}/`) &&
        !isCollectionRootPath(item.play_url, id) &&
        item.play_url.includes('/index.m3u8')
    )

    if (allHaveWrongPaths && videoItems.length > 0) {
      console.log(`  🔧 [${id}] 所有视频的play_url都指向错误路径，统一改回合辑根路径`)
      const collectionRootPlayUrl = `/videos/${id}/index.m3u8`

      // 将所有视频的 play_url 改回合辑根路径
      // 🎯 重要：需要同时更新 mediaList 中的对应项
      for (let i = 0; i < mediaList.length; i++) {
        const item = mediaList[i]
        if (item.type === 'video' && item.play_url && item.play_url !== collectionRootPlayUrl) {
          console.log(`     修复: ${item.file_id}`)
          console.log(`       旧: ${item.play_url}`)
          console.log(`       新: ${collectionRootPlayUrl}`)
          mediaList[i].play_url = collectionRootPlayUrl
          fixed = true
          fixedCount++
        }
      }

      // 更新 media_list
      if (fixed) {
        // 🎯 检查修复后，如果所有视频内容相同，应该合并为单个视频
        const contentKeys = new Set()
        for (const item of videoItems) {
          const key = JSON.stringify({
            duration: item.duration || null,
            width: item.width || null,
            height: item.height || null,
            file_size: item.file_size || null
          })
          contentKeys.add(key)
        }

        // 如果内容相同，合并为单个视频
        if (contentKeys.size === 1 && videoItems.length > 1) {
          console.log(`  🔄 [${id}] 所有视频内容相同，合并为单个视频类型`)
          const firstVideo = videoItems[0]

          const updatePayload = {
            content_type: 'video',
            play_url: collectionRootPlayUrl,
            cover_url: firstVideo.cover_url || cover_url || null,
            width: firstVideo.width || width || null,
            height: firstVideo.height || height || null,
            duration: firstVideo.duration || duration || null,
            media_list: null,
            images: null,
            is_hls: true
          }

          const { error } = await supabase.from('videos').update(updatePayload).eq('id', id)
          if (error) {
            console.error(`  ❌ [${id}] 转换为视频类型失败:`, error.message)
            return { fixed: false, reason: 'db_error', error: error.message }
          }

          console.log(
            `  ✅ [${id}] 已合并为单个视频类型（删除了 ${videoItems.length - 1} 个重复视频）`
          )
          return {
            fixed: true,
            converted: true,
            fixedCount: videoItems.length - 1,
            removedCount: videoItems.length - 1
          }
        }

        // 如果内容不同，只更新 media_list
        const { error } = await supabase
          .from('videos')
          .update({
            media_list: mediaList,
            images: mediaList
          })
          .eq('id', id)

        if (error) {
          console.error(`  ❌ [${id}] 更新失败:`, error.message)
          return { fixed: false, reason: 'db_error', error: error.message }
        }

        console.log(`  ✅ [${id}] 已修复 ${fixedCount} 个视频的 play_url`)
        return { fixed: true, fixedCount, removedCount: 0 }
      }
    }

    // 2. 🎯 删除重复的视频（基于内容特征）
    const { mediaList: deduplicatedList, removedCount } = removeDuplicateVideos(mediaList)
    if (removedCount > 0) {
      console.log(`  🗑️  [${id}] 删除了 ${removedCount} 个重复视频（基于内容特征）`)
      mediaList = deduplicatedList
      fixed = true
    }

    // 3. 检查并修复每个视频的 play_url（如果是合辑根路径，且不是重复视频）
    const remainingVideoItems = mediaList.filter((item) => item.type === 'video')
    for (const item of remainingVideoItems) {
      if (!item.file_id) {
        console.log(`  ⚠️ [${id}] 视频项缺少 file_id，跳过`)
        continue
      }

      // 🎯 如果 play_url 是合辑根路径，且合辑中还有其他视频，才需要修复
      if (isCollectionRootPath(item.play_url, id) && remainingVideoItems.length > 1) {
        const correctPlayUrl = generateCorrectPlayUrl(id, item.file_id)
        console.log(`  🔧 [${id}] 修复视频 ${item.file_id}:`)
        console.log(`     旧: ${item.play_url}`)
        console.log(`     新: ${correctPlayUrl}`)
        item.play_url = correctPlayUrl
        fixed = true
        fixedCount++
      }
    }

    // 3. 再次删除重复的视频（play_url 相同，以防修复后产生新的重复）
    const { mediaList: finalDeduplicatedList, removedCount: additionalRemovedCount } =
      removeDuplicateVideos(mediaList)
    if (additionalRemovedCount > 0) {
      console.log(`  🗑️  [${id}] 删除了额外的 ${additionalRemovedCount} 个重复视频`)
      mediaList = finalDeduplicatedList
      fixed = true
    }

    // 4. 检查修复后的视频数量
    const finalVideoItems = mediaList.filter((item) => item.type === 'video')
    const finalImageItems = mediaList.filter((item) => item.type === 'image')

    // 如果修复后只剩下1个视频，且没有图片，转换为单个视频类型
    if (finalVideoItems.length === 1 && finalImageItems.length === 0) {
      const singleVideo = finalVideoItems[0]
      console.log(`  🔄 [${id}] 合辑只剩下1个视频，转换为单个视频类型`)

      const updatePayload = {
        content_type: 'video',
        play_url: singleVideo.play_url || null,
        cover_url: singleVideo.cover_url || cover_url || null,
        width: singleVideo.width || width || null,
        height: singleVideo.height || height || null,
        duration: singleVideo.duration || duration || null,
        media_list: null, // 单个视频不需要 media_list
        images: null // 单个视频不需要 images
      }

      const { error } = await supabase.from('videos').update(updatePayload).eq('id', id)

      if (error) {
        console.error(`  ❌ [${id}] 转换为视频类型失败:`, error.message)
        return { fixed: false, reason: 'db_error', error: error.message }
      }

      console.log(`  ✅ [${id}] 已转换为单个视频类型`)
      return { fixed: true, converted: true, fixedCount, removedCount }
    }

    // 如果修复后没有视频了，标记为相册（如果还有图片）或删除
    if (finalVideoItems.length === 0) {
      if (finalImageItems.length > 0) {
        console.log(`  🔄 [${id}] 合辑没有视频了，转换为相册类型`)
        const updatePayload = {
          content_type: 'album',
          play_url: null,
          media_list: mediaList,
          images: mediaList
        }
        const { error } = await supabase.from('videos').update(updatePayload).eq('id', id)
        if (error) {
          console.error(`  ❌ [${id}] 转换为相册类型失败:`, error.message)
          return { fixed: false, reason: 'db_error', error: error.message }
        }
        console.log(`  ✅ [${id}] 已转换为相册类型`)
        return { fixed: true, converted: true, fixedCount, removedCount }
      } else {
        console.log(`  ⚠️  [${id}] 合辑没有任何媒体项，建议删除`)
        return { fixed: false, reason: 'empty_collection' }
      }
    }

    // 如果有修复但不需要转换类型，更新 media_list
    // 🎯 重要：同时清除合辑的根 play_url（合辑不应该有根 play_url）
    if (fixed) {
      const { error } = await supabase
        .from('videos')
        .update({
          media_list: mediaList,
          images: mediaList,
          play_url: null // 🎯 清除合辑的根 play_url
        })
        .eq('id', id)

      if (error) {
        console.error(`  ❌ [${id}] 更新数据库失败:`, error.message)
        return { fixed: false, reason: 'db_error', error: error.message }
      }

      console.log(
        `  ✅ [${id}] 修复完成，更新了 ${fixedCount} 个视频的 play_url，删除了 ${removedCount} 个重复视频`
      )
      return { fixed: true, fixedCount, removedCount }
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

  // 查询所有合辑（需要更多字段用于转换）
  const { data: collections, error } = await supabase
    .from('videos')
    .select('id, media_list, play_url, cover_url, width, height, duration, created_at')
    .eq('content_type', 'collection')
    .not('media_list', 'is', null)

  if (error) {
    console.error('❌ 查询合辑失败:', error)
    process.exit(1)
  }

  console.log(`📊 找到 ${collections.length} 个合辑，开始检查...\n`)

  let totalFixed = 0
  let totalConverted = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (let i = 0; i < collections.length; i++) {
    const collection = collections[i]
    console.log(`[${i + 1}/${collections.length}] 检查合辑: ${collection.id}`)

    const result = await fixCollectionPlayUrls(collection)

    if (result.fixed) {
      totalFixed++
      if (result.converted) {
        totalConverted++
      }
    } else if (result.reason === 'error' || result.reason === 'db_error') {
      totalErrors++
    } else {
      totalSkipped++
    }

    console.log('') // 空行分隔
  }

  console.log('\n📊 修复统计:')
  console.log(`  ✅ 已修复: ${totalFixed} 个合辑`)
  console.log(`  🔄 已转换: ${totalConverted} 个合辑（转换为视频/相册）`)
  console.log(`  ⏭️  跳过: ${totalSkipped} 个合辑`)
  console.log(`  ❌ 错误: ${totalErrors} 个合辑`)
  console.log(`\n✨ 修复完成！`)
}

// 运行主函数
main().catch((error) => {
  console.error('❌ 程序执行失败:', error)
  process.exit(1)
})
