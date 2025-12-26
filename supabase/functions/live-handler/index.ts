import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  try {
    const { action, userId, title } = await req.json()

    // 获取用户信息确认直播权限
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('live_status, numeric_id')
      .eq('id', userId)
      .single()

    if (profileError || !profile) throw new Error('用户不存在')

    const generateKey = () =>
      `live_${profile.numeric_id}_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`

    // 1. 开始直播 / 获取密钥
    if (action === 'start' || action === 'refresh') {
      if (profile.live_status !== 2) {
        throw new Error('未获得直播权限，请先申请并通过审核')
      }

      // 检查是否已有该主播的直播间
      const { data: existingRoom } = await supabase
        .from('live_broadcast_rooms')
        .select('*, node:live_broadcast_nodes(ip_address, domain_name)')
        .eq('anchor_id', userId)
        .maybeSingle()

      if (existingRoom) {
        let streamKey = existingRoom.stream_key

        // 如果是刷新操作，生成新 Key 并在服务器更新
        if (action === 'refresh') {
          streamKey = generateKey()

          try {
            const amApiUrl = `http://${existingRoom.node.ip_address}:5080/LiveApp/rest/v2/broadcasts/create`
            await fetch(amApiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                streamId: streamKey,
                name: title || existingRoom.title,
                type: 'liveStream',
                publish: true
              })
            })
          } catch (err) {
            console.error('[live-handler] Refresh AM failed:', err)
          }

          await supabase
            .from('live_broadcast_rooms')
            .update({ stream_key: streamKey, status: 'pending' }) // 刷新后变为待播
            .eq('id', existingRoom.id)
        } else {
          // 普通获取，不改变现状，如果是 ended 则改为 pending
          if (existingRoom.status !== 'live') {
            await supabase
              .from('live_broadcast_rooms')
              .update({ status: 'pending' })
              .eq('id', existingRoom.id)
          }
        }

        return new Response(
          JSON.stringify({
            rtmp_url: `rtmp://${existingRoom.node.ip_address}/LiveApp`,
            stream_key: streamKey,
            playback_url: `https://${existingRoom.node.domain_name}/LiveApp/streams/${streamKey}.m3u8`,
            room_id: existingRoom.id
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // 自动寻找负载最低的可用节点 (仅在第一次创建房间时)
      const { data: node, error: nodeError } = await supabase
        .from('live_broadcast_nodes')
        .select('*')
        .eq('is_active', true)
        .order('current_streams', { ascending: true })
        .limit(1)
        .single()

      if (nodeError || !node) throw new Error('当前无可用直播节点')

      const streamKey = generateKey()

      // 向 Ant Media 注册
      try {
        const amApiUrl = `http://${node.ip_address}:5080/LiveApp/rest/v2/broadcasts/create`
        await fetch(amApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            streamId: streamKey,
            name: title || 'User Live',
            type: 'liveStream',
            publish: true
          })
        })
      } catch (err) {
        console.warn('[live-handler] AntMedia Register Error:', err)
      }

      const { data: room, error: roomError } = await supabase
        .from('live_broadcast_rooms')
        .insert({
          anchor_id: userId,
          node_id: node.id,
          title: title || '精彩直播',
          stream_key: streamKey,
          status: 'pending' // 初始状态为待播
        })
        .select()
        .single()

      if (roomError) throw roomError
      await supabase.rpc('increment_node_streams', { node_id: node.id })

      return new Response(
        JSON.stringify({
          rtmp_url: `rtmp://${node.ip_address}/LiveApp`,
          stream_key: streamKey,
          playback_url: `https://${node.domain_name}/LiveApp/streams/${streamKey}.m3u8`,
          room_id: room.id
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. 结束直播
    if (action === 'end') {
      const { roomId } = await req.json()

      const { data: room } = await supabase
        .from('live_broadcast_rooms')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', roomId)
        .select('node_id')
        .single()

      if (room?.node_id) {
        await supabase.rpc('decrement_node_streams', { node_id: room.node_id })
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
