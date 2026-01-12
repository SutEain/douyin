-- 添加管理员更新 profiles 表的 RLS 策略
-- 问题：之前的迁移删除了 "Admins manage all profiles" 的 UPDATE 策略，但没有重新创建
-- 这导致管理员无法更新 profiles 表（包括 live_status 等字段）

-- 检查并创建管理员更新 profiles 的策略
DO $$
BEGIN
    -- 如果策略不存在，则创建
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'profiles' 
          AND policyname = 'Admins can update all profiles'
          AND cmd = 'UPDATE'
    ) THEN
        CREATE POLICY "Admins can update all profiles" ON public.profiles
            FOR UPDATE TO authenticated 
            USING (public.check_is_admin())
            WITH CHECK (public.check_is_admin());
        
        RAISE NOTICE 'Created policy: Admins can update all profiles';
    ELSE
        RAISE NOTICE 'Policy already exists: Admins can update all profiles';
    END IF;
END $$;

