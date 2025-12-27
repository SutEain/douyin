-- 1. 增加充值 TRC20 地址配置
INSERT INTO public.system_settings (id, value_int, value_text)
VALUES ('recharge_trc20_address', NULL, 'TRC20 充值收款地址')
ON CONFLICT (id) DO NOTHING;

-- 2. 创建充值订单表
CREATE TABLE IF NOT EXISTS public.recharge_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) NOT NULL,
    base_amount DECIMAL(12, 2) NOT NULL, -- 基础金额 (10, 20, 等)
    float_amount DECIMAL(12, 2) NOT NULL DEFAULT 0, -- 浮动金额 (0.01, 0.02, 等)
    total_amount DECIMAL(12, 2) NOT NULL, -- 最终应付金额 (base + float)
    status TEXT NOT NULL DEFAULT 'pending', -- pending(待支付), paid(已完成/已确认), expired(已过期), cancelled(已取消)
    trc20_address TEXT NOT NULL, -- 下单时的收款地址
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL, -- 支付截止时间 (下单后 30 分钟)
    locked_until TIMESTAMPTZ NOT NULL, -- 金额占用截止时间 (下单后 1 小时)
    paid_at TIMESTAMPTZ, -- 支付时间
    confirmed_by UUID, -- 确认人 (管理员) - 取消外键约束，因为管理员可能不在 profiles 表
    order_no TEXT UNIQUE -- ✅ 新增订单号
);

-- 3. 开启 RLS
ALTER TABLE public.recharge_orders ENABLE ROW LEVEL SECURITY;

-- 4. 只有用户自己能看自己的订单
CREATE POLICY "Users view own recharge orders" ON public.recharge_orders
    FOR SELECT USING (auth.uid() = user_id);

-- 5. 管理员和服务角色可以查看和更新所有订单
CREATE POLICY "Admins view all recharge orders" ON public.recharge_orders
    FOR SELECT USING (
        (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin') OR
        (auth.jwt() ->> 'email' LIKE '%@admin.user')
    );

CREATE POLICY "Admins update all recharge orders" ON public.recharge_orders
    FOR UPDATE USING (
        (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin') OR
        (auth.jwt() ->> 'email' LIKE '%@admin.user')
    );

-- 6. 允许认证用户创建订单 (实际上我们会通过 Edge Function 创建)
CREATE POLICY "Users insert own recharge orders" ON public.recharge_orders
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 7. 创建获取下一个可用金额的函数
CREATE OR REPLACE FUNCTION get_next_recharge_amount(p_base_amount DECIMAL)
RETURNS DECIMAL AS $$
DECLARE
    v_float DECIMAL := 0.00;
BEGIN
    -- 查找在当前 1 小时占用期内，该基础金额下已被占用的所有浮动金额
    -- 循环查找最小的空闲浮动值
    WHILE EXISTS (
        SELECT 1 FROM public.recharge_orders 
        WHERE base_amount = p_base_amount 
          AND locked_until > NOW() 
          AND float_amount = v_float
          AND status != 'cancelled'
    ) LOOP
        v_float := v_float + 0.01;
    END LOOP;
    
    RETURN p_base_amount + v_float;
END;
$$ LANGUAGE plpgsql;

-- 8. 赋予权限
GRANT EXECUTE ON FUNCTION get_next_recharge_amount(DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION get_next_recharge_amount(DECIMAL) TO service_role;

-- 9. 管理员确认充值函数
CREATE OR REPLACE FUNCTION admin_confirm_recharge(
    p_order_id UUID,
    p_admin_id UUID
) RETURNS JSON AS $$
DECLARE
    v_order RECORD;
    v_final_balance DECIMAL;
    v_coins_to_add DECIMAL;
BEGIN
    -- 1. 锁定并获取订单
    SELECT * INTO v_order FROM public.recharge_orders WHERE id = p_order_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '订单不存在');
    END IF;
    
    IF v_order.status != 'pending' THEN
        RETURN json_build_object('success', false, 'message', '订单状态不是待支付，无法确认');
    END IF;

    -- 2. 计算应到账抖币 (1 USDT = 100 抖币)
    v_coins_to_add := v_order.base_amount * 100;

    -- 3. 更新订单状态
    UPDATE public.recharge_orders 
    SET status = 'paid', 
        paid_at = NOW(), 
        confirmed_by = p_admin_id 
    WHERE id = p_order_id;

    -- 4. 增加用户余额
    UPDATE public.profiles 
    SET balance_coins = COALESCE(balance_coins, 0) + v_coins_to_add 
    WHERE id = v_order.user_id 
    RETURNING balance_coins INTO v_final_balance;

    -- 5. 记录流水
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (
        v_order.user_id, 
        v_coins_to_add, 
        v_final_balance, 
        'recharge', 
        'USDT充值到账 (单号: ' || COALESCE(v_order.order_no, '无') || ')', 
        v_order.id
    );

    RETURN json_build_object(
        'success', true, 
        'added_coins', v_coins_to_add,
        'new_balance', v_final_balance
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION admin_confirm_recharge(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_confirm_recharge(UUID, UUID) TO service_role;
