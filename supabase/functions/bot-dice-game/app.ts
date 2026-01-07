import { supabase } from './supabaseClient.ts'
import { sendMessage } from './telegram.ts'
import { handleDiceCommand, handleJoinDiceGame, handleCancelDiceGame } from './features/diceGame.ts'

// 主服务（由 index.ts 作为入口调用）
export async function handleRequest(req: Request): Promise<Response> {
  console.log('[DICE-BOT-APP] Incoming request:', req.method, req.url)
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
        console.error('[DICE-BOT-APP] Failed to parse request JSON:', e)
        return new Response('Invalid JSON', { status: 400 })
      }

      console.log('[DICE-BOT-APP] Update received:', JSON.stringify(update).substring(0, 500))

      // 🎯 1. 提取用户 ID 进行黑名单检查
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
          console.log(
            `[DICE-BOT-BAN] 拦截到封禁用户操作: userId=${userIdToCheck}, updateType=${Object.keys(update).find((k) => k !== 'update_id')}`
          )
          const banReason = profile.ban_reason || '由于违反社区规范，您的账号已被封禁。'
          const banNotice = `🚫 <b>您的账号已被封禁</b>\n\n原因: ${banReason}\n\n如有疑问，请联系管理员。`

          // 确定发送通知的目标
          const targetChatId =
            update.message?.chat?.id ||
            update.edited_message?.chat?.id ||
            update.callback_query?.message?.chat?.id

          if ((update.message || update.edited_message) && targetChatId) {
            const msg = update.message || update.edited_message
            const replyOptions =
              msg.chat.type !== 'private' ? { reply_to_message_id: msg.message_id } : {}
            await sendMessage(targetChatId, banNotice, replyOptions)
          } else if (update.callback_query) {
            // 弹出警告提示框
            const { answerCallbackQuery } = await import('./telegram.ts')
            await answerCallbackQuery(
              update.callback_query.id,
              `🚫 账号已封禁\n原因: ${banReason}`,
              true
            )
          }
          return new Response('OK', { status: 200 })
        }
      }

      console.log('收到更新:', JSON.stringify(update).substring(0, 200))

      // 🎯 处理消息
      if (update.message) {
        const message = update.message
        const chatId = message.chat.id

        // 🎯 严格权限控制：仅接受骰子游戏群消息
        const diceGroupId = Deno.env.get('DICE_GROUP_ID')
        if (message.chat.type !== 'private' && String(chatId) !== String(diceGroupId)) {
          console.log(
            `[DICE-BOT-APP] 忽略非骰子游戏群消息: chatId=${chatId}, type=${message.chat.type}`
          )
          return new Response('OK', { status: 200 })
        }

        // 只处理文本消息（骰子游戏指令）
        if (message.text) {
          const text = message.text.trim().toLowerCase()
          const isDiceCmd =
            text === 'tz' || text.startsWith('tz ') || text === '/tz' || text.startsWith('/tz ')

          if (isDiceCmd) {
            console.log(`[DICE-BOT] 匹配到骰子指令，准备执行...`)
            await handleDiceCommand(chatId, message.text, message)
            return new Response('OK', { status: 200 })
          }
        }
      }
      // 🎯 处理回调查询（骰子游戏相关）
      else if (update.callback_query) {
        const callback = update.callback_query
        const chatId = callback.message?.chat?.id
        const messageId = callback.message?.message_id
        const data = callback.data

        // 🎯 严格权限控制：仅接受骰子游戏群的回调
        const diceGroupId = Deno.env.get('DICE_GROUP_ID')
        if (callback.message?.chat?.type !== 'private' && String(chatId) !== String(diceGroupId)) {
          return new Response('OK', { status: 200 })
        }

        if (chatId && messageId && data) {
          console.log('[DICE-BOT] 收到回调查询:', {
            chatId,
            messageId,
            data
          })

          // 处理骰子游戏回调
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
    console.error('[DICE-BOT-APP] 处理请求时发生错误:', error)
    console.error('[DICE-BOT-APP] 错误堆栈:', error instanceof Error ? error.stack : String(error))
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
