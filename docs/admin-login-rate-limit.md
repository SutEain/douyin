# 后台登录频率限制方案

## 问题描述

后台登录直接调用 Supabase Auth API (`signInWithPassword`)，缺少频率限制，容易被暴力破解攻击。

## 解决方案

### 1. 创建带频率限制的 Edge Function

创建了 `/auth/admin-login` 接口，包含：
- **IP 级别频率限制**：1分钟内最多5次登录尝试
- **自动锁定**：超过限制后锁定15分钟
- **攻击检测日志**：记录所有登录尝试（成功/失败）

### 2. 修改前端登录逻辑

前端不再直接调用 `supabaseClient.auth.signInWithPassword`，而是：
1. 调用 Edge Function `/auth/admin-login`
2. 获取返回的 session token
3. 使用 `setSession` 设置 Supabase 客户端会话

## 频率限制配置

| 操作 | 限制 | 窗口 | 锁定时间 |
|------|------|------|----------|
| 后台登录 | 5次 | 1分钟 | 15分钟 |

## 日志标签

- `[ADMIN_LOGIN_SUCCESS]` - 登录成功
- `[ADMIN_LOGIN_FAILED]` - 登录失败（密码错误）
- `[ADMIN_LOGIN_UNAUTHORIZED]` - 非管理员尝试登录
- `[ADMIN_LOGIN_ATTACK]` - 检测到攻击（频率限制触发）

## Supabase 内置限制

Supabase Auth 本身也有一些内置的速率限制：
- **默认限制**：每分钟约 10-20 次请求（取决于计划）
- **IP 限制**：单个 IP 的请求频率限制
- **账户锁定**：多次失败后可能临时锁定账户

但我们的 Edge Function 提供了：
1. **更严格的限制**（5次/分钟）
2. **更长的锁定时间**（15分钟）
3. **详细的攻击日志**
4. **IP 级别的追踪**

## 修改的文件

1. `supabase/functions/app-server/routes/admin.ts` - 新建后台登录处理函数
2. `supabase/functions/app-server/index.ts` - 添加路由
3. `admin/src/authProvider.ts` - 修改登录逻辑

## 使用说明

### 前端调用示例

```typescript
// 旧方式（已废弃）
const { data, error } = await supabaseClient.auth.signInWithPassword({
  email,
  password
})

// 新方式（带频率限制）
const response = await fetch(`${appServerUrl}/auth/admin-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
})
```

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
  AND action = 'admin_login'
ORDER BY last_attempt_at DESC;
```

### 2. 分析登录尝试

关注 Edge Function 日志中的：
- `[ADMIN_LOGIN_FAILED]` - 失败的登录尝试
- `[ADMIN_LOGIN_ATTACK]` - 被锁定的 IP
- `[ADMIN_LOGIN_UNAUTHORIZED]` - 非管理员尝试

## 注意事项

1. **Supabase 内置限制仍然有效**：Edge Function 的限制是额外的，Supabase 本身的限制也会生效
2. **误伤正常用户**：如果管理员忘记密码，频繁尝试可能导致被锁定
3. **分布式攻击**：如果攻击来自多个 IP，单个 IP 限制可能不够

## 进一步防护建议

如果需要更强的防护，可以考虑：

1. **更严格的限制**：
   - 降低 `maxAttempts`（如 3 次）
   - 增加 `lockDurationMs`（如 30 分钟）

2. **验证码**：
   - 对频繁失败的 IP 要求验证码
   - 使用 Cloudflare Turnstile 或 reCAPTCHA

3. **IP 黑名单**：
   - 自动将频繁攻击的 IP 加入黑名单
   - 在 Edge Function 入口检查黑名单

4. **WAF（Web Application Firewall）**：
   - 使用 Cloudflare 或其他 WAF 服务
   - 在边缘层过滤恶意请求
