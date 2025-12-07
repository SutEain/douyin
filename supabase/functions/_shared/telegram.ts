/**
 * Telegram WebApp InitData 验证工具
 * 使用 signature (Ed25519) - Telegram 官方推荐方式
 * 参考: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

// 导入 Ed25519 验证库
import { ed25519 } from 'https://esm.sh/@noble/curves@1.3.0/ed25519'

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
  photo_url?: string
  allows_write_to_pm?: boolean
}

export interface ValidatedInitData {
  user: TelegramUser
  auth_date: number
  query_id?: string
  start_param?: string // 🎯 深链接参数
}

const encoder = new TextEncoder()

// Telegram 官方 Ed25519 公钥（Production 环境）
const TELEGRAM_PUBLIC_KEY_HEX = 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d'

/**
 * Hex 字符串转 Uint8Array
 */
function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

/**
 * Base64 URL 解码
 */
function base64UrlDecode(base64Url: string): Uint8Array {
  // Base64 URL 转 Base64
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Padded = base64 + padding

  // Base64 解码
  const binaryString = atob(base64Padded)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

/**
 * 使用 signature (Ed25519) 验证 - Telegram 官方推荐
 */
async function validateWithSignature(initData: string, botToken: string): Promise<boolean> {
  try {
    const params = new URLSearchParams(initData)
    const signature = params.get('signature')

    if (!signature) {
      return false
    }

    // 1. 提取 bot_id
    const botId = botToken.split(':')[0]

    // 2. 构造 data_check_string（官方文档格式）
    // 格式：bot_id:WebAppData\nauth_date=<value>\nkey=value\n...
    const fields: Array<[string, string]> = []

    for (const [key, value] of params.entries()) {
      if (key === 'hash' || key === 'signature') continue
      fields.push([key, value])
    }

    // 按 key 排序
    fields.sort((a, b) => a[0].localeCompare(b[0]))

    // 构造完整的 data_check_string
    const dataPairs = [`${botId}:WebAppData`]
    for (const [key, value] of fields) {
      dataPairs.push(`${key}=${value}`)
    }
    const dataCheckString = dataPairs.join('\n')

    // 3. 解码 signature（Base64 URL 格式）
    let signatureBytes: Uint8Array
    try {
      signatureBytes = base64UrlDecode(signature)
    } catch (e) {
      return false
    }

    // 4. 获取 Telegram 官方公钥
    const publicKey = hexToUint8Array(TELEGRAM_PUBLIC_KEY_HEX)

    // 5. 验证签名
    const messageBytes = encoder.encode(dataCheckString)
    const isValid = ed25519.verify(signatureBytes, messageBytes, publicKey)

    return isValid
  } catch (error) {
    return false
  }
}

/**
 * 验证 Telegram InitData
 * 使用 signature (Ed25519) 验证 - Telegram 官方推荐
 */
export async function validateTelegramInitData(
  initData: string,
  botToken: string
): Promise<ValidatedInitData | null> {
  try {
    console.log('[TG Auth] Received initData length:', initData.length)
    console.log('[TG Auth] InitData preview:', initData.substring(0, 100) + '...')

    const params = new URLSearchParams(initData)
    const signature = params.get('signature')

    // 必须有 signature
    if (!signature) {
      console.error('[TG Auth] ❌ Missing signature field')
      return null
    }

    console.log('[TG Auth] Has signature:', !!signature)
    console.log('[TG Auth] Has query_id:', !!params.get('query_id'))
    console.log('[TG Auth] Has chat_instance:', !!params.get('chat_instance'))

    // 使用 signature (Ed25519) 验证
    const isValid = await validateWithSignature(initData, botToken)

    if (!isValid) {
      console.error('[TG Auth] ❌ Signature validation failed')
      return null
    }

    console.log('[TG Auth] ✅ Signature valid')

    // 检查时效性（5分钟内有效）
    const authDate = parseInt(params.get('auth_date') || '0')
    const currentTime = Math.floor(Date.now() / 1000)
    const age = currentTime - authDate

    if (age > 300) {
      console.error('[TG Auth] ❌ InitData expired, age:', age, 'seconds')
      return null
    }

    console.log('[TG Auth] ✅ InitData age valid:', age, 'seconds')

    // 解析用户信息
    const userStr = params.get('user')
    if (!userStr) {
      return null
    }

    let user: TelegramUser
    try {
      user = JSON.parse(decodeURIComponent(userStr))
    } catch (e) {
      return null
    }

    // 🎯 解析深链接参数（start_param）
    const startParam = params.get('start_param')
    console.log('[TG Auth] start_param:', startParam || '无')

    return {
      user,
      auth_date: authDate,
      query_id: params.get('query_id') || undefined,
      start_param: startParam || undefined
    }
  } catch (error) {
    return null
  }
}
