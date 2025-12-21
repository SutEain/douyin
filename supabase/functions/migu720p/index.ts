// ⚠️ 此函数需要可直接在 Supabase Edge Functions 打包环境运行
// 因此：不依赖 deno.land/std 等远程模块（避免打包时 Module not found）

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
}

// ============================================================
// MiGu 720p 解析（按用户提供的 PHP 逻辑移植）
// - GET /functions/v1/migu720p?id=608807420
// - 返回 302 Redirect 到最终可播放 URL
// - 1800s 内存缓存（边缘函数冷启动时缓存会丢失，属 best-effort）
// ============================================================

type CacheEntry = { url: string; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_SECONDS = 1800

// ============================================================
// Minimal MD5 implementation (no external deps)
// Based on the classic JS MD5 implementation approach.
// ============================================================
function md5(input: string): string {
  const utf8 = new TextEncoder().encode(input)

  const toUint32 = (x: number) => x >>> 0
  const rotl = (x: number, c: number) => toUint32((x << c) | (x >>> (32 - c)))

  const F = (x: number, y: number, z: number) => (x & y) | (~x & z)
  const G = (x: number, y: number, z: number) => (x & z) | (y & ~z)
  const H = (x: number, y: number, z: number) => x ^ y ^ z
  const I = (x: number, y: number, z: number) => y ^ (x | ~z)

  const add = (a: number, b: number) => toUint32((a + b) | 0)

  const K = new Uint32Array(64)
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0
  }

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ]

  // Pre-processing: padding
  const bitLen = utf8.length * 8
  const withOne = new Uint8Array(utf8.length + 1)
  withOne.set(utf8)
  withOne[utf8.length] = 0x80

  const padLen = (56 - (withOne.length % 64) + 64) % 64
  const padded = new Uint8Array(withOne.length + padLen + 8)
  padded.set(withOne)

  // Append original length in bits (little-endian 64-bit)
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, bitLen >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(bitLen / 2 ** 32) >>> 0, true)

  // Init
  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  // Process each 512-bit chunk
  for (let offset = 0; offset < padded.length; offset += 64) {
    const M = new Uint32Array(16)
    for (let i = 0; i < 16; i++) {
      M[i] = view.getUint32(offset + i * 4, true)
    }

    let A = a0
    let B = b0
    let C = c0
    let D = d0

    for (let i = 0; i < 64; i++) {
      let f = 0
      let g = 0
      if (i < 16) {
        f = F(B, C, D)
        g = i
      } else if (i < 32) {
        f = G(B, C, D)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = H(B, C, D)
        g = (3 * i + 5) % 16
      } else {
        f = I(B, C, D)
        g = (7 * i) % 16
      }

      const tmp = D
      D = C
      C = B
      B = add(B, rotl(add(add(A, f), add(K[i], M[g])), s[i]))
      A = tmp
    }

    a0 = add(a0, A)
    b0 = add(b0, B)
    c0 = add(c0, C)
    d0 = add(d0, D)
  }

  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, a0, true)
  outView.setUint32(4, b0, true)
  outView.setUint32(8, c0, true)
  outView.setUint32(12, d0, true)

  return Array.from(out)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function getCache(id: string): string | null {
  const hit = cache.get(id)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    cache.delete(id)
    return null
  }
  return hit.url
}

function setCache(id: string, url: string, ttlSeconds: number) {
  cache.set(id, { url, expiresAt: Date.now() + ttlSeconds * 1000 })
}

function getSignConfig(contId: string): { timestampMs: string; salt: string; sign: string } {
  const appVersion = '2600033500'
  const saltValue = '16d4328df21a4138859388418bd252c2'
  const timestampMs = String(Date.now())
  const ver8 = appVersion.slice(0, 8)
  const md5string = md5(timestampMs + contId + ver8)
  const prefix = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000
  const salt = String(prefix).padStart(6, '0') + '80'
  const text = md5string + saltValue + 'migu' + salt.slice(0, 4)
  const sign = md5(text)
  return { timestampMs, salt, sign }
}

function miguEncryptedUrl(rawUrl: string): string {
  const factorOfEncryption = [8, 3, 7, 6, 6] as const

  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return rawUrl
  }

  const puData = u.searchParams.get('puData') || ''
  if (!puData) return rawUrl

  const ddCalcuExists = !!u.searchParams.get('ddCalcu')

  if (!ddCalcuExists) {
    const userid = u.searchParams.get('userid') || 'eeeeeeeee'
    const timestamp = u.searchParams.get('timestamp') || 'tttttttttttttt'
    const programId = u.searchParams.get('ProgramID') || 'ccccccccc'
    const channelId = u.searchParams.get('Channel_ID') || 'nnnnnnnnnnnnnnnn'

    const useridChars = Array.from(userid)
    const timestampChars = Array.from(timestamp)
    const programIdChars = Array.from(programId)
    const channelIdChars = Array.from(channelId)

    const puLen = puData.length
    const halfLen = Math.floor(puLen / 2)

    let ddCalcu = ''
    for (let i = 0; i < halfLen; i++) {
      ddCalcu += puData[puLen - 1 - i]
      ddCalcu += puData[i]

      const xorKey = factorOfEncryption[4]
      const pushEncrypted = (arr: string[], idx1Based: number, fallbackChar: string) => {
        const idx = idx1Based - 1
        const charToEncrypt = arr[idx] ?? fallbackChar
        const codePoint = charToEncrypt.codePointAt(0) ?? 0
        let encryptedVal = (codePoint ^ xorKey) % 26
        encryptedVal += 97
        ddCalcu += String.fromCharCode(encryptedVal)
      }

      if (i === 1) pushEncrypted(useridChars, factorOfEncryption[0], 'e')
      else if (i === 2) pushEncrypted(timestampChars, factorOfEncryption[1], 't')
      else if (i === 3) pushEncrypted(programIdChars, factorOfEncryption[2], 'c')
      else if (i === 4) pushEncrypted(channelIdChars, factorOfEncryption[3], 'n')
    }

    if (puLen % 2 === 1) {
      ddCalcu += puData[halfLen]
    }

    u.searchParams.set('ddCalcu', ddCalcu)
  }

  if (!u.searchParams.get('sv')) u.searchParams.set('sv', '10004')
  if (!u.searchParams.get('ct')) u.searchParams.set('ct', 'android')

  return u.toString()
}

async function handleMiguMainRequest(id: string): Promise<string | null> {
  const cached = getCache(id)
  if (cached) return cached

  const { timestampMs, salt, sign } = getSignConfig(id)

  const url =
    `https://play.miguvideo.com/playurl/v1/play/playurl?` +
    `contId=${encodeURIComponent(id)}` +
    `&dolby=true&isMultiView=true&xh265=true&os=13&ott=false&rateType=3` +
    `&salt=${encodeURIComponent(salt)}` +
    `&sign=${encodeURIComponent(sign)}` +
    `&timestamp=${encodeURIComponent(timestampMs)}` +
    `&ua=oneplus-12&vr=true`

  const headers: Record<string, string> = {
    Host: 'play.miguvideo.com',
    appId: 'miguvideo',
    terminalId: 'android',
    'User-Agent': 'Dalvik/2.1.0+(Linux;+U;+Android+13;+oneplus-13+Build/TP1A.220624.014)',
    'MG-BH': 'true',
    appVersionName: '6.3.35',
    appVersion: '2600033500',
    'Phone-Info': 'oneplus-13|13',
    'X-UP-CLIENT-CHANNEL-ID': '2600033500-99000-201600010010028',
    'APP-VERSION-CODE': '260335005',
    Accept: '*/*',
    Connection: 'keep-alive'
  }

  const res = await fetch(url, { headers })
  if (!res.ok) return null

  const json: any = await res.json().catch(() => null)
  if (!json || typeof json !== 'object') return null

  // 上游有时会返回 code=403 + message=地区版权限制，此时 body.urlInfo 会是 null
  const upstreamCode = String(json?.code ?? '')
  if (upstreamCode && upstreamCode !== '0') {
    return null
  }

  const rawUrl = String(json?.body?.urlInfo?.url || '')
  if (!rawUrl.trim()) return null

  const ottUrl = miguEncryptedUrl(rawUrl)
  if (!ottUrl.trim()) return null

  setCache(id, ottUrl, CACHE_TTL_SECONDS)
  return ottUrl
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id') || '608807420'
    const debug = url.searchParams.get('debug') === '1'

    // 只允许数字 contId，避免开放代理
    if (!/^\d+$/.test(id)) {
      return new Response('Invalid id', {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' }
      })
    }

    if (debug) {
      const selfMd5 = md5('abc')
      const selfMd5Ok = selfMd5 === '900150983cd24fb0d6963f7d28e17f72'

      const { timestampMs, salt, sign } = getSignConfig(id)
      const playUrl =
        `https://play.miguvideo.com/playurl/v1/play/playurl?` +
        `contId=${encodeURIComponent(id)}` +
        `&dolby=true&isMultiView=true&xh265=true&os=13&ott=false&rateType=3` +
        `&salt=${encodeURIComponent(salt)}` +
        `&sign=${encodeURIComponent(sign)}` +
        `&timestamp=${encodeURIComponent(timestampMs)}` +
        `&ua=oneplus-12&vr=true`

      const headers: Record<string, string> = {
        Host: 'play.miguvideo.com',
        appId: 'miguvideo',
        terminalId: 'android',
        'User-Agent': 'Dalvik/2.1.0+(Linux;+U;+Android+13;+oneplus-13+Build/TP1A.220624.014)',
        'MG-BH': 'true',
        appVersionName: '6.3.35',
        appVersion: '2600033500',
        'Phone-Info': 'oneplus-13|13',
        'X-UP-CLIENT-CHANNEL-ID': '2600033500-99000-201600010010028',
        'APP-VERSION-CODE': '260335005',
        Accept: '*/*',
        Connection: 'keep-alive'
      }

      let upstreamStatus = -1
      let upstreamOk = false
      let upstreamJson: any = null
      let rawUrl = ''
      let ottUrl = ''

      try {
        const res = await fetch(playUrl, { headers })
        upstreamStatus = res.status
        upstreamOk = res.ok
        upstreamJson = await res.json().catch(() => null)
        rawUrl = String(upstreamJson?.body?.urlInfo?.url || '')
        ottUrl = rawUrl ? miguEncryptedUrl(rawUrl) : ''
      } catch (e) {
        upstreamJson = { error: String(e) }
      }

      return new Response(
        JSON.stringify(
          {
            id,
            cache_hit: !!getCache(id),
            self_check: { md5_abc: selfMd5, md5_ok: selfMd5Ok },
            sign: { timestampMs, salt, sign, ver8: '26000335' },
            upstream: {
              status: upstreamStatus,
              ok: upstreamOk,
              has_url: !!rawUrl,
              raw_url_preview: rawUrl ? rawUrl.slice(0, 120) : '',
              ott_url_preview: ottUrl ? ottUrl.slice(0, 120) : '',
              json_preview: upstreamJson
            }
          },
          null,
          2
        ),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
        }
      )
    }

    // 非 debug：解析并在失败时尽量给出可读错误
    const { timestampMs, salt, sign } = getSignConfig(id)
    const playUrl =
      `https://play.miguvideo.com/playurl/v1/play/playurl?` +
      `contId=${encodeURIComponent(id)}` +
      `&dolby=true&isMultiView=true&xh265=true&os=13&ott=false&rateType=3` +
      `&salt=${encodeURIComponent(salt)}` +
      `&sign=${encodeURIComponent(sign)}` +
      `&timestamp=${encodeURIComponent(timestampMs)}` +
      `&ua=oneplus-12&vr=true`

    const headers: Record<string, string> = {
      Host: 'play.miguvideo.com',
      appId: 'miguvideo',
      terminalId: 'android',
      'User-Agent': 'Dalvik/2.1.0+(Linux;+U;+Android+13;+oneplus-13+Build/TP1A.220624.014)',
      'MG-BH': 'true',
      appVersionName: '6.3.35',
      appVersion: '2600033500',
      'Phone-Info': 'oneplus-13|13',
      'X-UP-CLIENT-CHANNEL-ID': '2600033500-99000-201600010010028',
      'APP-VERSION-CODE': '260335005',
      Accept: '*/*',
      Connection: 'keep-alive'
    }

    // 先查缓存
    const cached = getCache(id)
    if (cached) {
      return new Response(null, { status: 302, headers: { ...corsHeaders, Location: cached } })
    }

    let upstreamStatus = -1
    let upstreamJson: any = null
    try {
      const res = await fetch(playUrl, { headers })
      upstreamStatus = res.status
      upstreamJson = await res.json().catch(() => null)
    } catch (e) {
      return new Response(`Resolve failed: ${String(e)}`, {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' }
      })
    }

    const upstreamCode = String(upstreamJson?.code ?? '')
    const rid = String(upstreamJson?.rid ?? '')
    const message = String(upstreamJson?.message ?? '')
    const rawUrl = String(upstreamJson?.body?.urlInfo?.url || '')

    // 版权地区限制：明确返回 451（Unavailable For Legal Reasons）
    if (upstreamCode === '403' && rid === 'COPYRIGHT_AREA_INVALID') {
      return new Response(
        JSON.stringify(
          {
            code: 'COPYRIGHT_AREA_INVALID',
            message: message || '由于版权问题，该节目不可在当前地区播放',
            upstream: { status: upstreamStatus, code: upstreamCode, rid }
          },
          null,
          2
        ),
        {
          status: 451,
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
        }
      )
    }

    if (!rawUrl) {
      return new Response(
        JSON.stringify(
          {
            code: 'RESOLVE_FAILED',
            message: '未获取到上游播放地址',
            upstream: {
              status: upstreamStatus,
              code: upstreamCode,
              rid,
              message,
              body: upstreamJson?.body ? 'present' : null
            }
          },
          null,
          2
        ),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
        }
      )
    }

    const ottUrl = miguEncryptedUrl(rawUrl)
    if (!ottUrl) {
      return new Response('Resolve failed: encrypt', {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' }
      })
    }

    setCache(id, ottUrl, CACHE_TTL_SECONDS)

    // 302 跳转到最终 URL（与 PHP header('location:') 一致）
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: ottUrl }
    })
  } catch (e) {
    console.error('[migu720p] error:', e)
    return new Response('Internal error', {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' }
    })
  }
})
