/**
 * 更新 Ant Media Server 播放列表
 * 删除旧的播放列表并重新创建，应用新的 HLS 配置
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const VIDEO_BASE_URL = process.env.VIDEO_BASE_URL || 'https://media.tgdouyin.com'
// Ant Media Server 配置
const ANT_MEDIA_SERVER_IP = process.env.ANT_MEDIA_SERVER_IP || '207.148.125.25'
const ANT_MEDIA_SERVER_PORT = process.env.ANT_MEDIA_SERVER_PORT || '5080'
const ANT_MEDIA_SERVER_APP = process.env.ANT_MEDIA_SERVER_APP || 'LiveApp'
const ANT_MEDIA_SERVER_URL = `http://${ANT_MEDIA_SERVER_IP}:${ANT_MEDIA_SERVER_PORT}/${ANT_MEDIA_SERVER_APP}`

// 现有的播放列表 Stream ID
const EXISTING_STREAM_ID = 'playlist_short_drama_1768939177982'

// 检查必要的环境变量
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 请设置环境变量: SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// 创建 Supabase 客户端
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function updatePlaylist() {
  try {
    // 1. 先停止并删除旧的播放列表
    console.log('🛑 停止旧的播放列表...')
    console.log(`📍 Stream ID: ${EXISTING_STREAM_ID}`)
    
    // 先尝试停止播放列表
    try {
      const stopResponse = await fetch(`${ANT_MEDIA_SERVER_URL}/rest/v2/broadcasts/${EXISTING_STREAM_ID}/stop`, {
        method: 'POST'
      })
      if (stopResponse.ok) {
        console.log('✅ 播放列表已停止')
        // 等待停止完成
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    } catch (e) {
      console.log('⚠️  停止播放列表失败（可能已停止）:', e.message)
    }
    
    // 然后删除播放列表
    console.log('🗑️  删除旧的播放列表...')
    const deleteResponse = await fetch(`${ANT_MEDIA_SERVER_URL}/rest/v2/broadcasts/${EXISTING_STREAM_ID}`, {
      method: 'DELETE'
    })

    if (deleteResponse.ok) {
      console.log('✅ 旧播放列表已删除')
    } else {
      const deleteText = await deleteResponse.text()
      console.log(`⚠️  删除旧播放列表失败（可能不存在）: ${deleteText.substring(0, 200)}`)
    }

    // 等待一下，确保删除完成
    await new Promise(resolve => setTimeout(resolve, 3000))

    // 2. 查询用户 10000 和 10003 的用户ID
    console.log('\n📋 查询用户信息...')
    const { data: users } = await supabase
      .from('profiles')
      .select('id')
      .in('numeric_id', [10000, 10003])

    if (!users || users.length === 0) {
      console.log('⚠️ 没有找到用户 10000 或 10003')
      return
    }

    const userIds = users.map(u => u.id)
    console.log(`✅ 找到 ${userIds.length} 个用户`)

    // 3. 查询这些用户的短剧视频
    console.log('📋 查询短剧视频...')
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, play_url, storage_type, is_hls, author_id')
      .in('author_id', userIds)
      .eq('content_type', 'video')
      .eq('status', 'published')
      .eq('storage_type', 'r2')
      .eq('is_hls', true)
      .contains('tags', ['擦边短剧'])  // 查询包含"擦边短剧"标签的视频
      .order('created_at', { ascending: true })

    if (error) {
      console.error('❌ 查询失败:', error)
      return
    }

    if (!videos || videos.length === 0) {
      console.log('⚠️ 没有找到符合条件的视频')
      return
    }

    console.log(`✅ 找到 ${videos.length} 个短剧视频`)

    // 4. 构建播放列表项
    const playlistItems = videos.map((video) => {
      // 构建完整的 M3U8 URL
      let m3u8Url = video.play_url
      if (m3u8Url && !m3u8Url.startsWith('http')) {
        const base = VIDEO_BASE_URL.endsWith('/') ? VIDEO_BASE_URL.slice(0, -1) : VIDEO_BASE_URL
        m3u8Url = `${base}${m3u8Url}`
      }

      return {
        name: video.title || `视频 ${video.id.substring(0, 8)}`,
        streamUrl: m3u8Url
      }
    })

    console.log(`📝 准备创建播放列表，包含 ${playlistItems.length} 个视频`)

    // 5. 使用相同的 Stream ID 重新创建播放列表
    const playlistData = {
      streamId: EXISTING_STREAM_ID,  // 使用相同的 Stream ID
      name: '短剧轮播 - 用户10000和10003',
      type: 'playlist',
      playListItemList: playlistItems,
      playlistLoopEnabled: true
    }

    console.log('\n🚀 调用 Ant Media Server API 创建播放列表...')
    console.log(`📍 API URL: ${ANT_MEDIA_SERVER_URL}/rest/v2/broadcasts/create`)
    console.log(`📦 播放列表项数量: ${playlistItems.length}`)
    console.log(`🆔 Stream ID: ${EXISTING_STREAM_ID}`)

    const response = await fetch(`${ANT_MEDIA_SERVER_URL}/rest/v2/broadcasts/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(playlistData)
    })

    // 先获取原始响应文本
    const responseText = await response.text()
    console.log('\n📄 原始响应:', responseText.substring(0, 500))

    let result
    try {
      result = JSON.parse(responseText)
    } catch (parseError) {
      console.error('❌ JSON 解析失败:', parseError.message)
      console.error('📄 完整响应:', responseText)
      return
    }

    if (!response.ok) {
      console.error('❌ API 调用失败:')
      console.error('状态码:', response.status)
      console.error('响应:', JSON.stringify(result, null, 2))
      return
    }

    console.log('\n✅ 播放列表创建成功!')
    console.log('📊 播放列表信息:', JSON.stringify(result, null, 2))
    console.log(`\n🎬 播放列表 Stream ID: ${result.streamId || playlistData.streamId}`)
    console.log(`📺 播放地址: ${ANT_MEDIA_SERVER_URL.replace('/rest/v2', '')}/streams/${result.streamId || playlistData.streamId}.m3u8`)

    // 6. 验证 M3U8 文件，检查切片时长
    console.log('\n🔍 验证 M3U8 文件...')
    const m3u8Url = `${ANT_MEDIA_SERVER_URL.replace('/rest/v2', '')}/streams/${EXISTING_STREAM_ID}.m3u8`
    const m3u8Response = await fetch(m3u8Url)
    
    if (m3u8Response.ok) {
      const m3u8Content = await m3u8Response.text()
      const extinfMatch = m3u8Content.match(/#EXTINF:([\d.]+)/)
      if (extinfMatch) {
        const segmentDuration = parseFloat(extinfMatch[1])
        console.log(`✅ M3U8 文件已生成，切片时长: ${segmentDuration} 秒`)
        if (segmentDuration === 2) {
          console.log('✅ 配置已生效！切片时长为 2 秒')
        } else {
          console.log(`⚠️  切片时长是 ${segmentDuration} 秒，不是 2 秒。请确认 Ant Media Server 配置已修改并重启。`)
        }
      }
    } else {
      console.log('⚠️  无法获取 M3U8 文件，可能需要等待几秒钟')
    }

    console.log('\n✨ 更新完成！')
    console.log('💡 提示：如果切片时长不是 2 秒，请确认：')
    console.log('   1. Ant Media Server Web 控制台的 "Segment Duration" 已改为 2')
    console.log('   2. 已保存配置并重启了 Application')

  } catch (err) {
    console.error('❌ 错误:', err)
  }
}

// 执行
updatePlaylist()
