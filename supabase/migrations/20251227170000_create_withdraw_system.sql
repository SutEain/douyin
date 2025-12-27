-- 1. 创建提现订单表
CREATE TABLE IF NOT EXISTS public.withdraw_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL, -- 提现金额 (抖币)
    address TEXT NOT NULL, -- 提现地址 (TRC20)
    status TEXT NOT NULL DEFAULT 'pending', -- pending(待审核), completed(已汇款), rejected(已拒绝), cancelled(已取消)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    processed_by UUID, -- 管理员 ID
    order_no TEXT UNIQUE,
    remark TEXT
);

-- 2. 开启 RLS
ALTER TABLE public.withdraw_orders ENABLE ROW LEVEL SECURITY;

-- 3. 用户只能看自己的提现单
CREATE POLICY "Users view own withdraw orders" ON public.withdraw_orders
    FOR SELECT USING (auth.uid() = user_id);

-- 4. 管理员可以查看和更新所有提现单
CREATE POLICY "Admins view all withdraw orders" ON public.withdraw_orders
    FOR SELECT USING (
        (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin') OR
        (auth.jwt() ->> 'email' LIKE '%@admin.user')
    );

CREATE POLICY "Admins update all withdraw orders" ON public.withdraw_orders
    FOR UPDATE USING (
        (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin') OR
        (auth.jwt() ->> 'email' LIKE '%@admin.user')
    );

-- 5. 创建提现原子处理函数
CREATE OR REPLACE FUNCTION process_withdraw_request(
    p_user_id UUID,
    p_amount DECIMAL,
    p_address TEXT,
    p_order_no TEXT
) RETURNS JSON AS $$
DECLARE
    v_balance DECIMAL;
    v_order_id UUID;
BEGIN
    -- 1. 检查并锁定余额
    SELECT balance_coins INTO v_balance FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    
    IF v_balance < p_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    -- 2. 扣减余额，增加冻结金额
    UPDATE public.profiles 
    SET balance_coins = balance_coins - p_amount,
        frozen_coins = COALESCE(frozen_coins, 0) + p_amount
    WHERE id = p_user_id;

    -- 3. 创建提现订单
    INSERT INTO public.withdraw_orders (user_id, amount, address, order_no, status)
    VALUES (p_user_id, p_amount, p_address, p_order_no, 'pending')
    RETURNING id INTO v_order_id;

    -- 4. 记录流水 (送礼/打赏是 reward, 充值是 recharge, 提现是 withdraw)
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (
        p_user_id, 
        -p_amount, 
        v_balance - p_amount, 
        'withdraw', 
        '提现申请 (单号: ' || p_order_no || ')', 
        v_order_id
    );

    RETURN json_build_object('success', true, 'order_id', v_order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 赋予权限
GRANT EXECUTE ON FUNCTION process_withdraw_request(UUID, DECIMAL, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION process_withdraw_request(UUID, DECIMAL, TEXT, TEXT) TO service_role;

