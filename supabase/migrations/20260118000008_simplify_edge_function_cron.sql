-- 🎯 简化版：使用 Supabase Dashboard Cron Jobs
-- Supabase Dashboard → Integrations → Cron 可以直接配置调用 Edge Function
-- 不需要手动设置 service_role_key，Supabase 会自动处理认证
-- 
-- 这个迁移文件只是删除之前复杂的函数，实际配置在 Dashboard 中完成

-- -----------------------------------------------------------------------------
-- 删除之前创建的复杂函数（如果存在）
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.call_check_timeout_edge_function() CASCADE;

-- -----------------------------------------------------------------------------
-- 删除之前创建的 cron 任务（如果存在）
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

-- 注释：实际配置请使用 Supabase Dashboard → Integrations → Cron
-- 配置步骤：
-- 1. 进入 Supabase Dashboard → Integrations → Cron
-- 2. 点击 "Create a new cron job"
-- 3. 配置如下：
--    - Name: check-timeout-edge-function
--    - Schedule: * * * * * (每分钟执行一次)
--    - SQL: SELECT net.http_post(
--             url := 'https://zhlkanxfucnsatafeqdp.supabase.co/functions/v1/bot-dice-game/check-timeout',
--             headers := '{"Content-Type": "application/json"}'::jsonb
--           );
-- 4. Supabase 会自动使用 service_role 权限调用 Edge Function
