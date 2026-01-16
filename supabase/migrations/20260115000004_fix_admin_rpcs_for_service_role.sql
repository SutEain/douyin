-- 🎯 修复：允许 Service Role (如 Edge Functions) 调用管理员 RPC 函数
-- 问题：之前的加固逻辑强制要求 p_admin_id = auth.uid()，但 Edge Function 使用 service_role 时 auth.uid() 为空，导致校验失败。
-- 修复：增加对 auth.role() = 'service_role' 的支持。

DO $$
BEGIN

-- -----------------------------------------------------------------------------
-- 1. 修复 check_is_admin (兼容 service_role)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_is_admin()
RETURNS BOOLEAN AS $func$
BEGIN
    RETURN (
        auth.role() = 'service_role' -- ✅ 允许 service_role 绕过
        OR EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- 2. 修复 admin_process_withdraw (兼容 service_role)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_process_withdraw(UUID, UUID, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.admin_process_withdraw(
    p_order_id UUID,
    p_admin_id UUID,
    p_action TEXT,
    p_remark TEXT DEFAULT NULL,
    p_tx_hash TEXT DEFAULT NULL
) RETURNS JSON 
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    v_order RECORD;
    v_final_balance NUMERIC;
    v_final_frozen NUMERIC;
BEGIN
    -- 🛑 核心校验修复：允许 service_role 或当前登录的管理员
    IF auth.role() = 'service_role' THEN
        -- service_role 模式下，校验传入的 p_admin_id 是否确实是管理员
        IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND is_admin = TRUE) THEN
            RETURN json_build_object('success', false, 'message', '非法管理员ID');
        END IF;
    ELSIF (p_admin_id != auth.uid() OR NOT public.check_is_admin()) THEN
        RETURN json_build_object('success', false, 'message', '权限不足：只有管理员可以处理提现');
    END IF;

    SELECT * INTO v_order FROM public.withdraw_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'message', '订单不存在'); END IF;
    IF v_order.status != 'pending' THEN RETURN json_build_object('success', false, 'message', '订单不是待审核状态'); END IF;

    IF p_action = 'approve' THEN
        UPDATE public.profiles SET frozen_coins = GREATEST(COALESCE(frozen_coins, 0) - v_order.amount, 0) WHERE id = v_order.user_id RETURNING balance_coins, frozen_coins INTO v_final_balance, v_final_frozen;
        UPDATE public.withdraw_orders SET status = 'completed', processed_at = NOW(), processed_by = p_admin_id, tx_hash = COALESCE(p_tx_hash, tx_hash), remark = COALESCE(p_remark, '管理员已确认打款') WHERE id = p_order_id;
    ELSIF p_action = 'reject' THEN
        UPDATE public.profiles SET balance_coins = balance_coins + v_order.amount, frozen_coins = GREATEST(COALESCE(frozen_coins, 0) - v_order.amount, 0) WHERE id = v_order.user_id RETURNING balance_coins, frozen_coins INTO v_final_balance, v_final_frozen;
        UPDATE public.withdraw_orders SET status = 'rejected', processed_at = NOW(), processed_by = p_admin_id, remark = COALESCE(p_remark, '申请被拒绝，资金已退回') WHERE id = p_order_id;
        INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
        VALUES (v_order.user_id, v_order.amount, v_final_balance, 'adjustment', '提现拒绝退回: ' || COALESCE(v_order.order_no, ''), v_order.id);
    ELSE
        RETURN json_build_object('success', false, 'message', '无效的操作类型');
    END IF;

    RETURN json_build_object('success', true, 'final_balance', v_final_balance, 'final_frozen', v_final_frozen);
END;
$func$;

-- -----------------------------------------------------------------------------
-- 3. 修复 admin_confirm_recharge (兼容 service_role)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_confirm_recharge(UUID, UUID);
CREATE OR REPLACE FUNCTION public.admin_confirm_recharge(
    p_order_id UUID,
    p_admin_id UUID
) RETURNS JSON 
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    v_order RECORD;
    v_final_balance DECIMAL;
    v_coins_to_add DECIMAL;
BEGIN
    -- 🛑 核心校验修复：允许 service_role 或当前登录的管理员
    IF auth.role() = 'service_role' THEN
        IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND is_admin = TRUE) THEN
            RETURN json_build_object('success', false, 'message', '非法管理员ID');
        END IF;
    ELSIF (p_admin_id != auth.uid() OR NOT public.check_is_admin()) THEN
        RETURN json_build_object('success', false, 'message', '权限不足：只有管理员可以确认充值');
    END IF;

    SELECT * INTO v_order FROM public.recharge_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'message', '订单不存在'); END IF;
    IF v_order.status != 'pending' THEN RETURN json_build_object('success', false, 'message', '订单状态不是待支付，无法确认'); END IF;

    v_coins_to_add := v_order.base_amount * 100;

    UPDATE public.recharge_orders SET status = 'paid', paid_at = NOW(), confirmed_by = p_admin_id WHERE id = p_order_id;
    UPDATE public.profiles SET balance_coins = COALESCE(balance_coins, 0) + v_coins_to_add WHERE id = v_order.user_id RETURNING balance_coins INTO v_final_balance;

    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (v_order.user_id, v_coins_to_add, v_final_balance, 'recharge', 'USDT充值到账 (单号: ' || COALESCE(v_order.order_no, '无') || ')', v_order.id);

    RETURN json_build_object('success', true, 'added_coins', v_coins_to_add, 'new_balance', v_final_balance);
END;
$func$;

    RAISE NOTICE 'Admin RPCs fixed for service_role compatibility.';
END $$;
