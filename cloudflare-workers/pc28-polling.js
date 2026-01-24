/**
 * PC28 轮询 Cloudflare Worker
 * 使用 Cron Triggers 每5秒执行一次
 */

const SUPABASE_EDGE_FUNCTION_URL =
  'https://zhlkanxfucnsatafeqdp.supabase.co/functions/v1/pc28-auto-processor'

export default {
  /**
   * Cron Trigger 处理函数
   * 每5秒执行一次
   */
  async scheduled(event, env) {
    const cronSecret = env.CRON_SECRET

    try {
      console.log('[PC28-Poll] Starting polling at', new Date().toISOString())

      // 调用 Supabase Edge Function
      const response = await fetch(SUPABASE_EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Poll-Type': 'fast',
          'X-Trigger-Source': 'cloudflare-cron',
          // 如果设置了 CRON_SECRET，添加到 header 中用于验证
          ...(cronSecret && { 'X-Cron-Secret': cronSecret })
        },
        body: JSON.stringify({
          trigger_source: 'cloudflare-cron',
          timestamp: Date.now(),
          cron: event.cron
        })
      })

      if (!response.ok) {
        const text = await response.text()
        console.error('[PC28-Poll] Edge Function error:', response.status, text)
        return
      }

      const result = await response.json()
      console.log('[PC28-Poll] Success:', result)
    } catch (error) {
      console.error('[PC28-Poll] Error:', error)
    }
  }
}
