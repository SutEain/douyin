-- 删除过时的流水表
DROP TABLE IF EXISTS public.wallet_ledger CASCADE;

-- 确保 coin_transactions 对 admin 角色可见
-- 如果使用了 refine 的 dataProvider，它默认使用 authenticated 角色
-- 我们需要确保 coin_transactions 允许 authenticated 角色且为 admin 的用户查看所有数据

DROP POLICY IF EXISTS "Users view own transactions" ON public.coin_transactions;

CREATE POLICY "Admin view all transactions" ON public.coin_transactions
    FOR SELECT TO authenticated
    USING (
        (auth.uid() = user_id) OR 
        (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_app_meta_data->>'role' = 'admin'))
    );

