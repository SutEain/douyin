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

/**
 * 🎲 发送骰子（带超时保护）
 * @param chatId 聊天ID
 * @param options 选项
 * @param timeoutMs 超时时间（毫秒，默认30秒）
 */
export async function sendDice(chatId: number, options: any = {}, timeoutMs: number = 30000) {
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/sendDice`
  try {
    // 🎯 使用 AbortController 实现超时控制
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          ...options
        }),
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      return await response.json()
    } catch (fetchError: any) {
      clearTimeout(timeoutId)
      if (fetchError.name === 'AbortError') {
        throw new Error(`发送骰子超时（${timeoutMs}ms）`)
      }
      throw fetchError
    }
  } catch (error) {
    console.error('[DICE-BOT][sendDice] 异常:', error)
    throw error
  }
}

/**
 * 🎲 带重试机制的发送骰子函数（增强版）
 * @param chatId 聊天ID
 * @param options 选项
 * @param maxRetries 最大重试次数（默认7次，增加重试次数）
 * @param initialDelay 初始延迟（毫秒，默认1500，增加初始延迟）
 * @returns 发送结果
 */
export async function sendDiceWithRetry(
  chatId: number,
  options: any = {},
  maxRetries: number = 7,
  initialDelay: number = 1500
): Promise<any> {
  let lastError: any = null
  let lastResponse: any = null

  // 🎯 可重试的错误码（这些错误通常是暂时的，可以重试）
  const retryableErrors = [
    'TIMEOUT',
    'TIMED_OUT',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNREFUSED',
    'Bad Gateway',
    'Service Unavailable',
    'Internal Server Error'
  ]

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[DICE-BOT][sendDiceWithRetry] 🎲 尝试发送骰子 (${attempt}/${maxRetries})...`)

      // 🎯 每次重试增加超时时间（30s, 35s, 40s...）
      const timeoutMs = 30000 + (attempt - 1) * 5000
      const response = await sendDice(chatId, options, timeoutMs)
      lastResponse = response

      if (response.ok && response.result?.dice) {
        const diceValue = response.result.dice.value
        console.log(
          `[DICE-BOT][sendDiceWithRetry] ✅ 骰子发送成功 (尝试 ${attempt}/${maxRetries})，结果: ${diceValue}`
        )
        return response
      }

      // 如果返回了错误，检查是否可重试
      const errorMsg = response.description || response.error_code || 'Unknown error'
      const errorCode = String(response.error_code || '')
      const isRetryable = retryableErrors.some((e) => errorMsg.includes(e) || errorCode.includes(e))

      console.warn(
        `[DICE-BOT][sendDiceWithRetry] ⚠️ 骰子发送失败 (尝试 ${attempt}/${maxRetries}):`,
        errorMsg,
        isRetryable ? '(可重试)' : '(不可重试)'
      )

      lastError = new Error(`Telegram API error: ${errorMsg}`)

      // 🎯 如果是不可重试的错误（如权限错误），立即失败
      if (!isRetryable && response.error_code) {
        console.error(`[DICE-BOT][sendDiceWithRetry] ❌ 遇到不可重试的错误，停止重试:`, errorMsg)
        throw lastError
      }

      // 如果不是最后一次尝试，等待后重试
      if (attempt < maxRetries) {
        // 🎯 指数退避 + 抖动：每次重试延迟递增（1.5s, 3s, 4.5s, 6s, 7.5s, 9s, 10.5s）
        // 添加随机抖动（±20%）避免同时重试
        const baseDelay = initialDelay * attempt
        const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1) // ±20%
        const delay = Math.max(500, Math.floor(baseDelay + jitter))
        console.log(`[DICE-BOT][sendDiceWithRetry] ⏳ 等待 ${delay}ms 后重试...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    } catch (error: any) {
      const errorMsg = error.message || String(error)
      const isRetryable = retryableErrors.some((e) => errorMsg.includes(e))

      console.error(
        `[DICE-BOT][sendDiceWithRetry] ❌ 发送骰子异常 (尝试 ${attempt}/${maxRetries}):`,
        errorMsg,
        isRetryable ? '(可重试)' : '(不可重试)'
      )

      lastError = error

      // 🎯 如果是不可重试的错误，立即失败
      if (!isRetryable && !errorMsg.includes('TIMEOUT') && !errorMsg.includes('TIMED_OUT')) {
        throw error
      }

      // 如果不是最后一次尝试，等待后重试
      if (attempt < maxRetries) {
        const baseDelay = initialDelay * attempt
        const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1)
        const delay = Math.max(500, Math.floor(baseDelay + jitter))
        console.log(`[DICE-BOT][sendDiceWithRetry] ⏳ 等待 ${delay}ms 后重试...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  // 所有重试都失败了
  console.error(
    `[DICE-BOT][sendDiceWithRetry] ❌ 骰子发送失败，已重试 ${maxRetries} 次`,
    lastError?.message || 'Unknown error'
  )
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
