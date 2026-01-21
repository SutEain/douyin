import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SECRET_KEY') ?? ''
  )

  try {
    // Ant Media Webhook 会发送推流信息
    const body = await req.json()
    const { id, action, streamId } = body
    const finalId = id || streamId // 兼容不同版本的字段名

    console.log(`[live-auth] Received Webhook - Action: ${action}, StreamKey: ${finalId}`)

    // 1. 开始推流信号 (兼容多种命名)
    if (action === 'on_publish' || action === 'liveStreamStarted') {
      const { data: room, error } = await supabase
        .from('live_broadcast_rooms')
        .select('id, status')
        .eq('stream_key', finalId)
        .single()

      if (error || !room) {
        console.error(`[live-auth] Unauthorized push attempt: ${finalId}`)
        return new Response('Unauthorized', { status: 401 })
      }

      // 更新状态为 live（以防手动修改过）
      await supabase.from('live_broadcast_rooms').update({ status: 'live' }).eq('id', room.id)

      console.log(`[live-auth] Authorized: ${finalId}`)
      return new Response('OK', { status: 200 })
    }

    // 2. 停止推流信号 (兼容多种命名)
    if (action === 'on_publish_done' || action === 'liveStreamEnded') {
      console.log(`[live-auth] Stream ended: ${finalId}`)
      const { data: room } = await supabase
        .from('live_broadcast_rooms')
        .update({
          status: 'ended',
          ended_at: new Date().toISOString()
        })
        .eq('stream_key', finalId)
        .select('node_id')
        .single()

      if (room?.node_id) {
        await supabase.rpc('decrement_node_streams', { node_id: room.node_id })
      }
    }

    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error('[live-auth] Error:', error.message)
    // 出错时默认允许（防误伤）或拒绝（高安全），建议初期返回 200
    return new Response('OK', { status: 200 })
  }
})
