# IP 黑名单使用指南

## 功能说明

IP 黑名单系统用于封禁恶意 IP，防止攻击。支持**临时封禁**和**永久封禁**两种模式。

## Supabase 的限制

**Supabase 本身没有直接的 IP 封禁功能**，但提供了：
- **Network Restrictions**：可以限制数据库连接的 IP 范围（在 Dashboard > Database > Settings > Network Restrictions）
- **Rate Limits**：Auth API 有内置的频率限制

我们的 IP 黑名单系统是在 **Edge Function 层面**实现的，可以：
- ✅ 封禁特定 IP 访问所有 Edge Function 接口
- ✅ 支持临时封禁（设置过期时间）
- ✅ 支持永久封禁（不设置过期时间）
- ✅ 自动封禁攻击 IP
- ✅ 管理员手动管理黑名单

## API 接口

### 1. 获取黑名单列表

```http
GET /admin/ip-blacklist?active_only=true
Authorization: Bearer <admin_token>
```

**参数**：
- `active_only` (可选)：是否只返回激活的封禁记录

**响应**：
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "ip_address": "192.168.1.100",
      "reason": "后台登录攻击",
      "banned_by": "admin_user_id",
      "banned_at": "2026-01-26T10:00:00Z",
      "expires_at": null,  // null 表示永久封禁
      "is_active": true,
      "banned_by_profile": {
        "id": "admin_user_id",
        "nickname": "管理员",
        "email": "admin@example.com"
      }
    }
  ]
}
```

### 2. 添加 IP 到黑名单

```http
POST /admin/ip-blacklist/add
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "ip_address": "192.168.1.100",
  "reason": "后台登录攻击",
  "permanent": true,  // true 表示永久封禁，false 或不设置表示临时封禁
  "expires_at": "2026-01-27T10:00:00Z"  // 可选，如果 permanent=true 则忽略
}
```

**参数说明**：
- `ip_address` (必需)：要封禁的 IP 地址
- `reason` (可选)：封禁原因
- `permanent` (可选)：是否永久封禁，默认 false
- `expires_at` (可选)：过期时间（ISO 8601 格式），如果 `permanent=true` 则忽略

**永久封禁示例**：
```json
{
  "ip_address": "192.168.1.100",
  "reason": "严重攻击行为",
  "permanent": true
}
```

**临时封禁示例**：
```json
{
  "ip_address": "192.168.1.100",
  "reason": "临时封禁测试",
  "expires_at": "2026-01-27T10:00:00Z"
}
```

### 3. 从黑名单移除 IP

```http
POST /admin/ip-blacklist/remove
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "ip_address": "192.168.1.100"
}
```

**注意**：移除操作不会删除记录，只是将 `is_active` 设为 `false`，保留历史记录。

## 自动封禁机制

系统会在以下情况自动封禁 IP：

### 1. 认证失败次数过多
- **触发条件**：1 分钟内认证失败 20 次
- **封禁时长**：**永久封禁**
- **原因**：`认证失败次数过多（临时锁定/频率限制）`

### 2. 后台登录攻击
- **触发条件**：1 分钟内后台登录尝试 5 次
- **封禁时长**：**永久封禁**
- **原因**：`后台登录尝试过于频繁`

## 数据库结构

```sql
CREATE TABLE ip_blacklist (
    id UUID PRIMARY KEY,
    ip_address TEXT NOT NULL UNIQUE,
    reason TEXT,
    banned_by UUID REFERENCES profiles(id),
    banned_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,  -- NULL 表示永久封禁
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 使用示例

### 使用 MCP 添加永久封禁

```typescript
// 通过 Edge Function API
const response = await fetch(`${appServerUrl}/admin/ip-blacklist/add`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    ip_address: '192.168.1.100',
    reason: '严重攻击行为',
    permanent: true  // 永久封禁
  })
})
```

### 使用 SQL 直接添加

```sql
-- 永久封禁
INSERT INTO ip_blacklist (ip_address, reason, is_active, expires_at)
VALUES ('192.168.1.100', '严重攻击行为', true, NULL);

-- 临时封禁（24小时）
INSERT INTO ip_blacklist (ip_address, reason, is_active, expires_at)
VALUES ('192.168.1.100', '临时封禁测试', true, NOW() + INTERVAL '24 hours');
```

### 查看被封禁的 IP

```sql
-- 查看所有激活的封禁（包括永久和临时）
SELECT 
    ip_address,
    reason,
    banned_at,
    expires_at,
    CASE 
        WHEN expires_at IS NULL THEN '永久封禁'
        WHEN expires_at > NOW() THEN format('临时封禁，%s 过期', expires_at)
        ELSE '已过期'
    END as ban_status
FROM ip_blacklist
WHERE is_active = TRUE
ORDER BY banned_at DESC;
```

## 注意事项

1. **永久封禁**：`expires_at` 为 `NULL` 表示永久封禁
2. **自动清理**：过期的临时封禁会自动标记为非激活（通过 `cleanup_expired_ip_bans()` 函数）
3. **移除操作**：移除 IP 不会删除记录，只是标记为非激活，保留历史记录
4. **IP 获取**：系统从 `x-real-ip` 或 `x-forwarded-for` 头获取真实 IP
5. **公开接口**：认证相关的公开接口（如 `/auth/tg-login`）不会检查 IP 黑名单，避免影响正常用户

## 监控建议

1. **定期检查**：定期查看黑名单列表，确认封禁是否合理
2. **分析攻击**：分析被封禁的 IP，了解攻击模式
3. **清理过期**：定期运行 `cleanup_expired_ip_bans()` 清理过期记录

## 相关函数

- `is_ip_banned(ip_address)` - 检查 IP 是否被封禁
- `cleanup_expired_ip_bans()` - 清理过期的封禁记录
