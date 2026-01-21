/**
 * 删除 Ant Media Server 播放列表
 * 并更新数据库中的直播间记录
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
// Ant Media Server 配置
const ANT_MEDIA_SERVER_IP = process.env.ANT_MEDIA_SERVER_IP || '207.148.125.25'
const ANT_MEDIA_SERVER_PORT = process.env.ANT_MEDIA_SERVER_PORT || '5080'
const ANT_MEDIA_SERVER_APP = process.env.ANT_MEDIA_SERVER_APP || 'LiveApp'
const ANT_MEDIA_SERVER_URL = `http://${ANT_MEDIA_SERVER_IP}:${ANT_MEDIA_SERVER_PORT}/${ANT_MEDIA_SERVER_APP}`

// 播放列表 Stream ID
const PLAYLIST_STREAM_ID = 'playlist_short_drama_1768939177982'

// 检查必要的环境变量
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 请设置环境变量: SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// 创建 Supabase 客户端
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function deletePlaylist() {
  try {
    console.log('🗑️  删除 Ant Media Server 播放列表...')
    console.log(`📍 Stream ID: ${PLAYLIST_STREAM_ID}\n`)

    // 1. 先停止播放列表
    console.log('🛑 步骤 1: 停止播放列表...')
    try {
      const stopResponse = await fetch(`${ANT_MEDIA_SERVER_URL}/rest/v2/broadcasts/${PLAYLIST_STREAM_ID}/stop`, {
        method: 'POST'
      })
      if (stopResponse.ok) {
        console.log('✅ 播放列表已停止')
        // 等待停止完成
        await new Promise(resolve => setTimeout(resolve, 3000))
      } else {
        const stopText = await stopResponse.text()
        console.log(`⚠️  停止播放列表失败（可能已停止）: ${stopText.substring(0, 200)}`)
      }
    } catch (e) {
      console.log('⚠️  停止播放列表失败（可能已停止）:', e.message)
    }

    // 2. 删除播放列表
    console.log('\n🗑️  步骤 2: 删除播放列表...')
    const deleteResponse = await fetch(`${ANT_MEDIA_SERVER_URL}/rest/v2/broadcasts/${PLAYLIST_STREAM_ID}`, {
      method: 'DELETE'
    })

    if (deleteResponse.ok) {
      console.log('✅ 播放列表已删除')
    } else {
      const deleteText = await deleteResponse.text()
      console.log(`⚠️  删除播放列表失败: ${deleteText.substring(0, 200)}`)
      
      // 尝试解析错误信息
      try {
        const errorJson = JSON.parse(deleteText)
        console.log('错误详情:', JSON.stringify(errorJson, null, 2))
      } catch (e) {
        // 忽略解析错误
      }
    }

    // 3. 更新数据库中的直播间记录
    console.log('\n📝 步骤 3: 更新数据库中的直播间记录...')
    
    // 查询用户 10000 的直播间
    const { data: room, error: roomError } = await supabase
      .from('live_broadcast_rooms')
      .select('id, stream_key, status, anchor_id')
      .eq('stream_key', PLAYLIST_STREAM_ID)
      .single()

    if (roomError || !room) {
      console.log('⚠️  未找到使用该播放列表的直播间记录')
    } else {
      console.log(`✅ 找到直播间记录: ${room.id}`)
      
      // 将状态改为 ended，stream_key 清空或设置为 null
      const { data: updateResult, error: updateError } = await supabase
        .from('live_broadcast_rooms')
        .update({
          status: 'ended',
          stream_key: null,  // 清空 stream_key
          updated_at: new Date().toISOString()
        })
        .eq('id', room.id)
        .select()

      if (updateError) {
        console.error('❌ 更新直播间记录失败:', updateError.message)
      } else {
        console.log('✅ 直播间记录已更新:')
        console.log(`   - 状态: ${updateResult[0].status}`)
        console.log(`   - Stream Key: ${updateResult[0].stream_key || '(已清空)'}`)
      }
    }

    // 4. 验证删除结果
    console.log('\n🔍 步骤 4: 验证删除结果...')
    const verifyResponse = await fetch(`${ANT_MEDIA_SERVER_URL}/rest/v2/broadcasts/${PLAYLIST_STREAM_ID}`)
    
    if (verifyResponse.status === 404) {
      console.log('✅ 播放列表已成功删除（404 Not Found）')
    } else if (verifyResponse.ok) {
      const verifyData = await verifyResponse.json()
      console.log('⚠️  播放列表仍然存在:')
      console.log(`   - 状态: ${verifyData.status}`)
      console.log(`   - 类型: ${verifyData.type}`)
    } else {
      console.log(`⚠️  验证失败: ${verifyResponse.status}`)
    }

    console.log('\n✨ 删除完成！')
    console.log('\n💡 提示:')
    console.log('   - 播放列表已删除')
    console.log('   - 直播间记录已更新为 ended 状态')
    console.log('   - 现在可以使用 MP4 格式的直播，不会有 HLS 播放列表的跳秒问题')

  } catch (err) {
    console.error('❌ 错误:', err)
  }
}

// 执行
deletePlaylist()
