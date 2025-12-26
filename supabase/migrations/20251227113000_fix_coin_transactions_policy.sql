-- 1. 修复权限逻辑：使用 auth.jwt() 代替直接查询 auth.users 表（RSL 无法直接跨 schema 查询 auth.users）
DROP POLICY IF EXISTS "Admin view all transactions" ON public.coin_transactions;

CREATE POLICY "Admin view all transactions" ON public.coin_transactions
    FOR SELECT TO authenticated
    USING (
        (auth.uid() = user_id) OR 
        ((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'
    );

-- 2. 同时也赋予 Admin 插入和更新的权限（如果以后需要手动调账）
CREATE POLICY "Admin manage all transactions" ON public.coin_transactions
    FOR ALL TO authenticated
    USING (
        ((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'
    )
    WITH CHECK (
        ((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'
    );

