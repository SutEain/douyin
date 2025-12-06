/* eslint-disable no-undef */
/* global TG_FILE_CACHE, TG_BOT_TOKEN */

const CACHE_TTL_SECONDS = 259200 // 3 天
const FETCH_TIMEOUT_MS = 30000 // 30秒超时
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const KV_UPDATE_INTERVAL = 3600 // ✅ 1小时才更新一次访问时间（减少KV写入）

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  const fileId = url.searchParams.get('file_id')
  
  if (!fileId) {
    return new Response('Missing file_id parameter', { 
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    })
  }

  try {
    const cache = caches.default
    const now = Date.now()
    
    // 检查缓存是否过期
    const lastAccessStr = await TG_FILE_CACHE.get(fileId)
    const lastAccess = lastAccessStr ? Number(lastAccessStr) : 0
    const shouldRefresh = now - lastAccess > CACHE_TTL_SECONDS * 1000

    // 构建统一的缓存键
    const baseCacheKey = new Request(
      `${url.origin}${url.pathname}?file_id=${fileId}`,
      { method: 'GET' }
    )

    // 尝试从缓存获取
    if (!shouldRefresh) {
      const cached = await cache.match(baseCacheKey)
      
      if (cached) {
        console.log(`[Cache Hit] fileId: ${fileId}`)
        
        // ✅ 只在距离上次更新超过1小时才写 KV（大幅减少写入）
        const shouldUpdateAccess = (now - lastAccess) > KV_UPDATE_INTERVAL * 1000
        if (shouldUpdateAccess) {
          // 不要 await，让它异步执行，不阻塞响应
          TG_FILE_CACHE.put(fileId, String(now), { 
            expirationTtl: CACHE_TTL_SECONDS 
          }).catch(err => console.error('[KV Update Error]', err))
        }
        
        // 如果是Range请求，从缓存文件中提取Range
        const rangeHeader = request.headers.get('Range')
        if (rangeHeader) {
          return handleRangeRequest(cached.clone(), rangeHeader)
        }
        
        return cached
      }
    }

    console.log(`[Cache Miss] fileId: ${fileId}`)

    // 从Telegram获取完整文件
    const originResp = await fetchFromTelegram(fileId, TG_BOT_TOKEN)
    
    if (!originResp.ok) {
      console.error(`[Telegram Error] fileId: ${fileId}, status: ${originResp.status}`)
      return originResp
    }

    // 检查文件大小
    const contentLength = originResp.headers.get('Content-Length')
    if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
      console.warn(`[File Too Large] fileId: ${fileId}, size: ${contentLength}`)
      // 文件太大，不缓存，直接返回
      const rangeHeader = request.headers.get('Range')
      if (rangeHeader) {
        return fetchFromTelegram(fileId, TG_BOT_TOKEN, rangeHeader)
      }
      return originResp
    }

    // 缓存完整文件
    if (originResp.status === 200) {
      const responseToCache = new Response(originResp.body, {
        status: 200,
        statusText: 'OK',
        headers: {
          'Content-Type': originResp.headers.get('Content-Type') || 'video/mp4',
          'Content-Length': originResp.headers.get('Content-Length'),
          'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*'
        }
      })
      
      // ✅ 存储到缓存（异步执行，不阻塞响应）
      cache.put(baseCacheKey, responseToCache.clone()).catch(err => 
        console.error('[Cache Put Error]', err)
      )
      
      // ✅ 只在首次缓存时写 KV
      TG_FILE_CACHE.put(fileId, String(now), { 
        expirationTtl: CACHE_TTL_SECONDS 
      }).catch(err => console.error('[KV Put Error]', err))
      
      console.log(`[Cached] fileId: ${fileId}`)
      
      // 如果是Range请求，返回Range响应
      const rangeHeader = request.headers.get('Range')
      if (rangeHeader) {
        return handleRangeRequest(responseToCache.clone(), rangeHeader)
      }
      
      return responseToCache
    }

    return originResp
    
  } catch (error) {
    console.error(`[Worker Error] fileId: ${fileId}, error: ${error.message}`)
    return new Response(`Internal Server Error: ${error.message}`, { 
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    })
  }
}

/**
 * 处理Range请求（从完整缓存文件中提取Range）
 */
async function handleRangeRequest(response, rangeHeader) {
  try {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
    if (!match) {
      console.warn(`[Invalid Range] header: ${rangeHeader}`)
      return response
    }

    const buffer = await response.arrayBuffer()
    const totalSize = buffer.byteLength
    
    const start = parseInt(match[1])
    const end = match[2] ? parseInt(match[2]) : totalSize - 1
    
    if (start >= totalSize || end >= totalSize || start > end) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: {
          'Content-Range': `bytes */${totalSize}`,
          'Content-Type': response.headers.get('Content-Type') || 'video/mp4'
        }
      })
    }

    const slice = buffer.slice(start, end + 1)
    
    console.log(`[Range Request] bytes ${start}-${end}/${totalSize}`)

    return new Response(slice, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': slice.byteLength.toString(),
        'Content-Type': response.headers.get('Content-Type') || 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error) {
    console.error(`[Range Error] ${error.message}`)
    return response
  }
}

/**
 * 从Telegram Bot API获取文件
 */
async function fetchFromTelegram(fileId, botToken, rangeHeader = null) {
  try {
    // 1. 获取文件元数据
    const metaUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    
    const metaResp = await fetch(metaUrl, { 
      signal: controller.signal 
    })
    clearTimeout(timeoutId)
    
    if (!metaResp.ok) {
      return new Response(`Telegram API error: ${metaResp.status}`, {
        status: 502,
        headers: { 'Content-Type': 'text/plain' }
      })
    }

    const meta = await metaResp.json()
    
    if (!meta.ok || !meta.result || !meta.result.file_path) {
      return new Response(JSON.stringify(meta), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // 2. 下载文件
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${meta.result.file_path}`
    
    const headers = {}
    if (rangeHeader) {
      headers['Range'] = rangeHeader
    }
    
    const controller2 = new AbortController()
    const timeoutId2 = setTimeout(() => controller2.abort(), FETCH_TIMEOUT_MS)
    
    const fileResp = await fetch(fileUrl, { 
      headers,
      signal: controller2.signal 
    })
    clearTimeout(timeoutId2)
    
    return fileResp
    
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('[Timeout] Telegram request timeout')
      return new Response('Request Timeout', { 
        status: 504,
        headers: { 'Content-Type': 'text/plain' }
      })
    }
    
    console.error(`[Telegram Fetch Error] ${error.message}`)
    return new Response(`Telegram fetch error: ${error.message}`, { 
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    })
  }
}

