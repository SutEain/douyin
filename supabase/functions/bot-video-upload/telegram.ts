import { BOT_TOKEN, TG_API_BASE, TG_FILE_PROXY_URL } from './env.ts'

// 🎯 将 Telegram file_id 转换为 CDN URL
export function buildTelegramFileUrl(fileId: string): string | null {
  if (!fileId) return null

  if (TG_FILE_PROXY_URL) {
    const base = TG_FILE_PROXY_URL.endsWith('/')
      ? TG_FILE_PROXY_URL.slice(0, -1)
      : TG_FILE_PROXY_URL
    return `${base}?file_id=${encodeURIComponent(fileId)}`
  }

  console.warn('[bot] 未配置 TG_FILE_PROXY_URL，无法生成缩略图 URL')
  return null
}

// Telegram API 调用
export async function sendMessage(chatId: number, text: string, options: any = {}) {
  console.log('[sendMessage] chatId:', chatId, 'textLength:', text.length)
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
      console.error('[sendMessage] 失败:', result)
    } else {
      console.log('[sendMessage] 成功, message_id:', result.result?.message_id)
    }
    return result
  } catch (error) {
    console.error('[sendMessage] 异常:', error)
    throw error
  }
}

export async function editMessage(
  chatId: number,
  messageId: number,
  text: string,
  options: any = {}
) {
  console.log('[editMessage] chatId:', chatId, 'messageId:', messageId, 'textLength:', text.length)
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/editMessageText`
  try {
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      ...options
    }
    console.log('[editMessage] payload键盘:', options.reply_markup ? 'yes' : 'no')

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const result = await response.json()
    if (!result.ok) {
      console.error('[editMessage] 失败:', JSON.stringify(result))
      console.error('[editMessage] 请求payload:', JSON.stringify(payload).substring(0, 500))
    } else {
      console.log('[editMessage] 成功')
    }
    return result
  } catch (error) {
    console.error('[editMessage] 异常:', error)
    throw error
  }
}

export async function deleteTelegramMessage(chatId: number, messageId: number) {
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/deleteMessage`
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId })
    })
  } catch (e) {
    console.error('[deleteMessage] Error:', e)
  }
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
