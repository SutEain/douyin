-- 🎯 创建PC28自动处理器的定时任务
-- 使用 pg_net 扩展通过 HTTP 请求调用 Edge Function
-- 每分钟执行一次（pg_cron最小间隔为1分钟，如需30秒间隔可使用外部服务）

-- -----------------------------------------------------------------------------
-- 1. 确保 pg_net 扩展已启用
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_net;

-- -----------------------------------------------------------------------------
-- 2. 删除可能存在的旧 cron 任务
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_job_id INT;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'pc28-auto-processor-cron';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. 创建 cron 任务（每分钟执行一次）
-- -----------------------------------------------------------------------------
SELECT cron.schedule(
  'pc28-auto-processor-cron',
  '* * * * *',  -- 每分钟执行一次（cron格式：分 时 日 月 周）
  $$
  SELECT net.http_post(
    url := 'https://zhlkanxfucnsatafeqdp.supabase.co/functions/v1/pc28-auto-processor',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);

-- 注释
COMMENT ON EXTENSION pg_net IS 'PostgreSQL 扩展，用于发送 HTTP 请求（调用 Edge Function）';

-- 🎯 说明：
-- 1. 此任务每分钟执行一次，调用 pc28-auto-processor Edge Function
-- 2. Edge Function 会自动：
--    - 轮询API获取最新开奖数据
--    - 发现新期号时自动开盘下一期
--    - 到达封盘时间时自动封盘
--    - API返回开奖结果时自动结算
--    - 超时未开奖时自动取消并退回下注
-- 3. 如需30秒间隔，可以使用外部服务（如Cloudflare Workers Cron Triggers）调用此Edge Function
