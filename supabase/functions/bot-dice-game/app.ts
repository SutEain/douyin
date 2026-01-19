import { supabase } from './supabaseClient.ts'
import { sendMessage } from './telegram.ts'
import { handleDiceCommand, handleJoinDiceGame, handleCancelDiceGame } from './features/diceGame.ts'
import {
  handleRpsCommand,
  handleJoinRpsGame,
  handleRpsChoice,
  handleCancelRpsRoom
} from './features/rpsGame.ts'

/**
 * 🎯 简洁版：主服务入口
 */
export async function handleRequest(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)

    // 健康检查
    if (url.pathname.includes('/health')) {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // 处理 Webhook
    if (req.method === 'POST') {
      let update: any
      try {
        update = await req.json()
      } catch (e) {
        return new Response('Invalid JSON', { status: 400 })
      }

      // 🎯 黑名单检查
      const userIdToCheck =
        update.message?.from?.id ||
        update.edited_message?.from?.id ||
        update.callback_query?.from?.id

      if (userIdToCheck) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_banned, ban_reason')
          .eq('tg_user_id', userIdToCheck)
          .maybeSingle()

        if (profile?.is_banned) {
          const targetChatId =
            update.message?.chat?.id ||
            update.edited_message?.chat?.id ||
            update.callback_query?.message?.chat?.id

          // 群组中静默处理
          if (targetChatId && targetChatId < 0) {
            return new Response('OK', { status: 200 })
          }

          // 私聊中发送提示
          if (targetChatId && targetChatId > 0) {
            const banReason = profile.ban_reason || '由于违反社区规范，您的账号已被封禁。'
            await sendMessage(targetChatId, `🚫 <b>您的账号已被封禁</b>\n\n原因: ${banReason}`)
          }

          return new Response('OK', { status: 200 })
        }
      }

      // 🎯 处理消息
      if (update.message) {
        const message = update.message
        const chatId = message.chat.id

        // 🎯 权限控制：仅接受游戏群消息
        const diceGroupId = Deno.env.get('DICE_GROUP_ID')
        if (message.chat.type !== 'private' && String(chatId) !== String(diceGroupId)) {
          return new Response('OK', { status: 200 })
        }

        // 只处理文本消息
        if (message.text) {
          const text = message.text.trim().toLowerCase()

          // 猜拳指令
          const isRpsCmd =
            text === 'cq' ||
            text.startsWith('cq ') ||
            text === '/cq' ||
            text.startsWith('/cq ') ||
            text.startsWith('/cq@')

          // 骰子指令
          const isDiceCmd =
            text === 'tz' ||
            text.startsWith('tz ') ||
            text === '/tz' ||
            text.startsWith('/tz ') ||
            text.startsWith('/tz@')

          if (isRpsCmd) {
            await handleRpsCommand(chatId, message.text, message)
            return new Response('OK', { status: 200 })
          }

          if (isDiceCmd) {
            await handleDiceCommand(chatId, message.text, message)
            return new Response('OK', { status: 200 })
          }
        }
      }

      // 🎯 处理回调查询
      else if (update.callback_query) {
        const callback = update.callback_query
        const chatId = callback.message?.chat?.id
        const messageId = callback.message?.message_id
        const data = callback.data

        // 🎯 权限控制：仅接受游戏群的回调
        const diceGroupId = Deno.env.get('DICE_GROUP_ID')
        if (callback.message?.chat?.type !== 'private' && String(chatId) !== String(diceGroupId)) {
          return new Response('OK', { status: 200 })
        }

        if (chatId && messageId && data) {
          // 猜拳游戏回调
          if (data.startsWith('rps_join_')) {
            const roomId = data.replace('rps_join_', '')
            await handleJoinRpsGame(chatId, messageId, callback.id, roomId, callback.from.id)
            return new Response('OK', { status: 200 })
          }

          if (data.startsWith('rps_cancel_')) {
            const roomId = data.replace('rps_cancel_', '')
            await handleCancelRpsRoom(chatId, messageId, callback.id, roomId, callback.from.id)
            return new Response('OK', { status: 200 })
          }

          if (data.startsWith('rps_choice_')) {
            const parts = data.replace('rps_choice_', '').split('_')
            if (parts.length >= 2) {
              const choice = parts.pop()
              const roomId = parts.join('_')
              await handleRpsChoice(
                chatId,
                messageId,
                callback.id,
                roomId,
                choice!,
                callback.from.id
              )
            }
            return new Response('OK', { status: 200 })
          }

          // 骰子游戏回调
          if (data.startsWith('dice_join_')) {
            const roomId = data.replace('dice_join_', '')
            await handleJoinDiceGame(chatId, messageId, callback.id, roomId, callback.from.id)
            return new Response('OK', { status: 200 })
          }

          if (data.startsWith('dice_cancel_')) {
            const roomId = data.replace('dice_cancel_', '')
            await handleCancelDiceGame(chatId, messageId, callback.id, roomId, callback.from.id)
            return new Response('OK', { status: 200 })
          }
        }
      }

      return new Response('OK', { status: 200 })
    }

    return new Response('Bot is running', { status: 200 })
  } catch (error) {
    console.error('[BOT-V2] Error:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : String(error)
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
