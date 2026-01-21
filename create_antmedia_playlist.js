/**
 * 通过 Ant Media Server API 创建播放列表
 * 将用户 10000 和 10003 的短剧视频添加到播放列表
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const VIDEO_BASE_URL = process.env.VIDEO_BASE_URL || 'https://media.tgdouyin.com'
// Ant Media Server 配置（从数据库获取或手动配置）
const ANT_MEDIA_SERVER_IP = process.env.ANT_MEDIA_SERVER_IP || '207.148.125.25'
const ANT_MEDIA_SERVER_PORT = process.env.ANT_MEDIA_SERVER_PORT || '5080'
const ANT_MEDIA_SERVER_APP = process.env.ANT_MEDIA_SERVER_APP || 'LiveApp'
const ANT_MEDIA_SERVER_URL = `http://${ANT_MEDIA_SERVER_IP}:${ANT_MEDIA_SERVER_PORT}/${ANT_MEDIA_SERVER_APP}`

// 检查必要的环境变量
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 请设置环境变量: SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// 创建 Supabase 客户端
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function createPlaylist() {
  try {
    // 1. 先查询用户 10000 和 10003 的用户ID
    console.log('📋 查询用户信息...')
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

    // 2. 查询这些用户的短剧视频
    console.log('📋 查询短剧视频...')
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, play_url, storage_type, is_hls, author_id')
      .in('author_id', userIds)
      .eq('content_type', 'video')
      .eq('status', 'published')
      .eq('storage_type', 'r2')
      .eq('is_hls', true)
      .contains('tags', ['擦边短剧'])
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

    // 2. 构建播放列表项
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

    // 3. 调用 Ant Media Server API 创建播放列表
    const streamId = `playlist_short_drama_${Date.now()}`
    
    // 根据错误信息，正确的字段名是 playListItemList
    const playlistData = {
      streamId: streamId,
      name: '短剧轮播 - 用户10000和10003',
      type: 'playlist',
      playListItemList: playlistItems,  // 正确的字段名
      playlistLoopEnabled: true  // 根据错误信息，应该是 playlistLoopEnabled 而不是 loopPlaylist
    }
    
    console.log('📋 请求数据示例（前3项）:', JSON.stringify({
      ...playlistData,
      playListItemList: playlistData.playListItemList.slice(0, 3)
    }, null, 2))

    console.log('🚀 调用 Ant Media Server API...')
    console.log(`📍 API URL: ${ANT_MEDIA_SERVER_URL}/rest/v2/broadcasts/create`)
    console.log(`📦 播放列表项数量: ${playlistItems.length}`)
    
    const response = await fetch(`${ANT_MEDIA_SERVER_URL}/rest/v2/broadcasts/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(playlistData)
    })

    // 先获取原始响应文本
    const responseText = await response.text()
    console.log('📄 原始响应:', responseText.substring(0, 500))

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

    console.log('✅ 播放列表创建成功!')
    console.log('📊 播放列表信息:', JSON.stringify(result, null, 2))
    console.log(`\n🎬 播放列表 Stream ID: ${result.streamId || playlistData.streamId}`)
    console.log(`📺 播放地址: ${ANT_MEDIA_SERVER_URL.replace('/rest/v2', '')}/streams/${result.streamId || playlistData.streamId}.m3u8`)

  } catch (err) {
    console.error('❌ 错误:', err)
  }
}

// 执行
createPlaylist()
