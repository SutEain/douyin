/**
 * PC28 轮询 API
 * Vercel Cron Job 会调用此端点
 * 此端点会调用 Supabase Edge Function
 */

const SUPABASE_EDGE_FUNCTION_URL =
  'https://zhlkanxfucnsatafeqdp.supabase.co/functions/v1/pc28-auto-processor'

export default async function handler(req: Request): Promise<Response> {
  try {
    console.log('[PC28-Poll] Starting polling at', new Date().toISOString())

    // 调用 Supabase Edge Function
    const response = await fetch(SUPABASE_EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Poll-Type': 'fast',
        'X-Trigger-Source': 'vercel-cron'
      },
      body: JSON.stringify({
        trigger_source: 'vercel-cron',
        timestamp: Date.now()
      })
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('[PC28-Poll] Edge Function error:', response.status, text)
      return new Response(
        JSON.stringify({
          success: false,
          error: `Edge Function returned ${response.status}`
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const result = await response.json()
    console.log('[PC28-Poll] Success:', result)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'PC28 polling completed',
        result
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  } catch (error: any) {
    console.error('[PC28-Poll] Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
