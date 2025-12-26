-- 创建管理员手动调整余额的函数
CREATE OR REPLACE FUNCTION public.admin_adjust_balance(
    target_user_id UUID,
    amount_change DECIMAL,
    description_text TEXT
) RETURNS JSON AS $$
DECLARE
    final_balance DECIMAL;
    operator_id UUID;
BEGIN
    -- 获取当前操作管理员 ID (从 JWT 中获取)
    operator_id := auth.uid();

    -- 1. 更新用户余额
    UPDATE public.profiles 
    SET balance_coins = balance_coins + amount_change 
    WHERE id = target_user_id 
    RETURNING balance_coins INTO final_balance;

    -- 2. 记录流水
    INSERT INTO public.coin_transactions (
        user_id, 
        amount, 
        balance_after, 
        type, 
        description
    )
    VALUES (
        target_user_id, 
        amount_change, 
        final_balance, 
        'recharge', 
        '[后台调整] ' || COALESCE(description_text, '管理员手动调整')
    );

    RETURN json_build_object(
        'success', true, 
        'new_balance', final_balance
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 给函数增加权限：只有管理员能调用
-- 注意：这里假设您的 profiles 表或 JWT 中有 role 信息，或者您通过其他方式限制。
-- 在 Supabase 中，通常是通过 SECURITY DEFINER 和逻辑判断来限制。
-- 这里的逻辑判断可以在函数体内部增加：
/*
    IF NOT (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin') THEN
        RAISE EXCEPTION 'Only admins can adjust balance';
    END IF;
*/

