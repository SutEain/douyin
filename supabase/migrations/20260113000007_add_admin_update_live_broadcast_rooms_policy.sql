-- 🎯 为 live_broadcast_rooms 表添加管理员更新策略
-- 问题：之前的策略只允许主播更新自己的房间，管理员无法更新 custom_viewer_count 等字段

-- 检查并创建管理员更新 live_broadcast_rooms 的策略
DO $$
BEGIN
    -- 如果策略不存在，则创建
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'live_broadcast_rooms' 
          AND policyname = 'Admins can update live broadcast rooms'
          AND cmd = 'UPDATE'
    ) THEN
        CREATE POLICY "Admins can update live broadcast rooms" ON public.live_broadcast_rooms
            FOR UPDATE TO authenticated 
            USING (public.check_is_admin())
            WITH CHECK (public.check_is_admin());
        
        RAISE NOTICE 'Created policy: Admins can update live broadcast rooms';
    ELSE
        RAISE NOTICE 'Policy already exists: Admins can update live broadcast rooms';
    END IF;
END $$;

