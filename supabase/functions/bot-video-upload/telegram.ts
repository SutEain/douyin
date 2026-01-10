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

// ✅ 仅更新消息键盘（不改文本），用于“loading/禁用按钮”等场景
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
      console.error('[editMessageReplyMarkup] 失败:', JSON.stringify(result))
      console.error(
        '[editMessageReplyMarkup] 请求payload:',
        JSON.stringify(payload).substring(0, 500)
      )
    }
    return result
  } catch (error) {
    console.error('[editMessageReplyMarkup] 异常:', error)
    throw error
  }
}

export async function deleteTelegramMessage(chatId: number, messageId: number) {
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/deleteMessage`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId })
    })
    return await response.json()
  } catch (e) {
    console.error('[deleteMessage] Error:', e)
    return { ok: false, error: e }
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
    console.error('[sendDice] 异常:', error)
    throw error
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

// 🎯 发送图片（支持本地文件路径或URL）
export async function sendPhoto(
  chatId: number,
  photo: string | File,
  caption?: string,
  options: any = {}
) {
  const url = `${TG_API_BASE}/bot${BOT_TOKEN}/sendPhoto`
  console.log('[sendPhoto] chatId:', chatId, 'photo:', typeof photo === 'string' ? photo : 'File')

  try {
    // 如果是文件路径或URL，使用multipart/form-data
    if (typeof photo === 'string') {
      const formData = new FormData()
      formData.append('chat_id', String(chatId))

      // 判断是URL还是本地路径
      if (photo.startsWith('http://') || photo.startsWith('https://')) {
        // URL：使用photo参数
        formData.append('photo', photo)
      } else {
        // 本地路径：需要读取文件（在Deno中使用fetch读取）
        const fileResponse = await fetch(photo)
        if (!fileResponse.ok) {
          throw new Error(`无法读取文件: ${photo}`)
        }
        const blob = await fileResponse.blob()
        formData.append('photo', blob, photo.split('/').pop() || 'photo.jpg')
      }

      if (caption) {
        formData.append('caption', caption)
        formData.append('parse_mode', 'HTML')
      }

      // 添加其他选项（如reply_markup）
      if (options.reply_markup) {
        formData.append('reply_markup', JSON.stringify(options.reply_markup))
      }

      const response = await fetch(url, {
        method: 'POST',
        body: formData
      })
      const result = await response.json()
      if (!result.ok) {
        console.error('[sendPhoto] 失败:', result)
      } else {
        console.log('[sendPhoto] 成功, message_id:', result.result?.message_id)
      }
      return result
    } else {
      // File对象
      const formData = new FormData()
      formData.append('chat_id', String(chatId))
      formData.append('photo', photo)
      if (caption) {
        formData.append('caption', caption)
        formData.append('parse_mode', 'HTML')
      }
      if (options.reply_markup) {
        formData.append('reply_markup', JSON.stringify(options.reply_markup))
      }

      const response = await fetch(url, {
        method: 'POST',
        body: formData
      })
      const result = await response.json()
      if (!result.ok) {
        console.error('[sendPhoto] 失败:', result)
      } else {
        console.log('[sendPhoto] 成功, message_id:', result.result?.message_id)
      }
      return result
    }
  } catch (error) {
    console.error('[sendPhoto] 异常:', error)
    throw error
  }
}
