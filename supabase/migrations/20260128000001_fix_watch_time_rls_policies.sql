-- 🚨 修复观看时长表的 RLS 策略
-- 问题：user_daily_watch_time 和 user_video_watch_time 表只有 SELECT 策略，缺少 INSERT/UPDATE 策略
-- 虽然函数使用 SECURITY DEFINER 可以绕过 RLS，但最佳实践是确保表有正确的策略
-- 修复：添加允许 service_role 和函数操作的策略

-- 1. 检查并启用 RLS（如果未启用）
ALTER TABLE public.user_daily_watch_time ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_video_watch_time ENABLE ROW LEVEL SECURITY;

-- 2. 为 user_daily_watch_time 表添加完整的 RLS 策略

-- 2.1 SELECT 策略：用户只能查看自己的记录（已存在，但确保存在）
DROP POLICY IF EXISTS "Users can view own daily watch time" ON public.user_daily_watch_time;
CREATE POLICY "Users can view own daily watch time" 
ON public.user_daily_watch_time 
FOR SELECT 
USING (auth.uid() = user_id);

-- 2.2 INSERT/UPDATE 策略：允许 service_role 和 SECURITY DEFINER 函数操作
-- 注意：SECURITY DEFINER 函数会以函数所有者（通常是 postgres 或 service_role）身份执行
-- 因此需要允许这些角色操作，或者使用更宽松的策略

-- 方案1：允许 service_role 和 postgres 角色操作（推荐）
-- SECURITY DEFINER 函数会以函数所有者身份执行，通常是 postgres 或 service_role
DROP POLICY IF EXISTS "Service role can manage watch time" ON public.user_daily_watch_time;
CREATE POLICY "Service role can manage watch time" 
ON public.user_daily_watch_time 
FOR ALL 
USING (
    -- 允许 service_role 操作
    current_user = 'service_role'
    OR 
    -- 允许 postgres 角色操作（SECURITY DEFINER 函数通常以 postgres 身份执行）
    current_user = 'postgres'
    OR
    -- 允许用户操作自己的记录（通过函数，虽然函数是 SECURITY DEFINER，但保留此条件作为额外保护）
    auth.uid() = user_id
)
WITH CHECK (
    current_user = 'service_role'
    OR 
    current_user = 'postgres'
    OR
    auth.uid() = user_id
);

-- 注意：如果上述策略不工作，可能需要使用更宽松的策略
-- 因为 SECURITY DEFINER 函数在执行时会临时切换角色，RLS 会检查函数所有者的权限
-- 如果函数所有者是 postgres，但策略只允许 service_role，可能会有问题
-- 在这种情况下，可以使用以下更宽松的策略（但确保只在函数中使用）：
-- 
-- DROP POLICY IF EXISTS "Functions can manage watch time" ON public.user_daily_watch_time;
-- CREATE POLICY "Functions can manage watch time" 
-- ON public.user_daily_watch_time 
-- FOR ALL 
-- USING (true)
-- WITH CHECK (true);

-- 3. 为 user_video_watch_time 表添加完整的 RLS 策略

-- 3.1 SELECT 策略：用户只能查看自己的记录（已存在，但确保存在）
DROP POLICY IF EXISTS "Users can view own video watch time" ON public.user_video_watch_time;
CREATE POLICY "Users can view own video watch time" 
ON public.user_video_watch_time 
FOR SELECT 
USING (auth.uid() = user_id);

-- 3.2 INSERT/UPDATE 策略：允许 service_role 和 SECURITY DEFINER 函数操作
DROP POLICY IF EXISTS "Service role can manage video watch time" ON public.user_video_watch_time;
CREATE POLICY "Service role can manage video watch time" 
ON public.user_video_watch_time 
FOR ALL 
USING (
    current_user = 'service_role'
    OR 
    current_user = 'postgres'
    OR
    auth.uid() = user_id
)
WITH CHECK (
    current_user = 'service_role'
    OR 
    current_user = 'postgres'
    OR
    auth.uid() = user_id
);

-- 4. 验证策略已创建
DO $$
DECLARE
    v_policy_count INTEGER;
BEGIN
    -- 检查 user_daily_watch_time 的策略数量
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE tablename = 'user_daily_watch_time'
      AND schemaname = 'public';
    
    IF v_policy_count < 2 THEN
        RAISE WARNING 'user_daily_watch_time 表的策略数量不足：%', v_policy_count;
    ELSE
        RAISE NOTICE 'user_daily_watch_time 表的策略已创建：% 个策略', v_policy_count;
    END IF;
    
    -- 检查 user_video_watch_time 的策略数量
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE tablename = 'user_video_watch_time'
      AND schemaname = 'public';
    
    IF v_policy_count < 2 THEN
        RAISE WARNING 'user_video_watch_time 表的策略数量不足：%', v_policy_count;
    ELSE
        RAISE NOTICE 'user_video_watch_time 表的策略已创建：% 个策略', v_policy_count;
    END IF;
END;
$$;

COMMENT ON POLICY "Service role can manage watch time" ON public.user_daily_watch_time IS 
'允许 service_role 和 SECURITY DEFINER 函数操作观看时长记录，确保 update_watch_time_from_presence 和 sync_online_watch_time 函数可以正常工作';

COMMENT ON POLICY "Service role can manage video watch time" ON public.user_video_watch_time IS 
'允许 service_role 和 SECURITY DEFINER 函数操作视频观看时长记录，确保相关函数可以正常工作';
