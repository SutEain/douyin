-- 创建定时批量更新红包消息的机制

-- 1. 创建一个函数来触发批量更新（通过 HTTP 调用 Edge Function）
CREATE OR REPLACE FUNCTION trigger_red_packet_batch_update()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 这个函数将被 pg_cron 调用
  -- 实际更新逻辑在 Edge Function 中
  -- 这里只是标记需要更新的红包
  
  -- 清理过期的更新请求（超过1分钟没更新成功的重置为需要更新）
  UPDATE red_packet_update_queue
  SET needs_update = true
  WHERE needs_update = false 
    AND last_updated_at < NOW() - INTERVAL '1 minute';
    
  -- 记录日志
  RAISE NOTICE 'Red packet batch update triggered at %', NOW();
END;
$$;

-- 2. 注释
COMMENT ON FUNCTION trigger_red_packet_batch_update IS '触发红包批量更新（由 pg_cron 每5秒调用一次）';

-- 3. 安装说明
-- 需要手动设置 pg_cron 定时任务：
-- SELECT cron.schedule(
--   'red-packet-update-every-5s',
--   '*/5 * * * * *',  -- 每5秒
--   $$ SELECT trigger_red_packet_batch_update(); $$
-- );
--
-- 或者使用 Supabase 的 Edge Function + 外部定时器（推荐）
-- 例如：使用 GitHub Actions 或 Vercel Cron 每5秒调用一次
-- POST https://your-project.supabase.co/functions/v1/update-red-packets

