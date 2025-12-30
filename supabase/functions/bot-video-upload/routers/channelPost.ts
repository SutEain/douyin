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
      .select('user_id, is_adult, is_sea, profiles(id, tg_user_id)')
      .eq('id', channelId)
      .eq('sync_enabled', true)
      .single()

    if (qErr || !channel) {
      console.log(`[ChannelSync] 频道未绑定或已关闭同步，忽略。chat_id=${channelId}`)
      return
    }

    const ownerUserId = channel.user_id
    const ownerTgChatId = (channel.profiles as any)?.tg_user_id
    const extraData = {
      is_adult: channel.is_adult,
      is_sea: channel.is_sea
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
        return
      }

      await handleVideo(ownerTgChatId, post.video, post.caption, mockFrom, undefined, extraData)

      await sendMessage(
        ownerTgChatId,
        `同步成功 📢：检测到您的频道发布了新视频，已自动搬运至草稿箱。`
      )
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

      if (!post.media_group_id) {
        await sendMessage(
          ownerTgChatId,
          `同步成功 📢：检测到您的频道发布了新图片，已自动搬运至草稿箱。`
        )
      }
    } else {
      console.log(`[ChannelSync] 非搬运类型消息，跳过。`)
    }
  } catch (error) {
    console.error(`[ChannelSync] 搬运失败:`, error)
  }
}
