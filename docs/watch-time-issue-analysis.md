# 观看时长不增加问题分析报告

## 📋 问题概述
很多用户反映观看时长不增加，需要全面分析可能的原因，特别是安全策略（RLS）方面的问题。

## 🔍 系统架构分析

### 当前实现机制
1. **Presence追踪机制**（最新实现）
   - 使用 Supabase Realtime Presence 自动追踪用户在线状态
   - 上线时调用 `update_watch_time_from_presence('online')` 记录开始时间
   - 下线时调用 `update_watch_time_from_presence('offline')` 计算时长并累加
   - 每分钟执行一次 `sync_online_watch_time()` 处理异常断开

2. **旧的上报机制**（已废弃但函数仍存在）
   - `increment_daily_watch_time()` 函数：每次最多20秒，间隔至少10秒
   - 前端已移除调用，改用 Presence 追踪

## 🚨 发现的问题

### 1. **RLS策略缺失 - 严重问题**

**问题描述：**
- `user_daily_watch_time` 表只有 SELECT 策略，**没有 INSERT/UPDATE 策略**
- 虽然函数使用 `SECURITY DEFINER` 绕过 RLS，但如果表启用了 RLS 且没有相应的策略，可能导致问题

**当前RLS策略：**
```sql
-- 只有 SELECT 策略
CREATE POLICY "Users can view own daily watch time" 
ON public.user_daily_watch_time 
FOR SELECT 
USING (auth.uid() = user_id);
```

**缺失的策略：**
- ❌ 没有 INSERT 策略
- ❌ 没有 UPDATE 策略
- ❌ 没有 DELETE 策略（如果需要）

**影响：**
- `SECURITY DEFINER` 函数理论上可以绕过 RLS，但最佳实践是确保表有正确的策略
- 如果 RLS 配置不当，可能导致函数执行失败

### 2. **Presence追踪静默失败**

**问题位置：**
- `src/utils/presence.ts` - 所有错误都静默处理
- `supabase/functions/app-server/routes/presence.ts` - 错误也静默返回

**代码问题：**
```typescript
// presence.ts 中所有错误都静默处理
catch (error) {
  // 静默失败，不影响用户体验
}

// presence.ts Edge Function 中
if (error) {
  console.error('[Presence] Error recording online:', error)
  // 🔥 静默失败，不影响用户体验
  return successResponse({ success: false })
}
```

**影响：**
- 如果 Presence 连接失败、用户未登录、token 无效等情况，都会静默失败
- 用户无法知道观看时长是否在记录
- 无法排查问题

### 3. **用户认证验证过于严格**

**问题位置：**
```typescript
// supabase/functions/app-server/routes/presence.ts
// 🔥 如果用户已登录，验证 user_id 是否匹配（防止伪造）
if (authResult.user && authResult.user.id !== user_id) {
  console.warn(`[Presence] User ID mismatch: auth=${authResult.user.id}, body=${user_id}`)
  return errorResponse('Forbidden', 1, 403)
}
```

**问题：**
- `tryGetAuth` 是可选认证，但如果用户已登录但 ID 不匹配，会拒绝请求
- 如果前端传递错误的 user_id，会导致所有 Presence 事件失败

### 4. **Presence连接可能失败**

**问题：**
- Presence 连接依赖 Supabase Realtime 服务
- 如果网络不稳定、WebSocket 连接断开，Presence 事件可能无法触发
- 前端没有重连机制或错误提示

### 5. **sync_online_watch_time 可能不执行**

**问题：**
- Cron 任务依赖 `pg_cron` 扩展
- 如果 Cron 任务未正确配置或执行失败，异常断开的用户时长不会被同步
- 没有监控机制检查 Cron 任务是否正常运行

### 6. **update_watch_time_from_presence 函数逻辑问题**

**潜在问题：**
```sql
-- 上线时：只更新 last_updated_at，不累加时长
IF p_event_type = 'online' THEN
    INSERT INTO public.user_daily_watch_time (...)
    ON CONFLICT (user_id, watch_date)
    DO UPDATE SET last_updated_at = NOW();
    
-- 下线时：计算时长差并累加
ELSIF p_event_type = 'offline' THEN
    v_duration_seconds := EXTRACT(EPOCH FROM (NOW() - v_last_updated_at))::INTEGER;
    -- 累加到 total_seconds
```

**问题：**
- 如果用户频繁上下线，可能导致时长计算不准确
- 如果 `offline` 事件未触发（网络断开、浏览器崩溃），时长不会累加
- 依赖 `sync_online_watch_time` 每分钟同步，但可能有延迟

## 🔒 安全策略分析

### 当前安全措施（好的方面）

1. ✅ **函数使用 SECURITY DEFINER**
   - `update_watch_time_from_presence` 使用 `SECURITY DEFINER` 绕过 RLS
   - `sync_online_watch_time` 使用 `SECURITY DEFINER` 绕过 RLS

2. ✅ **用户ID验证**
   - Presence 接口验证 user_id 是否匹配认证用户
   - 防止伪造 user_id

3. ✅ **时长限制**
   - 单次时长不超过1小时（防止异常情况）
   - 同步任务限制单次不超过5分钟

### 安全策略问题

1. ❌ **RLS策略不完整**
   - `user_daily_watch_time` 表缺少 INSERT/UPDATE 策略
   - 虽然函数可以绕过，但不符合最佳实践

2. ⚠️ **静默失败导致无法排查**
   - 所有错误都静默处理，无法知道失败原因
   - 没有日志记录失败的用户和原因

3. ⚠️ **没有频率限制**
   - Presence 事件没有频率限制
   - 理论上可以频繁触发 online/offline 事件

## 💡 建议的修复方案

### 1. 补全 RLS 策略（高优先级）

```sql
-- 允许 service_role 和函数插入/更新观看时长记录
CREATE POLICY "Service role can manage watch time" 
ON public.user_daily_watch_time 
FOR ALL 
USING (true)
WITH CHECK (true);

-- 或者更严格的策略：只允许函数操作
-- 注意：SECURITY DEFINER 函数会以函数所有者身份执行，通常是 postgres 或 service_role
```

### 2. 添加错误日志和监控（高优先级）

```typescript
// presence.ts - 添加错误日志
catch (error) {
  console.error('[Presence] Failed to notify online:', {
    userId,
    error: error.message,
    timestamp: new Date().toISOString()
  })
  // 可以发送到监控系统
}
```

### 3. 添加 Presence 连接状态检查（中优先级）

```typescript
// 检查 Presence 连接状态
presenceChannel.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    console.log('[Presence] Connected')
  } else if (status === 'CHANNEL_ERROR') {
    console.error('[Presence] Connection error')
    // 可以显示提示给用户
  }
})
```

### 4. 添加调试接口（中优先级）

```typescript
// 添加调试接口，让用户查看自己的 Presence 状态和观看时长记录
export async function getWatchTimeDebugInfo() {
  // 返回：
  // - Presence 连接状态
  // - 最近的上线/下线事件
  // - 当前的观看时长记录
  // - 同步任务状态
}
```

### 5. 优化 sync_online_watch_time（低优先级）

```sql
-- 添加更详细的日志
CREATE OR REPLACE FUNCTION public.sync_online_watch_time()
RETURNS JSONB  -- 改为返回 JSONB，包含处理结果
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_record RECORD;
    v_duration_seconds INTEGER;
    v_updated_count INTEGER := 0;
    v_errors INTEGER := 0;
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
BEGIN
    -- 处理逻辑...
    
    RETURN jsonb_build_object(
        'success', true,
        'updated_count', v_updated_count,
        'errors', v_errors,
        'timestamp', NOW()
    );
END;
$$;
```

## 📊 排查步骤建议

1. **检查 RLS 策略**
   ```sql
   SELECT * FROM pg_policies 
   WHERE tablename = 'user_daily_watch_time';
   ```

2. **检查表是否启用 RLS**
   ```sql
   SELECT tablename, rowsecurity 
   FROM pg_tables 
   WHERE tablename = 'user_daily_watch_time';
   ```

3. **检查函数执行权限**
   ```sql
   SELECT routine_name, security_type, routine_owner
   FROM information_schema.routines
   WHERE routine_name IN ('update_watch_time_from_presence', 'sync_online_watch_time');
   ```

4. **检查 Cron 任务状态**
   ```sql
   SELECT * FROM cron.job 
   WHERE jobname = 'sync-watch-time-cron';
   ```

5. **检查最近的观看时长记录**
   ```sql
   SELECT user_id, watch_date, total_seconds, last_updated_at,
          NOW() - last_updated_at AS time_since_update
   FROM public.user_daily_watch_time
   WHERE watch_date = (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE
   ORDER BY last_updated_at DESC
   LIMIT 20;
   ```

6. **检查 Presence 事件日志**
   - 查看 Edge Function 日志中是否有 Presence 相关错误
   - 检查是否有用户ID不匹配的情况

## 🎯 优先级排序

1. **立即修复**：补全 RLS 策略
2. **高优先级**：添加错误日志和监控
3. **中优先级**：添加 Presence 连接状态检查
4. **低优先级**：优化同步任务和添加调试接口

## 📝 总结

观看时长不增加的主要原因可能是：

1. **RLS策略不完整** - 虽然函数可以绕过，但可能导致问题
2. **Presence追踪静默失败** - 用户无法知道是否在记录
3. **Presence连接问题** - 网络或WebSocket连接不稳定
4. **用户认证问题** - 用户未登录或token无效
5. **同步任务未执行** - Cron任务可能未正确配置

建议优先修复 RLS 策略问题，然后添加错误日志和监控，以便更好地排查问题。
