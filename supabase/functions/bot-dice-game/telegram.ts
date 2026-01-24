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
 * 🎲 带重试机制的发送骰子函数（增强版）
 * 🔥 增加重试次数和改进错误处理，解决投骰子卡住的问题
 */
export async function sendDiceWithRetry(
  chatId: number,
  options: any = {},
  maxRetries: number = 7, // 🔥 从3次增加到7次
  initialDelay: number = 1000
): Promise<any> {
  let lastError: any = null
  let lastResponse: any = null

  // 🔥 扩展可重试的错误类型
  const retryableErrors = [
    'TIMEOUT',
    'TIMED_OUT',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNREFUSED',
    'Bad Gateway',
    'Service Unavailable',
    'Internal Server Error',
    'Network error',
    'NetworkError',
    'fetch failed',
    'Failed to fetch',
    'socket hang up',
    'timeout',
    'ETIMEDOUT',
    'ECONNRESET',
    'ENOTFOUND',
    'ECONNREFUSED',
    '503',
    '502',
    '504',
    '500',
    '429', // Rate limit，也可以重试
    'Too Many Requests'
  ]

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 🔥 增加超时时间：30s, 35s, 40s, 45s, 50s, 55s, 60s
      const timeoutMs = 30000 + (attempt - 1) * 5000

      console.log(
        `[sendDiceWithRetry] 🎲 尝试发送骰子 (${attempt}/${maxRetries})，超时: ${timeoutMs}ms`
      )

      const response = await sendDice(chatId, options, timeoutMs)
      lastResponse = response

      if (response.ok && response.result?.dice) {
        console.log(
          `[sendDiceWithRetry] ✅ 骰子发送成功 (尝试 ${attempt}/${maxRetries})，结果: ${response.result.dice.value}`
        )
        return response
      }

      const errorMsg = response.description || response.error_code || 'Unknown error'
      const errorCode = response.error_code || ''

      // 🔥 检查是否是可重试的错误
      const isRetryable =
        retryableErrors.some((e) => errorMsg.includes(e)) ||
        retryableErrors.some((e) => String(errorCode).includes(e))

      lastError = new Error(`Telegram API error: ${errorMsg} (code: ${errorCode})`)

      console.warn(
        `[sendDiceWithRetry] ⚠️ 骰子发送失败 (尝试 ${attempt}/${maxRetries}): ${errorMsg}${errorCode ? ` (code: ${errorCode})` : ''}，可重试: ${isRetryable}`
      )

      // 🔥 如果不是可重试的错误且有错误码，立即抛出（但429等限流错误可以重试）
      if (!isRetryable && response.error_code && !String(errorCode).includes('429')) {
        console.error(
          `[sendDiceWithRetry] ❌ 不可重试的错误，立即失败: ${errorMsg} (code: ${errorCode})`
        )
        throw lastError
      }

      // 🔥 如果不是最后一次尝试，等待后重试
      if (attempt < maxRetries) {
        // 指数退避 + 抖动：1s, 2s, 3s, 4s, 5s, 6s, 7s（带±20%抖动）
        const baseDelay = initialDelay * attempt
        const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1)
        const delay = Math.max(500, Math.floor(baseDelay + jitter))
        console.log(`[sendDiceWithRetry] ⏳ 等待 ${delay}ms 后重试...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    } catch (error: any) {
      const errorMsg = error.message || String(error)
      const isRetryable =
        retryableErrors.some((e) => errorMsg.includes(e)) ||
        errorMsg.includes('TIMEOUT') ||
        errorMsg.includes('TIMED_OUT') ||
        errorMsg.includes('超时')

      lastError = error

      console.error(
        `[sendDiceWithRetry] ❌ 发送骰子异常 (尝试 ${attempt}/${maxRetries}): ${errorMsg}，可重试: ${isRetryable}`
      )

      // 🔥 如果不是可重试的错误，立即抛出
      if (!isRetryable && !errorMsg.includes('TIMEOUT') && !errorMsg.includes('TIMED_OUT')) {
        console.error(`[sendDiceWithRetry] ❌ 不可重试的异常，立即失败: ${errorMsg}`)
        throw error
      }

      // 🔥 如果不是最后一次尝试，等待后重试
      if (attempt < maxRetries) {
        const baseDelay = initialDelay * attempt
        const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1)
        const delay = Math.max(500, Math.floor(baseDelay + jitter))
        console.log(`[sendDiceWithRetry] ⏳ 等待 ${delay}ms 后重试...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  // 🔥 所有重试都失败了，记录详细信息
  console.error(
    `[sendDiceWithRetry] ❌ 骰子发送失败，已重试 ${maxRetries} 次。最后错误: ${lastError?.message || 'Unknown'}，最后响应: ${JSON.stringify(lastResponse || {})}`
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
