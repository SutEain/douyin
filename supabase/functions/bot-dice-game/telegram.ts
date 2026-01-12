import { BOT_TOKEN, TG_API_BASE } from './env.ts'

// Telegram API 调用
export async function sendMessage(chatId: number, text: string, options: any = {}) {
  console.log('[DICE-BOT][sendMessage] chatId:', chatId, 'textLength:', text.length)
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/sendMessage`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...options
      })
    })
    const result = await response.json()
    if (!result.ok) {
      console.error('[DICE-BOT][sendMessage] 失败:', result)
    } else {
      console.log('[DICE-BOT][sendMessage] 成功, message_id:', result.result?.message_id)
    }
    return result
  } catch (error) {
    console.error('[DICE-BOT][sendMessage] 异常:', error)
    throw error
  }
}

export async function editMessage(
  chatId: number,
  messageId: number,
  text: string,
  options: any = {}
) {
  console.log(
    '[DICE-BOT][editMessage] chatId:',
    chatId,
    'messageId:',
    messageId,
    'textLength:',
    text.length
  )
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/editMessageText`
  try {
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      ...options
    }
    console.log('[DICE-BOT][editMessage] payload键盘:', options.reply_markup ? 'yes' : 'no')

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const result = await response.json()
    if (!result.ok) {
      console.error('[DICE-BOT][editMessage] 失败:', JSON.stringify(result))
      console.error(
        '[DICE-BOT][editMessage] 请求payload:',
        JSON.stringify(payload).substring(0, 500)
      )
    } else {
      console.log('[DICE-BOT][editMessage] 成功')
    }
    return result
  } catch (error) {
    console.error('[DICE-BOT][editMessage] 异常:', error)
    throw error
  }
}

export async function editMessageReplyMarkup(chatId: number, messageId: number, replyMarkup: any) {
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/editMessageReplyMarkup`
  try {
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const result = await response.json()
    if (!result.ok) {
      console.error('[DICE-BOT][editMessageReplyMarkup] 失败:', JSON.stringify(result))
      console.error(
        '[DICE-BOT][editMessageReplyMarkup] 请求payload:',
        JSON.stringify(payload).substring(0, 500)
      )
    }
    return result
  } catch (error) {
    console.error('[DICE-BOT][editMessageReplyMarkup] 异常:', error)
    throw error
  }
}

export async function sendDice(chatId: number, options: any = {}) {
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/sendDice`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        ...options
      })
    })
    return await response.json()
  } catch (error) {
    console.error('[DICE-BOT][sendDice] 异常:', error)
    throw error
  }
}

/**
 * 🎲 带重试机制的发送骰子函数
 * @param chatId 聊天ID
 * @param options 选项
 * @param maxRetries 最大重试次数（默认5次）
 * @param initialDelay 初始延迟（毫秒，默认1000）
 * @returns 发送结果
 */
export async function sendDiceWithRetry(
  chatId: number,
  options: any = {},
  maxRetries: number = 5,
  initialDelay: number = 1000
): Promise<any> {
  let lastError: any = null
  let lastResponse: any = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[DICE-BOT][sendDiceWithRetry] 🎲 尝试发送骰子 (${attempt}/${maxRetries})...`)

      const response = await sendDice(chatId, options)
      lastResponse = response

      if (response.ok && response.result?.dice) {
        console.log(
          `[DICE-BOT][sendDiceWithRetry] ✅ 骰子发送成功 (尝试 ${attempt}/${maxRetries})，结果: ${response.result.dice.value}`
        )
        return response
      }

      // 如果返回了错误，记录但不立即失败
      const errorMsg = response.description || response.error_code || 'Unknown error'
      console.warn(
        `[DICE-BOT][sendDiceWithRetry] ⚠️ 骰子发送失败 (尝试 ${attempt}/${maxRetries}):`,
        errorMsg
      )
      lastError = new Error(`Telegram API error: ${errorMsg}`)

      // 如果不是最后一次尝试，等待后重试
      if (attempt < maxRetries) {
        // 🎯 指数退避：每次重试延迟递增（1s, 2s, 3s, 4s, 5s）
        const delay = initialDelay * attempt
        console.log(`[DICE-BOT][sendDiceWithRetry] ⏳ 等待 ${delay}ms 后重试...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    } catch (error) {
      console.error(
        `[DICE-BOT][sendDiceWithRetry] ❌ 发送骰子异常 (尝试 ${attempt}/${maxRetries}):`,
        error
      )
      lastError = error

      // 如果不是最后一次尝试，等待后重试
      if (attempt < maxRetries) {
        const delay = initialDelay * attempt
        console.log(`[DICE-BOT][sendDiceWithRetry] ⏳ 等待 ${delay}ms 后重试...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  // 所有重试都失败了
  console.error(`[DICE-BOT][sendDiceWithRetry] ❌ 骰子发送失败，已重试 ${maxRetries} 次`)
  throw lastError || new Error(`Failed to send dice after ${maxRetries} attempts`)
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert?: boolean
) {
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/answerCallbackQuery`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert
    })
  })
}
