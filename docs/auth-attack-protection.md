# 认证攻击防护措施

## 问题描述

日志显示频繁的 "Invalid session" 错误和 Edge Function 频繁重启，可能是受到攻击：
- 频繁的 `Error: Invalid session at requireAuth`
- Edge Function 频繁 `booted` 和 `shutdown`
- 可能是有人用无效 token 频繁请求需要认证的接口

## 添加的防护措施

### 1. IP 级别的频率限制

在 `requireAuth` 函数中添加了 IP 级别的频率限制：

```typescript
// 1分钟内最多20次认证失败
// 超过后锁定5分钟
const rateLimitResult = await checkRateLimit(clientIp, 'ip', 'auth_failed', {
  maxAttempts: 20,      // 1分钟内最多20次失败
  windowMs: 60000,      // 1分钟窗口
  lockDurationMs: 300000 // 5分钟锁定
})
```

**效果**：
- 防止单个 IP 频繁尝试无效 token
- 超过限制后自动锁定 5 分钟
- 减少无效请求对服务器的压力

### 2. 攻击检测和日志记录

添加了详细的攻击检测日志：

```typescript
// 记录认证失败
console.warn(
  `[AUTH_FAILED] Invalid session from IP: ${clientIp}, Error: ${error?.message || 'No user'}`
)

// 记录锁定信息
console.warn(
  `[AUTH_ATTACK] IP ${clientIp} 认证失败次数过多，已锁定`
)

// 记录认证错误（401/429）
console.warn(
  `[AUTH_ERROR] ${error.status} from IP: ${clientIp || 'unknown'}, Route: ${route}, Message: ${error.message}`
)
```

**效果**：
- 便于分析攻击模式和来源 IP
- 可以及时发现异常行为
- 为后续防护提供数据支持

### 3. 改进错误处理

在主入口添加了更详细的错误日志：

```typescript
if (error instanceof HttpError) {
  // 记录认证失败的错误（用于分析攻击）
  if (error.status === 401 || error.status === 429) {
    const clientIp = getClientIp(req)
    const route = extractRoute(req.url)
    console.warn(
      `[AUTH_ERROR] ${error.status} from IP: ${clientIp || 'unknown'}, Route: ${route}, Message: ${error.message}`
    )
  }
  return errorResponse(error.message, 1, error.status)
}
```

**效果**：
- 记录攻击的 IP 和路由
- 便于追踪攻击路径
- 避免错误导致 Edge Function 频繁重启

## 防护策略

### 频率限制配置

| 操作 | 限制 | 窗口 | 锁定时间 |
|------|------|------|----------|
| 认证失败 | 20次 | 1分钟 | 5分钟 |

### 日志标签

- `[AUTH_FAILED]` - 认证失败（Invalid session）
- `[AUTH_ATTACK]` - 检测到攻击（频率限制触发）
- `[AUTH_ERROR]` - 认证相关错误（401/429）

## 监控建议

### 1. 查看攻击日志

```sql
-- 查看被锁定的 IP
SELECT 
    identifier as ip,
    attempt_count,
    last_attempt_at,
    locked_until,
    CASE 
        WHEN locked_until > NOW() THEN '锁定中'
        ELSE '已解锁'
    END as status
FROM verification_rate_limits
WHERE type = 'ip' 
  AND action = 'auth_failed'
  AND locked_until > NOW()
ORDER BY last_attempt_at DESC;
```

### 2. 分析攻击模式

关注日志中的：
- 频繁出现 `[AUTH_FAILED]` 的 IP
- `[AUTH_ATTACK]` 锁定的 IP
- 特定路由的认证失败

### 3. 进一步防护措施（可选）

如果需要更强的防护，可以考虑：

1. **更严格的频率限制**：
   - 降低 `maxAttempts`（如 10 次）
   - 增加 `lockDurationMs`（如 15 分钟）

2. **IP 黑名单**：
   - 自动将频繁攻击的 IP 加入黑名单
   - 在 Edge Function 入口检查黑名单

3. **验证码**：
   - 对频繁失败的 IP 要求验证码
   - 使用 Cloudflare Turnstile 或 reCAPTCHA

4. **WAF（Web Application Firewall）**：
   - 使用 Cloudflare 或其他 WAF 服务
   - 在边缘层过滤恶意请求

## 注意事项

1. **误伤正常用户**：
   - 如果正常用户 token 过期，频繁刷新可能导致被锁定
   - 建议监控日志，确保不会误伤

2. **分布式攻击**：
   - 如果攻击来自多个 IP，单个 IP 限制可能不够
   - 需要考虑全局频率限制或更高级的防护

3. **Edge Function 重启**：
   - 频繁重启可能是攻击导致的，也可能是其他原因
   - 需要进一步分析日志，找出根本原因

## 修改的文件

1. `supabase/functions/app-server/lib/auth.ts`
   - 添加 IP 级别频率限制
   - 添加攻击检测日志

2. `supabase/functions/app-server/index.ts`
   - 改进错误处理
   - 添加认证错误日志

## 测试建议

1. **测试频率限制**：
   - 用无效 token 连续请求 20+ 次
   - 验证是否被锁定 5 分钟

2. **测试日志**：
   - 检查日志中是否有 `[AUTH_FAILED]` 和 `[AUTH_ATTACK]` 记录
   - 验证 IP 和路由信息是否正确

3. **监控效果**：
   - 观察 Edge Function 重启频率是否降低
   - 检查无效请求是否减少
