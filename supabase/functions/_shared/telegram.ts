/**
 * Telegram WebApp InitData 验证工具
 * 参考: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
  photo_url?: string
}

export interface ValidatedInitData {
  user: TelegramUser
  auth_date: number
  hash: string
  query_id?: string
}

/**
 * 验证 Telegram InitData 的签名
 */
export async function validateTelegramInitData(
  initData: string,
  botToken: string
): Promise<ValidatedInitData | null> {
  try {
    // 解析 initData
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')

    if (!hash) {
      console.error('Missing hash in initData')
      return null
    }

    // 移除 hash 参数
    params.delete('hash')

    // 构建 data_check_string（按字母顺序排序）
    const dataCheckArr: string[] = []
    params.forEach((value, key) => {
      dataCheckArr.push(`${key}=${value}`)
    })
    dataCheckArr.sort()
    const dataCheckString = dataCheckArr.join('\n')

    // 计算 secret_key = HMAC-SHA256("WebAppData", bot_token)
    const encoder = new TextEncoder()
    const secretKeyData = await crypto.subtle.importKey(
      'raw',
      encoder.encode(botToken),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const secretKey = await crypto.subtle.sign('HMAC', secretKeyData, encoder.encode('WebAppData'))

    // 计算 hash = HMAC-SHA256(data_check_string, secret_key)
    const hashKeyData = await crypto.subtle.importKey(
      'raw',
      secretKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const calculatedHash = await crypto.subtle.sign(
      'HMAC',
      hashKeyData,
      encoder.encode(dataCheckString)
    )

    // 转换为 hex 字符串
    const calculatedHashHex = Array.from(new Uint8Array(calculatedHash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // 比对 hash
    if (calculatedHashHex !== hash) {
      console.error('Hash mismatch')
      return null
    }

    // 检查时效性（5分钟内有效）
    const authDate = parseInt(params.get('auth_date') || '0')
    const currentTime = Math.floor(Date.now() / 1000)
    if (currentTime - authDate > 300) {
      console.error('InitData expired')
      return null
    }

    // 解析用户信息
    const userStr = params.get('user')
    if (!userStr) {
      console.error('Missing user data')
      return null
    }

    const user: TelegramUser = JSON.parse(userStr)

    return {
      user,
      auth_date: authDate,
      hash,
      query_id: params.get('query_id') || undefined
    }
  } catch (error) {
    console.error('Error validating Telegram initData:', error)
    return null
  }
}

/**
 * 简化版：仅用于开发测试（跳过签名验证）
 * ⚠️ 生产环境禁用！
 */
export function parseTelegramInitDataUnsafe(initData: string): ValidatedInitData | null {
  try {
    const params = new URLSearchParams(initData)
    const userStr = params.get('user')
    if (!userStr) return null

    const user: TelegramUser = JSON.parse(userStr)
    const authDate = parseInt(params.get('auth_date') || '0')
    const hash = params.get('hash') || ''

    return {
      user,
      auth_date: authDate,
      hash,
      query_id: params.get('query_id') || undefined
    }
  } catch (error) {
    console.error('Error parsing Telegram initData:', error)
    return null
  }
}
