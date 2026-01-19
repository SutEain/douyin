import { BOT_TOKEN, TG_API_BASE } from './env.ts'

// Telegram API 调用
export async function sendMessage(chatId: number, text: string, options: any = {}) {
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
      console.error('[BOT-V2][sendMessage] 失败:', result)
    }
    return result
  } catch (error) {
    console.error('[BOT-V2][sendMessage] 异常:', error)
    throw error
  }
}

export async function editMessage(
  chatId: number,
  messageId: number,
  text: string,
  options: any = {}
) {
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/editMessageText`
  try {
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      ...options
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const result = await response.json()
    if (!result.ok) {
      console.error('[BOT-V2][editMessage] 失败:', JSON.stringify(result))
    }
    return result
  } catch (error) {
    console.error('[BOT-V2][editMessage] 异常:', error)
    throw error
  }
}

/**
 * 🎲 发送骰子（带超时保护）
 */
export async function sendDice(chatId: number, options: any = {}, timeoutMs: number = 30000) {
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/sendDice`
  try {
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
    console.error('[BOT-V2][sendDice] 异常:', error)
    throw error
  }
}

/**
 * 🎲 带重试机制的发送骰子函数
 */
export async function sendDiceWithRetry(
  chatId: number,
  options: any = {},
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<any> {
  let lastError: any = null

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
      const timeoutMs = 30000 + (attempt - 1) * 5000
      const response = await sendDice(chatId, options, timeoutMs)

      if (response.ok && response.result?.dice) {
        return response
      }

      const errorMsg = response.description || response.error_code || 'Unknown error'
      const isRetryable = retryableErrors.some((e) => errorMsg.includes(e))

      lastError = new Error(`Telegram API error: ${errorMsg}`)

      if (!isRetryable && response.error_code) {
        throw lastError
      }

      if (attempt < maxRetries) {
        const baseDelay = initialDelay * attempt
        const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1)
        const delay = Math.max(500, Math.floor(baseDelay + jitter))
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    } catch (error: any) {
      const errorMsg = error.message || String(error)
      const isRetryable = retryableErrors.some((e) => errorMsg.includes(e))

      lastError = error

      if (!isRetryable && !errorMsg.includes('TIMEOUT') && !errorMsg.includes('TIMED_OUT')) {
        throw error
      }

      if (attempt < maxRetries) {
        const baseDelay = initialDelay * attempt
        const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1)
        const delay = Math.max(500, Math.floor(baseDelay + jitter))
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

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
