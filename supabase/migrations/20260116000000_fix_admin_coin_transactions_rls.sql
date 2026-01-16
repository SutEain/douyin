-- 🎯 修复admin后台资金流水查询问题
-- 问题：admin后台查询coin_transactions时，由于RLS策略在join时可能无法正确识别管理员，导致查询不到数据
-- 修复：确保coin_transactions表的RLS策略能够正确识别管理员，同时保持安全性

DO $$
BEGIN
    -- 1. 删除旧的策略（如果存在）
    DROP POLICY IF EXISTS "Admin view all transactions" ON public.coin_transactions;
    DROP POLICY IF EXISTS "Users view own transactions" ON public.coin_transactions;
    
    -- 2. 创建新的策略：确保admin可以查看所有交易，普通用户只能查看自己的
    -- 使用两个独立的策略，确保逻辑清晰且性能优化
    CREATE POLICY "Users view own transactions" ON public.coin_transactions
        FOR SELECT TO authenticated
        USING ((select auth.uid()) = user_id);
    
    CREATE POLICY "Admins view all transactions" ON public.coin_transactions
        FOR SELECT TO authenticated
        USING (public.check_is_admin());
    
    RAISE NOTICE 'Fixed coin_transactions RLS policies for admin access.';
END $$;
