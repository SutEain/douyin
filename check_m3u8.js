/**
 * 检查当前播放列表的 M3U8 文件，查看切片时长
 */

const STREAM_ID = 'playlist_short_drama_1768939177982'
const M3U8_URL = `http://207.148.125.25:5080/LiveApp/streams/${STREAM_ID}.m3u8`

async function checkM3U8() {
  try {
    console.log('🔍 检查 M3U8 文件...')
    console.log(`📍 URL: ${M3U8_URL}\n`)
    
    const response = await fetch(M3U8_URL)
    if (!response.ok) {
      console.error(`❌ 无法获取 M3U8 文件: ${response.status}`)
      return
    }
    
    const content = await response.text()
    const lines = content.split('\n')
    
    console.log('📄 M3U8 文件内容（前30行）:')
    console.log(lines.slice(0, 30).join('\n'))
    console.log('\n')
    
    // 分析切片时长
    const extinfLines = lines.filter(line => line.startsWith('#EXTINF:'))
    if (extinfLines.length > 0) {
      const durations = extinfLines.map(line => {
        const match = line.match(/#EXTINF:([\d.]+)/)
        return match ? parseFloat(match[1]) : 0
      })
      
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length
      const minDuration = Math.min(...durations)
      const maxDuration = Math.max(...durations)
      
      console.log('📊 切片时长分析:')
      console.log(`  - 切片数量: ${extinfLines.length}`)
      console.log(`  - 平均时长: ${avgDuration.toFixed(2)} 秒`)
      console.log(`  - 最小时长: ${minDuration.toFixed(2)} 秒`)
      console.log(`  - 最大时长: ${maxDuration.toFixed(2)} 秒`)
      
      if (avgDuration >= 4.5) {
        console.log('\n⚠️  警告: 切片时长过长（>=4.5秒），可能导致卡顿和跳秒')
        console.log('   建议: 在 Ant Media Server 配置中将 Segment Duration 改为 2')
      } else if (avgDuration >= 2.5) {
        console.log('\n⚠️  警告: 切片时长较长（>=2.5秒），可能导致轻微跳秒')
        console.log('   建议: 在 Ant Media Server 配置中将 Segment Duration 改为 2')
      } else if (avgDuration >= 1.5 && avgDuration <= 2.5) {
        console.log('\n✅ 切片时长正常（1.5-2.5秒），配置合理')
      } else {
        console.log('\n✅ 切片时长较短（<1.5秒），配置良好')
      }
    } else {
      console.log('⚠️  未找到 #EXTINF 标签')
    }
    
  } catch (err) {
    console.error('❌ 错误:', err.message)
  }
}

checkM3U8()
