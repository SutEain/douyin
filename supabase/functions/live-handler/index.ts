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
      .select('live_status, numeric_id, nickname, username')
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
        const oldStreamKey = existingRoom.stream_key;
        let finalStreamKey = oldStreamKey; // 最终要使用的 Key
        const newTitle = title || existingRoom.title;

        // 1. 如果是刷新操作，【必须先删除】AMS 上的旧记录
        if (action === 'refresh') {
          try {
            const deleteUrl = `http://${existingRoom.node.ip_address}:5080/LiveApp/rest/v2/broadcasts/${oldStreamKey}`
            await fetch(deleteUrl, { method: 'DELETE' })
            console.log(`[live-handler] 1. Deleted old AMS broadcast: ${oldStreamKey}`)
          } catch (err) {
            console.warn('[live-handler] Delete old AMS failed:', err)
          }
          
          // 删除旧的后，再生成新的
          finalStreamKey = generateKey();
        }

        // 2. 无论刷新（新建）还是单纯改名（同步），都通知 AMS
        // 注意：AMS 的 /create 接口，ID 不存在则创建，存在则更新
        if (action === 'refresh' || (title && title !== existingRoom.title)) {
          try {
            const amApiUrl = `http://${existingRoom.node.ip_address}:5080/LiveApp/rest/v2/broadcasts/create`
            await fetch(amApiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                streamId: finalStreamKey,
                name: newTitle,
                type: 'liveStream',
                publish: true
              })
            })
            console.log(`[live-handler] 2. Created/Synced on AMS: ${finalStreamKey} (${newTitle})`)
          } catch (err) {
            console.error('[live-handler] AMS Sync failed:', err)
          }
        }

        // 3. 最后一步：更新本地数据库
        await supabase
          .from('live_broadcast_rooms')
          .update({ 
            stream_key: finalStreamKey, 
            status: 'pending',
            title: newTitle
          })
          .eq('id', existingRoom.id)

        // 🎯 发送开播通知 (增加 1 小时冷却)
        const lastNotified = existingRoom.last_notified_at ? new Date(existingRoom.last_notified_at).getTime() : 0
        if (action === 'start' && Date.now() - lastNotified > 60 * 60 * 1000) {
          edgeNotifyFollowersLive(
            supabase,
            userId,
            profile.nickname || profile.username || String(profile.numeric_id),
            newTitle
          ).then(async () => {
            await supabase.from('live_broadcast_rooms').update({ last_notified_at: new Date().toISOString() }).eq('id', existingRoom.id)
          }).catch(err => console.error('[live-handler] Notify followers failed:', err))
        }

        return new Response(
          JSON.stringify({
            rtmp_url: `rtmp://${existingRoom.node.ip_address}/LiveApp`,
            stream_key: finalStreamKey,
            playback_url: `https://${existingRoom.node.domain_name}/LiveApp/streams/${finalStreamKey}.m3u8`,
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

      // 🎯 发送开播通知
      edgeNotifyFollowersLive(
        supabase,
        userId,
        profile.nickname || profile.username || String(profile.numeric_id),
        title || '精彩直播'
      ).then(async () => {
        await supabase.from('live_broadcast_rooms').update({ last_notified_at: new Date().toISOString() }).eq('id', room.id)
      }).catch(err => console.error('[live-handler] Notify followers failed:', err))

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

      // 🎯 获取房间信息以便同步删除 AMS 上的记录
      const { data: room } = await supabase
        .from('live_broadcast_rooms')
        .select('*, node:live_broadcast_nodes(ip_address)')
        .eq('id', roomId)
        .single()

      if (room) {
        // 1. 删除 AMS 上的直播间记录
        try {
          const deleteUrl = `http://${room.node.ip_address}:5080/LiveApp/rest/v2/broadcasts/${room.stream_key}`
          await fetch(deleteUrl, { method: 'DELETE' })
          console.log(`[live-handler] Deleted AMS broadcast on end: ${room.stream_key}`)
        } catch (err) {
          console.warn('[live-handler] Delete AMS broadcast failed on end:', err)
        }

        // 2. 更新数据库状态
        await supabase
          .from('live_broadcast_rooms')
          .update({ status: 'ended', ended_at: new Date().toISOString() })
          .eq('id', roomId)

        // 3. 减少节点流计数
        if (room.node_id) {
          await supabase.rpc('decrement_node_streams', { node_id: room.node_id })
        }
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

/**
 * 🎯 通知粉丝开播 (Edge Function 内部版本)
 */
async function edgeNotifyFollowersLive(
  supabase: any,
  authorId: string,
  authorNickname: string,
  liveTitle: string
) {
  const TG_BOT_TOKEN = Deno.env.get('TG_BOT_TOKEN')
  const TG_BOT_USERNAME = Deno.env.get('TG_BOT_USERNAME') || 'dydy'
  const TG_APP_NAME = Deno.env.get('TG_APP_NAME') || 'tgdouyin'

  if (!TG_BOT_TOKEN) return

  // 1. 查询粉丝
  const { data: followers } = await supabase
    .from('follows')
    .select(`
      follower:profiles!follows_follower_id_fkey(
        tg_user_id,
        notification_settings
      )
    `)
    .eq('followee_id', authorId)

  if (!followers || followers.length === 0) return

  const message = `🔴 <b>${authorNickname}</b> 正在直播：\n\n${liveTitle}`
  const deepLink = `https://t.me/${TG_BOT_USERNAME}/${TG_APP_NAME}?startapp=live_${authorId}`

  // 2. 批量发送
  const promises = followers.map(async (f: any) => {
    const p = f.follower
    if (!p?.tg_user_id) return

    // 检查设置
    const settings = p.notification_settings || {}
    const typeSetting = settings['new_live'] || { mute_until: 0 }
    if (typeSetting.mute_until === -1 || typeSetting.mute_until > Date.now()) return

    try {
      await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: p.tg_user_id,
          text: message,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '👉 立即进入直播间', url: deepLink }]]
          }
        })
      })
    } catch { /* ignore */ }
  })

  await Promise.allSettled(promises)
}
