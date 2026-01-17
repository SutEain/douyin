-- 🎯 创建 Supabase Edge Functions Cron 任务
-- 使用 pg_net 扩展通过 HTTP 请求调用 Edge Function 的 /check-timeout 端点
-- Supabase cron 会自动使用 service_role 权限，无需手动配置 key

-- -----------------------------------------------------------------------------
-- 1. 确保 pg_net 扩展已启用
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_net;

-- -----------------------------------------------------------------------------
-- 2. 删除之前创建的复杂函数（如果存在）
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.call_check_timeout_edge_function() CASCADE;

-- -----------------------------------------------------------------------------
-- 3. 删除可能存在的旧 cron 任务
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_job_id INT;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'check-timeout-edge-function';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. 创建 cron 任务（每分钟执行一次）
-- -----------------------------------------------------------------------------
SELECT cron.schedule(
  'check-timeout-edge-function',
  '* * * * *',  -- 每分钟执行一次
  $$
  SELECT net.http_post(
    url := 'https://zhlkanxfucnsatafeqdp.supabase.co/functions/v1/bot-dice-game/check-timeout',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);

-- 注释
COMMENT ON EXTENSION pg_net IS 'PostgreSQL 扩展，用于发送 HTTP 请求（调用 Edge Function）';
