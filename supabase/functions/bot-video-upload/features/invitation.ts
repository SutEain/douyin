import { supabase } from '../supabaseClient.ts'
import { sendMessage } from '../telegram.ts'

// 处理邀请逻辑
export async function handleInvitation(inviteeId: string, inviterNumericId: number) {
  try {
    console.log(`[handleInvitation] 开始处理邀请: invitee=${inviteeId}, code=${inviterNumericId}`)

    // 1. 查找邀请人
    const { data: inviter } = await supabase
      .from('profiles')
      .select('id, invite_success_count, adult_permanent_unlock, adult_unlock_until, balance_coins')
      .eq('numeric_id', inviterNumericId)
      .single()

    if (!inviter) {
      console.log('[handleInvitation] 邀请人不存在')
      return
    }

    if (inviter.id === inviteeId) {
      console.log('[handleInvitation] 不能邀请自己')
      return
    }

    // 2. 检查被邀请人是否已被邀请（避免重复）
    // 同时也检查 created_at 防止老用户刷量
    const { data: invitee } = await supabase
      .from('profiles')
      .select('invited_by, created_at')
      .eq('id', inviteeId)
      .single()

    if (invitee?.invited_by) {
      console.log('[handleInvitation] 该用户已被邀请过')
      return
    }

    // 🎯 限制：只有注册时间在最近 1 小时内的用户才算“新用户邀请”
    if (invitee?.created_at) {
      const createdAt = new Date(invitee.created_at).getTime()
      const now = Date.now()
      const diffMinutes = (now - createdAt) / 1000 / 60
      if (diffMinutes > 60) {
        console.log('[handleInvitation] 老用户点击邀请链接，忽略统计', diffMinutes, '分钟前注册')
        return
      }
    }

    // 3. 更新被邀请人信息
    await supabase.from('profiles').update({ invited_by: inviter.id }).eq('id', inviteeId)

    console.log('[handleInvitation] 已记录邀请关系，等待用户进入 Mini App 后发放奖励')
  } catch (error) {
    console.error('[handleInvitation] 异常:', error)
  }
}
