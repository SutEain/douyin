-- 🎯 修复：增加管理员更新任务规则的权限
-- 用户反馈：admin 后台“开关任务”没反应，是因为缺少 UPDATE 策略

DO $$
BEGIN
    -- 1. 检查并删除旧的策略（如果存在，防止冲突）
    -- 之前的 migration 20260107070000_fix_all_performance_issues.sql 只创建了 SELECT 策略
    DROP POLICY IF EXISTS "Admins manage all incentive rules" ON public.incentive_rules;
    
    -- 2. 创建一个更全面的管理员管理策略 (ALL 包括 INSERT, UPDATE, DELETE)
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'incentive_rules' 
          AND policyname = 'Admins manage incentive rules'
    ) THEN
        CREATE POLICY "Admins manage incentive rules" ON public.incentive_rules
            FOR ALL
            TO authenticated
            USING (public.check_is_admin())
            WITH CHECK (public.check_is_admin());
    END IF;

END $$;

