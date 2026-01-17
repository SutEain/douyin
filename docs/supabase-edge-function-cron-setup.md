# Supabase Edge Functions Cron 设置说明

## 概述

已创建定时任务，每分钟自动调用 Edge Function 的 `/check-timeout` 端点，实现：
- ✅ 猜拳游戏超时检查并发送消息
- ✅ 骰子游戏超时检查并发送消息

## 设置步骤

### 1. 获取 Service Role Key

1. 登录 Supabase Dashboard
2. 进入 **Settings** → **API**
3. 找到 **service_role** key（⚠️ 注意：这是敏感密钥，不要泄露）
4. 复制完整的 key

### 2. 设置数据库配置

在 Supabase SQL Editor 中执行以下命令（替换 `YOUR_SERVICE_ROLE_KEY` 为实际的 key）：

```sql
ALTER DATABASE current_database() SET app.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
```

### 3. 验证 Cron 任务

执行以下 SQL 查询，确认 cron 任务已创建：

```sql
SELECT 
    jobid,
    schedule,
    command,
    active
FROM cron.job
WHERE jobname = 'check-timeout-edge-function';
```

应该看到：
- `schedule`: `* * * * *`（每分钟执行一次）
- `active`: `true`

### 4. 测试 Edge Function 调用

手动测试函数是否正常工作：

```sql
SELECT public.call_check_timeout_edge_function();
```

如果配置正确，应该看到：
- `NOTICE`: `Edge Function called: request_id=XXX, url=...`

### 5. 查看执行日志

在 Supabase Dashboard → **Edge Functions** → **bot-dice-game** → **Logs** 中查看：
- 是否有来自 cron 的请求
- 是否有超时房间被处理
- 是否有消息被发送

## 工作原理

1. **数据库 Cron 任务**（每分钟执行）
   - 调用 `call_check_timeout_edge_function()` 函数
   - 使用 `pg_net` 扩展发送 HTTP POST 请求

2. **Edge Function 处理**
   - 接收 `/check-timeout` 请求
   - 调用 `checkRpsTimeout()` 和 `checkDiceTimeout()`
   - 检查超时房间并发送消息

3. **数据库函数退款**
   - `refund_expired_dice_rooms()` 和 `check_rps_timeout()` 确保资金安全
   - 即使 Edge Function 失败，退款仍会执行

## 故障排查

### 问题：Cron 任务没有执行

**检查：**
```sql
-- 查看 cron 任务状态
SELECT * FROM cron.job WHERE jobname = 'check-timeout-edge-function';

-- 查看 cron 执行历史
SELECT * FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'check-timeout-edge-function')
ORDER BY start_time DESC 
LIMIT 10;
```

### 问题：Edge Function 没有被调用

**检查：**
1. 确认 `app.service_role_key` 已设置：
   ```sql
   SHOW app.service_role_key;
   ```

2. 手动测试函数：
   ```sql
   SELECT public.call_check_timeout_edge_function();
   ```

3. 查看 Edge Function 日志（Dashboard → Edge Functions → Logs）

### 问题：消息没有发送

**检查：**
1. Edge Function 日志中是否有错误
2. 数据库中是否有超时房间：
   ```sql
   -- 检查猜拳超时房间
   SELECT * FROM rps_rooms 
   WHERE status IN ('waiting', 'playing') 
     AND (created_at < NOW() - INTERVAL '30 seconds' OR updated_at < NOW() - INTERVAL '60 seconds');
   
   -- 检查骰子超时房间
   SELECT * FROM dice_rooms 
   WHERE status = 'waiting' AND expired_at < NOW();
   ```

## 安全注意事项

1. **Service Role Key 安全**
   - ⚠️ 不要将 key 提交到 Git 仓库
   - ⚠️ 不要在前端代码中使用 service_role key
   - ✅ 只在数据库配置或环境变量中存储

2. **权限控制**
   - `call_check_timeout_edge_function()` 使用 `SECURITY DEFINER`
   - 只有 `service_role` 可以执行
   - Edge Function 的 `/check-timeout` 端点不需要额外认证（因为是从数据库内部调用）

## 相关文件

- 迁移文件：`supabase/migrations/20260118000007_add_edge_function_cron.sql`
- Edge Function：`supabase/functions/bot-dice-game/app.ts`
- 超时检查函数：
  - `supabase/functions/bot-dice-game/features/rpsTimeout.ts`
  - `supabase/functions/bot-dice-game/features/diceTimeout.ts`
