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

    // 4. 更新邀请人统计和解锁状态
    const newCount = (inviter.invite_success_count || 0) + 1

    // 从 system_settings 获取奖励金额
    const { data: setting } = await supabase
      .from('system_settings')
      .select('value_int')
      .eq('id', 'invitation_reward_coins')
      .maybeSingle()

    const rewardCoins = setting?.value_int ?? 10 // 默认 10 抖币

    const { data: updatedInviter } = await supabase
      .from('profiles')
      .update({
        balance_coins: (inviter.balance_coins || 0) + rewardCoins
      })
      .eq('id', inviter.id)
      .select('balance_coins')
      .single()

    const updates: any = { invite_success_count: newCount }

    // 记录流水
    await supabase.from('coin_transactions').insert({
      user_id: inviter.id,
      amount: rewardCoins,
      balance_after: updatedInviter?.balance_coins || 0,
      type: 'reward',
      description: `成功邀请新用户奖励`,
      related_id: inviteeId
    })

    if (newCount >= 3) {
      updates.adult_permanent_unlock = true
      updates.adult_unlock_until = null
    } else {
      let durationHours = 0
      if (newCount === 1) durationHours = 24
      if (newCount === 2) durationHours = 72 // 3天

      if (!inviter.adult_permanent_unlock) {
        const currentUnlock = inviter.adult_unlock_until
          ? new Date(inviter.adult_unlock_until).getTime()
          : Date.now()
        const baseTime = Math.max(currentUnlock, Date.now())
        updates.adult_unlock_until = new Date(baseTime + durationHours * 3600 * 1000).toISOString()
      }
    }

    await supabase.from('profiles').update(updates).eq('id', inviter.id)

    // 5. 通知邀请人
    const { data: inviterProfile } = await supabase
      .from('profiles')
      .select('tg_user_id')
      .eq('id', inviter.id)
      .single()

    if (inviterProfile?.tg_user_id) {
      let rewardText = ''
      if (newCount === 1) rewardText = '获得 24小时 无限刷'
      else if (newCount === 2) rewardText = '获得 3天 无限刷'
      else if (newCount >= 3) rewardText = '获得 永久 无限刷'

      await sendMessage(
        inviterProfile.tg_user_id,
        `🎉 <b>邀请成功！</b>\n\n` +
          `您已成功邀请 ${newCount} 人\n` +
          `🎁 ${rewardText}\n` +
          `💰 获得 10 抖币奖励！\n\n` +
          `继续邀请可获得更多奖励！`
      )
    }

    console.log('[handleInvitation] 邀请处理完成')
  } catch (error) {
    console.error('[handleInvitation] 异常:', error)
  }
}
