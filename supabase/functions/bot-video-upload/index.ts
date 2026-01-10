import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleRequest } from './app.ts'

console.log('[BOT-BOOT] Bot function started')

// 🎯 启动红包消息批量更新定时器（每5秒一次）
let isUpdating = false
async function runBatchUpdate() {
  if (isUpdating) return
  isUpdating = true

  try {
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/update-red-packets`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
        }
      }
    )

    if (!response.ok) {
      console.error('[BOT-TIMER] 批量更新失败:', response.status, response.statusText)
    }
  } catch (err) {
    console.error('[BOT-TIMER] 批量更新异常:', err)
  } finally {
    isUpdating = false
  }
}

// 每5秒执行一次批量更新
console.log('[BOT-BOOT] 启动批量更新定时器（每5秒）')
setInterval(runBatchUpdate, 5000)

serve(async (req) => {
  console.log(`[BOT-REQ] ${req.method} ${req.url}`)
  return await handleRequest(req)
})
