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
