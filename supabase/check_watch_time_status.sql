-- 🎯 检查观看时长记录状态
-- 用于验证观看时长系统是否正常工作

-- 1. 检查 user_daily_watch_time 表结构
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'user_daily_watch_time'
ORDER BY ordinal_position;

-- 2. 检查今日观看时长记录（最近10条）
SELECT 
    user_id,
    watch_date,
    total_seconds,
    last_updated_at,
    NOW() - last_updated_at AS time_since_last_update
FROM public.user_daily_watch_time
WHERE watch_date = (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE
ORDER BY last_updated_at DESC
LIMIT 10;

-- 3. 检查是否有定期同步的 cron job
SELECT 
    jobid,
    jobname,
    schedule,
    command,
    active,
    nodename,
    nodeport
FROM cron.job
WHERE command LIKE '%sync_online_watch_time%' 
   OR command LIKE '%watch_time%'
   OR jobname LIKE '%watch_time%';

-- 4. 检查 update_watch_time_from_presence 函数是否存在
SELECT 
    routine_name,
    routine_type,
    data_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'update_watch_time_from_presence';

-- 5. 检查 sync_online_watch_time 函数是否存在
SELECT 
    routine_name,
    routine_type,
    data_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'sync_online_watch_time';

-- 6. 检查最近24小时的观看时长记录统计
SELECT 
    watch_date,
    COUNT(*) AS user_count,
    SUM(total_seconds) AS total_seconds_sum,
    AVG(total_seconds) AS avg_seconds_per_user,
    MAX(total_seconds) AS max_seconds,
    MIN(total_seconds) AS min_seconds
FROM public.user_daily_watch_time
WHERE watch_date >= (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE - INTERVAL '1 day'
GROUP BY watch_date
ORDER BY watch_date DESC;

-- 7. 检查需要同步的用户（last_updated_at 超过1分钟但小于1小时）
SELECT 
    user_id,
    watch_date,
    total_seconds,
    last_updated_at,
    EXTRACT(EPOCH FROM (NOW() - last_updated_at))::INTEGER AS seconds_since_update
FROM public.user_daily_watch_time
WHERE watch_date = (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE
  AND last_updated_at < NOW() - INTERVAL '1 minute'
  AND last_updated_at > NOW() - INTERVAL '1 hour'
ORDER BY last_updated_at ASC
LIMIT 20;
