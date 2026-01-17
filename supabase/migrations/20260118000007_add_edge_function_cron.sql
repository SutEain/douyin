-- 🎯 添加 Supabase Edge Functions Cron 任务
-- 使用 pg_net 扩展通过 HTTP 请求调用 Edge Function 的 /check-timeout 端点
-- 这样定时任务既能退款（数据库函数）又能发送消息（Edge Function）

-- -----------------------------------------------------------------------------
-- 1. 确保 pg_net 扩展已启用（用于发送 HTTP 请求）
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_net;

-- -----------------------------------------------------------------------------
-- 2. 创建调用 Edge Function 的函数（使用 service_role 权限）
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.call_check_timeout_edge_function()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_project_ref TEXT := 'zhlkanxfucnsatafeqdp';  -- 🎯 项目引用
  v_edge_function_url TEXT;
  v_service_role_key TEXT;
  v_request_id BIGINT;
BEGIN
  -- 🎯 构建 Edge Function URL
  v_edge_function_url := 'https://' || v_project_ref || '.supabase.co/functions/v1/bot-dice-game/check-timeout';
  
  -- 🎯 从环境变量或配置获取 service_role key
  -- 注意：Supabase 的 service_role key 应该存储在安全的地方
  -- 这里使用 current_setting 从 PostgreSQL 配置读取（需要先设置）
  -- 或者可以从配置表读取
  BEGIN
    v_service_role_key := current_setting('app.service_role_key', true);
  EXCEPTION
    WHEN OTHERS THEN
      -- 如果环境变量不存在，使用占位符（需要手动替换）
      RAISE WARNING '⚠️  service_role_key 未配置，请手动设置：ALTER DATABASE current_database() SET app.service_role_key = ''YOUR_KEY'';';
      RETURN;
  END;
  
  -- 🎯 发送 HTTP POST 请求调用 Edge Function
  SELECT net.http_post(
    url := v_edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object(
      'trigger_source', 'cron',
      'timestamp', extract(epoch from now())
    )::jsonb
  ) INTO v_request_id;
  
  RAISE NOTICE 'Edge Function called: request_id=%, url=%', v_request_id, v_edge_function_url;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. 创建 cron 任务（每分钟执行一次）
-- -----------------------------------------------------------------------------
-- 删除可能存在的旧任务
DO $$
DECLARE
  v_job_id INT;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'check-timeout-edge-function';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END $$;

-- 添加新的定时任务（每分钟执行一次）
SELECT cron.schedule(
  'check-timeout-edge-function',
  '* * * * *',  -- 每分钟执行一次
  $$ SELECT public.call_check_timeout_edge_function() $$
);

-- 授予权限
GRANT EXECUTE ON FUNCTION public.call_check_timeout_edge_function() TO service_role;

-- 注释
COMMENT ON FUNCTION public.call_check_timeout_edge_function() IS '调用 Edge Function 的 /check-timeout 端点，触发超时检查并发送消息（由 cron 定时调用）';
COMMENT ON EXTENSION pg_net IS 'PostgreSQL 扩展，用于发送 HTTP 请求（调用 Edge Function）';

-- 🎯 使用说明：
-- 1. 设置 service_role key（在 Supabase Dashboard → Settings → API 中获取）
--    ALTER DATABASE current_database() SET app.service_role_key = 'your-service-role-key-here';
-- 2. 或者创建配置表存储 key（更安全）
-- 3. Cron 任务会自动每分钟调用 Edge Function 的 /check-timeout 端点
