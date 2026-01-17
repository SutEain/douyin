# Supabase Edge Functions Cron 设置说明

## 概述

使用 Supabase Dashboard 自带的 Cron Jobs 功能，每分钟自动调用 Edge Function 的 `/check-timeout` 端点，实现：
- ✅ 猜拳游戏超时检查并发送消息
- ✅ 骰子游戏超时检查并发送消息

## 设置步骤（已自动完成！）

Cron 任务已通过数据库迁移自动创建，无需手动配置。

### 验证 Cron 任务

执行以下 SQL 查询确认：

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

或者在 Supabase Dashboard → **Integrations** → **Cron Jobs** 中查看：
- 任务状态：`Active`
- 执行历史：最近执行时间和结果

### 5. 查看执行日志

在 Supabase Dashboard → **Edge Functions** → **bot-dice-game** → **Logs** 中查看：
- 是否有来自 cron 的请求
- 是否有超时房间被处理
- 是否有消息被发送

## 工作原理

1. **Supabase Dashboard Cron**（每分钟执行）
   - 自动使用 `service_role` 权限
   - 通过 `net.http_post` 调用 Edge Function
   - 无需手动配置 key，Supabase 自动处理认证

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
1. 在 Dashboard → **Integrations** → **Cron Jobs** 中查看：
   - 任务是否 `Active`
   - 最近执行时间
   - 是否有错误日志

2. 手动测试 Edge Function：
   ```bash
   curl -X POST https://zhlkanxfucnsatafeqdp.supabase.co/functions/v1/bot-dice-game/check-timeout \
     -H "Content-Type: application/json"
   ```

3. 查看 Edge Function 日志（Dashboard → Edge Functions → bot-dice-game → Logs）

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

1. **自动权限管理**
   - ✅ Supabase Dashboard Cron 自动使用 `service_role` 权限
   - ✅ 无需手动配置 key，避免泄露风险
   - ✅ 权限由 Supabase 平台统一管理

2. **权限控制**
   - Edge Function 的 `/check-timeout` 端点不需要额外认证（因为是从 Supabase 内部调用）
   - 如果需要在 Edge Function 中验证调用来源，可以检查请求头

## 相关文件

- 迁移文件：`supabase/migrations/20260118000008_simplify_edge_function_cron.sql`
- Edge Function：`supabase/functions/bot-dice-game/app.ts`
- 超时检查函数：
  - `supabase/functions/bot-dice-game/features/rpsTimeout.ts`
  - `supabase/functions/bot-dice-game/features/diceTimeout.ts`

## 工作原理

1. **数据库 Cron 任务**（每分钟执行）
   - 使用 `pg_net` 扩展发送 HTTP POST 请求
   - 自动使用 `service_role` 权限（无需手动配置 key）
   - 调用 Edge Function 的 `/check-timeout` 端点

2. **Edge Function 处理**
   - 接收 `/check-timeout` 请求
   - 调用 `checkRpsTimeout()` 和 `checkDiceTimeout()`
   - 检查超时房间并发送消息

3. **数据库函数退款**
   - `refund_expired_dice_rooms()` 和 `check_rps_timeout()` 确保资金安全
   - 即使 Edge Function 失败，退款仍会执行
