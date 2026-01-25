-- 🎯 检查观看时长系统的 RLS 策略和安全配置
-- 用于诊断观看时长不增加的问题

-- 1. 检查 user_daily_watch_time 表是否启用 RLS
SELECT 
    schemaname,
    tablename,
    rowsecurity AS rls_enabled
FROM pg_tables
WHERE tablename = 'user_daily_watch_time'
  AND schemaname = 'public';

-- 2. 检查 user_daily_watch_time 表的所有 RLS 策略
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd AS command_type,  -- SELECT, INSERT, UPDATE, DELETE, ALL
    qual AS using_expression,
    with_check AS with_check_expression
FROM pg_policies
WHERE tablename = 'user_daily_watch_time'
  AND schemaname = 'public'
ORDER BY cmd, policyname;

-- 3. 检查 user_video_watch_time 表的 RLS 策略
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd AS command_type,
    qual AS using_expression,
    with_check AS with_check_expression
FROM pg_policies
WHERE tablename = 'user_video_watch_time'
  AND schemaname = 'public'
ORDER BY cmd, policyname;

-- 4. 检查相关函数的权限和安全类型
SELECT 
    routine_schema,
    routine_name,
    routine_type,
    security_type,  -- DEFINER 或 INVOKER
    routine_owner
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'update_watch_time_from_presence',
    'sync_online_watch_time',
    'increment_daily_watch_time',
    'get_watch_time_reward_status',
    'claim_watch_time_reward'
  )
ORDER BY routine_name;

-- 5. 检查函数的执行权限（GRANT）
SELECT 
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    r.rolname AS granted_to_role,
    pr.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
LEFT JOIN (
    SELECT 
        object_name,
        grantee,
        privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name IN (
        'update_watch_time_from_presence',
        'sync_online_watch_time'
      )
) pr ON pr.object_name = p.proname
LEFT JOIN pg_roles r ON r.rolname = pr.grantee
WHERE n.nspname = 'public'
  AND p.proname IN (
    'update_watch_time_from_presence',
    'sync_online_watch_time',
    'increment_daily_watch_time',
    'get_watch_time_reward_status',
    'claim_watch_time_reward'
  )
ORDER BY p.proname, r.rolname;

-- 6. 检查今日观看时长记录统计（用于验证数据是否在增长）
SELECT 
    COUNT(*) AS total_records,
    COUNT(DISTINCT user_id) AS unique_users,
    SUM(total_seconds) AS total_seconds_sum,
    AVG(total_seconds) AS avg_seconds_per_user,
    MAX(total_seconds) AS max_seconds,
    MIN(total_seconds) AS min_seconds,
    MAX(last_updated_at) AS latest_update,
    NOW() - MAX(last_updated_at) AS time_since_last_update
FROM public.user_daily_watch_time
WHERE watch_date = (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;

-- 7. 检查最近1小时内的观看时长更新情况
SELECT 
    user_id,
    watch_date,
    total_seconds,
    last_updated_at,
    NOW() - last_updated_at AS time_since_update
FROM public.user_daily_watch_time
WHERE last_updated_at >= NOW() - INTERVAL '1 hour'
ORDER BY last_updated_at DESC
LIMIT 20;

-- 8. 检查 sync_online_watch_time Cron 任务状态
SELECT 
    jobid,
    jobname,
    schedule,
    command,
    active,
    nodename,
    nodeport,
    database,
    username
FROM cron.job
WHERE jobname = 'sync-watch-time-cron'
   OR command LIKE '%sync_online_watch_time%';

-- 9. 检查是否有长时间未更新的记录（可能异常断开）
SELECT 
    user_id,
    watch_date,
    total_seconds,
    last_updated_at,
    NOW() - last_updated_at AS time_since_update,
    EXTRACT(EPOCH FROM (NOW() - last_updated_at))::INTEGER AS seconds_since_update
FROM public.user_daily_watch_time
WHERE watch_date = (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE
  AND last_updated_at < NOW() - INTERVAL '1 minute'
  AND last_updated_at > NOW() - INTERVAL '1 hour'
ORDER BY last_updated_at ASC
LIMIT 20;

-- 10. 检查表的所有者权限
SELECT 
    t.tablename,
    t.tableowner,
    CASE 
        WHEN t.rowsecurity THEN 'RLS Enabled'
        ELSE 'RLS Disabled'
    END AS rls_status,
    COUNT(p.policyname) AS policy_count
FROM pg_tables t
LEFT JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = t.schemaname
WHERE t.tablename IN ('user_daily_watch_time', 'user_video_watch_time')
  AND t.schemaname = 'public'
GROUP BY t.tablename, t.tableowner, t.rowsecurity;

-- 11. 测试函数是否可以正常执行（需要替换为实际用户ID）
-- SELECT public.update_watch_time_from_presence(
--     '00000000-0000-0000-0000-000000000000'::UUID,  -- 替换为实际用户ID
--     'online'::TEXT
-- );

-- 12. 检查是否有权限错误（查看最近的错误日志）
-- 注意：这需要在 Supabase Dashboard 的 Logs 中查看
-- 或者通过 Edge Function 日志查看 Presence 相关错误
