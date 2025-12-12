// 地理相关工具（仅重构，不改行为）

// Nominatim 地理编码（返回国家+城市）
export async function getLocationFromCoords(lat: number, lon: number) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?` +
    `lat=${lat}&lon=${lon}&format=json&accept-language=zh&addressdetails=1`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'DouyinClone/1.0 (supabase-edge-function)'
    }
  })

  if (!response.ok) {
    throw new Error('地理编码失败')
  }

  const data = await response.json()
  const address = data.address || {}

  return {
    country: address.country || '未知',
    country_code: (address.country_code || 'XX').toUpperCase(),
    city: address.city || address.town || address.village || address.state || null
  }
}

// 获取国旗 Emoji
export function getFlag(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return '🌍'
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0))
  return String.fromCodePoint(...codePoints)
}
