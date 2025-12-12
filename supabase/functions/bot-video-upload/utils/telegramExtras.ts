import { deleteTelegramMessage, sendMessage } from '../telegram.ts'

// 发送自毁消息（默认 3 秒后删除）
export async function sendSelfDestructMessage(chatId: number, text: string, seconds: number = 3) {
  const result = await sendMessage(chatId, text)
  if (result.ok) {
    const messageId = result.result.message_id
    setTimeout(() => {
      deleteTelegramMessage(chatId, messageId)
    }, seconds * 1000)
  }
  return result
}
