-- 🎯 创建定期同步观看时长的 Cron 任务
-- 每分钟执行一次，处理异常断开的用户观看时长
-- 调用 sync_online_watch_time() 函数，自动累加在线用户的观看时长

-- -----------------------------------------------------------------------------
-- 1. 确保 pg_cron 扩展已启用
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- -----------------------------------------------------------------------------
-- 2. 删除可能存在的旧 cron 任务
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_job_id INT;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'sync-watch-time-cron';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. 创建 cron 任务（每分钟执行一次）
-- -----------------------------------------------------------------------------
SELECT cron.schedule(
  'sync-watch-time-cron',
  '* * * * *',  -- 每分钟执行一次（cron格式：分 时 日 月 周）
  $$ 
  SELECT public.sync_online_watch_time();
  $$
);

-- 注释
COMMENT ON EXTENSION pg_cron IS 'PostgreSQL 扩展，用于定时执行任务';

-- 🎯 说明：
-- 1. 此任务每分钟执行一次，调用 sync_online_watch_time() 函数
-- 2. sync_online_watch_time() 函数会：
--    - 查找所有 last_updated_at 超过1分钟但小于1小时的记录（可能还在线但异常断开）
--    - 计算从上次更新到现在的时长差
--    - 累加时长到 total_seconds 并更新 last_updated_at
--    - 限制单次时长不超过5分钟（防止异常情况）
-- 3. 这样可以确保即使用户异常断开（网络问题、浏览器崩溃等），观看时长也能被正确记录
