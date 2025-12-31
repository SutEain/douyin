import { supabase } from '../supabaseClient.ts'
import { handlePhoto, handleVideo } from '../features/upload.ts'
import { sendMessage } from '../telegram.ts'

/**
 * 🎯 处理频道更新 (channel_post)
 * 当绑定的频道发布新内容时，此函数会被调用
 */
export async function handleChannelPost(post: any) {
  const channelId = post.chat.id
  console.log(`[ChannelSync] 收到频道消息: chat_id=${channelId}, msg_id=${post.message_id}`)

  try {
    // 1. 查询该频道是否已绑定且开启同步
    const { data: channel, error: qErr } = await supabase
      .from('bound_channels')
      .select('user_id, is_adult, is_sea, profiles(id, tg_user_id, auto_approve)')
      .eq('id', channelId)
      .eq('sync_enabled', true)
      .single()

    if (qErr || !channel) {
      console.log(`[ChannelSync] 频道未绑定或已关闭同步，忽略。chat_id=${channelId}`)
      return
    }

    const profile = channel.profiles as any
    const ownerUserId = channel.user_id
    const ownerTgChatId = profile?.tg_user_id
    const autoApprove = profile?.auto_approve === true

    // 🎯 根据用户免审核状态决定初始状态
    // 如果免审核，直接设为 published；否则设为 ready（待后台审核）
    const initialStatus = autoApprove ? ('published' as const) : ('ready' as const)

    const extraData = {
      is_adult: channel.is_adult,
      is_sea: channel.is_sea,
      status: initialStatus
    }

    // 2. 识别内容类型并调用上传逻辑
    // 注意：频道消息没有 message.from，我们需要模拟一个 from 对象，用于 handleVideo/handlePhoto 内部逻辑
    const mockFrom = {
      id: ownerTgChatId,
      is_bot: false,
      first_name: 'ChannelSync'
    }

    if (post.video) {
      // 🎯 视频搬运逻辑
      console.log(`[ChannelSync] 发现视频，开始搬运...`)

      // 检查媒体组（频道同步暂不支持多视频/混合组，handleVideo 会处理拒绝逻辑）
      if (post.media_group_id) {
        console.log(`[ChannelSync] 视频属于媒体组，暂不支持频道多媒体搬运，跳过。`)
        await sendMessage(
          ownerTgChatId,
          `📢 频道同步通知：检测到您的频道发布了多视频内容，已跳过搬运。目前仅支持单视频自动发布。`
        )
        return
      }

      await handleVideo(ownerTgChatId, post.video, post.caption, mockFrom, undefined, extraData)
      // 🎯 通知逻辑已移至 app.ts (WorkerCallback) 处理，确保视频处理完再通知
    } else if (post.photo) {
      // 🎯 图片/相册搬运逻辑
      console.log(`[ChannelSync] 发现图片/相册，开始搬运...`)

      await handlePhoto(
        ownerTgChatId,
        post.photo,
        post.caption,
        mockFrom,
        post.media_group_id,
        extraData
      )
      // 🎯 通知逻辑已移至 handlePhoto 内部处理 (单图直接发，相册延时发)
    } else {
      console.log(`[ChannelSync] 非搬运类型消息，跳过。`)
    }
  } catch (error) {
    console.error(`[ChannelSync] 搬运失败:`, error)
  }
}
