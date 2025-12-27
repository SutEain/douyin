-- 1. 给 profiles 表增加 is_admin 标记
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- 2. 设置初始管理员 (根据已知管理员 ID 或 numeric_id)
-- 抖音精选 88888 设为管理员
UPDATE public.profiles SET is_admin = TRUE WHERE numeric_id = 88888;

-- 3. 创建统一的管理员判定函数 (SECURITY DEFINER 确保权限)
CREATE OR REPLACE FUNCTION public.check_is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    -- 核心判定逻辑：JWT 角色为 admin OR profiles 表 is_admin 为 true
    RETURN (
        COALESCE((auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'), false) OR
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 统一更新所有涉及管理员的 RLS 策略

-- recharge_orders
DROP POLICY IF EXISTS "Admins view all recharge orders" ON public.recharge_orders;
CREATE POLICY "Admins view all recharge orders" ON public.recharge_orders
    FOR SELECT TO authenticated USING (public.check_is_admin());

DROP POLICY IF EXISTS "Admins update all recharge orders" ON public.recharge_orders;
CREATE POLICY "Admins update all recharge orders" ON public.recharge_orders
    FOR UPDATE TO authenticated USING (public.check_is_admin());

-- coin_transactions
DROP POLICY IF EXISTS "Admin view all transactions" ON public.coin_transactions;
CREATE POLICY "Admin view all transactions" ON public.coin_transactions
    FOR SELECT TO authenticated USING (
        (auth.uid() = user_id) OR public.check_is_admin()
    );

-- withdraw_orders
DROP POLICY IF EXISTS "Admins view all withdraw orders" ON public.withdraw_orders;
CREATE POLICY "Admins view all withdraw orders" ON public.withdraw_orders
    FOR SELECT TO authenticated USING (public.check_is_admin());

DROP POLICY IF EXISTS "Admins update all withdraw orders" ON public.withdraw_orders;
CREATE POLICY "Admins update all withdraw orders" ON public.withdraw_orders
    FOR UPDATE TO authenticated USING (public.check_is_admin());

-- system_settings
DROP POLICY IF EXISTS "Admins can do everything on system_settings" ON public.system_settings;
CREATE POLICY "Admins can do everything on system_settings" ON public.system_settings
    FOR ALL TO authenticated USING (public.check_is_admin());

-- 💡 特别加固：admin_confirm_recharge 函数校验
-- 修改之前的函数，增加内部 is_admin 校验，防止被非管理员调用
CREATE OR REPLACE FUNCTION admin_confirm_recharge(
    p_order_id UUID,
    p_admin_id UUID
) RETURNS JSON AS $$
DECLARE
    v_order RECORD;
    v_final_balance DECIMAL;
    v_coins_to_add DECIMAL;
    v_is_admin BOOLEAN;
BEGIN
    -- 🎯 关键加固：内部再次校验 p_admin_id 是否真的是管理员
    SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id = p_admin_id;
    IF NOT v_is_admin THEN
        RETURN json_build_object('success', false, 'message', '权限不足：只有管理员可以确认充值');
    END IF;

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

