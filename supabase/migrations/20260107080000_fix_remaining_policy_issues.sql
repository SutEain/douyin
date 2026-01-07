-- 修复剩余的 RLS 策略问题
-- 1. 修复 live_broadcast_messages 表的 "Strict insert policy"
-- 2. 合并 recharge_orders 表的 INSERT 策略

-- ============================================
-- 1. 修复 live_broadcast_messages 表的策略
-- ============================================
DO $$
BEGIN
    -- 修复 "Strict insert policy"（如果存在）
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'live_broadcast_messages' 
          AND policyname = 'Strict insert policy'
          AND with_check LIKE '%auth.uid()%'
    ) THEN
        DROP POLICY IF EXISTS "Strict insert policy" ON public.live_broadcast_messages;
        CREATE POLICY "Users can insert chat messages" ON public.live_broadcast_messages
            FOR INSERT TO authenticated
            WITH CHECK (
                (select auth.uid()) = user_id AND 
                msg_type = 'chat'
            );
    END IF;
END $$;

-- ============================================
-- 2. 合并 recharge_orders 表的 INSERT 策略
-- ============================================
DO $$
BEGIN
    -- 合并 INSERT 策略
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'recharge_orders' 
          AND policyname IN ('Admins can insert recharge orders', 'Users insert own recharge orders')
    ) THEN
        DROP POLICY IF EXISTS "Admins can insert recharge orders" ON public.recharge_orders;
        DROP POLICY IF EXISTS "Users insert own recharge orders" ON public.recharge_orders;
        
        CREATE POLICY "Users and admins can insert recharge orders" ON public.recharge_orders
            FOR INSERT TO authenticated
            WITH CHECK (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
END $$;
