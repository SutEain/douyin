# Cloudflare Worker 视频代理方案

## 📋 方案概述

使用 Cloudflare Workers 作为 Telegram 视频的代理层，实现：
- ✅ 隐藏 Bot Token（不暴露给前端）
- ✅ 全球 CDN 加速
- ✅ 自动缓存视频
- ✅ 零服务器带宽消耗
- ✅ 支持 Range 请求（进度条拖动）
- ✅ 免费额度充足（100K 请求/天）

---

## 🏗️ 架构设计

### 数据流

```
用户浏览器
    ↓ HTTPS
CF Worker (边缘节点)
    ↓ 获取 file_path
TG Bot API (/getFile)
    ↓ 返回文件路径
CF Worker
    ↓ 请求视频
TG File API
    ↓ 返回视频流
CF Worker (缓存 24h)
    ↓ 返回给用户
用户浏览器 (播放)
```

### 核心优势

1. **Token 安全**
   - Bot Token 存储在 CF Workers 环境变量
   - 前端只知道 Worker URL
   - 无法访问 Bot 的其他功能

2. **带宽优化**
   - 首次：TG → CF → 用户（走 CF 带宽）
   - 后续：CF 缓存 → 用户（秒级响应）
   - 你的服务器：0 带宽消耗

3. **性能提升**
   - 全球 200+ 边缘节点
   - 自动选择最近节点
   - 缓存命中率高

---

## 💻 实现代码

### 1. Worker 主代码

创建文件：`workers/tg-video-proxy/index.js`

```javascript
/**
 * Telegram 视频代理 Worker
 * 用途：安全地代理 TG 视频，隐藏 Bot Token，启用 CDN 缓存
 */

export default {
  async fetch(request, env, ctx) {
    // 处理 CORS 预检
    if (request.method === 'OPTIONS') {
      return handleCORS()
    }

    try {
      const url = new URL(request.url)
      const fileId = url.searchParams.get('file_id')

      // 验证参数
      if (!fileId) {
        return jsonResponse({ error: '缺少 file_id 参数' }, 400)
      }

      // 检查缓存（使用 file_id 作为缓存键）
      const cache = caches.default
      const cacheKey = new Request(url.toString(), request)
      let response = await cache.match(cacheKey)

      if (response) {
        console.log('Cache hit for file_id:', fileId)
        return response
      }

      console.log('Cache miss, fetching from Telegram for file_id:', fileId)

      // 1. 从 TG Bot API 获取文件信息
      const fileInfoUrl = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getFile?file_id=${fileId}`
      const fileInfoResponse = await fetch(fileInfoUrl)
      const fileInfo = await fileInfoResponse.json()

      if (!fileInfo.ok) {
        console.error('TG API error:', fileInfo)
        return jsonResponse({
          error: 'file_id 无效或已过期',
          detail: fileInfo.description
        }, 400)
      }

      const filePath = fileInfo.result.file_path
      const fileSize = fileInfo.result.file_size

      // 2. 检查文件大小（TG Bot API 限制 20MB）
      if (fileSize > 20 * 1024 * 1024) {
        return jsonResponse({
          error: '文件太大',
          message: '文件超过 20MB，无法通过 Bot API 获取',
          file_size: fileSize
        }, 400)
      }

      // 3. 构建视频 URL 并请求
      const videoUrl = `https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${filePath}`
      
      // 转发请求头（支持 Range 请求）
      const headers = new Headers()
      const range = request.headers.get('Range')
      if (range) {
        headers.set('Range', range)
      }

      const videoResponse = await fetch(videoUrl, { headers })

      // 4. 构建响应（包含 CORS 和缓存头）
      response = new Response(videoResponse.body, {
        status: videoResponse.status,
        statusText: videoResponse.statusText,
        headers: {
          // CORS 头
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
          
          // 内容类型
          'Content-Type': videoResponse.headers.get('Content-Type') || 'video/mp4',
          'Content-Length': videoResponse.headers.get('Content-Length'),
          
          // Range 支持
          'Accept-Ranges': 'bytes',
          'Content-Range': videoResponse.headers.get('Content-Range'),
          
          // 缓存控制
          'Cache-Control': 'public, max-age=86400', // 缓存 24 小时
          'CDN-Cache-Control': 'public, max-age=86400',
          'Cloudflare-CDN-Cache-Control': 'public, max-age=86400',
          
          // 其他
          'X-Content-Type-Options': 'nosniff',
          'X-Telegram-File-Id': fileId,
          'X-Cache-Status': 'MISS'
        }
      })

      // 5. 存储到缓存（仅缓存完整响应，不缓存 Range 请求）
      if (!range && videoResponse.status === 200) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()))
      }

      return response

    } catch (error) {
      console.error('Worker error:', error)
      return jsonResponse({
        error: '服务器错误',
        message: error.message
      }, 500)
    }
  }
}

// 辅助函数：JSON 响应
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  })
}

// 辅助函数：CORS 预检响应
function handleCORS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Max-Age': '86400'
    }
  })
}
```

### 2. Worker 配置文件

创建文件：`workers/tg-video-proxy/wrangler.toml`

```toml
name = "tg-video-proxy"
main = "index.js"
compatibility_date = "2024-01-01"

# 环境变量（本地开发用）
[vars]
# ENVIRONMENT = "development"

# 生产环境配置
[env.production]
routes = [
  { pattern = "video.yourdomain.com/*", zone_name = "yourdomain.com" }
]

# 开发环境配置
[env.development]
# 可以使用 *.workers.dev 域名测试
```

---

## 🚀 部署步骤

### 1. 安装 Wrangler CLI

```bash
npm install -g wrangler

# 或使用 npx
npx wrangler --version
```

### 2. 登录 Cloudflare

```bash
wrangler login
```

会打开浏览器进行授权。

### 3. 创建 Worker 项目

```bash
# 创建目录
mkdir -p workers/tg-video-proxy
cd workers/tg-video-proxy

# 复制上面的代码到 index.js 和 wrangler.toml
```

### 4. 设置环境变量（Bot Token）

```bash
# 设置生产环境的 Token
wrangler secret put TG_BOT_TOKEN

# 会提示输入 Token 值（不会显示在命令行）
# 输入: 8165687613:AAEiBn4rBmg_KIHTlK9xXK2i-3k1ZSpjcBk
```

### 5. 本地测试

```bash
# 启动本地开发服务器
wrangler dev

# 访问测试
curl "http://localhost:8787?file_id=你的file_id"
```

### 6. 部署到生产环境

```bash
# 部署
wrangler deploy

# 会输出 Worker URL，例如：
# https://tg-video-proxy.你的用户名.workers.dev
```

### 7. 绑定自定义域名（可选）

在 Cloudflare Dashboard:
1. 进入 Workers & Pages
2. 选择 `tg-video-proxy`
3. Settings → Triggers → Add Custom Domain
4. 输入: `video.yourdomain.com`

---

## 📱 前端集成

### 修改视频播放组件

```typescript
// src/pages/test/VideoTest.vue 或其他播放组件

// 原来的方式（暴露 Token）
// const videoUrl = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`

// 新方式（通过 CF Worker）
const videoUrl = `https://tg-video-proxy.你的用户名.workers.dev?file_id=${fileId}`

// 或使用自定义域名
// const videoUrl = `https://video.yourdomain.com?file_id=${fileId}`

// 直接播放
video.src = videoUrl
```

### 完整示例

```vue
<template>
  <div class="video-player">
    <video
      ref="videoEl"
      :src="videoUrl"
      controls
      playsinline
      @loadstart="onLoadStart"
      @canplay="onCanPlay"
      @error="onError"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  fileId: string
}>()

// CF Worker URL
const CF_WORKER_URL = 'https://tg-video-proxy.你的用户名.workers.dev'

// 构建视频 URL
const videoUrl = computed(() => {
  return `${CF_WORKER_URL}?file_id=${props.fileId}`
})

const videoEl = ref<HTMLVideoElement>()

function onLoadStart() {
  console.log('开始加载视频')
}

function onCanPlay() {
  console.log('视频可以播放')
}

function onError(e: Event) {
  console.error('视频加载失败:', e)
}
</script>
```

---

## 💰 成本分析

### Cloudflare Workers 定价

**免费版（Free Plan）:**
- ✅ 100,000 请求/天
- ✅ 10ms CPU 时间/请求
- ✅ 无限带宽
- ✅ 全球 CDN

**付费版（Paid Plan - $5/月）:**
- ✅ 10,000,000 请求/月（~333K/天）
- ✅ 50ms CPU 时间/请求
- ✅ 无限带宽
- ✅ 更高可用性

### 使用场景估算

**场景 1: 小型应用（1000 用户）**
- 每用户每天看 5 个视频
- 每个视频观看 3 次（缓存未命中）
- 请求数：1000 × 5 × 3 = 15,000/天
- **成本：免费版足够** ✅

**场景 2: 中型应用（10000 用户）**
- 每用户每天看 5 个视频
- 缓存命中率 80%
- 实际请求：10000 × 5 × 0.2 = 10,000/天
- **成本：免费版足够** ✅

**场景 3: 大型应用（100000 用户）**
- 每用户每天看 5 个视频
- 缓存命中率 90%
- 实际请求：100000 × 5 × 0.1 = 50,000/天
- **成本：免费版足够** ✅

### 对比其他方案

| 方案 | 月成本 | 带宽限制 | Token 安全 |
|------|--------|---------|-----------|
| **直接暴露 URL** | $0 | 无 | ❌ 暴露 |
| **Supabase 代理** | $25+ | 250GB | ✅ 安全 |
| **CF Worker** | $0-5 | 无限 | ✅ 安全 |
| **转存 OSS** | $10+ | 按量计费 | ✅ 安全 |

---

## 🔒 安全性说明

### Token 保护

1. **环境变量存储**
   - Token 存储在 CF Workers Secrets
   - 加密存储，无法通过 API 读取
   - 只能在 Worker 运行时访问

2. **前端隔离**
   - 前端只知道 Worker URL
   - 无法获取 Bot Token
   - 无法操作 Bot 的其他功能

3. **请求限制**
   - Worker 只接受 GET 请求
   - 只能获取视频，不能发送消息
   - 可添加 Rate Limiting

### 额外安全措施（可选）

**1. 添加签名验证**

```javascript
// 生成签名（在你的后端）
const signature = crypto.createHmac('sha256', SECRET_KEY)
  .update(file_id + timestamp)
  .digest('hex')

// Worker 验证签名
const url = `${WORKER_URL}?file_id=${fileId}&ts=${timestamp}&sig=${signature}`
```

**2. 添加 Rate Limiting**

```javascript
// 在 Worker 中使用 KV 存储
export default {
  async fetch(request, env, ctx) {
    const ip = request.headers.get('CF-Connecting-IP')
    
    // 检查请求频率
    const key = `rate:${ip}`
    const count = await env.KV.get(key)
    
    if (count && parseInt(count) > 100) {
      return jsonResponse({ error: '请求过于频繁' }, 429)
    }
    
    // 增加计数
    await env.KV.put(key, (parseInt(count) || 0) + 1, {
      expirationTtl: 60 // 1分钟过期
    })
    
    // 继续处理请求...
  }
}
```

**3. 添加域名白名单**

```javascript
// 只允许特定域名访问
const allowedOrigins = [
  'https://yourdomain.com',
  'https://t.me'
]

const origin = request.headers.get('Origin')
if (origin && !allowedOrigins.includes(origin)) {
  return jsonResponse({ error: '禁止访问' }, 403)
}
```

---

## 📊 监控和调试

### 查看日志

```bash
# 实时查看日志
wrangler tail

# 查看最近日志
wrangler tail --format pretty
```

### 查看分析数据

在 Cloudflare Dashboard:
1. Workers & Pages
2. 选择 `tg-video-proxy`
3. Metrics 标签页

可以看到：
- 请求数量
- 错误率
- CPU 使用时间
- 缓存命中率

### 测试工具

```bash
# 测试视频加载
curl -I "https://your-worker.workers.dev?file_id=xxx"

# 测试 Range 请求
curl -H "Range: bytes=0-1000" \
  "https://your-worker.workers.dev?file_id=xxx"

# 测试缓存
curl -I "https://your-worker.workers.dev?file_id=xxx" | grep -i cache
```

---

## 🔧 故障排查

### 常见问题

**1. 401 Unauthorized**
```
原因：Bot Token 未设置或错误
解决：wrangler secret put TG_BOT_TOKEN
```

**2. 504 Gateway Timeout**
```
原因：TG API 响应慢或文件太大
解决：检查文件大小，优化超时设置
```

**3. CORS 错误**
```
原因：响应头缺失
解决：确保所有响应都包含 CORS 头
```

**4. 视频无法播放**
```
原因：file_id 过期或无效
解决：重新获取 file_id，检查 TG API 响应
```

### 调试步骤

```bash
# 1. 检查 Worker 是否部署成功
curl https://your-worker.workers.dev

# 2. 测试简单请求
curl "https://your-worker.workers.dev?file_id=test"

# 3. 查看详细错误
wrangler tail --format pretty

# 4. 本地调试
wrangler dev
```

---

## 🎯 最佳实践

### 1. 智能缓存策略（动态缓存时间）

#### 方案 A：基于访问频率的动态缓存

```javascript
/**
 * 根据访问频率动态调整缓存时间
 * 访问越频繁，缓存时间越长
 */
async function getSmartCacheTime(fileId, env) {
  const statsKey = `stats:${fileId}`
  
  // 获取访问统计
  const stats = await env.KV.get(statsKey, { type: 'json' }) || {
    count: 0,
    lastAccess: Date.now()
  }
  
  // 更新统计
  stats.count++
  stats.lastAccess = Date.now()
  
  // 计算缓存时间（根据访问次数）
  let cacheTime
  if (stats.count > 100) {
    cacheTime = 86400 * 30  // 热门视频：30 天
  } else if (stats.count > 50) {
    cacheTime = 86400 * 7   // 流行视频：7 天
  } else if (stats.count > 10) {
    cacheTime = 86400 * 3   // 普通视频：3 天
  } else {
    cacheTime = 86400       // 冷门视频：1 天
  }
  
  // 保存统计（7天后统计自动过期）
  await env.KV.put(statsKey, JSON.stringify(stats), {
    expirationTtl: cacheTime
  })
  
  return cacheTime
}

// 在 Worker 中使用
const cacheTime = await getSmartCacheTime(fileId, env)
response.headers.set('Cache-Control', `public, max-age=${cacheTime}`)
```

#### 方案 B：基于时间衰减的缓存

```javascript
/**
 * 使用 LRU (Least Recently Used) 策略
 * 最近访问的视频保持缓存，长期无访问的自动过期
 */
async function getLRUCacheTime(fileId, env) {
  const now = Date.now()
  const statsKey = `lru:${fileId}`
  
  // 获取上次访问时间
  const lastAccess = await env.KV.get(statsKey)
  const lastAccessTime = lastAccess ? parseInt(lastAccess) : now
  
  // 计算距离上次访问的时间（天数）
  const daysSinceAccess = (now - lastAccessTime) / (1000 * 86400)
  
  // 根据访问间隔调整缓存时间
  let cacheTime
  if (daysSinceAccess < 1) {
    cacheTime = 86400 * 7   // 1天内访问过：缓存 7 天
  } else if (daysSinceAccess < 7) {
    cacheTime = 86400 * 3   // 7天内访问过：缓存 3 天
  } else if (daysSinceAccess < 30) {
    cacheTime = 86400       // 30天内访问过：缓存 1 天
  } else {
    cacheTime = 3600        // 超过30天：缓存 1 小时（即将过期）
  }
  
  // 更新访问时间（使用较长的过期时间存储统计）
  await env.KV.put(statsKey, now.toString(), {
    expirationTtl: 86400 * 90  // 统计数据保留 90 天
  })
  
  return cacheTime
}
```

#### 方案 C：综合策略（推荐）

```javascript
/**
 * 结合访问频率和时间衰减
 * 最优化的缓存策略
 */
async function getOptimalCacheTime(fileId, fileSize, env) {
  const now = Date.now()
  const statsKey = `cache:${fileId}`
  
  // 获取缓存统计
  const stats = await env.KV.get(statsKey, { type: 'json' }) || {
    count: 0,           // 总访问次数
    lastAccess: now,    // 最后访问时间
    firstAccess: now,   // 首次访问时间
    size: fileSize      // 文件大小
  }
  
  // 更新统计
  stats.count++
  stats.lastAccess = now
  
  // 计算指标
  const daysSinceFirst = (now - stats.firstAccess) / (1000 * 86400)
  const daysSinceLast = (now - stats.lastAccess) / (1000 * 86400)
  const avgAccessPerDay = stats.count / Math.max(daysSinceFirst, 1)
  
  // 动态计算缓存时间
  let cacheTime
  
  // 1. 超热门视频（每天访问 > 10 次）
  if (avgAccessPerDay > 10) {
    cacheTime = 86400 * 30  // 30 天
  }
  // 2. 热门视频（每天访问 > 5 次）
  else if (avgAccessPerDay > 5) {
    cacheTime = 86400 * 14  // 14 天
  }
  // 3. 活跃视频（最近 3 天内访问过）
  else if (daysSinceLast < 3) {
    cacheTime = 86400 * 7   // 7 天
  }
  // 4. 普通视频（最近一周内访问过）
  else if (daysSinceLast < 7) {
    cacheTime = 86400 * 3   // 3 天
  }
  // 5. 冷门视频（最近一月内访问过）
  else if (daysSinceLast < 30) {
    cacheTime = 86400       // 1 天
  }
  // 6. 僵尸视频（超过一月无访问）
  else {
    cacheTime = 3600        // 1 小时
  }
  
  // 小文件额外加成（小文件可以缓存更久）
  if (fileSize < 5 * 1024 * 1024) {
    cacheTime *= 2
  }
  
  // 保存统计
  await env.KV.put(statsKey, JSON.stringify(stats), {
    expirationTtl: 86400 * 90  // 统计保留 90 天
  })
  
  return cacheTime
}
```

---

### 使用智能缓存的完整示例

```javascript
export default {
  async fetch(request, env, ctx) {
    // ... 前面的代码 ...
    
    // 获取智能缓存时间
    const cacheTime = await getOptimalCacheTime(fileId, fileSize, env)
    
    console.log(`File ${fileId}: cacheTime = ${cacheTime}s (${cacheTime/86400} days)`)
    
    // 构建响应
    response = new Response(videoResponse.body, {
      headers: {
        // ... 其他头 ...
        
        // 动态缓存时间
        'Cache-Control': `public, max-age=${cacheTime}`,
        'CDN-Cache-Control': `public, max-age=${cacheTime}`,
        
        // 添加调试信息
        'X-Cache-TTL': cacheTime.toString(),
        'X-Access-Count': stats.count.toString(),
        'X-Days-Since-Last': Math.floor(daysSinceLast).toString()
      }
    })
    
    // ... 后面的代码 ...
  }
}
```

---

### 配置 KV 命名空间

需要在 `wrangler.toml` 中添加 KV 绑定：

```toml
name = "tg-video-proxy"
main = "index.js"

# KV 命名空间绑定
[[kv_namespaces]]
binding = "KV"
id = "你的KV命名空间ID"
```

创建 KV 命名空间：

```bash
# 创建 KV 命名空间
wrangler kv:namespace create "VIDEO_CACHE_STATS"

# 会返回类似：
# { binding = "KV", id = "abc123..." }

# 复制 id 到 wrangler.toml
```

---

### 监控缓存效率

添加统计端点：

```javascript
// 添加管理端点查看缓存统计
if (url.pathname === '/stats' && url.searchParams.get('file_id')) {
  const fileId = url.searchParams.get('file_id')
  const stats = await env.KV.get(`cache:${fileId}`, { type: 'json' })
  
  return jsonResponse({
    file_id: fileId,
    stats: stats || { error: '无统计数据' }
  })
}
```

查看统计：
```bash
curl "https://your-worker.workers.dev/stats?file_id=xxx"
```

---

### 成本优化

**KV 存储定价：**
- 免费版：1GB 存储 + 100,000 读取/天
- 付费版：$0.50/GB/月 + $0.50/百万次读取

**统计数据大小估算：**
- 每个 file_id 统计：~200 字节
- 100万个视频：~200MB
- **月成本：~$0.10** 💰

**优势：**
- ✅ 热门视频自动延长缓存
- ✅ 冷门视频自动清理
- ✅ 减少 TG API 调用
- ✅ 降低总体成本

### 2. 错误处理

```javascript
// 重试机制
async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options)
      if (response.ok) return response
    } catch (error) {
      if (i === retries - 1) throw error
      await new Promise(r => setTimeout(r, 1000 * (i + 1)))
    }
  }
}
```

### 3. 性能优化

```javascript
// 使用 Cache API 存储 file_path 映射
// 避免每次都调用 getFile API
const cacheKey = `path:${fileId}`
let filePath = await env.KV.get(cacheKey)

if (!filePath) {
  // 调用 getFile API
  // 存储到 KV，有效期 7 天
  await env.KV.put(cacheKey, filePath, {
    expirationTtl: 86400 * 7
  })
}
```

---

## 📝 总结

### 优势

✅ **安全性**：Bot Token 完全隐藏  
✅ **性能**：全球 CDN，缓存命中率高  
✅ **成本**：免费版足够大部分应用  
✅ **可扩展**：支持百万级请求  
✅ **维护简单**：无需管理服务器  

### 适用场景

- ✅ TG Mini App 视频播放
- ✅ Bot 媒体内容分发
- ✅ 需要隐藏 Bot Token
- ✅ 需要全球访问加速
- ✅ 预算有限的项目

### 不适用场景

- ❌ 视频需要加密或 DRM
- ❌ 需要实时转码
- ❌ 需要复杂的权限控制
- ❌ 视频 > 20MB（需要转存方案）

---

## 🔗 相关链接

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [本项目其他文档](./backend-plan.md)

---

**创建时间：** 2025-01-31  
**最后更新：** 2025-01-31  
**版本：** 1.0.0

